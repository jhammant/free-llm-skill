import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { validateConfig } from '../src/config.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { createProxyHandler } from '../src/proxy.mjs';
import { runCli } from '../src/cli.mjs';

const SENTINEL = 'FREE_LLM_SECRET_SENTINEL_9f3d7c';

function outputBuffer() {
  return {
    text: '',
    write(chunk) {
      this.text += String(chunk);
    },
  };
}

function secretConfig() {
  return validateConfig({
    providers: [{
      id: 'secret-provider',
      baseUrl: 'https://secret.invalid/v1',
      apiKeyEnv: 'SECRET_PROVIDER_KEY',
      limits: { rpm: 100, rpd: 100, tpm: null },
      models: ['secret/model'],
    }],
    aliases: { safe: { 'secret-provider': 'secret/model' } },
  }, {
    env: { SECRET_PROVIDER_KEY: SENTINEL },
    source: 'secret-test',
  });
}

class MemoryResponse extends Writable {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = headers;
    this.headersSent = true;
  }
}

async function invoke(handler, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = 'POST';
  request.url = '/v1/chat/completions';
  request.headers = { 'content-type': 'application/json' };
  const response = new MemoryResponse();
  await handler(request, response);
  if (!response.writableFinished && !response.destroyed) await once(response, 'finish');
  return response;
}

test('a distinctive API key appears in no log, error, response, or JSON output', async (t) => {
  const config = secretConfig();
  const scheduler = await Scheduler.create(config.providers, {
    statePath: null,
    clock: () => 0,
  });
  const logs = [];
  const logger = {
    warn(message) { logs.push(message); },
    error(message) { logs.push(message); },
  };
  const requestEntries = [];
  const handler = createProxyHandler({
    config,
    scheduler,
    logger,
    timeoutMs: 100,
    requestLog: {
      async append(entry) {
        requestEntries.push(entry);
      },
    },
    fetchFn: async () => {
      throw new Error(`upstream accidentally echoed ${SENTINEL}`);
    },
  });
  const response = await invoke(
    handler,
    { model: 'safe', messages: [], max_tokens: 1 },
  );
  const responseText = Buffer.concat(response.chunks).toString('utf8');
  assert.equal(response.statusCode, 502);

  const cliOutputs = [];
  for (const command of ['check', 'status', 'models']) {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    await runCli([command, '--json'], {
      config,
      scheduler,
      stdout,
      stderr,
      env: { SECRET_PROVIDER_KEY: SENTINEL },
    });
    cliOutputs.push(stdout.text, stderr.text);
  }

  const combined = [
    responseText,
    JSON.stringify(requestEntries),
    JSON.stringify(logs),
    ...cliOutputs,
  ].join('\n');
  assert.equal(combined.includes(SENTINEL), false, combined);
  assert.match(JSON.stringify(requestEntries), /\[REDACTED\]/);
});

test('an upstream cannot echo a key through an error, header, or split stream', async () => {
  const config = secretConfig();
  const scheduler = await Scheduler.create(config.providers, {
    statePath: null,
    clock: () => 0,
  });
  const errorHandler = createProxyHandler({
    config,
    scheduler,
    requestLog: { async append() {} },
    fetchFn: async () => new Response(`provider saw ${SENTINEL}`, {
      status: 400,
      headers: {
        'content-type': 'text/plain',
        'x-provider-debug': SENTINEL,
      },
    }),
  });
  const errorResponse = await invoke(
    errorHandler,
    { model: 'safe', messages: [], max_tokens: 1 },
  );

  const event = `data: {"choices":[{"delta":{"content":"${SENTINEL}"}}]}\n\n`;
  const splitAt = event.indexOf(SENTINEL) + Math.floor(SENTINEL.length / 2);
  const encoder = new TextEncoder();
  const streamHandler = createProxyHandler({
    config,
    scheduler,
    requestLog: { async append() {} },
    fetchFn: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(event.slice(0, splitAt)));
        controller.enqueue(encoder.encode(event.slice(splitAt)));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-provider-debug': SENTINEL,
      },
    }),
  });
  const streamResponse = await invoke(streamHandler, {
    model: 'safe',
    messages: [],
    stream: true,
    max_tokens: 1,
  });

  const combined = [
    Buffer.concat(errorResponse.chunks).toString('utf8'),
    JSON.stringify(errorResponse.headers),
    Buffer.concat(streamResponse.chunks).toString('utf8'),
    JSON.stringify(streamResponse.headers),
  ].join('\n');
  assert.equal(combined.includes(SENTINEL), false, combined);
  assert.match(combined, /\[REDACTED\]/);
});

test('an inline key is rejected without echoing its value', () => {
  let message;
  try {
    validateConfig({
      providers: [{
        id: 'bad',
        baseUrl: 'https://bad.invalid/v1',
        apiKeyEnv: 'BAD_KEY',
        apiKey: SENTINEL,
        limits: {},
      }],
    }, { env: {}, source: 'test' });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /inline API keys are forbidden/);
  assert.equal(message.includes(SENTINEL), false);
});

test('a key cannot be smuggled into a provider base URL', () => {
  let message;
  try {
    validateConfig({
      providers: [{
        id: 'bad-url',
        baseUrl: `https://${SENTINEL}@bad.invalid/v1`,
        apiKeyEnv: 'BAD_KEY',
        limits: {},
      }],
    }, { env: {}, source: 'test' });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /must not contain credentials/);
  assert.equal(message.includes(SENTINEL), false);
});
