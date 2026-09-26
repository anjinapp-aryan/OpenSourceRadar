import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  GitHubApiError,
  InvalidResponseError,
  NetworkError,
  NotFoundError,
  PaginationError,
  RateLimitError,
} from '../src/github/errors';
import { GitHubHttpClient } from '../src/github/http';
import { assembleWeeks, parseStarHistoryPage, RestStarHistoryProvider } from '../src/github/starHistoryProvider';
import { fakeFetch, RL_HEADERS, type FakeReply } from './helpers';
import { bucket, linkNext, pageBody, WEEK } from './shHelpers';

const REPO = { owner: 'acme', name: 'demo' };
const noSleep = { attempts: 3, baseDelayMs: 0, sleep: async () => undefined };

function providerWith(replies: Parameters<typeof fakeFetch>[0], token: string | null = 'ghp_TESTTOKENTESTTOKENTESTTOKEN123456') {
  const f = fakeFetch(replies);
  const client = new GitHubHttpClient({ token, fetchImpl: f.impl });
  const provider = new RestStarHistoryProvider(client, { retry: noSleep, now: () => new Date('2026-09-24T12:00:00Z') });
  return { provider, client, ...f };
}

const ok = (weeks: ReturnType<typeof bucket>[], headers: Record<string, string> = {}): FakeReply => ({
  body: pageBody(weeks),
  headers: { ...RL_HEADERS, ...headers },
});

describe('star history: responses', () => {
  it('1. normal response -> ascending series', async () => {
    const { provider, calls } = providerWith([ok([bucket(0), bucket(1)])]);
    const s = await provider.fetchStarHistory(REPO);
    expect(s.weeks.map((w) => w.week)).toEqual([bucket(0).week, bucket(1).week]);
    expect(s).toMatchObject({ complete: true, pages: 1, requests: 1, rolloverDuplicates: 0, restarted: false, repository: 'acme/demo' });
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.fetchedAt).toBe('2026-09-24T12:00:00.000Z');
    expect(new URL(calls[0]!.url).pathname).toBe('/repos/acme/demo/stargazers/history');
    expect(new URL(calls[0]!.url).searchParams.get('per_page')).toBe('30');
  });

  it('2. empty response -> empty complete series (no invented data)', async () => {
    const { provider } = providerWith([{ body: [], headers: RL_HEADERS }]);
    const s = await provider.fetchStarHistory(REPO);
    expect(s.weeks).toEqual([]);
    expect(s.complete).toBe(true);
  });

  it('3. zero-star repository (all-zero buckets) is preserved as zeros', async () => {
    const zero = [0, 1, 2].map((n) => bucket(n, [0, 0, 0, 0, 0, 0, 0]));
    const { provider } = providerWith([ok(zero)]);
    const s = await provider.fetchStarHistory(REPO);
    expect(s.weeks).toHaveLength(3);
    expect(s.weeks.every((w) => w.total === 0)).toBe(true);
  });

  it('4. multiple weekly buckets keep their per-day counts', async () => {
    const { provider } = providerWith([ok([bucket(0, [1, 2, 3, 4, 5, 6, 7]), bucket(1, [0, 0, 0, 0, 0, 0, 9]), bucket(2)])]);
    const s = await provider.fetchStarHistory(REPO);
    expect(s.weeks[0]!.days).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.weeks[1]!.total).toBe(9);
  });

  it('anonymous client sends no Authorization header (public repositories)', async () => {
    const { provider, calls } = providerWith([ok([bucket(0)])], null);
    await provider.fetchStarHistory(REPO);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('authenticated client sends the bearer token', async () => {
    const { provider, calls } = providerWith([ok([bucket(0)])]);
    await provider.fetchStarHistory(REPO);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });
});

