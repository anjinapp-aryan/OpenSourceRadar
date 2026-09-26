import type {
  TrackingDecision,
  TrackingInput,
  TrackingMetrics,
  TrackingPolicy,
  TrackingSignals,
  TrackingState,
  TrackingStatus,
  TrackingTier,
} from './types';

const DAY_MS = 86_400_000;
/** UNASSESSED ranks below every measured tier: any measurement is a promotion out of it. */
const RANK: Record<TrackingStatus, number> = { UNASSESSED: -1, DORMANT: 0, WARM: 1, HOT: 2 };
const BY_RANK: TrackingTier[] = ['DORMANT', 'WARM', 'HOT'];
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function hoursFor(policy: TrackingPolicy, tier: TrackingStatus): number {
  if (tier === 'UNASSESSED') return policy.unassessed.refreshHours;
  return policy.tiers[tier.toLowerCase() as 'hot' | 'warm' | 'dormant'].refreshHours;
}

function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - Date.parse(fromIso)) / DAY_MS;
}

export function computeSignals(m: TrackingMetrics, policy: TrackingPolicy, now: Date): TrackingSignals {
  const ageDays = Math.max(0, daysBetween(m.createdAt, now));
  return {
    stars: m.stars,
    ageDays: round4(ageDays),
    pushedDaysAgo: m.pushedAt ? round4(Math.max(0, daysBetween(m.pushedAt, now))) : null,
    starsPerDay7d: m.starsPerDay7d,
    starsPerDay30d: m.starsPerDay30d,
    growth7d: m.growth7d,
    growthPercent7d: m.growthPercent7d,
    newEntrant: ageDays <= policy.rules.hot.newEntrantMaxAgeDays,
    rulesFired: [],
  };
}

/** Rules that pass for a tier at a threshold scale (1 = configured thresholds; <1 = relaxed, used for hysteresis). */
function passing(tier: 'HOT' | 'WARM', s: TrackingSignals, policy: TrackingPolicy, scale: number): string[] {
  const fired: string[] = [];
  const ge = (v: number | null, t: number) => v !== null && v >= t * scale;
  if (tier === 'HOT') {
    const r = policy.rules.hot;
    if (ge(s.starsPerDay7d, r.minStarsPerDay7d)) fired.push(`hot:starsPerDay7d>=${round4(r.minStarsPerDay7d * scale)}`);
    if (ge(s.growthPercent7d, r.minGrowthPercent7d) && ge(s.growth7d, r.minGrowth7dForPercent)) {
      fired.push(`hot:growthPercent7d>=${round4(r.minGrowthPercent7d * scale)}&growth7d>=${round4(r.minGrowth7dForPercent * scale)}`);
    }
    if (s.ageDays <= r.newEntrantMaxAgeDays && ge(s.starsPerDay7d, r.newEntrantMinStarsPerDay7d)) {
      fired.push(`hot:newEntrant(age<=${r.newEntrantMaxAgeDays}d)&starsPerDay7d>=${round4(r.newEntrantMinStarsPerDay7d * scale)}`);
    }
  } else {
    const r = policy.rules.warm;
    if (ge(s.starsPerDay7d, r.minStarsPerDay7d)) fired.push(`warm:starsPerDay7d>=${round4(r.minStarsPerDay7d * scale)}`);
    if (ge(s.starsPerDay30d, r.minStarsPerDay30d)) fired.push(`warm:starsPerDay30d>=${round4(r.minStarsPerDay30d * scale)}`);
    if (s.pushedDaysAgo !== null && s.pushedDaysAgo <= r.activityMaxDays / scale && s.stars >= r.activityMinStars * scale) {
      fired.push(`warm:pushedWithin${round4(r.activityMaxDays / scale)}d&stars>=${round4(r.activityMinStars * scale)}`);
    }
  }
  return fired;
}

/** Whether the repository is tracked at all. Classification is only an eligibility gate, never a tier input. */
export function isEligible(input: TrackingInput, policy: TrackingPolicy): { eligible: boolean; reason: string } {
  if (!policy.eligibility.topLevel.includes(input.topLevelCategory)) return { eligible: false, reason: `not tracked: classification ${input.topLevelCategory}` };
  if (policy.eligibility.excludeArchived && input.metrics.isArchived) return { eligible: false, reason: 'not tracked: archived' };
  return { eligible: true, reason: 'eligible' };
}

/**
 * Deterministic tracking decision.
 *
 * 1. No growth measurement at all -> UNASSESSED (not a tier): due immediately, never HOT/WARM/DORMANT.
 * 2. Otherwise compute the tier the CURRENT metrics justify (HOT > WARM > DORMANT).
 * 3. Promotions apply immediately (including UNASSESSED -> any tier: the first assessment).
 * 4. Demotions are damped: one level at a time, only after `minDaysInTier`, and only when the metrics no longer
 *    pass the current tier's rules even with thresholds relaxed by `demoteFactor`.
 *
 * Nothing here looks at discovery queries, category names or classification scores.
 */
