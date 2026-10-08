import { addDays } from '../analysis/starHistory';
import type { StarHistoryRecord } from '../collect/dataset';

/**
 * Per-record history quality (Phase 6.2). Pure and deterministic. Separate from momentum on purpose: a repository can be
 * RISING with LIMITED history, and that difference must stay visible instead of being folded into the score.
 *
 * States (thresholds are the production windows, not tuned values):
 *   INVALID       a value is negative, non-integer or non-finite, or the first date is unreadable.
 *   GAPPED        the series ends more than 1 day before the evaluation date (data stopped arriving).
 *   FULL          the series reaches the repository's creation (every day of its life is known).
 *   LONG          at least 180 days: covers the 90-day window AND 90 days of back-testing for that window.
 *   ADEQUATE      at least 90 days: covers every production window (7/30/90).
 *   LIMITED       at least 30 days: the 90-day window is missing.
 *   INSUFFICIENT  fewer than 30 days on a repository older than its series: the 30-day window is missing.
 * Gaps inside a series cannot be represented in storage (contiguous array from `firstDate`), so they are not a state;
 * duplicates likewise cannot exist (one value per index). Both facts are asserted by tests on the storage format.
 */
export const HISTORY_QUALITY_STATES = ['FULL', 'LONG', 'ADEQUATE', 'LIMITED', 'INSUFFICIENT', 'GAPPED', 'INVALID'] as const;
export type HistoryQualityState = (typeof HISTORY_QUALITY_STATES)[number];

export const QUALITY_THRESHOLDS = { long: 180, adequate: 90, limited: 30, maxTrailingGapDays: 1 } as const;

export interface RecordHistoryQuality {
  state: HistoryQualityState;
  /** Days stored (length of the daily series). */
  days: number;
  /** True when the series reaches the repository's creation date (or is flagged complete). */
  coversLife: boolean;
  /** Days between the last stored value and the evaluation date (0 = up to date). null when the series is empty. */
  trailingGapDays: number | null;
  reason: string;
}

const DAY_MS = 86_400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

export function recordHistoryQuality(h: Pick<StarHistoryRecord, 'firstDate' | 'dailyGains' | 'complete'>, createdAt: string, asOfDate: string): RecordHistoryQuality {
  const days = h.dailyGains.length;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.firstDate) || Number.isNaN(Date.parse(`${h.firstDate}T00:00:00Z`))) {
    return { state: 'INVALID', days, coversLife: false, trailingGapDays: null, reason: 'first date is unreadable' };
  }
  if (h.dailyGains.some((x) => typeof x !== 'number' || !Number.isFinite(x) || !Number.isInteger(x) || x < 0)) {
    return { state: 'INVALID', days, coversLife: false, trailingGapDays: null, reason: 'a daily value is negative, non-integer or non-finite' };
  }
  if (days === 0) return { state: 'INSUFFICIENT', days, coversLife: false, trailingGapDays: null, reason: 'no daily values stored' };
  const last = addDays(h.firstDate, days - 1);
  const trailing = Math.max(0, dayDiff(asOfDate, last));
  const created = createdAt.slice(0, 10);
  const coversLife = h.complete || h.firstDate <= created;
  if (trailing > QUALITY_THRESHOLDS.maxTrailingGapDays) {
    return { state: 'GAPPED', days, coversLife, trailingGapDays: trailing, reason: `last value is ${trailing} days before the evaluation date` };
  }
  if (coversLife) return { state: 'FULL', days, coversLife, trailingGapDays: trailing, reason: `all ${days} days since creation are stored` };
  if (days >= QUALITY_THRESHOLDS.long) return { state: 'LONG', days, coversLife, trailingGapDays: trailing, reason: `${days} days stored (>= ${QUALITY_THRESHOLDS.long})` };
  if (days >= QUALITY_THRESHOLDS.adequate) return { state: 'ADEQUATE', days, coversLife, trailingGapDays: trailing, reason: `${days} days stored (covers the 90-day window)` };
  if (days >= QUALITY_THRESHOLDS.limited) return { state: 'LIMITED', days, coversLife, trailingGapDays: trailing, reason: `${days} days stored; the 90-day window is not covered` };
  return { state: 'INSUFFICIENT', days, coversLife, trailingGapDays: trailing, reason: `${days} days stored; the 30-day window is not covered` };
}
