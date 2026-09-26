import { addDays, utcDate } from '../analysis/starHistory';
import { computeWindowsFromGains, type WindowMetrics } from '../analysis/windows';
import { gainsOf, type RepositoryRecord } from '../collect/dataset';
import type { DailyGain } from '../model/starHistory';
import type { GrowthMetrics, GrowthWindow, MomentumConfig, MomentumRecord, MomentumScore, MomentumSignals, ScoreComponent, TrendLabel } from './types';

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const NULL_WINDOW = (days: number, status: GrowthWindow['status']): GrowthWindow => ({ days, growth: null, growthPercent: null, velocity: null, observedDays: 0, full: false, status });

/** The instant a record's growth is anchored to: when its history was collected. */
export function growthAsOf(record: RepositoryRecord, datasetGeneratedAt: string): Date {
  return new Date(record.growthAsOf ?? datasetGeneratedAt);
}

function windowFrom(w: WindowMetrics, ageDays: number, isShortest: boolean): GrowthWindow {
  if (w.status === 'insufficient-history' || w.status === 'inconsistent') return NULL_WINDOW(w.days, w.status);
  if (ageDays >= w.days) {
    return { days: w.days, growth: w.growth, growthPercent: w.growthPercent, velocity: w.growth === null ? null : Math.round((w.growth / w.days) * 1e4) / 1e4, observedDays: w.days, full: true, status: 'ok' };
  }
  // The repository is younger than the window. Only the shortest window is reported (over the days that exist);
  // longer windows would compare a young repository with old ones, so they are null, never zero.
  if (!isShortest) return NULL_WINDOW(w.days, 'insufficient-age');
  const observed = Math.min(w.days, Math.max(1, Math.ceil(ageDays)));
  return { days: w.days, growth: w.growth, growthPercent: w.growthPercent, velocity: w.growth === null ? null : Math.round((w.growth / observed) * 1e4) / 1e4, observedDays: observed, full: false, status: 'partial-window' };
}

/**
 * Growth metrics from the stored star history. Reuses the Phase 2 window maths (null when the history does not
 * cover a window) and adds the age rule: a window longer than the repository's life is null, except the 7-day
 * window, which is reported over the days that exist and flagged `partial-window`.
 */
export function computeGrowthMetrics(record: RepositoryRecord, asOf: Date, cfg: MomentumConfig): GrowthMetrics {
  const ageDays = Math.max(0, (asOf.getTime() - Date.parse(record.createdAt)) / DAY_MS);
  const gains = gainsOf(record.starHistory);
  const win = computeWindowsFromGains(gains, record.starHistory.complete, record.stars, asOf);
  return {
    asOf: asOf.toISOString(),
    ageDays: Math.round(ageDays * 100) / 100,
    stars: record.stars,
    w7: windowFrom(win['7d'], ageDays, true),
    w30: windowFrom(win['30d'], ageDays, false),
    w90: windowFrom(win['90d'], ageDays, false),
  };
}

function sumRange(gains: readonly DailyGain[], complete: boolean, from: string, to: string): number | null {
  const byDate = new Map(gains.map((g) => [g.date, g.count]));
  const first = gains[0]?.date;
  if (first === undefined) return null;
  let sum = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = byDate.get(d);
    if (c === undefined) {
      if (complete && d < first) continue; // before the first bucket of a complete history: repository did not exist
      return null;
    }
    sum += c;
  }
  return sum;
}

/** Average stars/day over `days` days ending `endOffset` days before asOf (offset 0 = ending today). */
function velocityOver(record: RepositoryRecord, asOf: Date, days: number, endOffset: number): number | null {
  const gains = gainsOf(record.starHistory);
  const end = addDays(utcDate(asOf), -endOffset);
  const start = addDays(end, -(days - 1));
  const sum = sumRange(gains, record.starHistory.complete, start, end);
  return sum === null ? null : sum / days;
}

