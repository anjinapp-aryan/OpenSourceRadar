import type { CandidateDataset } from '../collect/candidates';
import type { Dataset as RepositoryDataset, RepositoryRecord } from '../collect/dataset';
import type { ClassifiedDataset } from '../classification/datasets';
import type { TopLevelCategory } from '../classification/types';
import { decideTracking, estimateDailyRefreshes, isEligible, selectDue } from './engine';
import type { TrackingDecision, TrackingInput, TrackingMetrics, TrackingPolicy, TrackingSignals, TrackingState, TrackingStatus } from './types';

export const TRACKED_SCHEMA_VERSION = 1 as const;

/**
 * Tracked repositories reference classification by id and keep only a summary of it.
 * Star history and repository metadata stay in the Phase 2 repository dataset / candidate dataset.
 */
export interface TrackedRecord {
  id: string;
  fullName: string;
  /** Present only in the run where the name changed for this id. */
  previousFullName?: string;
  classification: { topLevelCategory: TopLevelCategory; categories: string[] };
  /** HOT/WARM/DORMANT are measured; UNASSESSED means no star history has been collected yet. */
  tier: TrackingStatus;
  refreshIntervalHours: number;
  reason: string;
  signals: TrackingSignals;
  assessed: boolean;
  tierSince: string;
  lastEvaluatedAt: string;
  /** When star history was last collected for this repository; null if never. */
  lastCollectedAt: string | null;
  nextRefreshAt: string;
  transition: { from: TrackingStatus; to: TrackingStatus } | null;
}

export interface TrackedDataset {
  schemaVersion: typeof TRACKED_SCHEMA_VERSION;
  trackingVersion: string;
  generatedAt: string;
  source: { classifierVersion: string; classifiedGeneratedAt: string; growthGeneratedAt: string | null; candidates: number };
  summary: {
    tracked: number;
    byTier: Record<TrackingStatus, number>;
    unassessed: number;
    excluded: { unclassified: number; archived: number; other: number };
    dueNow: number;
    /** Expected history requests per day at the configured refresh intervals. */
    estimatedDailyRefreshes: number;
  };
  repositories: TrackedRecord[];
}

const usable = (w: { status: string; starsPerDay: number | null } | undefined): number | null =>
  w && (w.status === 'ok' || w.status === 'zero-base') ? w.starsPerDay : null;

/** Metrics from the Phase 2 repository record when available, otherwise metadata only (growth null). */
export function metricsFor(
  candidate: { stars: number; createdAt: string; pushedAt: string | null; isArchived: boolean | null },
  record: RepositoryRecord | undefined,
): { metrics: TrackingMetrics; lastRefreshedAt: string | null } {
  const g = record?.growth;
  const w7 = g?.['7d'];
  const src = record ?? candidate;
  // Stars per day over the days that exist: a repository younger than the window must not look slow because the
  // window is longer than its life (measured: 25 of 45 repositories aged 4-5 days were wrongly DORMANT before this).
  const asOf = record ? Date.parse(record.growthAsOf ?? record.starHistory.fetchedAt) : NaN;
  const ageDays = Number.isFinite(asOf) ? (asOf - Date.parse(src.createdAt)) / 86_400_000 : Infinity;
  const observed7 = ageDays < 7 ? Math.max(1, Math.ceil(ageDays)) : 7;
  return {
    metrics: {
      stars: src.stars,
      createdAt: src.createdAt,
      pushedAt: src.pushedAt,
      isArchived: src.isArchived === true,
      starsPerDay7d: w7 && (w7.status === 'ok' || w7.status === 'zero-base') && w7.growth !== null ? w7.growth / observed7 : null,
      starsPerDay30d: usable(g?.['30d']),
      growth7d: w7 && (w7.status === 'ok' || w7.status === 'zero-base') ? w7.growth : null,
      growthPercent7d: w7 && w7.status === 'ok' ? w7.growthPercent : null,
    },
    lastRefreshedAt: record?.starHistory.fetchedAt ?? null,
  };
}

export interface BuildTrackedOptions {
  classified: ClassifiedDataset;
  candidates: CandidateDataset;
  /** Phase 2 repository dataset (star history + growth), if any. */
  growth?: RepositoryDataset;
  previous?: TrackedDataset;
  policy: TrackingPolicy;
  now: Date;
}

