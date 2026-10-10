/**
 * Deterministic sentences for the domain-aware layer. Every number printed is a stored number or a fixed function of one; no model, no
 * randomness, no clock. The same facts always give the same text, and a sentence is only produced when its condition is true.
 */
export interface DomainMomentumFacts {
  domain: 'AI' | 'ENGINEERING';
  via: 'domain' | 'band' | 'both' | null;
  /** Mid-rank percentile in [0, 1] among the domain population. */
  domainPercentile: number;
  bandPercentile: number;
  bandLabel: string;
  bandPeers: number;
  growth7d: number;
  growth30d: number | null;
  accelerationRatio: number | null;
  /** Percentile gates that were applied (for "top X%"), for example 0.98 and 0.97. */
  domainGate: number;
  bandGate: number;
  stars: number;
  ageDays: number;
}

const domainName = (d: DomainMomentumFacts['domain']) => (d === 'ENGINEERING' ? 'Engineering' : 'AI');
const n = (v: number) => Math.round(v).toLocaleString('en-US');

/** "top 2%" from a percentile gate of 0.98; never claims better than the gate actually applied. */
export function topPercentLabel(gate: number): string {
  return `top ${Math.round((1 - gate) * 100)}%`;
}

export function explainDomainMomentum(f: DomainMomentumFacts): string[] {
  const out: string[] = [];
  const dom = domainName(f.domain);
  if ((f.via === 'domain' || f.via === 'both') && f.growth30d !== null) {
    out.push(`30-day growth of +${n(f.growth30d)} stars is in the ${topPercentLabel(f.domainGate)} of ${dom} repositories (percentile ${Math.round(f.domainPercentile * 100)}).`);
  }
  if ((f.via === 'band' || f.via === 'both') && f.bandPeers > 0) {
    out.push(`Growth is in the ${topPercentLabel(f.bandGate)} of the ${n(f.bandPeers)} repositories with ${f.bandLabel} (percentile ${Math.round(f.bandPercentile * 100)}), so it is outperforming its size cohort.`);
  }
  if (f.accelerationRatio !== null && f.accelerationRatio >= 1) {
    out.push(`7-day growth is ${f.accelerationRatio.toFixed(1)}x the prior baseline.`);
  }
  if (f.ageDays < 365) out.push(`The repository is ${Math.max(1, Math.round(f.ageDays))} days old.`);
  return out;
}
