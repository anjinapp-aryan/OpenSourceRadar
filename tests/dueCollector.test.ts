import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCandidateDataset, type CandidateDataset } from '../src/collect/candidates';
import type { Dataset } from '../src/collect/dataset';
import { GRAPHQL_BATCH_SIZE, inDomain, runDueCollection, type DueDeps, type DueOptions } from '../src/collect/dueCollector';
import type { DiscoveredRepository } from '../src/discovery/discoveryProvider';
import { NotFoundError, RateLimitError } from '../src/github/errors';
import type { GitHubGraphQLProvider, GitHubStarHistoryProvider } from '../src/github/providers';
import { CachingStarHistoryProvider } from '../src/github/starHistoryCache';
import type { RepositoryRef } from '../src/model/repositorySnapshot';
import type { StarHistorySeries } from '../src/model/starHistory';
import { decideTracking } from '../src/tracking/engine';
import { loadTrackingPolicy } from '../src/tracking/config';
import type { TrackedDataset, TrackedRecord } from '../src/tracking/datasets';
import type { TrackingMetrics, TrackingStatus } from '../src/tracking/types';
import { seriesOf, weeksEndingAt } from './shHelpers';

const policy = loadTrackingPolicy();
const NOW = new Date('2026-09-25T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function discovered(id: number, over: Record<string, unknown> = {}): DiscoveredRepository {
  return {
    snapshot: { repositoryId: String(id), owner: 'o', name: `r${id}`, fullName: `o/r${id}`, url: 'u', description: 'd', stars: 5000, forks: 1, openIssues: 0, language: 'Go', topics: ['x'], license: 'MIT', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', pushedAt: '2026-09-20T00:00:00Z', collectedAt: hoursAgo(1000), source: 'rest', ...over },
    domains: ['ai'],
    categories: ['discovery-said-so'],
    hits: 1,
  };
}

function tracked(id: number, tier: TrackingStatus, nextRefreshAt: string, top: TrackedRecord['classification']['topLevelCategory'] = 'AI'): TrackedRecord {
  return {
    id: String(id), fullName: `o/r${id}`, classification: { topLevelCategory: top, categories: ['llm'] }, tier, refreshIntervalHours: 24, reason: 'test',
    signals: { stars: 5000, ageDays: 900, pushedDaysAgo: 5, starsPerDay7d: null, starsPerDay30d: null, growth7d: null, growthPercent7d: null, newEntrant: false, rulesFired: [] },
    assessed: tier !== 'UNASSESSED', tierSince: hoursAgo(500), lastEvaluatedAt: hoursAgo(1), lastCollectedAt: tier === 'UNASSESSED' ? null : hoursAgo(30), nextRefreshAt, transition: null,
  };
}

const trackedDs = (records: TrackedRecord[]): TrackedDataset => ({
  schemaVersion: 1, trackingVersion: 'phase3-v1', generatedAt: hoursAgo(1),
  source: { classifierVersion: 'phase3-v1', classifiedGeneratedAt: hoursAgo(2), growthGeneratedAt: null, candidates: records.length },
  summary: { tracked: records.length, byTier: { HOT: 0, WARM: 0, DORMANT: 0, UNASSESSED: 0 }, unassessed: 0, excluded: { unclassified: 0, archived: 0, other: 0 }, dueNow: 0, estimatedDailyRefreshes: 0 },
  repositories: records,
});

interface HistoryFake extends GitHubStarHistoryProvider {
  calls: string[];
}
function fakeHistory(behaviour: (repo: RepositoryRef, n: number) => StarHistorySeries | Error = () => seriesOf(weeksEndingAt('2026-09-25', 30, 1), false)): HistoryFake {
  const calls: string[] = [];
  return {
    calls,
    async fetchStarHistory(repo) {
      calls.push(`${repo.owner}/${repo.name}`);
      await new Promise((r) => setTimeout(r, 1));
      const out = behaviour(repo, calls.length);
      if (out instanceof Error) throw out;
      return { ...out, repository: `${repo.owner}/${repo.name}` };
    },
  };
}

let dir: string;
let outPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'osr-due-'));
  outPath = join(dir, 'repositories.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const run = (deps: Partial<DueDeps> & Pick<DueDeps, 'starHistory'>, o: Partial<DueOptions> & Pick<DueOptions, 'tracked' | 'candidates'>) =>
  runDueCollection({ now: () => NOW, ...deps }, { policy, outPath, concurrency: 2, ...o });
const read = async (): Promise<Dataset> => JSON.parse(await readFile(outPath, 'utf8'));
const candidatesFor = (ids: number[], over: Record<string, unknown> = {}): CandidateDataset => buildCandidateDataset(ids.map((i) => discovered(i, over)), [], NOW);

describe('due selection', () => {
  it('A/B. collects due repositories and makes no GitHub call for repositories that are not due', async () => {
    const history = fakeHistory();
    const report = await run({ starHistory: history }, {
      tracked: trackedDs([tracked(1, 'WARM', hoursAgo(1)), tracked(2, 'WARM', hoursAgo(-10)), tracked(3, 'HOT', hoursAgo(0))]),
      candidates: candidatesFor([1, 2, 3]),
    });
    expect(history.calls.sort()).toEqual(['o/r1', 'o/r3']);
    expect(report).toMatchObject({ tracked: 3, due: 2, notDue: 1, selected: 2, collected: 2, failures: [], stoppedBy: null, written: true });
    expect((await read()).repositories.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('nothing due -> no calls and no file', async () => {
    const history = fakeHistory();
    const report = await run({ starHistory: history }, { tracked: trackedDs([tracked(1, 'HOT', hoursAgo(-5))]), candidates: candidatesFor([1]) });
    expect(history.calls).toEqual([]);
    expect(report.written).toBe(false);
    expect(await readdir(dir)).toEqual([]);
  });

  describe('refresh policy per tier (the schedule comes from the tracking engine, not the collector)', () => {
    const metrics = (m: Partial<TrackingMetrics>): TrackingMetrics => ({ stars: 20_000, createdAt: '2020-01-01T00:00:00Z', pushedAt: hoursAgo(48), isArchived: false, starsPerDay7d: 1, starsPerDay30d: 1, growth7d: 7, growthPercent7d: 0.03, ...m });
    const decision = (m: Partial<TrackingMetrics>, lastRefreshedHoursAgo: number) => decideTracking({ id: '1', topLevelCategory: 'AI', metrics: metrics(m), lastRefreshedAt: hoursAgo(lastRefreshedHoursAgo) }, policy, NOW);
    const record = (m: Partial<TrackingMetrics>, hoursSince: number): TrackedRecord => {
      const d = decision(m, hoursSince);
      return { ...tracked(1, d.tier, d.nextRefreshAt), tier: d.tier, refreshIntervalHours: d.refreshIntervalHours };
    };
    const dueCount = async (r: TrackedRecord) => {
      const h = fakeHistory();
      await run({ starHistory: h }, { tracked: trackedDs([r]), candidates: candidatesFor([1]) });
      return h.calls.length;
    };
    const hot = { starsPerDay7d: 150, growth7d: 1050 };
    const warm = { starsPerDay7d: 12, starsPerDay30d: 12, growth7d: 84 };
    const dormant = { starsPerDay7d: 0, starsPerDay30d: 0, growth7d: 0, growthPercent7d: 0, stars: 300, pushedAt: hoursAgo(9000) };

    it('C. HOT: due after 24 h, not before', async () => {
      expect(await dueCount(record(hot, 25))).toBe(1);
      expect(await dueCount(record(hot, 20))).toBe(0);
    });
    it('D. WARM: due after 72 h, not before', async () => {
      expect(await dueCount(record(warm, 73))).toBe(1);
      expect(await dueCount(record(warm, 48))).toBe(0);
    });
    it('E. DORMANT: due after 168 h, not before', async () => {
      expect(await dueCount(record(dormant, 169))).toBe(1);
      expect(await dueCount(record(dormant, 100))).toBe(0);
    });
  });

  it('F. UNASSESSED repositories are always due and collected right after HOT (configured order)', async () => {
    const history = fakeHistory();
    await run({ starHistory: history }, {
      tracked: trackedDs([tracked(1, 'WARM', hoursAgo(5)), tracked(2, 'UNASSESSED', NOW.toISOString()), tracked(3, 'HOT', hoursAgo(1)), tracked(4, 'DORMANT', hoursAgo(9))]),
      candidates: candidatesFor([1, 2, 3, 4]),
      concurrency: 1,
    });
    expect(history.calls).toEqual(['o/r3', 'o/r2', 'o/r1', 'o/r4']);
  });

  it('domain and limit narrow the scope of a run; domain never changes a tier', async () => {
    const history = fakeHistory();
    const report = await run({ starHistory: history }, {
      tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString(), 'AI'), tracked(2, 'UNASSESSED', NOW.toISOString(), 'ENGINEERING'), tracked(3, 'UNASSESSED', NOW.toISOString(), 'BOTH')]),
      candidates: candidatesFor([1, 2, 3]),
      domain: 'engineering',
    });
    expect(history.calls.sort()).toEqual(['o/r2', 'o/r3']);
    expect(report.outOfScope).toBe(1);
    expect(inDomain('BOTH', 'ai') && inDomain('BOTH', 'engineering') && !inDomain('ENGINEERING', 'ai')).toBe(true);

    const limited = fakeHistory();
    await run({ starHistory: limited }, { tracked: trackedDs([1, 2, 3, 4].map((i) => tracked(i, 'UNASSESSED', NOW.toISOString()))), candidates: candidatesFor([1, 2, 3, 4]), limit: 2, concurrency: 1 });
    expect(limited.calls).toHaveLength(2);
  });
});

describe('merge, growth metrics, failures', () => {
  it('J/L-P. stores growth windows with null (not zero) for what history cannot cover; merges into existing data', async () => {
    const history = fakeHistory(() => seriesOf(weeksEndingAt('2026-09-25', 4, 3), false)); // only 4 weeks: 7d and ... 30d not covered
    await run({ starHistory: history }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1]) });
    const r = (await read()).repositories[0]!;
    expect(r.growth['7d']).toMatchObject({ status: 'ok', growth: 21, starsPerDay: 3 });
    expect(r.growth['30d']).toEqual({ days: 30, status: 'insufficient-history', starsAgo: null, growth: null, growthPercent: null, starsPerDay: null });
    expect(r.growth['90d'].growth).toBeNull();
    expect(r.growthAsOf).toBe(NOW.toISOString());
  });

  it('preserves records of repositories that were not collected, and replaces the ones that were', async () => {
    const first = fakeHistory();
    await run({ starHistory: first }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString()), tracked(2, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1, 2]) });
    const before = await read();
    const later = new Date(NOW.getTime() + 3_600_000);
    const second = fakeHistory();
    await runDueCollection({ starHistory: second, now: () => later }, {
      tracked: trackedDs([tracked(1, 'HOT', NOW.toISOString()), tracked(2, 'WARM', hoursAgo(-40))]),
      candidates: candidatesFor([1, 2]), existing: before, policy, outPath, concurrency: 1,
    });
    expect(second.calls).toEqual(['o/r1']);
    const after = await read();
    expect(after.repositories.map((r) => r.id)).toEqual(['1', '2']);
    expect(after.repositories[1]).toEqual(before.repositories[1]); // untouched
    expect(after.repositories[0]!.growthAsOf).toBe(later.toISOString());
  });

  it('a repository failure is recorded, keeps the old record, and does not stop the others', async () => {
    const seed = fakeHistory();
    await run({ starHistory: seed }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1]) });
    const before = await read();
    const history = fakeHistory((r) => (r.name === 'r1' ? new NotFoundError('gone') : seriesOf(weeksEndingAt('2026-09-25', 30, 1), false)));
    const report = await runDueCollection({ starHistory: history, now: () => NOW }, {
      tracked: trackedDs([tracked(1, 'HOT', hoursAgo(1)), tracked(2, 'UNASSESSED', NOW.toISOString())]),
      candidates: candidatesFor([1, 2]), existing: before, policy, outPath, concurrency: 1,
    });
    expect(report.failures).toEqual([{ repository: 'o/r1', stage: 'history', reason: expect.stringContaining('NotFoundError') }]);
    expect(report.collected).toBe(1);
    const after = await read();
    expect(after.repositories.find((r) => r.id === '1')).toEqual(before.repositories[0]);
    expect(after.repositories.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('a history that contradicts the star count is a quality failure, not stored data', async () => {
    const history = fakeHistory();
    const report = await run({ starHistory: history }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1], { stars: 5 }) });
    expect(report.failures[0]).toMatchObject({ stage: 'quality', reason: expect.stringContaining('HISTORY_EXCEEDS_STARS') });
    expect(report.written).toBe(false);
  });

  it('a tracked repository without candidate metadata is a recorded failure', async () => {
    const report = await run({ starHistory: fakeHistory() }, { tracked: trackedDs([tracked(9, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1]) });
    expect(report.failures[0]).toMatchObject({ repository: 'o/r9', stage: 'metadata' });
  });
});

