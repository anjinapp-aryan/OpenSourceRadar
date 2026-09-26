/**
 * One weekly bucket from GET /repos/{owner}/{repo}/stargazers/history,
 * validated. `week` is the Unix timestamp GitHub reports for the bucket start;
 * `days[0]` is the first day of the bucket (Sunday), per GitHub's docs.
 */
export interface WeekBucket {
  week: number;
  total: number;
  days: number[];
}

/** Stars gained on one calendar day (YYYY-MM-DD, interpreted as UTC - see docs/STAR-HISTORY.md). */
export interface DailyGain {
  date: string;
  count: number;
}

/** What the provider returns: validated, de-duplicated, ascending, contiguous. */
export interface StarHistorySeries {
  /** owner/name as requested. */
  repository: string;
  /** Ascending by week, contiguous (checked), duplicates from week rollover removed. */
  weeks: WeekBucket[];
  /** True when the walk reached the last page (i.e. covers the repository's whole life). */
  complete: boolean;
  pages: number;
  requests: number;
  bytes: number;
  /** Buckets seen twice across pages because the current week rolled over mid-walk. */
  rolloverDuplicates: number;
  /** Set when the full walk was restarted once because of a rollover-induced inconsistency. */
  restarted: boolean;
  /** ISO time the last page was received. */
  fetchedAt: string;
}

/**
 * Normalized point. `stars` is the cumulative count at the END of `date`,
 * derived from a known star total (never guessed). `dailyCount`, `weekStart`
 * are preserved from the bucket.
 */
export interface StarHistoryPoint {
  date: string;
  stars: number;
  dailyCount: number;
  weekStart: string;
  source: 'github-star-history';
}

export const STAR_HISTORY_SOURCE = 'github-star-history' as const;
