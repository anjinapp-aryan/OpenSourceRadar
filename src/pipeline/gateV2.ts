/**
 * Phase 6.3.1: the DESIGNED public-data gate for domain/Engineering fields. SHADOW: nothing in production calls this; the production gate
 * (`gate.ts`) is unchanged and still rejects every one of these keys. This module states, as code and tests, exactly what would have to change.
 *
 * Principle: the allow-list is extended, never loosened. Every new key has a type, a closed value set or a size bound, appears only on the
 * records it is meant for, and passes the same secret/path/localhost checks as everything else. Anything not documented here is rejected.
 *
 * What would change in the production gate (nothing else):
 *   1. radar.json top level: ONE optional key, `domainContractVersion` (integer 1).
 *   2. radar.json records: six optional keys (`DOMAIN_RECORD_KEYS`), allowed only on ENGINEERING records (AI and BOTH records must stay byte-identical).
 *   3. each new value is validated below (types, closed value sets, bounds, safe text).
 */
import { DOMAIN_RECORD_KEYS, LIFECYCLE_KEYS } from '../domain/contract';
import { PUBLIC_RADAR_KEYS, PUBLIC_REPOSITORY_KEYS, publicSchemaProblems, secretShapeProblems } from './gate';

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface GateV2Options {
  knownAreas: ReadonlySet<string>;
  knownTechnologies: ReadonlySet<string>;
  /** Maximum serialised bytes the new keys may add to one record. */
  maxAddedBytesPerRecord: number;
  maxExplanationLength: number;
  maxExplanationSentences: number;
}

export const DEFAULT_GATE_V2: Pick<GateV2Options, 'maxAddedBytesPerRecord' | 'maxExplanationLength' | 'maxExplanationSentences'> = { maxAddedBytesPerRecord: 1024, maxExplanationLength: 240, maxExplanationSentences: 4 };

const AGE_BANDS = new Set(['emerging', 'growing', 'established', 'mature']);
const CONTENT_TYPES = new Set(['software', 'learning']);
const VIA = new Set(['domain', 'band', 'both']);
const DOMAINS = new Set(['AI', 'ENGINEERING']);
const MOMENTUM_KEYS = ['mode', 'trending', 'via', 'domainPercentile', 'bandPercentile', 'band', 'explanation'] as const;
const FACET_KEYS = ['language', 'ageBand', 'contentType'] as const;
const BAND_KEYS = ['index', 'label', 'peers'] as const;
/** Anything that looks like an internal path, a local URL, a synthetic fixture or an experimental marker. */
const UNSAFE_TEXT = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|localhost|127\.0\.0\.1|\.pipeline|_synthetic|\bshadow\b|\bexperiment)/i;

function unexpected(o: Rec, allowed: readonly string[]): string[] {
  return Object.keys(o).filter((k) => !allowed.includes(k));
}

function momentumProblems(m: unknown, id: string, o: GateV2Options): string[] {
  const p: string[] = [];
  const at = (msg: string) => p.push(`record ${id}: domainMomentum ${msg}`);
  if (!isObj(m)) return [`record ${id}: domainMomentum must be an object`];
  const extra = unexpected(m, MOMENTUM_KEYS);
  if (extra.length) at(`has unexpected key(s): ${extra.join(', ')}`);
  if (m.mode !== 'normalized') at('mode must be "normalized" (absolute-mode records carry no domainMomentum)');
  if (typeof m.trending !== 'boolean') at('trending must be a boolean');
  if (m.via !== null && !(typeof m.via === 'string' && VIA.has(m.via))) at('via must be domain, band, both or null');
  for (const k of ['domainPercentile', 'bandPercentile'] as const) {
    const v = m[k];
    if (v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100)) at(`${k} must be an integer 0-100 or null`);
  }
  if (m.band !== null) {
    if (!isObj(m.band)) at('band must be an object or null');
    else {
      const bx = unexpected(m.band, BAND_KEYS);
      if (bx.length) at(`band has unexpected key(s): ${bx.join(', ')}`);
      if (!(typeof m.band.index === 'number' && Number.isInteger(m.band.index) && m.band.index >= 0 && m.band.index < 8)) at('band.index must be a small non-negative integer');
      if (typeof m.band.label !== 'string' || m.band.label.length > 40 || UNSAFE_TEXT.test(m.band.label)) at('band.label must be short safe text');
      if (!(typeof m.band.peers === 'number' && Number.isInteger(m.band.peers) && m.band.peers >= 0)) at('band.peers must be a non-negative integer');
    }
  }
  if (!Array.isArray(m.explanation)) at('explanation must be a list of sentences');
  else {
    if (m.explanation.length > o.maxExplanationSentences) at(`explanation has more than ${o.maxExplanationSentences} sentences`);
    for (const s of m.explanation) {
      if (typeof s !== 'string' || s.length === 0 || s.length > o.maxExplanationLength) at(`explanation sentences must be 1-${o.maxExplanationLength} characters`);
      else if (UNSAFE_TEXT.test(s) || /https?:\/\//i.test(s)) at('explanation contains unsafe text');
    }
    if (m.trending === false && m.explanation.length > 0) at('explanation is only allowed on a trending record');
  }
  return p;
}

