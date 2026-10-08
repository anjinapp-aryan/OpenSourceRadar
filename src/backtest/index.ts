/**
 * Historical back-testing (Phase 6.2). Pure and deterministic.
 *
 * "If the CURRENT production rules had evaluated this repository at the end of date T, what would they have said?"
 *
 * The production engine (`evaluateRepository`) and pattern model (`classifyPattern`) are called unchanged. Only the
 * INPUT is rewound to T, using information that existed at T:
 *   - daily gains on dates <= T only (everything after T is dropped, never read);
 *   - stars at T = stars now - gains after T (the storage format's own definition of past star counts);
 *   - pushedAt kept only when it is <= T; a later push hides the last push before T, so it becomes unknown (null);
 *   - the evaluation instant is the end of day T, and "now" equals it (data is fresh at T).
 * Known limits (documented, not hidden): `isArchived` and star-history completeness are the current values (archive
 * dates are not stored; 1 archived record exists), and star history reflects stars still held today (removed stars
 * disappear from the past). Classification, discovery membership and tracking tier at T are NOT reconstructed.
 */
import { addDays } from '../analysis/starHistory';
import { computeWindowsFromGains } from '../analysis/windows';
import { gainsOf, type RepositoryRecord } from '../collect/dataset';
import { classifyPattern, type Pattern, type PatternConfig } from '../explain/pattern';
import { evaluateRepository } from '../momentum/engine';
import type { MomentumConfig, TrendLabel } from '../momentum/types';

const DAY_MS = 86_400_000;

export interface HistoricalSnapshot {
  date: string;
  score: number | null;
  trend: TrendLabel;
  pattern: Pattern | null;
  stars: number;
  growth7d: number | null;
  growth30d: number | null;
  growth90d: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  accelerationRatio: number | null;
  sustained: boolean;
  newEntrant: boolean;
  ageDays: number;
}

/** Last stored date of a record's series, or null when empty. */
export function lastHistoryDate(r: RepositoryRecord): string | null {
  const n = r.starHistory.dailyGains.length;
  return n === 0 ? null : addDays(r.starHistory.firstDate, n - 1);
}

/**
 * The record as it would have looked at the end of `date`, or null when the series has no value on or before `date`
 * or does not reach `date` (nothing can be said without inventing data).
 */
