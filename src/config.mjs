import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { configPath as defaultConfigPath } from './paths.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  providers: Object.freeze([
    Object.freeze({
      id: 'openrouter',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      limits: Object.freeze({ rpm: 20, rpd: 50, tpm: null }),
      models: Object.freeze(['*:free']),
      supportsEmbeddings: false,
    }),
    Object.freeze({
      id: 'groq',
      provider: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY',
      limits: Object.freeze({ rpm: 30, rpd: 14_400, tpm: 6_000 }),
      models: Object.freeze(['llama-3.1-8b-instant']),
      supportsEmbeddings: false,
    }),
    Object.freeze({
      id: 'google',
      provider: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKeyEnv: 'GOOGLE_AI_API_KEY',
      limits: Object.freeze({ rpm: 10, rpd: 250, tpm: 250_000 }),
      models: Object.freeze(['gemini-2.5-flash-lite', 'gemini-embedding-001']),
      supportsEmbeddings: true,
    }),
    Object.freeze({
      id: 'cerebras',
      provider: 'cerebras',
      baseUrl: 'https://api.cerebras.ai/v1',
      apiKeyEnv: 'CEREBRAS_API_KEY',
      limits: Object.freeze({ rpm: 30, rpd: 14_400, tpm: 60_000 }),
      models: Object.freeze(['llama3.1-8b']),
      supportsEmbeddings: false,
    }),
    Object.freeze({
      id: 'mistral',
      provider: 'mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKeyEnv: 'MISTRAL_API_KEY',
      limits: Object.freeze({ rpm: 1, rpd: 100, tpm: 1_000 }),
      models: Object.freeze(['mistral-small-latest', 'mistral-embed']),
      supportsEmbeddings: true,
    }),
  ]),
  aliases: Object.freeze({
    'cheap-fast': Object.freeze({
      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
      groq: 'llama-3.1-8b-instant',
      google: 'gemini-2.5-flash-lite',
      cerebras: 'llama3.1-8b',
      mistral: 'mistral-small-latest',
    }),
  }),
});

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function validateLimit(value, name, providerId) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Invalid provider "${providerId}": limits.${name} must be a positive integer or null`,
    );
  }
  return value;
}

function validateModels(value, providerId) {
  if (value == null) return [];
  if (
    !Array.isArray(value)
    || value.some((model) => typeof model !== 'string' || model.length === 0)
  ) {
    throw new Error(`Invalid provider "${providerId}": models must be an array of strings`);
  }
  return [...new Set(value)];
}

function validateProvider(raw, source, env) {
  requireObject(raw, `Invalid provider in ${source}: expected an object`);
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid provider in ${source}: "id" is required`);
  }
  if (Object.hasOwn(raw, 'apiKey') || Object.hasOwn(raw, 'apiKeys')) {
    throw new Error(
      `Invalid provider "${id}": inline API keys are forbidden; use apiKeyEnv`,
    );
  }
  if (typeof raw.apiKeyEnv !== 'string' || raw.apiKeyEnv.length === 0) {
    throw new Error(`Invalid provider "${id}": "apiKeyEnv" is required`);
  }
  if (typeof raw.baseUrl !== 'string' || raw.baseUrl.length === 0) {
    throw new Error(`Invalid provider "${id}": "baseUrl" is required`);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(raw.baseUrl);
  } catch {
    throw new Error(`Invalid provider "${id}": "baseUrl" must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Invalid provider "${id}": "baseUrl" must use HTTP or HTTPS`);
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error(
      `Invalid provider "${id}": "baseUrl" must not contain credentials, a query, or a fragment`,
    );
  }
  const limits = requireObject(
    raw.limits ?? {},
    `Invalid provider "${id}": limits must be an object`,
  );
  const provider = raw.provider ?? id;
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new Error(`Invalid provider "${id}": "provider" must be a non-empty string`);
  }
  const apiKey = env[raw.apiKeyEnv];
  return {
    id,
    provider,
    baseUrl: raw.baseUrl.replace(/\/+$/, ''),
    apiKeyEnv: raw.apiKeyEnv,
    apiKey: typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null,
    configured: typeof apiKey === 'string' && apiKey.length > 0,
    limits: {
      rpm: validateLimit(limits.rpm, 'rpm', id),
      rpd: validateLimit(limits.rpd, 'rpd', id),
      tpm: validateLimit(limits.tpm, 'tpm', id),
    },
    models: validateModels(raw.models, id),
    supportsEmbeddings: raw.supportsEmbeddings !== false,
  };
}

