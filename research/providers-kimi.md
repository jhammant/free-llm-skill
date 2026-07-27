# Free-tier LLM API providers (no payment details required)

Researched and compiled **2026-07-27** against official provider documentation where reachable, with third-party trackers used only as corroboration (flagged inline).

**How to read this file:**

- Free tiers change constantly. Every figure not confirmed on an official docs page on 2026-07-27 is marked **`UNVERIFIED — check provider docs`**, with a last-known-good date where one exists. Treat even "verified" numbers as perishable.
- **One honest key per provider.** Nothing here requires or suggests holding multiple accounts at one provider; that violates terms of service everywhere and is not a throughput strategy.
- Providers whose free tier **trains on your data** are flagged with ⚠️ **TRAINS ON FREE DATA**.
- Unofficial reverse-proxy / key-sharing services are **not in the ranked list** — they are quarantined under **DO NOT USE** at the bottom, with reasons.
- Ordering: first-party providers with generous, well-documented, ongoing free tiers first; credit-based trials next; dead or no-free-tier providers last (listed only so stale guides can be corrected).

---

## Tier 1 — Genuine ongoing free tiers, first-party, no card required

### 1. Groq (GroqCloud)

| field | value |
|---|---|
| id | `groq` |
| display name | GroqCloud |
| base URL | `https://api.groq.com/openai/v1` |
| OpenAI-compatible | yes |
| API key env var | `GROQ_API_KEY` |
| rate limits (verified 2026-07-27, official) | per model, org-level: `llama-3.1-8b-instant` 30 RPM / 14,400 RPD / 6K TPM / 500K TPD; `llama-3.3-70b-versatile` 30 RPM / 1,000 RPD / 12K TPM / 100K TPD; `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen/qwen3.6-27b` 30 RPM / 1,000 RPD / 8K TPM / 200K TPD; `groq/compound(-mini)` 30 RPM / 250 RPD / 70K TPM |
| free models | all models on the free on-demand tier (Llama 3.x, gpt-oss, Qwen, compound, Whisper) |
| credit card required | no |
| restrictions | limits are per-organization; daily quota resets ~midnight UTC (`UNVERIFIED — check provider docs`, secondary source); 429s carry `retry-after` and `x-ratelimit-*` headers; no training on API data per privacy policy (`UNVERIFIED — check provider docs`) |

```json
{
  "id": "groq",
  "display_name": "GroqCloud",
  "base_url": "https://api.groq.com/openai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "GROQ_API_KEY",
  "free_tier": {
    "requests_per_minute": 30,
    "requests_per_day": "1000-14400 (per model)",
    "tokens_per_minute": "6000-70000 (per model)",
    "verified": "2026-07-27 (official docs)",
    "free_models": ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b", "groq/compound", "whisper-large-v3"],
    "credit_card_required": false,
    "trains_on_free_data": false,
    "restrictions": "org-level limits; daily reset ~midnight UTC (unverified); retry-after headers on 429"
  }
}
```

### 2. NVIDIA NIM (build.nvidia.com)

| field | value |
|---|---|
| id | `nvidia` |
| display name | NVIDIA NIM / build.nvidia.com |
| base URL | `https://integrate.api.nvidia.com/v1` |
| OpenAI-compatible | yes |
| API key env var | `NVIDIA_API_KEY` |
| rate limits | ~40 RPM, no published daily/token cap — **`UNVERIFIED — check provider docs`** (NVIDIA publishes no fixed number; third-party trackers, July 2026; some accounts still show a 1,000-credit system per NVIDIA forums, June 2026 — conflicting) |
| free models | 100+ hosted open models (Llama, DeepSeek, Nemotron, Qwen, GLM, Kimi, MiniMax…) |
| credit card required | no (free NVIDIA Developer Program signup) |
| restrictions | development/prototyping terms only, no SLA; model roster rotates |

```json
{
  "id": "nvidia",
  "display_name": "NVIDIA NIM / build.nvidia.com",
  "base_url": "https://integrate.api.nvidia.com/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "NVIDIA_API_KEY",
  "free_tier": {
    "requests_per_minute": "40 (UNVERIFIED — check provider docs; not officially published)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "third-party trackers, July 2026",
    "free_models": "100+ open models (Llama, DeepSeek, Nemotron, Qwen, GLM, Kimi, MiniMax)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "prototyping-only terms, no SLA, models rotate"
  }
}
```

### 3. Google AI Studio / Gemini API

⚠️ **TRAINS ON FREE DATA** — free-tier prompts and responses are used to improve Google products (human review possible) per the Gemini API Additional Terms. Exception: EEA/UK/CH users get paid-tier data terms on all usage.

| field | value |
|---|---|
| id | `gemini` |
| display name | Google Gemini API (AI Studio) |
| base URL | native `https://generativelanguage.googleapis.com/v1beta/`; OpenAI-compat shim `https://generativelanguage.googleapis.com/v1beta/openai/` |
| OpenAI-compatible | partial (official OpenAI-compatibility endpoint covers chat completions + embeddings; some Gemini features need the native API) |
| API key env var | `GEMINI_API_KEY` (also `GOOGLE_API_KEY`) |
| rate limits | **no longer published as a static table** — limits depend on tier/model/account state and must be read in AI Studio (official rate-limits page, verified 2026-07-27). Dimensions are RPM + TPM(input) + RPD; RPD resets **midnight Pacific Time** |
| free models | Flash-class models (Gemini 3.5 Flash, Flash-Lite class); Pro-class moved to paid-only ~April 2026 (`UNVERIFIED — check provider docs`, secondary); exact free roster visible in AI Studio |
| credit card required | no (Google account; adding billing moves you to Tier 1) |
| restrictions | ⚠️ trains on free data (see above); limits are per-**project**, not per-key (extra keys share one quota) |

```json
{
  "id": "gemini",
  "display_name": "Google Gemini API (AI Studio)",
  "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
  "native_base_url": "https://generativelanguage.googleapis.com/v1beta/",
  "openai_compatible": "partial",
  "api_key_env_var": "GEMINI_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (no longer published; view in AI Studio)",
    "requests_per_day": "unknown (resets midnight Pacific Time)",
    "tokens_per_minute": "unknown",
    "verified": "2026-07-27 (official page confirms limits exist but not numbers)",
    "free_models": "Flash-class Gemini models; exact roster in AI Studio",
    "credit_card_required": false,
    "trains_on_free_data": true,
    "restrictions": "free-tier data used for training (except EEA/UK/CH); per-project quota"
  }
}
```

