/**
 * Phase 6.2.2 shadow-discovery experiment: pure, deterministic helpers. Nothing here is imported by the production pipeline
 * (a test asserts that), and none of it changes discovery, tracking, classification or ranking.
 */
import type { RepositorySnapshot } from '../model/repositorySnapshot';

export type ShadowStrategy = 'B' | 'C' | 'D';

export interface ShadowQuery {
  strategy: ShadowStrategy;
  /** Cache key, unique per (topic, component). */
  key: string;
  topic: string;
  query: string;
  sort: 'stars' | 'updated' | 'forks';
  pages: number;
}

const iso = (now: Date, daysBack: number) => new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);

/**
 * Query components per topic.
 *  B  top-300: the production established query, pages 1-3 (production is page 1 only).
 *  C  recent + star bands: bounded star bands, young repositories at low stars, older ones at mid stars.
 *  D  multi-sort: the production filter, sorted by `updated` and by `forks` (GitHub Search has no "created" sort; recency is a qualifier, see C).
 */
export function shadowQueries(topic: string, now: Date): ShadowQuery[] {
  const pushed = `pushed:>${iso(now, 30)}`;
  const base = `topic:${topic} stars:>100 ${pushed}`;
  const q = (strategy: ShadowStrategy, component: string, query: string, sort: ShadowQuery['sort'], pages = 1): ShadowQuery => ({
    strategy,
    key: `${topic}|${strategy}:${component}`,
    topic,
    query,
    sort,
    pages,
  });
  return [
    q('B', 'top300', base, 'stars', 3),
    q('C', 'young-50-500', `topic:${topic} created:>${iso(now, 180)} stars:50..500 ${pushed}`, 'stars'),
    q('C', 'young-500-5000', `topic:${topic} created:>${iso(now, 180)} stars:500..5000 ${pushed}`, 'stars'),
    q('C', 'mid-1000-5000', `topic:${topic} stars:1000..5000 ${pushed}`, 'stars'),
    q('C', 'mid-5000-15000', `topic:${topic} stars:5000..15000 ${pushed}`, 'stars'),
    q('D', 'updated', base, 'updated'),
    q('D', 'forks', base, 'forks'),
  ];
}

export function isValidSnapshot(x: unknown): x is RepositorySnapshot {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.repositoryId === 'string' &&
    /^\d+$/.test(s.repositoryId) &&
    typeof s.fullName === 'string' &&
    /^[^/\s]+\/[^/\s]+$/.test(s.fullName) &&
    typeof s.stars === 'number' &&
    Number.isFinite(s.stars) &&
    s.stars >= 0 &&
    typeof s.createdAt === 'string' &&
    !Number.isNaN(Date.parse(s.createdAt)) &&
    Array.isArray(s.topics)
  );
}

export interface NormalizeResult {
  repositories: RepositorySnapshot[];
  rejected: { malformed: number; fork: number; archived: number; duplicate: number };
}

/** Identity = numeric repository id (survives renames). Sorted by id so the result does not depend on arrival order. */
export function normalizeHits(hits: readonly unknown[]): NormalizeResult {
  const byId = new Map<string, RepositorySnapshot>();
  const rejected = { malformed: 0, fork: 0, archived: 0, duplicate: 0 };
  for (const h of hits) {
    if (!isValidSnapshot(h)) {
      rejected.malformed += 1;
      continue;
    }
    if (h.isFork === true) {
      rejected.fork += 1;
      continue;
    }
    if (h.isArchived === true) {
      rejected.archived += 1;
      continue;
    }
    if (byId.has(h.repositoryId)) {
      rejected.duplicate += 1;
      continue;
    }
    byId.set(h.repositoryId, h);
  }
  const repositories = [...byId.values()].sort((a, b) => (BigInt(a.repositoryId) < BigInt(b.repositoryId) ? -1 : 1));
  return { repositories, rejected };
}

