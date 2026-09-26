import { addDays, utcDate, weeksToDailyGains } from '../analysis/starHistory';
import { starDriftTolerance } from '../analysis/tolerance';
import { computeWindowsFromGains, type StarWindows, type WindowKey, WINDOW_DAYS } from '../analysis/windows';
import type { Domain } from '../discovery/config';
import type { QualityIssue } from '../quality/checks';
import type { RepositorySnapshot } from '../model/repositorySnapshot';
import type { DailyGain, StarHistorySeries } from '../model/starHistory';
import { STAR_HISTORY_SOURCE } from '../model/starHistory';

export const SCHEMA_VERSION = 1 as const;

/**
 * Star history as stored: the per-day gains only. Cumulative counts are NOT stored
 * (they are derivable: stars at end of day d = repository.stars - gains after d),
 * so metadata and history never duplicate each other.
 */
export interface StarHistoryRecord {
  source: typeof STAR_HISTORY_SOURCE;
  fetchedAt: string;
  /** True when the whole repository life is covered (last page reached). */
  complete: boolean;
  /** UTC date of dailyGains[0]. dailyGains[i] is the date firstDate + i, contiguous, ending at or before asOfDate. */
  firstDate: string;
  dailyGains: number[];
}

export interface RepositoryRecord {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  license: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  isArchived: boolean | null;
  stars: number;
  forks: number;
  openIssues: number;
  /** How stars/forks/openIssues were fetched; `rest` counts PRs in openIssues, `graphql` does not. */
  metadataSource: 'graphql' | 'rest';
  collectedAt: string;
  domains: Domain[];
  /** Provisional discovery tags, not the final classification. */
  categories: string[];
  starHistory: StarHistoryRecord;
  /** Instant the windows (and the trimmed history) are anchored to. Older Phase 2 files lack it: use the dataset's `generatedAt`. */
  growthAsOf?: string;
  growth: StarWindows;
  /** Non-info quality findings for this repository. */
  quality: QualityIssue[];
}

export interface Dataset {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  /** UTC date the windows are anchored to (today included, partial). */
  asOfDate: string;
  historyPagesPerRepository: number | 'all';
  stats: { repositories: number; byDomain: Record<string, number> };
  repositories: RepositoryRecord[];
}

/** Build the stored history from a validated series, trimming future-dated zero days. */
export function toStarHistoryRecord(series: StarHistorySeries, asOf: Date): StarHistoryRecord {
  const asOfDate = utcDate(asOf);
  const gains = weeksToDailyGains(series.weeks).filter((g) => g.date <= asOfDate);
  return {
    source: STAR_HISTORY_SOURCE,
    fetchedAt: series.fetchedAt,
    complete: series.complete,
    firstDate: gains[0]?.date ?? asOfDate,
    dailyGains: gains.map((g) => g.count),
  };
}

export function gainsOf(record: StarHistoryRecord): DailyGain[] {
  return record.dailyGains.map((count, i) => ({ date: addDays(record.firstDate, i), count }));
}

export function buildRecord(
  snapshot: RepositorySnapshot,
  meta: { domains: Domain[]; categories: string[] },
  series: StarHistorySeries,
  quality: QualityIssue[],
  asOf: Date,
): RepositoryRecord {
  const starHistory = toStarHistoryRecord(series, asOf);
  return {
    id: snapshot.repositoryId,
    owner: snapshot.owner,
    name: snapshot.name,
    fullName: snapshot.fullName,
    url: snapshot.url,
    description: snapshot.description,
    language: snapshot.language,
    topics: [...snapshot.topics],
    license: snapshot.license,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    pushedAt: snapshot.pushedAt ?? null,
    isArchived: snapshot.isArchived ?? null,
    stars: snapshot.stars,
    forks: snapshot.forks,
    openIssues: snapshot.openIssues,
    metadataSource: snapshot.source ?? 'rest',
    collectedAt: snapshot.collectedAt,
    domains: [...meta.domains].sort() as Domain[],
    categories: [...meta.categories].sort(),
    starHistory,
    growthAsOf: asOf.toISOString(),
    growth: computeWindowsFromGains(gainsOf(starHistory), starHistory.complete, snapshot.stars, asOf),
    quality: quality.filter((q) => q.severity !== 'info'),
  };
}

export function buildDataset(records: RepositoryRecord[], generatedAt: Date, historyPages: number | 'all'): Dataset {
  const repositories = [...records].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  const byDomain: Record<string, number> = {};
  for (const r of repositories) for (const d of r.domains) byDomain[d] = (byDomain[d] ?? 0) + 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    asOfDate: utcDate(generatedAt),
    historyPagesPerRepository: historyPages,
    stats: { repositories: repositories.length, byDomain },
    repositories,
  };
}

// ---------------------------------------------------------------- validation

