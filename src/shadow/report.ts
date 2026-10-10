/**
 * Phase 6.3.1: production-shadow reporting. Pure, deterministic functions that turn one run of the Top-300 discovery (raw search
 * results), the production candidate set and the admission policy into the numbers the shadow cycle must record, and that
 * aggregate daily records into a weekly cycle. Nothing here calls GitHub, reads the clock or writes files, and nothing imports
 * from production publication code: shadow output cannot reach `radar.json` through this module.
 */
import { admit, lifetimeStarsPerDay, worstCaseHistoryRequestsPerDay, type AdmissionCandidate, type AdmissionConfig, type RejectReason } from '../discovery/admission';
import { normalizeHits } from '../discovery/shadow';
import type { RepositorySnapshot } from '../model/repositorySnapshot';

export type TopLevel = 'AI' | 'ENGINEERING' | 'BOTH' | 'UNKNOWN';

export interface ClassifiedFacts {
  topLevel: TopLevel;
  learning: boolean;
}

export interface DiscoveryQueryResult {
  /** The cache/query key, for example "llm|B:top300". */
  key: string;
  query: string;
  repositories: RepositorySnapshot[];
  pages: number;
}

export interface DiscoveryStats {
  queries: number;
  searchRequests: number;
  rawResults: number;
  uniqueRepositories: number;
  duplicateResults: number;
  archived: number;
  forks: number;
  malformed: number;
  /** Unique, non-archived, non-fork repositories. */
  usable: number;
  alreadyCandidate: number;
  classified: Record<TopLevel, number>;
  unknownRate: number;
  belowStarFloor: number;
  learningContent: number;
  belowPriority: number;
  /** Passed every gate before the caps. */
  proposedAdmissions: number;
  capHits: { weekly: number; pool: number };
  newAdmissions: number;
  rejectedTotal: number;
  rejectedByReason: Partial<Record<RejectReason, number>>;
}

export interface AdmittedRecord {
  id: string;
  fullName: string;
  stars: number;
  priority: number;
  topLevel: TopLevel;
}

export interface DiscoveryReport {
  stats: DiscoveryStats;
  admitted: AdmittedRecord[];
  /** Admission-time budget arithmetic, from the configuration. */
  budget: { currentHistoryRequestsPerDay: number; worstCaseHistoryRequestsPerDay: number; ceiling: number; headroomAtWorstCase: number };
}

export interface SummarizeOptions {
  results: readonly DiscoveryQueryResult[];
  /** Ids already in the production candidate set (the control): admission never re-admits them. */
  productionIds: ReadonlySet<string>;
  /** Ids admitted in earlier weeks and still in the shadow pool. */
  poolIds: ReadonlySet<string>;
  classify: (s: RepositorySnapshot) => ClassifiedFacts;
  config: AdmissionConfig;
  now: Date;
}

export function summarizeDiscovery(o: SummarizeOptions): DiscoveryReport {
  const raw = o.results.flatMap((r) => r.repositories);
  const norm = normalizeHits(raw);
  const uniqueIds = new Set<string>();
  for (const r of raw) if (r && typeof r === 'object' && typeof (r as RepositorySnapshot).repositoryId === 'string') uniqueIds.add((r as RepositorySnapshot).repositoryId);
  // archived/fork repositories are removed by normalizeHits; count them from the raw stream by unique id
  const seen = new Set<string>();
  let archived = 0;
  let forks = 0;
  for (const r of raw) {
    const id = (r as RepositorySnapshot)?.repositoryId;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    if ((r as RepositorySnapshot).isArchived === true) archived += 1;
    else if ((r as RepositorySnapshot).isFork === true) forks += 1;
  }
  const usable = norm.repositories;
  const facts = new Map(usable.map((s) => [s.repositoryId, o.classify(s)]));
  const candidates: AdmissionCandidate[] = usable.map((s) => ({
    id: s.repositoryId,
    fullName: s.fullName,
    stars: s.stars,
    createdAt: s.createdAt,
    topLevel: facts.get(s.repositoryId)!.topLevel,
    contentType: facts.get(s.repositoryId)!.learning ? 'learning' : 'software',
    isArchived: false,
    isFork: false,
    alreadyCandidate: o.productionIds.has(s.repositoryId),
    alreadyAdmitted: o.poolIds.has(s.repositoryId),
  }));
  const res = admit(candidates, o.config, o.now, o.poolIds.size);
  const classified: Record<TopLevel, number> = { AI: 0, ENGINEERING: 0, BOTH: 0, UNKNOWN: 0 };
  for (const c of candidates) if (!c.alreadyCandidate) classified[c.topLevel] += 1;
  const novel = candidates.filter((c) => !c.alreadyCandidate).length;
  const by = res.stats.byReason;
  const weekly = by['weekly-cap'] ?? 0;
  const pool = by['pool-cap'] ?? 0;
  const proposed = res.admitted.length + weekly + pool;
  const stats: DiscoveryStats = {
    queries: o.results.length,
    searchRequests: o.results.reduce((a, r) => a + r.pages, 0),
    rawResults: raw.length,
    uniqueRepositories: uniqueIds.size,
    duplicateResults: raw.length - uniqueIds.size,
    archived,
    forks,
    malformed: norm.rejected.malformed,
    usable: usable.length,
    alreadyCandidate: candidates.filter((c) => c.alreadyCandidate).length,
    classified,
    unknownRate: novel === 0 ? 0 : +(classified.UNKNOWN / novel).toFixed(4),
    belowStarFloor: by['below-min-stars'] ?? 0,
    learningContent: by['learning-content'] ?? 0,
    belowPriority: by['below-priority'] ?? 0,
    proposedAdmissions: proposed,
    capHits: { weekly, pool },
    newAdmissions: res.admitted.length,
    rejectedTotal: res.rejected.length,
    rejectedByReason: by,
  };
  const worst = worstCaseHistoryRequestsPerDay(o.config);
  return {
    stats,
    admitted: res.admitted.map((a) => ({ id: a.id, fullName: a.fullName, stars: a.stars, priority: +a.priority.toFixed(1), topLevel: a.topLevel })),
    budget: { currentHistoryRequestsPerDay: o.config.budget.currentHistoryRequestsPerDay, worstCaseHistoryRequestsPerDay: worst, ceiling: o.config.budget.maxHistoryRequestsPerDay, headroomAtWorstCase: o.config.budget.maxHistoryRequestsPerDay - worst },
  };
}

