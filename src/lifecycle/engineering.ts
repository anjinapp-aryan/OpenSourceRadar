/**
 * Phase 6.3.1: Engineering lifecycle semantics. Pure and deterministic; shadow only (not imported by production code).
 *
 * Every state is a function of (a) the repository's daily star gains up to the evaluation date T, (b) the peer-relative Trending flag from
 * `momentum/normalize`, and (c) lifecycle facts (dates). Nothing after T is read. The state definitions, their thresholds and the evidence for
 * choosing them are in docs/PHASE-6.3.1-LIFECYCLE-SEMANTICS.md; the thresholds live in config/lifecycle.engineering.json.
 */
import { readFileSync } from 'node:fs';

export interface WeeklyWindows {
  /** Stars gained in the 7 days ending at T. */
  w0: number;
  /** The three previous 7-day windows, then the fourth: w1 is T-13..T-7, w4 is T-34..T-28. */
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

/** Weekly windows from daily gains ending at T (ascending). Null when fewer than 35 days exist: nothing is invented. */
export function weeklyWindows(gains: readonly number[]): WeeklyWindows | null {
  if (gains.length < 35) return null;
  const end = gains.length;
  const sum = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i += 1) s += gains[i] as number;
    return s;
  };
  return { w0: sum(end - 7, end), w1: sum(end - 14, end - 7), w2: sum(end - 21, end - 14), w3: sum(end - 28, end - 21), w4: sum(end - 35, end - 28) };
}

/** The 28-day baseline: the average weekly growth over the four weeks that end a week before T (the same span the production acceleration ratio uses). */
export const baselineWeekly = (w: WeeklyWindows): number => (w.w1 + w.w2 + w.w3 + w.w4) / 4;

export type CoolingKind = 'production' | 'fromHigh' | 'twoDeclines' | 'lostTrending';

export interface LifecycleConfig {
  lifecycleVersion: string;
  rising: { persistence: 'none' | 'twoDays' | 'threeOfFive' };
  accelerating: { minRatio: number; minGrowth7d: number };
  breakout: { minRatio: number; minGrowth7d: number };
  cooling: { kind: CoolingKind; minBaselineWeekly: number; dropRatio: number; baselinePercentile: number; declineRatio: number; minPeakWeekly: number; lostTrendingLookbackDays: number };
  sustained: { minDomainPercentile: number; minWeeksAbove: number; windowWeeks: number; minWeeklyGrowth: number };
  newToRadar: { primary: 'firstPublished'; maxDaysSinceFirstPublished: number; genuinelyNewMaxAgeDays: number };
}

export class LifecycleConfigError extends Error {}