export function buildTrackedDataset(o: BuildTrackedOptions): TrackedDataset {
  const cand = new Map(o.candidates.candidates.map((c) => [c.id, c]));
  const growth = new Map((o.growth?.repositories ?? []).map((r) => [r.id, r]));
  const prev = new Map((o.previous?.repositories ?? []).map((r) => [r.id, r]));
  const nowIso = o.now.toISOString();

  const records: TrackedRecord[] = [];
  const excluded = { unclassified: 0, archived: 0, other: 0 };

  for (const c of o.classified.repositories) {
    const candidate = cand.get(c.id);
    if (!candidate) {
      excluded.other += 1; // classified but no metadata to evaluate: cannot track what we cannot measure
      continue;
    }
    const { metrics, lastRefreshedAt } = metricsFor(candidate, growth.get(c.id));
    const input: TrackingInput = { id: c.id, topLevelCategory: c.result.topLevelCategory, metrics, lastRefreshedAt };
    const gate = isEligible(input, o.policy);
    if (!gate.eligible) {
      if (c.result.topLevelCategory === 'UNKNOWN') excluded.unclassified += 1;
      else if (metrics.isArchived) excluded.archived += 1;
      else excluded.other += 1;
      continue;
    }
    const before = prev.get(c.id);
    // A previous record that was never measured (Phase 3 provisional tiers) is UNASSESSED, whatever tier it carries.
    const state: TrackingState | undefined = before ? { tier: before.assessed ? before.tier : 'UNASSESSED', tierSince: before.tierSince } : undefined;
    const d: TrackingDecision = decideTracking(input, o.policy, o.now, state);
    const record: TrackedRecord = {
      id: c.id,
      fullName: candidate.fullName,
      classification: { topLevelCategory: c.result.topLevelCategory, categories: c.result.categories.map((x) => x.slug) },
      tier: d.tier,
      refreshIntervalHours: d.refreshIntervalHours,
      reason: d.reason,
      signals: d.signals,
      assessed: d.assessed,
      tierSince: d.tierSince,
      lastEvaluatedAt: nowIso,
      lastCollectedAt: lastRefreshedAt,
      nextRefreshAt: d.nextRefreshAt,
      transition: d.transition,
    };
    if (before && before.fullName !== candidate.fullName) record.previousFullName = before.fullName;
    records.push(record);
  }

  records.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  const byTier: Record<TrackingStatus, number> = { HOT: 0, WARM: 0, DORMANT: 0, UNASSESSED: 0 };
  for (const r of records) byTier[r.tier] += 1;
  return {
    schemaVersion: TRACKED_SCHEMA_VERSION,
    trackingVersion: o.policy.trackingVersion,
    generatedAt: nowIso,
    source: {
      classifierVersion: o.classified.classifierVersion,
      classifiedGeneratedAt: o.classified.generatedAt,
      growthGeneratedAt: o.growth?.generatedAt ?? null,
      candidates: o.candidates.candidates.length,
    },
    summary: {
      tracked: records.length,
      byTier,
      unassessed: byTier.UNASSESSED,
      excluded,
      dueNow: selectDue(records, o.now, o.policy.dueOrder, undefined, o.policy.dueGraceHours).length,
      // measured tiers only: UNASSESSED is a one-time first-assessment cost, reported as `unassessed`
      estimatedDailyRefreshes: Math.round(estimateDailyRefreshes({ HOT: byTier.HOT, WARM: byTier.WARM, DORMANT: byTier.DORMANT }, o.policy) * 10) / 10,
    },
    repositories: records,
  };
}

export function validateTrackedDataset(ds: unknown): string[] {
  const problems: string[] = [];
  if (typeof ds !== 'object' || ds === null) return ['tracked dataset is not an object'];
  const d = ds as Partial<TrackedDataset>;
  if (d.schemaVersion !== TRACKED_SCHEMA_VERSION) problems.push(`schemaVersion must be ${TRACKED_SCHEMA_VERSION}`);
  if (!Array.isArray(d.repositories)) return [...problems, 'repositories must be an array'];
  const seen = new Set<string>();
  d.repositories.forEach((r, i) => {
    const where = `repositories[${i}]`;
    if (typeof r?.id !== 'string' || !/^\d+$/.test(r.id)) return void problems.push(`${where}.id must be a numeric string`);
    if (seen.has(r.id)) problems.push(`${where}.id ${r.id} is duplicated`);
    seen.add(r.id);
    if (!['HOT', 'WARM', 'DORMANT', 'UNASSESSED'].includes(r.tier)) problems.push(`${where}.tier invalid`);
    if (r.tier === 'UNASSESSED' && r.lastCollectedAt !== null) problems.push(`${where}: UNASSESSED but has a collection time`);
    if (!(r.refreshIntervalHours > 0)) problems.push(`${where}.refreshIntervalHours must be positive`);
    if (Number.isNaN(Date.parse(r.nextRefreshAt))) problems.push(`${where}.nextRefreshAt invalid`);
    if (typeof r.reason !== 'string' || r.reason === '') problems.push(`${where}.reason is required`);
    if (r.classification?.topLevelCategory === 'UNKNOWN') problems.push(`${where}: UNKNOWN repositories must not be tracked`);
  });
  if (d.summary && d.summary.tracked !== d.repositories.length) problems.push('summary.tracked does not match repositories.length');
  return problems;
}