function validateAliases(rawAliases, providerIds, providerNames) {
  if (rawAliases == null) return {};
  requireObject(rawAliases, 'Invalid config: aliases must be an object');
  const aliases = {};
  for (const [alias, rawMapping] of Object.entries(rawAliases)) {
    if (!alias) throw new Error('Invalid config: alias names must not be empty');
    const mapping = requireObject(
      rawMapping,
      `Invalid alias "${alias}": expected a provider-to-model object`,
    );
    aliases[alias] = {};
    for (const [provider, model] of Object.entries(mapping)) {
      if (typeof model !== 'string' || model.length === 0) {
        throw new Error(`Invalid alias "${alias}": model for "${provider}" must be a string`);
      }
      if (!providerIds.has(provider) && !providerNames.has(provider)) {
        throw new Error(`Invalid alias "${alias}": unknown provider "${provider}"`);
      }
      aliases[alias][provider] = model;
    }
  }
  return aliases;
}

export function validateConfig(rawConfig, options = {}) {
  const source = options.source ?? 'configuration';
  const env = options.env ?? process.env;
  const raw = requireObject(rawConfig, `Invalid config in ${source}: expected an object`);
  if (!Array.isArray(raw.providers) || raw.providers.length === 0) {
    throw new Error(`Invalid config in ${source}: providers must be a non-empty array`);
  }
  const providers = raw.providers.map((provider) => validateProvider(provider, source, env));
  const ids = new Set();
  for (const provider of providers) {
    if (ids.has(provider.id)) {
      throw new Error(`Invalid config in ${source}: duplicate provider id "${provider.id}"`);
    }
    ids.add(provider.id);
  }
  const providerNames = new Set(providers.map((provider) => provider.provider));
  return {
    providers,
    aliases: validateAliases(raw.aliases, ids, providerNames),
    source,
  };
}

export async function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  const path = options.path ?? defaultConfigPath(env);
  let raw;
  let source = path;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      raw = DEFAULT_CONFIG;
      source = 'built-in defaults';
    } else if (error instanceof SyntaxError) {
      throw new Error(`Could not parse provider config ${path}: ${error.message}`, {
        cause: error,
      });
    } else {
      throw new Error(`Could not read provider config ${path}: ${error.message}`, {
        cause: error,
      });
    }
  }
  return validateConfig(raw, { env, source });
}

function serializableProvider(provider) {
  return {
    id: provider.id,
    provider: provider.provider ?? provider.id,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv,
    limits: { ...provider.limits },
    models: [...(provider.models ?? [])],
    supportsEmbeddings: provider.supportsEmbeddings !== false,
  };
}

export function configDocument(config) {
  return {
    providers: config.providers.map(serializableProvider),
    aliases: structuredClone(config.aliases ?? {}),
  };
}

export async function readConfigDocument(options = {}) {
  const path = options.path ?? defaultConfigPath(options.env);
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    validateConfig(raw, {
      env: options.env ?? process.env,
      source: path,
    });
    return raw;
  } catch (error) {
    if (error?.code === 'ENOENT') return { providers: [], aliases: {} };
    if (error instanceof SyntaxError) {
      throw new Error(`Could not parse provider config ${path}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function writeConfig(config, options = {}) {
  const path = options.path ?? defaultConfigPath(options.env);
  const document = configDocument(config);
  validateConfig(document, {
    env: options.env ?? process.env,
    source: path,
  });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return path;
}

export function publicConfig(config) {
  return {
    source: config.source,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKeyEnv: provider.apiKeyEnv,
      configured: provider.configured,
      limits: { ...provider.limits },
      models: [...provider.models],
      supportsEmbeddings: provider.supportsEmbeddings,
    })),
    aliases: structuredClone(config.aliases),
  };
}
