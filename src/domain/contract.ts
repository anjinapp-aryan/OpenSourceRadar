/**
 * Phase 6.3 data contract: the ADDITIVE, optional fields a repository record may carry for domain-aware consumers. Existing
 * `radar.json` consumers ignore unknown keys, so no `schemaVersion` change is needed; the fields are not written to the public data in
 * Phase 6.3 (see docs/PHASE-6.3-VALIDATION.md): this module defines and tests the contract and builds the fields from stored facts.
 *
 * Measured -> derived -> interpretation:
 *   measured       stars, growth7d/30d/90d, ageDays, language           (already in the record)
 *   derived        domain, areas, technologies, facets, percentiles      (this contract; pure functions of measured facts)
 *   interpretation `explanation` sentences                               (rendered from the derived numbers, never from a model)
 */
import { explainDomainMomentum, type DomainMomentumFacts } from '../explain/domainExplain';
import type { NormalizationParams, NormalizedResult } from '../momentum/normalize';
import type { RecordTaxonomy } from '../taxonomy';
import type { RadarDomain } from './index';

/** Keys a record MAY add. Order is the serialisation order. */
export const DOMAIN_RECORD_KEYS = ['domain', 'areas', 'technologies', 'facets', 'domainMomentum', 'engineeringLifecycle'] as const;
export type DomainRecordKey = (typeof DOMAIN_RECORD_KEYS)[number];

export interface DomainMomentumFields {
  /** `absolute` = the production rules decide (AI). `normalized` = the domain adapter decides. */
  mode: 'absolute' | 'normalized';
  /** Peer-relative flag: only present in `normalized` mode. */
  trending: boolean;
  via: 'domain' | 'band' | 'both' | null;
  /** Integer percentiles (0-100) among the domain and among the repository's size band. */
  domainPercentile: number | null;
  bandPercentile: number | null;
  band: { index: number; label: string; peers: number } | null;
  explanation: string[];
}

/** Engineering lifecycle flags (Phase 6.3.1, docs/PHASE-6.3.1-LIFECYCLE-SEMANTICS.md). Booleans plus two dates; every value is derivable from stored numbers. */
export interface EngineeringLifecycleFields {
  trending: boolean;
  rising: boolean;
  accelerating: boolean;
  breakout: boolean;
  cooling: boolean;
  sustained: boolean;
  newToRadar: boolean;
  genuinelyNew: boolean;
  /** UTC date the repository first appeared in the published Radar. */
  firstPublishedAt: string | null;
}

export const LIFECYCLE_KEYS = ['trending', 'rising', 'accelerating', 'breakout', 'cooling', 'sustained', 'newToRadar', 'genuinelyNew', 'firstPublishedAt'] as const;

export interface DomainRecordFields {
  domain: RadarDomain | null;
  areas: string[];
  technologies: string[];
  facets: RecordTaxonomy['facets'];
  domainMomentum: DomainMomentumFields;
  engineeringLifecycle?: EngineeringLifecycleFields;
}

export function bandLabel(bounds: readonly number[], index: number): string {
  const f = (n: number) => n.toLocaleString('en-US');
  if (bounds.length === 0) return 'all sizes';
  if (index <= 0) return `under ${f(bounds[0] as number)} stars`;
  if (index >= bounds.length) return `${f(bounds[bounds.length - 1] as number)}+ stars`;
  return `${f(bounds[index - 1] as number)}-${f((bounds[index] as number) - 1)} stars`;
}

export function domainMomentumFields(domain: RadarDomain, params: NormalizationParams | null, result: NormalizedResult | null, facts: Omit<DomainMomentumFacts, 'domain' | 'via' | 'domainPercentile' | 'bandPercentile' | 'bandLabel' | 'bandPeers' | 'domainGate' | 'bandGate'>): DomainMomentumFields {
  if (!params || !result) return { mode: 'absolute', trending: false, via: null, domainPercentile: null, bandPercentile: null, band: null, explanation: [] };
  const label = bandLabel(params.bandBounds, result.bandIndex);
  const via = result.via === 'domain' || result.via === 'band' || result.via === 'both' ? result.via : null;
  const f: DomainMomentumFacts = { ...facts, domain, via, domainGate: params.domainPercentile, bandGate: params.bandPercentile, domainPercentile: result.domainPercentile, bandPercentile: result.bandPercentile, bandLabel: label, bandPeers: result.bandPeers };
  return {
    mode: 'normalized',
    trending: result.flagged,
    via,
    domainPercentile: Math.round(result.domainPercentile * 100),
    bandPercentile: Math.round(result.bandPercentile * 100),
    band: { index: result.bandIndex, label, peers: result.bandPeers },
    explanation: result.flagged ? explainDomainMomentum(f) : [],
  };
}
