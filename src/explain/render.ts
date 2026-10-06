import { evidenceOf, type Pattern, type PatternConfig, type PatternInput } from './pattern';

export const PATTERN_LABEL: Record<Pattern, string> = {
  INSUFFICIENT_HISTORY: 'Insufficient history',
  NEW_LAUNCH: 'New launch',
  FLAT: 'No recent growth',
  SPIKE: 'Concentrated spike',
  COOLING: 'Cooling',
  BREAKOUT: 'Breakout',
  ACCELERATING: 'Accelerating',
  SUSTAINED_GROWTH: 'Sustained climb',
  NORMAL_GROWTH: 'Steady growth',
};

export interface WhyModel {
  pattern: Pattern;
  /** Ranking status from the momentum engine (RISING, COOLING, STEADY...). */
  status: string;
  headline: string;
  /** Evidence lines, in a fixed order. Every number comes from the record. */
  lines: string[];
  /** Neutral cautionary note for patterns whose persistence is not yet established; null otherwise. */
  note: string | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
const rate = (n: number) => (Math.abs(n) >= 100 ? fmt(n) : (Math.round(n * 10) / 10).toFixed(1));
const ratio = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}×`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const days = (n: number) => `${Math.floor(n)} day${Math.floor(n) === 1 ? '' : 's'}`;

/**
 * Render the structured evidence as readable lines. Deterministic; no external facts; nothing is said that the
 * record does not support. Unmeasurable windows are stated as unavailable, never as zero.
 */
export function renderWhy(i: PatternInput, pattern: Pattern, cfg: PatternConfig): WhyModel {
  const e = evidenceOf(i);
  const lines: string[] = [];

  if (e.growth7d !== null) {
    const w = i.ageDays < 7 ? `${days(Math.max(i.ageDays, 1))} since creation` : '7 days';
    lines.push(`${signed(e.growth7d)} stars in ${w}${e.velocity7d !== null ? ` (${rate(e.velocity7d)}/day)` : ''}`);
  } else {
    lines.push('7-day growth not available: history does not cover the window');
  }
  if (e.growth30d !== null) lines.push(`${signed(e.growth30d)} stars in 30 days${e.velocity30d !== null ? ` (${rate(e.velocity30d)}/day)` : ''}`);
  else lines.push(i.ageDays < 30 ? `30-day growth not available: repository is ${days(i.ageDays)} old` : '30-day growth not available: history does not cover the window');
  if (e.growth90d !== null) lines.push(`${signed(e.growth90d)} stars in 90 days`);
  else if (i.ageDays < 90 && e.growth30d !== null) lines.push(`90-day growth not available: repository is ${days(i.ageDays)} old`);

  if (e.accelerationRatio !== null && e.velocity7d !== null && e.priorVelocity !== null) {
    const word = e.accelerationRatio >= cfg.accelerating.minRatio ? 'accelerating' : e.accelerationRatio <= cfg.slowing.maxRatio ? 'slowing' : 'steady pace';
    lines.push(`${rate(e.velocity7d)}/day over the last 7 days against ${rate(e.priorVelocity)}/day over the previous 28 days (${ratio(e.accelerationRatio)}, ${word})`);
  }

  let note: string | null = null;
  switch (pattern) {
    case 'SPIKE':
      if (e.spikeShare30 !== null) lines.push(`${pct(e.spikeShare30)} of the last 30 days' growth arrived in the last 7 days`);
      if (e.lifetimeShare7d !== null && e.lifetimeShare7d >= 0.25) lines.push(`${pct(e.lifetimeShare7d)} of all its stars were gained in the last 7 days`);
      note = 'Growth is concentrated in the most recent week; persistence is not yet established.';
      break;
    case 'NEW_LAUNCH':
      lines.push(`created ${days(i.ageDays)} ago; newness alone is not momentum`);
      note = 'The repository is too young for 30-day measurements; the 7-day figure covers its whole life.';
      break;
    case 'FLAT':
      lines.push('no stars gained in the last 7 days');
      break;
    case 'COOLING':
      if (e.priorVelocity !== null && i.velocity90d !== null && i.velocity90d > 0 && e.priorVelocity >= cfg.elevatedPrior.minRatioToLongAverage * i.velocity90d) {
        lines.push(`the previous 28 days ran at ${ratio(e.priorVelocity / i.velocity90d)} the 90-day average`);
      }
      break;
    case 'INSUFFICIENT_HISTORY':
      note = 'Not enough measured history to describe the shape of growth; no value has been assumed.';
      break;
    default:
      break;
  }
  if (e.sustained && (pattern === 'BREAKOUT' || pattern === 'ACCELERATING' || pattern === 'SUSTAINED_GROWTH')) {
    lines.push('sustained: growth stayed above the sustained threshold in every fully observed window');
  }
  lines.push(`context: ${fmt(i.stars)} lifetime stars (not used in the score)`);

  return { pattern, status: i.trend, headline: PATTERN_LABEL[pattern], lines, note };
}

const STATUS_HEADING: Record<string, string> = { RISING: 'Why this is rising', COOLING: 'Why this is cooling', STEADY: 'Why this is steady' };
export function whyHeading(status: string): string {
  return STATUS_HEADING[status] ?? 'Why it is listed';
}
