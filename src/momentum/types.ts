export interface MomentumConfig {
  momentumVersion: string;
  windows: { short: number; medium: number; long: number };
  acceleration: { priorWindowDays: number; priorGapDays: number; minPriorVelocity: number; cap: number };
  newEntrant: { maxAgeDays: number; minGrowth: number };
  sustained: { minVelocity: number; minComparableWindows: number };
  activity: { recentPushDays: number; staleRepositoryDays: number; staleRepositoryMultiplier: number };
  freshness: { maxStaleDays: number };
  score: {
    weights: { velocity: number; relativeGrowth: number; acceleration: number; persistence: number };
    velocityBlend: { short: number; medium: number; long: number };
    velocityHalfPoint: number;
    relativeGrowth: { halfPoint: number; cap: number; minAbsoluteGrowth30d: number };
  };
  trends: {
    rising: { minScore: number; minVelocity7d: number; minGrowth7d: number; minVelocity30d: number; minAccelerationRatio: number };
    cooling: { maxAccelerationRatio: number; minVelocity30d: number };
    movers: { minVelocityDelta: number; minRankMovement: number };
  };
}

/**
 * Growth over one window. `null` numbers mean "not measurable" (insufficient history or repository too young for
 * the window); `0` means "measured, no growth". Never the other way round.
 */
export interface GrowthWindow {
  days: number;
  growth: number | null;
  growthPercent: number | null;
  /** Stars per day over `observedDays` (not over `days`), so a young repository is not penalised. */
  velocity: number | null;
  /** Days actually observed: min(window, repository age). */
  observedDays: number;
  /** True when the whole window was observable (repository at least `days` old and history covers it). */
  full: boolean;
  status: 'ok' | 'partial-window' | 'insufficient-history' | 'insufficient-age' | 'inconsistent';
}

export interface GrowthMetrics {
  /** Instant the measurements are anchored to (when the history was collected). */
  asOf: string;
  ageDays: number;
  stars: number;
  w7: GrowthWindow;
  w30: GrowthWindow;
  w90: GrowthWindow;
}

/** Raw, inspectable evidence. Nothing here is a score. */
export interface MomentumSignals {
  growth7d: number | null;
  growth30d: number | null;
  growth90d: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  velocity90d: number | null;
  growthPercent7d: number | null;
  growthPercent30d: number | null;
  growthPercent90d: number | null;
  /** Average stars/day over the 28 days that end 7 days before asOf (the period before the latest week). */
  priorVelocity: number | null;
  /** velocity7d / priorVelocity; null when the prior period is too quiet or unobserved. */
  accelerationRatio: number | null;
  /** velocity7d - priorVelocity (stars/day). */
  velocityDelta: number | null;
  windowsComparable: number;
  windowsAboveSustainedThreshold: number;
  sustained: boolean;
  ageDays: number;
  newEntrant: boolean;
  recentlyActive: boolean | null;
  pushedDaysAgo: number | null;
  /** Context only. Not used by the score. */
  lifetimeStars: number;
  staleDays: number;
}

export interface ScoreComponent {
  name: 'velocity' | 'relativeGrowth' | 'acceleration' | 'persistence';
  /** 0..1, null when the input is missing (component excluded, weights renormalised). */
  value: number | null;
  weight: number;
  note: string;
}

export interface MomentumScore {
  version: string;
  /** 0..100, one decimal; null when there is no velocity to score. Never clipped, so scores do not tie at a ceiling. */
  score: number | null;
  components: ScoreComponent[];
  multipliers: { name: string; factor: number; reason: string }[];
  /** Weight share of the components that could be computed (1 = all four). */
  completeness: number;
}

export type TrendLabel = 'RISING' | 'COOLING' | 'STEADY' | 'INSUFFICIENT_DATA' | 'EXCLUDED';

export interface MomentumRecord {
  id: string;
  fullName: string;
  growth: GrowthMetrics;
  signals: MomentumSignals;
  momentum: MomentumScore;
  trend: TrendLabel;
  flags: { rising: boolean; sustained: boolean; newEntrant: boolean; mover: 'UP' | 'DOWN' | null };
  /** Rank movement in velocity between 7 days ago and now, within the evaluated cohort (positive = moved up). */
  rankMovement: { rankNow: number; rankBefore: number; delta: number } | null;
  explanation: string[];
  summary: string;
}
