import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { parseArgs, runCli } from '../src/cli.mjs';

function outputBuffer() {
  return {
    text: '',
    write(chunk) {
      this.text += String(chunk);
    },
  };
}

function config() {
  return validateConfig({
    providers: [{
      id: 'fake',
      baseUrl: 'https://fake.invalid/v1',
      apiKeyEnv: 'FAKE_KEY',
      limits: { rpm: 10, rpd: 100, tpm: null },
      models: ['fake/model'],
    }],
    aliases: { fast: { fake: 'fake/model' } },
  }, { env: { FAKE_KEY: 'not-real' }, source: 'test' });
}

class FakeServer extends EventEmitter {
  listen(port, host) {
    this.received = { port, host };
    this.bound = {
      address: host,
      family: host.includes(':') ? 'IPv6' : 'IPv4',
      port: port === 0 ? 31_337 : port,
    };
    queueMicrotask(() => this.emit('listening'));
  }

  address() {
    return this.bound;
  }
}

test('argument parsing supports values with either CLI syntax', () => {
  assert.deepEqual(parseArgs(['serve', '--port', '9000', '--host=127.0.0.1']), {
    options: { port: '9000', host: '127.0.0.1' },
    positionals: ['serve'],
  });
  assert.throws(() => parseArgs(['serve', '--unknown']), /Unknown option/);
});

test('serve defaults to loopback and warns on an explicit non-loopback host', async () => {
  const currentConfig = config();
  const scheduler = await Scheduler.create(currentConfig.providers, { statePath: null });
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const loopback = new FakeServer();
  const started = await runCli(['serve', '--port', '0'], {
    config: currentConfig,
    scheduler,
    server: loopback,
    stdout,
    stderr,
  });
  assert.deepEqual(loopback.received, { host: '127.0.0.1', port: 0 });
  assert.equal(stderr.text, '');
  assert.equal(started.address.port, 31_337);

  const exposed = new FakeServer();
  await runCli(['serve', '--port', '9000', '--host', '0.0.0.0'], {
    config: currentConfig,
    scheduler,
    server: exposed,
    stdout: outputBuffer(),
    stderr,
  });
  assert.deepEqual(exposed.received, { host: '0.0.0.0', port: 9000 });
  assert.match(stderr.text, /WARNING.*holds API keys/);
});

test('log returns the requested number of most recent attributed requests', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'free-llm-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'requests.jsonl');
  await writeFile(path, [
    JSON.stringify({ timestamp: 'one', provider: 'a', model: 'm1', latencyMs: 1, outcome: 'ok' }),
    JSON.stringify({ timestamp: 'two', provider: 'b', model: 'm2', latencyMs: 2, outcome: 'ok' }),
    JSON.stringify({ timestamp: 'three', provider: 'c', model: 'm3', latencyMs: 3, outcome: 'ok' }),
    '',
  ].join('\n'));
  const stdout = outputBuffer();
  await runCli(['log', '--limit', '2', '--json'], { logPath: path, stdout });
  const entries = JSON.parse(stdout.text);
  assert.deepEqual(entries.map((entry) => entry.provider), ['b', 'c']);
});