function lifecycleProblems(l: unknown, id: string): string[] {
  const p: string[] = [];
  const at = (msg: string) => p.push(`record ${id}: engineeringLifecycle ${msg}`);
  if (!isObj(l)) return [`record ${id}: engineeringLifecycle must be an object`];
  const extra = unexpected(l, LIFECYCLE_KEYS);
  if (extra.length) at(`has unexpected key(s): ${extra.join(', ')}`);
  for (const k of LIFECYCLE_KEYS) {
    if (k === 'firstPublishedAt') {
      if (l[k] !== null && !(typeof l[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l[k] as string))) at('firstPublishedAt must be YYYY-MM-DD or null');
    } else if (typeof l[k] !== 'boolean') at(`${k} must be a boolean`);
  }
  return p;
}

/**
 * Problems with a radar dataset that carries the domain contract. Includes everything the production gate checks for the original
 * keys (it is called on the dataset with the new keys removed) so the existing rules cannot be bypassed through the new ones.
 */
export function publicSchemaProblemsV2(radar: unknown, history: unknown | null, o: GateV2Options): string[] {
  const problems: string[] = [];
  if (!isObj(radar)) return ['radar.json is not an object'];
  const topExtra = unexpected(radar, [...PUBLIC_RADAR_KEYS, 'domainContractVersion']);
  if (topExtra.length) problems.push(`radar.json has unexpected top-level key(s): ${topExtra.join(', ')}`);
  if ('domainContractVersion' in radar && radar.domainContractVersion !== 1) problems.push('domainContractVersion must be the integer 1');
  const records = Array.isArray(radar.repositories) ? (radar.repositories as unknown[]) : [];
  const stripped: unknown[] = [];
  for (const r of records) {
    if (!isObj(r)) { stripped.push(r); continue; }
    const id = typeof r.id === 'string' ? r.id : '?';
    const added: Rec = {};
    const base: Rec = {};
    for (const [k, v] of Object.entries(r)) ((DOMAIN_RECORD_KEYS as readonly string[]).includes(k) ? added : base)[k] = v;
    stripped.push(base);
    if (Object.keys(added).length === 0) continue;
    const top = isObj(r.classification) ? r.classification.topLevel : null;
    if (top !== 'ENGINEERING') {
      problems.push(`record ${id}: domain fields are only allowed on ENGINEERING records (AI and BOTH records must stay unchanged)`);
      continue;
    }
    if (!/^\d+$/.test(id)) problems.push(`record ${id}: id must be a numeric string`);
    if ('domain' in added && !(typeof added.domain === 'string' && DOMAINS.has(added.domain))) problems.push(`record ${id}: domain must be AI or ENGINEERING`);
    if ('domain' in added && added.domain !== 'ENGINEERING') problems.push(`record ${id}: an ENGINEERING record must have domain ENGINEERING`);
    for (const [key, known] of [['areas', o.knownAreas], ['technologies', o.knownTechnologies]] as const) {
      if (key in added) {
        const v = added[key];
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) problems.push(`record ${id}: ${key} must be a list of strings`);
        else {
          const unknown = (v as string[]).filter((x) => !known.has(x));
          if (unknown.length) problems.push(`record ${id}: ${key} has unknown slug(s): ${unknown.join(', ')}`);
          if (new Set(v as string[]).size !== v.length) problems.push(`record ${id}: ${key} has duplicates`);
        }
      }
    }
    if ('facets' in added) {
      const f = added.facets;
      if (!isObj(f)) problems.push(`record ${id}: facets must be an object`);
      else {
        const fx = unexpected(f, FACET_KEYS);
        if (fx.length) problems.push(`record ${id}: facets has unexpected key(s): ${fx.join(', ')}`);
        if (f.language !== null && typeof f.language !== 'string') problems.push(`record ${id}: facets.language must be a string or null`);
        if (!(typeof f.ageBand === 'string' && AGE_BANDS.has(f.ageBand))) problems.push(`record ${id}: facets.ageBand is invalid`);
        if (!(typeof f.contentType === 'string' && CONTENT_TYPES.has(f.contentType))) problems.push(`record ${id}: facets.contentType is invalid`);
      }
    }
    if ('domainMomentum' in added) problems.push(...momentumProblems(added.domainMomentum, id, o));
    if ('engineeringLifecycle' in added) problems.push(...lifecycleProblems(added.engineeringLifecycle, id));
    const bytes = Buffer.byteLength(JSON.stringify(added));
    if (bytes > o.maxAddedBytesPerRecord) problems.push(`record ${id}: added fields are ${bytes} bytes (limit ${o.maxAddedBytesPerRecord})`);
    // a flag that cannot be true together with another is a bug in the producer, not a display choice
    const lc = added.engineeringLifecycle;
    if (isObj(lc) && lc.rising === true && lc.trending !== true) problems.push(`record ${id}: rising requires trending`);
    if (isObj(lc) && lc.newToRadar === true && lc.firstPublishedAt === null) problems.push(`record ${id}: newToRadar requires firstPublishedAt`);
  }
  // the original keys are checked by the unchanged production rules, on the dataset without the new keys
  const { domainContractVersion: _version, ...rest } = radar;
  void _version;
  problems.push(...publicSchemaProblems({ ...rest, repositories: stripped }, history));
  // secrets, paths and local URLs in the whole serialised dataset
  problems.push(...secretShapeProblems(JSON.stringify(radar), 'radar.json'));
  const text = JSON.stringify(radar);
  if (/_synthetic/.test(text)) problems.push('radar.json contains synthetic test markers');
  void PUBLIC_REPOSITORY_KEYS;
  return problems;
}
