import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  observedLimitsPath as defaultObservedLimitsPath,
  statePath as defaultStatePath,
} from './paths.mjs';
import {
  applyObservedLimits,
  loadObservedLimits,
  writeObservedLimit,
} from './observed-limits.mjs';

export const LIMIT_WINDOWS_MS = Object.freeze({
  rpm: 60_000,
  rpd: 86_400_000,
  tpm: 60_000,
});

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_OPEN_MS = 60_000;
const EPSILON = 1e-9;

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function makeBucket(capacity, now) {
  return { capacity, tokens: capacity, updatedAt: now };
}

function makeProviderState(provider, now) {
  const buckets = {};
  for (const name of Object.keys(LIMIT_WINDOWS_MS)) {
    const capacity = provider.limits?.[name];
    if (capacity != null) buckets[name] = makeBucket(capacity, now);
  }
  return {
    buckets,
    cooldownUntil: 0,
    rateLimitFailures: 0,
    consecutiveFailures: 0,
    breakerOpenUntil: 0,
    halfOpenInFlight: false,
    lastUsedAt: null,
    lastUsedSequence: -1,
  };
}

function refillBucket(bucket, name, now) {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  if (elapsed > 0) {
    bucket.tokens = Math.min(
      bucket.capacity,
      bucket.tokens + (elapsed * bucket.capacity) / LIMIT_WINDOWS_MS[name],
    );
    bucket.updatedAt = now;
  }
  return bucket;
}

function bucketCost(name, tokenCost) {
  return name === 'tpm' ? tokenCost : 1;
}

function secondsFromMilliseconds(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 60;
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (value == null || String(value).trim() === '') return null;
  const stringValue = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(stringValue)) {
    return Number(stringValue) * 1000;
  }
  const date = Date.parse(stringValue);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

function assertSavedNumber(value, description) {
  if (!Number.isFinite(value)) {
    throw new Error(`Unsafe bucket state: ${description} must be a finite number`);
  }
  return value;
}

function restoreProviderState(target, saved, providerId) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error(`Unsafe bucket state: provider "${providerId}" must be an object`);
  }
  if (!saved.buckets || typeof saved.buckets !== 'object' || Array.isArray(saved.buckets)) {
    throw new Error(`Unsafe bucket state: provider "${providerId}" has invalid buckets`);
  }
  for (const [name, bucket] of Object.entries(target.buckets)) {
    const savedBucket = saved.buckets[name];
    if (savedBucket == null) continue;
    if (typeof savedBucket !== 'object' || Array.isArray(savedBucket)) {
      throw new Error(`Unsafe bucket state: ${providerId}.${name} must be an object`);
    }
    const savedTokens = assertSavedNumber(
      savedBucket.tokens,
      `${providerId}.${name}.tokens`,
    );
    const savedCapacity = savedBucket.capacity == null
      ? bucket.capacity
      : assertSavedNumber(savedBucket.capacity, `${providerId}.${name}.capacity`);
    if (savedCapacity <= 0) {
      throw new Error(`Unsafe bucket state: ${providerId}.${name}.capacity must be positive`);
    }
    // Preserve absolute usage when a configured limit changes. In particular,
    // lowering a daily limit must not turn a partly-used old bucket into a
    // newly-full smaller bucket.
    const consumed = Math.max(0, savedCapacity - savedTokens);
    bucket.tokens = Math.min(bucket.capacity, bucket.capacity - consumed);
    bucket.updatedAt = assertSavedNumber(
      savedBucket.updatedAt,
      `${providerId}.${name}.updatedAt`,
    );
  }
  target.cooldownUntil = assertSavedNumber(
    saved.cooldownUntil ?? 0,
    `${providerId}.cooldownUntil`,
  );
  target.rateLimitFailures = assertSavedNumber(
    saved.rateLimitFailures ?? 0,
    `${providerId}.rateLimitFailures`,
  );
  target.consecutiveFailures = assertSavedNumber(
    saved.consecutiveFailures ?? 0,
    `${providerId}.consecutiveFailures`,
  );
  target.breakerOpenUntil = assertSavedNumber(
    saved.breakerOpenUntil ?? 0,
    `${providerId}.breakerOpenUntil`,
  );
  // A process cannot still own an in-flight half-open request after restart.
  target.halfOpenInFlight = false;
  if (saved.lastUsedAt != null) {
    target.lastUsedAt = assertSavedNumber(saved.lastUsedAt, `${providerId}.lastUsedAt`);
  }
  target.lastUsedSequence = assertSavedNumber(
    saved.lastUsedSequence ?? -1,
    `${providerId}.lastUsedSequence`,
  );
}