export function parseLifecycleConfig(raw: unknown): LifecycleConfig {
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRec(raw) || raw.schemaVersion !== 1) throw new LifecycleConfigError('lifecycle config: unsupported schemaVersion');
  const rec = (k: string): Record<string, unknown> => {
    const v = raw[k];
    if (!isRec(v)) throw new LifecycleConfigError(`lifecycle config: ${k} is required`);
    return v;
  };
  const num = (o: Record<string, unknown>, k: string, where: string): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new LifecycleConfigError(`lifecycle config: ${where}.${k} must be a non-negative number`);
    return v;
  };
  const rising = rec('rising');
  if (!['none', 'twoDays', 'threeOfFive'].includes(rising.persistence as string)) throw new LifecycleConfigError('lifecycle config: rising.persistence is invalid');
  const acc = rec('accelerating');
  const brk = rec('breakout');
  const cool = rec('cooling');
  if (!['production', 'fromHigh', 'twoDeclines', 'lostTrending'].includes(cool.kind as string)) throw new LifecycleConfigError('lifecycle config: cooling.kind is invalid');
  const sus = rec('sustained');
  const nr = rec('newToRadar');
  if (nr.primary !== 'firstPublished') throw new LifecycleConfigError('lifecycle config: newToRadar.primary must be firstPublished');
  return {
    lifecycleVersion: typeof raw.lifecycleVersion === 'string' ? raw.lifecycleVersion : 'unversioned',
    rising: { persistence: rising.persistence as LifecycleConfig['rising']['persistence'] },
    accelerating: { minRatio: num(acc, 'minRatio', 'accelerating'), minGrowth7d: num(acc, 'minGrowth7d', 'accelerating') },
    breakout: { minRatio: num(brk, 'minRatio', 'breakout'), minGrowth7d: num(brk, 'minGrowth7d', 'breakout') },
    cooling: {
      kind: cool.kind as CoolingKind,
      minBaselineWeekly: num(cool, 'minBaselineWeekly', 'cooling'),
      dropRatio: num(cool, 'dropRatio', 'cooling'),
      baselinePercentile: num(cool, 'baselinePercentile', 'cooling'),
      declineRatio: num(cool, 'declineRatio', 'cooling'),
      minPeakWeekly: num(cool, 'minPeakWeekly', 'cooling'),
      lostTrendingLookbackDays: num(cool, 'lostTrendingLookbackDays', 'cooling'),
    },
    sustained: { minDomainPercentile: num(sus, 'minDomainPercentile', 'sustained'), minWeeksAbove: num(sus, 'minWeeksAbove', 'sustained'), windowWeeks: num(sus, 'windowWeeks', 'sustained'), minWeeklyGrowth: num(sus, 'minWeeklyGrowth', 'sustained') },
    newToRadar: { primary: 'firstPublished', maxDaysSinceFirstPublished: num(nr, 'maxDaysSinceFirstPublished', 'newToRadar'), genuinelyNewMaxAgeDays: num(nr, 'genuinelyNewMaxAgeDays', 'newToRadar') },
  };
}