describe('star history: pagination', () => {
  it('6. follows Link rel=next until it disappears', async () => {
    const { provider, calls } = providerWith([
      ok([bucket(4), bucket(5)], { link: linkNext(2, 3) }),
      ok([bucket(2), bucket(3)], { link: linkNext(3, 3) }),
      ok([bucket(0), bucket(1)]),
    ]);
    const s = await provider.fetchStarHistory(REPO);
    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2', '3']);
    expect(s.weeks.map((w) => (w.week - bucket(0).week) / WEEK)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s).toMatchObject({ pages: 3, requests: 3, complete: true });
  });

  it('maxPages stops the walk and marks the series incomplete', async () => {
    const { provider, calls } = providerWith([ok([bucket(2), bucket(3)], { link: linkNext(2, 9) })]);
    const s = await provider.fetchStarHistory(REPO, { maxPages: 1 });
    expect(calls).toHaveLength(1);
    expect(s.complete).toBe(false);
    expect(s.pages).toBe(1);
  });

  it('a Link that skips a page -> PaginationError', async () => {
    const { provider } = providerWith([ok([bucket(4)], { link: linkNext(3, 5) })]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(PaginationError);
  });

  it('an empty page after a next link -> PaginationError', async () => {
    const { provider } = providerWith([ok([bucket(4)], { link: linkNext(2, 2) }), { body: [], headers: RL_HEADERS }]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(PaginationError);
  });
});

describe('star history: week rollover', () => {
  it('5. overlapping week after a rollover is de-duplicated; page 1 copy wins', async () => {
    // Between the two requests a new Sunday started: page 2 begins with the week that ended page 1.
    const { provider } = providerWith([
      ok([bucket(4, [9, 9, 9, 9, 9, 9, 9]), bucket(5)], { link: linkNext(2, 2) }),
      ok([bucket(4, [1, 1, 1, 1, 1, 1, 1]), bucket(3), bucket(2)]),
    ]);
    const s = await provider.fetchStarHistory(REPO);
    expect(s.rolloverDuplicates).toBe(1);
    expect(s.weeks).toHaveLength(4);
    expect(s.weeks.find((w) => w.week === bucket(4).week)!.total).toBe(63);
    expect(s.restarted).toBe(false);
  });

  it('a gap restarts the walk once and succeeds when the second walk is contiguous', async () => {
    const { provider, calls } = providerWith([
      ok([bucket(5), bucket(4)], { link: linkNext(2, 2) }),
      ok([bucket(1), bucket(0)]), // week 2-3 missing -> gap
      ok([bucket(5), bucket(4)], { link: linkNext(2, 2) }),
      ok([bucket(3), bucket(2), bucket(1), bucket(0)]),
    ]);
    const s = await provider.fetchStarHistory(REPO);
    expect(s.restarted).toBe(true);
    expect(s.weeks).toHaveLength(6);
    expect(s.requests).toBe(4);
    expect(calls).toHaveLength(4);
  });

  it('a persistent gap -> PaginationError', async () => {
    const replies = [ok([bucket(5)], { link: linkNext(2, 2) }), ok([bucket(0)])];
    const { provider } = providerWith([...replies, ...replies]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(PaginationError);
  });

  it('assembleWeeks tolerates a one-hour week offset (DST-like) and reports real gaps', () => {
    const shifted = { ...bucket(1), week: bucket(1).week + 3600 };
    expect(assembleWeeks([{ page: 1, buckets: [shifted, bucket(0)] }]).gaps).toBe(0);
    expect(assembleWeeks([{ page: 1, buckets: [bucket(3), bucket(0)] }]).gaps).toBe(1);
  });
});

describe('star history: malformed responses (untrusted input)', () => {
  const day7 = [1, 1, 1, 1, 1, 1, 1];
  const cases: [string, unknown][] = [
    ['not an array', { message: 'weird' }],
    ['null body', null],
    ['bucket is a string', ['x']],
    ['week missing', [{ total: 7, days: day7 }]],
    ['week is a string', [{ week: '1', total: 7, days: day7 }]],
    ['week is a float', [{ week: 1.5, total: 7, days: day7 }]],
    ['total missing', [{ week: 10, days: day7 }]],
    ['total negative', [{ week: 10, total: -1, days: day7 }]],
    ['days missing', [{ week: 10, total: 7 }]],
    ['days wrong length', [{ week: 10, total: 6, days: [1, 1, 1, 1, 1, 1] }]],
    ['days contain a negative', [{ week: 10, total: 5, days: [-1, 1, 1, 1, 1, 1, 2] }]],
    ['days contain a float', [{ week: 10, total: 7, days: [0.5, 1.5, 1, 1, 1, 1, 2] }]],
    ['days do not sum to total', [{ week: 10, total: 8, days: day7 }]],
    ['weeks not newest-first', [{ week: 10, total: 7, days: day7 }, { week: 20, total: 7, days: day7 }]],
    ['duplicate weeks within a page', [{ week: 10, total: 7, days: day7 }, { week: 10, total: 7, days: day7 }]],
  ];

  it.each(cases)('7. rejects: %s', async (_label, body) => {
    const { provider } = providerWith([{ body, headers: RL_HEADERS }]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('7. rejects a 200 with an HTML body', async () => {
    const { provider } = providerWith([{ rawBody: '<html>oops</html>' }]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('parseStarHistoryPage returns validated buckets in input order', () => {
    const out = parseStarHistoryPage(pageBody([bucket(0), bucket(1)]), 1, 'a/b');
    expect(out.map((b) => b.week)).toEqual([bucket(1).week, bucket(0).week]);
  });
});

describe('star history: HTTP failures', () => {
  it('8. 401 -> AuthenticationError, not retried', async () => {
    const { provider, calls } = providerWith([{ status: 401, body: { message: 'Bad credentials' } }]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(AuthenticationError);
    expect(calls).toHaveLength(1);
  });

  it('9. 403 without rate-limit signals -> GitHubApiError, not retried', async () => {
    const { provider, calls } = providerWith([{ status: 403, body: { message: 'Resource not accessible' }, headers: RL_HEADERS }]);
    const err = await provider.fetchStarHistory(REPO).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it('10. 404 -> NotFoundError, not retried', async () => {
    const { provider, calls } = providerWith([{ status: 404, body: { message: 'Not Found' } }]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(1);
  });

  it('422 (documented: validation failed / spammed) -> GitHubApiError, not retried', async () => {
    const { provider, calls } = providerWith([{ status: 422, body: { message: 'Validation Failed' } }]);
    const err = await provider.fetchStarHistory(REPO).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(422);
    expect(calls).toHaveLength(1);
  });

  it('11. primary rate limit (403, remaining 0) -> RateLimitError with resetAt, not retried', async () => {
    const { provider, calls } = providerWith([
      { status: 403, body: { message: 'API rate limit exceeded' }, headers: { ...RL_HEADERS, 'x-ratelimit-remaining': '0' } },
    ]);
    const err = await provider.fetchStarHistory(REPO).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resetAt).toEqual(new Date(1790000000 * 1000));
    expect(calls).toHaveLength(1);
  });

  it('11. secondary limit with a short Retry-After is retried and then succeeds', async () => {
    const { provider, calls } = providerWith([
      { status: 429, body: { message: 'secondary rate limit' }, headers: { 'retry-after': '1' } },
      ok([bucket(0)]),
    ]);
    const s = await provider.fetchStarHistory(REPO);
    expect(calls).toHaveLength(2);
    expect(s.requests).toBe(2);
  });

  it('a Retry-After beyond the cap is not waited for', async () => {
    const { provider, calls } = providerWith([{ status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '3600' } }]);
    await expect(provider.fetchStarHistory(REPO)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(1);
  });

  it('12. network timeout is retried, then surfaces as NetworkError', async () => {
    const { provider, calls } = providerWith(() => new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const err = await provider.fetchStarHistory(REPO).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.message).toContain('TimeoutError');
    expect(calls).toHaveLength(3);
  });

  it('a transient network failure followed by success returns data', async () => {
    let n = 0;
    const { provider } = providerWith(() => (++n === 1 ? new TypeError('fetch failed') : ok([bucket(0)])));
    const s = await provider.fetchStarHistory(REPO);
    expect(s.requests).toBe(2);
  });

  it('5xx is retried', async () => {
    const { provider, calls } = providerWith([{ status: 502, body: { message: 'Bad Gateway' } }, ok([bucket(0)])]);
    await provider.fetchStarHistory(REPO);
    expect(calls).toHaveLength(2);
  });
});
