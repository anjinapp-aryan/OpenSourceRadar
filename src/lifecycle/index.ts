/**
 * Record lifecycle (Phase 6.1). Pure and deterministic.
 *
 * A record's data can be missing or old for different reasons; each reason is an explicit state, and a record with
 * missing data is NEVER treated as "no growth" (it is not DORMANT; it is withheld or flagged).
 *
 *   ACTIVE      tracked, collected on schedule: published.
 *   STALE       tracked but overdue (collected longer ago than 2 refresh intervals plus a grace period): published
 *               with a visible flag, because it is still refreshed and will recover on the next run.
 *   UNASSESSED  tracked but no star history collected yet: nothing to rank.
 *   ORPHAN      has history in the repository dataset but is not in the discovery candidate set, so nothing will ever
 *               refresh it: withheld from the public dataset (kept in pipeline state, not deleted).
 *   EXCLUDED    in the candidate set but not eligible for tracking (classification UNKNOWN): never refreshed,
 *               so withheld from the public dataset (kept in state; it returns when it becomes classified).
 *   ARCHIVED    archived on GitHub: withheld.
 */
export const LIFECYCLE_STATES = ['ACTIVE', 'STALE', 'UNASSESSED', 'ORPHAN', 'EXCLUDED', 'ARCHIVED'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export interface LifecycleConfig {
  /** A tracked record is stale after this many refresh intervals plus `graceHours`. */
  staleAfterIntervals: number;
  graceHours: number;
  /** States that are published. */
  publish: LifecycleState[];
}

export interface LifecycleInput {
  archived: boolean;
  inCandidates: boolean;
  /** Tracking decision for the record, or null when the record is not tracked. */
  tracked: { tier: string; lastCollectedAt: string | null; refreshIntervalHours: number } | null;
  classificationTopLevel: string | null;
  now: Date;
}

export interface LifecycleResult {
  state: LifecycleState;
  reason: string;
}

export function classifyLifecycle(i: LifecycleInput, cfg: LifecycleConfig): LifecycleResult {
  if (i.archived) return { state: 'ARCHIVED', reason: 'archived on GitHub' };
  if (!i.inCandidates) return { state: 'ORPHAN', reason: 'not in the discovery candidate set; nothing refreshes it' };
  if (i.tracked === null) {
    return { state: 'EXCLUDED', reason: i.classificationTopLevel === 'UNKNOWN' ? 'classification UNKNOWN: not tracked, not refreshed' : 'not eligible for tracking' };
  }
  if (i.tracked.tier === 'UNASSESSED' || i.tracked.lastCollectedAt === null) return { state: 'UNASSESSED', reason: 'no star history collected yet' };
  const ageHours = (i.now.getTime() - Date.parse(i.tracked.lastCollectedAt)) / 3_600_000;
  const limit = cfg.staleAfterIntervals * i.tracked.refreshIntervalHours + cfg.graceHours;
  if (Number.isNaN(ageHours)) return { state: 'UNASSESSED', reason: 'collection time unreadable' };
  if (ageHours > limit) return { state: 'STALE', reason: `collected ${Math.round(ageHours)} h ago; limit for the ${i.tracked.tier} tier is ${Math.round(limit)} h` };
  return { state: 'ACTIVE', reason: 'tracked and collected on schedule' };
}

export function parseLifecycleConfig(raw: unknown): LifecycleConfig {
  const bad = (m: string): never => {
    throw new Error(`lifecycle config: ${m}`);
  };
  const r = raw as Record<string, any> | null;
  if (!r || typeof r !== 'object') return bad('not an object');
  if (typeof r.staleAfterIntervals !== 'number' || r.staleAfterIntervals < 1) bad('staleAfterIntervals must be >= 1');
  if (typeof r.graceHours !== 'number' || r.graceHours < 0) bad('graceHours must be >= 0');
  if (!Array.isArray(r.publish) || r.publish.length === 0 || r.publish.some((s: unknown) => !LIFECYCLE_STATES.includes(s as LifecycleState))) bad('publish must list lifecycle states');
  return { staleAfterIntervals: r.staleAfterIntervals, graceHours: r.graceHours, publish: r.publish };
}