export function computeSignals(record: RepositoryRecord, gm: GrowthMetrics, asOf: Date, now: Date, cfg: MomentumConfig): MomentumSignals {
  const { priorWindowDays, priorGapDays, minPriorVelocity } = cfg.acceleration;
  const ageDays = gm.ageDays;
  // acceleration needs the whole prior period to exist AFTER the repository was created
  const priorVelocity = ageDays >= priorWindowDays + priorGapDays ? velocityOver(record, asOf, priorWindowDays, priorGapDays) : null;
  const v7 = gm.w7.velocity;
  const accelerationRatio = v7 !== null && priorVelocity !== null && priorVelocity >= minPriorVelocity ? round2(v7 / priorVelocity) : null;
  const velocityDelta = v7 !== null && priorVelocity !== null ? round2(v7 - priorVelocity) : null;

  const full = [gm.w7, gm.w30, gm.w90].filter((w) => w.full && w.velocity !== null);
  const above = full.filter((w) => (w.velocity as number) >= cfg.sustained.minVelocity).length;
  const sustained = full.length >= cfg.sustained.minComparableWindows && gm.w30.full && above === full.length;

  const pushedDaysAgo = record.pushedAt ? Math.max(0, (asOf.getTime() - Date.parse(record.pushedAt)) / DAY_MS) : null;
  const lifetimeGrowth = record.starHistory.complete ? record.stars : gm.w7.growth;
  return {
    growth7d: gm.w7.growth,
    growth30d: gm.w30.growth,
    growth90d: gm.w90.growth,
    velocity7d: gm.w7.velocity,
    velocity30d: gm.w30.velocity,
    velocity90d: gm.w90.velocity,
    growthPercent7d: gm.w7.growthPercent,
    growthPercent30d: gm.w30.growthPercent,
    growthPercent90d: gm.w90.growthPercent,
    priorVelocity: priorVelocity === null ? null : round2(priorVelocity),
    accelerationRatio,
    velocityDelta,
    windowsComparable: full.length,
    windowsAboveSustainedThreshold: above,
    sustained,
    ageDays,
    newEntrant: ageDays <= cfg.newEntrant.maxAgeDays && (lifetimeGrowth ?? 0) >= cfg.newEntrant.minGrowth,
    recentlyActive: pushedDaysAgo === null ? null : pushedDaysAgo <= cfg.activity.recentPushDays,
    pushedDaysAgo: pushedDaysAgo === null ? null : round2(pushedDaysAgo),
    lifetimeStars: record.stars,
    staleDays: round2(Math.max(0, (now.getTime() - asOf.getTime()) / DAY_MS)),
  };
}

/** x / (x + half): strictly increasing, 0.5 at `half`, never reaches 1 (no ceiling, so no ties at the top). */
const soft = (x: number, half: number) => (x <= 0 ? 0 : x / (x + half));

/**
 * MomentumScore v1: measured recent momentum. Not a prediction. Inputs are growth measurements only:
 * no lifetime-star term, no category, no classification.
 */
