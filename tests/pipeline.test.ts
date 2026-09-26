import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertReplaceable, buildDataset, DatasetValidationError, validateDataset, type Dataset } from '../src/collect/dataset';
import { CollectionAbortedError, runCollection, type PipelineDeps, type PipelineOptions } from '../src/collect/pipeline';
import type { CategoryConfig, Domain } from '../src/discovery/config';
import { parseCategoryConfig } from '../src/discovery/config';
import type { DiscoveredRepository, DiscoveryProvider } from '../src/discovery/discoveryProvider';
import { NetworkError, NotFoundError, RateLimitError } from '../src/github/errors';
import type { GitHubGraphQLProvider, GitHubStarHistoryProvider } from '../src/github/providers';
import type { RepositoryRef, RepositorySnapshot } from '../src/model/repositorySnapshot';
import type { StarHistorySeries } from '../src/model/starHistory';
import { seriesOf, weeksEndingAt } from './shHelpers';

const NOW = new Date('2026-09-24T12:00:00Z');
const HISTORY_TOTAL = 30 * 7 - 2; // 30 weeks x 7 days x 1 star, minus the 2 future days (Fri, Sat) of the current week

function snap(id: number, stars: number, over: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    repositoryId: String(id),
    owner: 'o',
    name: `r${id}`,
    fullName: `o/r${id}`,
    url: `https://github.com/o/r${id}`,
    description: 'd',
    stars,
    forks: 1,
    openIssues: 2,
    language: 'Go',
    topics: ['x'],
    license: 'MIT',
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    collectedAt: NOW.toISOString(),
    source: 'rest',
    ...over,
  };
}

const cand = (s: RepositorySnapshot, domain: Domain = 'ai', categories = ['llm']): DiscoveredRepository => ({ snapshot: s, domains: [domain], categories, hits: 1 });

const config = (domain: Domain): CategoryConfig =>
  parseCategoryConfig({
    schemaVersion: 1,
    domain,
    discovery: { minStars: 1, freshMinStars: 1, pushedWithinDays: 30, createdWithinDays: 30, perPage: 100, maxPagesPerQuery: 1, excludeForks: true, excludeArchived: true },
    categories: [{ slug: 'llm', name: 'LLM', description: 'd', searchQueries: ['topic:llm'], keywords: [], topics: [] }],
  });

function fakeDiscovery(byDomain: Partial<Record<Domain, DiscoveredRepository[]>>): DiscoveryProvider {
  return {
    async discover(cfg) {
      const candidates = byDomain[cfg.domain] ?? [];
      return { domain: cfg.domain, candidates, stats: { domain: cfg.domain, queries: 1, requests: 1, failedQueries: [], rawResults: candidates.length, uniqueRepositories: candidates.length, rejected: { belowMinStars: 0, fork: 0, archived: 0, irrelevant: 0 }, accepted: candidates.length, perCategory: {} } };
    },
  };
}

interface HistoryFake extends GitHubStarHistoryProvider {
  calls: { repo: string; maxPages: number | undefined }[];
  peak: number;
}

