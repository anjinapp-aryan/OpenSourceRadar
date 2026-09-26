import { addDays, utcDate, weeksToDailyGains } from './starHistory';
import { starDriftTolerance } from './tolerance';
import type { DailyGain, StarHistorySeries } from '../model/starHistory';

export const WINDOW_DAYS = [7, 30, 90] as const;
export type WindowKey = '7d' | '30d' | '90d';

/**
 * ok                   all numbers are defined.
 * zero-base            the repository had 0 stars at the window start: growth and velocity
 *                      are defined, percentage growth is undefined (null).
 * insufficient-history the fetched history does not cover the whole window: everything null.
 * inconsistent         history disagrees with the star count (implied past stars < 0): everything null.
 */
export type WindowStatus = 'ok' | 'zero-base' | 'insufficient-history' | 'inconsistent';

export interface WindowMetrics {
  days: number;
  status: WindowStatus;
  /** Stars at the end of the day before the window started. */
  starsAgo: number | null;
  /** Stars gained in the trailing `days` UTC days ending at `asOf` (today included, so partial). */
  growth: number | null;
  /** growth / starsAgo * 100, rounded to 4 dp. null when starsAgo is 0 or unknown. */
  growthPercent: number | null;
  /** growth / days, rounded to 4 dp. Divides by the full window even for younger repositories. */
  starsPerDay: number | null;
}

export type StarWindows = Record<WindowKey, WindowMetrics>;

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

const NULL_METRICS = (days: number, status: WindowStatus): WindowMetrics => ({
  days,
  status,
  starsAgo: null,
  growth: null,
  growthPercent: null,
  starsPerDay: null,
});

/**
 * Trailing-window growth from a star-history series.
 *
 * Window N covers the N UTC dates (asOf-N+1 .. asOf). starsAgo = starsNow - growth.
 * A missing period is never treated as zero: if the series does not cover the
 * window, the metrics are null with status `insufficient-history`. The exception
 * is a COMPLETE series (walked to the repository's first bucket): dates before
 * the first bucket are known to be zero because the repository did not exist.
 */
export function computeStarWindows(series: StarHistorySeries, starsNow: number, asOf: Date): StarWindows {
  return computeWindowsFromGains(weeksToDailyGains(series.weeks), series.complete, starsNow, asOf);
}

/** Same as computeStarWindows but from already-expanded daily gains (ascending, contiguous). */
export function computeWindowsFromGains(gains: readonly DailyGain[], complete: boolean, starsNow: number, asOf: Date): StarWindows {
  const asOfDate = utcDate(asOf);
  const byDate = new Map(gains.map((g) => [g.date, g.count]));
  const first = gains[0]?.date ?? null;
  const last = gains[gains.length - 1]?.date ?? null;
  const coversNewest = last !== null && last >= asOfDate;

  const result = {} as StarWindows;
  for (const n of WINDOW_DAYS) {
    const key = `${n}d` as WindowKey;
    const windowStart = addDays(asOfDate, -(n - 1));
    const coveredStart = first !== null && (complete || first <= windowStart);
    if (!coveredStart || !coversNewest) {
      result[key] = NULL_METRICS(n, 'insufficient-history');
      continue;
    }
    let growth = 0;
    let missing = false;
    for (let i = 0; i < n; i += 1) {
      const date = addDays(windowStart, i);
      const count = byDate.get(date);
      if (count === undefined) {
        // only legitimate before the first bucket of a complete series
        if (complete && first !== null && date < first) continue;
        missing = true;
        break;
      }
      growth += count;
    }
    if (missing) {
      result[key] = NULL_METRICS(n, 'insufficient-history');
      continue;
    }
    let starsAgo = starsNow - growth;
    // History slightly above the star count is metadata/history timing drift, not corruption: clamp to a zero base.
    if (starsAgo < 0 && -starsAgo <= starDriftTolerance(starsNow)) starsAgo = 0;
    if (starsAgo < 0) {
      result[key] = NULL_METRICS(n, 'inconsistent');
      continue;
    }
    result[key] = {
      days: n,
      status: starsAgo === 0 ? 'zero-base' : 'ok',
      starsAgo,
      growth,
      growthPercent: starsAgo === 0 ? null : round4((growth / starsAgo) * 100),
      starsPerDay: round4(growth / n),
    };
  }
  return result;
}

/** The flat names used in the Phase 2 spec (starsNow, stars7dAgo, growth7d, growthPercent7d, starsPerDay7d ...). */
export function flattenWindows(starsNow: number, windows: StarWindows): Record<string, number | null> {
  const flat: Record<string, number | null> = { starsNow };
  for (const n of WINDOW_DAYS) {
    const w = windows[`${n}d` as WindowKey];
    flat[`stars${n}dAgo`] = w.starsAgo;
    flat[`growth${n}d`] = w.growth;
    flat[`growthPercent${n}d`] = w.growthPercent;
    flat[`starsPerDay${n}d`] = w.starsPerDay;
  }
  return flat;
}