function resolveTokenCost(tokens, provider) {
  const value = typeof tokens === 'function' ? tokens(provider) : tokens;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Token cost for provider "${provider.id}" must be a positive number`);
  }
  return Math.ceil(value);
}

function breakerState(state, now) {
  if (state.breakerOpenUntil > now) return 'open';
  if (state.breakerOpenUntil > 0) return 'half-open';
  return 'closed';
}

export class Scheduler {
  constructor(providers, options = {}) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error('Scheduler requires at least one provider');
    }
    this.clock = options.clock ?? Date.now;
    this.rng = options.rng ?? Math.random;
    this.path = options.statePath === null
      ? null
      : (options.statePath ?? defaultStatePath(options.env));
    this.observedLimitsPath = options.observedLimitsPath === null
      ? null
      : (options.observedLimitsPath ?? defaultObservedLimitsPath(options.env));
    this.observedDocument = options.observedDocument ?? { version: 1, providers: {} };
    this.providers = new Map();
    this.states = new Map();
    this.selectionSequence = 0;
    this.writeCounter = 0;
    this.persistQueue = Promise.resolve();
    this.observedPersistQueue = Promise.resolve();
    const now = this.clock();
    for (const provider of providers) {
      if (!provider || typeof provider.id !== 'string' || provider.id.length === 0) {
        throw new Error('Every scheduled provider requires an id');
      }
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate scheduled provider id "${provider.id}"`);
      }
      this.providers.set(provider.id, provider);
      this.states.set(provider.id, makeProviderState(provider, now));
    }
  }

  static async create(providers, options = {}) {
    const observedDocument = options.observedLimitsPath === null
      ? { version: 1, providers: {} }
      : options.observedLimits != null
        ? {
          version: 1,
          providers: options.observedLimits.providers ?? options.observedLimits,
        }
        : await loadObservedLimits({
          path: options.observedLimitsPath,
          env: options.env,
        });
    const effectiveProviders = applyObservedLimits(providers, observedDocument);
    const scheduler = new Scheduler(effectiveProviders, {
      ...options,
      observedDocument,
    });
    await scheduler.load();
    return scheduler;
  }

  async load() {
    if (this.path == null) return this;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return this;
      if (error instanceof SyntaxError) {
        throw new Error(
          `Could not parse bucket state ${this.path}; refusing to reset allowances: ${error.message}`,
          { cause: error },
        );
      }
      throw new Error(`Could not read bucket state ${this.path}: ${error.message}`, {
        cause: error,
      });
    }
    if (
      !parsed
      || parsed.version !== 1
      || !parsed.providers
      || typeof parsed.providers !== 'object'
      || Array.isArray(parsed.providers)
    ) {
      throw new Error(
        `Unsafe bucket state in ${this.path}; refusing to reset allowances`,
      );
    }
    for (const [providerId, state] of this.states) {
      if (parsed.providers[providerId] != null) {
        restoreProviderState(state, parsed.providers[providerId], providerId);
        this.selectionSequence = Math.max(
          this.selectionSequence,
          state.lastUsedSequence,
        );
      }
    }
    return this;
  }

  serialize() {
    const providers = {};
    for (const [providerId, state] of this.states) {
      providers[providerId] = {
        buckets: Object.fromEntries(
          Object.entries(state.buckets).map(([name, bucket]) => [
            name,
            {
              capacity: bucket.capacity,
              tokens: bucket.tokens,
              updatedAt: bucket.updatedAt,
            },
          ]),
        ),
        cooldownUntil: state.cooldownUntil,
        rateLimitFailures: state.rateLimitFailures,
        consecutiveFailures: state.consecutiveFailures,
        breakerOpenUntil: state.breakerOpenUntil,
        lastUsedAt: state.lastUsedAt,
        lastUsedSequence: state.lastUsedSequence,
      };
    }
    return { version: 1, savedAt: this.clock(), providers };
  }

  async persist() {
    if (this.path == null) return;
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      this.writeCounter += 1;
      const temporary = `${this.path}.${process.pid}.${this.writeCounter}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.serialize(), null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, this.path);
    };
    this.persistQueue = this.persistQueue.catch(() => {}).then(write);
    await this.persistQueue;
  }

  evaluate(provider, state, tokenCost, now) {
    const reasons = [];
    let retryMs = 0;
    let impossible = false;
    if (provider.configured === false) {
      return {
        eligible: false,
        impossible: true,
        retryMs: Infinity,
        reasons: [`${provider.apiKeyEnv ?? 'API key'} is unset`],
        remainingFraction: 0,
      };
    }
    if (state.cooldownUntil > now) {
      retryMs = Math.max(retryMs, state.cooldownUntil - now);
      reasons.push(`cooling for ${secondsFromMilliseconds(state.cooldownUntil - now)}s`);
    }
    const breaker = breakerState(state, now);
    if (breaker === 'open') {
      retryMs = Math.max(retryMs, state.breakerOpenUntil - now);
      reasons.push(`circuit open for ${secondsFromMilliseconds(state.breakerOpenUntil - now)}s`);
    } else if (breaker === 'half-open' && state.halfOpenInFlight) {
      retryMs = Math.max(retryMs, 1000);
      reasons.push('half-open probe already in flight');
    }

    const remainingFractions = [];
    for (const [name, bucket] of Object.entries(state.buckets)) {
      refillBucket(bucket, name, now);
      const cost = bucketCost(name, tokenCost);
      if (cost > bucket.capacity + EPSILON) {
        impossible = true;
        reasons.push(`${name} request cost ${cost} exceeds limit ${bucket.capacity}`);
        remainingFractions.push(0);
        continue;
      }
      if (bucket.tokens + EPSILON < cost) {
        const needed = cost - bucket.tokens;
        const wait = (needed * LIMIT_WINDOWS_MS[name]) / bucket.capacity;
        retryMs = Math.max(retryMs, wait);
        reasons.push(`${name} bucket needs ${secondsFromMilliseconds(wait)}s`);
      }
      remainingFractions.push(
        Math.max(0, (bucket.tokens - cost) / bucket.capacity),
      );
    }
    return {
      eligible: reasons.length === 0,
      impossible,
      retryMs: impossible ? Infinity : retryMs,
      reasons,
      remainingFraction: remainingFractions.length > 0
        ? Math.min(...remainingFractions)
        : 1,
      breaker,
    };
  }

  choose(candidates) {
    let bestScore = -Infinity;
    let best = [];
    for (const candidate of candidates) {
      const age = Math.max(
        1,
        this.selectionSequence - candidate.state.lastUsedSequence + 1,
      );
      const score = age * Math.max(candidate.evaluation.remainingFraction, EPSILON);
      if (score > bestScore + EPSILON) {
        bestScore = score;
        best = [candidate];
      } else if (Math.abs(score - bestScore) <= EPSILON) {
        best.push(candidate);
      }
    }
    if (best.length === 1) return best[0];

    const weights = best.map(
      (candidate) => Math.max(candidate.evaluation.remainingFraction, EPSILON),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const random = Math.min(1 - Number.EPSILON, Math.max(0, finiteNumber(this.rng(), 0)));
    let target = random * total;
    for (let index = 0; index < best.length; index += 1) {
      target -= weights[index];
      if (target < 0) return best[index];
    }
    return best.at(-1);
  }

  async select(options = {}) {
    const providerIds = options.providerIds == null
      ? [...this.providers.keys()]
      : [...new Set(options.providerIds)];
    const tokens = options.tokens ?? 1;
    const now = this.clock();
    const eligible = [];
    const blocked = [];

    for (const providerId of providerIds) {
      const provider = this.providers.get(providerId);
      const state = this.states.get(providerId);
      if (!provider || !state) continue;
      const tokenCost = resolveTokenCost(tokens, provider);
      const evaluation = this.evaluate(provider, state, tokenCost, now);
      const item = { provider, state, tokenCost, evaluation };
      if (evaluation.eligible) eligible.push(item);
      else blocked.push(item);
    }

    if (eligible.length === 0) {
      const possible = blocked.filter((item) => !item.evaluation.impossible);
      const retryMs = possible.length > 0
        ? Math.min(...possible.map((item) => item.evaluation.retryMs))
        : Infinity;
      const details = blocked.map((item) => ({
        provider: item.provider.id,
        reasons: item.evaluation.reasons,
      }));
      const reason = details.length > 0
        ? details
          .map((item) => `${item.provider}: ${item.reasons.join(', ')}`)
          .join('; ')
        : 'No matching providers are configured';
      return {
        ok: false,
        status: 429,
        retryAfter: secondsFromMilliseconds(retryMs),
        reason,
        details,
      };
    }

    const selected = this.choose(eligible);
    for (const [name, bucket] of Object.entries(selected.state.buckets)) {
      refillBucket(bucket, name, now);
      bucket.tokens -= bucketCost(name, selected.tokenCost);
    }
    this.selectionSequence += 1;
    selected.state.lastUsedAt = now;
    selected.state.lastUsedSequence = this.selectionSequence;
    if (selected.evaluation.breaker === 'half-open') {
      selected.state.halfOpenInFlight = true;
    }
    await this.persist();
    return {
      ok: true,
      provider: selected.provider,
      tokenCost: selected.tokenCost,
      halfOpen: selected.evaluation.breaker === 'half-open',
    };
  }

  async recordObservedLimit(providerId, name, limit, options = {}) {
    if (this.observedLimitsPath == null) return null;
    const update = async () => {
      const provider = this.providers.get(providerId);
      const state = this.states.get(providerId);
      if (!provider || !state) throw new Error(`Unknown provider "${providerId}"`);
      const entry = await writeObservedLimit(providerId, name, limit, {
        path: this.observedLimitsPath,
        clock: this.clock,
        current: this.observedDocument,
        source: options.source ?? 'passive',
        details: options.details,
      });
      this.observedDocument = await loadObservedLimits({ path: this.observedLimitsPath });
      provider.observedLimits ??= {};
      provider.observedLimits[name] = entry;
      provider.configuredLimits ??= { ...provider.limits };
      provider.limits[name] = limit;
      const bucket = state.buckets[name];
      if (bucket) {
        const consumed = Math.max(0, bucket.capacity - bucket.tokens);
        bucket.capacity = limit;
        bucket.tokens = Math.max(0, Math.min(limit, limit - consumed));
      } else {
        state.buckets[name] = makeBucket(limit, this.clock());
      }
      return entry;
    };
    this.observedPersistQueue = this.observedPersistQueue.catch(() => {}).then(update);
    return this.observedPersistQueue;
  }

  async recordRateLimit(providerId, retryAfter = null, details = {}) {
    const state = this.states.get(providerId);
    if (!state) throw new Error(`Unknown provider "${providerId}"`);
    const now = this.clock();
    state.rateLimitFailures += 1;
    const headerDelay = retryAfterMilliseconds(retryAfter, now);
    const delayMs = headerDelay ?? (1000 * (2 ** Math.min(state.rateLimitFailures - 1, 20)));
    state.cooldownUntil = now + delayMs;
    state.halfOpenInFlight = false;
    const dailySignal = /(?:daily|per[ -]?day|\brpd\b|daily quota)/i.test(
      String(details.errorBody ?? ''),
    ) || (headerDelay != null && headerDelay >= 3_600_000);
    if (dailySignal && state.buckets.rpd) {
      const used = Math.max(
        1,
        Math.ceil(state.buckets.rpd.capacity - state.buckets.rpd.tokens),
      );
      await this.recordObservedLimit(providerId, 'rpd', used, {
        source: 'passive-429',
        details: { retryAfter },
      });
    }
    await this.persist();
    return { delayMs, retryAfter: Math.max(0, Math.ceil(delayMs / 1000)) };
  }

  async handle429(providerId, retryAfter = null) {
    return this.recordRateLimit(providerId, retryAfter);
  }

  async recordFailure(providerId, reason = 'failure') {
    const state = this.states.get(providerId);
    if (!state) throw new Error(`Unknown provider "${providerId}"`);
    const now = this.clock();
    const wasProbe = breakerState(state, now) === 'half-open' || state.halfOpenInFlight;
    state.halfOpenInFlight = false;
    state.consecutiveFailures = wasProbe
      ? BREAKER_FAILURE_THRESHOLD
      : state.consecutiveFailures + 1;
    if (state.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
      state.breakerOpenUntil = now + BREAKER_OPEN_MS;
    }
    await this.persist();
    return {
      reason,
      consecutiveFailures: state.consecutiveFailures,
      breaker: breakerState(state, now),
      retryAfter: state.breakerOpenUntil > now
        ? secondsFromMilliseconds(state.breakerOpenUntil - now)
        : null,
    };
  }

  async recordSuccess(providerId) {
    const state = this.states.get(providerId);
    if (!state) throw new Error(`Unknown provider "${providerId}"`);
    const now = this.clock();
    // A success from another request that was already in flight must not
    // cancel a Retry-After cooldown or a newly-open breaker.
    if (state.cooldownUntil <= now) {
      state.cooldownUntil = 0;
      state.rateLimitFailures = 0;
    }
    if (state.breakerOpenUntil === 0) {
      state.consecutiveFailures = 0;
      state.halfOpenInFlight = false;
    } else if (state.breakerOpenUntil <= now && state.halfOpenInFlight) {
      state.consecutiveFailures = 0;
      state.breakerOpenUntil = 0;
      state.halfOpenInFlight = false;
    }
    await this.persist();
  }

  async reconcileTokens(providerId, reserved, actual) {
    const state = this.states.get(providerId);
    if (!state) throw new Error(`Unknown provider "${providerId}"`);
    const bucket = state.buckets.tpm;
    if (!bucket) return;
    if (!Number.isFinite(reserved) || !Number.isFinite(actual) || actual < 0) return;
    refillBucket(bucket, 'tpm', this.clock());
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + reserved - actual);
    await this.persist();
  }

  status(options = {}) {
    const now = this.clock();
    const tokens = options.tokens ?? 1;
    const report = [];
    for (const [providerId, provider] of this.providers) {
      const state = this.states.get(providerId);
      const tokenCost = resolveTokenCost(tokens, provider);
      const evaluation = this.evaluate(provider, state, tokenCost, now);
      report.push({
        id: provider.id,
        provider: provider.provider ?? provider.id,
        configured: provider.configured !== false,
        configuredLimits: {
          ...(provider.configuredLimits ?? provider.limits),
        },
        observedLimits: Object.fromEntries(
          Object.entries(provider.observedLimits ?? {}).map(([name, entry]) => [
            name,
            { ...entry },
          ]),
        ),
        effectiveLimits: { ...provider.limits },
        eligible: evaluation.eligible,
        retryAfter: evaluation.eligible
          ? 0
          : secondsFromMilliseconds(evaluation.retryMs),
        cooldownUntil: state.cooldownUntil || null,
        breaker: breakerState(state, now),
        consecutiveFailures: state.consecutiveFailures,
        lastUsedAt: state.lastUsedAt,
        buckets: Object.fromEntries(
          Object.entries(state.buckets).map(([name, bucket]) => [
            name,
            {
              limit: bucket.capacity,
              remaining: Math.max(0, bucket.tokens),
              fraction: Math.max(0, bucket.tokens / bucket.capacity),
            },
          ]),
        ),
        reasons: evaluation.reasons,
      });
    }
    return report;
  }

  nextRetry(options = {}) {
    const now = this.clock();
    const providerIds = options.providerIds == null
      ? [...this.providers.keys()]
      : [...new Set(options.providerIds)];
    const tokens = options.tokens ?? 1;
    const waits = [];
    for (const providerId of providerIds) {
      const provider = this.providers.get(providerId);
      const state = this.states.get(providerId);
      if (!provider || !state) continue;
      const tokenCost = resolveTokenCost(tokens, provider);
      const evaluation = this.evaluate(provider, state, tokenCost, now);
      if (evaluation.eligible) return 0;
      if (!evaluation.impossible) waits.push(evaluation.retryMs);
    }
    return waits.length > 0
      ? secondsFromMilliseconds(Math.min(...waits))
      : 60;
  }
}

export async function createScheduler(providers, options = {}) {
  return Scheduler.create(providers, options);
}
