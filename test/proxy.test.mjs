import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { validateConfig } from '../src/config.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { createProxyHandler } from '../src/proxy.mjs';

function rawConfig(overrides = {}) {
  return {
    providers: [
      {
        id: 'one',
        provider: 'one',
        baseUrl: 'https://one.invalid/v1',
        apiKeyEnv: 'ONE_KEY',
        limits: { rpm: 100, rpd: 1_000, tpm: null },
        models: ['one/chat', 'one/embed'],
        supportsEmbeddings: true,
      },
      ...(overrides.providers ?? []),
    ],
    aliases: {
      fast: { one: 'one/chat' },
      ...(overrides.aliases ?? {}),
    },
  };
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
    this.headers = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
    );
    this.headersSent = true;
    return this;
  }

  get text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

async function invoke(handler, pathname, body = null) {
  const request = Readable.from(
    body == null ? [] : [Buffer.from(JSON.stringify(body))],
  );
  request.method = body == null ? 'GET' : 'POST';
  request.url = pathname;
  request.headers = body == null ? {} : { 'content-type': 'application/json' };
  const response = new MemoryResponse();
  await handler(request, response);
  if (!response.writableFinished) await once(response, 'finish');
  return {
    status: response.statusCode,
    headers: response.headers,
    text: response.text,
    json() {
      return JSON.parse(response.text);
    },
  };
}

async function startProxy(_t, options = {}) {
  const env = { ONE_KEY: 'fake-one', ...(options.env ?? {}) };
  const config = options.config ?? validateConfig(
    options.rawConfig ?? rawConfig(),
    { env, source: 'test' },
  );
  const scheduler = options.scheduler ?? await Scheduler.create(config.providers, {
    statePath: null,
    clock: options.clock ?? Date.now,
    rng: options.rng ?? (() => 0),
  });
  const entries = [];
  const requestLog = options.requestLog ?? {
    async append(entry) {
      entries.push(entry);
    },
  };
  const handler = createProxyHandler({
    config,
    scheduler,
    requestLog,
    fetchFn: options.fetchFn,
    clock: options.clock,
    timeoutMs: options.timeoutMs ?? 500,
  });
  return {
    handler,
    config,
    scheduler,
    entries,
  };
}

function successfulChat(model = 'one/chat') {
  return new Response(JSON.stringify({
    id: 'chat-1',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'hello' } }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('unknown request fields reach the selected upstream unmodified', async (t) => {
  let captured;
  const proxy = await startProxy(t, {
    fetchFn: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return successfulChat();
    },
  });
  const request = {
    model: 'fast',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: 'high',
    tools: [{ type: 'function', function: { name: 'lookup', parameters: {} } }],
    response_format: { type: 'json_object' },
    vendor_extension: { keep: true },
    max_tokens: 20,
  };
  const response = await invoke(proxy.handler, '/v1/chat/completions', request);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-free-llm-provider'], 'one');
  assert.equal(response.headers['x-free-llm-model'], 'one/chat');
  assert.equal(captured.url, 'https://one.invalid/v1/chat/completions');
  assert.deepEqual(captured.body, { ...request, model: 'one/chat' });
  assert.equal(captured.init.headers.authorization, 'Bearer fake-one');
});

test('an unavailable alias returns 429 without substituting a model', async (t) => {
  let fetchCalls = 0;
  const proxy = await startProxy(t, {
    rawConfig: {
      ...rawConfig(),
      aliases: { unavailable: { one: 'one/chat' } },
    },
    env: { ONE_KEY: '' },
    fetchFn: async () => {
      fetchCalls += 1;
      return successfulChat();
    },
  });
  const response = await invoke(proxy.handler, '/v1/chat/completions', {
    model: 'unavailable',
    messages: [{ role: 'user', content: 'hi' }],
  });
  const payload = response.json();
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '60');
  assert.match(payload.error.message, /has no usable provider/);
  assert.equal(fetchCalls, 0);
});

test('an alias resolves to each provider-specific concrete model', async (t) => {
  const captured = [];
  const proxy = await startProxy(t, {
    rawConfig: rawConfig({
      providers: [{
        id: 'two',
        provider: 'two',
        baseUrl: 'https://two.invalid/v1',
        apiKeyEnv: 'TWO_KEY',
        limits: { rpm: 100, rpd: 1_000, tpm: null },
        models: ['two/chat'],
        supportsEmbeddings: false,
      }],
      aliases: { fast: { one: 'one/chat', two: 'two/chat' } },
    }),
    env: { TWO_KEY: 'fake-two' },
    fetchFn: async (url, init) => {
      captured.push({ url, body: JSON.parse(init.body) });
      return successfulChat();
    },
  });
  const call = () => invoke(proxy.handler, '/v1/chat/completions', {
    model: 'fast',
    messages: [],
    max_tokens: 1,
  });
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  assert.deepEqual(
    new Set(captured.map((request) => request.body.model)),
    new Set(['one/chat', 'two/chat']),
  );
  assert.deepEqual(
    new Set(captured.map((request) => request.url)),
    new Set([
      'https://one.invalid/v1/chat/completions',
      'https://two.invalid/v1/chat/completions',
    ]),
  );
});

