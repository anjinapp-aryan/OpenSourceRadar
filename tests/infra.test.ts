import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthenticationError, GitHubApiError, InvalidResponseError, NetworkError, NotFoundError, RateLimitError } from '../src/github/errors';
import { GitHubHttpClient } from '../src/github/http';
import { RateGuard } from '../src/github/rateGuard';
import type { RateLimitInfo } from '../src/github/rateLimit';
import { CachingStarHistoryProvider, JsonFileStarHistoryStore } from '../src/github/starHistoryCache';
import type { GitHubStarHistoryProvider } from '../src/github/providers';
import { readJsonIfExists, writeJsonAtomic } from '../src/io/atomicWrite';
import { checkStarHistory, hasErrors } from '../src/quality/checks';
import { mapWithConcurrency } from '../src/util/concurrency';
import { retryDelayMs, withRetry } from '../src/util/retry';
import { fakeFetch, RL_HEADERS } from './helpers';
import { bucket, seriesOf, weeksEndingAt } from './shHelpers';

/** A reset time one hour ahead; the guard (correctly) ignores observations whose reset has passed. */
const FUTURE_RESET = { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) };

const info = (remaining: number, resetInMs: number, now: number): RateLimitInfo => ({
  limit: 60,
  remaining,
  used: 60 - remaining,
  resetAt: new Date(now + resetInMs),
  resource: 'core',
});

describe('retry', () => {
  it('backs off exponentially and gives up after `attempts`', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new NetworkError('x');
      }, { attempts: 4, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(4);
    expect(delays).toEqual([100, 200, 400]);
  });

  it('never retries deterministic failures', () => {
    for (const e of [new AuthenticationError('a'), new NotFoundError('n'), new InvalidResponseError('i'), new GitHubApiError('c', { status: 422 }), new RateLimitError('r')]) {
      expect(retryDelayMs(e, 1)).toBeNull();
    }
    expect(retryDelayMs(new GitHubApiError('s', { status: 503 }), 1)).toBe(500);
    expect(retryDelayMs(new RateLimitError('r', { retryAfterSeconds: 5 }), 1)).toBe(5000);
    expect(retryDelayMs(new RateLimitError('r', { retryAfterSeconds: 999 }), 1)).toBeNull();
  });

  it('returns the first success', async () => {
    let n = 0;
    expect(await withRetry(async () => (++n < 2 ? Promise.reject(new NetworkError('x')) : 'ok'), { baseDelayMs: 0, sleep: async () => undefined })).toBe('ok');
  });
});

