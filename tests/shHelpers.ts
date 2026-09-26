import type { StarHistorySeries, WeekBucket } from '../src/model/starHistory';

export const WEEK = 604_800;
/** A Sunday, 00:00 UTC (2026-01-04). */
export const BASE_WEEK = Date.parse('2026-01-04T00:00:00Z') / 1000;

/** Week n (0 = BASE_WEEK) as a validated bucket with the given per-day counts. */
export function bucket(n: number, days: number[] = [1, 1, 1, 1, 1, 1, 1]): WeekBucket {
  return { week: BASE_WEEK + n * WEEK, total: days.reduce((a, b) => a + b, 0), days };
}

/** API page body: newest first, exactly as GitHub returns it. */
export function pageBody(weeks: WeekBucket[]): WeekBucket[] {
  return [...weeks].sort((a, b) => b.week - a.week);
}

export function linkNext(nextPage: number, last = nextPage): string {
  return `<https://api.github.com/repositories/1/stargazers/history?page=${nextPage}>; rel="next", <https://api.github.com/repositories/1/stargazers/history?page=${last}>; rel="last"`;
}

export function seriesOf(weeks: WeekBucket[], complete: boolean, extra: Partial<StarHistorySeries> = {}): StarHistorySeries {
  return {
    repository: 'a/b',
    weeks,
    complete,
    pages: 1,
    requests: 1,
    bytes: 0,
    rolloverDuplicates: 0,
    restarted: false,
    fetchedAt: '2026-09-24T12:00:00.000Z',
    ...extra,
  };
}

/**
 * Consecutive Sunday-aligned weeks ending with the week that contains `asOfDate`,
 * filled with `perDay` stars per day (future days of the last week are 0).
 */
export function weeksEndingAt(asOfDate: string, weekCount: number, perDay: number): WeekBucket[] {
  const asOf = Date.parse(`${asOfDate}T00:00:00Z`);
  const dow = new Date(asOf).getUTCDay(); // 0 = Sunday
  const lastWeekStart = asOf / 1000 - dow * 86_400;
  const weeks: WeekBucket[] = [];
  for (let w = weekCount - 1; w >= 0; w -= 1) {
    const isLast = w === 0;
    const days = Array.from({ length: 7 }, (_, d) => (isLast && d > dow ? 0 : perDay));
    weeks.push({ week: lastWeekStart - w * WEEK, total: days.reduce((a, b) => a + b, 0), days });
  }
  return weeks;
}
