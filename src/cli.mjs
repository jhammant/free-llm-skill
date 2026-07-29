#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { createRedactor } from './redact.mjs';
import { createScheduler } from './scheduler.mjs';
import { createProxyServer, listen } from './proxy.mjs';
import { listModels, fetchLiveModels } from './models.mjs';
import {
  configPath,
  logPath,
  observedLimitsPath,
  statePath,
} from './paths.mjs';
import { readRequestLog, RequestLog } from './request-log.mjs';
import { addProviders, probeProvider, discoverProbeModel } from './onboarding.mjs';
import { checkProviders, diagnoseProviders } from './health.mjs';
import { providerDefinition } from './providers.mjs';

const VERSION = '1.0.0';
const VALUE_OPTIONS = new Set([
  'provider','port', 'host', 'limit']);
const BOOLEAN_OPTIONS = new Set([
  'free-only',
  'all',
  'dry-run',
  'json',
  'help',
  'no-open',
  'version',
]);

const HELP = `free-llm ${VERSION}

Usage:
  free-llm serve [--port 8080] [--host 127.0.0.1] [--json]
  free-llm status [--json]
  free-llm models [--free-only] [--provider <id>] [--json]
  free-llm log [--limit n] [--json]
  free-llm check [--json]
  free-llm add <provider> [--no-open] [--json]
  free-llm add --all [--no-open] [--json]
  free-llm probe <provider> [--dry-run] [--json]
  free-llm doctor [provider] [--json]
  free-llm --version

Configuration:
  ~/.config/free-llm/providers.json

API keys are read only from each provider's configured apiKeyEnv variable.
`;

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h') {
      options.help = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const equal = argument.indexOf('=');
    const rawName = argument.slice(2, equal < 0 ? undefined : equal);
    if (BOOLEAN_OPTIONS.has(rawName)) {
      if (equal >= 0) throw new Error(`Option --${rawName} does not take a value`);
      options[rawName] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(rawName)) throw new Error(`Unknown option --${rawName}`);
    const value = equal >= 0 ? argument.slice(equal + 1) : argv[++index];
    if (value == null || value === '') {
      throw new Error(`Option --${rawName} requires a value`);
    }
    options[rawName] = value;
  }
  return { options, positionals };
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printRows(output, rows, columns) {
  if (rows.length === 0) {
    output.write('None\n');
    return;
  }
  output.write(`${columns.map((column) => column.label).join('\t')}\n`);
  for (const row of rows) {
    output.write(`${columns.map((column) => column.value(row)).join('\t')}\n`);
  }
}

