import { createServer } from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createRedactor } from './redact.mjs';
import { RequestLog } from './request-log.mjs';
import { listModels, resolveModel } from './models.mjs';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function upstreamHeader(response, name) {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name);
  const entries = response?.headers && typeof response.headers === 'object'
    ? Object.entries(response.headers)
    : [];
  return entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
}

function responseHeaders(response, redactor = null) {
  const headers = {};
  const safe = (value) => (
    redactor == null ? String(value) : redactor.string(String(value))
  );
  if (typeof response?.headers?.forEach === 'function') {
    response.headers.forEach((value, name) => {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers[name] = safe(value);
    });
  } else if (response?.headers && typeof response.headers === 'object') {
    for (const [name, value] of Object.entries(response.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers[name] = safe(value);
    }
  }
  return headers;
}

function attribution(provider = 'none', model = 'none') {
  return {
    'x-free-llm-provider': provider,
    'x-free-llm-model': model,
  };
}

function sendJson(response, status, body, headers = {}, source = attribution()) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
    ...source,
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function sendText(response, status, body, headers = {}, source = attribution()) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    ...headers,
    ...source,
  });
  response.end(body);
}

async function readJsonRequest(request, maxBodyBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new HttpError(413, `Request body exceeds ${maxBodyBytes} bytes`);
    }
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return parsed;
}

function withoutOutputLimits(body) {
  const {
    model: _model,
    max_tokens: _maxTokens,
    max_completion_tokens: _maxCompletionTokens,
    ...input
  } = body;
  return input;
}

export function estimateInputTokens(body) {
  // Every tokenizer token consumes at least one input byte. Counting the full
  // JSON representation therefore intentionally overestimates prompt tokens
  // without requiring a model-specific tokenizer dependency.
  return Math.max(1, Buffer.byteLength(JSON.stringify(withoutOutputLimits(body)), 'utf8'));
}

function declaredOutputTokens(body) {
  for (const value of [body.max_completion_tokens, body.max_tokens]) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

export function tokenCostForRequest(body, endpoint = 'chat') {
  const inputTokens = estimateInputTokens(body);
  if (endpoint === 'embeddings') return () => inputTokens;
  const outputTokens = declaredOutputTokens(body);
  return (provider) => {
    if (outputTokens != null) return inputTokens + outputTokens;
    // With no caller-supplied output bound, reserve the entire provider TPM
    // allowance. A successful non-streaming response refunds the difference
    // using its reported usage. This is conservative, but cannot overshoot.
    return provider.limits?.tpm == null
      ? inputTokens
      : Math.max(inputTokens, provider.limits.tpm);
  };
}

function actualTokens(payload) {
  const usage = payload?.usage;
  if (Number.isFinite(usage?.total_tokens) && usage.total_tokens >= 0) {
    return usage.total_tokens;
  }
  const sum = Number(usage?.prompt_tokens ?? 0) + Number(usage?.completion_tokens ?? 0);
  return Number.isFinite(sum) && sum > 0 ? sum : null;
}

function statusOf(response) {
  return Number(response?.status ?? 0);
}

function isOkay(response) {
  if (typeof response?.ok === 'boolean') return response.ok;
  const status = statusOf(response);
  return status >= 200 && status < 300;
}

async function responseText(response) {
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer()).toString('utf8');
  }
  throw new Error('Upstream response has no readable body');
}

class StreamUsageTracker {
  constructor() {
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.usage = null;
    this.events = 0;
  }

  push(chunk) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.consumeLines(false);
  }

  finish() {
    this.buffer += this.decoder.decode();
    this.consumeLines(true);
  }

  consumeLines(final) {
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = final ? '' : lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const payload = JSON.parse(data);
        this.events += 1;
        if (payload?.usage) this.usage = payload.usage;
      } catch {
        // A later complete event can still make the stream valid.
      }
    }
  }
}

