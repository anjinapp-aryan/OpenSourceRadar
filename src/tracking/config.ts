import { readFileSync } from 'node:fs';
import type { TopLevelCategory } from '../classification/types';
import type { TrackingPolicy, TrackingStatus } from './types';

export class TrackingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackingConfigError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(o: unknown, key: string, where: string, min = 0): number {
  const v = isRecord(o) ? o[key] : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new TrackingConfigError(`${where}.${key} must be a number >= ${min}`);
  return v;
}

function obj(o: unknown, key: string, where: string): Record<string, unknown> {
  const v = isRecord(o) ? o[key] : undefined;
  if (!isRecord(v)) throw new TrackingConfigError(`${where}.${key} must be an object`);
  return v;
}

const STATUSES = ['HOT', 'WARM', 'DORMANT', 'UNASSESSED'];

function parseDueOrder(v: unknown): TrackingStatus[] {
  if (v === undefined) return ['HOT', 'UNASSESSED', 'WARM', 'DORMANT'];
  if (!Array.isArray(v) || v.length !== 4 || !STATUSES.every((s) => v.includes(s))) throw new TrackingConfigError('dueOrder must list HOT, WARM, DORMANT and UNASSESSED exactly once');
  return v as TrackingStatus[];
}

/** Validate untrusted JSON into a TrackingPolicy. Refresh intervals and thresholds are never hardcoded in the engine. */
export function parseTrackingPolicy(raw: unknown): TrackingPolicy {
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw new TrackingConfigError('tracking config: unsupported schemaVersion');
  if (typeof raw.trackingVersion !== 'string' || !raw.trackingVersion) throw new TrackingConfigError('trackingVersion is required');
  const elig = obj(raw, 'eligibility', 'tracking');
  const top = elig.topLevel;
  if (!Array.isArray(top) || !top.every((t) => ['AI', 'ENGINEERING', 'BOTH', 'UNKNOWN'].includes(t as string))) throw new TrackingConfigError('eligibility.topLevel invalid');
  const tiers = obj(raw, 'tiers', 'tracking');
  const rules = obj(raw, 'rules', 'tracking');
  const hot = obj(rules, 'hot', 'rules');
  const warm = obj(rules, 'warm', 'rules');
  const dormantRules = obj(rules, 'dormant', 'rules');
  const un = obj(raw, 'unassessed', 'tracking');
  const hy = obj(raw, 'hysteresis', 'tracking');
  const minDays = obj(hy, 'minDaysInTier', 'hysteresis');
  const tierHours = (k: string) => num(obj(tiers, k, 'tiers'), 'refreshHours', `tiers.${k}`, 1);
  const factor = num(hy, 'demoteFactor', 'hysteresis');
  if (factor <= 0 || factor > 1) throw new TrackingConfigError('hysteresis.demoteFactor must be within (0, 1]');
  const policy: TrackingPolicy = {
    trackingVersion: raw.trackingVersion,
    eligibility: { topLevel: top as TopLevelCategory[], excludeArchived: elig.excludeArchived === true },
    tiers: { hot: { refreshHours: tierHours('hot') }, warm: { refreshHours: tierHours('warm') }, dormant: { refreshHours: tierHours('dormant') } },
    rules: {
      hot: {
        minStarsPerDay7d: num(hot, 'minStarsPerDay7d', 'rules.hot'),
        minGrowthPercent7d: num(hot, 'minGrowthPercent7d', 'rules.hot'),
        minGrowth7dForPercent: num(hot, 'minGrowth7dForPercent', 'rules.hot'),
        newEntrantMaxAgeDays: num(hot, 'newEntrantMaxAgeDays', 'rules.hot'),
        newEntrantMinStarsPerDay7d: num(hot, 'newEntrantMinStarsPerDay7d', 'rules.hot'),
      },
      warm: {
        minStarsPerDay7d: num(warm, 'minStarsPerDay7d', 'rules.warm'),
        minStarsPerDay30d: num(warm, 'minStarsPerDay30d', 'rules.warm'),
        activityMaxDays: num(warm, 'activityMaxDays', 'rules.warm'),
        activityMinStars: num(warm, 'activityMinStars', 'rules.warm'),
      },
      dormant: { minAgeDays: num(dormantRules, 'minAgeDays', 'rules.dormant') },
    },
    unassessed: { refreshHours: num(un, 'refreshHours', 'unassessed', 1) },
    dueOrder: parseDueOrder(raw.dueOrder),
    dueGraceHours: raw.dueGraceHours === undefined ? 0 : num(raw, 'dueGraceHours', 'tracking', 0),
    hysteresis: {
      demoteFactor: factor,
      minDaysInTier: { hot: num(minDays, 'hot', 'minDaysInTier'), warm: num(minDays, 'warm', 'minDaysInTier'), dormant: num(minDays, 'dormant', 'minDaysInTier') },
    },
  };
  if (!(policy.tiers.hot.refreshHours <= policy.tiers.warm.refreshHours && policy.tiers.warm.refreshHours <= policy.tiers.dormant.refreshHours)) {
    throw new TrackingConfigError('refresh hours must satisfy hot <= warm <= dormant');
  }
  return policy;
}

export function loadTrackingPolicy(path = 'config/tracking.json'): TrackingPolicy {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new TrackingConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseTrackingPolicy(json);
}