test('exhaustion returns 429 promptly and never overshoots RPM', async (t) => {
  let fetchCalls = 0;
  let now = 0;
  const config = validateConfig({
    providers: [{
      id: 'one',
      baseUrl: 'https://one.invalid/v1',
      apiKeyEnv: 'ONE_KEY',
      limits: { rpm: 1, rpd: null, tpm: null },
      models: ['one/chat'],
    }],
    aliases: { fast: { one: 'one/chat' } },
  }, { env: { ONE_KEY: 'fake-one' }, source: 'test' });
  const scheduler = await Scheduler.create(config.providers, {
    statePath: null,
    clock: () => now,
  });
  const proxy = await startProxy(t, {
    config,
    scheduler,
    clock: () => now,
    fetchFn: async () => {
      fetchCalls += 1;
      return successfulChat();
    },
  });
  const call = () => invoke(proxy.handler, '/v1/chat/completions', {
    model: 'fast',
    messages: [],
    max_tokens: 1,
  });

  assert.equal((await call()).status, 200);
  const second = await Promise.race([
    call(),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('proxy hung instead of returning 429')),
      250,
    )),
  ]);
  assert.equal(second.status, 429);
  assert.equal(second.headers['retry-after'], '60');
  assert.equal(fetchCalls, 1);

  now = 60_000;
  assert.equal((await call()).status, 200);
  assert.equal(fetchCalls, 2);
});

test('an upstream 429 honours Retry-After and cools the provider', async (t) => {
  let now = 0;
  let fetchCalls = 0;
  const proxy = await startProxy(t, {
    clock: () => now,
    fetchFn: async () => {
      fetchCalls += 1;
      return new Response('limited', {
        status: 429,
        headers: { 'retry-after': '5', 'content-type': 'text/plain' },
      });
    },
  });
  const call = () => invoke(proxy.handler, '/v1/chat/completions', {
    model: 'fast',
    messages: [],
    max_tokens: 1,
  });
  const first = await call();
  assert.equal(first.status, 429);
  assert.equal(first.headers['retry-after'], '5');
  assert.equal(fetchCalls, 1);

  now = 4_999;
  assert.equal((await call()).status, 429);
  assert.equal(fetchCalls, 1);
  now = 5_000;
  assert.equal((await call()).status, 429);
  assert.equal(fetchCalls, 2);
});

test('streaming responses pass through with provider attribution', async (t) => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":7}}\n\n',
    'data: [DONE]\n\n',
  ];
  const proxy = await startProxy(t, {
    fetchFn: async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  });
  const response = await invoke(proxy.handler, '/v1/chat/completions', {
    model: 'fast',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    max_tokens: 20,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-free-llm-provider'], 'one');
  assert.equal(response.headers['x-free-llm-model'], 'one/chat');
  assert.equal(response.text, chunks.join(''));
});

test('embeddings use only providers configured for embeddings', async (t) => {
  let captured;
  const proxy = await startProxy(t, {
    fetchFn: async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1], index: 0 }],
        model: 'one/embed',
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const response = await invoke(proxy.handler, '/v1/embeddings', {
    model: 'one/embed',
    input: ['hello'],
    dimensions: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://one.invalid/v1/embeddings');
  assert.deepEqual(captured.body, {
    model: 'one/embed',
    input: ['hello'],
    dimensions: 1,
  });
});

test('models and health responses also carry attribution headers', async (t) => {
  const proxy = await startProxy(t, { fetchFn: async () => successfulChat() });
  const models = await invoke(proxy.handler, '/v1/models');
  assert.equal(models.status, 200);
  assert.equal(models.headers['x-free-llm-provider'], 'free-llm');
  const modelPayload = models.json();
  assert.ok(modelPayload.data.some((model) => model.id === 'fast'));

  const health = await invoke(proxy.handler, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.headers['x-free-llm-model'], 'none');
  assert.equal(health.json().status, 'ok');
});

test('an upstream that ignores AbortSignal still cannot hang the proxy', async (t) => {
  const proxy = await startProxy(t, {
    timeoutMs: 20,
    fetchFn: async () => new Promise(() => {}),
  });
  const started = Date.now();
  const response = await invoke(proxy.handler, '/v1/chat/completions', {
    model: 'fast',
    messages: [],
    max_tokens: 1,
  });
  assert.equal(response.status, 502);
  assert.ok(Date.now() - started < 250, 'timeout must produce a prompt response');
});