### 4. OpenRouter (including `:free` model variants)

| field | value |
|---|---|
| id | `openrouter` |
| display name | OpenRouter |
| base URL | `https://openrouter.ai/api/v1` |
| OpenAI-compatible | yes |
| API key env var | `OPENROUTER_API_KEY` |
| rate limits | `:free` variants: **20 RPM**; **50 req/day** if lifetime credit purchases < $10, **1,000 req/day** once ≥ $10 ever purchased — **`UNVERIFIED — check provider docs`** (docs structure verified 2026-07-27; exact digits corroborated by FAQ snippet + multiple July-2026 secondary sources but not readable on the live page) |
| free models | all model IDs ending in `:free` (~18–20 models, e.g. Llama 3.3 70B, gpt-oss-20b, Gemma, Nemotron variants) plus the `openrouter/free` auto-router; roster changes without notice |
| credit card required | no (the $10 purchase only raises the daily cap and is optional) |
| restrictions | aggregator, not a model owner: free variants get lower routing priority; free models may route through upstream providers that log/train on data — set account privacy routing preferences; no queuing on 429 (client retries); daily usage tracked per UTC day |

```json
{
  "id": "openrouter",
  "display_name": "OpenRouter",
  "base_url": "https://openrouter.ai/api/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "OPENROUTER_API_KEY",
  "free_tier": {
    "requests_per_minute": "20 (UNVERIFIED — check provider docs)",
    "requests_per_day": "50 (or 1000 if $10+ ever purchased) (UNVERIFIED — check provider docs)",
    "tokens_per_minute": "unknown",
    "verified": "structure 2026-07-27; numbers corroborated July 2026",
    "free_models": "all ':free' model IDs + openrouter/free auto-router; roster rotates",
    "credit_card_required": false,
    "trains_on_free_data": "upstream-provider dependent; configure privacy routing",
    "restrictions": "lower routing priority on free variants; client must retry on 429"
  }
}
```

### 5. Cloudflare Workers AI

| field | value |
|---|---|
| id | `cloudflare` |
| display name | Cloudflare Workers AI |
| base URL | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` |
| OpenAI-compatible | yes (also native REST and Workers bindings) |
| API key env var | `CLOUDFLARE_API_TOKEN` (plus `CLOUDFLARE_ACCOUNT_ID`) |
| rate limits (verified 2026-07-27, official) | **10,000 Neurons/day** free (Neuron = abstract billing unit; roughly 0.3–1M tokens/day depending on model), resets **00:00 UTC**; text generation **300 RPM** default (per-model variations) |
| free models | whole non-beta catalog counts against the allocation (Llama, gpt-oss-120b/20b, Qwen, GLM, Kimi, Gemma, Mistral, embeddings, Whisper, image models) |
| credit card required | no (free Cloudflare account; hard stop at 10k neurons/day) |
| restrictions | neuron budget is shared across all models and task types per day — the daily token budget, not the RPM, is the real constraint |

```json
{
  "id": "cloudflare",
  "display_name": "Cloudflare Workers AI",
  "base_url": "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "CLOUDFLARE_API_TOKEN",
  "free_tier": {
    "requests_per_minute": "300 (verified 2026-07-27, official)",
    "requests_per_day": "capped by 10,000 Neurons/day, resets 00:00 UTC (verified 2026-07-27, official)",
    "tokens_per_minute": "unknown",
    "verified": "2026-07-27 (official docs)",
    "free_models": "full non-beta catalog (Llama, gpt-oss, Qwen, GLM, Kimi, Gemma, Mistral, Whisper, embeddings)",
    "credit_card_required": false,
    "trains_on_free_data": false,
    "restrictions": "neuron budget shared across models/task types; hard daily stop"
  }
}
```

### 6. GitHub Models

| field | value |
|---|---|
| id | `github-models` |
| display name | GitHub Models |
| base URL | `https://models.github.ai/inference` |
| OpenAI-compatible | yes (OpenAI SDK and Azure AI Inference SDK) |
| API key env var | `GITHUB_TOKEN` (PAT with `models:read` scope) |
| rate limits (verified 2026-07-27, official, Copilot Free column) | low-tier models 15 RPM / 150 RPD; high-tier models 10 RPM / 50 RPD; embeddings 15 RPM / 150 RPD; DeepSeek-R1 1 RPM / 8 RPD; Grok-3 1 RPM / 15 RPD; all with 8K-in/4K-out per-request caps and low concurrency (2–5); "subject to change without notice" |
| free models | marketplace catalog within tiers: gpt-4o/4o-mini class, Llama, Mistral, DeepSeek-R1, xAI Grok-3, Phi/MAI (o1/o3/gpt-5 families not on Copilot Free) |
| credit card required | no (any GitHub account) |
| restrictions | explicitly prototyping/experimentation only, not production; public preview; per-request token caps are the practical ceiling; requests proxied via Azure AI Foundry to each model publisher under publisher terms |

```json
{
  "id": "github-models",
  "display_name": "GitHub Models",
  "base_url": "https://models.github.ai/inference",
  "openai_compatible": "yes",
  "api_key_env_var": "GITHUB_TOKEN",
  "free_tier": {
    "requests_per_minute": "15 (low-tier) / 10 (high-tier) / 1 (DeepSeek-R1, Grok-3)",
    "requests_per_day": "150 (low) / 50 (high) / 8-15 (R1, Grok)",
    "tokens_per_minute": "unknown (per-request caps: 8K in / 4K out)",
    "verified": "2026-07-27 (official docs)",
    "free_models": "marketplace catalog: gpt-4o class, Llama, Mistral, DeepSeek-R1, Grok-3, Phi/MAI",
    "credit_card_required": false,
    "trains_on_free_data": "no per historical docs (UNVERIFIED — check provider docs; subject to each publisher's terms)",
    "restrictions": "prototyping-only ToS; public preview; low concurrency; 8K/4K per-request token caps"
  }
}
```

### 7. Z.AI / Zhipu (GLM)

