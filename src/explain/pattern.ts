/**
 * Growth-pattern model (Phase 6.1). Pure, deterministic, no I/O.
 *
 * Separates three things that must not be mixed:
 *   PATTERN  the shape of recent growth (this file),
 *   EVIDENCE the measured numbers behind it (`evidenceOf`),
 *   STATUS   the ranking label (RISING / COOLING / STEADY), produced by the momentum engine and only read here.
 *
 * Patterns are neutral descriptions of shape. They never say or imply that stars were bought or that a repository is
 * invalid; unusual growth is not invalid growth.
 */
export const PATTERNS = ['INSUFFICIENT_HISTORY', 'NEW_LAUNCH', 'FLAT', 'SPIKE', 'COOLING', 'BREAKOUT', 'ACCELERATING', 'SUSTAINED_GROWTH', 'NORMAL_GROWTH'] as const;
export type Pattern = (typeof PATTERNS)[number];

export interface PatternConfig {
  schemaVersion: 1;
  patternVersion: string;
  newLaunch: { maxAgeDays: number };
  spike: { minShare30: number; minGrowth7d: number };
  breakout: { minRatio: number; minGrowth7d: number };
  accelerating: { minRatio: number; minGrowth7d: number };
  slowing: { maxRatio: number };
  elevatedPrior: { minRatioToLongAverage: number };
}

/** Exactly the fields of a public repository record that the pattern depends on (so the UI can recompute it). */
export interface PatternInput {
  stars: number;
  ageDays: number;
  growth7d: number | null;
  growth30d: number | null;
  growth90d: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  velocity90d: number | null;
  priorVelocity: number | null;
  accelerationRatio: number | null;
  trend: string;
  flags: { sustained: boolean; newEntrant: boolean };
}

export function parsePatternConfig(raw: unknown): PatternConfig {
  const bad = (m: string): never => {
    throw new Error(`pattern config: ${m}`);
  };
  if (typeof raw !== 'object' || raw === null) return bad('not an object');
  const r = raw as Record<string, any>;
  if (r.schemaVersion !== 1) bad('unsupported schemaVersion');
  if (typeof r.patternVersion !== 'string' || r.patternVersion === '') bad('patternVersion required');
  const num = (o: any, k: string, min: number, max = Infinity): number => {
    const v = o?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) bad(`${k} must be a number in [${min}, ${max}]`);
    return v;
  };
  const cfg: PatternConfig = {
    schemaVersion: 1,
    patternVersion: r.patternVersion,
    newLaunch: { maxAgeDays: num(r.newLaunch, 'maxAgeDays', 1) },
    spike: { minShare30: num(r.spike, 'minShare30', 0, 1), minGrowth7d: num(r.spike, 'minGrowth7d', 0) },
    breakout: { minRatio: num(r.breakout, 'minRatio', 1), minGrowth7d: num(r.breakout, 'minGrowth7d', 0) },
    accelerating: { minRatio: num(r.accelerating, 'minRatio', 1), minGrowth7d: num(r.accelerating, 'minGrowth7d', 0) },
    slowing: { maxRatio: num(r.slowing, 'maxRatio', 0, 1) },
    elevatedPrior: { minRatioToLongAverage: num(r.elevatedPrior, 'minRatioToLongAverage', 1) },
  };
  if (cfg.accelerating.minRatio >= cfg.breakout.minRatio) bad('accelerating.minRatio must be below breakout.minRatio');
  return cfg;
}

/**
 * Order matters and is part of the definition:
 * missing data first (never guessed), then young repositories, then zero growth, then concentrated bursts, then the
 * ranking engine's own Cooling status, then acceleration, then persistence, then everything else.
 */
export function classifyPattern(i: PatternInput, cfg: PatternConfig): Pattern {
  if (i.growth7d === null) return 'INSUFFICIENT_HISTORY';
  if (i.growth30d === null) return i.ageDays < cfg.newLaunch.maxAgeDays ? 'NEW_LAUNCH' : 'INSUFFICIENT_HISTORY';
  if (i.growth7d <= 0) return 'FLAT';
  const share = spikeShare30(i);
  if (share !== null && share >= cfg.spike.minShare30 && i.growth7d >= cfg.spike.minGrowth7d) return 'SPIKE';
  if (i.trend === 'COOLING') return 'COOLING';
  const a = i.accelerationRatio;
  // A ratio is only a pattern when the growth behind it is meaningful: 3x of almost nothing is still almost nothing.
  if (a !== null && a >= cfg.breakout.minRatio && i.growth7d >= cfg.breakout.minGrowth7d) return 'BREAKOUT';
  if (a !== null && a >= cfg.accelerating.minRatio && i.growth7d >= cfg.accelerating.minGrowth7d) return 'ACCELERATING';
  if (i.flags.sustained) return 'SUSTAINED_GROWTH';
  return 'NORMAL_GROWTH';
}

/** Share of the last 30 days' growth that arrived in the last 7 days (an even pace would be 7/30 = 0.23). */
export function spikeShare30(i: Pick<PatternInput, 'growth7d' | 'growth30d'>): number | null {
  if (i.growth7d === null || i.growth30d === null || i.growth30d <= 0) return null;
  return i.growth7d / i.growth30d;
}

/** Share of ALL the repository's stars that were gained in the last 7 days. */
export function lifetimeShare7d(i: Pick<PatternInput, 'growth7d' | 'stars'>): number | null {
  if (i.growth7d === null || i.stars <= 0) return null;
  return i.growth7d / i.stars;
}

export interface Evidence {
  growth7d: number | null;
  growth30d: number | null;
  growth90d: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  priorVelocity: number | null;
  accelerationRatio: number | null;
  /** Share of the 30-day growth that arrived in the last 7 days, 2 decimals. */
  spikeShare30: number | null;
  /** Share of all stars gained in the last 7 days, 3 decimals. */
  lifetimeShare7d: number | null;
  ageDays: number;
  sustained: boolean;
}

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

/** The numbers behind a pattern. Every value is either copied from the record or derived from two copied values. */
export function evidenceOf(i: PatternInput): Evidence {
  return {
    growth7d: i.growth7d,
    growth30d: i.growth30d,
    growth90d: i.growth90d,
    velocity7d: i.velocity7d,
    velocity30d: i.velocity30d,
    priorVelocity: i.priorVelocity,
    accelerationRatio: i.accelerationRatio,
    spikeShare30: r2(spikeShare30(i)),
    lifetimeShare7d: r3(lifetimeShare7d(i)),
    ageDays: i.ageDays,
    sustained: i.flags.sustained,
  };
}
