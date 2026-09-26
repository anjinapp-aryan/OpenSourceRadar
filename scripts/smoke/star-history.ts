import { utcDate, weeksToDailyGains } from '../../src/analysis/starHistory';
import { computeStarWindows } from '../../src/analysis/windows';
import { NotFoundError } from '../../src/github/errors';
import { parseLinkHeader } from '../../src/github/pagination';
import { RestStarHistoryProvider, parseStarHistoryPage } from '../../src/github/starHistoryProvider';
import { checkStarHistory } from '../../src/quality/checks';
import type { RepositoryRef } from '../../src/model/repositorySnapshot';
import { makeClient, Recorder } from './common';

/**
 * Live measurement of GET /repos/{owner}/{repo}/stargazers/history. Works with or
 * without a token. Large/long-history repositories are sampled (first pages + the
 * last page) to stay inside the anonymous 60 requests/hour budget; small and
 * zero-star repositories are walked completely.
 */
const SAMPLES: { label: string; repo: RepositoryRef; mode: 'full' | 'sample' }[] = [
  { label: 'large', repo: { owner: 'vercel', name: 'next.js' }, mode: 'sample' },
  { label: 'long-history', repo: { owner: 'torvalds', name: 'linux' }, mode: 'sample' },
  { label: 'small', repo: { owner: 'encoreshao', name: 'github-trending' }, mode: 'full' },
  { label: 'zero-star', repo: { owner: 'patrick-creates', name: 'rising-repos-tracker' }, mode: 'full' },
];

const HISTORY = (r: RepositoryRef) => `/repos/${r.owner}/${r.name}/stargazers/history`;

async function main() {
  const { client, token } = makeClient({ allowAnonymous: true });
  const rec = new Recorder('star-history', client);
  const provider = new RestStarHistoryProvider(client);
  rec.measurements.authenticated = token !== null;
  const rows: Record<string, unknown>[] = [];
  const asOf = new Date();

  for (const { label, repo, mode } of SAMPLES) {
    const name = `${repo.owner}/${repo.name}`;
    await rec.check(`${label}: ${name} (${mode})`, async () => {
      const row: Record<string, unknown> = { label, repo: name, mode };

      // Raw first page: HTTP status, headers, size, bucket shape.
      const t0 = Date.now();
      const raw = await client.rest<unknown>(HISTORY(repo), { operation: 'smoke.starHistory.raw', repository: name }, { query: { per_page: 30, page: 1 } });
      const link = parseLinkHeader(raw.headers.get('link'));
      const page1 = parseStarHistoryPage(raw.data, 1, name);
      Object.assign(row, {
        httpStatus: raw.status,
        page1Bytes: raw.bytes,
        page1Buckets: page1.length,
        page1DurationMs: raw.durationMs,
        lastPageFromLink: link.last ?? 1,
        etag: raw.headers.get('etag') !== null,
        cacheControl: raw.headers.get('cache-control'),
        corsAllowOrigin: raw.headers.get('access-control-allow-origin'),
        rateLimitAfterPage1: raw.rateLimit,
      });

      // Repo metadata for the cross-check (1 core request).
      const meta = await client.rest<{ stargazers_count: number; created_at: string }>(`/repos/${repo.owner}/${repo.name}`, { operation: 'smoke.starHistory.meta', repository: name });
      row.starsNow = meta.data.stargazers_count;
      row.createdAt = meta.data.created_at;

      // Provider walk: everything for small repos, first two pages for big ones.
      const t1 = Date.now();
      const series = await provider.fetchStarHistory(repo, mode === 'full' ? {} : { maxPages: 2 });
      Object.assign(row, {
        providerRequests: series.requests,
        pages: series.pages,
        buckets: series.weeks.length,
        bytes: series.bytes,
        complete: series.complete,
        rolloverDuplicates: series.rolloverDuplicates,
        restarted: series.restarted,
        walkDurationMs: Date.now() - t1,
        newestWeek: series.weeks.length ? utcDate(series.weeks[series.weeks.length - 1]!.week * 1000) : null,
        oldestFetchedWeek: series.weeks.length ? utcDate(series.weeks[0]!.week * 1000) : null,
      });

      if (mode === 'sample') {
        // Deepest page reachable: proves long-history pagination and yields the earliest bucket.
        const lastPage = link.last ?? 1;
        const last = await client.rest<unknown>(HISTORY(repo), { operation: 'smoke.starHistory.lastPage', repository: name }, { query: { per_page: 30, page: lastPage } });
        const lastBuckets = parseStarHistoryPage(last.data, lastPage, name);
        row.lastPageFetched = { page: lastPage, bytes: last.bytes, buckets: lastBuckets.length, oldestWeek: utcDate(lastBuckets[lastBuckets.length - 1]!.week * 1000), nextLinkPresent: parseLinkHeader(last.headers.get('link')).next !== undefined };
        row.estimatedFullWalkRequests = lastPage; // ESTIMATED: one request per page
      } else {
        const gains = weeksToDailyGains(series.weeks);
        const total = series.weeks.reduce((s, w) => s + w.total, 0);
        row.sumOfBuckets = total;
        row.sumMatchesStars = total === meta.data.stargazers_count;
        row.firstBucketOnOrBeforeCreation = series.weeks.length > 0 && series.weeks[0]!.week * 1000 <= Date.parse(meta.data.created_at);
        row.dailyPoints = gains.length;
        row.windows = computeStarWindows(series, meta.data.stargazers_count, asOf);
        row.qualityIssues = checkStarHistory(series, meta.data.stargazers_count, asOf);
      }
      row.totalDurationMs = Date.now() - t0;
      rows.push(row);
      return row;
    });
  }
  rec.measurements.samples = rows;

  await rec.check('404 for a repository that does not exist maps to NotFoundError', async () => {
    try {
      await provider.fetchStarHistory({ owner: 'this-owner-does-not-exist-xyz', name: 'nope-nope' });
    } catch (e) {
      if (e instanceof NotFoundError) return { mapped: 'NotFoundError' };
      throw e;
    }
    throw new Error('expected a 404');
  });

  // /rate_limit does not consume core budget (documented; verified by the Phase 1 rate-limit smoke test).
  await rec.check('rate limit after the run', async () => {
    const res = await client.rest<{ resources: Record<string, unknown> }>('/rate_limit', { operation: 'smoke.starHistory.rateLimit' });
    rec.measurements.rateLimitAfter = res.data.resources.core;
    return res.data.resources.core;
  });

  // Untestable here, recorded so nobody assumes otherwise.
  rec.measurements.notObserved = ['week rollover during a walk (needs a walk spanning Saturday->Sunday 00:00 UTC)', 'HTTP 403/422 from the endpoint', 'If-None-Match / 304 behaviour (client does not send it yet)'];
  rec.finish();
}

main().catch((e) => {
  console.error('smoke:star-history crashed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