| field | value |
|---|---|
| id | `zai` |
| display name | Z.AI / Zhipu AI (GLM) |
| base URL | `https://api.z.ai/api/paas/v4/` (international); China: `https://open.bigmodel.cn/api/paas/v4/` |
| OpenAI-compatible | yes |
| API key env var | `ZAI_API_KEY` |
| rate limits (verified 2026-07-27, official) | three Flash models priced **$0** (GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash); limits are **concurrency-based**, not RPM/TPM — free accounts get lower concurrency; Flash requests with context >8K tokens throttled to 1% of standard concurrency under load; exact free concurrency numbers not published (`UNVERIFIED — check provider docs`; third parties suggest 1–3 concurrent, Jan 2026) |
| free models | GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash (vision) |
| credit card required | no (email/Google/GitHub signup on z.ai) |
| restrictions | z.ai (international) and bigmodel.cn (China) are separate accounts/keys; bigmodel.cn needs a +86 phone (`UNVERIFIED`); operated from China — data-residency caveat; no throughput SLA; training-data policy unknown |

```json
{
  "id": "zai",
  "display_name": "Z.AI / Zhipu AI (GLM)",
  "base_url": "https://api.z.ai/api/paas/v4/",
  "openai_compatible": "yes",
  "api_key_env_var": "ZAI_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (concurrency-based limits, numbers not published)",
    "requests_per_day": "unknown (no published daily cap)",
    "tokens_per_minute": "unknown",
    "verified": "2026-07-27 (official pricing page: $0 Flash models; rate-limit page: concurrency-based)",
    "free_models": ["GLM-4.7-Flash", "GLM-4.5-Flash", "GLM-4.6V-Flash"],
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "long-context (>8K) Flash requests throttled to 1% concurrency under load; China vs international account split; China data residency"
  }
}
```

### 8. ModelScope (Alibaba's model community)

| field | value |
|---|---|
| id | `modelscope` |
| display name | ModelScope (魔搭) API-Inference |
| base URL | `https://api-inference.modelscope.cn/v1/` (China); international presumably `https://api-inference.modelscope.ai/v1/` (`UNVERIFIED — check provider docs`) |
| OpenAI-compatible | yes (plus a beta Anthropic-compatible mode) |
| API key env var | `MODELSCOPE_API_KEY` |
| rate limits (official) | **2,000 calls/day per user total, max 500 calls/day per individual model**; no published RPM/TPM; reset time not documented (presumed 00:00 UTC+8 — unknown) |
| free models | large rotating catalog of hosted open models (Qwen incl. very large ones, DeepSeek, GLM…); only models flagged as API-Inference-supported |
| credit card required | no |
| restrictions | China (modelscope.cn) and international (modelscope.ai) are separate sites/accounts/tokens; best-effort community capacity, models added/removed; per-model 500/day cap makes single-model batches shallow; training-data policy unknown |

```json
{
  "id": "modelscope",
  "display_name": "ModelScope API-Inference",
  "base_url": "https://api-inference.modelscope.cn/v1/",
  "openai_compatible": "yes",
  "api_key_env_var": "MODELSCOPE_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown",
    "requests_per_day": "2000 total, 500 per model (official)",
    "tokens_per_minute": "unknown",
    "verified": "official limits page (fetched 2026-07-27); intl base URL unverified",
    "free_models": "rotating catalog of open models (Qwen, DeepSeek, GLM)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "best-effort community capacity; separate China/international accounts; daily reset time undocumented"
  }
}
```

### 9. SiliconFlow (SiliconCloud)

| field | value |
|---|---|
| id | `siliconflow` |
| display name | SiliconFlow (SiliconCloud) |
| base URL | `https://api.siliconflow.cn/v1` (China); `https://api.siliconflow.com/v1` (international) |
| OpenAI-compatible | yes (chat, embeddings, rerank, images) |
| API key env var | `SILICONFLOW_API_KEY` |
| rate limits | free models have **fixed** per-model limits; account tiers span RPM 1,000–10,000 / TPM 50,000–5,000,000; entry-level free figure commonly cited as RPM 1,000 / TPM 50,000 — **`UNVERIFIED — check provider docs`** (exact per-model values shown only in console; third-party, 2026). New signups also get ~¥14 credit for paid models |
| free models | rotating set of smaller open models (Qwen small instructs, GLM-4-9B, DeepSeek-distills, BGE embeddings); large models are paid (`Pro/` prefix) |
| credit card required | no — but China site requires **real-name authentication** (in practice +86 phone) to use free models; international site is email-only |
| restrictions | shared capacity — queueing/deprioritization under load; Chinese-operated infrastructure; training-data policy unknown |

```json
{
  "id": "siliconflow",
  "display_name": "SiliconFlow (SiliconCloud)",
  "base_url": "https://api.siliconflow.com/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "SILICONFLOW_API_KEY",
  "free_tier": {
    "requests_per_minute": "~1000 entry tier (UNVERIFIED — check provider docs; exact values in console only)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "~50000 entry tier (UNVERIFIED — check provider docs)",
    "verified": "official doc confirms fixed free-model limits (2026-07-27); numbers third-party 2026",
    "free_models": "rotating smaller open models (Qwen small, GLM-4-9B, DeepSeek-distills, BGE embeddings)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "China site requires real-name auth for free models; shared-capacity queueing"
  }
}
```

### 10. SambaNova Cloud

| field | value |
|---|---|
| id | `sambanova` |
| display name | SambaNova Cloud |
| base URL | `https://api.sambanova.ai/v1` |
| OpenAI-compatible | yes |
| API key env var | `SAMBANOVA_API_KEY` |
| rate limits | **20 RPM / 20 RPD / 200,000 tokens/day per model**, plus a one-off $5 credit expiring after 3 months — **`UNVERIFIED — check provider docs`** (official docs returned 403 on 2026-07-27; corroborated by ≥4 independent July-2026 trackers and SambaNova community forum posts) |
| free models | ~4 models, rotates (Llama 3.3 70B, DeepSeek-V3.1, gpt-oss-120b, MiniMax-M2 reported) |
| credit card required | no |
| restrictions | **free tier reportedly not available in EU/UK/Switzerland** (`UNVERIFIED`); 20 RPD makes it a trickle for batch work; daily reset time not documented |

