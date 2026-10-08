/**
 * Phase 6.2.2 shadow discovery experiment. Read-only against GitHub, writes only under results/phase6.2.2/. Production discovery,
 * tracking, classification, momentum and the public data are not touched.
 *
 *   tsx scripts/discovery/shadow.ts baseline <state data dir>
 *   tsx scripts/discovery/shadow.ts fetch    <state data dir> [--topics N]        Search API, cached per query, resumable
 *   tsx scripts/discovery/shadow.ts sample   <state data dir> [--max N]           real star history for a stratified sample, resumable
 *   tsx scripts/discovery/shadow.ts analyse  <state data dir>                     writes the strategy files and comparison.json
 *
 * Token: GITHUB_TOKEN / GH_TOKEN from the environment when present (never printed); otherwise anonymous (search 10/min, core 60/h).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { buildRecord } from '../../src/collect/dataset';
import { discoveryQueries } from '../../src/coverage';
import { evaluateCurrent } from '../../src/backtest';
import { expandQuery, loadCategoryConfig } from '../../src/discovery/config';
import { dailyCost, normalizeHits, seededSample, shadowQueries, stratifiedSample, valueClass, weightedRate, type ShadowQuery, type ValueClass, type WeightedSample } from '../../src/discovery/shadow';
import { AuthenticationError, RateLimitError } from '../../src/github/errors';
import { GitHubHttpClient } from '../../src/github/http';
import { loadToken } from '../../src/github/config';
import { createLogger } from '../../src/github/logger';
import { RestSearchProvider } from '../../src/github/searchProvider';
import { RestStarHistoryProvider } from '../../src/github/starHistoryProvider';
import { loadMomentumConfig } from '../../src/momentum/config';
import { parsePatternConfig } from '../../src/explain/pattern';
import type { RepositorySnapshot } from '../../src/model/repositorySnapshot';
import type { StarHistorySeries } from '../../src/model/starHistory';

const [mode, dir = '.pipeline/state-2026-10-06/data'] = process.argv.slice(2);
const argv = process.argv.slice(2);
const argNum = (name: string, d: number) => (argv.includes(name) ? Number(argv[argv.indexOf(name) + 1]) : d);
const OUT = 'results/phase6.2.2';
const CACHE = join(OUT, 'cache');
mkdirSync(CACHE, { recursive: true });
const SEARCH_CACHE = join(CACHE, 'raw-search.json');
const HISTORY_CACHE = join(CACHE, 'history-sample.json');
const SEED = 622;

interface Candidate { id: string; fullName: string; stars: number; topics: string[]; createdAt: string; discovery: { domains: string[]; queryCategories: string[]; hits: number } }
const cand = JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { generatedAt: string; candidates: Candidate[] };
const inCandidates = new Set(cand.candidates.map((c) => c.id));
const configs = [loadCategoryConfig('config/categories/ai.json'), loadCategoryConfig('config/categories/engineering.json')];

function experimentTopics(n: number): string[] {
  const count = new Map<string, number>();
  for (const c of cand.candidates) for (const t of c.topics) count.set(t, (count.get(t) ?? 0) + 1);
  return discoveryQueries(configs)
    .filter((q) => q.kind === 'pushed')
    .map((q) => q.topic)
    .filter((t, i, a) => a.indexOf(t) === i)
    .sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || (a < b ? -1 : 1))
    .slice(0, n);
}

function makeClient() {
  let token: string | null = null;
  try {
    token = loadToken();
  } catch (e) {
    if (!(e instanceof AuthenticationError)) throw e;
  }
  const logger = createLogger({ secrets: token ? [token] : [] });
  return { token, http: new GitHubHttpClient({ token, logger }), logger };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRateLimitWait<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof RateLimitError) || attempt >= 40) throw e;
      const until = e.resetAt ? e.resetAt.getTime() + 3000 : Date.now() + 65_000;
      const wait = Math.max(5000, Math.min(until - Date.now(), 3_700_000));
      console.error(`[${new Date().toISOString().slice(11, 19)}] rate limited on ${label}; waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

interface SearchEntry { query: string; sort: string; pages: number; totalCount: number; repositories: RepositorySnapshot[] }
type SearchCache = { meta: { now: string; authenticated: boolean; topics: string[] }; entries: Record<string, SearchEntry> };
const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1) + '\n');

// ---------------------------------------------------------------- baseline
function baseline() {
  const now = new Date(readJson<SearchCache>(SEARCH_CACHE)?.meta.now ?? new Date().toISOString());
  const queries = configs.flatMap((c) =>
    c.categories.flatMap((cat) => cat.searchQueries.map((t) => ({ domain: c.domain, category: cat.slug, template: t, expanded: expandQuery(t, c.discovery, now) }))),
  );
  const tracked = JSON.parse(readFileSync(join(dir, 'tracked/tracked.json'), 'utf8')) as { repositories: { tier: string }[] };
  const tiers: Record<string, number> = {};
  for (const r of tracked.repositories) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
  const byDomain: Record<string, number> = {};
  for (const c of cand.candidates) byDomain[c.discovery.domains.join('+')] = (byDomain[c.discovery.domains.join('+')] ?? 0) + 1;
  const starBands = [1000, 5000, 10000];
  const out = {
    candidateSetGeneratedAt: cand.generatedAt,
    settings: Object.fromEntries(configs.map((c) => [c.domain, c.discovery])),
    sort: 'stars desc',
    queryCount: queries.length,
    queries,
    candidates: cand.candidates.length,
    candidatesByDomain: byDomain,
    candidatesUnder: Object.fromEntries(starBands.map((b) => [`<${b}`, cand.candidates.filter((c) => c.stars < b).length])),
    tracked: tracked.repositories.length,
    trackedByTier: tiers,
    experimentTopics: experimentTopics(argNum('--topics', 14)),
    filtering: 'forks and archived dropped; stars below min(minStars, freshMinStars) dropped; results matching no category topic or keyword dropped (irrelevant); dedup by repository id; classification and tracking run afterwards on the candidate set',
  };
  writeJson(join(OUT, 'baseline.json'), out);
  console.log(JSON.stringify({ queryCount: out.queryCount, candidates: out.candidates, tracked: out.tracked, candidatesUnder: out.candidatesUnder, topics: out.experimentTopics }, null, 1));
}

// ---------------------------------------------------------------- fetch
async function fetchSearch() {
  const topics = experimentTopics(argNum('--topics', 14));
  const { token, http } = makeClient();
  const search = new RestSearchProvider(http, token ? 2100 : 7500);
  const cache: SearchCache = readJson<SearchCache>(SEARCH_CACHE) ?? { meta: { now: new Date().toISOString(), authenticated: token !== null, topics }, entries: {} };
  const now = new Date(cache.meta.now);
  const jobs: ShadowQuery[] = topics.flatMap((t) => shadowQueries(t, now));
  console.error(`${jobs.length} queries over ${topics.length} topics (${token ? 'authenticated' : 'anonymous'}), cache has ${Object.keys(cache.entries).length}`);
  for (const job of jobs) {
    if (cache.entries[job.key]) continue;
    const res = await withRateLimitWait(job.key, () => search.searchRepositories(job.query, { sort: job.sort, order: 'desc', perPage: 100, maxPages: job.pages, now }));
    cache.entries[job.key] = { query: job.query, sort: job.sort, pages: job.pages, totalCount: res.totalCount, repositories: res.repositories };
    writeJson(SEARCH_CACHE, cache);
    console.error(`${job.key}: ${res.repositories.length} (total ${res.totalCount})`);
  }
  console.error('fetch complete');
}

// ---------------------------------------------------------------- shared views of the cache
function loadSearch() {
  const cache = readJson<SearchCache>(SEARCH_CACHE);
  if (!cache) throw new Error('no search cache: run fetch first');
  const now = new Date(cache.meta.now);
  const queries = new Map<string, ShadowQuery>();
  for (const t of cache.meta.topics) for (const q of shadowQueries(t, now)) queries.set(q.key, q);
  // novel repositories by id with the set of components that found them
  const found = new Map<string, { snapshot: RepositorySnapshot; components: Set<string> }>();
  const rejected = { malformed: 0, fork: 0, archived: 0, duplicate: 0 };
  for (const [key, entry] of Object.entries(cache.entries)) {
    const n = normalizeHits(entry.repositories);
    for (const k of Object.keys(rejected) as (keyof typeof rejected)[]) rejected[k] += n.rejected[k];
    const comp = key.split('|')[1] as string; // "B:top300"
    for (const s of n.repositories) {
      const e = found.get(s.repositoryId) ?? { snapshot: s, components: new Set<string>() };
      e.components.add(comp);
      found.set(s.repositoryId, e);
    }
  }
  return { cache, now, queries, found, rejected };
}
const strategyOf = (component: string) => component.split(':')[0] as string;
const signature = (components: Set<string>) => [...new Set([...components].map(strategyOf))].sort().join('+');

// ---------------------------------------------------------------- sample
interface HistoryEntry { id: string; fullName: string; stratum: string; stratumSize: number; series: StarHistorySeries | null; error?: string; fetchedAt: string }
async function sample() {
  const { found, now } = loadSearch();
  const novel = [...found.values()].filter((f) => !inCandidates.has(f.snapshot.repositoryId));
  const max = argNum('--max', 240);
  const probeN = argNum('--probe', 0);
  const lifetimeRate = (s: RepositorySnapshot) => s.stars / Math.max(1, (now.getTime() - Date.parse(s.createdAt)) / 86_400_000);
  // PROBE: not a random sample. The novel repositories with the highest lifetime stars/day ("discovery proxy only"), measured with real
  // history to see whether any Rising-capable repository exists in the unseen pool. Excluded from every rate estimate.
  const picked = probeN > 0
    ? [...novel].sort((a, b) => lifetimeRate(b.snapshot) - lifetimeRate(a.snapshot) || (a.snapshot.repositoryId < b.snapshot.repositoryId ? -1 : 1)).slice(0, probeN).map((item) => ({ item, stratum: 'PROBE', stratumSize: probeN }))
    : stratifiedSample(novel, (f) => signature(f.components), max, SEED, (f) => f.snapshot.repositoryId);
  // process in a seeded order so any prefix of the run is itself roughly stratified
  const order = seededSample(picked, picked.length, SEED + 1, (p) => p.item.snapshot.repositoryId);
  const cache = readJson<Record<string, HistoryEntry>>(HISTORY_CACHE) ?? {};
  const { token, http, logger } = makeClient();
  const provider = new RestStarHistoryProvider(http, { logger, now: () => now });
  console.error(`sampling ${order.length} of ${novel.length} novel repositories (${token ? 'authenticated' : 'anonymous: about 55 repositories per hour'}), cached ${Object.keys(cache).length}`);
  let done = 0;
  for (const p of order) {
    const s = p.item.snapshot;
    if (cache[s.repositoryId]) continue;
    try {
      const series = await withRateLimitWait(s.fullName, () => provider.fetchStarHistory({ owner: s.owner, name: s.name }, { maxPages: 1 }));
      cache[s.repositoryId] = { id: s.repositoryId, fullName: s.fullName, stratum: p.stratum, stratumSize: p.stratumSize, series, fetchedAt: new Date().toISOString() };
    } catch (e) {
      if (e instanceof RateLimitError || e instanceof AuthenticationError) throw e;
      cache[s.repositoryId] = { id: s.repositoryId, fullName: s.fullName, stratum: p.stratum, stratumSize: p.stratumSize, series: null, error: e instanceof Error ? e.name : 'error', fetchedAt: new Date().toISOString() };
    }
    done += 1;
    if (done % 5 === 0) writeJson(HISTORY_CACHE, cache);
  }
  writeJson(HISTORY_CACHE, cache);
  console.error(`sample complete: ${Object.keys(cache).length} cached, requests ${provider.stats.pageRequests}`);
}

// ---------------------------------------------------------------- analyse
function analyse() {
  const { cache, now, found, rejected } = loadSearch();
  const hist = readJson<Record<string, HistoryEntry>>(HISTORY_CACHE) ?? {};
  const cfg = loadMomentumConfig();
  const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
  const thresholds = { grower: { minVelocity7d: 8, minGrowth7d: 56 }, nearFraction: 0.5, rising: { minVelocity7d: cfg.trends.rising.minVelocity7d, minGrowth7d: cfg.trends.rising.minGrowth7d } };
  const classifier = new Classifier(loadTaxonomy());
  const classify = (s: RepositorySnapshot) => classifier.classify({ id: s.repositoryId, name: s.name, description: s.description, topics: s.topics, language: s.language }).topLevelCategory;

  // control: real growth of the current candidate set from pipeline state (no requests)
  const repos = JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { generatedAt: string; repositories: any[] };
  const control: Record<ValueClass, number> = { RISING: 0, NEAR_RISING: 0, GROWER: 0, QUIET: 0, UNMEASURED: 0 };
  const stateNow = new Date(repos.generatedAt);
  for (const r of repos.repositories) {
    if (!inCandidates.has(r.id)) continue;
    const e = evaluateCurrent(r, repos.generatedAt, stateNow, cfg, pcfg);
    control[valueClass({ growth7d: e.growth7d, growth30d: e.growth30d, growth90d: e.growth90d, velocity7d: e.velocity7d, velocity30d: e.velocity30d, trend: e.trend, score: e.score }, thresholds)] += 1;
  }

  // measured novel repositories
  const measured = new Map<string, { cls: ValueClass; growth7d: number | null; growth30d: number | null; growth90d: number | null; velocity7d: number | null; score: number | null; historyWeeks: number; complete: boolean }>();
  const asOf = new Date(Math.max(...Object.values(hist).filter((h) => h.series).map((h) => Date.parse(h.fetchedAt)), now.getTime()));
  const probe: { fullName: string; stars: number; lifetimePerDay: number; cls: ValueClass; growth7d: number | null; growth30d: number | null; velocity7d: number | null }[] = [];
  for (const h of Object.values(hist)) {
    const f = found.get(h.id);
    if (!f || !h.series) continue;
    if (h.stratum === 'PROBE') {
      const rec = buildRecord(f.snapshot, { domains: ['ai'], categories: [] }, h.series, [], new Date(h.series.fetchedAt));
      const e = evaluateCurrent(rec, rec.growthAsOf ?? h.series.fetchedAt, new Date(h.series.fetchedAt), cfg, pcfg);
      probe.push({ fullName: f.snapshot.fullName, stars: f.snapshot.stars, lifetimePerDay: +(f.snapshot.stars / Math.max(1, (now.getTime() - Date.parse(f.snapshot.createdAt)) / 86_400_000)).toFixed(1), cls: valueClass({ growth7d: e.growth7d, growth30d: e.growth30d, growth90d: e.growth90d, velocity7d: e.velocity7d, velocity30d: e.velocity30d, trend: e.trend, score: e.score }, thresholds), growth7d: e.growth7d, growth30d: e.growth30d, velocity7d: e.velocity7d });
      continue;
    }
    const rec = buildRecord(f.snapshot, { domains: ['ai'], categories: [] }, h.series, [], new Date(h.series.fetchedAt));
    const e = evaluateCurrent(rec, rec.growthAsOf ?? h.series.fetchedAt, new Date(h.series.fetchedAt), cfg, pcfg);
    measured.set(h.id, {
      cls: valueClass({ growth7d: e.growth7d, growth30d: e.growth30d, growth90d: e.growth90d, velocity7d: e.velocity7d, velocity30d: e.velocity30d, trend: e.trend, score: e.score }, thresholds),
      growth7d: e.growth7d, growth30d: e.growth30d, growth90d: e.growth90d, velocity7d: e.velocity7d, score: e.score,
      historyWeeks: h.series.weeks.length, complete: h.series.complete,
    });
  }
  void asOf;

  const novel = [...found.values()].filter((f) => !inCandidates.has(f.snapshot.repositoryId));
  const stratumSize = new Map<string, number>();
  for (const f of novel) stratumSize.set(signature(f.components), (stratumSize.get(signature(f.components)) ?? 0) + 1);
  const sampledPerStratum = new Map<string, number>();
  for (const id of measured.keys()) {
    const f = found.get(id);
    if (f) sampledPerStratum.set(signature(f.components), (sampledPerStratum.get(signature(f.components)) ?? 0) + 1);
  }
  const weightOf = (f: { components: Set<string> }) => (stratumSize.get(signature(f.components)) ?? 0) / Math.max(1, sampledPerStratum.get(signature(f.components)) ?? 1);

  const requestsOf = (match: (component: string) => boolean) =>
    Object.entries(cache.entries).filter(([k]) => match(k.split('|')[1] as string)).reduce((a, [, e]) => a + e.pages, 0);
  const topicsN = cache.meta.topics.length;
  // Production has 66 distinct topics (66 established + 33 fresh queries = 99 searches/week). Every shadow component is per topic, so scale by 66 / experiment topics.
  const scaleToProduction = 66 / topicsN;

  function summarise(name: string, match: (component: string) => boolean) {
    const ids = novel.filter((f) => [...f.components].some(match));
    const sampled = ids.filter((f) => measured.has(f.snapshot.repositoryId));
    const w = (f: { components: Set<string> }) => weightOf(f);
    const rate = (pred: (cls: ValueClass) => boolean) => weightedRate(sampled.map((f) => ({ weight: w(f), hit: pred(measured.get(f.snapshot.repositoryId)!.cls) } as WeightedSample)));
    const classes = (['RISING', 'NEAR_RISING', 'GROWER', 'QUIET'] as ValueClass[]).map((c) => [c, rate((x) => x === c)] as const);
    const growers = rate((c) => c === 'RISING' || c === 'NEAR_RISING' || c === 'GROWER');
    const nearUp = rate((c) => c === 'RISING' || c === 'NEAR_RISING');
    const unknown = ids.filter((f) => classify(f.snapshot) === 'UNKNOWN').length;
    const classified = ids.length - unknown;
    const usefulSamples = sampled.map((f) => ({ weight: w(f), hit: ['RISING', 'NEAR_RISING', 'GROWER'].includes(measured.get(f.snapshot.repositoryId)!.cls) && classify(f.snapshot) !== 'UNKNOWN' }));
    const useful = weightedRate(usefulSamples);
    const requests = requestsOf(match);
    const under = (n: number) => ids.filter((f) => f.snapshot.stars < n).length;
    const underGrowers = (n: number) => weightedRate(sampled.filter((f) => f.snapshot.stars < n).map((f) => ({ weight: w(f), hit: ['RISING', 'NEAR_RISING', 'GROWER'].includes(measured.get(f.snapshot.repositoryId)!.cls) })));
    return {
      strategy: name,
      searchRequestsExperiment: requests,
      newRepos: ids.length,
      sampled: sampled.length,
      estimatedActualGrowers: growers ? Math.round(growers.estimatedHits) : null,
      growerRate: growers && { rate: +growers.rate.toFixed(3), low: +growers.low.toFixed(3), high: +growers.high.toFixed(3) },
      estimatedNearRisingOrRising: nearUp ? Math.round(nearUp.estimatedHits) : null,
      estimatedRising: rate((c) => c === 'RISING') ? Math.round(rate((c) => c === 'RISING')!.estimatedHits) : null,
      classRates: Object.fromEntries(classes.map(([c, r]) => [c, r && { rate: +r.rate.toFixed(3), low: +r.low.toFixed(3), high: +r.high.toFixed(3), est: Math.round(r.estimatedHits) }])),
      under1k: under(1000),
      under5k: under(5000),
      under10k: under(10000),
      growersUnder1k: underGrowers(1000) ? Math.round(underGrowers(1000)!.estimatedHits) : null,
      growersUnder5k: underGrowers(5000) ? Math.round(underGrowers(5000)!.estimatedHits) : null,
      classifiedShare: +(classified / Math.max(1, ids.length)).toFixed(3),
      unknown,
      usefulRate: useful && { rate: +useful.rate.toFixed(3), low: +useful.low.toFixed(3), high: +useful.high.toFixed(3), est: Math.round(useful.estimatedHits) },
      usefulPerSearchRequest: useful && requests > 0 ? +(useful.estimatedHits / requests).toFixed(3) : null,
      risingPerSearchRequest: rate((c) => c === 'RISING') && requests > 0 ? +(rate((c) => c === 'RISING')!.estimatedHits / requests).toFixed(4) : null,
      additionalSearchRequestsPerWeek: Math.round((requests - (match('B:top300') ? topicsN : 0)) * scaleToProduction),
      domains: Object.fromEntries(['AI', 'ENGINEERING', 'BOTH', 'UNKNOWN'].map((d) => [d, ids.filter((f) => classify(f.snapshot) === d).length])),
      novelIds: ids.map((f) => f.snapshot.repositoryId).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
    };
  }

  const components = [...new Set(Object.keys(cache.entries).map((k) => k.split('|')[1] as string))].sort();
  const byComponent = components.map((c) => summarise(c, (x) => x === c));
  const B = summarise('B top-300', (c) => strategyOf(c) === 'B');
  const C = summarise('C recent + star bands', (c) => strategyOf(c) === 'C');
  const D = summarise('D multi-sort', (c) => strategyOf(c) === 'D');
  // E: greedy by estimated growers per search request, within a weekly search budget (authenticated 30/min => 15 minutes)
  const budget = 300 / scaleToProduction; // at most +300 searches/week over today's 99 (about 10 minutes authenticated)
  const ranked = [...byComponent].filter((c) => (c.estimatedActualGrowers ?? 0) > 0).sort((a, b) => (b.usefulPerSearchRequest ?? 0) - (a.usefulPerSearchRequest ?? 0) || (a.strategy < b.strategy ? -1 : 1));
  const chosen: string[] = [];
  let spent = 0;
  for (const c of ranked) if (spent + c.searchRequestsExperiment <= budget) { chosen.push(c.strategy); spent += c.searchRequestsExperiment; }
  const E = summarise('E hybrid', (c) => chosen.includes(c));

  const current = {
    strategy: 'A current',
    candidates: cand.candidates.length,
    searchRequestsPerWeek: 99,
    controlRealGrowthClasses: control,
    controlRates: Object.fromEntries(Object.entries(control).map(([k, v]) => [k, +(v / Math.max(1, cand.candidates.length)).toFixed(3)])),
  };
  const history = Object.values(hist);
  const meta = {
    searchedAt: cache.meta.now,
    authenticated: cache.meta.authenticated,
    topics: cache.meta.topics,
    thresholds,
    thresholdBasis: 'grower = production tracking WARM floor (7-day velocity >= 8 stars/day and >= 56 stars in 7 days); near-Rising = both numeric Rising gates at 50% (velocity7d >= 50 and growth7d >= 350) without the Rising label; Rising = the production trend label, evaluated by the production momentum code',
    hybridComponents: chosen,
    hybridBudgetExperimentRequests: budget,
    normalizeRejected: rejected,
    novelTotal: novel.length,
    measuredSample: measured.size,
    probeMeasured: probe.length,
    historyFetchErrors: history.filter((h) => !h.series).length,
    historyCompleteShare: +(history.filter((h) => h.series?.complete).length / Math.max(1, history.filter((h) => h.series).length)).toFixed(3),
  };
  const write = (name: string, v: unknown) => writeJson(join(OUT, name), v);
  write('current.json', { meta, ...current });
  write('top300.json', { meta, ...B });
  write('recent-star-bands.json', { meta, ...C });
  write('multi-sort.json', { meta, ...D });
  write('hybrid.json', { meta, ...E });
  probe.sort((a, b) => (a.fullName < b.fullName ? -1 : 1));
  write('probe.json', { note: 'NOT a random sample: top novel repositories by lifetime stars/day (discovery proxy only), measured with real history', n: probe.length, byClass: Object.fromEntries((['RISING', 'NEAR_RISING', 'GROWER', 'QUIET', 'UNMEASURED'] as ValueClass[]).map((c) => [c, probe.filter((p) => p.cls === c).length])), repositories: probe });
  const strip = ({ novelIds: _n, ...rest }: any) => rest;
  const costs = [B, C, D, E].map((s) => ({ strategy: s.strategy, ...dailyCost({ searchRequestsPerWeek: s.additionalSearchRequestsPerWeek, addedTracked: Math.round(s.newRepos * scaleToProduction), historyRequestsPerRepoPerDay: 1125 / 3471, searchPerMinute: cache.meta.authenticated ? 30 : 10 }) }));
  write('comparison.json', { meta, current, strategies: [B, C, D, E].map(strip), components: byComponent.map(strip), dailyCost: costs });
  console.log(JSON.stringify({ meta: { ...meta, thresholds: undefined }, current: current.controlRates, strategies: [B, C, D, E].map(strip), costs }, null, 1));
}

const run: Record<string, () => void | Promise<void>> = { baseline, fetch: fetchSearch, sample, analyse };
if (!mode || !run[mode]) throw new Error('usage: baseline|fetch|sample|analyse <state data dir>');
Promise.resolve(run[mode]!()).catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
