# free-llm onboarding & health — phase 2 spec

Apply **after** the core proxy (SPEC.md) lands. Adds the commands that remove
the actual friction of running a pool of free tiers.

## What this is NOT

**No automated account creation.** No signup automation, no key generation, no
CAPTCHA or bot-detection handling, no headless browser driving a registration
form. Automated signup violates the terms of every provider on the list, gets
accounts banned in waves, and is the mechanism behind the multi-accounting this
project already refuses to support.

The human signs up. The tool does everything else — which is 95% of the work
and all of the boring part.

If a future contributor proposes adding signup automation, the answer is no, and
this paragraph is why.

## The insight this phase is built on

Signing up takes twenty seconds. What actually costs time:

- finding each provider's key page and base URL
- knowing which models a given key can actually reach
- discovering the real rate limits — **published limits are frequently wrong**
- noticing three weeks later that a key silently stopped working

All four are automatable without touching a signup form.

## `free-llm add <provider>` — guided, not automated

```
$ free-llm add cerebras

  Cerebras — 30 RPM · 14,400 RPD · ~1M tokens/day (published, unverified)
  1. Opening https://cloud.cerebras.ai/  (sign in with Google or GitHub)
  2. Go to API Keys → Create API Key
  3. Paste it here (input hidden):  ****

  ✓ key works — 7 models reachable, llama-3.3-70b responded in 240ms
  ✓ written to ~/.config/free-llm/providers.json as `cerebras`
  → run `free-llm probe cerebras` to measure its real limits
```

- opens the provider's key page with the platform opener (`open`/`xdg-open`),
  behind a `--no-open` flag for headless use
- **reads the key from a hidden prompt or stdin, never from argv** — a key in
  argv leaks into shell history and `ps` output. Test this.
- immediately fires one cheap validation request; on failure says *why*
  (401 vs 403 vs wrong base URL) rather than "invalid key"
- discovers which models that key can actually reach via `GET /v1/models`,
  intersected with a real completion against the cheapest one — a model appearing
  in the list is not proof it is callable on a free tier
- writes the config entry with the key stored **by environment variable
  reference**, and prints the `export` line for the user's shell profile. The key
  itself is never written into the config file.

`free-llm add --all` walks the recommended set in order, skipping any already
configured, and is resumable — interrupting it must not corrupt the config.

## `free-llm probe <provider>` — measure the real limits

The most valuable command here, because **published limits are unreliable**.
Groq's free tier is currently documented as both 30 RPM/14,400 RPD and ~1,000
RPD by different reputable sources. Config built on a blog post is wrong within
months.

Probing carefully:

- ramp request rate gradually from well below the configured limit until the
  first 429, then **stop immediately** — record the observed ceiling and back off
- never exceed the configured limit by more than one request; if config says 30
  RPM, the probe stops at the first 429 at or below ~31
- respect `Retry-After` throughout; a probe that hammers a provider to find its
  limit is exactly the abuse this project avoids
- use the cheapest available model and `max_tokens: 1` — probing must cost the
  provider as little as possible
- **daily limits are NOT probed.** Discovering an RPD ceiling means exhausting a
  day's allowance, which is user-hostile. Instead, infer RPD passively from
  observed 429s during normal use and record it as `observed`.
- write results to `~/.local/state/free-llm/observed-limits.json` with a
  timestamp; the scheduler prefers observed limits over configured ones, and
  `status` shows both so a divergence is visible

`--dry-run` prints the probe plan (how many requests, against which model, worst
case cost in tokens) without sending anything.

## `free-llm check` — is everything still working?

One request per configured provider, in parallel, with a short timeout:

```
$ free-llm check
  ✓ cerebras     7 models   240ms   budget 14,352/14,400 today
  ✓ openrouter  31 models   890ms   budget 47/50 today
  ✗ groq         401 unauthorized — key rejected. Regenerate at console.groq.com
  ⚠ gemini       429 rate limited — cooling for 34s (not an error)
  ○ mistral      GEMINI_API_KEY unset — skipped
```

Distinguish the four states clearly: **working**, **broken** (needs action),
**throttled** (fine, just busy), **unconfigured** (skipped). Conflating throttled
with broken would send users chasing a non-problem. Exit non-zero only when a
configured provider is genuinely broken.

## `free-llm doctor` — diagnose a specific failure

When a batch produced bad rows or a provider dropped out, answer *why*:

- correlate recent request-log entries with provider, model, status and latency
- surface the last error body per provider (redacted)
- flag providers whose observed limits have drifted from configured
- flag a provider whose success rate has fallen below 90% over the last 100 calls
- suggest the concrete next action, not a diagnosis: "regenerate the key",
  "you have hit the daily cap, resets in 4h", "this model was removed from the
  free tier"

## Security requirements

These are testable, and must be tested:

1. a key value never appears in argv — `add` reads from a hidden prompt or stdin
2. a key value never appears in config files, logs, error messages, `--json`
   output, or the request log
3. `check`/`doctor` output is safe to paste into a GitHub issue — assert a
   sentinel key value is absent from every line of their output
4. config files are written `0600`

## Tests — fakes only, no network, no real keys

1. `add` with a rejected key reports the HTTP reason and writes **nothing** to config
2. `add --all` interrupted midway leaves a valid config, and re-running resumes
3. `probe` stops at the first 429 and never exceeds the configured limit by more
   than one request (assert against a counting fake)
4. `probe --dry-run` sends zero requests
5. `probe` never attempts to discover a daily limit
6. `check` classifies 401 as broken and 429 as throttled — and exits zero when
   the only issue is throttling
7. a sentinel key value appears in no output of any command
8. observed limits override configured ones in scheduler selection
