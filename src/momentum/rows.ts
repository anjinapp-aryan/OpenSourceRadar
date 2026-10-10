/**
 * The observable-at-T inputs of the normalisation layer for one repository. Everything is computed by the production back-tester
 * (`evaluateAt`, which discards all data after T) plus the daily gains up to and including T; nothing after T is read.
 */
import { evaluateAt } from '../backtest';
import { gainsOf, type RepositoryRecord } from '../collect/dataset';
import type { PatternConfig } from '../explain/pattern';
import type { MomentumConfig } from './types';
import type { NormalizationRow } from './normalize';

export interface ObservableRow extends NormalizationRow {
  growth90d: number | null;
  trend: string;
  pattern: string | null;
}

export function observableRow(r: RepositoryRecord, date: string, cfg: MomentumConfig, pcfg: PatternConfig): ObservableRow | null {
  const s = evaluateAt(r, date, cfg, pcfg);
  if (!s || s.growth7d === null || s.velocity7d === null) return null;
  const upToT = gainsOf(r.starHistory).filter((g) => g.date <= date);
  const last7 = upToT.slice(-7).map((g) => g.count);
  const sum7 = last7.reduce((a, b) => a + b, 0);
  return {
    id: r.id,
    stars: s.stars,
    growth7d: s.growth7d,
    growth30d: s.growth30d,
    growth90d: s.growth90d,
    velocity7d: s.velocity7d,
    accelerationRatio: s.accelerationRatio,
    spikeShare: sum7 > 0 ? Math.max(...last7) / sum7 : 0,
    historyDays: upToT.length,
    trend: s.trend,
    pattern: s.pattern,
  };
}