describe('safety: partial output, rate limits, resumability', () => {
  it('X. a record that fails validation is never written; the existing file stays byte-identical and no temp files remain', async () => {
    const seed = fakeHistory();
    await run({ starHistory: seed }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1]) });
    const bytes = await readFile(outPath, 'utf8');
    const existing = JSON.parse(bytes) as Dataset;
    const report = await runDueCollection({ starHistory: fakeHistory(), now: () => NOW }, {
      tracked: trackedDs([tracked(2, 'UNASSESSED', NOW.toISOString())]),
      candidates: candidatesFor([2], { createdAt: 'not-a-date' }), existing, policy, outPath,
    });
    expect(report.failures[0]).toMatchObject({ repository: 'o/r2', stage: 'quality' });
    expect(report.written).toBe(false);
    expect(await readFile(outPath, 'utf8')).toBe(bytes);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('Y. a rate limit stops new work at once, keeps what was collected, and reports it', async () => {
    let n = 0;
    const history = fakeHistory(() => (++n === 3 ? new RateLimitError('budget') : seriesOf(weeksEndingAt('2026-09-25', 30, 1), false)));
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    const report = await run({ starHistory: history }, { tracked: trackedDs(ids.map((i) => tracked(i, 'UNASSESSED', NOW.toISOString()))), candidates: candidatesFor(ids), concurrency: 1, chunkSize: 2 });
    expect(report.stoppedBy).toContain('RateLimitError');
    expect(history.calls.length).toBeLessThan(10);
    expect(report.collected).toBe(2);
    expect(report.failures).toEqual([]); // the repository that hit the limit is not a failure: it simply stays due for the next run
    expect((await read()).repositories.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('resumable: chunks are checkpointed, and a second run continues with the repositories that are still due', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => i + 1);
    const t = trackedDs(ids.map((i) => tracked(i, 'UNASSESSED', NOW.toISOString())));
    const cands = candidatesFor(ids);
    let n = 0;
    const flaky = fakeHistory(() => (++n === 5 ? new RateLimitError('budget') : seriesOf(weeksEndingAt('2026-09-25', 30, 1), false)));
    const first = await run({ starHistory: flaky }, { tracked: t, candidates: cands, concurrency: 1, chunkSize: 2 });
    expect(first.collected).toBe(4);
    const saved = await read();
    // the tracker would now mark 1-4 as assessed: simulate that and continue
    const t2 = trackedDs(ids.map((i) => (i <= 4 ? tracked(i, 'HOT', hoursAgo(-20)) : tracked(i, 'UNASSESSED', NOW.toISOString()))));
    const rest = fakeHistory();
    const second = await runDueCollection({ starHistory: rest, now: () => NOW }, { tracked: t2, candidates: cands, existing: saved, policy, outPath, concurrency: 1, chunkSize: 2 });
    expect(rest.calls.sort()).toEqual(['o/r5', 'o/r6']);
    expect(second.datasetRepositories).toBe(6);
    expect((await read()).repositories).toHaveLength(6);
  });

  it('Z. cache: the same repository is never fetched twice by one run, and store entries survive between runs', async () => {
    const inner = fakeHistory();
    const cache = new CachingStarHistoryProvider(inner);
    await run({ starHistory: cache }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1]) });
    await run({ starHistory: cache }, { tracked: trackedDs([tracked(1, 'HOT', hoursAgo(1))]), candidates: candidatesFor([1]), existing: await read() });
    expect(inner.calls).toEqual(['o/r1']);
    expect(cache.stats).toMatchObject({ misses: 1, hits: 0 }); // second call served by the in-flight/in-memory entry
    expect(cache.stats.coalesced).toBe(1);
  });

  it('GraphQL metadata uses the validated batch size of 50 and refreshes stars; unresolved repositories are recorded', async () => {
    expect(GRAPHQL_BATCH_SIZE).toBe(50);
    const seen: number[] = [];
    const graphql: GitHubGraphQLProvider = {
      async fetchRepositories(refs, options) {
        seen.push(options?.batchSize ?? -1);
        const found = refs.filter((r) => r.name !== 'r2');
        return {
          snapshots: found.map((r) => ({ ...discovered(Number(r.name.slice(1))).snapshot, stars: 7000, source: 'graphql' as const })),
          notFound: refs.filter((r) => r.name === 'r2'), requests: 1, cost: 1, rateLimit: null,
        };
      },
    };
    const report = await run({ starHistory: fakeHistory(), graphql }, { tracked: trackedDs([1, 2].map((i) => tracked(i, 'UNASSESSED', NOW.toISOString()))), candidates: candidatesFor([1, 2]) });
    expect(seen).toEqual([50]);
    expect(report.failures).toEqual([{ repository: 'o/r2', stage: 'metadata', reason: 'not found by GraphQL' }]);
    const r = (await read()).repositories[0]!;
    expect(r).toMatchObject({ stars: 7000, metadataSource: 'graphql' });
  });

  it('a rate limit during GraphQL metadata also stops the run cleanly', async () => {
    const graphql: GitHubGraphQLProvider = { async fetchRepositories() { throw new RateLimitError('graphql budget'); } };
    const history = fakeHistory();
    const report = await run({ starHistory: history, graphql }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1]) });
    expect(report.stoppedBy).toContain('RateLimitError');
    expect(history.calls).toEqual([]);
    expect(report.written).toBe(false);
  });
});