/** Deterministic seeded shuffle-based sample (mulberry32). */
export function seededSample<T>(items: readonly T[], n: number, seed: number, key: (t: T) => string): T[] {
  const arr = [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr.slice(0, Math.max(0, n));
}

/**
 * Stratified sample: `total` slots spread over strata in proportion to stratum size (at least 1 per non-empty stratum while slots last).
 * Returns each chosen item with its stratum and the stratum's size, so estimates can be weighted back to the population.
 */
export function stratifiedSample<T>(items: readonly T[], stratum: (t: T) => string, total: number, seed: number, key: (t: T) => string): { item: T; stratum: string; stratumSize: number }[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const s = stratum(it);
    groups.set(s, [...(groups.get(s) ?? []), it]);
  }
  const names = [...groups.keys()].sort();
  const popTotal = items.length;
  const out: { item: T; stratum: string; stratumSize: number }[] = [];
  for (const name of names) {
    const g = groups.get(name) as T[];
    const share = Math.max(1, Math.round((g.length / Math.max(1, popTotal)) * total));
    for (const item of seededSample(g, Math.min(share, g.length), seed, key)) out.push({ item, stratum: name, stratumSize: g.length });
  }
  return out.slice(0, Math.max(total, 0) + names.length);
}

export interface GrowthEvidence {
  growth7d: number | null;
  growth30d: number | null;
  growth90d: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  trend: string;
  score: number | null;
}

export interface ValueThresholds {
  /** Production tracking WARM floors: the project's own definition of "worth refreshing more often than weekly". */
  grower: { minVelocity7d: number; minGrowth7d: number };
  /** Fraction of the production Rising numeric gates (velocity7d, growth7d) that counts as near-Rising. */
  nearFraction: number;
  rising: { minVelocity7d: number; minGrowth7d: number };
}

export type ValueClass = 'RISING' | 'NEAR_RISING' | 'GROWER' | 'QUIET' | 'UNMEASURED';

/** Mutually exclusive, best class first. RISING is the production trend label itself, not a re-implementation. */
export function valueClass(g: GrowthEvidence, t: ValueThresholds): ValueClass {
  if (g.growth7d === null || g.velocity7d === null) return 'UNMEASURED';
  if (g.trend === 'RISING') return 'RISING';
  if (g.velocity7d >= t.rising.minVelocity7d * t.nearFraction && g.growth7d >= t.rising.minGrowth7d * t.nearFraction) return 'NEAR_RISING';
  if (g.velocity7d >= t.grower.minVelocity7d && g.growth7d >= t.grower.minVelocity7d * 7) return 'GROWER';
  return 'QUIET';
}

export interface WeightedSample {
  /** Population units this sampled repository stands for (stratum size / sampled in stratum). */
  weight: number;
  hit: boolean;
}

/**
 * Horvitz-Thompson style estimate from a stratified sample: estimated population of the group, estimated hits and rate, with a
 * Wilson 95% interval computed on the raw sample size (conservative: ignores the design effect of stratification).
 */
export function weightedRate(samples: readonly WeightedSample[]): { population: number; estimatedHits: number; rate: number; low: number; high: number; sampled: number } | null {
  if (samples.length === 0) return null;
  const population = samples.reduce((a, s) => a + s.weight, 0);
  const estimatedHits = samples.reduce((a, s) => a + (s.hit ? s.weight : 0), 0);
  const rate = estimatedHits / Math.max(1e-9, population);
  const n = samples.length;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (rate + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((rate * (1 - rate)) / n + (z * z) / (4 * n * n))) / denom;
  return { population, estimatedHits, rate, low: Math.max(0, centre - half), high: Math.min(1, centre + half), sampled: n };
}

export interface BudgetInput {
  searchRequestsPerWeek: number;
  /** Candidates added to tracking by the strategy. */
  addedTracked: number;
  /** Mean history requests per tracked repository per day (production tier mix). */
  historyRequestsPerRepoPerDay: number;
  searchPerMinute: number;
}

/** Daily steady-state cost: weekly searches spread over 7 days, plus history refreshes of the added repositories. */
export function dailyCost(b: BudgetInput): { searchPerDay: number; historyPerDay: number; totalPerDay: number; weeklySearchMinutes: number } {
  const searchPerDay = b.searchRequestsPerWeek / 7;
  const historyPerDay = b.addedTracked * b.historyRequestsPerRepoPerDay;
  return { searchPerDay, historyPerDay, totalPerDay: searchPerDay + historyPerDay, weeklySearchMinutes: b.searchRequestsPerWeek / b.searchPerMinute };
}
