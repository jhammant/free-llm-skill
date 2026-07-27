import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { observedLimitsPath as defaultObservedLimitsPath } from './paths.mjs';

const LIMIT_NAMES = ['rpm', 'rpd', 'tpm'];

function observedEntry(value) {
  if (Number.isSafeInteger(value) && value > 0) {
    return { limit: value, observedAt: null, source: 'observed' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const limit = value.limit ?? value.value;
  if (!Number.isSafeInteger(limit) || limit <= 0) return null;
  return {
    ...value,
    limit,
    observedAt: value.observedAt ?? value.timestamp ?? null,
    source: value.source ?? 'observed',
  };
}

export function normalizeObservedLimits(raw) {
  const source = raw?.providers ?? raw ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const providers = {};
  for (const [providerId, rawLimits] of Object.entries(source)) {
    if (!rawLimits || typeof rawLimits !== 'object' || Array.isArray(rawLimits)) continue;
    const values = rawLimits.limits && typeof rawLimits.limits === 'object'
      ? rawLimits.limits
      : rawLimits;
    const normalized = {};
    for (const name of LIMIT_NAMES) {
      const entry = observedEntry(values[name]);
      if (entry) {
        normalized[name] = {
          ...entry,
          observedAt: entry.observedAt
            ?? rawLimits.observedAt
            ?? rawLimits.timestamp
            ?? null,
        };
      }
    }
    if (Object.keys(normalized).length > 0) providers[providerId] = normalized;
  }
  return providers;
}

export async function loadObservedLimits(options = {}) {
  const path = options.path ?? defaultObservedLimitsPath(options.env);
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return {
      version: raw.version ?? 1,
      providers: normalizeObservedLimits(raw),
      path,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, providers: {}, path };
    if (error instanceof SyntaxError) {
      throw new Error(`Could not parse observed limits ${path}: ${error.message}`, {
        cause: error,
      });
    }
    throw new Error(`Could not read observed limits ${path}: ${error.message}`, {
      cause: error,
    });
  }
}

export async function writeObservedLimit(providerId, name, limit, options = {}) {
  if (!LIMIT_NAMES.includes(name)) throw new Error(`Unknown observed limit "${name}"`);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`Observed ${name} must be a positive integer`);
  }
  const path = options.path ?? defaultObservedLimitsPath(options.env);
  const current = options.current ?? await loadObservedLimits({ path });
  const timestamp = new Date((options.clock ?? Date.now)()).toISOString();
  const document = {
    version: 1,
    providers: {
      ...current.providers,
      [providerId]: {
        ...(current.providers[providerId] ?? {}),
        [name]: {
          limit,
          observedAt: timestamp,
          source: options.source ?? 'probe',
          ...(options.details ?? {}),
        },
      },
    },
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return document.providers[providerId][name];
}

export function applyObservedLimits(providers, observed) {
  const normalized = normalizeObservedLimits(observed?.providers ?? observed);
  return providers.map((provider) => {
    const configuredLimits = {
      rpm: provider.limits?.rpm ?? null,
      rpd: provider.limits?.rpd ?? null,
      tpm: provider.limits?.tpm ?? null,
    };
    const entries = normalized[provider.id] ?? {};
    const observedLimits = Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [name, { ...entry }]),
    );
    const limits = { ...configuredLimits };
    for (const name of LIMIT_NAMES) {
      if (entries[name]) limits[name] = entries[name].limit;
    }
    return {
      ...provider,
      limits,
      configuredLimits,
      observedLimits,
    };
  });
}
