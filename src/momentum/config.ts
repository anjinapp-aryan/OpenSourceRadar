import { readFileSync } from 'node:fs';
import type { MomentumConfig } from './types';

export class MomentumConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MomentumConfigError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function section(o: unknown, key: string): Record<string, unknown> {
  const v = isRecord(o) ? o[key] : undefined;
  if (!isRecord(v)) throw new MomentumConfigError(`${key} must be an object`);
  return v;
}

function num(o: Record<string, unknown>, key: string, where: string, min = 0): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new MomentumConfigError(`${where}.${key} must be a number >= ${min}`);
  return v;
}

/** Validate untrusted JSON into a MomentumConfig. Every threshold and weight lives in config/momentum.json. */
export function parseMomentumConfig(raw: unknown): MomentumConfig {
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw new MomentumConfigError('momentum config: unsupported schemaVersion');
  if (typeof raw.momentumVersion !== 'string' || !raw.momentumVersion) throw new MomentumConfigError('momentumVersion is required');
  const w = section(raw, 'windows');
  const a = section(raw, 'acceleration');
  const n = section(raw, 'newEntrant');
  const s = section(raw, 'sustained');
  const act = section(raw, 'activity');
  const f = section(raw, 'freshness');
  const sc = section(raw, 'score');
  const wt = section(sc, 'weights');
  const vb = section(sc, 'velocityBlend');
  const rg = section(sc, 'relativeGrowth');
  const t = section(raw, 'trends');
  const ri = section(t, 'rising');
  const co = section(t, 'cooling');
  const mo = section(t, 'movers');
  const cfg: MomentumConfig = {
    momentumVersion: raw.momentumVersion,
    windows: { short: num(w, 'short', 'windows', 1), medium: num(w, 'medium', 'windows', 1), long: num(w, 'long', 'windows', 1) },
    acceleration: { priorWindowDays: num(a, 'priorWindowDays', 'acceleration', 1), priorGapDays: num(a, 'priorGapDays', 'acceleration'), minPriorVelocity: num(a, 'minPriorVelocity', 'acceleration'), cap: num(a, 'cap', 'acceleration', 1.0001) },
    newEntrant: { maxAgeDays: num(n, 'maxAgeDays', 'newEntrant'), minGrowth: num(n, 'minGrowth', 'newEntrant') },
    sustained: { minVelocity: num(s, 'minVelocity', 'sustained'), minComparableWindows: num(s, 'minComparableWindows', 'sustained', 1) },
    activity: { recentPushDays: num(act, 'recentPushDays', 'activity'), staleRepositoryDays: num(act, 'staleRepositoryDays', 'activity'), staleRepositoryMultiplier: num(act, 'staleRepositoryMultiplier', 'activity') },
    freshness: { maxStaleDays: num(f, 'maxStaleDays', 'freshness') },
    score: {
      weights: { velocity: num(wt, 'velocity', 'score.weights'), relativeGrowth: num(wt, 'relativeGrowth', 'score.weights'), acceleration: num(wt, 'acceleration', 'score.weights'), persistence: num(wt, 'persistence', 'score.weights') },
      velocityBlend: { short: num(vb, 'short', 'score.velocityBlend'), medium: num(vb, 'medium', 'score.velocityBlend'), long: num(vb, 'long', 'score.velocityBlend') },
      velocityHalfPoint: num(sc, 'velocityHalfPoint', 'score', 0.0001),
      relativeGrowth: { halfPoint: num(rg, 'halfPoint', 'score.relativeGrowth', 0.0001), cap: num(rg, 'cap', 'score.relativeGrowth', 1), minAbsoluteGrowth30d: num(rg, 'minAbsoluteGrowth30d', 'score.relativeGrowth', 1) },
    },
    trends: {
      rising: { minScore: num(ri, 'minScore', 'trends.rising'), minVelocity7d: num(ri, 'minVelocity7d', 'trends.rising'), minGrowth7d: num(ri, 'minGrowth7d', 'trends.rising'), minVelocity30d: num(ri, 'minVelocity30d', 'trends.rising'), minAccelerationRatio: num(ri, 'minAccelerationRatio', 'trends.rising') },
      cooling: { maxAccelerationRatio: num(co, 'maxAccelerationRatio', 'trends.cooling'), minVelocity30d: num(co, 'minVelocity30d', 'trends.cooling') },
      movers: { minVelocityDelta: num(mo, 'minVelocityDelta', 'trends.movers'), minRankMovement: num(mo, 'minRankMovement', 'trends.movers') },
    },
  };
  if (cfg.windows.short >= cfg.windows.medium || cfg.windows.medium >= cfg.windows.long) throw new MomentumConfigError('windows must satisfy short < medium < long');
  const totalWeight = Object.values(cfg.score.weights).reduce((x, y) => x + y, 0);
  if (Math.abs(totalWeight - 1) > 1e-9) throw new MomentumConfigError(`score.weights must sum to 1 (got ${totalWeight})`);
  return cfg;
}

export function loadMomentumConfig(path = 'config/momentum.json'): MomentumConfig {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new MomentumConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseMomentumConfig(json);
}