describe('RateGuard (controlled request rate)', () => {
  it('allows requests until the reserve is reached, then throws RateLimitError with resetAt', async () => {
    const now = 1_000_000;
    const guard = new RateGuard({ reserve: 5, now: () => now });
    await guard.beforeRequest('core'); // nothing observed yet: allowed
    guard.record('core', info(6, 60_000, now));
    await guard.beforeRequest('core');
    guard.record('core', info(5, 60_000, now));
    const err = await guard.beforeRequest('core').catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resource).toBe('core');
    expect(err.resetAt).toEqual(new Date(now + 60_000));
  });

  it('buckets are independent', async () => {
    const guard = new RateGuard({ reserve: 5 });
    guard.record('core', info(0, 60_000, Date.now()));
    await expect(guard.beforeRequest('search')).resolves.toBeUndefined();
    await expect(guard.beforeRequest('core')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('waits for a reset that is within maxWaitMs', async () => {
    const now = 5_000_000;
    const slept: number[] = [];
    const guard = new RateGuard({ reserve: 5, maxWaitMs: 30_000, now: () => now, sleep: async (ms) => void slept.push(ms) });
    guard.record('core', info(0, 10_000, now));
    await guard.beforeRequest('core');
    expect(slept).toEqual([14_000]); // 10 s to reset + 3 s clock-skew margin + 1 s
    await guard.beforeRequest('core'); // observation cleared after the wait
  });

  it('forgets a stale observation once its reset time has passed', async () => {
    let now = 1_000;
    const guard = new RateGuard({ reserve: 5, now: () => now });
    guard.record('core', info(0, 500, now));
    now = 5_000;
    await expect(guard.beforeRequest('core')).resolves.toBeUndefined();
  });

  it('is fed by the HTTP client and stops the run before the reserve is spent', async () => {
    const remaining = ['8', '6', '5'];
    let i = 0;
    const f = fakeFetch(() => ({ body: [], headers: { ...RL_HEADERS, ...FUTURE_RESET, 'x-ratelimit-remaining': remaining[i++] ?? '0' } }));
    const client = new GitHubHttpClient({ token: 't'.repeat(20), fetchImpl: f.impl, guard: new RateGuard({ reserve: 5 }) });
    await client.rest('/a', { operation: 'x' });
    await client.rest('/a', { operation: 'x' });
    await client.rest('/a', { operation: 'x' }); // remaining now 5 = reserve
    await expect(client.rest('/a', { operation: 'x' })).rejects.toBeInstanceOf(RateLimitError);
    expect(f.calls).toHaveLength(3); // the 4th request was never sent
  });

  it('search and core paths use different buckets', async () => {
    const f = fakeFetch(() => ({ body: {}, headers: { ...RL_HEADERS, ...FUTURE_RESET, 'x-ratelimit-remaining': '0', 'x-ratelimit-resource': 'core' } }));
    const client = new GitHubHttpClient({ token: 't'.repeat(20), fetchImpl: f.impl, guard: new RateGuard({ reserve: 5 }) });
    await client.rest('/repos/a/b', { operation: 'x' });
    await expect(client.rest('/repos/a/c', { operation: 'x' })).rejects.toBeInstanceOf(RateLimitError);
    await expect(client.rest('/search/repositories', { operation: 'x' })).resolves.toBeDefined();
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and preserves input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);
    const res = await mapWithConcurrency(items, 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 - (n % 5)));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(res.map((r) => (r.ok ? r.value : null))).toEqual(items.map((n) => n * 2));
  });

  it('isolates failures', async () => {
    const res = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('two');
      return n;
    });
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it('stops starting new work when asked', async () => {
    let stop = false;
    const started: number[] = [];
    const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (n) => {
      started.push(n);
      if (n === 2) stop = true;
      return n;
    }, { shouldStop: () => stop, stopError: () => new Error('halted') });
    expect(started).toEqual([1, 2]);
    expect(res.slice(2).every((r) => !r.ok)).toBe(true);
  });

  it('rejects an invalid limit', async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('star-history cache', () => {
  function counting(): GitHubStarHistoryProvider & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async fetchStarHistory(repo) {
        calls.push(`${repo.owner}/${repo.name}`);
        await new Promise((r) => setTimeout(r, 2));
        return seriesOf([bucket(0)], true, { repository: `${repo.owner}/${repo.name}` });
      },
    };
  }

  it('serves repeat requests from memory, case-insensitively', async () => {
    const inner = counting();
    const cache = new CachingStarHistoryProvider(inner);
    await cache.fetchStarHistory({ owner: 'A', name: 'B' });
    await cache.fetchStarHistory({ owner: 'a', name: 'b' });
    expect(inner.calls).toHaveLength(1);
    expect(cache.stats).toMatchObject({ misses: 1, coalesced: 1 });
  });

  it('coalesces concurrent identical requests into one upstream call', async () => {
    const inner = counting();
    const cache = new CachingStarHistoryProvider(inner);
    await Promise.all([1, 2, 3, 4, 5].map(() => cache.fetchStarHistory({ owner: 'a', name: 'b' })));
    expect(inner.calls).toHaveLength(1);
    expect(cache.stats.coalesced).toBe(4);
  });

  it('different page limits are different entries', async () => {
    const inner = counting();
    const cache = new CachingStarHistoryProvider(inner);
    await cache.fetchStarHistory({ owner: 'a', name: 'b' }, { maxPages: 1 });
    await cache.fetchStarHistory({ owner: 'a', name: 'b' }, {});
    expect(inner.calls).toHaveLength(2);
  });

  it('never caches a failure', async () => {
    let n = 0;
    const inner: GitHubStarHistoryProvider = {
      async fetchStarHistory() {
        if (++n === 1) throw new NetworkError('down');
        return seriesOf([bucket(0)], true);
      },
    };
    const cache = new CachingStarHistoryProvider(inner);
    await expect(cache.fetchStarHistory({ owner: 'a', name: 'b' })).rejects.toBeInstanceOf(NetworkError);
    await expect(cache.fetchStarHistory({ owner: 'a', name: 'b' })).resolves.toBeDefined();
    expect(n).toBe(2);
  });

  it('persistent store: reused within TTL, ignored after it, corrupt file discarded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'osr-cache-'));
    try {
      const path = join(dir, 'c.json');
      const inner = counting();
      let store = await JsonFileStarHistoryStore.open(path);
      let now = Date.parse('2026-09-24T12:00:00Z');
      const first = new CachingStarHistoryProvider(inner, { store, now: () => now });
      await first.fetchStarHistory({ owner: 'a', name: 'b' });
      await store.flush();

      store = await JsonFileStarHistoryStore.open(path);
      const second = new CachingStarHistoryProvider(inner, { store, now: () => now + 3_600_000 });
      await second.fetchStarHistory({ owner: 'a', name: 'b' });
      expect(inner.calls).toHaveLength(1);
      expect(second.stats.storeHits).toBe(1);

      const third = new CachingStarHistoryProvider(inner, { store, ttlMs: 1000, now: () => now + 3_600_000 });
      await third.fetchStarHistory({ owner: 'a', name: 'b' });
      expect(inner.calls).toHaveLength(2);

      await writeFile(path, '{not json');
      store = await JsonFileStarHistoryStore.open(path);
      expect(store.get('a/b#pages=all')).toBeUndefined();
      now += 1;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('atomic write', () => {
  it('writes complete JSON and leaves no temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'osr-atomic-'));
    try {
      const path = join(dir, 'sub', 'out.json');
      await writeJsonAtomic(path, { a: 1 });
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 1 });
      await writeJsonAtomic(path, { a: 2 });
      expect(await readJsonIfExists(path)).toEqual({ a: 2 });
      expect(await readdir(join(dir, 'sub'))).toEqual(['out.json']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a failed write keeps the old file and removes the temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'osr-atomic-'));
    try {
      const path = join(dir, 'out.json');
      await writeJsonAtomic(path, { keep: true });
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      await expect(writeJsonAtomic(path, circular)).rejects.toThrow();
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ keep: true });
      expect(await readdir(dir)).toEqual(['out.json']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a rename failure (target is a directory) cleans up the temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'osr-atomic-'));
    try {
      const target = join(dir, 'out.json');
      await writeJsonAtomic(join(target, 'x.json'), {}); // makes `out.json` a directory
      await expect(writeJsonAtomic(target, { a: 1 })).rejects.toThrow();
      expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('readJsonIfExists returns undefined for a missing file', async () => {
    expect(await readJsonIfExists(join(tmpdir(), 'osr-does-not-exist.json'))).toBeUndefined();
  });
});

describe('data-quality checks', () => {
  const asOf = new Date('2026-09-24T12:00:00Z');
  const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

  it('a clean complete series has no issues', () => {
    const weeks = weeksEndingAt('2026-09-24', 5, 2);
    const total = weeks.reduce((s, w) => s + w.total, 0);
    expect(checkStarHistory(seriesOf(weeks, true), total, asOf)).toEqual([]);
  });

  it('flags a total mismatch (info when within 2, warning otherwise)', () => {
    const weeks = weeksEndingAt('2026-09-24', 5, 2);
    const total = weeks.reduce((s, w) => s + w.total, 0);
    expect(checkStarHistory(seriesOf(weeks, true), total + 2, asOf).find((i) => i.code === 'TOTAL_MISMATCH')?.severity).toBe('info');
    expect(checkStarHistory(seriesOf(weeks, true), total + 50, asOf).find((i) => i.code === 'TOTAL_MISMATCH')?.severity).toBe('warning');
  });

  it('history exceeding the star count is an error on partial series', () => {
    const weeks = weeksEndingAt('2026-09-24', 5, 2);
    const issues = checkStarHistory(seriesOf(weeks, false), 3, asOf);
    expect(codes(issues)).toContain('HISTORY_EXCEEDS_STARS');
    expect(hasErrors(issues)).toBe(true);
  });

  it('flags unordered weeks, future weeks, non-midnight weeks, empty series, rollover and restart', () => {
    expect(codes(checkStarHistory(seriesOf([bucket(1), bucket(0)], false), null, asOf))).toContain('UNORDERED');
    const future = { ...bucket(0), week: Date.parse('2026-12-06T00:00:00Z') / 1000 };
    expect(codes(checkStarHistory(seriesOf([future], false), 10, asOf))).toContain('FUTURE_WEEK');
    expect(codes(checkStarHistory(seriesOf([{ ...bucket(0), week: bucket(0).week + 3600 }], false), 10, asOf))).toContain('WEEK_NOT_UTC_MIDNIGHT');
    expect(codes(checkStarHistory(seriesOf([], true), 0, asOf))).toContain('EMPTY_SERIES');
    const issues = checkStarHistory(seriesOf([bucket(0)], true, { rolloverDuplicates: 2, restarted: true }), 7, asOf);
    expect(codes(issues)).toEqual(expect.arrayContaining(['ROLLOVER_DUPLICATES', 'WALK_RESTARTED']));
  });

  it('no anchor and partial history is reported, not guessed', () => {
    expect(codes(checkStarHistory(seriesOf([bucket(0)], false), null, asOf))).toContain('NO_ANCHOR');
  });
});

describe('drift tolerance in quality checks', () => {
  it('history slightly above the star count is info, not an error', () => {
    const weeks = weeksEndingAt('2026-09-24', 5, 2);
    const total = weeks.reduce((s, w) => s + w.total, 0);
    const issues = checkStarHistory(seriesOf(weeks, true), total - 1, new Date('2026-09-24T12:00:00Z'));
    expect(issues.find((i) => i.code === 'STAR_COUNT_DRIFT')?.severity).toBe('info');
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('RateGuard per-bucket defaults', () => {
  it('search keeps a reserve of 2, core of 5', async () => {
    const guard = new RateGuard();
    guard.record('search', info(3, 60_000, Date.now()));
    guard.record('core', info(5, 60_000, Date.now()));
    await expect(guard.beforeRequest('search')).resolves.toBeUndefined();
    await expect(guard.beforeRequest('core')).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('stringifyCompact', () => {
  it('keeps number arrays on one line, everything else pretty, and round-trips exactly', async () => {
    const { stringifyCompact } = await import('../src/io/atomicWrite');
    const data = { gains: [1, 2, 3], empty: [], mixed: [1, 'a'], text: 'see [1,  2] and "@@x:1,2@@"', nested: { n: [0, 10, 0] } };
    const out = stringifyCompact(data);
    expect(JSON.parse(out)).toEqual(data);
    expect(out).toContain('"gains": [1, 2, 3]');
    expect(out).toContain('"n": [0, 10, 0]');
    expect(out).toContain('"empty": []');
    expect(out).toContain('see [1,  2]');
  });
});

describe('retry of primary rate limits that refill soon', () => {
  it('waits for a reset within the cap (plus skew margin) and refuses far or long-past resets', () => {
    const now = () => 1_000_000;
    const soon = new RateLimitError('r', { resetAt: new Date(1_000_000 + 20_000) });
    expect(retryDelayMs(soon, 1, { now })).toBe(25_000); // 20 s + 3 s skew margin + 2 s pause
    expect(retryDelayMs(new RateLimitError('r', { resetAt: new Date(1_000_000 + 3_600_000) }), 1, { now })).toBeNull();
    expect(retryDelayMs(new RateLimitError('r', { resetAt: new Date(1_000_000 - 60_000) }), 1, { now })).toBeNull();
    expect(retryDelayMs(new RateLimitError('r', { resetAt: new Date(1_000_000 - 2_000) }), 1, { now })).toBe(3_000);
    // reset stated 4 s ago but the bucket is still limited (measured live): wait a little and try again
    expect(retryDelayMs(new RateLimitError('r', { resetAt: new Date(1_000_000 - 4_000) }), 1, { now })).toBe(2_000);
    expect(retryDelayMs(new RateLimitError('r', { resetAt: new Date(1_000_000 - 4_000) }), 2, { now })).toBe(4_000);
  });
});