export class DatasetValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`dataset failed validation (${problems.length} problem(s)): ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? '; ...' : ''}`);
    this.name = 'DatasetValidationError';
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const validIso = (v: unknown): boolean => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const validDate = (v: unknown): boolean => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Structural + consistency validation of an untrusted or freshly built dataset. Returns problems (empty = valid). */
export function validateDataset(ds: unknown): string[] {
  const problems: string[] = [];
  const add = (m: string) => problems.push(m);
  if (typeof ds !== 'object' || ds === null) return ['dataset is not an object'];
  const d = ds as Partial<Dataset>;
  if (d.schemaVersion !== SCHEMA_VERSION) add(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!validIso(d.generatedAt)) add('generatedAt is not an ISO timestamp');
  if (!validDate(d.asOfDate)) add('asOfDate is not a date');
  if (!Array.isArray(d.repositories)) return [...problems, 'repositories must be an array'];

  const asOf = validIso(d.generatedAt) ? new Date(d.generatedAt as string) : new Date(0);
  const seen = new Set<string>();
  let previousId: bigint | null = null;

  d.repositories.forEach((r, i) => {
    const where = `repositories[${i}]${r && typeof r.fullName === 'string' ? ` (${r.fullName})` : ''}`;
    if (typeof r !== 'object' || r === null) return add(`${where} is not an object`);
    if (typeof r.id !== 'string' || !/^\d+$/.test(r.id)) return add(`${where}.id must be a numeric string`);
    if (seen.has(r.id)) add(`${where}.id ${r.id} is duplicated`);
    seen.add(r.id);
    const id = BigInt(r.id);
    if (previousId !== null && id <= previousId) add(`${where} is not sorted by id`);
    previousId = id;
    for (const k of ['owner', 'name', 'fullName', 'url'] as const) if (typeof r[k] !== 'string' || r[k] === '') add(`${where}.${k} is required`);
    if (r.fullName !== `${r.owner}/${r.name}`) add(`${where}.fullName does not equal owner/name`);
    for (const k of ['stars', 'forks', 'openIssues'] as const) if (!isNonNegInt(r[k])) add(`${where}.${k} must be a non-negative integer`);
    for (const k of ['createdAt', 'updatedAt', 'collectedAt'] as const) if (!validIso(r[k])) add(`${where}.${k} is not an ISO timestamp`);
    if (!Array.isArray(r.topics) || !r.topics.every((t) => typeof t === 'string')) add(`${where}.topics must be strings`);
    if (!Array.isArray(r.domains) || r.domains.length === 0) add(`${where}.domains must be non-empty`);
    if (!Array.isArray(r.categories)) add(`${where}.categories must be an array`);
    if (r.metadataSource !== 'graphql' && r.metadataSource !== 'rest') add(`${where}.metadataSource invalid`);

    const h = r.starHistory;
    if (!h || h.source !== STAR_HISTORY_SOURCE) return add(`${where}.starHistory.source invalid`);
    if (!validDate(h.firstDate)) return add(`${where}.starHistory.firstDate invalid`);
    if (!Array.isArray(h.dailyGains) || !h.dailyGains.every(isNonNegInt)) return add(`${where}.starHistory.dailyGains must be non-negative integers`);
    if (!validIso(h.fetchedAt)) add(`${where}.starHistory.fetchedAt invalid`);
    const total = h.dailyGains.reduce((s, n) => s + n, 0);
    if (isNonNegInt(r.stars) && total > r.stars + starDriftTolerance(r.stars)) add(`${where}: history sums to ${total}, more than stars ${r.stars} (tolerance ${starDriftTolerance(r.stars)})`);
    if (isNonNegInt(r.stars) && WINDOW_DAYS.every((n) => r.growth?.[`${n}d` as WindowKey])) {
      const recomputed = computeWindowsFromGains(gainsOf(h), h.complete, r.stars, r.growthAsOf ? new Date(r.growthAsOf) : asOf);
      for (const n of WINDOW_DAYS) {
        const key = `${n}d` as WindowKey;
        if (JSON.stringify(recomputed[key]) !== JSON.stringify(r.growth[key])) add(`${where}.growth.${key} does not match the stored history`);
      }
    } else {
      add(`${where}.growth must contain 7d, 30d and 90d`);
    }
  });

  if (d.stats && d.stats.repositories !== d.repositories.length) add('stats.repositories does not match repositories.length');
  return problems;
}

export function assertValidDataset(ds: unknown): asserts ds is Dataset {
  const problems = validateDataset(ds);
  if (problems.length > 0) throw new DatasetValidationError(problems);
}

/**
 * Refuse to replace an existing valid dataset with a much smaller one (a sign of a
 * partial run). `minRatio` is the fraction of the old repository count we require.
 */
export function assertReplaceable(next: Dataset, existing: Dataset | undefined, options: { minRatio?: number; force?: boolean } = {}): void {
  if (!existing || options.force) return;
  const minRatio = options.minRatio ?? 0.8;
  if (existing.repositories.length > 0 && next.repositories.length < existing.repositories.length * minRatio) {
    throw new DatasetValidationError([
      `new dataset has ${next.repositories.length} repositories vs ${existing.repositories.length} in the existing one (< ${minRatio * 100}%); refusing to replace (use force to override)`,
    ]);
  }
}
