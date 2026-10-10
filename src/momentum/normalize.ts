/**
 * Domain-aware normalisation (Phase 6.3). Pure, deterministic functions over rows of already-measured numbers; no I/O, no clock, no
 * randomness. The production momentum engine and its labels are not touched: this layer answers a different question ("is this
 * repository's recent growth unusual among its peers?") and is computed per domain from data available at the evaluation date only.
 */

export type NormalizationAlgorithm = 'raw' | 'domain' | 'band' | 'hybrid';
export type RankMetric = 'g7' | 'g30' | 'blend';

export interface NormalizationRow {
  id: string;
  stars: number;
  growth7d: number;
  growth30d: number | null;
  velocity7d: number;
  accelerationRatio: number | null;
  /** Largest single day's share of the last seven days' growth, in [0, 1]. */
  spikeShare: number;
  /** Days of star history available at the evaluation date. */
  historyDays: number;
}

export interface NormalizationParams {
  algorithm: NormalizationAlgorithm;
  metric: RankMetric;
  /** Domain percentile gate, for example 0.98 = top 2% of the domain. */
  domainPercentile: number;
  /** Peer percentile gate within the size band, for example 0.97. */
  bandPercentile: number;
  /** Absolute floors so a percentile on tiny numbers cannot flag a quiet repository. */
  minGrowth7d: number;
  minBandGrowth7d: number;
  /** Acceleration test shared with production (RISING needs a ratio of at least this). */
  minAcceleration: number;
  maxSpikeShare: number;
  minHistoryDays: number;
  /** Upper bounds (exclusive) of the size bands in stars, ascending; the last band is open. Empty = a single band. */
  bandBounds: number[];
  /** Bands with fewer peers than this fall back to the domain percentile. */
  minPeers: number;
}

export interface NormalizedResult {
  id: string;
  /** Mid-rank percentile of the rank metric among the domain, in [0, 1]. */
  domainPercentile: number;
  bandIndex: number;
  /** Percentile among repositories in the same size band, in [0, 1]. */
  bandPercentile: number;
  bandPeers: number;
  flagged: boolean;
  /** Which gates passed, for deterministic explanations. */
  via: 'domain' | 'band' | 'both' | 'raw' | null;
}

/** Mid-rank percentile: share of values below x plus half the share equal to x. Ties therefore never favour one repository. */
export function percentileRank(values: readonly number[], x: number): number {
  if (values.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below += 1;
    else if (v === x) equal += 1;
  }
  return (below + equal / 2) / values.length;
}

/** Nearest-rank quantile of an unsorted list (p in [0, 1]); the smallest value v such that at least p of the list is <= v. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[Math.min(s.length, rank) - 1] as number;
}

/** Band boundaries from the population itself: `n` equal-count bands. Deterministic; empty population gives no bounds. */
export function quantileBounds(stars: readonly number[], n: number): number[] {
  if (n <= 1 || stars.length === 0) return [];
  const out: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const b = quantile(stars, i / n);
    if (out.length === 0 || b > (out[out.length - 1] as number)) out.push(b);
  }
  return out;
}

export function bandIndexOf(stars: number, bounds: readonly number[]): number {
  let i = 0;
  while (i < bounds.length && stars >= (bounds[i] as number)) i += 1;
  return i;
}

function metricOf(r: NormalizationRow, metric: RankMetric): number {
  if (metric === 'g7') return r.growth7d;
  if (metric === 'g30') return r.growth30d ?? 0;
  // blend: the weekly growth and the weekly-equivalent of the 30-day growth, so one burst cannot carry the rank alone
  return (r.growth7d + ((r.growth30d ?? 0) * 7) / 30) / 2;
}

/**
 * Evaluate one domain population at one evaluation date. Rows must contain only data observable at that date (the caller's job; see
 * the leakage audit). Output order follows input order.
 */
export function normalize(rows: readonly NormalizationRow[], p: NormalizationParams): NormalizedResult[] {
  const metric = rows.map((r) => metricOf(r, p.metric));
  const bands = rows.map((r) => bandIndexOf(r.stars, p.bandBounds));
  const byBand = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const b = bands[i] as number;
    byBand.set(b, [...(byBand.get(b) ?? []), metric[i] as number]);
  });
  const domainCut = Math.max(p.minGrowth7d, quantile(metric, p.domainPercentile));
  const bandCut = new Map<number, number>();
  for (const [b, vals] of byBand) bandCut.set(b, Math.max(p.minBandGrowth7d, quantile(vals, p.bandPercentile)));

  return rows.map((r, i) => {
    const m = metric[i] as number;
    const b = bands[i] as number;
    const peers = byBand.get(b) as number[];
    const durable = (r.accelerationRatio ?? 0) >= p.minAcceleration && r.spikeShare <= p.maxSpikeShare && r.historyDays >= p.minHistoryDays;
    let via: NormalizedResult['via'] = null;
    if (p.algorithm === 'raw') {
      // production-shaped absolute gates, no population information
      if (r.velocity7d >= 100 && r.growth7d >= 700 && (r.accelerationRatio ?? 0) >= p.minAcceleration) via = 'raw';
    } else {
      const inDomain = m >= domainCut && r.growth7d >= p.minGrowth7d;
      const enoughPeers = peers.length >= p.minPeers;
      const inBand = (enoughPeers ? m >= (bandCut.get(b) as number) : m >= domainCut) && r.growth7d >= p.minBandGrowth7d;
      const d = (p.algorithm === 'domain' || p.algorithm === 'hybrid') && inDomain;
      const bd = (p.algorithm === 'band' || p.algorithm === 'hybrid') && inBand;
      if (durable && (d || bd)) via = d && bd ? 'both' : d ? 'domain' : 'band';
    }
    return {
      id: r.id,
      domainPercentile: percentileRank(metric, m),
      bandIndex: b,
      bandPercentile: percentileRank(peers, m),
      bandPeers: peers.length,
      flagged: via !== null,
      via,
    };
  });
}