class StreamRedactor {
  constructor(secrets) {
    this.secrets = [...new Set(secrets.filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    this.maximumLength = this.secrets.reduce(
      (maximum, secret) => Math.max(maximum, secret.length),
      0,
    );
    this.decoder = new TextDecoder();
    this.pending = '';
  }

  push(chunk) {
    this.pending += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish() {
    this.pending += this.decoder.decode();
    return this.drain(true);
  }

  drain(final) {
    const retained = final ? 0 : Math.max(0, this.maximumLength - 1);
    let output = '';
    while (this.pending.length > retained) {
      const secret = this.secrets.find((value) => this.pending.startsWith(value));
      if (secret) {
        output += '[REDACTED]';
        this.pending = this.pending.slice(secret.length);
      } else {
        output += this.pending[0];
        this.pending = this.pending.slice(1);
      }
    }
    return Buffer.from(output);
  }
}

function timeoutController(timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Upstream request timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  return { controller, timer, timeout };
}

function errorPayload(message, code = 'free_llm_error') {
  return {
    error: {
      message,
      type: code === 'free_llm_rate_limit' ? 'rate_limit_error' : 'proxy_error',
      code,
    },
  };
}

function outcomeForStatus(status) {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  if (status >= 400) return 'rejected';
  return 'ok';
}

function retryAfterFor(scheduler, providerIds, tokens) {
  return scheduler.nextRetry({ providerIds, tokens });
}

export function createProxyHandler(options) {
  const config = options?.config;
  const scheduler = options?.scheduler;
  if (!config || !scheduler) throw new Error('Proxy requires config and scheduler');
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('No fetch implementation is available');
  const clock = options.clock ?? Date.now;
  const logger = options.logger ?? console;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024;
  const redactor = options.redactor ?? createRedactor(
    config.providers.map((provider) => provider.apiKey),
  );
  const secretValues = config.providers
    .map((provider) => provider.apiKey)
    .filter(Boolean);
  const requestLog = options.requestLog ?? new RequestLog({
    env: options.env,
    redactor,
    clock,
  });

  async function log(entry) {
    try {
      await requestLog.append(entry);
    } catch (error) {
      logger.warn?.(redactor.string(`Could not write request log: ${error.message}`));
    }
  }

  async function proxyRequest(request, response, endpoint) {
    const body = await readJsonRequest(request, maxBodyBytes);
    if (typeof body.model !== 'string' || body.model.length === 0) {
      throw new HttpError(400, 'Request field "model" is required');
    }
    const requestedModel = body.model;
    const resolution = resolveModel(config, requestedModel, endpoint);
    if (!resolution.ok) {
      await log({
        provider: 'none',
        model: requestedModel,
        endpoint,
        latencyMs: 0,
        status: 429,
        outcome: 'no_provider',
      });
      sendJson(
        response,
        429,
        errorPayload(resolution.reason, 'free_llm_rate_limit'),
        { 'retry-after': '60' },
        attribution('none', requestedModel),
      );
      return;
    }

    const candidateById = new Map(
      resolution.candidates.map((candidate) => [candidate.provider.id, candidate]),
    );
    const candidateIds = [...candidateById.keys()];
    const attempted = new Set();
    const tokenCost = tokenCostForRequest(body, endpoint);
    let lastFailure = null;

    while (attempted.size < candidateIds.length) {
      const remainingIds = candidateIds.filter((providerId) => !attempted.has(providerId));
      const selected = await scheduler.select({ providerIds: remainingIds, tokens: tokenCost });
      if (!selected.ok) {
        if (lastFailure == null || remainingIds.length > 0) {
          await log({
            provider: 'none',
            model: requestedModel,
            endpoint,
            latencyMs: 0,
            status: 429,
            outcome: 'exhausted',
          });
          sendJson(
            response,
            429,
            errorPayload(
              `No provider is currently eligible for "${requestedModel}": ${selected.reason}`,
              'free_llm_rate_limit',
            ),
            { 'retry-after': String(selected.retryAfter) },
            attribution('none', requestedModel),
          );
          return;
        }
        break;
      }

      const candidate = candidateById.get(selected.provider.id);
      attempted.add(selected.provider.id);
      const upstreamBody = JSON.stringify({ ...body, model: candidate.model });
      const upstreamPath = endpoint === 'embeddings'
        ? '/embeddings'
        : '/chat/completions';
      const started = performance.now();
      const { controller, timer, timeout } = timeoutController(timeoutMs);
      let upstream;
      try {
        upstream = await Promise.race([
          fetchFn(`${selected.provider.baseUrl}${upstreamPath}`, {
            method: 'POST',
            headers: {
              accept: body.stream ? 'text/event-stream, application/json' : 'application/json',
              'content-type': 'application/json',
              authorization: `Bearer ${selected.provider.apiKey}`,
            },
            body: upstreamBody,
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch (error) {
        clearTimeout(timer);
        await scheduler.recordFailure(selected.provider.id, 'timeout-or-network');
        const latencyMs = Math.round(performance.now() - started);
        await log({
          provider: selected.provider.id,
          model: candidate.model,
          endpoint,
          latencyMs,
          status: 502,
          outcome: controller.signal.aborted ? 'timeout' : 'network_error',
          error: redactor.string(error?.message ?? 'Network error'),
        });
        lastFailure = {
          status: 502,
          body: JSON.stringify(errorPayload(
            `Provider "${selected.provider.id}" could not complete the request`,
          )),
          headers: { 'content-type': 'application/json; charset=utf-8' },
          provider: selected.provider.id,
          model: candidate.model,
        };
        continue;
      }

      const status = statusOf(upstream);
      const source = attribution(selected.provider.id, candidate.model);
      const isEventStream = body.stream === true
        && /^text\/event-stream\b/i.test(upstreamHeader(upstream, 'content-type') ?? '');

      if (isOkay(upstream) && isEventStream && upstream.body) {
        const tracker = new StreamUsageTracker();
        const streamRedactor = new StreamRedactor(secretValues);
        response.writeHead(status || 200, {
          ...responseHeaders(upstream, redactor),
          ...source,
        });
        let streamFailed = false;
        try {
          const iterator = upstream.body[Symbol.asyncIterator]();
          while (true) {
            const { value: rawChunk, done } = await Promise.race([
              iterator.next(),
              timeout,
            ]);
            if (done) break;
            const chunk = Buffer.from(rawChunk);
            tracker.push(chunk);
            const safeChunk = streamRedactor.push(chunk);
            if (safeChunk.length > 0 && !response.write(safeChunk)) {
              await once(response, 'drain');
            }
          }
          const finalChunk = streamRedactor.finish();
          if (finalChunk.length > 0 && !response.write(finalChunk)) {
            await once(response, 'drain');
          }
          tracker.finish();
          response.end();
          if (tracker.events === 0) {
            streamFailed = true;
            await scheduler.recordFailure(selected.provider.id, 'malformed-stream');
          } else {
            await scheduler.recordSuccess(selected.provider.id);
            const usage = actualTokens({ usage: tracker.usage });
            if (usage != null) {
              await scheduler.reconcileTokens(selected.provider.id, selected.tokenCost, usage);
            }
          }
        } catch (error) {
          streamFailed = true;
          if (!response.destroyed) response.destroy(error);
          await scheduler.recordFailure(selected.provider.id, 'stream-error');
          logger.warn?.(redactor.string(
            `Stream from provider "${selected.provider.id}" failed: ${error.message}`,
          ));
        } finally {
          clearTimeout(timer);
        }
        await log({
          provider: selected.provider.id,
          model: candidate.model,
          endpoint,
          latencyMs: Math.round(performance.now() - started),
          status: streamFailed ? 502 : (status || 200),
          outcome: streamFailed ? 'malformed_or_truncated_stream' : 'ok',
        });
        return;
      }

      let text;
      try {
        text = await Promise.race([responseText(upstream), timeout]);
      } catch (error) {
        clearTimeout(timer);
        await scheduler.recordFailure(selected.provider.id, 'unreadable-body');
        await log({
          provider: selected.provider.id,
          model: candidate.model,
          endpoint,
          latencyMs: Math.round(performance.now() - started),
          status: 502,
          outcome: 'unreadable_body',
          error: redactor.string(error.message),
        });
        lastFailure = {
          status: 502,
          body: JSON.stringify(errorPayload(
            `Provider "${selected.provider.id}" returned an unreadable body`,
          )),
          headers: { 'content-type': 'application/json; charset=utf-8' },
          provider: selected.provider.id,
          model: candidate.model,
        };
        continue;
      } finally {
        clearTimeout(timer);
      }
      const safeText = redactor.string(text);
      const latencyMs = Math.round(performance.now() - started);

      if (status === 429) {
        const rateLimit = await scheduler.recordRateLimit(
          selected.provider.id,
          upstreamHeader(upstream, 'retry-after'),
        );
        await log({
          provider: selected.provider.id,
          model: candidate.model,
          endpoint,
          latencyMs,
          status,
          outcome: 'rate_limited',
        });
        lastFailure = {
          status,
          body: safeText,
          headers: {
            ...responseHeaders(upstream, redactor),
            'retry-after': String(rateLimit.retryAfter),
          },
          provider: selected.provider.id,
          model: candidate.model,
        };
        continue;
      }

      if (status >= 500) {
        await scheduler.recordFailure(selected.provider.id, `http-${status}`);
        await log({
          provider: selected.provider.id,
          model: candidate.model,
          endpoint,
          latencyMs,
          status,
          outcome: 'upstream_error',
        });
        lastFailure = {
          status,
          body: safeText,
          headers: responseHeaders(upstream, redactor),
          provider: selected.provider.id,
          model: candidate.model,
        };
        continue;
      }

      let payload = null;
      if (isOkay(upstream)) {
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          await scheduler.recordFailure(selected.provider.id, 'malformed-json');
          await log({
            provider: selected.provider.id,
            model: candidate.model,
            endpoint,
            latencyMs,
            status: 502,
            outcome: 'malformed_body',
          });
          lastFailure = {
            status: 502,
            body: JSON.stringify(errorPayload(
              `Provider "${selected.provider.id}" returned malformed JSON`,
            )),
            headers: { 'content-type': 'application/json; charset=utf-8' },
            provider: selected.provider.id,
            model: candidate.model,
          };
          continue;
        }
      }

      await scheduler.recordSuccess(selected.provider.id);
      if (payload != null) {
        const usage = actualTokens(payload);
        if (usage != null) {
          await scheduler.reconcileTokens(selected.provider.id, selected.tokenCost, usage);
        }
      }
      await log({
        provider: selected.provider.id,
        model: candidate.model,
        endpoint,
        latencyMs,
        status,
        outcome: outcomeForStatus(status),
      });
      sendText(
        response,
        status || 200,
        safeText,
        responseHeaders(upstream, redactor),
        source,
      );
      return;
    }

    if (lastFailure?.status === 429) {
      lastFailure.headers['retry-after'] = String(
        retryAfterFor(scheduler, candidateIds, tokenCost),
      );
    }
    if (lastFailure) {
      sendText(
        response,
        lastFailure.status,
        lastFailure.body,
        lastFailure.headers,
        attribution(lastFailure.provider, lastFailure.model),
      );
      return;
    }
    sendJson(
      response,
      429,
      errorPayload(
        `No provider is currently eligible for "${requestedModel}"`,
        'free_llm_rate_limit',
      ),
      { 'retry-after': String(retryAfterFor(scheduler, candidateIds, tokenCost)) },
      attribution('none', requestedModel),
    );
  }

  return async function proxyHandler(request, response) {
    try {
      const url = new URL(request.url, 'http://free-llm.local');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, {
          status: 'ok',
          providers: scheduler.status(),
        }, {}, attribution('free-llm', 'none'));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(response, 200, {
          object: 'list',
          data: listModels(config).map((model) => ({
            id: model.id,
            object: 'model',
            created: 0,
            owned_by: 'free-llm',
            providers: model.providers,
            alias: model.alias,
          })),
        }, {}, attribution('free-llm', 'none'));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        await proxyRequest(request, response, 'chat');
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/embeddings') {
        await proxyRequest(request, response, 'embeddings');
        return;
      }
      sendJson(
        response,
        404,
        errorPayload(`No route for ${request.method} ${url.pathname}`, 'not_found'),
        {},
        attribution('free-llm', 'none'),
      );
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = redactor.string(
        error instanceof HttpError ? error.message : 'Internal proxy error',
      );
      if (!(error instanceof HttpError)) {
        logger.error?.(redactor.string(`Proxy error: ${error?.message ?? error}`));
      }
      sendJson(
        response,
        status,
        errorPayload(message, status >= 500 ? 'internal_error' : 'invalid_request'),
        {},
        attribution('free-llm', 'none'),
      );
    }
  };
}

export function createProxyServer(options) {
  const server = createServer(createProxyHandler(options));
  server.requestTimeout = options.requestTimeoutMs ?? 30_000;
  server.headersTimeout = options.headersTimeoutMs ?? 15_000;
  return server;
}

export async function listen(server, options = {}) {
  const port = options.port ?? 8080;
  const host = options.host ?? '127.0.0.1';
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  return server.address();
}
