/**
 * Phase 6.3.2: two-rater human validation of the Engineering taxonomy. Pure functions; no I/O. Methodology and thresholds are declared in
 * docs/PHASE-6.3.2-HUMAN-TAXONOMY.md BEFORE any real label exists and are not changed afterwards.
 *
 * Nothing here invents a label: a row a rater left blank is skipped and counted, a disagreement is reported (never averaged), and a row without
 * both raters' complete labels never enters the consensus unless an adjudicated label for it is supplied.
 */
import { cohensKappa, type HumanLabel, type Interval, type LevelMetrics, type Tri } from './evaluation';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** A rater's label. `technologies` = primarily ABOUT the technology; `technologiesUsed` = touches/uses it (superset, may include the primary ones). */
export interface RaterLabel extends HumanLabel {
  technologiesUsed: string[];
  confidence: Confidence | null;
}

export const KAPPA_BANDS = { substantial: 0.61, moderate: 0.41 } as const;

/** Declared reading of a kappa value (Landis and Koch bands, collapsed to three). */
export function kappaBand(k: number | null): 'substantial-or-better' | 'moderate' | 'low' | 'undefined' {
  if (k === null) return 'undefined';
  if (k >= KAPPA_BANDS.substantial) return 'substantial-or-better';
  if (k >= KAPPA_BANDS.moderate) return 'moderate';
  return 'low';
}

const setEq = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * Pooled binary kappa for a multi-label field: every (row, slug) pair is one binary decision (slug present or not); the slug universe is the
 * union of slugs either rater used plus `universe` (so absent slugs count as agreement, as they are in the taxonomy). Null when degenerate.
 */