export function loadLifecycleConfig(path = 'config/lifecycle.engineering.json'): LifecycleConfig {
  try {
    return parseLifecycleConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    if (e instanceof LifecycleConfigError) throw e;
    throw new LifecycleConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ------------------------------------------------------------------------------------------------ Rising (durable Trending)

/**
 * RISING = Trending that has persisted. `history` holds the Trending flag for the previous days, most recent first (index 0 = yesterday).
 * A missing previous day (not evaluated) counts as not Trending: persistence is never assumed.
 */
export function isRising(trendingToday: boolean, history: readonly (boolean | undefined)[], persistence: LifecycleConfig['rising']['persistence']): boolean {
  if (!trendingToday) return false;
  if (persistence === 'none') return true;
  if (persistence === 'twoDays') return history[0] === true;
  const lastFour = history.slice(0, 4);
  return lastFour.filter((x) => x === true).length >= 2; // today plus at least two of the previous four days: three of the last five days
}

// ------------------------------------------------------------------------------------------------ Cooling

export interface CoolingInput {
  w: WeeklyWindows;
  /** Production trend label at T (the existing rule: acceleration below 0.6 with 30-day velocity at least 10 stars per day). */
  productionCooling: boolean;
  /** Percentile of this repository's 28-day baseline within the domain at T, in [0, 1]. */
  baselinePercentile: number;
  /** Trending flags for the days T-1 ... (most recent first), used by `lostTrending`. */
  trendingHistory: readonly (boolean | undefined)[];
  trendingToday: boolean;
}

/**
 * Cooling candidates, all measured on history before one was chosen (docs/PHASE-6.3.1-LIFECYCLE-SEMANTICS.md):
 *  production    the existing absolute rule (reference)
 *  fromHigh      baseline in the domain's top decile AND this week below `dropRatio` of the 28-day baseline: cooling from a high level
 *  twoDeclines   two consecutive weekly declines (each below `declineRatio` of the week before) after a peak of at least `minPeakWeekly`
 *  lostTrending  Trending within the lookback window, not Trending now, and this week below `dropRatio` of the stronger of the two earlier weeks
 */
export function isCooling(kind: CoolingKind, i: CoolingInput, c: LifecycleConfig['cooling']): boolean {
  const { w } = i;
  const base = baselineWeekly(w);
  switch (kind) {
    case 'production':
      return i.productionCooling;
    case 'fromHigh':
      return base >= c.minBaselineWeekly && i.baselinePercentile >= c.baselinePercentile && w.w0 < c.dropRatio * base;
    case 'twoDeclines':
      return w.w2 >= c.minPeakWeekly && w.w1 < c.declineRatio * w.w2 && w.w0 < c.declineRatio * w.w1;
    case 'lostTrending': {
      if (i.trendingToday) return false;
      const was = i.trendingHistory.slice(0, c.lostTrendingLookbackDays).some((x) => x === true);
      return was && w.w0 < c.dropRatio * Math.max(w.w1, w.w2);
    }
  }
}

// ------------------------------------------------------------------------------------------------ Sustained

/** SUSTAINED = 30-day growth in the domain's top percentile AND at least `minWeeksAbove` of the last `windowWeeks` weekly windows each at or above the weekly floor. */
export function isSustained(w: WeeklyWindows, domainPercentileG30: number, s: LifecycleConfig['sustained']): boolean {
  if (domainPercentileG30 < s.minDomainPercentile) return false;
  const weeks = [w.w0, w.w1, w.w2, w.w3, w.w4].slice(0, s.windowWeeks);
  return weeks.filter((x) => x >= s.minWeeklyGrowth).length >= s.minWeeksAbove;
}

// ------------------------------------------------------------------------------------------------ New to Radar

export interface NewToRadarFacts {
  /** UTC date the repository first appeared in the PUBLISHED Radar, or null when it never has. */
  firstPublishedAt: string | null;
  /** Repository creation date. */
  createdAt: string;
  /** Other lifecycle events, recorded as facts but not used for the primary definition. */
  firstDiscoveredAt?: string | null;
  firstAdmittedAt?: string | null;
  firstMeasuredAt?: string | null;
}

export interface NewToRadarResult {
  /** Primary: first published within the window. */
  newToRadar: boolean;
  daysSinceFirstPublished: number | null;
  /** Independent flag: the repository itself is new (created recently), whatever its Radar history. */
  genuinelyNew: boolean;
}

const DAY = 86_400_000;

/**
 * NEW TO RADAR (the one primary definition): first appearance in the published Radar within `maxDaysSinceFirstPublished` days. Discovery,
 * admission, classification and measurement dates are recorded but do not define it, because infrastructure changes (a Top-300 batch
 * admission, a taxonomy update) would otherwise make years-old repositories look new. `genuinelyNew` is separate and means created recently.
 */
export function newToRadar(f: NewToRadarFacts, today: string, c: LifecycleConfig['newToRadar']): NewToRadarResult {
  const t = Date.parse(`${today}T00:00:00Z`);
  const raw = f.firstPublishedAt === null ? null : Math.floor((t - Date.parse(`${f.firstPublishedAt}T00:00:00Z`)) / DAY);
  // A first publication AFTER `today` is the future: it is neither "new" nor reported (Phase 6.3.2 leakage review: a negative day count would expose it).
  const published = raw !== null && raw >= 0 ? raw : null;
  const age = (t - Date.parse(f.createdAt)) / DAY;
  return {
    newToRadar: published !== null && published <= c.maxDaysSinceFirstPublished,
    daysSinceFirstPublished: published,
    genuinelyNew: age >= 0 && age <= c.genuinelyNewMaxAgeDays,
  };
}

/**
 * First UTC date each repository appears in a series of published snapshots (append-only history). The earliest snapshot is a baseline: a
 * repository present in it may have been published earlier, so callers must not treat its date as a first publication.
 */
export function firstPublishedMap(snapshots: readonly { date: string; ids: Iterable<string> }[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const s of [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) for (const id of s.ids) if (!first.has(id)) first.set(id, s.date);
  return first;
}