// ------------------------------------------------------------------------------------------------ the weekly cycle

export interface DailyRecord {
  /** UTC date of the run, YYYY-MM-DD. */
  date: string;
  /** History requests made by the shadow tracker that day (admitted repositories only). */
  historyRequests: number;
  historyFailures: number;
  /** Production history requests that day (collected repositories), from the production state; for budget accounting. */
  productionHistoryRequests: number;
  searchRequests: number;
  poolSize: number;
  newAdmissions: number;
  runtimeSeconds: number;
  rateLimit: { remainingAtEnd: number | null; hitLimit: boolean };
  /** Present on the weekly discovery day only. */
  discovery?: DiscoveryReport;
  // ---- Phase 6.3.2 daily evidence (optional so earlier records stay valid)
  /** UTC instant the tracker started. */
  startedAt?: string;
  /** Tier of every pool member after the run. */
  tierCounts?: { HOT: number; WARM: number; DORMANT: number; UNASSESSED: number };
  retries?: number;
  /** The shadow makes REST requests only (star history, search, one rate-limit check); GraphQL is 0 by construction. */
  restRequests?: number;
  graphqlRequests?: number;
  /** Shadow total: history + search + the rate-limit check. Production's own requests are in `productionHistoryRequests`. */
  totalApiRequests?: number;
  /** The history requests the shared ceiling left for the shadow this day, and how that was decided. */
  budgetForShadow?: number;
  budgetBasis?: 'recorded' | 'worst-case';
  /** Latest `lastCollectedAt` in the production state, and whether production's collection for this date finished before the shadow started. */
  productionLastCollectedAt?: string | null;
  startedAfterProduction?: boolean | null;
  discoveryStrategy?: string;
}

/** One row of the seven-day evidence table. A value that was not recorded is null; nothing is filled in. */
export function dailyEvidenceRow(d: DailyRecord) {
  const s = d.discovery?.stats;
  return {
    date: d.date,
    discoveryStrategy: d.discoveryStrategy ?? (d.discovery ? 'Top-300 topic discovery (66 topics, pages 1-3)' : 'tracking only (no discovery today)'),
    searchRequests: d.searchRequests,
    uniqueRepositories: s ? s.uniqueRepositories : null,
    newCandidates: s ? s.usable - s.alreadyCandidate : null,
    unknown: s ? s.classified.UNKNOWN : null,
    proposedAdmissions: s ? s.proposedAdmissions : null,
    acceptedAdmissions: s ? s.newAdmissions : d.newAdmissions,
    rejectedAdmissions: s ? s.rejectedTotal : null,
    capHits: s ? s.capHits : null,
    tiers: d.tierCounts ?? null,
    historyRequests: d.historyRequests,
    restRequests: d.restRequests ?? null,
    graphqlRequests: d.graphqlRequests ?? null,
    totalApiRequests: d.totalApiRequests ?? null,
    productionHistoryRequests: d.productionHistoryRequests,
    combinedHistoryRequests: d.historyRequests + d.productionHistoryRequests,
    runtimeSeconds: d.runtimeSeconds,
    failures: d.historyFailures,
    retries: d.retries ?? null,
    poolSize: d.poolSize,
    startedAt: d.startedAt ?? null,
    startedAfterProduction: d.startedAfterProduction ?? null,
    budgetForShadow: d.budgetForShadow ?? null,
    budgetBasis: d.budgetBasis ?? null,
  };
}