export function pooledSetKappa(a: readonly (readonly string[])[], b: readonly (readonly string[])[], universe: readonly string[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const xs: string[] = [];
  const ys: string[] = [];
  for (let i = 0; i < a.length; i += 1) {
    const sa = new Set(a[i]);
    const sb = new Set(b[i]);
    for (const u of universe) {
      xs.push(sa.has(u) ? '1' : '0');
      ys.push(sb.has(u) ? '1' : '0');
    }
  }
  return cohensKappa(xs, ys);
}

export interface FieldAgreement {
  kappa: number | null;
  band: ReturnType<typeof kappaBand>;
  /** Share of rows on which the two raters gave exactly the same value (or the same set). */
  exactMatch: number | null;
}

export interface Agreement {
  rowsBoth: number;
  domain: FieldAgreement;
  learning: FieldAgreement;
  type: FieldAgreement;
  areas: FieldAgreement;
  technologies: FieldAgreement;
  technologiesUsed: FieldAgreement;
  /** Share of rows with at least one disagreement among domain, learning, areas, technologies. */
  disagreementRate: number | null;
  /** Share of each rater's rows labelled UNCERTAIN (domain), and the share of rows either rater called UNCERTAIN. */
  uncertainDomain: { a: number | null; b: number | null; either: number | null };
  disagreementIds: string[];
}

const field = (kappa: number | null, matches: number, n: number): FieldAgreement => ({ kappa, band: kappaBand(kappa), exactMatch: n ? +(matches / n).toFixed(4) : null });

export function agreement(a: readonly RaterLabel[], b: readonly RaterLabel[], areaUniverse: readonly string[], techUniverse: readonly string[]): Agreement {
  const bById = new Map(b.map((l) => [l.id, l]));
  const pairs = a.filter((l) => bById.has(l.id)).map((l) => [l, bById.get(l.id)!] as const);
  const n = pairs.length;
  const col = <T,>(f: (l: RaterLabel) => T) => ({ x: pairs.map(([l]) => f(l)), y: pairs.map(([, m]) => f(m)) });
  const str = (f: (l: RaterLabel) => string) => { const { x, y } = col(f); return { x, y, matches: x.filter((v, i) => v === y[i]).length }; };
  const sets = (f: (l: RaterLabel) => string[], universe: readonly string[]) => { const { x, y } = col(f); return field(pooledSetKappa(x, y, universe), x.filter((v, i) => setEq(v, y[i] as string[])).length, n); };
  const d = str((l) => l.domainEngineering);
  const lr = str((l) => l.learning);
  const t = str((l) => l.type ?? '');
  const disagree = pairs.filter(([l, m]) => l.domainEngineering !== m.domainEngineering || l.learning !== m.learning || !setEq(l.areas, m.areas) || !setEq(l.technologies, m.technologies));
  const unc = (xs: readonly RaterLabel[]) => (xs.length ? +(xs.filter((l) => l.domainEngineering === 'UNCERTAIN').length / xs.length).toFixed(4) : null);
  return {
    rowsBoth: n,
    domain: field(cohensKappa(d.x, d.y), d.matches, n),
    learning: field(cohensKappa(lr.x, lr.y), lr.matches, n),
    type: field(cohensKappa(t.x, t.y), t.matches, n),
    areas: sets((l) => l.areas, areaUniverse),
    technologies: sets((l) => l.technologies, techUniverse),
    technologiesUsed: sets((l) => l.technologiesUsed, techUniverse),
    disagreementRate: n ? +(disagree.length / n).toFixed(4) : null,
    uncertainDomain: { a: unc(pairs.map(([l]) => l)), b: unc(pairs.map(([, m]) => m)), either: n ? +(pairs.filter(([l, m]) => l.domainEngineering === 'UNCERTAIN' || m.domainEngineering === 'UNCERTAIN').length / n).toFixed(4) : null },
    disagreementIds: disagree.map(([l]) => l.id),
  };
}

export interface Consensus {
  labels: RaterLabel[];
  agreedRows: number;
  adjudicatedRows: number;
  unresolvedIds: string[];
}

/**
 * Consensus: a row is in the consensus only if both raters gave the same domain, learning, areas, technologies and technologiesUsed, or if an
 * adjudicated label exists for it. The adjudicator must be a person (a third rater or both raters in discussion), never the assistant.
 */
export function consensus(a: readonly RaterLabel[], b: readonly RaterLabel[], adjudicated: readonly RaterLabel[] = []): Consensus {
  const bById = new Map(b.map((l) => [l.id, l]));
  const adj = new Map(adjudicated.map((l) => [l.id, l]));
  const labels: RaterLabel[] = [];
  const unresolvedIds: string[] = [];
  let agreedRows = 0;
  let adjudicatedRows = 0;
  for (const l of a) {
    const m = bById.get(l.id);
    if (!m) continue;
    const same = l.domainEngineering === m.domainEngineering && l.learning === m.learning && setEq(l.areas, m.areas) && setEq(l.technologies, m.technologies) && setEq(l.technologiesUsed, m.technologiesUsed);
    if (same) { labels.push({ ...l, type: l.type === m.type ? l.type : null }); agreedRows += 1; }
    else if (adj.has(l.id)) { labels.push(adj.get(l.id)!); adjudicatedRows += 1; }
    else unresolvedIds.push(l.id);
  }
  return { labels, agreedRows, adjudicatedRows, unresolvedIds };
}

/**
 * Project labels onto one technology definition for scoring.
 *   primary: the technologies the repository is primarily ABOUT (Option B)
 *   touches: every technology the repository touches or uses, which includes the primary ones (Option A)
 */
export function projectTechnologies(labels: readonly RaterLabel[], definition: 'primary' | 'touches'): HumanLabel[] {
  return labels.map((l) => ({ id: l.id, domainEngineering: l.domainEngineering as Tri, areas: l.areas, technologies: definition === 'primary' ? l.technologies : [...new Set([...l.technologies, ...l.technologiesUsed])], learning: l.learning, type: l.type, notes: l.notes }));
}

/** Two raters are independent only if they are different people: different names, and not the same answers. */
export function independenceProblems(raterA: string, raterB: string, a: readonly RaterLabel[], b: readonly RaterLabel[]): string[] {
  const problems: string[] = [];
  if (!raterA.trim() || !raterB.trim()) problems.push('both raters must be named');
  if (raterA.trim().toLowerCase() === raterB.trim().toLowerCase()) problems.push('the two raters have the same name: one person labelling twice is not two independent labelers');
  if (/assistant|claude|gpt|llm|model|bot/i.test(`${raterA} ${raterB}`)) problems.push('a rater name looks like a model or assistant: assistant labels are not human ground truth');
  const bById = new Map(b.map((l) => [l.id, l]));
  const shared = a.filter((l) => bById.has(l.id));
  if (shared.length >= 20 && shared.every((l) => JSON.stringify(l) === JSON.stringify(bById.get(l.id)))) problems.push('the two label files are identical row for row, including notes: they are not independent');
  return problems;
}

const f1Of = (p: number, r: number) => (p + r > 0 ? +((2 * p * r) / (p + r)).toFixed(4) : 0);

/** F1 from a level's precision and recall: weighted (primary) and raw (observed sample). Null when either is undefined. */
export function f1(m: Pick<LevelMetrics, 'precision' | 'recall'>): { weighted: number; raw: number } | null {
  const p: Interval | null = m.precision, r: Interval | null = m.recall;
  if (!p || !r) return null;
  return { weighted: f1Of(p.rate, r.rate), raw: f1Of(p.rawRate ?? p.rate, r.rawRate ?? r.rate) };
}
