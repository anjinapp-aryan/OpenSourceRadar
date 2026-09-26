import { utcDate } from '../analysis/starHistory';
import { starDriftTolerance } from '../analysis/tolerance';
import type { StarHistorySeries } from '../model/starHistory';

export type Severity = 'error' | 'warning' | 'info';

export interface QualityIssue {
  code: string;
  severity: Severity;
  message: string;
}

/**
 * Data-quality checks on a validated series. The provider already rejects
 * negative/non-integer values, invalid types, unordered buckets within a page and
 * non-contiguous weeks; these checks cover the remaining assumptions and mark
 * anything we cannot know as `info` rather than inventing behaviour.
 *
 * UNKNOWN (documented, not checkable here): whether GitHub can ever report a
 * net-negative day (un-stars). We reject negatives at parse time.
 */
export function checkStarHistory(series: StarHistorySeries, starsNow: number | null, asOf: Date): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (code: string, severity: Severity, message: string) => issues.push({ code, severity, message });

  const asOfDate = utcDate(asOf);
  const total = series.weeks.reduce((s, w) => s + w.total, 0);

  for (let i = 0; i < series.weeks.length; i += 1) {
    const w = series.weeks[i]!;
    const t = new Date(w.week * 1000);
    if (Number.isNaN(t.getTime())) add('INVALID_DATE', 'error', `week ${w.week} is not a valid timestamp`);
    if (i > 0 && w.week <= series.weeks[i - 1]!.week) add('UNORDERED', 'error', `weeks not strictly ascending at index ${i}`);
    if (w.week % 86_400 !== 0) add('WEEK_NOT_UTC_MIDNIGHT', 'info', `week ${w.week} is not at UTC midnight; UTC day labels may be off by one (alignment UNKNOWN)`);
    if (utcDate(t) > asOfDate) add('FUTURE_WEEK', 'warning', `week starting ${utcDate(t)} is after ${asOfDate}`);
  }
  if (series.weeks.length === 0) add('EMPTY_SERIES', 'info', 'no weekly buckets returned');
  if (series.rolloverDuplicates > 0) add('ROLLOVER_DUPLICATES', 'info', `${series.rolloverDuplicates} duplicate week(s) from a week rollover were resolved`);
  if (series.restarted) add('WALK_RESTARTED', 'warning', 'the page walk was restarted once because weeks were non-contiguous');

  if (starsNow !== null) {
    const tolerance = starDriftTolerance(starsNow);
    if (series.complete && total !== starsNow) {
      add('TOTAL_MISMATCH', Math.abs(total - starsNow) <= tolerance ? 'info' : 'warning', `sum of all buckets ${total} != star count ${starsNow} (delta ${total - starsNow})`);
    }
    if (total > starsNow && total - starsNow <= tolerance) {
      add('STAR_COUNT_DRIFT', 'info', `fetched buckets sum to ${total}, ${total - starsNow} above the star count ${starsNow} (within drift tolerance ${tolerance})`);
    } else if (total > starsNow) {
      add('HISTORY_EXCEEDS_STARS', series.complete ? 'warning' : 'error', `fetched buckets sum to ${total}, more than the star count ${starsNow}`);
    }
  } else if (!series.complete) {
    add('NO_ANCHOR', 'info', 'partial history and no star count: cumulative points cannot be built');
  }
  return issues;
}

export function hasErrors(issues: readonly QualityIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