export interface CycleSummary {
  days: number;
  daysObserved: string[];
  complete: boolean;
  discoveryRuns: number;
  totalCandidates: number;
  totalProposedAdmissions: number;
  totalAcceptedAdmissions: number;
  admissionRate: number | null;
  rejectionRate: number | null;
  unknownRate: number | null;
  historyRequestsPerDay: { mean: number; max: number } | null;
  totalRequestsPerDay: { mean: number; max: number } | null;
  searchRequestsPerWeek: number;
  failures: number;
  rateLimitHits: number;
  ceiling: number;
  headroomAtMax: number | null;
  withinCeiling: boolean | null;
  stopCondition: string | null;
}

/**
 * A weekly cycle is COMPLETE only when seven distinct consecutive UTC dates are present and one of them carries a discovery run.
 * Anything less is reported as incomplete: the cycle is never inferred or filled in.
 */
export function summarizeCycle(days: readonly DailyRecord[], ceiling: number): CycleSummary {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = sorted.map((d) => d.date);
  const distinct = new Set(dates);
  const consecutive = (() => {
    if (distinct.size < 7) return false;
    const list = [...distinct];
    for (let i = 1; i < list.length; i += 1) if (Date.parse(`${list[i]}T00:00:00Z`) - Date.parse(`${list[i - 1]}T00:00:00Z`) !== 86_400_000) return false;
    return true;
  })();
  const runs = sorted.filter((d) => d.discovery);
  const complete = consecutive && distinct.size >= 7 && runs.length >= 1;
  const disc = runs.map((d) => d.discovery!.stats);
  const totalCandidates = disc.reduce((a, s) => a + s.uniqueRepositories, 0);
  const proposed = disc.reduce((a, s) => a + s.proposedAdmissions, 0);
  const accepted = disc.reduce((a, s) => a + s.newAdmissions, 0);
  const rejected = disc.reduce((a, s) => a + s.rejectedTotal, 0);
  const considered = disc.reduce((a, s) => a + s.usable, 0);
  const novelClassified = disc.reduce((a, s) => a + s.classified.AI + s.classified.ENGINEERING + s.classified.BOTH + s.classified.UNKNOWN, 0);
  const unknown = disc.reduce((a, s) => a + s.classified.UNKNOWN, 0);
  const h = sorted.map((d) => d.historyRequests);
  const t = sorted.map((d) => d.historyRequests + d.productionHistoryRequests);
  const stats = (xs: number[]) => (xs.length === 0 ? null : { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), max: Math.max(...xs) });
  const totalMax = t.length ? Math.max(...t) : null;
  const withinCeiling = totalMax === null ? null : totalMax <= ceiling;
  // STOP when the observed total gets within 10% of the ceiling: the limit is never raised automatically
  const stop = totalMax !== null && totalMax >= 0.9 * ceiling ? `observed maximum ${totalMax} requests per day is within 10% of the ${ceiling} ceiling: stop and review (the ceiling is never raised automatically)` : null;
  return {
    days: sorted.length,
    daysObserved: dates,
    complete,
    discoveryRuns: runs.length,
    totalCandidates,
    totalProposedAdmissions: proposed,
    totalAcceptedAdmissions: accepted,
    admissionRate: considered === 0 ? null : +(accepted / considered).toFixed(4),
    rejectionRate: considered === 0 ? null : +(rejected / considered).toFixed(4),
    unknownRate: novelClassified === 0 ? null : +(unknown / novelClassified).toFixed(4),
    historyRequestsPerDay: stats(h),
    totalRequestsPerDay: stats(t),
    searchRequestsPerWeek: sorted.reduce((a, d) => a + d.searchRequests, 0),
    failures: sorted.reduce((a, d) => a + d.historyFailures, 0),
    rateLimitHits: sorted.filter((d) => d.rateLimit.hitLimit).length,
    ceiling,
    headroomAtMax: totalMax === null ? null : ceiling - totalMax,
    withinCeiling,
    stopCondition: stop,
  };
}

/** Expected shadow budget: production load plus the admitted pool refreshed at the measured mean rate. */
export function expectedHistoryRequestsPerDay(current: number, poolSize: number, meanRequestsPerRepoPerDay: number): number {
  return +(current + poolSize * meanRequestsPerRepoPerDay).toFixed(1);
}

export { lifetimeStarsPerDay };
