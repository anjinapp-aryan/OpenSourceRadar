import { addDays } from '../analysis/starHistory';
import type { RepositoryRecord } from '../collect/dataset';

/**
 * Public trajectory data (Phase 6.1). Daily star gains for the last `days` days, taken verbatim from the stored star
 * history (GitHub's weekly buckets expanded to days). Nothing is filled in: a series shorter than the window stays
 * shorter, and a repository without history gets no entry.
 *
 * Entry `e` is the UTC date of the LAST value (the current day, which may be partial); `g[i]` is the gain on
 * date `e - (g.length - 1 - i)`.
 */
export interface HistoryEntry {
  e: string;
  g: number[];
}

export interface HistoryDataset {
  schemaVersion: 1;
  generatedAt: string;
  days: number;
  repositories: Record<string, HistoryEntry>;
}

export function buildHistory(records: readonly RepositoryRecord[], include: ReadonlySet<string>, days: number, generatedAt: string): HistoryDataset {
  const repositories: Record<string, HistoryEntry> = {};
  const sorted = [...records].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  for (const r of sorted) {
    if (!include.has(r.id)) continue;
    const all = r.starHistory.dailyGains;
    if (all.length === 0) continue;
    const g = all.slice(-days);
    repositories[r.id] = { e: addDays(r.starHistory.firstDate, all.length - 1), g };
  }
  return { schemaVersion: 1, generatedAt, days, repositories };
}

export type WindowDays = 7 | 30 | 90;

export type TrajectoryState =
  | { kind: 'missing' }
  | { kind: 'insufficient'; have: number; need: number }
  | { kind: 'ok'; gains: number[]; end: string; young: boolean; observedDays: number };

/**
 * Decide what can honestly be drawn. `ageDays` comes from the public record. A repository younger than the window
 * legitimately has fewer days (`young`); a repository older than the window with a shorter series is `insufficient`.
 * A day of missing data is never drawn as zero.
 */
export function trajectoryFor(entry: HistoryEntry | undefined, ageDays: number, windowDays: WindowDays): TrajectoryState {
  if (!entry || entry.g.length === 0) return { kind: 'missing' };
  const need = Math.min(windowDays, Math.max(1, Math.floor(ageDays)));
  if (entry.g.length < need - 1) return { kind: 'insufficient', have: entry.g.length, need };
  const gains = entry.g.slice(-windowDays);
  return { kind: 'ok', gains, end: entry.e, young: ageDays < windowDays, observedDays: gains.length };
}

export function sumLast(gains: readonly number[], n: number): number | null {
  if (gains.length < n) return null;
  return gains.slice(-n).reduce((a, b) => a + b, 0);
}

export interface HistoryQuality {
  records: number;
  length: { p10: number; p25: number; p50: number; p75: number; p90: number; max: number };
  atLeast90Days: number;
  insufficient: number;
  trailingGap: number;
  invalidValues: number;
  complete: number;
  youngerThan90Days: number;
}

const quantile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

/** Measured quality of the stored histories for a set of records (used for the validation report). */
export function historyQuality(records: readonly RepositoryRecord[], ageOf: (r: RepositoryRecord) => number, asOfOf: (r: RepositoryRecord) => string): HistoryQuality {
  const lens = records.map((r) => r.starHistory.dailyGains.length).sort((a, b) => a - b);
  let atLeast90 = 0;
  let insufficient = 0;
  let trailingGap = 0;
  let invalid = 0;
  let complete = 0;
  let young = 0;
  const day = 86_400_000;
  for (const r of records) {
    const h = r.starHistory;
    const L = h.dailyGains.length;
    const age = ageOf(r);
    if (L >= 90) atLeast90 += 1;
    if (age < 90) young += 1;
    if (L < Math.min(90, Math.floor(age)) - 1) insufficient += 1;
    if (h.complete) complete += 1;
    const last = addDays(h.firstDate, Math.max(0, L - 1));
    if ((Date.parse(`${asOfOf(r)}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / day > 1) trailingGap += 1;
    if (h.dailyGains.some((x) => !Number.isInteger(x) || x < 0)) invalid += 1;
  }
  return {
    records: records.length,
    length: { p10: quantile(lens, 0.1), p25: quantile(lens, 0.25), p50: quantile(lens, 0.5), p75: quantile(lens, 0.75), p90: quantile(lens, 0.9), max: lens[lens.length - 1] ?? 0 },
    atLeast90Days: atLeast90,
    insufficient,
    trailingGap,
    invalidValues: invalid,
    complete,
    youngerThan90Days: young,
  };
}