function fakeHistory(behaviour: (repo: RepositoryRef) => StarHistorySeries | Error = () => seriesOf(weeksEndingAt('2026-09-24', 30, 1), false)): HistoryFake {
  let inFlight = 0;
  const f: HistoryFake = {
    calls: [],
    peak: 0,
    async fetchStarHistory(repo, options) {
      f.calls.push({ repo: `${repo.owner}/${repo.name}`, maxPages: options?.maxPages });
      inFlight += 1;
      f.peak = Math.max(f.peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight -= 1;
      const out = behaviour(repo);
      if (out instanceof Error) throw out;
      return { ...out, repository: `${repo.owner}/${repo.name}` };
    },
  };
  return f;
}

let dir: string;
let outPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'osr-pipe-'));
  outPath = join(dir, 'repositories.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (deps: Partial<PipelineDeps> & Pick<PipelineDeps, 'discovery' | 'starHistory'>, over: Partial<PipelineOptions> = {}) =>
  runCollection({ now: () => NOW, ...deps }, { configs: [config('ai'), config('engineering')], outPath, ...over });

const readDataset = async (): Promise<Dataset> => JSON.parse(await readFile(outPath, 'utf8'));

describe('collection pipeline', () => {
  it('discovers, deduplicates by id, fetches history, writes a valid sorted dataset', async () => {
    const history = fakeHistory();
    const report = await run({
      discovery: fakeDiscovery({
        ai: [cand(snap(30, 5000)), cand(snap(10, 9000))],
        engineering: [cand(snap(10, 9000, { name: 'renamed', fullName: 'o/renamed' }), 'engineering', ['devops']), cand(snap(20, 300), 'engineering', ['devops'])],
      }),
      starHistory: history,
    });
    expect(report.written).toBe(true);
    expect(report.candidates).toBe(3);
    expect(history.calls).toHaveLength(3); // id 10 fetched once, not twice
    const ds = await readDataset();
    expect(validateDataset(ds)).toEqual([]);
    expect(ds.repositories.map((r) => r.id)).toEqual(['10', '20', '30']);
    const ten = ds.repositories[0]!;
    expect(ten.domains).toEqual(['ai', 'engineering']);
    expect(ten.categories).toEqual(['devops', 'llm']);
    expect(ds.stats).toEqual({ repositories: 3, byDomain: { ai: 2, engineering: 2 } });
    expect(ds.asOfDate).toBe('2026-09-24');
    expect(ds.schemaVersion).toBe(1);
  });

  it('stores gains only (no cumulative duplicate) and computes growth from them', async () => {
    await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 10_000))] }), starHistory: fakeHistory() });
    const r = (await readDataset()).repositories[0]!;
    expect(Object.keys(r.starHistory).sort()).toEqual(['complete', 'dailyGains', 'fetchedAt', 'firstDate', 'source']);
    expect(r.starHistory.dailyGains.reduce((a, b) => a + b, 0)).toBe(HISTORY_TOTAL);
    expect(r.starHistory.dailyGains).not.toContain(undefined);
    expect(r.growth['7d']).toMatchObject({ status: 'ok', growth: 7, starsAgo: 9993, starsPerDay: 1 });
    expect(r.growth['30d'].growth).toBe(30);
    expect(r.growth['90d'].growth).toBe(90);
    expect(r.metadataSource).toBe('rest');
  });

  it('is deterministic: identical inputs give byte-identical output', async () => {
    const deps = () => ({ discovery: fakeDiscovery({ ai: [cand(snap(2, 500)), cand(snap(1, 900))] }), starHistory: fakeHistory() });
    await run(deps());
    const first = await readFile(outPath, 'utf8');
    await run(deps());
    expect(await readFile(outPath, 'utf8')).toBe(first);
  });

  it('applies --limit to the top candidates by stars', async () => {
    const history = fakeHistory();
    await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 10)), cand(snap(2, 900)), cand(snap(3, 500))] }), starHistory: history }, { limit: 2 });
    expect(history.calls.map((c) => c.repo).sort()).toEqual(['o/r2', 'o/r3']);
  });

  it('requests one page of history by default and the whole life for "all"', async () => {
    const h1 = fakeHistory();
    await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500))] }), starHistory: h1 });
    expect(h1.calls[0]!.maxPages).toBe(1);
    const h2 = fakeHistory();
    await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500))] }), starHistory: h2 }, { historyPages: 'all' });
    expect(h2.calls[0]!.maxPages).toBeUndefined();
    expect((await readDataset()).historyPagesPerRepository).toBe('all');
  });

  it('never exceeds the configured concurrency', async () => {
    const history = fakeHistory();
    const many = Array.from({ length: 30 }, (_, i) => cand(snap(i + 1, 1000 - i)));
    await run({ discovery: fakeDiscovery({ ai: many }), starHistory: history }, { concurrency: 3 });
    expect(history.calls).toHaveLength(30);
    expect(history.peak).toBeLessThanOrEqual(3);
    expect(history.peak).toBeGreaterThan(1);
  });

  it('prefers GraphQL metadata when available and drops repositories GraphQL cannot find', async () => {
    const graphql: GitHubGraphQLProvider = {
      async fetchRepositories(refs) {
        const found = refs.filter((r) => r.name !== 'r2');
        return { snapshots: found.map((r) => snap(Number(r.name.slice(1)), 700, { source: 'graphql', openIssues: 9 })), notFound: refs.filter((r) => r.name === 'r2'), requests: 1, cost: 1, rateLimit: null };
      },
    };
    const report = await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500)), cand(snap(2, 400)), cand(snap(3, 300))] }), graphql, starHistory: fakeHistory() }, { maxFailureRatio: 0.5 });
    const ds = await readDataset();
    expect(ds.repositories.map((r) => r.id)).toEqual(['1', '3']);
    expect(ds.repositories[0]).toMatchObject({ metadataSource: 'graphql', stars: 700, openIssues: 9 });
    expect(report.failures).toEqual([{ repository: 'o/r2', stage: 'metadata', reason: 'not found by GraphQL' }]);
  });

  it('dry run discovers only: no history requests, nothing written', async () => {
    const history = fakeHistory();
    const report = await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500))] }), starHistory: history }, { dryRun: true });
    expect(report.written).toBe(false);
    expect(report.candidates).toBe(1);
    expect(history.calls).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('collection pipeline: partial data must never replace a valid dataset', () => {
  async function seed(): Promise<string> {
    await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500)), cand(snap(2, 400)), cand(snap(3, 300))] }), starHistory: fakeHistory() });
    return readFile(outPath, 'utf8');
  }

  it('aborts when too many repositories fail; existing file is byte-identical; no temp files', async () => {
    const before = await seed();
    const history = fakeHistory((r) => (r.name === 'r2' ? new NetworkError('boom') : seriesOf(weeksEndingAt('2026-09-24', 30, 1), false)));
    const err = await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500)), cand(snap(2, 400)), cand(snap(3, 300))] }), starHistory: history }).catch((e) => e);
    expect(err).toBeInstanceOf(CollectionAbortedError);
    expect(err.report.failures).toHaveLength(1);
    expect(await readFile(outPath, 'utf8')).toBe(before);
    expect(await readdir(dir)).toEqual(['repositories.json']);
  });

  it('tolerates a small failure ratio, records the failure, still writes', async () => {
    const history = fakeHistory((r) => (r.name === 'r2' ? new NotFoundError('gone') : seriesOf(weeksEndingAt('2026-09-24', 30, 1), false)));
    const report = await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500)), cand(snap(2, 400)), cand(snap(3, 300))] }), starHistory: history }, { maxFailureRatio: 0.5 });
    expect(report.written).toBe(true);
    expect(report.failures).toEqual([{ repository: 'o/r2', stage: 'history', reason: expect.stringContaining('NotFoundError') }]);
    expect((await readDataset()).repositories.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('a rate-limit error aborts the run, skips remaining work and writes nothing', async () => {
    const before = await seed();
    let n = 0;
    const history = fakeHistory(() => (++n === 2 ? new RateLimitError('budget') : seriesOf(weeksEndingAt('2026-09-24', 30, 1), false)));
    const many = Array.from({ length: 20 }, (_, i) => cand(snap(i + 1, 1000 - i)));
    const err = await run({ discovery: fakeDiscovery({ ai: many }), starHistory: history }, { concurrency: 1, maxFailureRatio: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(CollectionAbortedError);
    expect(err.message).toContain('RateLimitError');
    expect(history.calls.length).toBeLessThan(20);
    expect(await readFile(outPath, 'utf8')).toBe(before);
  });

  it('a repository whose history contradicts its star count is a quality failure, not silent data', async () => {
    const history = fakeHistory(() => seriesOf(weeksEndingAt('2026-09-24', 30, 1), false));
    const err = await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 5))] }), starHistory: history }).catch((e) => e);
    expect(err).toBeInstanceOf(CollectionAbortedError);
    expect(err.report.failures[0]).toMatchObject({ stage: 'quality', reason: expect.stringContaining('HISTORY_EXCEEDS_STARS') });
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('aborts on empty discovery', async () => {
    await expect(run({ discovery: fakeDiscovery({}), starHistory: fakeHistory() })).rejects.toBeInstanceOf(CollectionAbortedError);
  });

  it('a dataset that fails validation is not written', async () => {
    const before = await seed();
    const err = await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500, { createdAt: 'yesterday' }))] }), starHistory: fakeHistory() }).catch((e) => e);
    expect(err).toBeInstanceOf(DatasetValidationError);
    expect(await readFile(outPath, 'utf8')).toBe(before);
  });

  it('refuses to replace a dataset with a much smaller one unless forced', async () => {
    await run({ discovery: fakeDiscovery({ ai: Array.from({ length: 10 }, (_, i) => cand(snap(i + 1, 500))) }), starHistory: fakeHistory() });
    const before = await readFile(outPath, 'utf8');
    const small = { discovery: fakeDiscovery({ ai: [cand(snap(1, 500))] }), starHistory: fakeHistory() };
    await expect(run(small)).rejects.toBeInstanceOf(DatasetValidationError);
    expect(await readFile(outPath, 'utf8')).toBe(before);
    await expect(run(small, { force: true })).resolves.toMatchObject({ written: true });
  });
});

