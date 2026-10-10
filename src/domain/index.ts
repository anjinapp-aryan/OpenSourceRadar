/**
 * Radar domains (Phase 6.3). One common engine, one small adapter per domain. The adapter holds parameters only: it decides which
 * normalisation a domain uses, never how momentum itself is computed. AI keeps the production absolute rules (mode `absolute`), so
 * its output is unchanged by construction.
 */
import { readFileSync } from 'node:fs';
import type { NormalizationParams } from '../momentum/normalize';

export type RadarDomain = 'AI' | 'ENGINEERING';
export type TopLevel = 'AI' | 'ENGINEERING' | 'BOTH' | 'UNKNOWN';

/**
 * Which population a repository is ranked against. BOTH repositories are AI repositories on the public site (`aiRepositories`
 * includes them), so they stay in the AI population; UNKNOWN repositories have no domain.
 */
export function radarDomainOf(topLevel: TopLevel): RadarDomain | null {
  if (topLevel === 'AI' || topLevel === 'BOTH') return 'AI';
  if (topLevel === 'ENGINEERING') return 'ENGINEERING';
  return null;
}

export type DomainAdapter = { domain: RadarDomain; mode: 'absolute' } | { domain: RadarDomain; mode: 'normalized'; params: NormalizationParams };

export class DomainConfigError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseParams(raw: unknown, where: string): NormalizationParams {
  if (!isRecord(raw)) throw new DomainConfigError(`${where}: params are required`);
  const num = (k: string): number => {
    const v = raw[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new DomainConfigError(`${where}.${k}: expected a number`);
    return v;
  };
  const pct = (k: string): number => {
    const v = num(k);
    if (v <= 0 || v >= 1) throw new DomainConfigError(`${where}.${k}: expected a value strictly between 0 and 1`);
    return v;
  };
  const algorithm = raw.algorithm;
  const metric = raw.metric;
  if (algorithm !== 'raw' && algorithm !== 'domain' && algorithm !== 'band' && algorithm !== 'hybrid') throw new DomainConfigError(`${where}.algorithm is invalid`);
  if (metric !== 'g7' && metric !== 'g30' && metric !== 'blend') throw new DomainConfigError(`${where}.metric is invalid`);
  const bounds = raw.bandBounds;
  if (!Array.isArray(bounds) || !bounds.every((b, i) => typeof b === 'number' && b > 0 && (i === 0 || b > (bounds[i - 1] as number)))) throw new DomainConfigError(`${where}.bandBounds must be ascending positive numbers`);
  return {
    algorithm,
    metric,
    domainPercentile: pct('domainPercentile'),
    bandPercentile: pct('bandPercentile'),
    minGrowth7d: num('minGrowth7d'),
    minBandGrowth7d: num('minBandGrowth7d'),
    minAcceleration: num('minAcceleration'),
    maxSpikeShare: num('maxSpikeShare'),
    minHistoryDays: num('minHistoryDays'),
    bandBounds: bounds as number[],
    minPeers: num('minPeers'),
  };
}

export function parseDomainConfig(raw: unknown): Record<RadarDomain, DomainAdapter> {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.domains)) throw new DomainConfigError('domain config: schemaVersion 1 and domains are required');
  const out = {} as Record<RadarDomain, DomainAdapter>;
  for (const domain of ['AI', 'ENGINEERING'] as const) {
    const d = raw.domains[domain];
    if (!isRecord(d)) throw new DomainConfigError(`domains.${domain} is required`);
    if (d.mode === 'absolute') out[domain] = { domain, mode: 'absolute' };
    else if (d.mode === 'normalized') out[domain] = { domain, mode: 'normalized', params: parseParams(d.params, `domains.${domain}.params`) };
    else throw new DomainConfigError(`domains.${domain}.mode must be absolute or normalized`);
  }
  return out;
}

export function loadDomainConfig(path = 'config/domains.json'): Record<RadarDomain, DomainAdapter> {
  try {
    return parseDomainConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    if (e instanceof DomainConfigError) throw e;
    throw new DomainConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