export function decideTracking(input: TrackingInput, policy: TrackingPolicy, now: Date, previous?: TrackingState): TrackingDecision {
  const signals = computeSignals(input.metrics, policy, now);
  const assessed = signals.starsPerDay7d !== null || signals.starsPerDay30d !== null;
  const nowIso = now.toISOString();

  if (!assessed) {
    // A tier earned from data is kept when a later evaluation simply has no data; otherwise UNASSESSED.
    if (previous && previous.tier !== 'UNASSESSED') {
      signals.rulesFired = ['hold:no-growth-data'];
      return {
        tier: previous.tier,
        refreshIntervalHours: hoursFor(policy, previous.tier),
        reason: `${previous.tier} kept: no growth data in this evaluation`,
        signals,
        assessed: false,
        transition: null,
        tierSince: previous.tierSince,
        nextRefreshAt: nowIso,
      };
    }
    signals.rulesFired = ['unassessed:no-star-history'];
    return {
      tier: 'UNASSESSED',
      refreshIntervalHours: policy.unassessed.refreshHours,
      reason: 'UNASSESSED: star history not measured yet; first assessment pending (says nothing about activity)',
      signals,
      assessed: false,
      transition: null,
      tierSince: previous?.tierSince ?? nowIso,
      nextRefreshAt: nowIso,
    };
  }

  const hot = passing('HOT', signals, policy, 1);
  const warm = passing('WARM', signals, policy, 1);
  let target: TrackingTier;
  if (hot.length > 0) {
    target = 'HOT';
    signals.rulesFired = hot;
  } else if (warm.length > 0) {
    target = 'WARM';
    signals.rulesFired = warm;
  } else if (signals.ageDays < policy.rules.dormant.minAgeDays) {
    // measured, but too young for "low growth over a long period" to mean anything
    target = 'WARM';
    signals.rulesFired = [`warm:too-young-to-be-dormant(age<${policy.rules.dormant.minAgeDays}d)`];
  } else {
    target = 'DORMANT';
    signals.rulesFired = ['dormant:no hot or warm rule passed'];
  }
  let hours = hoursFor(policy, target);
  let reason = `${target} because ${signals.rulesFired.join(', ')}`;

  let tier: TrackingTier = target;
  let tierSince = nowIso;
  let transition: TrackingDecision['transition'] = null;

  if (previous) {
    tierSince = previous.tierSince;
    if (previous.tier === 'UNASSESSED') {
      tierSince = nowIso;
      transition = { from: 'UNASSESSED', to: target };
      reason = `first assessment: ${reason}`;
    } else if (RANK[target] > RANK[previous.tier]) {
      tierSince = nowIso;
      transition = { from: previous.tier, to: target };
      reason = `promoted ${previous.tier} -> ${target}: ${reason}`;
    } else if (RANK[target] < RANK[previous.tier]) {
      const prev = previous.tier;
      const daysIn = daysBetween(previous.tierSince, now);
      const minDays = policy.hysteresis.minDaysInTier[prev.toLowerCase() as 'hot' | 'warm' | 'dormant'];
      const relaxed = prev === 'DORMANT' ? [] : passing(prev as 'HOT' | 'WARM', signals, policy, policy.hysteresis.demoteFactor);
      if (daysIn < minDays) {
        tier = prev;
        signals.rulesFired = [`hold:minDaysInTier(${prev}=${minDays}d, in tier ${daysIn.toFixed(1)}d)`];
        reason = `${prev} kept: only ${daysIn.toFixed(1)} of ${minDays} minimum days in tier (metrics justify ${target})`;
      } else if (relaxed.length > 0) {
        tier = prev;
        signals.rulesFired = relaxed.map((r) => `hold:${r}`);
        reason = `${prev} kept: metrics within ${policy.hysteresis.demoteFactor * 100}% of its thresholds (${relaxed[0]})`;
      } else {
        tier = BY_RANK[RANK[prev] - 1] as TrackingTier; // one level at a time
        tierSince = nowIso;
        transition = { from: prev, to: tier };
        reason = `demoted ${prev} -> ${tier}: ${reason}`;
      }
      hours = tier === target ? hours : hoursFor(policy, tier);
    }
  }

  const refreshBase = input.lastRefreshedAt ? new Date(input.lastRefreshedAt) : now;
  const nextRefreshAt = new Date(refreshBase.getTime() + hours * 3_600_000).toISOString();
  return { tier, refreshIntervalHours: hours, reason, signals, assessed: true, transition, tierSince, nextRefreshAt };
}

/** Repositories whose next refresh is due, in `order` (default HOT, UNASSESSED, WARM, DORMANT), then oldest due first. */
export function selectDue<T extends { tier: TrackingStatus; nextRefreshAt: string }>(
  records: readonly T[],
  now: Date,
  order: readonly TrackingStatus[] = ['HOT', 'UNASSESSED', 'WARM', 'DORMANT'],
  tiebreak: (a: T, b: T) => number = () => 0,
): T[] {
  const pos = (t: TrackingStatus) => order.indexOf(t);
  return records
    .filter((r) => Date.parse(r.nextRefreshAt) <= now.getTime())
    .sort((a, b) => pos(a.tier) - pos(b.tier) || Date.parse(a.nextRefreshAt) - Date.parse(b.nextRefreshAt) || tiebreak(a, b));
}

/**
 * Expected history requests per day for a status distribution: sum of count / (refreshHours / 24).
 * UNASSESSED repositories are counted at their retry interval; they leave that state after one successful fetch,
 * so report them separately as a one-time cost.
 */
export function estimateDailyRefreshes(counts: Partial<Record<TrackingStatus, number>>, policy: TrackingPolicy): number {
  return (['HOT', 'WARM', 'DORMANT', 'UNASSESSED'] as TrackingStatus[]).reduce((sum, t) => sum + (counts[t] ?? 0) / (hoursFor(policy, t) / 24), 0);
}
