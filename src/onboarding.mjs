import { spawn } from 'node:child_process';
import { readConfigDocument, writeConfig } from './config.mjs';
import { createRedactor } from './redact.mjs';
import {
  configuredAlias,
  providerDefinition,
  recommendedProviders,
} from './providers.mjs';
import {
  cheapestModel,
  httpReason,
  providerRequest,
  readResponseText,
  responseOkay,
  validateProviderKey,
} from './provider-client.mjs';
import { writeObservedLimit } from './observed-limits.mjs';

function outputWriter(output, redactor) {
  return {
    write(value) {
      output.write(redactor.string(value));
    },
  };
}

export async function openProviderPage(url, options = {}) {
  if (typeof options.openUrl === 'function') {
    await options.openUrl(url);
    return;
  }
  const platform = options.platform ?? process.platform;
  const spawnFn = options.spawnFn ?? spawn;
  const [command, args] = platform === 'darwin'
    ? ['open', [url]]
    : platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  await new Promise((resolve, reject) => {
    const child = spawnFn(command, args, {
      detached: platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref?.();
      resolve();
    });
  });
}

async function hiddenLine(input, output, prompt) {
  if (typeof input.setRawMode !== 'function') {
    throw new Error('Hidden input requires a TTY or piped stdin');
  }
  output.write(prompt);
  input.setEncoding?.('utf8');
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  input.resume?.();
  try {
    return await new Promise((resolve, reject) => {
      let value = '';
      const onData = (chunk) => {
        for (const character of String(chunk)) {
          if (character === '\u0003') {
            cleanup();
            const error = new Error('Interrupted');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          if (character === '\r' || character === '\n') {
            cleanup();
            output.write('\n');
            resolve(value);
            return;
          }
          if (character === '\u007f' || character === '\b') {
            value = value.slice(0, -1);
          } else if (character >= ' ') {
            value += character;
          }
        }
      };
      const onEnd = () => {
        cleanup();
        resolve(value);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        input.off('data', onData);
        input.off('end', onEnd);
        input.off('error', onError);
      };
      input.on('data', onData);
      input.once('end', onEnd);
      input.once('error', onError);
    });
  } finally {
    input.setRawMode(wasRaw);
    input.pause?.();
  }
}

async function pipedLines(input) {
  let contents = '';
  for await (const chunk of input) contents += chunk.toString();
  return contents.split(/\r?\n/);
}

export function createKeyReader(options = {}) {
  const input = options.stdin ?? process.stdin;
  const output = options.stderr ?? process.stderr;
  let linesPromise;
  let lineIndex = 0;
  return async function readKey(provider) {
    if (typeof options.readKey === 'function') {
      const value = await options.readKey(provider);
      return typeof value === 'string' ? value.trim() : '';
    }
    if (input.isTTY) {
      return (await hiddenLine(
        input,
        output,
        `${provider.name ?? provider.id} API key (input hidden): `,
      )).trim();
    }
    linesPromise ??= pipedLines(input);
    const lines = await linesPromise;
    return (lines[lineIndex++] ?? '').trim();
  };
}

function displayLimits(limits) {
  return [
    limits.rpm == null ? null : `${limits.rpm.toLocaleString('en-US')} RPM`,
    limits.rpd == null ? null : `${limits.rpd.toLocaleString('en-US')} RPD`,
    limits.tpm == null ? null : `${limits.tpm.toLocaleString('en-US')} TPM`,
  ].filter(Boolean).join(' · ');
}

function rawEntry(provider, models) {
  return {
    id: provider.id,
    provider: provider.provider ?? provider.id,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv,
    limits: { ...provider.limits },
    models: [...models],
    supportsEmbeddings: provider.supportsEmbeddings !== false,
  };
}

function upsertProvider(document, provider, validation) {
  const providers = [...document.providers];
  const index = providers.findIndex((entry) => entry.id === provider.id);
  const entry = rawEntry(provider, validation.models);
  if (index < 0) providers.push(entry);
  else providers[index] = entry;
  const aliases = structuredClone(document.aliases ?? {});
  aliases['cheap-fast'] ??= {};
  aliases['cheap-fast'][provider.id] = validation.model
    ?? configuredAlias(provider.id)
    ?? validation.models[0];
  return { providers, aliases };
}

export async function addProviders(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const definitions = options.providers ?? recommendedProviders();
  const selected = options.all
    ? definitions
    : [providerDefinition(options.providerId, definitions)].filter(Boolean);
  if (selected.length === 0) {
    throw new Error(`Unknown provider "${options.providerId}"`);
  }
  const configPath = options.configPath;
  let document = await readConfigDocument({ path: configPath, env });
  const readKey = createKeyReader({ ...options, stderr });
  const results = [];
  for (const provider of selected) {
    const alreadyPresent = document.providers.some((entry) => entry.id === provider.id);
    if (options.all && alreadyPresent) {
      const skipped = { id: provider.id, state: 'skipped', reason: 'already configured' };
      results.push(skipped);
      if (!options.json) stdout.write(`○ ${provider.id} already configured — skipped\n`);
      continue;
    }
    if (!options.json) {
      stdout.write(`\n${provider.name ?? provider.id} — ${displayLimits(provider.limits)} (published, unverified)\n`);
      if (!options.noOpen) stdout.write(`Opening ${provider.keyUrl}\n`);
      stdout.write(`${provider.help}\n`);
    }
    if (!options.noOpen) {
      try {
        await openProviderPage(provider.keyUrl, options);
      } catch (error) {
        stderr.write(`Could not open ${provider.keyUrl}: ${error.message}\n`);
      }
    }
    const apiKey = await readKey(provider);
    if (!apiKey) {
      const result = { id: provider.id, state: 'broken', reason: 'no API key was provided' };
      results.push(result);
      if (!options.json) stderr.write(`✗ ${provider.id}: ${result.reason}\n`);
      if (!options.all) return { exitCode: 1, providers: results };
      continue;
    }
    const redactor = createRedactor([apiKey]);
    const safeStdout = outputWriter(stdout, redactor);
    const safeStderr = outputWriter(stderr, redactor);
    const validation = await validateProviderKey(provider, apiKey, {
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs,
    });
    if (!validation.ok) {
      const result = {
        id: provider.id,
        state: 'broken',
        status: validation.status,
        reason: redactor.string(validation.reason),
      };
      results.push(result);
      if (!options.json) safeStderr.write(`✗ ${provider.id}: ${result.reason}\n`);
      if (!options.all) return { exitCode: 1, providers: results };
      continue;
    }
    document = upsertProvider(document, provider, validation);
    const path = await writeConfig(document, { path: configPath, env });
    const result = {
      id: provider.id,
      state: 'working',
      models: validation.models.length,
      model: validation.model,
      latencyMs: validation.latencyMs,
      configPath: path,
      apiKeyEnv: provider.apiKeyEnv,
    };
    results.push(result);
    if (!options.json) {
      safeStdout.write(
        `✓ key works — ${result.models} models reachable, ${result.model} responded in ${result.latencyMs}ms\n`,
      );
      safeStdout.write(`✓ written to ${path} as \`${provider.id}\`\n`);
      safeStdout.write(`Add this to your shell profile: export ${provider.apiKeyEnv}='<paste key here>'\n`);
      safeStdout.write(`→ run \`free-llm probe ${provider.id}\` to measure its real limits\n`);
    }
  }
  return {
    exitCode: results.some((result) => result.state === 'broken') ? 1 : 0,
    providers: results,
  };
}

export function probePlan(provider, options = {}) {
  const configuredRpm = provider.limits?.rpm;
  if (!Number.isSafeInteger(configuredRpm) || configuredRpm <= 0) {
    throw new Error(`Provider "${provider.id}" has no configured RPM limit to probe`);
  }
  const model = options.model
    ?? cheapestModel(provider, provider.models)
    ?? provider.cheapestModel;
  if (!model) throw new Error(`Provider "${provider.id}" has no concrete chat model to probe`);
  const maximumRequests = configuredRpm + 1;
  const request = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
  };
  const worstCaseTokensPerRequest = Buffer.byteLength(JSON.stringify(request), 'utf8');
  const delays = probeDelays(configuredRpm, maximumRequests);
  return {
    provider: provider.id,
    model,
    configuredRpm,
    maximumRequests,
    maxTokensPerRequest: 1,
    worstCaseTokensPerRequest,
    worstCaseTokens: maximumRequests * worstCaseTokensPerRequest,
    durationMs: delays.reduce((sum, delay) => sum + delay, 0),
    probesDailyLimit: false,
  };
}

