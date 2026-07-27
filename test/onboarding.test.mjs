import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { checkProviders } from '../src/health.mjs';
import { addProviders, probeProvider } from '../src/onboarding.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { runCli } from '../src/cli.mjs';

const SENTINEL = 'FREE_LLM_ONBOARDING_SECRET_71e9c3';

function outputBuffer() {
  return {
    text: '',
    write(chunk) {
      this.text += String(chunk);
    },
  };
}

function definition(id, overrides = {}) {
  return {
    id,
    provider: id,
    name: id.toUpperCase(),
    baseUrl: `https://${id}.invalid/v1`,
    apiKeyEnv: `${id.toUpperCase()}_KEY`,
    limits: { rpm: 5, rpd: 100, tpm: null },
    models: [`${id}/cheap`],
    supportsEmbeddings: false,
    keyUrl: `https://${id}.invalid/keys`,
    actionUrl: `https://${id}.invalid/keys`,
    help: 'Create one API key.',
    cheapestModel: `${id}/cheap`,
    ...overrides,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'free-llm-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    configPath: join(directory, 'providers.json'),
    observedLimitsPath: join(directory, 'observed-limits.json'),
    statePath: join(directory, 'buckets.json'),
    logPath: join(directory, 'requests.jsonl'),
  };
}

