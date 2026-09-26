import type { TopLevelCategory } from '../classification/types';

/** A tier earned from measured growth. */
export type TrackingTier = 'HOT' | 'WARM' | 'DORMANT';

/**
 * UNASSESSED = no star history has been measured yet. It is NOT a tier: it says nothing about activity,
 * so it must never be read as DORMANT (measured, little growth) or as HOT/WARM.
 */
export type TrackingStatus = TrackingTier | 'UNASSESSED';

export interface TrackingPolicy {
  trackingVersion: string;
  eligibility: { topLevel: TopLevelCategory[]; excludeArchived: boolean };
  tiers: Record<'hot' | 'warm' | 'dormant', { refreshHours: number }>;
  rules: {
    hot: {
      minStarsPerDay7d: number;
      minGrowthPercent7d: number;
      minGrowth7dForPercent: number;
      newEntrantMaxAgeDays: number;
      newEntrantMinStarsPerDay7d: number;
    };
    warm: { minStarsPerDay7d: number; minStarsPerDay30d: number; activityMaxDays: number; activityMinStars: number };
    /** A repository younger than this cannot be DORMANT: "long periods of stability" cannot be measured yet. */
    dormant: { minAgeDays: number };
  };
  /** UNASSESSED repositories are due immediately; `refreshHours` is how soon a failed first assessment is retried. */
  unassessed: { refreshHours: number };
  /** Order in which due repositories are collected when a budget cuts the run short. */
  dueOrder: TrackingStatus[];
  hysteresis: { demoteFactor: number; minDaysInTier: Record<'hot' | 'warm' | 'dormant', number> };
}

/** Measurable facts about a repository at evaluation time. All growth numbers may be null (no history yet). */
export interface TrackingMetrics {
  stars: number;
  createdAt: string;
  pushedAt: string | null;
  isArchived: boolean;
  starsPerDay7d: number | null;
  starsPerDay30d: number | null;
  growth7d: number | null;
  growthPercent7d: number | null;
}

export interface TrackingInput {
  id: string;
  topLevelCategory: TopLevelCategory;
  metrics: TrackingMetrics;
  /** When the metrics were last refreshed (history/metadata fetch). null: never. */
  lastRefreshedAt: string | null;
}

/** Persisted between runs so tier changes are explainable and demotion is damped. */
export interface TrackingState {
  tier: TrackingStatus;
  tierSince: string;
}

export interface TrackingSignals {
  stars: number;
  ageDays: number;
  pushedDaysAgo: number | null;
  starsPerDay7d: number | null;
  starsPerDay30d: number | null;
  growth7d: number | null;
  growthPercent7d: number | null;
  newEntrant: boolean;
  /** Rule ids that fired for the chosen tier, e.g. "hot:starsPerDay7d>=80". */
  rulesFired: string[];
}

export interface TrackingDecision {
  tier: TrackingStatus;
  refreshIntervalHours: number;
  reason: string;
  signals: TrackingSignals;
  /** False when no growth data exists yet: the tier is a placeholder until the first history fetch. */
  assessed: boolean;
  transition: { from: TrackingStatus; to: TrackingStatus } | null;
  tierSince: string;
  nextRefreshAt: string;
}