export function historicalRecord(r: RepositoryRecord, date: string): RepositoryRecord | null {
  const h = r.starHistory;
  const last = lastHistoryDate(r);
  if (last === null || date > last || date < h.firstDate) return null;
  if (Date.parse(`${date}T23:59:59.999Z`) < Date.parse(r.createdAt)) return null;
  const keep = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${h.firstDate}T00:00:00Z`)) / DAY_MS) + 1;
  const dailyGains = h.dailyGains.slice(0, keep);
  let after = 0;
  for (let i = keep; i < h.dailyGains.length; i += 1) after += h.dailyGains[i] as number;
  const asOf = `${date}T23:59:59.999Z`;
  const stars = Math.max(0, r.stars - after);
  const pushedAt = r.pushedAt !== null && Date.parse(r.pushedAt) <= Date.parse(asOf) ? r.pushedAt : null;
  const starHistory = { ...h, dailyGains, fetchedAt: asOf };
  return {
    ...r,
    stars,
    pushedAt,
    updatedAt: asOf,
    collectedAt: asOf,
    growthAsOf: asOf,
    starHistory,
    growth: computeWindowsFromGains(gainsOf(starHistory), h.complete, stars, new Date(asOf)),
  };
}

/** Evaluate with the unchanged production engine and pattern model. Returns null when `date` is not covered. */
export function evaluateAt(r: RepositoryRecord, date: string, cfg: MomentumConfig, pcfg: PatternConfig): HistoricalSnapshot | null {
  const hr = historicalRecord(r, date);
  if (hr === null) return null;
  const asOf = new Date(hr.growthAsOf as string);
  const e = evaluateRepository(hr, hr.growthAsOf as string, asOf, cfg);
  return snapshotOf(date, hr.stars, e, pcfg);
}

/** Reproduce the production evaluation exactly (same instants as the pipeline), for validation of the back-tester. */
export function evaluateCurrent(r: RepositoryRecord, datasetGeneratedAt: string, now: Date, cfg: MomentumConfig, pcfg: PatternConfig): HistoricalSnapshot {
  const e = evaluateRepository(r, datasetGeneratedAt, now, cfg);
  return snapshotOf((r.growthAsOf ?? datasetGeneratedAt).slice(0, 10), r.stars, e, pcfg);
}

function snapshotOf(date: string, stars: number, e: ReturnType<typeof evaluateRepository>, pcfg: PatternConfig): HistoricalSnapshot {
  const s = e.signals;
  const pattern =
    e.momentum.score === null
      ? null
      : classifyPattern(
          {
            stars,
            ageDays: s.ageDays,
            growth7d: s.growth7d,
            growth30d: s.growth30d,
            growth90d: s.growth90d,
            velocity7d: s.velocity7d,
            velocity30d: s.velocity30d,
            velocity90d: s.velocity90d,
            priorVelocity: s.priorVelocity,
            accelerationRatio: s.accelerationRatio,
            trend: e.trend,
            flags: { sustained: !e.archived && s.sustained, newEntrant: !e.archived && s.newEntrant },
          },
          pcfg,
        );
  return {
    date,
    score: e.momentum.score,
    trend: e.trend,
    pattern,
    stars,
    growth7d: s.growth7d,
    growth30d: s.growth30d,
    growth90d: s.growth90d,
    velocity7d: s.velocity7d,
    velocity30d: s.velocity30d,
    accelerationRatio: s.accelerationRatio,
    sustained: !e.archived && s.sustained,
    newEntrant: !e.archived && s.newEntrant,
    ageDays: s.ageDays,
  };
}

/** Dates `endDate - k` for k = 0..days-1, newest first. */
export function dateRange(endDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, k) => addDays(endDate, -k));
}

// ------------------------------------------------------------------ Rising persistence (from daily snapshots)

export interface RisingEpisode {
  start: string;
  end: string;
  days: number;
  /** True when the episode is still open on the newest evaluated date. */
  ongoing: boolean;
  /** True when the episode starts on the oldest evaluated date (its real start may be earlier). */
  leftCensored: boolean;
  /** Pattern on the first day of the episode. */
  entryPattern: Pattern | null;
}

export interface RisingHistory {
  daysEvaluated: number;
  risingDays: number;
  episodes: RisingEpisode[];
  longestStreak: number;
  /** Consecutive Rising days ending on the newest date (0 when not Rising now). */
  currentStreak: number;
}

/**
 * Episodes of consecutive RISING days. `snapshots` must be ordered oldest -> newest with one entry per day (null = the
 * record's series does not cover that day).
 *
 * Coverage is not behaviour: days BEFORE the first covered day and AFTER the last covered day carry no information, so
 * they neither start nor end an episode. An episode that is still open on the record's last covered day is `ongoing`
 * (records are refreshed on different days, so the newest grid date is not covered for every record). A null in the
 * middle of a series cannot occur with the stored format (contiguous days); if it did, it would close the episode.
 */
export function risingHistory(snapshots: ReadonlyArray<HistoricalSnapshot | null>): RisingHistory {
  const episodes: RisingEpisode[] = [];
  let firstCovered = -1;
  let lastCovered = -1;
  snapshots.forEach((s, i) => {
    if (s !== null) {
      if (firstCovered < 0) firstCovered = i;
      lastCovered = i;
    }
  });
  let cur: RisingEpisode | null = null;
  let risingDays = 0;
  for (let i = firstCovered; i >= 0 && i <= lastCovered; i += 1) {
    const s = snapshots[i] ?? null;
    if (s?.trend === 'RISING') {
      risingDays += 1;
      if (cur === null) cur = { start: s.date, end: s.date, days: 0, ongoing: false, leftCensored: i === 0, entryPattern: s.pattern };
      cur.end = s.date;
      cur.days += 1;
    } else if (cur !== null) {
      episodes.push(cur);
      cur = null;
    }
  }
  if (cur !== null) {
    (cur as RisingEpisode).ongoing = true;
    episodes.push(cur);
  }
  const last = episodes[episodes.length - 1];
  return {
    daysEvaluated: snapshots.filter((s) => s !== null).length,
    risingDays,
    episodes,
    longestStreak: episodes.reduce((m, e) => Math.max(m, e.days), 0),
    currentStreak: last?.ongoing ? last.days : 0,
  };
}

/** The newest snapshot that exists (the record's own last covered day). */
export function lastSnapshot(snapshots: ReadonlyArray<HistoricalSnapshot | null>): HistoricalSnapshot | null {
  for (let i = snapshots.length - 1; i >= 0; i -= 1) if (snapshots[i] !== null) return snapshots[i] as HistoricalSnapshot;
  return null;
}