function numericOption(value, name, { minimum = 1, maximum = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function ensureNoPositionals(positionals, command) {
  if (positionals.length > 1) {
    throw new Error(`${command} does not accept positional arguments`);
  }
}

function formatRemaining(bucket) {
  if (!bucket) return '-';
  return `${bucket.remaining.toFixed(1)}/${bucket.limit}`;
}

function formatLimit(value) {
  return value == null ? '-' : String(value);
}

function observedLimit(provider, name) {
  return formatLimit(provider.observedLimits?.[name]?.limit);
}

function isLoopback(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized.startsWith('127.');
}

async function configuration(options) {
  const env = options.env ?? process.env;
  const config = options.config ?? await loadConfig({
    env,
    path: options.configPath,
  });
  const redactor = options.redactor ?? createRedactor(
    config.providers.map((provider) => provider.apiKey),
  );
  return { config, redactor };
}

async function runtime(options) {
  const env = options.env ?? process.env;
  const configured = await configuration(options);
  const scheduler = options.scheduler ?? await createScheduler(configured.config.providers, {
    env,
    statePath: options.statePath ?? statePath(env),
    observedLimitsPath: options.observedLimitsPath ?? observedLimitsPath(env),
    clock: options.clock,
    rng: options.rng,
  });
  return { ...configured, scheduler };
}

export async function runCli(argv, options = {}) {
  const env = options.env ?? process.env;
  const ambientRedactor = environmentRedactor(env);
  const rawStdout = options.stdout ?? process.stdout;
  const rawStderr = options.stderr ?? process.stderr;
  const stdout = {
    write(chunk) {
      return rawStdout.write(ambientRedactor.string(chunk));
    },
  };
  const stderr = {
    write(chunk) {
      return rawStderr.write(ambientRedactor.string(chunk));
    },
  };
  const parsed = parseArgs(argv);
  const command = parsed.positionals[0];

  if (parsed.options.version || command === '--version') {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0 };
  }
  if (parsed.options.help || command == null) {
    stdout.write(HELP);
    return { exitCode: 0 };
  }
  if (![
    'add',
    'check',
    'doctor',
    'log',
    'models',
    'probe',
    'serve',
    'status',
  ].includes(command)) {
    throw new Error(`Unknown command "${command}"`);
  }

  if (command === 'add') {
    const providerId = parsed.positionals[1];
    if (parsed.positionals.length > 2) {
      throw new Error(
        'add accepts a provider name only; API keys must come from hidden input or stdin',
      );
    }
    if (parsed.options.all && providerId) {
      throw new Error('add accepts either <provider> or --all, not both');
    }
    if (!parsed.options.all && !providerId) {
      throw new Error('add requires <provider> or --all');
    }
    const result = await addProviders({
      ...options,
      all: parsed.options.all === true,
      providerId,
      noOpen: parsed.options['no-open'] === true,
      json: parsed.options.json === true,
      configPath: options.configPath ?? configPath(env),
      stdout,
      stderr,
      env,
    });
    if (parsed.options.json) writeJson(stdout, result);
    return result;
  }

  if (command === 'probe') {
    if (parsed.positionals.length !== 2) {
      throw new Error('probe requires exactly one provider name');
    }
    const configured = await configuration({ ...options, env });
    const current = configured.config.providers.find(
      (provider) => provider.id === parsed.positionals[1],
    );
    if (!current) throw new Error(`Unknown configured provider "${parsed.positionals[1]}"`);
    const definition = providerDefinition(current.provider) ?? providerDefinition(current.id);
    const provider = definition == null ? current : {
      ...definition,
      ...current,
      cheapestModel: definition.cheapestModel,
    };
    // A configured model name is a hypothesis. Providers retire free models
    // constantly — the shipped catalogue named a Llama variant OpenRouter had
    // already withdrawn, and the probe burned its one request on a 404. Ask the
    // provider what it actually serves first.
    //
    // Never on a dry run: discovery is itself a network request, and --dry-run
    // promises exactly zero. A "dry" run that quietly calls out would be a lie
    // in the one place a user checks before spending anything.
    const isDryRun = parsed.options['dry-run'] === true;
    const liveModel = isDryRun ? null : await discoverProbeModel(provider, options);
    const result = await probeProvider(liveModel ? { ...provider, cheapestModel: liveModel } : provider, {
      ...options,
      ...(liveModel ? { model: liveModel } : {}),
      dryRun: isDryRun,
      observedLimitsPath: options.observedLimitsPath ?? observedLimitsPath(env),
      env,
    });
    const safeResult = configured.redactor.value(result);
    if (parsed.options.json) {
      writeJson(stdout, safeResult);
    } else if (safeResult.dryRun) {
      stdout.write(
        `Probe plan: ${safeResult.provider} · ${safeResult.model} · up to ${safeResult.maximumRequests} requests · max_tokens 1 · worst case ${safeResult.worstCaseTokens} tokens · daily limit not probed\n`,
      );
    } else {
      const symbol = safeResult.state === 'broken'
        ? '✗'
        : safeResult.state === 'throttled' ? '⚠' : '✓';
      stdout.write(
        `${symbol} ${safeResult.provider}: ${safeResult.reason}; ${safeResult.requests} requests, observed RPM ${safeResult.observedRpm ?? 'unknown'}\n`,
      );
    }
    return {
      exitCode: safeResult.state === 'broken' ? 1 : 0,
      report: safeResult,
    };
  }

  if (command === 'doctor') {
    if (parsed.positionals.length > 2) {
      throw new Error('doctor accepts at most one provider name');
    }
    const configured = await configuration({ ...options, env });
    const requested = parsed.positionals[1];
    const providers = requested == null
      ? configured.config.providers
      : configured.config.providers.filter((provider) => provider.id === requested);
    if (providers.length === 0) {
      throw new Error(`Unknown configured provider "${requested}"`);
    }
    const current = await runtime({
      ...options,
      env,
      config: configured.config,
      redactor: configured.redactor,
    });
    const entries = await readRequestLog({
      env,
      path: options.logPath ?? logPath(env),
      limit: Math.max(100, providers.length * 100),
    });
    const report = configured.redactor.value(await diagnoseProviders(
      providers,
      entries,
      {
        ...options,
        env,
        redactor: configured.redactor,
        schedulerStatus: current.scheduler.status(),
        observedLimitsPath: options.observedLimitsPath ?? observedLimitsPath(env),
      },
    ));
    if (parsed.options.json) {
      writeJson(stdout, report);
    } else {
      for (const provider of report.providers) {
        const rate = provider.successRate == null
          ? 'no recent calls'
          : `${(provider.successRate * 100).toFixed(1)}% success over ${provider.calls} calls`;
        stdout.write(`${provider.id}: ${rate}\n`);
        if (provider.lastError) {
          stdout.write(
            `  last error: ${provider.lastError.status ?? '-'} ${provider.lastError.outcome ?? '-'} on ${provider.lastError.model ?? '-'} (${provider.lastError.latencyMs ?? 0}ms)${provider.lastError.body ? ` — ${provider.lastError.body}` : ''}\n`,
          );
        }
        for (const drift of provider.limitDrift) {
          stdout.write(
            `  limit drift: ${drift.name} configured ${drift.configured ?? '-'}, observed ${drift.observed}\n`,
          );
        }
        if (provider.degraded) stdout.write('  warning: success rate is below 90%\n');
        stdout.write(`  next action: ${provider.nextAction}\n`);
      }
    }
    return { exitCode: 0, report };
  }

  ensureNoPositionals(parsed.positionals, command);

  if (command === 'log') {
    const limit = parsed.options.limit == null
      ? 20
      : numericOption(parsed.options.limit, 'limit', { minimum: 1, maximum: 10_000 });
    const logConfiguration = await configuration({ ...options, env });
    const entries = logConfiguration.redactor.value(await readRequestLog({
      env,
      path: options.logPath ?? logPath(env),
      limit,
    }));
    if (parsed.options.json) {
      writeJson(stdout, entries);
    } else {
      printRows(stdout, entries, [
        { label: 'TIME', value: (entry) => entry.timestamp ?? '-' },
        { label: 'PROVIDER', value: (entry) => entry.provider ?? '-' },
        { label: 'MODEL', value: (entry) => entry.model ?? '-' },
        { label: 'LATENCY', value: (entry) => `${entry.latencyMs ?? 0}ms` },
        { label: 'OUTCOME', value: (entry) => entry.outcome ?? '-' },
      ]);
    }
    return { exitCode: 0, entries };
  }

  const configured = await configuration({ ...options, env });
  if (command === 'check') {
    const current = await runtime({
      ...options,
      env,
      config: configured.config,
      redactor: configured.redactor,
    });
    const checked = await checkProviders(configured.config.providers, {
      ...options,
      redactor: configured.redactor,
      schedulerStatus: current.scheduler.status(),
    });
    const report = configured.redactor.value({
      source: configured.config.source,
      providers: checked.providers,
    });
    if (parsed.options.json) {
      writeJson(stdout, report);
    } else {
      for (const provider of report.providers) {
        const symbol = {
          working: '✓',
          broken: '✗',
          throttled: '⚠',
          unconfigured: '○',
        }[provider.state];
        const models = provider.state === 'working' ? `${provider.models} models` : '';
        const latency = provider.latencyMs == null ? '' : `${provider.latencyMs}ms`;
        const budget = provider.budget == null
          ? ''
          : `budget ${provider.budget.remaining.toFixed(0)}/${provider.budget.limit} today`;
        stdout.write(
          `${symbol} ${provider.id}\t${[models, latency, budget, provider.reason].filter(Boolean).join('\t')}\n`,
        );
      }
    }
    return { exitCode: checked.exitCode, report };
  }

  if (command === 'models') {
    // Ask each reachable provider what it ACTUALLY serves. The configured list
    // is a hypothesis: providers retire free models constantly, and a stale
    // name fails at request time rather than here where it is cheap to see.
    const only = parsed.options.provider;
    const usable = configured.config.providers.filter(
      (pr) => pr.apiKey && (!only || pr.id === only),
    );
    const live = (await Promise.all(usable.map((pr) => fetchLiveModels(pr, options)))).filter(Boolean);
    const rows = live.flatMap(({ provider, models: ms, note }) =>
      note && ms.length === 0
        ? [{ id: `(${note})`, provider, free: '', contextLength: '' }]
        : ms
            .filter((m) => !parsed.options['free-only'] || m.free)
            .map((m) => ({ id: m.id, provider, free: m.free ? 'free' : 'paid', contextLength: m.contextLength ?? '' })),
    );
    if (rows.length > 0) {
      if (parsed.options.json) writeJson(stdout, rows);
      else
        printRows(stdout, rows, [
          { label: 'MODEL', value: (r) => r.id },
          { label: 'PROVIDER', value: (r) => r.provider },
          { label: 'COST', value: (r) => r.free },
          { label: 'CONTEXT', value: (r) => r.contextLength },
        ]);
      return { exitCode: 0, models: rows };
    }
    const models = listModels(configured.config);
    if (parsed.options.json) {
      writeJson(stdout, models);
    } else {
      printRows(stdout, models, [
        { label: 'MODEL', value: (model) => model.id },
        { label: 'TYPE', value: (model) => (model.alias ? 'alias' : 'concrete') },
        { label: 'PROVIDERS', value: (model) => model.providers.join(',') },
      ]);
    }
    return { exitCode: 0, models };
  }

  const current = await runtime({
    ...options,
    env,
    config: configured.config,
    redactor: configured.redactor,
  });
  if (command === 'status') {
    const report = current.scheduler.status();
    if (parsed.options.json) {
      writeJson(stdout, report);
    } else {
      printRows(stdout, report, [
        { label: 'ID', value: (provider) => provider.id },
        { label: 'CONFIGURED', value: (provider) => (provider.configured ? 'yes' : 'no') },
        { label: 'ELIGIBLE', value: (provider) => (provider.eligible ? 'yes' : 'no') },
        { label: 'RPM', value: (provider) => formatRemaining(provider.buckets.rpm) },
        { label: 'RPM CONFIG', value: (provider) => formatLimit(provider.configuredLimits.rpm) },
        { label: 'RPM OBSERVED', value: (provider) => observedLimit(provider, 'rpm') },
        { label: 'RPD', value: (provider) => formatRemaining(provider.buckets.rpd) },
        { label: 'RPD CONFIG', value: (provider) => formatLimit(provider.configuredLimits.rpd) },
        { label: 'RPD OBSERVED', value: (provider) => observedLimit(provider, 'rpd') },
        { label: 'TPM', value: (provider) => formatRemaining(provider.buckets.tpm) },
        { label: 'BREAKER', value: (provider) => provider.breaker },
        { label: 'RETRY', value: (provider) => `${provider.retryAfter}s` },
      ]);
    }
    return { exitCode: 0, report };
  }

  const port = parsed.options.port == null
    ? 8080
    : numericOption(parsed.options.port, 'port', { minimum: 0, maximum: 65_535 });
  const host = parsed.options.host ?? '127.0.0.1';
  if (!isLoopback(host)) {
    stderr.write(
      `WARNING: free-llm is binding to non-loopback host ${host}; this process holds API keys.\n`,
    );
  }
  const requestLog = options.requestLog ?? new RequestLog({
    env,
    path: options.logPath ?? logPath(env),
    redactor: current.redactor,
    clock: options.clock,
  });
  const server = options.server ?? createProxyServer({
    config: current.config,
    scheduler: current.scheduler,
    requestLog,
    redactor: current.redactor,
    fetchFn: options.fetchFn,
    logger: options.logger,
    clock: options.clock,
    timeoutMs: options.timeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    headersTimeoutMs: options.headersTimeoutMs,
  });
  const address = await listen(server, { port, host });
  const displayHost = typeof address === 'object' && address?.address
    ? address.address
    : host;
  const displayPort = typeof address === 'object' && address?.port
    ? address.port
    : port;
  const started = {
    host: displayHost,
    port: displayPort,
    url: `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${displayPort}`,
  };
  if (parsed.options.json) writeJson(stdout, started);
  else stdout.write(`free-llm listening on ${started.url}\n`);
  return { exitCode: 0, server, address: started };
}

function environmentRedactor(env) {
  const likelySecrets = Object.entries(env)
    .filter(([name, value]) => (
      /(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD)$/i.test(name)
      && typeof value === 'string'
      && value.length > 0
    ))
    .map(([, value]) => value);
  return createRedactor(likelySecrets);
}

export async function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = await runCli(argv);
  } catch (error) {
    const redactor = environmentRedactor(process.env);
    process.stderr.write(`free-llm: ${redactor.string(error?.message ?? error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (!result.server) {
    process.exitCode = result.exitCode ?? 0;
    return;
  }
  const close = () => result.server.close();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await once(result.server, 'close');
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
