function globMatches(pattern, value) {
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function mappingFor(alias, provider) {
  return alias?.[provider.id] ?? alias?.[provider.provider] ?? null;
}

function supportsEndpoint(provider, endpoint) {
  return endpoint !== 'embeddings' || provider.supportsEmbeddings;
}

export function resolveModel(config, requestedModel, endpoint = 'chat') {
  const alias = config.aliases[requestedModel];
  const candidates = [];
  const unavailable = [];

  for (const provider of config.providers) {
    if (!supportsEndpoint(provider, endpoint)) continue;
    const concreteModel = alias
      ? mappingFor(alias, provider)
      : (provider.models.some((pattern) => globMatches(pattern, requestedModel))
        ? requestedModel
        : null);
    if (!concreteModel) continue;
    if (!provider.configured) {
      unavailable.push(`${provider.id} (${provider.apiKeyEnv} is unset)`);
      continue;
    }
    candidates.push({ provider, model: concreteModel });
  }

  if (candidates.length > 0) {
    return { ok: true, alias: Boolean(alias), candidates };
  }
  if (alias) {
    const detail = unavailable.length > 0
      ? `; unavailable: ${unavailable.join(', ')}`
      : '';
    return {
      ok: false,
      reason: `Alias "${requestedModel}" has no usable provider${detail}`,
    };
  }
  return {
    ok: false,
    reason: `Model "${requestedModel}" is not offered by any usable provider`,
  };
}

export function listModels(config) {
  const byModel = new Map();
  const add = (id, providerId, alias = false) => {
    if (!byModel.has(id)) byModel.set(id, { id, providers: [], alias });
    const item = byModel.get(id);
    if (!item.providers.includes(providerId)) item.providers.push(providerId);
    item.alias ||= alias;
  };

  for (const provider of config.providers.filter((candidate) => candidate.configured)) {
    for (const model of provider.models) {
      if (!model.includes('*')) add(model, provider.id);
    }
  }
  for (const [name, mapping] of Object.entries(config.aliases)) {
    for (const provider of config.providers.filter((candidate) => candidate.configured)) {
      const concrete = mappingFor(mapping, provider);
      if (concrete) {
        add(name, provider.id, true);
        add(concrete, provider.id);
      }
    }
  }

  return [...byModel.values()]
    .map((model) => ({ ...model, providers: model.providers.sort() }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

// ── live catalogue ────────────────────────────────────────────────────────────
//
// The configured model list is a hypothesis. Providers retire free models
// constantly — probing OpenRouter with a real key once failed with
// "404 No endpoints found for meta-llama/llama-3.3-8b-instruct:free" because
// that model had been withdrawn. So ask each provider what it actually serves.

const AUTO_ROUTER = /(^|\/)(auto|router|fusion|pareto)(-|:|$)/i;

// CRITICAL: pricing.prompt === "0" does NOT mean free.
// Measured live: openrouter/auto-beta advertises prompt price 0 and a real
// completion billed 3.913e-06 — it is an auto-router that charges whatever it
// routes to. Getting this wrong means silently spending money in a tool whose
// entire purpose is not spending money.
export function isFreeModel(model) {
  const id = String(model?.id ?? '');
  if (/:free$/i.test(id)) return true;
  if (AUTO_ROUTER.test(id)) return false; // bills downstream regardless of quoted price
  const p = model?.pricing ?? {};
  const fields = ['prompt', 'completion', 'request'].map((k) => p[k]).filter((v) => v != null);
  if (fields.length === 0) return false; // no pricing published — do not assume free
  return fields.every((v) => Number(v) === 0);
}

export async function fetchLiveModels(provider, options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') return { provider: provider.id, models: [], note: 'no fetch' };
  try {
    const response = await fetchFn(`${provider.baseUrl}/models`, {
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response?.ok) {
      return { provider: provider.id, models: [], note: `HTTP ${response?.status ?? '?'}` };
    }
    const body = await response.json();
    const raw = Array.isArray(body?.data) ? body.data : [];
    return {
      provider: provider.id,
      models: raw
        .filter((m) => typeof m?.id === 'string')
        .map((m) => ({ id: m.id, free: isFreeModel(m), contextLength: m.context_length ?? null })),
      note: null,
    };
  } catch (error) {
    // Optional enrichment: an unreachable provider is skipped, never fatal.
    return { provider: provider.id, models: [], note: error?.name ?? 'unreachable' };
  }
}