describe('dataset validation', () => {
  async function valid(): Promise<Dataset> {
    await run({ discovery: fakeDiscovery({ ai: [cand(snap(1, 500)), cand(snap(2, 400))] }), starHistory: fakeHistory() });
    return readDataset();
  }
  const problemsAfter = async (mutate: (d: any) => void) => {
    const d = await valid();
    mutate(d);
    return validateDataset(d);
  };

  it('accepts a freshly built dataset', async () => {
    expect(validateDataset(await valid())).toEqual([]);
  });

  it('detects structural problems', async () => {
    expect(await problemsAfter((d) => (d.schemaVersion = 2))).toEqual(expect.arrayContaining([expect.stringContaining('schemaVersion')]));
    expect(await problemsAfter((d) => (d.repositories[1].id = d.repositories[0].id))).toEqual(expect.arrayContaining([expect.stringContaining('duplicated')]));
    expect(await problemsAfter((d) => d.repositories.reverse())).toEqual(expect.arrayContaining([expect.stringContaining('not sorted')]));
    expect(await problemsAfter((d) => (d.repositories[0].stars = -1))).toEqual(expect.arrayContaining([expect.stringContaining('stars')]));
    expect(await problemsAfter((d) => (d.repositories[0].fullName = 'x/y'))).toEqual(expect.arrayContaining([expect.stringContaining('fullName')]));
    expect(await problemsAfter((d) => (d.repositories[0].createdAt = 'yesterday'))).toEqual(expect.arrayContaining([expect.stringContaining('createdAt')]));
    expect(await problemsAfter((d) => (d.repositories[0].starHistory.dailyGains[3] = -4))).toEqual(expect.arrayContaining([expect.stringContaining('dailyGains')]));
    expect(await problemsAfter((d) => (d.stats.repositories = 99))).toEqual(expect.arrayContaining([expect.stringContaining('stats.repositories')]));
    expect(validateDataset(null)).toEqual(['dataset is not an object']);
    expect(validateDataset({ schemaVersion: 1, repositories: 'x' })).toContain('repositories must be an array');
  });

  it('detects growth that does not match the stored history (tampering / drift)', async () => {
    const p = await problemsAfter((d) => (d.repositories[0].growth['7d'].growth = 999));
    expect(p).toEqual(expect.arrayContaining([expect.stringContaining('growth.7d does not match')]));
  });

  it('detects history that sums to more than the star count', async () => {
    const p = await problemsAfter((d) => (d.repositories[0].stars = 1));
    expect(p).toEqual(expect.arrayContaining([expect.stringContaining('more than stars')]));
  });

  it('assertReplaceable honours the ratio and force', async () => {
    const big = await valid();
    const small = buildDataset([big.repositories[0]!], NOW, 1);
    expect(() => assertReplaceable(small, big)).toThrow(DatasetValidationError);
    expect(() => assertReplaceable(small, big, { force: true })).not.toThrow();
    expect(() => assertReplaceable(big, undefined)).not.toThrow();
    expect(() => assertReplaceable(small, big, { minRatio: 0.4 })).not.toThrow();
  });
});
