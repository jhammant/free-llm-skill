import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scheduler } from '../src/scheduler.mjs';

function provider(id, limits) {
  return {
    id,
    provider: id,
    configured: true,
    limits: { rpm: null, rpd: null, tpm: null, ...limits },
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'free-llm-scheduler-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    statePath: join(directory, 'buckets.json'),
    clock: { now: 0 },
  };
}

test('an exhausted RPM bucket blocks without overshooting and refills', async (t) => {
  const current = await fixture(t);
  const scheduler = await Scheduler.create(
    [provider('only', { rpm: 1 })],
    {
      statePath: current.statePath,
      clock: () => current.clock.now,
      rng: () => 0,
    },
  );

  assert.equal((await scheduler.select()).ok, true);
  const exhausted = await scheduler.select();
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.retryAfter, 60);
  assert.match(exhausted.reason, /rpm bucket/);
  assert.equal(scheduler.status()[0].buckets.rpm.remaining, 0);

  current.clock.now = 59_999;
  assert.equal((await scheduler.select()).ok, false);
  current.clock.now = 60_000;
  assert.equal((await scheduler.select()).ok, true);
});

test('a daily bucket survives a simulated process restart', async (t) => {
  const current = await fixture(t);
  const providers = [provider('daily', { rpd: 1 })];
  const options = {
    statePath: current.statePath,
    clock: () => current.clock.now,
    rng: () => 0,
  };
  const first = await Scheduler.create(providers, options);
  assert.equal((await first.select()).ok, true);

  const restarted = await Scheduler.create(providers, options);
  const blocked = await restarted.select();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 86_400);

  current.clock.now = 86_400_000;
  assert.equal((await restarted.select()).ok, true);
});

test('least-recent use spreads ten requests across two idle providers', async () => {
  const scheduler = await Scheduler.create([
    provider('alpha', { rpm: 100, rpd: 1_000 }),
    provider('beta', { rpm: 100, rpd: 1_000 }),
  ], {
    statePath: null,
    clock: () => 1_000,
    rng: () => 0,
  });
  const selected = [];
  for (let index = 0; index < 10; index += 1) {
    selected.push((await scheduler.select()).provider.id);
  }
  assert.ok(selected.includes('alpha'));
  assert.ok(selected.includes('beta'));
  const alpha = selected.filter((id) => id === 'alpha').length;
  const beta = selected.filter((id) => id === 'beta').length;
  assert.ok(Math.abs(alpha - beta) <= 2, selected.join(','));
});

test('Retry-After excludes a provider for exactly the advertised interval', async () => {
  let now = 10_000;
  const scheduler = await Scheduler.create(
    [provider('cooling', { rpm: 100 })],
    { statePath: null, clock: () => now, rng: () => 0 },
  );
  const result = await scheduler.recordRateLimit('cooling', '5');
  assert.equal(result.delayMs, 5_000);

  now = 14_999;
  assert.equal((await scheduler.select()).ok, false);
  now = 15_000;
  assert.equal((await scheduler.select()).ok, true);
});

test('429 without Retry-After uses exponential backoff from one second', async () => {
  let now = 0;
  const scheduler = await Scheduler.create(
    [provider('backoff', { rpm: 100 })],
    { statePath: null, clock: () => now },
  );
  assert.equal((await scheduler.recordRateLimit('backoff')).delayMs, 1_000);
  now = 1_000;
  assert.equal((await scheduler.recordRateLimit('backoff')).delayMs, 2_000);
  now = 3_000;
  assert.equal((await scheduler.recordRateLimit('backoff')).delayMs, 4_000);
  now = 7_000;
  await scheduler.recordSuccess('backoff');
  assert.equal((await scheduler.recordRateLimit('backoff')).delayMs, 1_000);
});

test('three failures open the breaker, followed by one half-open probe', async () => {
  let now = 0;
  const scheduler = await Scheduler.create(
    [provider('fragile', { rpm: 100 })],
    { statePath: null, clock: () => now },
  );
  await scheduler.recordFailure('fragile', 'http-500');
  await scheduler.recordFailure('fragile', 'timeout');
  assert.equal(scheduler.status()[0].breaker, 'closed');
  await scheduler.recordFailure('fragile', 'malformed-json');
  assert.equal(scheduler.status()[0].breaker, 'open');
  await scheduler.recordSuccess('fragile');
  assert.equal(
    scheduler.status()[0].breaker,
    'open',
    'a success already in flight must not close a newly-open breaker',
  );
  assert.equal((await scheduler.select()).retryAfter, 60);

  now = 60_000;
  const probe = await scheduler.select();
  assert.equal(probe.ok, true);
  assert.equal(probe.halfOpen, true);
  const duplicateProbe = await scheduler.select();
  assert.equal(duplicateProbe.ok, false);
  assert.match(duplicateProbe.reason, /probe already in flight/);

  await scheduler.recordSuccess('fragile');
  assert.equal(scheduler.status()[0].breaker, 'closed');
  assert.equal((await scheduler.select()).ok, true);
});

test('a request must fit every configured bucket', async () => {
  const scheduler = await Scheduler.create(
    [provider('bounded', { rpm: 10, rpd: 10, tpm: 100 })],
    { statePath: null, clock: () => 0 },
  );
  const tooLarge = await scheduler.select({ tokens: 101 });
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.reason, /tpm request cost 101 exceeds limit 100/);
  assert.equal(scheduler.status({ tokens: 1 })[0].buckets.rpm.remaining, 10);

  assert.equal((await scheduler.select({ tokens: 100 })).ok, true);
  assert.equal((await scheduler.select({ tokens: 1 })).ok, false);
});

test('a corrupt persisted state fails closed instead of resetting allowances', async (t) => {
  const current = await fixture(t);
  await writeFile(current.statePath, '{"version":1,"providers":');
  await assert.rejects(
    Scheduler.create(
      [provider('safe', { rpd: 1 })],
      { statePath: current.statePath, clock: () => 0 },
    ),
    /refusing to reset allowances/,
  );
});

test('lowering a persisted limit preserves absolute usage', async (t) => {
  const current = await fixture(t);
  const options = {
    statePath: current.statePath,
    clock: () => current.clock.now,
    rng: () => 0,
  };
  const original = await Scheduler.create(
    [provider('changing', { rpd: 100 })],
    options,
  );
  for (let count = 0; count < 10; count += 1) {
    assert.equal((await original.select()).ok, true);
  }

  const lowered = await Scheduler.create(
    [provider('changing', { rpd: 20 })],
    options,
  );
  assert.equal(lowered.status()[0].buckets.rpd.remaining, 10);
});

test('an older in-flight success does not cancel Retry-After', async () => {
  let now = 0;
  const scheduler = await Scheduler.create(
    [provider('parallel', { rpm: 100 })],
    { statePath: null, clock: () => now },
  );
  await scheduler.recordRateLimit('parallel', '5');
  await scheduler.recordSuccess('parallel');
  now = 4_999;
  assert.equal((await scheduler.select()).ok, false);
  now = 5_000;
  assert.equal((await scheduler.select()).ok, true);
});
