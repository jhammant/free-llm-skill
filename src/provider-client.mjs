import { performance } from 'node:perf_hooks';

function header(response, name) {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name);
  const entries = response?.headers && typeof response.headers === 'object'
    ? Object.entries(response.headers)
    : [];
  return entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
}

export function responseStatus(response) {
  return Number(response?.status ?? 0);
}

export function responseOkay(response) {
  if (typeof response?.ok === 'boolean') return response.ok;
  const status = responseStatus(response);
  return status >= 200 && status < 300;
}

async function responseText(response) {
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer()).toString('utf8');
  }
  return '';
}

export async function readResponseText(response, timeoutMs = null) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return responseText(response);
  let timer;
  try {
    return await Promise.race([
      responseText(response),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`response body timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function messageFromBody(text) {
  if (!text) return '';
  try {
    const payload = JSON.parse(text);
    const message = payload?.error?.message
      ?? payload?.message
      ?? payload?.error_description
      ?? payload?.detail;
    if (typeof message === 'string') return message.replace(/\s+/g, ' ').trim();
  } catch {
    // Plain text below gives a more useful provider-specific reason.
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function httpReason(status, text = '') {
  const detail = messageFromBody(text);
  const suffix = detail ? ` — ${detail}` : '';
  if (status === 401) return `401 unauthorized — key rejected${suffix}`;
  if (status === 403) return `403 forbidden — key lacks access${suffix}`;
  if (status === 404) return `404 not found — check the provider base URL or model${suffix}`;
  if (status === 429) return `429 rate limited${suffix}`;
  if (status >= 500) return `${status} provider error${suffix}`;
  if (status >= 400) return `${status} request rejected${suffix}`;
  if (status === 0) return `network error${suffix}`;
  return `${status}${suffix}`;
}

export async function providerRequest(provider, path, options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('No fetch implementation is available');
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`request timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${options.apiKey ?? provider.apiKey}`,
    ...(options.body == null ? {} : { 'content-type': 'application/json' }),
  };
  const started = performance.now();
  try {
    const response = await Promise.race([
      fetchFn(`${provider.baseUrl}${path}`, {
        method: options.method ?? (options.body == null ? 'GET' : 'POST'),
        headers,
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      }),
      timeout,
    ]);
    return {
      response,
      status: responseStatus(response),
      latencyMs: Math.round(performance.now() - started),
      retryAfter: header(response, 'retry-after'),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function modelIds(payload) {
  const data = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(data)) return [];
  return [...new Set(data.map((model) => (
    typeof model === 'string' ? model : model?.id
  )).filter((id) => typeof id === 'string' && id.length > 0))];
}

function globMatches(pattern, value) {
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function configuredModelSet(provider, models) {
  const selectors = (provider.models ?? []).filter((model) => model.includes('*'));
  if (selectors.length === 0) return models;
  return models.filter((model) => selectors.some((selector) => globMatches(selector, model)));
}

function modelScore(model) {
  const lower = model.toLowerCase();
  let score = 100;
  if (/embed/.test(lower)) score += 10_000;
  if (/flash-lite|instant|small|mini|nano/.test(lower)) score -= 40;
  if (/:free$/.test(lower)) score -= 30;
  const size = lower.match(/(?:^|[-_/])(\d+(?:\.\d+)?)b(?:[-_/]|$)/)?.[1];
  if (size) score += Number(size);
  return score;
}

export function cheapestModel(provider, models = provider.models ?? []) {
  const concrete = models.filter((model) => (
    typeof model === 'string' && !model.includes('*') && !/embed/i.test(model)
  ));
  if (provider.cheapestModel && concrete.includes(provider.cheapestModel)) {
    return provider.cheapestModel;
  }
  const configured = (provider.models ?? []).find((model) => (
    concrete.includes(model) && !/embed/i.test(model)
  ));
  if (configured) return configured;
  return [...concrete].sort((left, right) => (
    modelScore(left) - modelScore(right) || left.localeCompare(right)
  ))[0] ?? null;
}

export async function listProviderModels(provider, options = {}) {
  let request;
  try {
    request = await providerRequest(provider, '/models', options);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: `network error — ${error.message}`,
      latencyMs: null,
      models: [],
      retryAfter: null,
    };
  }
  let text;
  try {
    text = await readResponseText(request.response, options.timeoutMs ?? 10_000);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: `network error — ${error.message}`,
      latencyMs: request.latencyMs,
      models: [],
      retryAfter: null,
    };
  }
  if (!responseOkay(request.response)) {
    return {
      ok: false,
      status: request.status,
      reason: httpReason(request.status, text),
      latencyMs: request.latencyMs,
      models: [],
      retryAfter: request.retryAfter,
      errorBody: text,
    };
  }
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      status: request.status,
      reason: 'provider returned malformed JSON from /models',
      latencyMs: request.latencyMs,
      models: [],
      retryAfter: null,
    };
  }
  return {
    ok: true,
    status: request.status || 200,
    reason: 'working',
    latencyMs: request.latencyMs,
    models: modelIds(payload),
    retryAfter: null,
  };
}

export async function validateProviderKey(provider, apiKey, options = {}) {
  const listed = await listProviderModels(provider, { ...options, apiKey });
  if (!listed.ok) return listed;
  const models = configuredModelSet(provider, listed.models);
  const model = cheapestModel(provider, models);
  if (!model) {
    return {
      ...listed,
      ok: false,
      models,
      reason: 'no configured free-tier chat model was returned by /models',
    };
  }
  let request;
  try {
    request = await providerRequest(provider, '/chat/completions', {
      ...options,
      apiKey,
      method: 'POST',
      body: {
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      },
    });
  } catch (error) {
    return {
      ...listed,
      ok: false,
      status: 0,
      reason: `network error — ${error.message}`,
      model,
      models,
    };
  }
  let text;
  try {
    text = await readResponseText(request.response, options.timeoutMs ?? 10_000);
  } catch (error) {
    return {
      ...listed,
      ok: false,
      status: 0,
      reason: `network error — ${error.message}`,
      latencyMs: request.latencyMs,
      model,
      models,
    };
  }
  if (!responseOkay(request.response)) {
    return {
      ...listed,
      ok: false,
      status: request.status,
      reason: httpReason(request.status, text),
      latencyMs: request.latencyMs,
      model,
      models,
      retryAfter: request.retryAfter,
      errorBody: text,
    };
  }
  return {
    ...listed,
    ok: true,
    status: request.status || 200,
    reason: 'working',
    latencyMs: request.latencyMs,
    model,
    models,
  };
}