export function computeScore(signals: MomentumSignals, gm: GrowthMetrics, isArchived: boolean, cfg: MomentumConfig): MomentumScore {
  const sc = cfg.score;
  const components: ScoreComponent[] = [];

  // velocity: blend of the available windows, log-scaled, half point = velocityHalfPoint stars/day
  const parts: Array<[number | null, number]> = [
    [gm.w7.velocity, sc.velocityBlend.short],
    [gm.w30.velocity, sc.velocityBlend.medium],
    [gm.w90.velocity, sc.velocityBlend.long],
  ];
  const usable = parts.filter((p): p is [number, number] => p[0] !== null);
  const wsum = usable.reduce((s, p) => s + p[1], 0);
  const blended = wsum > 0 ? usable.reduce((s, p) => s + p[0] * p[1], 0) / wsum : null;
  components.push({
    name: 'velocity',
    weight: sc.weights.velocity,
    value: blended === null ? null : soft(Math.log1p(blended), Math.log1p(sc.velocityHalfPoint)),
    note: blended === null ? 'no velocity available' : `blended ${round1(blended)} stars/day over ${usable.length} window(s)`,
  });

  // relative growth: 30-day percentage, capped, and gated by absolute growth so tiny bases cannot dominate
  const pct = gm.w30.full ? gm.w30.growthPercent : null;
  let relValue: number | null = null;
  let relNote = gm.w30.full ? 'no percentage (zero base)' : 'needs a full 30-day window';
  if (pct !== null && gm.w30.growth !== null) {
    const gate = Math.min(1, gm.w30.growth / sc.relativeGrowth.minAbsoluteGrowth30d);
    relValue = soft(Math.min(pct, sc.relativeGrowth.cap), sc.relativeGrowth.halfPoint) * gate;
    relNote = `${round1(pct)}% in 30 days, weighted by ${round2(gate)} for absolute size`;
  }
  components.push({ name: 'relativeGrowth', weight: sc.weights.relativeGrowth, value: relValue, note: relNote });

  // acceleration: recent week vs the preceding four weeks; only speed-ups count, slow-downs contribute 0
  const ratio = signals.accelerationRatio;
  components.push({
    name: 'acceleration',
    weight: sc.weights.acceleration,
    value: ratio === null ? null : Math.min(1, Math.max(0, (ratio - 1) / (cfg.acceleration.cap - 1))),
    note: ratio === null ? 'prior period unavailable or too quiet' : `${ratio}x the previous ${cfg.acceleration.priorWindowDays} days`,
  });

  // persistence: share of the fully observed windows that stay above the sustained velocity threshold
  components.push({
    name: 'persistence',
    weight: sc.weights.persistence,
    value: signals.windowsComparable >= cfg.sustained.minComparableWindows ? signals.windowsAboveSustainedThreshold / signals.windowsComparable : null,
    note: signals.windowsComparable >= cfg.sustained.minComparableWindows ? `${signals.windowsAboveSustainedThreshold} of ${signals.windowsComparable} windows >= ${cfg.sustained.minVelocity} stars/day` : 'fewer than 2 fully observed windows',
  });

  const multipliers: MomentumScore['multipliers'] = [];
  if (signals.pushedDaysAgo !== null && signals.pushedDaysAgo > cfg.activity.staleRepositoryDays) {
    multipliers.push({ name: 'inactive-repository', factor: cfg.activity.staleRepositoryMultiplier, reason: `last push ${Math.round(signals.pushedDaysAgo)} days ago` });
  }

  const velocity = components[0] as ScoreComponent;
  const present = components.filter((c) => c.value !== null);
  const totalW = present.reduce((s, c) => s + c.weight, 0);
  const completeness = round2(totalW / components.reduce((s, c) => s + c.weight, 0));
  if (isArchived || velocity.value === null || totalW === 0) return { version: cfg.momentumVersion, score: null, components, multipliers, completeness };
  const composite = present.reduce((s, c) => s + c.weight * (c.value as number), 0) / totalW;
  const factor = multipliers.reduce((f, m) => f * m.factor, 1);
  return { version: cfg.momentumVersion, score: round1(100 * composite * factor), components, multipliers, completeness };
}

export function classifyTrend(signals: MomentumSignals, score: MomentumScore, gm: GrowthMetrics, isArchived: boolean, cfg: MomentumConfig): TrendLabel {
  if (isArchived) return 'EXCLUDED';
  if (score.score === null) return 'INSUFFICIENT_DATA';
  const r = cfg.trends.rising;
  const long = gm.w30.full ? (signals.velocity30d ?? 0) >= r.minVelocity30d : true; // a repository younger than 30 days is judged on its 7-day evidence
  const fresh = signals.staleDays <= cfg.freshness.maxStaleDays;
  // Rising means high AND holding: a repository whose last week ran at less than minAccelerationRatio of the previous four weeks is fading, not rising.
  const holding = signals.accelerationRatio === null || signals.accelerationRatio >= r.minAccelerationRatio;
  if (fresh && holding && score.score >= r.minScore && (signals.velocity7d ?? 0) >= r.minVelocity7d && (signals.growth7d ?? 0) >= r.minGrowth7d && long) return 'RISING';
  const c = cfg.trends.cooling;
  if (signals.accelerationRatio !== null && signals.accelerationRatio <= c.maxAccelerationRatio && (signals.velocity30d ?? 0) >= c.minVelocity30d) return 'COOLING';
  return 'STEADY';
}