```json
{
  "id": "sambanova",
  "display_name": "SambaNova Cloud",
  "base_url": "https://api.sambanova.ai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "SAMBANOVA_API_KEY",
  "free_tier": {
    "requests_per_minute": "20 (UNVERIFIED — check provider docs)",
    "requests_per_day": "20 per model (UNVERIFIED — check provider docs)",
    "tokens_per_minute": "unknown (200,000 tokens/day per model, UNVERIFIED)",
    "verified": "third-party trackers, July 2026; official docs 403",
    "free_models": "~4 rotating models (Llama 3.3 70B, DeepSeek-V3.1, gpt-oss-120b, MiniMax-M2)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "reportedly unavailable in EU/UK/CH (unverified); very low 20 RPD cap"
  }
}
```

### 11. OVHcloud AI Endpoints

| field | value |
|---|---|
| id | `ovh` |
| display name | OVHcloud AI Endpoints |
| base URL | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` |
| OpenAI-compatible | yes |
| API key env var | `OVH_AI_ENDPOINTS_API_KEY` (common convention; **anonymous tier needs no key at all**) |
| rate limits (verified 2026-07-27, official) | anonymous: **2 req/min per IP per model**; authenticated: **400 req/min per Public Cloud project per model**; 429 on exceed; no usage/token caps |
| free models | ~12–13 open-weight models (Qwen3-Coder-30B, Llama 3.1 8B / 3.3 70B, gpt-oss-120b/20b, Mistral, DeepSeek distill, embeddings, Whisper) |
| credit card required | no for anonymous; authenticated keys need a Public Cloud project (payment method typically needed to create one — `UNVERIFIED`) |
| restrictions | EU-hosted (Gravelines, France), GDPR posture, "data not stored or shared" per official page; cold starts (5–10s) reported on some models |

```json
{
  "id": "ovh",
  "display_name": "OVHcloud AI Endpoints",
  "base_url": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "OVH_AI_ENDPOINTS_API_KEY",
  "free_tier": {
    "requests_per_minute": "2 anonymous per IP per model; 400 authenticated per project per model (verified 2026-07-27, official)",
    "requests_per_day": "unknown (no usage caps documented)",
    "tokens_per_minute": "unknown",
    "verified": "2026-07-27 (official docs)",
    "free_models": "~12-13 open models (Qwen3-Coder-30B, Llama 3.1/3.3, gpt-oss, Mistral, DeepSeek distill, Whisper)",
    "credit_card_required": false,
    "trains_on_free_data": false,
    "restrictions": "EU-hosted; cold starts reported; authenticated tier needs a Public Cloud project"
  }
}
```

### 12. Mistral (La Plateforme, free tier)

⚠️ **TRAINS ON FREE DATA** — Experiment (free) tier inputs/outputs may be used for Mistral model training (opt-out available); paid tiers do not train.

| field | value |
|---|---|
| id | `mistral` |
| display name | Mistral AI (La Plateforme) |
| base URL | `https://api.mistral.ai/v1` |
| OpenAI-compatible | yes (chat completions; OCR/FIM endpoints are native-only) |
| API key env var | `MISTRAL_API_KEY` |
| rate limits | free tier exists with "restrictive" org-level limits measured in RPS and tokens/min/month, **no exact numbers published** (official tier page, verified 2026-07-27); secondary sources describe ≈1 req/sec and ~1B tokens/month cap — `UNVERIFIED — check provider docs` |
| free models | all API models incl. Mistral Large and Codestral (secondary; official page doesn't enumerate) |
| credit card required | no — phone/SMS verification required instead (`UNVERIFIED`, secondary) |
| restrictions | ⚠️ trains on free data (see above); tier intended for evaluation, not production |

```json
{
  "id": "mistral",
  "display_name": "Mistral AI (La Plateforme)",
  "base_url": "https://api.mistral.ai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "MISTRAL_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (~60 i.e. 1 RPS, UNVERIFIED — check provider docs)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown (~1B tokens/month cap cited, UNVERIFIED)",
    "verified": "tier existence confirmed 2026-07-27 (official); numbers unverified",
    "free_models": "all API models incl. Mistral Large, Codestral (per secondary sources)",
    "credit_card_required": false,
    "trains_on_free_data": true,
    "restrictions": "free-tier data may train Mistral models (opt-out available); SMS verification; evaluation-only tier"
  }
}
```

### 13. Chutes

| field | value |
|---|---|
| id | `chutes` |
| display name | Chutes (chutes.ai) |
| base URL | `https://llm.chutes.ai/v1` |
| OpenAI-compatible | yes (Bearer `cpk_...` keys) |
| API key env var | `CHUTES_API_KEY` |
| rate limits | **unknown — `UNVERIFIED — check provider docs`** (current pricing page shows pay-per-token + monthly plans; third-party aggregators claim free access to some models with no hard cap, unconfirmed; anonymous requests hit a 429 rate-limit path) |
| free models | no official list; live catalog at `GET /v1/models` shows per-model pricing ($0 = free); historically DeepSeek-R1, Llama-3.1-70B |
| credit card required | no (username + fingerprint-key registration; top-ups via card or TAO crypto) |
| restrictions | decentralized Bittensor SN64 miners — reliability varies with community capacity; free/anonymous users subject to congestion and queueing; TEE confidential compute optional |

```json
{
  "id": "chutes",
  "display_name": "Chutes",
  "base_url": "https://llm.chutes.ai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "CHUTES_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (UNVERIFIED — check provider docs)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "no official free-tier docs found 2026-07-27",
    "free_models": "check GET /v1/models for $0-priced entries; historically DeepSeek-R1, Llama-3.1-70B",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "decentralized miner-run inference; congestion/queueing for free users"
  }
}
```

---

## Tier 2 — One-time credit or time-boxed trial (not a permanent free tier)

These are usable without ongoing payment but either expire or require a card. Included for completeness; weaker fits for sustained batch work.

### 14. Cohere (trial keys)

| field | value |
|---|---|
| id | `cohere` |
| display name | Cohere (trial/evaluation keys) |
| base URL | `https://api.cohere.com/compatibility/v1` (OpenAI-compat); native `https://api.cohere.com/v2` |
| OpenAI-compatible | partial (compat shim covers chat/embeddings; rerank native-only) |
| API key env var | `COHERE_API_KEY` (SDK also honors `CO_API_KEY`) |
| rate limits (verified 2026-07-27, official) | **1,000 API calls/month total across all endpoints**; chat models (Command A family, R+, R, R7B) 20 req/min per model; no daily reset — monthly cap |
| free models | full trial access to Command, Embed, Rerank within the 1,000-call cap |
| credit card required | no |
| restrictions | trial keys are **non-production/evaluation only** per ToS; 1,000 calls/month is a hard cap |

```json
{
  "id": "cohere",
  "display_name": "Cohere (trial keys)",
  "base_url": "https://api.cohere.com/compatibility/v1",
  "openai_compatible": "partial",
  "api_key_env_var": "COHERE_API_KEY",
  "free_tier": {
    "requests_per_minute": "20 per chat model (verified 2026-07-27, official)",
    "requests_per_day": "n/a — 1,000 calls/month total cap (verified 2026-07-27, official)",
    "tokens_per_minute": "unknown",
    "verified": "2026-07-27 (official docs)",
    "free_models": "Command A family, Embed, Rerank (trial access)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "evaluation-only ToS; hard 1,000 calls/month cap"
  }
}
```

### 15. AI21 Labs

| field | value |
|---|---|
| id | `ai21` |
| display name | AI21 Studio |
| base URL | `https://api.ai21.com/studio/v1` |
| OpenAI-compatible | partial (OpenAI-compatible chat endpoint; some AI21-specific endpoints native) |
| API key env var | `AI21_API_KEY` |
| rate limits (verified 2026-07-27, official) | **$10 credit valid 3 months** for new accounts; platform-wide limits Jamba Large/Mini 10 RPS / 200 RPM (trial-specific throttling not documented) |
| free models | all Jamba models against the credit |
| credit card required | no for the trial; required after credit/expiry |
| restrictions | time-boxed credit, not a renewable free tier |

```json
{
  "id": "ai21",
  "display_name": "AI21 Studio",
  "base_url": "https://api.ai21.com/studio/v1",
  "openai_compatible": "partial",
  "api_key_env_var": "AI21_API_KEY",
  "free_tier": {
    "requests_per_minute": "200 (platform-wide, verified 2026-07-27, official)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "2026-07-27 (official docs)",
    "free_models": "Jamba family (against $10 credit, 3-month expiry)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "credit expires after 3 months; then card required"
  }
}
```

### 16. Alibaba Qwen / DashScope (Model Studio)

| field | value |
|---|---|
| id | `dashscope` |
| display name | Alibaba Cloud Model Studio (DashScope) |
| base URL | international: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; China: `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| OpenAI-compatible | yes (dedicated compatible-mode; native protocol also exists) |
| API key env var | `DASHSCOPE_API_KEY` |
| rate limits (verified 2026-07-27, official) | free quota = **1M tokens per model, valid 90 days after activation**, **international (Singapore) scope only**; account-level per-model limits same as paid: e.g. `qwen-plus` 600 RPM / 1.5M TPM, snapshot versions ~60 RPM / 1M TPM; no daily cap |
| free models | most Qwen models against the quota (Qwen-Max/Plus/Flash/Turbo, QwQ, Qwen-VL, Qwen-Omni); Qwen-Long excluded; nothing permanently free |
| credit card required | international signup typically requires a payment method on file (`UNVERIFIED — check provider docs`); China scope requires real-name verification |
| restrictions | quota is a 90-day trial, not ongoing; international vs China are separate accounts/endpoints; console toggle can stop usage when quota exhausts |

```json
{
  "id": "dashscope",
  "display_name": "Alibaba Cloud Model Studio (DashScope)",
  "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "DASHSCOPE_API_KEY",
  "free_tier": {
    "requests_per_minute": "60-15000 per model (verified 2026-07-27, official)",
    "requests_per_day": "unknown (no daily cap)",
    "tokens_per_minute": "1M-5M per model (verified 2026-07-27, official)",
    "verified": "2026-07-27 (official docs)",
    "free_models": "Qwen families against 1M-tokens-per-model / 90-day quota (international scope only)",
    "credit_card_required": "yes (UNVERIFIED — check provider docs; typically required for intl account)",
    "trains_on_free_data": "unknown",
    "restrictions": "90-day time-boxed quota, international scope only; separate China/international accounts"
  }
}
```

### 17. Cerebras — ⚠️ free tier effectively discontinued

| field | value |
|---|---|
| id | `cerebras` |
| display name | Cerebras Inference |
| base URL | `https://api.cerebras.ai/v1` |
| OpenAI-compatible | yes |
| API key env var | `CEREBRAS_API_KEY` |
| rate limits (verified 2026-07-27, official) | **"Free Trial": $5 credit, expires 30 days, requires a verified payment method** — without one, Playground and API stay inactive. Trial limits: 5 RPM / 30K TPM / 1M TPD on `gpt-oss-120b`, `zai-glm-4.7`, `gemma-4-31b` |
| free models | the 3 models above, during the credit trial only |
| credit card required | **yes — now required even for trial access** |
| restrictions | the widely-cited "1M tokens/day forever, no card" free tier appears **discontinued as of 2026-07-27** (secondary sources referencing it are stale, last known good ~May 2026); trial requests may queue before streaming |

```json
{
  "id": "cerebras",
  "display_name": "Cerebras Inference",
  "base_url": "https://api.cerebras.ai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "CEREBRAS_API_KEY",
  "free_tier": {
    "requests_per_minute": 5,
    "requests_per_day": "unknown (1M tokens/day)",
    "tokens_per_minute": 30000,
    "verified": "2026-07-27 (official docs)",
    "free_models": ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"],
    "credit_card_required": true,
    "trains_on_free_data": "unknown",
    "restrictions": "$5 trial credit expires in 30 days; payment method required; permanent free tier discontinued"
  }
}
```

### 18. Fireworks AI

| field | value |
|---|---|
| id | `fireworks` |
| display name | Fireworks AI |
| base URL | `https://api.fireworks.ai/inference/v1` |
| OpenAI-compatible | yes |
| API key env var | `FIREWORKS_API_KEY` |
| rate limits | $1 one-time signup credit; **no permanently free models**; 10 RPM without a payment method, up to 6,000 RPM with a card — `UNVERIFIED — check provider docs` (third-party, June 2026; Fireworks publishes limits only behind login) |
| free models | none permanent; full serverless catalog against the $1 credit |
| credit card required | no for signup credit; yes to lift limits |
| restrictions | credit-based trial only |

```json
{
  "id": "fireworks",
  "display_name": "Fireworks AI",
  "base_url": "https://api.fireworks.ai/inference/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "FIREWORKS_API_KEY",
  "free_tier": {
    "requests_per_minute": "10 without card (UNVERIFIED — check provider docs; third-party June 2026)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "third-party, June 2026",
    "free_models": "none permanent; $1 signup credit only",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "one-time $1 credit; limits published only behind login"
  }
}
```

### 19. DeepInfra

| field | value |
|---|---|
| id | `deepinfra` |
| display name | DeepInfra |
| base URL | `https://api.deepinfra.com/v1/openai` |
| OpenAI-compatible | yes |
| API key env var | `DEEPINFRA_API_KEY` |
| rate limits | no standing free tier (June-2026 comparisons); one review claims a $1 signup credit, no card — `UNVERIFIED — check provider docs` (conflicting); paid model is concurrency-capped (~200 concurrent/account) rather than RPM |
| free models | none verified (occasional time-limited free-model promos) |
| credit card required | reportedly no for trial credit; required for postpaid billing |
| restrictions | concurrency-cap model; postpaid invoicing at spend thresholds |

```json
{
  "id": "deepinfra",
  "display_name": "DeepInfra",
  "base_url": "https://api.deepinfra.com/v1/openai",
  "openai_compatible": "yes",
  "api_key_env_var": "DEEPINFRA_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (concurrency-based, ~200 concurrent paid)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "no free tier per June-2026 comparisons; $1-credit claim UNVERIFIED",
    "free_models": "none verified",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "effectively no free tier"
  }
}
```

### 20. Hyperbolic

| field | value |
|---|---|
| id | `hyperbolic` |
| display name | Hyperbolic |
| base URL | `https://api.hyperbolic.xyz/v1` |
| OpenAI-compatible | yes |
| API key env var | `HYPERBOLIC_API_KEY` |
| rate limits | no standing free tier; ~$1 trial credit at signup with phone verification — `UNVERIFIED — check provider docs` (third-party; official docs unreachable 2026-07-27) |
| free models | none verified |
| credit card required | reportedly no for trial credit; phone verification required (`UNVERIFIED`) |
| restrictions | GPU-rental marketplace + inference API; free access is credit-based only |

```json
{
  "id": "hyperbolic",
  "display_name": "Hyperbolic",
  "base_url": "https://api.hyperbolic.xyz/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "HYPERBOLIC_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "UNVERIFIED — check provider docs (official docs unreachable 2026-07-27)",
    "free_models": "none verified (~$1 trial credit only)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "phone verification; trial credit only"
  }
}
```

### 21. Novita AI

| field | value |
|---|---|
| id | `novita` |
| display name | Novita AI |
| base URL | `https://api.novita.ai/v3/openai` |
| OpenAI-compatible | yes |
| API key env var | `NOVITA_API_KEY` |
| rate limits | $0.50 one-time signup credit, no permanent free tier; ~60 RPM baseline — `UNVERIFIED — check provider docs` (third-party trackers, May 2026) |
| free models | none permanent; credit applies to LLM + image/video APIs |
| credit card required | no for the signup credit (per trackers) |
| restrictions | credit-based trial only |

```json
{
  "id": "novita",
  "display_name": "Novita AI",
  "base_url": "https://api.novita.ai/v3/openai",
  "openai_compatible": "yes",
  "api_key_env_var": "NOVITA_API_KEY",
  "free_tier": {
    "requests_per_minute": "~60 (UNVERIFIED — check provider docs; third-party May 2026)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "third-party, May 2026",
    "free_models": "none permanent ($0.50 signup credit)",
    "credit_card_required": false,
    "trains_on_free_data": "unknown",
    "restrictions": "credit-based trial only"
  }
}
```

### 22. Nebius Token Factory (formerly Nebius AI Studio)

| field | value |
|---|---|
| id | `nebius` |
| display name | Nebius Token Factory |
| base URL | `https://api.tokenfactory.nebius.com/v1/` (old: `https://api.studio.nebius.ai/v1`) |
| OpenAI-compatible | yes |
| API key env var | `NEBIUS_API_KEY` |
| rate limits | ~$1 one-time trial credit (`UNVERIFIED` — third-party); rate limits **dynamic**: baseline 60 RPM / 400K TPM, auto-scaling ×1.2 per 15-min window up to 20× (official, verified 2026-07-27); no permanently free models |
| free models | none permanent; 60+ open models against credit |
| credit card required | **yes** — required at signup (third-party, Nov 2025, `UNVERIFIED`) |
| restrictions | over-limit requests may be served best-effort at lower priority (`x-ratelimit-over-limit: yes`); rebrand in progress — old docs/URLs being migrated |

```json
{
  "id": "nebius",
  "display_name": "Nebius Token Factory",
  "base_url": "https://api.tokenfactory.nebius.com/v1/",
  "openai_compatible": "yes",
  "api_key_env_var": "NEBIUS_API_KEY",
  "free_tier": {
    "requests_per_minute": "60 baseline, dynamic up to 1200 (limits verified 2026-07-27, official)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "400000 baseline (verified 2026-07-27, official)",
    "verified": "limits official 2026-07-27; ~$1 trial credit third-party, UNVERIFIED",
    "free_models": "none permanent",
    "credit_card_required": true,
    "trains_on_free_data": "unknown",
    "restrictions": "card required at signup; dynamic rate limits"
  }
}
```

### 23. Scaleway Generative APIs

| field | value |
|---|---|
| id | `scaleway` |
| display name | Scaleway Generative APIs |
| base URL | `https://api.scaleway.ai/v1` |
| OpenAI-compatible | yes |
| API key env var | `SCW_SECRET_KEY` |
| rate limits (verified 2026-07-27, official) | **1,000,000 tokens + 60 min audio transcription free**; 200K TPM base / 400K TPM with identity verification, plus QPM and concurrency caps |
| free models | all serverless models against the allowance (Llama 3.3 70B, Mistral Small, Gemma, DeepSeek-R1-Distill, Qwen, gpt-oss, Voxtral) |
| credit card required | **yes** — base limits require a registered payment method; higher limits need KYC |
| restrictions | EU/France-hosted; pay-as-you-go beyond the free allowance; Batches API has no rate limit at −50% pricing (paid) |

```json
{
  "id": "scaleway",
  "display_name": "Scaleway Generative APIs",
  "base_url": "https://api.scaleway.ai/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "SCW_SECRET_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (QPM caps exist, values not captured)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "200000 (400000 with KYC) (verified 2026-07-27, official)",
    "verified": "2026-07-27 (official docs)",
    "free_models": "all serverless models against 1M-token free allowance",
    "credit_card_required": true,
    "trains_on_free_data": "unknown",
    "restrictions": "payment method required; EU-hosted; free allowance is one-time, not recurring"
  }
}
```

### 24. Arli AI

| field | value |
|---|---|
| id | `arli` |
| display name | Arli AI |
| base URL | `https://api.arliai.com/v1` |
| OpenAI-compatible | yes (vLLM/Aphrodite backend) |
| API key env var | `ARLIAI_API_KEY` |
| rate limits (official) | free accounts: **5 requests per model every 2 days** ("for testing purposes") |
| free models | effectively all textgen models trial-able under that cap; catalog is heavily RP/creative-writing finetunes |
| credit card required | unknown (no evidence one is required) |
| restrictions | "unrestricted"/zero-log positioning; NSFW-oriented catalog; the free cap is a taste, not a usable tier |

```json
{
  "id": "arli",
  "display_name": "Arli AI",
  "base_url": "https://api.arliai.com/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "ARLIAI_API_KEY",
  "free_tier": {
    "requests_per_minute": "n/a",
    "requests_per_day": "2.5 (5 requests per model every 2 days, official)",
    "tokens_per_minute": "unknown",
    "verified": "official docs (fetched 2026-07-27)",
    "free_models": "all textgen models under the trial cap (RP/creative-writing finetunes)",
    "credit_card_required": "unknown",
    "trains_on_free_data": "no (zero-log positioning)",
    "restrictions": "free cap is for testing only; NSFW-oriented catalog"
  }
}
```

### 25. Targon

| field | value |
|---|---|
| id | `targon` |
| display name | Targon (Manifold Labs, Bittensor SN4) |
| base URL | `https://api.targon.com/v1` (endpoint alive, verified 2026-07-27) |
| OpenAI-compatible | yes |
| API key env var | `TARGON_API_KEY` |
| rate limits | **unknown — `UNVERIFIED — check provider docs`** (historically a one-time ~$5 signup credit; docs now describe a confidential-GPU compute/rental platform, not an inference free tier) |
| free models | unknown (open models: Llama, DeepSeek, community-added) |
| credit card required | unknown |
| restrictions | first-party but has **pivoted away from an inference free tier**; miner-run inference means variable quality |

```json
{
  "id": "targon",
  "display_name": "Targon",
  "base_url": "https://api.targon.com/v1",
  "openai_compatible": "yes",
  "api_key_env_var": "TARGON_API_KEY",
  "free_tier": {
    "requests_per_minute": "unknown (UNVERIFIED — check provider docs)",
    "requests_per_day": "unknown",
    "tokens_per_minute": "unknown",
    "verified": "no current free-tier docs found 2026-07-27",
    "free_models": "unknown",
    "credit_card_required": "unknown",
    "trains_on_free_data": "unknown",
    "restrictions": "pivoted to GPU compute/rental; inference free tier status unclear"
  }
}
```

---

## Tier 3 — No usable free tier (listed to correct stale guides)

| id | display name | base URL | OpenAI-compat | env var | status (verified 2026-07-27 unless noted) |
|---|---|---|---|---|---|
| `together` | Together AI | `https://api.together.xyz/v1` | yes | `TOGETHER_API_KEY` | **No free tier** — official docs: minimum $5 prepaid purchase required. Old `-Free` model variants are gone. |
| `moonshot` | Moonshot AI (Kimi) | `https://api.moonshot.ai/v1` (intl) / `https://api.moonshot.cn/v1` (CN) | yes | `MOONSHOT_API_KEY` | **No free tier** — minimum $1 top-up required (official). Tier 0: 3 RPM / 500K TPM / 1.5M TPD. Separate intl/China platforms. |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | yes | `DEEPSEEK_API_KEY` | **No free tier or quota** — pay-as-you-go only; concurrency limits instead of RPM (500 for v4-pro, 2,500 for v4-flash, official). DeepSeek's privacy policy has historically permitted input use for service improvement — treat API data as potentially used for training (`UNVERIFIED`). |
| `perplexity` | Perplexity Sonar API | `https://api.perplexity.ai` | partial | `PERPLEXITY_API_KEY` | **No free tier** (official pricing). Former $5/month Pro-subscriber API credit: conflicting reports whether it still exists (`UNVERIFIED`). |
| `featherless` | Featherless AI | `https://api.featherless.ai/v1` | yes | `FEATHERLESS_API_KEY` | **No free tier** — cheapest plan $25/month (official plans page). |
| `kluster` | kluster.ai | (defunct) | — | `KLUSTER_API_KEY` | **Shut down** — team moved to MITO (AI video); `api.kluster.ai` no longer resolves. Remove from any provider list. |

```json
[
  {"id": "together", "display_name": "Together AI", "base_url": "https://api.together.xyz/v1", "openai_compatible": "yes", "api_key_env_var": "TOGETHER_API_KEY", "free_tier": null, "note": "minimum $5 prepaid purchase (official, 2026-07-27)"},
  {"id": "moonshot", "display_name": "Moonshot AI (Kimi)", "base_url": "https://api.moonshot.ai/v1", "openai_compatible": "yes", "api_key_env_var": "MOONSHOT_API_KEY", "free_tier": null, "note": "minimum $1 top-up; Tier 0 3 RPM / 500K TPM / 1.5M TPD (official, 2026-07-27)"},
  {"id": "deepseek", "display_name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "openai_compatible": "yes", "api_key_env_var": "DEEPSEEK_API_KEY", "free_tier": null, "note": "pay-as-you-go only; concurrency-based limits; inputs may be used for training (unverified)"},
  {"id": "perplexity", "display_name": "Perplexity Sonar API", "base_url": "https://api.perplexity.ai", "openai_compatible": "partial", "api_key_env_var": "PERPLEXITY_API_KEY", "free_tier": null, "note": "all paid (official, 2026-07-27)"},
  {"id": "featherless", "display_name": "Featherless AI", "base_url": "https://api.featherless.ai/v1", "openai_compatible": "yes", "api_key_env_var": "FEATHERLESS_API_KEY", "free_tier": null, "note": "cheapest plan $25/month (official, 2026-07-27)"},
  {"id": "kluster", "display_name": "kluster.ai", "base_url": null, "openai_compatible": null, "api_key_env_var": "KLUSTER_API_KEY", "free_tier": null, "note": "SHUT DOWN — do not list"}
]
```

---

## DO NOT USE — unofficial reverse-proxy / key-sharing services

The following are **not first-party providers**. They are Discord-ecosystem gateways that resell or proxy access to proprietary models (GPT-*, Claude, Gemini, Midjourney, DALL-E, ElevenLabs) they do not operate. Using them means: your prompts and API keys transit an unaudited third party; the upstream access almost certainly violates the model vendors' ToS (keys and accounts vanish without notice); and data-handling claims are unverifiable. Facts below are given only for identification purposes — **do not route traffic through them.**

| id | display name | base URL | identification notes | reason to avoid |
|---|---|---|---|---|
| `zuki` | ZukiJourney | `https://api.zukijourney.com/v1` | keys issued by Discord bot (`zu-` prefix); 12 RPM free; docs admit models "courtesy of their respective owners… no affiliations" | key-sharing / resale of proprietary models; prompt privacy unverifiable |
| `helix` | HelixMind | `https://api.helixmind.online/v1` | Discord onboarding; advertises "unlimited GPT-4o, o1, Claude" (resold); free ~3 RPM / 50 RPD per third-party list (`UNVERIFIED`, last known 2025-04) | Discord-based resale of proprietary models |
| `electronhub` | Electron Hub | `https://api.electronhub.ai/v1` | keys `ek-` prefix; 5 RPM + $0.25 weekly credits; resells Claude/OpenAI/Google with vendor caps | textbook Discord-ecosystem key resale of proprietary APIs |
| `naga` | NagaAI | `https://api.naga.ac/v1` | g4f-lineage gateway ("successor to ChimeraGPT"); `:free` models 10 RPM / 100 RPD; **official privacy doc: free-model traffic may be used for training by "NagaAI and partners"** | resells third-party models incl. DALL-E 3 / ElevenLabs / Sonar as "free"; trains on free traffic |
| `voidai` | VoidAI | `https://api.voidai.app/v1` | keys `sk-voidai-` prefix; 100 RPM; credit-multiplier gateway reselling OpenAI/Anthropic/Google/Midjourney/Sora | resale of proprietary models; Discord-community operated |

```json
[
  {"id": "zuki", "display_name": "ZukiJourney", "base_url": "https://api.zukijourney.com/v1", "verdict": "DO NOT USE — unofficial reverse-proxy/key-sharing, Discord-issued keys"},
  {"id": "helix", "display_name": "HelixMind", "base_url": "https://api.helixmind.online/v1", "verdict": "DO NOT USE — Discord-based resale of proprietary models"},
  {"id": "electronhub", "display_name": "Electron Hub", "base_url": "https://api.electronhub.ai/v1", "verdict": "DO NOT USE — key resale of proprietary APIs"},
  {"id": "naga", "display_name": "NagaAI", "base_url": "https://api.naga.ac/v1", "verdict": "DO NOT USE — g4f-lineage gateway; trains on free traffic; proxied proprietary models"},
  {"id": "voidai", "display_name": "VoidAI", "base_url": "https://api.voidai.app/v1", "verdict": "DO NOT USE — credit-multiplier resale gateway for proprietary models"}
]
```

The same warning applies to any other "free GPT-4/Claude API" site not listed here: if a service offers proprietary frontier models for free with Discord-issued keys, it is a resale/proxy operation.

---

## Recommended starting set of 5

For overnight batch work with least operational hassle — judged on: ongoing (non-expiring) free tier, no card, OpenAI-compatible, first-party, documented limits, no training on your data where possible:

1. **Groq** — 30 RPM per model, 14,400 RPD on `llama-3.1-8b-instant`, 1,000 RPD on 70B/gpt-oss class. Best-documented limits, proper `retry-after` headers. No card.
2. **NVIDIA NIM** — ~40 RPM (`UNVERIFIED`), 100+ models, no documented daily cap, no card. The workhorse for sustained overnight volume if the 40 RPM figure holds.
3. **Cloudflare Workers AI** — 300 RPM ceiling; the binding constraint is the 10,000 Neurons/day budget (~0.3–1M tokens/day depending on model), resetting 00:00 UTC. No card.
4. **Gemini (AI Studio)** — Flash-class free tier with daily reset at midnight Pacific; numbers no longer published, so discover them in AI Studio before relying on them. ⚠️ Only for non-sensitive data — free tier trains on prompts.
5. **OpenRouter** — 20 RPM across all `:free` variants, 50 req/day (`UNVERIFIED` digits). Low volume, but one key fans out across ~20 free models — useful as the diversity/failover leg rather than a throughput leg.

**Aggregate:** nominally ~**400 requests/minute** (30 + 40 + 300 + ~10 + 20), but the daily caps bind long before the minute caps for batch work: Cloudflare stops at its neuron budget, OpenRouter at ~50 requests, Gemini at its unpublished RPD, Groq at 1,000–14,400 RPD depending on model. Realistic overnight throughput is dominated by NVIDIA (uncapped, ~40 RPM ≈ up to ~57K requests/night) plus Groq's daily budgets — plan around the daily numbers, not the RPM sum.

**Honorable mentions:** Z.AI (three $0 Flash models — good if you accept China data residency and concurrency-only limits), ModelScope (2,000 calls/day including very large Qwen models — shallow per-model caps), OVH (400 RPM authenticated, EU/GDPR posture — worth adding once its project setup is done), GitHub Models (150 RPD — prototyping ToS only). Substitute Gemini out for Z.AI or OVH if training-on-data or unpublished limits are disqualifying for your workload.