function modelsResponse(models, status = 200) {
  return new Response(JSON.stringify(
    status === 200
      ? { data: models.map((id) => ({ id })) }
      : { error: { message: models } },
  ), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completionResponse(status = 200, body = { choices: [] }, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('add reports the HTTP reason for a rejected key and writes no config', async (t) => {
  const current = await fixture(t);
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const result = await addProviders({
    providerId: 'fake',
    providers: [definition('fake')],
    noOpen: true,
    readKey: async () => SENTINEL,
    configPath: current.configPath,
    stdout,
    stderr,
    fetchFn: async () => modelsResponse(`key rejected: ${SENTINEL}`, 401),
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.text, /401 unauthorized/);
  assert.equal(stderr.text.includes(SENTINEL), false);
  await assert.rejects(access(current.configPath), { code: 'ENOENT' });
});

test('add never accepts a key in argv and stores only an environment reference', async (t) => {
  const current = await fixture(t);
  const calls = [];
  const provider = definition('fake');
  const result = await runCli(['add', 'fake', '--no-open'], {
    providers: [provider],
    readKey: async () => SENTINEL,
    configPath: current.configPath,
    stdout: outputBuffer(),
    stderr: outputBuffer(),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith('/models')
        ? modelsResponse([provider.cheapestModel])
        : completionResponse();
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.init.headers.authorization === `Bearer ${SENTINEL}`));
  const contents = await readFile(current.configPath, 'utf8');
  assert.equal(contents.includes(SENTINEL), false);
  assert.match(contents, /"apiKeyEnv": "FAKE_KEY"/);
  assert.equal((await stat(current.configPath)).mode & 0o777, 0o600);

  await assert.rejects(
    runCli(['add', 'fake', SENTINEL], {
      providers: [provider],
      configPath: current.configPath,
      stdout: outputBuffer(),
      stderr: outputBuffer(),
    }),
    /hidden input or stdin/,
  );
});

test('add keeps wildcard-configured discovery inside the free model set', async (t) => {
  const current = await fixture(t);
  const provider = definition('router', {
    models: ['*:free'],
    cheapestModel: 'small:free',
  });
  let completionModel;
  const result = await addProviders({
    providerId: 'router',
    providers: [provider],
    noOpen: true,
    readKey: async () => SENTINEL,
    configPath: current.configPath,
    stdout: outputBuffer(),
    stderr: outputBuffer(),
    fetchFn: async (url, init) => {
      if (url.endsWith('/models')) {
        return modelsResponse(['paid-large', 'small:free', 'other:free']);
      }
      completionModel = JSON.parse(init.body).model;
      return completionResponse();
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(completionModel, 'small:free');
  const config = JSON.parse(await readFile(current.configPath, 'utf8'));
  assert.deepEqual(config.providers[0].models, ['small:free', 'other:free']);
});

test('add --all is atomic when interrupted and resumes from completed providers', async (t) => {
  const current = await fixture(t);
  const providers = ['one', 'two', 'three'].map((id) => definition(id));
  let keyReads = 0;
  const fetchFn = async (url) => {
    const provider = providers.find((item) => url.startsWith(item.baseUrl));
    return url.endsWith('/models')
      ? modelsResponse([provider.cheapestModel])
      : completionResponse();
  };
  await assert.rejects(addProviders({
    all: true,
    providers,
    noOpen: true,
    configPath: current.configPath,
    stdout: outputBuffer(),
    stderr: outputBuffer(),
    fetchFn,
    readKey: async () => {
      keyReads += 1;
      if (keyReads === 2) throw new Error('simulated interruption');
      return `${SENTINEL}-${keyReads}`;
    },
  }), /simulated interruption/);

  const partial = JSON.parse(await readFile(current.configPath, 'utf8'));
  assert.deepEqual(partial.providers.map((provider) => provider.id), ['one']);
  assert.equal(JSON.stringify(partial).includes(SENTINEL), false);

  const resumed = await addProviders({
    all: true,
    providers,
    noOpen: true,
    configPath: current.configPath,
    stdout: outputBuffer(),
    stderr: outputBuffer(),
    fetchFn,
    readKey: async (provider) => `${SENTINEL}-${provider.id}`,
  });
  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.providers[0].state, 'skipped');
  const complete = JSON.parse(await readFile(current.configPath, 'utf8'));
  assert.deepEqual(
    complete.providers.map((provider) => provider.id),
    ['one', 'two', 'three'],
  );
  assert.equal(JSON.stringify(complete).includes(SENTINEL), false);
});

test('probe stops on the first 429 and is hard-capped at configured RPM plus one', async (t) => {
  const current = await fixture(t);
  const provider = {
    ...definition('fake'),
    apiKey: SENTINEL,
    configured: true,
  };
  const bodies = [];
  const delays = [];
  let calls = 0;
  const result = await probeProvider(provider, {
    observedLimitsPath: current.observedLimitsPath,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    fetchFn: async (_url, init) => {
      calls += 1;
      bodies.push(JSON.parse(init.body));
      return calls === 4
        ? completionResponse(429, { error: { message: 'rpm reached' } }, { 'retry-after': '7' })
        : completionResponse();
    },
  });

  assert.equal(result.state, 'throttled');
  assert.equal(calls, 4);
  assert.ok(calls <= provider.limits.rpm + 1);
  assert.equal(result.observedRpm, 3);
  assert.equal(result.retryAfter, '7');
  assert.ok(delays.every((delay, index) => index === 0 || delay <= delays[index - 1]));
  assert.ok(bodies.every((body) => body.max_tokens === 1));
  assert.ok(bodies.every((body) => body.model === provider.cheapestModel));
  const observed = JSON.parse(await readFile(current.observedLimitsPath, 'utf8'));
  assert.equal(observed.providers.fake.rpm.limit, 3);
  assert.equal(observed.providers.fake.rpd, undefined);
});

test('probe dry-run sends zero requests and never plans a daily-limit probe', async () => {
  const provider = {
    ...definition('fake'),
    apiKey: SENTINEL,
    configured: true,
  };
  let calls = 0;
  const result = await probeProvider(provider, {
    dryRun: true,
    fetchFn: async () => {
      calls += 1;
      return completionResponse();
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.requests, 0);
  assert.equal(result.probesDailyLimit, false);
  assert.equal(result.maximumRequests, provider.limits.rpm + 1);
});

test('check distinguishes broken, throttled, working, and unconfigured', async () => {
  const providers = [
    { ...definition('working'), apiKey: 'working-key', configured: true },
    { ...definition('broken'), apiKey: 'broken-key', configured: true },
    { ...definition('busy'), apiKey: 'busy-key', configured: true },
    { ...definition('missing'), apiKey: null, configured: false },
  ];
  const checked = await checkProviders(providers, {
    fetchFn: async (url) => {
      if (url.startsWith(providers[0].baseUrl)) return modelsResponse(['working/cheap']);
      if (url.startsWith(providers[1].baseUrl)) return modelsResponse('key rejected', 401);
      return completionResponse(429, { error: { message: 'busy' } }, { 'retry-after': '34' });
    },
  });
  assert.deepEqual(
    checked.providers.map((provider) => provider.state),
    ['working', 'broken', 'throttled', 'unconfigured'],
  );
  assert.equal(checked.exitCode, 1);

  const throttledOnly = await checkProviders([providers[2], providers[3]], {
    fetchFn: async () => completionResponse(
      429,
      { error: { message: 'busy' } },
      { 'retry-after': '1' },
    ),
  });
  assert.equal(throttledOnly.exitCode, 0);
});

test('observed limits override configured scheduler limits and status exposes both', async () => {
  const provider = {
    ...definition('fake'),
    configured: true,
    apiKey: SENTINEL,
    limits: { rpm: 10, rpd: 100, tpm: null },
  };
  const scheduler = await Scheduler.create([provider], {
    statePath: null,
    observedLimits: {
      providers: {
        fake: {
          rpm: {
            limit: 2,
            observedAt: '2026-01-01T00:00:00.000Z',
            source: 'probe',
          },
        },
      },
    },
  });
  assert.equal((await scheduler.select()).ok, true);
  assert.equal((await scheduler.select()).ok, true);
  assert.equal((await scheduler.select()).ok, false);
  const status = scheduler.status()[0];
  assert.equal(status.configuredLimits.rpm, 10);
  assert.equal(status.observedLimits.rpm.limit, 2);
  assert.equal(status.buckets.rpm.limit, 2);
});

test('daily limits are inferred passively from normal-use 429s', async (t) => {
  const current = await fixture(t);
  const provider = {
    ...definition('fake'),
    configured: true,
    apiKey: SENTINEL,
    limits: { rpm: 10, rpd: 100, tpm: null },
  };
  const scheduler = await Scheduler.create([provider], {
    statePath: null,
    observedLimitsPath: current.observedLimitsPath,
    clock: () => 1_000,
  });
  assert.equal((await scheduler.select()).ok, true);
  await scheduler.recordRateLimit('fake', '7200', {
    errorBody: 'daily quota reached',
  });

  const observed = JSON.parse(await readFile(current.observedLimitsPath, 'utf8'));
  assert.equal(observed.providers.fake.rpd.limit, 1);
  assert.equal(observed.providers.fake.rpd.source, 'passive-429');
  assert.equal((await stat(current.observedLimitsPath)).mode & 0o777, 0o600);
  const status = scheduler.status()[0];
  assert.equal(status.configuredLimits.rpd, 100);
  assert.equal(status.observedLimits.rpd.limit, 1);
  assert.equal(status.buckets.rpd.limit, 1);
});

test('onboarding command output remains safe to paste when a provider echoes the key', async (t) => {
  const current = await fixture(t);
  const provider = definition('fake');
  const rawConfig = {
    providers: [{
      id: provider.id,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKeyEnv: provider.apiKeyEnv,
      limits: provider.limits,
      models: provider.models,
      supportsEmbeddings: false,
    }],
    aliases: { 'cheap-fast': { fake: provider.cheapestModel } },
  };
  await writeFile(current.logPath, `${JSON.stringify({
    timestamp: '2026-01-01T00:00:00.000Z',
    provider: 'fake',
    model: provider.cheapestModel,
    latencyMs: 1,
    status: 401,
    outcome: 'rejected',
    error: `provider echoed ${SENTINEL}`,
  })}\n`);
  const config = validateConfig(rawConfig, {
    env: { FAKE_KEY: SENTINEL },
    source: 'test',
  });
  const scheduler = await Scheduler.create(config.providers, {
    statePath: null,
    observedLimitsPath: null,
  });
  const outputs = [];
  const run = async (args, extra = {}) => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    await runCli(args, {
      config,
      scheduler,
      env: { FAKE_KEY: SENTINEL },
      logPath: current.logPath,
      observedLimitsPath: current.observedLimitsPath,
      stdout,
      stderr,
      fetchFn: async () => modelsResponse(`echo ${SENTINEL}`, 401),
      ...extra,
    });
    outputs.push(stdout.text, stderr.text);
  };
  await run(['check', '--json']);
  await run(['doctor', '--json']);
  await run(['probe', 'fake', '--json'], { sleep: async () => {} });
  await run(['log', '--json']);
  await run(['status', '--json']);
  await run(['models', '--json']);

  const addStdout = outputBuffer();
  const addStderr = outputBuffer();
  await runCli(['add', 'new', '--no-open', '--json'], {
    providers: [definition('new')],
    configPath: current.configPath,
    readKey: async () => SENTINEL,
    stdout: addStdout,
    stderr: addStderr,
    fetchFn: async () => modelsResponse(`echo ${SENTINEL}`, 401),
  });
  outputs.push(addStdout.text, addStderr.text);

  for (const line of outputs.join('\n').split('\n')) {
    assert.equal(line.includes(SENTINEL), false, line);
  }
});
