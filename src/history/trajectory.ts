/**
 * Historical trajectory metrics (Phase 6.2). Pure and deterministic.
 *
 * Input: daily star gains in date order, the LAST element being the evaluation day (the same convention as the
 * production windows: "the last 7 days" = the last 7 elements, today included). Only what is in the array is used, so a
 * caller that passes a series truncated at date T gets metrics as of T with no access to later days.
 *
 * Every metric is null (never 0) when the series is too short to define it. Units are stars or stars/day.
 * Weeks are consecutive 7-day blocks counted back from the evaluation day: week 0 = last 7 days, week 1 = days 8-14, ...
 */
export interface TrajectoryMetrics {
  /** Number of daily values available. */
  days: number;
  /** Mean stars/day over the last 7 / 30 / 90 days (same windows as the production engine). */
  velocity7d: number | null;
  velocity30d: number | null;
  velocity90d: number | null;
  /** Mean stars/day over days 8-14 and days 31-60 (the period just before each window). */
  prevVelocity7d: number | null;
  prevVelocity30d: number | null;
  /** Up to 13 weekly sums, week 0 first. Only complete 7-day blocks are included. */
  weeks: number[];
  /** Largest single-day gain in the last 90 days (or all available days). */
  peakDay: number | null;
  /** Largest weekly sum among the available weeks. */
  peakWeek: number | null;
  /** Median of weeks 1..12 (the up to 12 weeks before the current one); null with fewer than 4 prior weeks. */
  medianPriorWeek: number | null;
  /** week 0 / medianPriorWeek; null when the median is null or 0. */
  currentToMedianRatio: number | null;
  /** Days with a gain > 0, and days with exactly 0, in the last 90 days (or all available days). */
  positiveDays: number;
  zeroDays: number;
  /** Longest run of consecutive days with a gain > 0 within the last 90 days. */
  longestPositiveStreak: number;
  /** Consecutive weeks, counting back from week 0, with a weekly sum > 0. `capped` when the run reaches the oldest week. */
  consecutivePositiveWeeks: { weeks: number; capped: boolean };
  /** Consecutive weeks before week 0 whose sum was at most week0 / quietRatio ("quiet before the current week"). */
  quietWeeksBefore: { weeks: number; capped: boolean } | null;
  /**
   * Days (counting back from today, today = 1) for which the 7-day velocity has been at least `accelRatio` times the
   * 28 days before it (prior average >= minPriorVelocity). null when it does not hold today.
   */
  accelerationDays: { days: number; capped: boolean } | null;
  /** Coefficient of variation (std / mean) of weeks 0..11; null with fewer than 4 weeks or a zero mean. */
  weeklyCv: number | null;
}

export interface TrajectoryOptions {
  /** Ratio used for "quiet" weeks (default 3, the engine's acceleration cap and the BREAKOUT ratio). */
  quietRatio?: number;
  /** Ratio used for "accelerating" days (default 1.2, the engine's and the pattern model's accelerating cut). */
  accelRatio?: number;
  /** Minimum prior velocity for an acceleration ratio (default 1 star/day, the engine's minPriorVelocity). */
  minPriorVelocity?: number;
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Sum of `len` days that end `offset` days before the last element (offset 0 = ending on the last element). */
function sumBack(g: readonly number[], offset: number, len: number): number | null {
  const end = g.length - offset;
  const start = end - len;
  if (start < 0 || end > g.length) return null;
  let s = 0;
  for (let i = start; i < end; i += 1) s += g[i] as number;
  return s;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function trajectoryMetrics(gains: readonly number[], opts: TrajectoryOptions = {}): TrajectoryMetrics {
  const quietRatio = opts.quietRatio ?? 3;
  const accelRatio = opts.accelRatio ?? 1.2;
  const minPrior = opts.minPriorVelocity ?? 1;
  const n = gains.length;
  const v = (offset: number, len: number) => {
    const s = sumBack(gains, offset, len);
    return s === null ? null : round(s / len);
  };

  const weeks: number[] = [];
  for (let k = 0; k < 13; k += 1) {
    const s = sumBack(gains, 7 * k, 7);
    if (s === null) break;
    weeks.push(s);
  }

  const last90 = gains.slice(-90);
  let longest = 0;
  let run = 0;
  for (const x of last90) {
    run = x > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  let posWeeks = 0;
  while (posWeeks < weeks.length && (weeks[posWeeks] as number) > 0) posWeeks += 1;

  let quietWeeksBefore: TrajectoryMetrics['quietWeeksBefore'] = null;
  const w0 = weeks[0];
  if (w0 !== undefined && w0 > 0 && weeks.length > 1) {
    let q = 0;
    while (1 + q < weeks.length && (weeks[1 + q] as number) * quietRatio <= w0) q += 1;
    quietWeeksBefore = { weeks: q, capped: 1 + q === weeks.length };
  }

  let accelerationDays: TrajectoryMetrics['accelerationDays'] = null;
  let d = 0;
  for (; ; d += 1) {
    const recent = sumBack(gains, d, 7);
    const prior = sumBack(gains, d + 7, 28);
    if (recent === null || prior === null) break;
    const pv = prior / 28;
    if (pv < minPrior || recent / 7 < accelRatio * pv) break;
  }
  if (d > 0) accelerationDays = { days: d, capped: sumBack(gains, d + 7, 28) === null };

  const cvWeeks = weeks.slice(0, 12);
  let weeklyCv: number | null = null;
  if (cvWeeks.length >= 4) {
    const mean = cvWeeks.reduce((a, b) => a + b, 0) / cvWeeks.length;
    if (mean > 0) {
      const variance = cvWeeks.reduce((a, b) => a + (b - mean) ** 2, 0) / cvWeeks.length;
      weeklyCv = round(Math.sqrt(variance) / mean, 3);
    }
  }

  const prior = weeks.slice(1, 13);
  const medianPriorWeek = prior.length >= 4 ? median(prior) : null;

  return {
    days: n,
    velocity7d: v(0, 7),
    velocity30d: v(0, 30),
    velocity90d: v(0, 90),
    prevVelocity7d: v(7, 7),
    prevVelocity30d: v(30, 30),
    weeks,
    peakDay: last90.length ? Math.max(...last90) : null,
    peakWeek: weeks.length ? Math.max(...weeks) : null,
    medianPriorWeek,
    currentToMedianRatio: medianPriorWeek && w0 !== undefined ? round(w0 / medianPriorWeek, 2) : null,
    positiveDays: last90.filter((x) => x > 0).length,
    zeroDays: last90.filter((x) => x === 0).length,
    longestPositiveStreak: longest,
    consecutivePositiveWeeks: { weeks: posWeeks, capped: posWeeks === weeks.length && weeks.length > 0 },
    quietWeeksBefore,
    accelerationDays,
    weeklyCv,
  };
}
