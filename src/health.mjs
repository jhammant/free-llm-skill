import { createRedactor } from './redact.mjs';
import { listProviderModels } from './provider-client.mjs';
import { loadObservedLimits } from './observed-limits.mjs';
import { providerDefinition } from './providers.mjs';

function retrySeconds(value, now = Date.now()) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.ceil(Number(text)));
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

export async function checkProviders(providers, options = {}) {
  const redactor = options.redactor ?? createRedactor(
    providers.map((provider) => provider.apiKey),
  );
  const schedulerStatus = new Map(
    (options.schedulerStatus ?? []).map((provider) => [provider.id, provider]),
  );
  const checked = await Promise.all(providers.map(async (provider) => {
    if (provider.configured === false || !provider.apiKey) {
      return {
        id: provider.id,
        provider: provider.provider ?? provider.id,
        state: 'unconfigured',
        models: 0,
        latencyMs: null,
        reason: `${provider.apiKeyEnv} unset — skipped`,
        apiKeyEnv: provider.apiKeyEnv,
      };
    }
    const result = await listProviderModels(provider, {
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs ?? 5_000,
    });
    const budget = schedulerStatus.get(provider.id)?.buckets?.rpd ?? null;
    if (result.ok) {
      return {
        id: provider.id,
        provider: provider.provider ?? provider.id,
        state: 'working',
        models: result.models.length,
        latencyMs: result.latencyMs,
        reason: 'working',
        budget,
      };
    }
    if (result.status === 429) {
      const seconds = retrySeconds(result.retryAfter, (options.clock ?? Date.now)());
      return {
        id: provider.id,
        provider: provider.provider ?? provider.id,
        state: 'throttled',
        models: 0,
        latencyMs: result.latencyMs,
        reason: redactor.string(
          seconds == null
            ? `${result.reason} — cooling (not an error)`
            : `${result.reason} — cooling for ${seconds}s (not an error)`,
        ),
        retryAfter: seconds,
        budget,
      };
    }
    return {
      id: provider.id,
      provider: provider.provider ?? provider.id,
      state: 'broken',
      models: 0,
      latencyMs: result.latencyMs,
      status: result.status,
      reason: redactor.string(result.reason),
      budget,
    };
  }));
  return {
    providers: checked,
    exitCode: checked.some((provider) => provider.state === 'broken') ? 1 : 0,
  };
}

function isSuccess(entry) {
  const status = Number(entry.status ?? 0);
  return entry.outcome === 'ok' || (status >= 200 && status < 300);
}

function isFailure(entry) {
  return !isSuccess(entry) && entry.outcome !== 'no_provider' && entry.outcome !== 'exhausted';
}

function limitsDiverged(provider, observed) {
  const drift = [];
  for (const name of ['rpm', 'rpd', 'tpm']) {
    const configured = provider.limits?.[name] ?? null;
    const entry = observed?.[name];
    if (entry && entry.limit !== configured) {
      drift.push({
        name,
        configured,
        observed: entry.limit,
        observedAt: entry.observedAt,
      });
    }
  }
  return drift;
}

function resetDescription(last, scheduler) {
  const seconds = Number(last?.retryAfter ?? scheduler?.retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3_600)}h`;
}

function nextAction(provider, recent, scheduler, drift) {
  if (provider.configured === false || !provider.apiKey) {
    return `export ${provider.apiKeyEnv}, then run free-llm check`;
  }
  const last = [...recent].reverse().find(isFailure);
  const definition = providerDefinition(provider.provider) ?? providerDefinition(provider.id);
  const keyPage = definition?.actionUrl ?? definition?.keyUrl ?? provider.baseUrl;
  const body = String(last?.error ?? '').toLowerCase();
  if (last?.status === 401) return `regenerate the key at ${keyPage}`;
  if (last?.status === 403) return `check this key's model permissions at ${keyPage}`;
  if (
    last?.status === 404
    || /model.+(?:removed|not found|unavailable|not available)/.test(body)
  ) {
    return 'refresh the configured model list; this model may have left the free tier';
  }
  if (last?.status === 429 || last?.outcome === 'rate_limited') {
    const reset = resetDescription(last, scheduler);
    if (/daily|per day|rpd|quota/.test(body) || (reset && /h$/.test(reset))) {
      return `daily cap reached${reset ? `; it resets in about ${reset}` : ''}`;
    }
    return `wait for the cooldown${reset ? ` (${reset})` : ''}, then retry`;
  }
  if (drift.length > 0) return 'keep the observed limit and update the configured limit to match';
  if (last?.outcome === 'timeout' || last?.outcome === 'network_error') {
    return 'check network access and the provider base URL, then run free-llm check';
  }
  const successCount = recent.filter(isSuccess).length;
  if (recent.length > 0 && successCount / recent.length < 0.9) {
    return 'run free-llm check, then inspect the latest failing model';
  }
  return 'no action needed';
}

export async function diagnoseProviders(providers, entries, options = {}) {
  const redactor = options.redactor ?? createRedactor(
    providers.map((provider) => provider.apiKey),
  );
  const observedDocument = options.observedLimits ?? await loadObservedLimits({
    path: options.observedLimitsPath,
    env: options.env,
  });
  const schedulerStatus = new Map(
    (options.schedulerStatus ?? []).map((provider) => [provider.id, provider]),
  );
  const reports = providers.map((provider) => {
    const recent = entries
      .filter((entry) => entry.provider === provider.id)
      .slice(-100);
    const successes = recent.filter(isSuccess).length;
    const failures = recent.filter(isFailure).length;
    const successRate = recent.length === 0 ? null : successes / recent.length;
    const lastError = [...recent].reverse().find(isFailure) ?? null;
    const drift = limitsDiverged(
      provider,
      observedDocument.providers?.[provider.id],
    );
    return {
      id: provider.id,
      configured: provider.configured,
      calls: recent.length,
      successes,
      failures,
      successRate,
      degraded: successRate != null && successRate < 0.9,
      lastError: lastError == null ? null : redactor.value({
        timestamp: lastError.timestamp ?? null,
        model: lastError.model ?? null,
        status: lastError.status ?? null,
        latencyMs: lastError.latencyMs ?? null,
        outcome: lastError.outcome ?? null,
        body: lastError.error ?? null,
      }),
      limitDrift: drift,
      nextAction: nextAction(
        provider,
        recent,
        schedulerStatus.get(provider.id),
        drift,
      ),
    };
  });
  return { providers: reports };
}
