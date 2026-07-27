# free-llm-skill — build spec

Pool the **free tiers of several hosted LLM providers** behind one
OpenAI-compatible endpoint, and schedule requests so no provider's published
rate limit is ever exceeded.

The point is not to be clever. It is to make a pile of small free allowances
behave like one usable allowance, **without breaking anyone's terms of service
and without silently corrupting a batch when a provider degrades.**

Node ≥ 18, ESM, **zero runtime dependencies**, `node --test`. MIT. Package and
repo name `free-llm-skill`, binary `free-llm`. Matches `local-llm-skill`'s house
style exactly — read that repo first if anything here is ambiguous.

## Terms of service — read before designing anything

**One honest key per provider.** This tool must never help anyone hold multiple
accounts at a single provider to multiply a free tier. OpenRouter, Groq and
Google AI Studio all explicitly prohibit that; it gets keys banned rather than
throttled, and a tool that encourages it is worse than useless.

What IS legitimate, and what this tool does:

- **many providers, one key each** — OpenRouter + Groq + Google AI Studio +
  Cerebras + Mistral each publish their own limits; stacking across them is
  entirely within the rules
- **several keys a user genuinely holds** (personal + employer, org keys) —
  configured explicitly by the user, never generated or suggested

Therefore:

- the config schema takes **one key per provider entry**, and each entry names a
  provider; two entries for the same provider are allowed (a user may hold two
  legitimate keys) but the README must state plainly that multi-accounting to
  dodge limits is a ToS violation and unsupported.
- **never exceed a published limit.** Back off on 429, honour `Retry-After`.
  Being a good citizen is also what keeps the keys working.
- no key-generation, no signup automation, no CAPTCHA handling. Ever.

## Shape: a proxy, not another CLI

The primary interface is **`free-llm serve`** — a local OpenAI-compatible server.

```
local-llm  ──┐
route-skill ─┼──▶  free-llm (localhost:8080)  ──┬──▶ OpenRouter  (free tier)
your code  ──┘         scheduler + limits       ├──▶ Groq
                                                ├──▶ Google AI Studio
                                                └──▶ Cerebras …
```

This matters: `local-llm-skill` already supports a generic `openai` endpoint
kind, so pointing it at this proxy requires **zero changes to either tool**:

```json
{ "id": "free", "kind": "openai", "baseUrl": "http://127.0.0.1:8080/v1" }
```

Do not build a competing `ask`/`batch` CLI — `local-llm` already has those, and
duplicating them splits the ecosystem. Expose only what a proxy needs.

## Endpoints served

- `POST /v1/chat/completions` — the one that matters. Streaming and non-streaming.
- `POST /v1/embeddings` — where the chosen provider supports it.
- `GET  /v1/models` — the union of usable models across configured providers.
- `GET  /healthz` — liveness plus a per-provider budget summary.

Request/response bodies pass through unchanged apart from the model name
(see aliasing). Unknown fields must be forwarded, not stripped — callers rely on
`reasoning_effort`, `tools`, `response_format` and similar.

## Provider registry

`~/.config/free-llm/providers.json`, with a documented default set:

```json
{ "providers": [
  { "id": "openrouter", "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "limits": { "rpm": 20, "rpd": 50, "tpm": null },
    "models": ["*:free"] },
  { "id": "groq", "baseUrl": "https://api.groq.com/openai/v1",
    "apiKeyEnv": "GROQ_API_KEY",
    "limits": { "rpm": 30, "rpd": 14400, "tpm": 6000 } }
] }
```

- **API keys are read from named environment variables only** — never stored
  inline, never logged, never echoed in errors or `--json` output. Add a test
  asserting a key value never appears in any log line or error message.
- Limits are user-editable because providers change them often. Ship sensible
  documented defaults and say in the README that they are a starting point,
  with a link to each provider's limits page.
- A provider whose env var is unset is simply **skipped**, not an error.

## Scheduler — the core

`src/scheduler.mjs`. For each provider maintain **independent token buckets** for
every configured limit (rpm, rpd, tpm). A provider is eligible only when *every*
bucket has room for the request.

Selection among eligible providers: **least-recently-used weighted by remaining
budget fraction**, so traffic spreads rather than draining the first provider.
Deterministic given an injected clock and RNG — the tests depend on it.

- **429**: honour `Retry-After` exactly when present, else exponential backoff
  from 1s. Mark the provider cooling; exclude it until the cooldown expires.
- **Circuit breaker**: after 3 consecutive failures (5xx, timeout, malformed
  body) open the breaker for 60s, then half-open with a single probe request.
- **No eligible provider**: return HTTP **429** to the caller with a
  `Retry-After` computed from the soonest bucket refill. Do NOT queue
  indefinitely and do NOT silently exceed a limit — a caller that gets a clear
  429 can back off; one that gets a hang cannot.
- Persist bucket state to `~/.local/state/free-llm/buckets.json` so a restart
  does not reset a daily allowance and blow past it.

## Model aliasing

Users should not hardcode provider-specific model ids. Map a logical class to a
per-provider concrete model in config:

```json
{ "aliases": {
    "cheap-fast": { "openrouter": "meta-llama/llama-3.3-8b-instruct:free",
                    "groq": "llama-3.1-8b-instant" } } }
```

A request for `cheap-fast` goes to whichever eligible provider offers it. A
request naming a concrete model goes only to providers that list it. If an alias
has no eligible provider, return 429 with the reason — never silently substitute
a different model, which would corrupt a batch invisibly.

## Attribution — free tiers fail differently

Every response carries `x-free-llm-provider` and `x-free-llm-model` headers, and
`free-llm log` shows recent requests with provider, model, latency and outcome.

This is not nice-to-have. Free tiers fail *silently and inconsistently* — some
429, some truncate, some degrade quality without saying so. When a batch produces
bad rows the user must be able to answer "which provider served those?".

## CLI

```
free-llm serve [--port 8080] [--host 127.0.0.1]
free-llm status          # per provider: configured, budget remaining, breaker state
free-llm models          # union of usable models, and which providers offer each
free-llm log [--limit n] # recent requests with provider attribution
free-llm check           # validate config, report which providers are usable and why not
```

Default bind is **127.0.0.1** — this proxy holds API keys and must not be exposed
by accident. Binding to a non-loopback host requires an explicit `--host` and
prints a warning.

## Tests — fakes only, no network, no real keys

1. **buckets**: a provider at its rpm limit is not selected; a refill makes it
   eligible again; daily buckets survive a simulated restart.
2. **spread**: with two idle providers, ten requests do not all land on one.
3. **429 handling**: `Retry-After: 5` excludes that provider for exactly 5s;
   absent the header, backoff is exponential.
4. **exhaustion**: no eligible provider returns HTTP 429 with a sane
   `Retry-After` — assert it does NOT hang and does NOT overshoot a limit.
5. **breaker**: 3 consecutive 5xx opens it; it half-opens after the timeout.
6. **aliasing**: an alias resolves per provider; an unavailable alias 429s rather
   than substituting a different model.
7. **secrecy**: an API key value never appears in any log line, error message, or
   `--json` output. Assert against a key with a distinctive sentinel value.
8. **passthrough**: unknown request fields (e.g. `reasoning_effort`, `tools`)
   reach the upstream unmodified.

## README must state plainly

- what the realistic aggregate throughput is (**roughly 60–150 requests/minute**
  across five free tiers — useful for overnight batch, not for real-time scale)
- that free-tier model quality varies far more than paid tiers
- the ToS position above, in its own section, without hedging
- that a single OpenRouter key already aggregates many providers, so start there
  and add direct providers only where their free tier is meaningfully better