function probeDelays(configuredRpm, maximumRequests) {
  const intervals = Math.max(0, maximumRequests - 1);
  if (intervals === 0) return [];
  const startingRate = Math.max(1, configuredRpm / 4);
  const startingDelay = 60_000 / startingRate;
  const raw = Array.from({ length: intervals }, (_, index) => {
    const progress = intervals === 1 ? 0 : index / (intervals - 1);
    return startingDelay * ((1 - progress) ** 4);
  });
  // Keep every request inside one rolling-minute window while retaining the
  // slow start. The final twenty seconds are left as margin for network latency.
  const total = raw.reduce((sum, delay) => sum + delay, 0);
  const scale = total > 40_000 ? 40_000 / total : 1;
  return raw.map((delay) => Math.max(0, Math.floor(delay * scale)));
}

export async function probeProvider(provider, options = {}) {
  const plan = probePlan(provider, options);
  if (options.dryRun) return { ...plan, dryRun: true, requests: 0 };
  if (!provider.apiKey) {
    throw new Error(`${provider.apiKeyEnv} is unset; add or export the key before probing`);
  }
  const sleep = options.sleep ?? ((milliseconds) => new Promise(
    (resolve) => setTimeout(resolve, milliseconds),
  ));
  const delays = probeDelays(plan.configuredRpm, plan.maximumRequests);
  let successful = 0;
  for (let index = 0; index < plan.maximumRequests; index += 1) {
    if (index > 0) {
      await sleep(delays[index - 1]);
    }
    let request;
    try {
      request = await providerRequest(provider, '/chat/completions', {
        fetchFn: options.fetchFn,
        timeoutMs: options.timeoutMs,
        method: 'POST',
        body: {
          model: plan.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
      });
    } catch (error) {
      return {
        ...plan,
        state: 'broken',
        requests: index + 1,
        successful,
        reason: `network error — ${error.message}`,
      };
    }
    let text;
    try {
      text = await readResponseText(request.response, options.timeoutMs ?? 10_000);
    } catch (error) {
      return {
        ...plan,
        state: 'broken',
        requests: index + 1,
        successful,
        reason: `network error — ${error.message}`,
      };
    }
    if (request.status === 429) {
      const observedRpm = successful === 0 ? null : successful;
      const observed = observedRpm == null ? null : await writeObservedLimit(
        provider.id,
        'rpm',
        observedRpm,
        {
          path: options.observedLimitsPath,
          env: options.env,
          clock: options.clock,
          source: 'probe',
          details: {
            configuredLimit: plan.configuredRpm,
            ceilingFound: true,
            retryAfter: request.retryAfter,
          },
        },
      );
      return {
        ...plan,
        state: 'throttled',
        requests: index + 1,
        successful,
        observedRpm,
        observedAt: observed?.observedAt ?? null,
        retryAfter: request.retryAfter,
        reason: httpReason(429, text),
      };
    }
    if (!responseOkay(request.response)) {
      return {
        ...plan,
        state: 'broken',
        requests: index + 1,
        successful,
        status: request.status,
        reason: httpReason(request.status, text),
      };
    }
    successful += 1;
  }
  const observed = await writeObservedLimit(provider.id, 'rpm', plan.configuredRpm, {
    path: options.observedLimitsPath,
    env: options.env,
    clock: options.clock,
    source: 'probe',
    details: {
      configuredLimit: plan.configuredRpm,
      ceilingFound: false,
      lowerBound: plan.maximumRequests,
    },
  });
  return {
    ...plan,
    state: 'working',
    requests: plan.maximumRequests,
    successful,
    observedRpm: plan.configuredRpm,
    observedAt: observed.observedAt,
    reason: `no 429 at or below ${plan.maximumRequests} requests`,
  };
}
