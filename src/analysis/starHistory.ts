import { InvalidResponseError } from '../github/errors';
import { starDriftTolerance } from './tolerance';
import { STAR_HISTORY_SOURCE, type DailyGain, type StarHistoryPoint, type StarHistorySeries, type WeekBucket } from '../model/starHistory';

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in UTC. */
export function utcDate(d: Date | number): string {
  return new Date(d instanceof Date ? d.getTime() : d).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return utcDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

/**
 * Expand weekly buckets to one entry per day. The bucket `week` timestamp is
 * floored to its UTC date; `days[i]` belongs to that date + i. Day/week alignment
 * with UTC is UNKNOWN (GitHub: "not guaranteed"), so every date is a UTC label.
 */
export function weeksToDailyGains(weeks: readonly WeekBucket[]): DailyGain[] {
  const out: DailyGain[] = [];
  for (const bucket of weeks) {
    const start = utcDate(bucket.week * 1000);
    bucket.days.forEach((count, i) => out.push({ date: addDays(start, i), count }));
  }
  return out;
}

/**
 * Cumulative star points ending at `asOf` (inclusive). The anchor (`starsNow`)
 * must be known: pass the current star count, or omit it when the series is
 * complete (then the anchor is the sum of all buckets). Otherwise returns null:
 * we never guess a cumulative count from a partial series.
 */
export function buildStarHistoryPoints(series: StarHistorySeries, asOf: Date, starsNow?: number): StarHistoryPoint[] | null {
  const anchor = starsNow ?? (series.complete ? series.weeks.reduce((s, w) => s + w.total, 0) : null);
  if (anchor === null) return null;
  const asOfDate = utcDate(asOf);
  const gains = weeksToDailyGains(series.weeks).filter((g) => g.date <= asOfDate);
  const points: StarHistoryPoint[] = new Array(gains.length);
  let stars = anchor;
  for (let i = gains.length - 1; i >= 0; i -= 1) {
    const g = gains[i] as DailyGain;
    points[i] = { date: g.date, stars, dailyCount: g.count, weekStart: weekStartOf(series.weeks, g.date), source: STAR_HISTORY_SOURCE };
    stars -= g.count;
  }
  if (stars < 0 && -stars <= starDriftTolerance(anchor)) {
    // metadata/history timing drift: earliest cumulative counts cannot be below zero
    for (const pt of points) if (pt.stars < 0) pt.stars = 0;
  } else if (stars < 0) {
    throw new InvalidResponseError(
      `star history ${series.repository} is inconsistent with the star count ${anchor}: history sums to more (${anchor - stars})`,
    );
  }
  return points;
}

function weekStartOf(weeks: readonly WeekBucket[], date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  let found = weeks[0] as WeekBucket;
  for (const w of weeks) {
    if (w.week * 1000 <= t) found = w;
    else break;
  }
  return utcDate(found.week * 1000);
}
