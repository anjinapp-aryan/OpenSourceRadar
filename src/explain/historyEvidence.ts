/**
 * "Over time" evidence for the Why panel (Phase 6.2). Pure and deterministic. Every sentence is computed from the
 * repository's own published daily gains (history.json, at most 90 days); nothing is inferred and nothing is added when
 * the series is too short to support it. Week 0 is the last 7 days (today included, a partial day), week 1 the 7 before, and so on.
 */
import { trajectoryMetrics } from '../history/trajectory';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const ratio = (n: number) => (n >= 100 ? `${fmt(n)}×` : `${(Math.round(n * 10) / 10).toFixed(1)}×`);

export interface HistoryEvidence {
  lines: string[];
  /** Number of days the statements are based on. */
  days: number;
}

export function historyEvidence(gains: readonly number[]): HistoryEvidence {
  const m = trajectoryMetrics(gains);
  const lines: string[] = [];

  const w = m.consecutivePositiveWeeks;
  if (w.weeks >= 4) lines.push(`stars were gained in ${w.capped ? `each of the ${w.weeks} weeks of the published 90-day history` : `each of the last ${w.weeks} weeks`}`);

  if (m.medianPriorWeek !== null && m.medianPriorWeek >= 1 && m.currentToMedianRatio !== null && m.weeks[0] !== undefined) {
    lines.push(`the last 7 days (+${fmt(m.weeks[0])}) are ${ratio(m.currentToMedianRatio)} the median week of the ${Math.min(12, m.weeks.length - 1)} before (+${fmt(m.medianPriorWeek)})`);
  }

  if (m.accelerationDays !== null && m.accelerationDays.days >= 2) {
    lines.push(`the 7-day pace has been at least 1.2× the 28 days before it for ${m.accelerationDays.capped ? 'at least ' : ''}${m.accelerationDays.days} consecutive days`);
  }

  const q = m.quietWeeksBefore;
  if (q !== null && q.weeks >= 2) lines.push(`preceded by ${q.capped ? 'at least ' : ''}${q.weeks} weeks at one third or less of the last week's gains`);

  return { lines, days: m.days };
}