/** Deterministic, human-readable evidence. Every number comes from a measured signal. */
export function explain(signals: MomentumSignals, score: MomentumScore, gm: GrowthMetrics, trend: TrendLabel, cfg: MomentumConfig): { explanation: string[]; summary: string } {
  const lines: string[] = [];
  const g = (n: number | null) => (n === null ? null : (n >= 0 ? '+' : '') + fmt(n));
  if (signals.growth7d !== null) lines.push(`${g(signals.growth7d)} stars in ${gm.w7.full ? '7 days' : `${gm.w7.observedDays} day(s) since creation`} (${round1(signals.velocity7d as number)}/day)`);
  if (signals.growth30d !== null) lines.push(`${g(signals.growth30d)} stars in 30 days (${round1(signals.velocity30d as number)}/day)`);
  else lines.push(`30-day growth not available: ${gm.w30.status === 'insufficient-age' ? `repository is ${Math.floor(gm.ageDays)} days old` : 'history does not cover the window'}`);
  if (signals.growth90d !== null) lines.push(`${g(signals.growth90d)} stars in 90 days (${round1(signals.velocity90d as number)}/day)`);
  else if (gm.w90.status === 'insufficient-age') lines.push(`90-day growth not available: repository is ${Math.floor(gm.ageDays)} days old`);
  if (signals.accelerationRatio !== null) {
    lines.push(signals.accelerationRatio >= 1.2 ? `accelerating: last week ${signals.accelerationRatio}x the previous ${cfg.acceleration.priorWindowDays} days` : signals.accelerationRatio <= 0.8 ? `decelerating: last week ${signals.accelerationRatio}x the previous ${cfg.acceleration.priorWindowDays} days` : `steady pace: last week ${signals.accelerationRatio}x the previous ${cfg.acceleration.priorWindowDays} days`);
  }
  if (signals.sustained) lines.push(`sustained: every fully observed window (${signals.windowsComparable}) is at least ${cfg.sustained.minVelocity} stars/day`);
  else if (signals.windowsComparable >= 2) lines.push(`not sustained: ${signals.windowsAboveSustainedThreshold} of ${signals.windowsComparable} windows reach ${cfg.sustained.minVelocity} stars/day`);
  if (signals.newEntrant) lines.push(`new entrant: created ${Math.floor(gm.ageDays)} days ago (newness is a signal, not momentum by itself)`);
  if (signals.recentlyActive === true) lines.push(`recently active: last push ${Math.round(signals.pushedDaysAgo as number)} days ago`);
  else if (signals.recentlyActive === false) lines.push(`not recently active: last push ${Math.round(signals.pushedDaysAgo as number)} days ago`);
  for (const m of score.multipliers) lines.push(`score x${m.factor}: ${m.reason}`);
  lines.push(`context: ${fmt(signals.lifetimeStars)} lifetime stars (not used in the score)`);
  if (signals.staleDays > cfg.freshness.maxStaleDays) lines.push(`data is ${round1(signals.staleDays)} days old (freshness limit for Rising: ${cfg.freshness.maxStaleDays})`);

  const parts: string[] = [];
  if (signals.growth7d !== null) parts.push(`${fmt(signals.growth7d)} stars in ${gm.w7.full ? '7 days' : `${gm.w7.observedDays} day(s)`}`);
  if (signals.growth30d !== null) parts.push(`${fmt(signals.growth30d)} in 30 days`);
  let summary = parts.length ? `Gained ${parts.join(' and ')}` : 'Not enough history to describe recent growth';
  if (signals.accelerationRatio !== null && signals.accelerationRatio >= 1.2) summary += ', with acceleration over the last week';
  else if (signals.accelerationRatio !== null && signals.accelerationRatio <= 0.8) summary += ', slowing over the last week';
  summary += trend === 'RISING' ? '. Meets the Rising criteria.' : '.';
  return { explanation: lines, summary };
}

/** Full evaluation of one repository. The signature has no category or classification argument on purpose. */
export function evaluateRepository(record: RepositoryRecord, datasetGeneratedAt: string, now: Date, cfg: MomentumConfig): Omit<MomentumRecord, 'rankMovement' | 'flags'> & { archived: boolean } {
  const asOf = growthAsOf(record, datasetGeneratedAt);
  const archived = record.isArchived === true;
  const gm = computeGrowthMetrics(record, asOf, cfg);
  const signals = computeSignals(record, gm, asOf, now, cfg);
  const momentum = computeScore(signals, gm, archived, cfg);
  const trend = classifyTrend(signals, momentum, gm, archived, cfg);
  const { explanation, summary } = explain(signals, momentum, gm, trend, cfg);
  return { id: record.id, fullName: record.fullName, growth: gm, signals, momentum, trend, explanation, summary, archived };
}

export { velocityOver };
