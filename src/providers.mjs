import { DEFAULT_CONFIG } from './config.mjs';

const ONBOARDING = Object.freeze({
  openrouter: Object.freeze({
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    help: 'Sign in, then create a key under Settings → Keys.',
    actionUrl: 'https://openrouter.ai/settings/keys',
    cheapestModel: 'meta-llama/llama-3.3-8b-instruct:free',
  }),
  groq: Object.freeze({
    name: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    help: 'Sign in, then select API Keys → Create API Key.',
    actionUrl: 'https://console.groq.com/keys',
    cheapestModel: 'llama-3.1-8b-instant',
  }),
  google: Object.freeze({
    name: 'Google AI Studio',
    keyUrl: 'https://aistudio.google.com/apikey',
    help: 'Sign in, then select Get API key → Create API key.',
    actionUrl: 'https://aistudio.google.com/apikey',
    cheapestModel: 'gemini-2.5-flash-lite',
  }),
  cerebras: Object.freeze({
    name: 'Cerebras',
    keyUrl: 'https://cloud.cerebras.ai/',
    help: 'Sign in, then select API Keys → Create API Key.',
    actionUrl: 'https://cloud.cerebras.ai/',
    cheapestModel: 'llama3.1-8b',
  }),
  mistral: Object.freeze({
    name: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    help: 'Sign in, then create a key on the API Keys page.',
    actionUrl: 'https://console.mistral.ai/api-keys',
    cheapestModel: 'mistral-small-latest',
  }),
});

function cloneProvider(provider) {
  return {
    id: provider.id,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv,
    limits: { ...provider.limits },
    models: [...provider.models],
    supportsEmbeddings: provider.supportsEmbeddings,
  };
}

export const PROVIDERS = Object.freeze(DEFAULT_CONFIG.providers.map((provider) => {
  const onboarding = ONBOARDING[provider.id];
  return Object.freeze({
    ...cloneProvider(provider),
    ...onboarding,
  });
}));

export const PROVIDER_BY_ID = new Map(
  PROVIDERS.map((provider) => [provider.id, provider]),
);

export function providerDefinition(id, providers = PROVIDERS) {
  return providers.find((provider) => provider.id === id) ?? null;
}

export function recommendedProviders(providers = PROVIDERS) {
  return providers.map((provider) => ({
    ...provider,
    limits: { ...provider.limits },
    models: [...provider.models],
  }));
}

export function configuredAlias(providerId, aliases = DEFAULT_CONFIG.aliases) {
  return aliases['cheap-fast']?.[providerId] ?? null;
}
