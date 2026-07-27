---
name: free-llm
description: >-
  Route suitable work through a local OpenAI-compatible proxy that pools honest,
  single-key hosted LLM free tiers while enforcing provider rate limits. Use for
  high-volume, delay-tolerant batch work, especially overnight; for inspecting
  free-tier budgets, models, attribution, and failures; or when a user mentions
  free LLM APIs, free-llm, hosted free tiers, or avoiding paid inference quota.
---

# /free-llm — use hosted free tiers safely

Use `free-llm` as a proxy and scheduler. Do not recreate `ask` or `batch`
workflows; drive those through `local-llm` or another OpenAI-compatible client.

## Inspect before routing work

Run:

```sh
free-llm check
free-llm status
free-llm models
```

Treat missing environment variables as unavailable providers, not errors. Base
recommendations on the current model and budget output. Free-tier limits and
model availability change frequently.

## Connect a client

Use `http://127.0.0.1:8080/v1` as an OpenAI-compatible base URL. Start the
server with `free-llm serve` only when the user wants the proxy running. Keep
the default loopback bind; warn that a non-loopback bind exposes a process that
holds API keys.

Send a configured logical alias such as `cheap-fast`, or a listed concrete
model. Never replace an unavailable alias with another model. Preserve caller
fields such as tools, response formats, and reasoning effort.

## Choose appropriate work

Prefer this pool for many independent, retryable, delay-tolerant items. Expect
roughly 60–150 requests/minute across five configured free tiers: useful for
overnight batch, not real-time scale. Free-tier quality varies substantially, so
retain `x-free-llm-provider` and `x-free-llm-model` with each result.

On bad or inconsistent rows, inspect:

```sh
free-llm log --limit 50
free-llm status
```

Report the attributed provider and model. Respect HTTP 429 and its
`Retry-After`; do not add a hidden retry loop that defeats admission control.

## Keep keys and accounts honest

Configure keys only through the named `apiKeyEnv` environment variables. Never
put a key in configuration, output, logs, prompts, or command lines.

Use one honest account per provider. Multiple entries are only for keys the user
legitimately holds, such as personal and employer organizations.
Multi-accounting to multiply a free allowance is a terms-of-service violation
and is unsupported. Never generate accounts, keys, signups, CAPTCHAs, or other
quota-evasion machinery.
