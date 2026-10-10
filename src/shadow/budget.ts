/**
 * Phase 6.3.2: the shared daily history-request budget. Pure. Production and the shadow draw on the same hard ceiling, which is never raised.
 *
 * The shadow runs after the production collection, but a late, failed or still-running production run leaves no record for today. In that case
 * the shadow must not assume production is light: it reserves the highest production day ever observed. When production has recorded today's
 * collection, the larger of the recorded count and the average baseline is reserved. The remainder is the shadow's budget (possibly 0).
 */
export interface BudgetInputs {
  /** The hard ceiling (history requests per day). */
  ceiling: number;
  /** Average production load per day. */
  baseline: number;
  /** Highest production day observed (2026-10-09: 1,795). */
  observedPeak: number;
  /** Repositories production recorded as collected today (one history request each); 0 when production has not recorded today. */
  productionRecordedToday: number;
  /** The shadow's own non-history requests today (discovery search pages and the rate-limit check): they count toward the same ceiling. */
  shadowOtherRequests?: number;
}

export interface ShadowBudget {
  budget: number;
  reserved: number;
  /** recorded: production has today's record; worst-case: it has not, so the observed peak is reserved. */
  basis: 'recorded' | 'worst-case';
}

export function shadowHistoryBudget(i: BudgetInputs): ShadowBudget {
  const recorded = Number.isFinite(i.productionRecordedToday) && i.productionRecordedToday > 0;
  const reserved = recorded ? Math.max(i.productionRecordedToday, i.baseline) : Math.max(i.observedPeak, i.baseline);
  return { budget: Math.max(0, Math.floor(i.ceiling - reserved - Math.max(0, i.shadowOtherRequests ?? 0))), reserved, basis: recorded ? 'recorded' : 'worst-case' };
}

/** The highest production day observed so far (Phase 6.2.1 evidence, 2026-10-09). Update only from measured production runs. */
export const OBSERVED_PRODUCTION_PEAK = 1795;