describe('stale metadata (anonymous runs reuse candidate metadata that can be hours old)', () => {
  const completeSeries = () => seriesOf(weeksEndingAt('2026-09-25', 4, 3), true); // complete history summing to 4*7*3 - 3 = 81 (the Saturday after asOf is still in the future)

  it('a complete history that exceeds the stale star count corrects the count and records a warning', async () => {
    const history = fakeHistory(completeSeries);
    const report = await run({ starHistory: history }, { tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString())]), candidates: candidatesFor([1], { stars: 40 }) });
    expect(report.failures).toEqual([]);
    const r = (await read()).repositories[0]!;
    expect(r.stars).toBe(81);
    expect(r.quality.map((q) => q.code)).toContain('STARS_FROM_HISTORY');
  });

  it('a partial history that contradicts the metadata is a failure of that repository only; the others are stored', async () => {
    const history = fakeHistory((repo) => (repo.name === 'r1' ? seriesOf(weeksEndingAt('2026-09-25', 30, 1), false) : completeSeries()));
    const report = await run({ starHistory: history }, {
      tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString()), tracked(2, 'UNASSESSED', NOW.toISOString())]),
      candidates: candidatesFor([1, 2], { stars: 50 }), concurrency: 1,
    });
    expect(report.failures).toEqual([{ repository: 'o/r1', stage: 'quality', reason: expect.stringContaining('HISTORY_EXCEEDS_STARS') }]);
    expect((await read()).repositories.map((r) => r.id)).toEqual(['2']);
  });

  it('a single record that fails dataset validation is a quality failure, not an aborted run', async () => {
    const report = await run({ starHistory: fakeHistory(completeSeries) }, {
      tracked: trackedDs([tracked(1, 'UNASSESSED', NOW.toISOString()), tracked(2, 'UNASSESSED', NOW.toISOString())]),
      candidates: buildCandidateDataset([discovered(1, { createdAt: 'not-a-date' }), discovered(2)], [], NOW),
      concurrency: 1,
    });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ repository: 'o/r1', stage: 'quality' });
    expect(report.collected).toBe(1);
    expect((await read()).repositories.map((r) => r.id)).toEqual(['2']);
  });
});
