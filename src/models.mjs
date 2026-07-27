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
