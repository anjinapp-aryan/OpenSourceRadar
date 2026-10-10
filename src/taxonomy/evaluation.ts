/**
 * Phase 6.3.1: taxonomy quality metrics from a LABELLED sample. Pure and deterministic. Precision and recall are always reported
 * together, per level (domain, area, technology, learning content), with the raw counts (true positives, false positives, false
 * negatives, ambiguous) and a Wilson 95% interval, weighted back to the population by the sampling weights. Nothing is estimated from
 * fewer than the labels actually supplied: with no labels, every metric is null.
 */
export type Tri = 'YES' | 'NO' | 'UNCERTAIN';
export const REPO_TYPES = ['library', 'framework', 'tool', 'infrastructure', 'application', 'educational', 'other'] as const;
export type RepoType = (typeof REPO_TYPES)[number];

export interface HumanLabel {
  id: string;
  /** Is this an Engineering repository (software an engineer would evaluate, in the Engineering domain)? */
  domainEngineering: Tri;
  /** Zero or more taxonomy area slugs. Empty with domainEngineering YES means "no area fits". */
  areas: string[];
  /** Zero or more technology slugs; several when several are genuinely present. */
  technologies: string[];
  learning: Tri;
  type: RepoType | null;
  notes?: string;
}

export interface Prediction {
  id: string;
  /** Predicted Engineering (v1 ENGINEERING or BOTH). UNKNOWN and AI count as "not Engineering". */
  domainEngineering: boolean;
  predictedUnknown: boolean;
  areas: string[];
  technologies: string[];
  learning: boolean;
  /** Sampling weight: population units this sampled repository stands for (stratum size / sampled in stratum). */
  weight: number;
  stratum: string;
}

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  /** Predicted and labelled both negative (only meaningful for binary levels). */
  tn: number;
  ambiguous: number;
}

export interface Interval {
  /** The point estimate: weighted to the population when sampling weights are supplied. */
  rate: number;
  /** The unweighted rate on the labelled sample itself (what the interval width is computed from). */
  rawRate?: number;
  low: number;
  high: number;
  n: number;
}

export interface LevelMetrics {
  /** Unweighted counts over the labelled sample (what was actually observed). */
  counts: Counts;
  /** Weighted counts (estimated population units). */
  weighted: { tp: number; fp: number; fn: number };
  precision: Interval | null;
  recall: Interval | null;
}

export function wilson(k: number, n: number): Interval | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: +p.toFixed(4), low: +Math.max(0, c - h).toFixed(4), high: +Math.min(1, c + h).toFixed(4), n };
}

const empty = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0, ambiguous: 0 });

function finish(c: Counts, w: { tp: number; fp: number; fn: number }): LevelMetrics {
  // Interval width comes from the raw sample counts; the point rate is the weighted one.
  const wp = w.tp + w.fp > 0 ? w.tp / (w.tp + w.fp) : null;
  const wr = w.tp + w.fn > 0 ? w.tp / (w.tp + w.fn) : null;
  const p = wilson(c.tp, c.tp + c.fp);
  const r = wilson(c.tp, c.tp + c.fn);
  return {
    counts: c,
    weighted: { tp: +w.tp.toFixed(2), fp: +w.fp.toFixed(2), fn: +w.fn.toFixed(2) },
    precision: p && wp !== null ? { ...p, rawRate: p.rate, rate: +wp.toFixed(4) } : p,
    recall: r && wr !== null ? { ...r, rawRate: r.rate, rate: +wr.toFixed(4) } : r,
  };
}

/** Binary level: predicted flag vs a Tri label. UNCERTAIN labels are counted as ambiguous and excluded from the metrics. */
function binary(rows: { pred: boolean; label: Tri; weight: number }[]): LevelMetrics {
  const c = empty();
  const w = { tp: 0, fp: 0, fn: 0 };
  for (const r of rows) {
    if (r.label === 'UNCERTAIN') {
      c.ambiguous += 1;
      continue;
    }
    const truth = r.label === 'YES';
    if (r.pred && truth) { c.tp += 1; w.tp += r.weight; }
    else if (r.pred && !truth) { c.fp += 1; w.fp += r.weight; }
    else if (!r.pred && truth) { c.fn += 1; w.fn += r.weight; }
    else c.tn += 1;
  }
  return finish(c, w);
}

/** Multi-label level (areas, technologies): micro-averaged over labelled Engineering repositories, plus predicted labels on labelled non-Engineering ones (all false positives). */
function multi(rows: { pred: string[]; truth: string[]; weight: number; ambiguous: boolean }[]): LevelMetrics {
  const c = empty();
  const w = { tp: 0, fp: 0, fn: 0 };
  for (const r of rows) {
    if (r.ambiguous) {
      c.ambiguous += 1;
      continue;
    }
    const pred = new Set(r.pred);
    const truth = new Set(r.truth);
    for (const p of pred) {
      if (truth.has(p)) { c.tp += 1; w.tp += r.weight; }
      else { c.fp += 1; w.fp += r.weight; }
    }
    for (const t of truth) if (!pred.has(t)) { c.fn += 1; w.fn += r.weight; }
  }
  return finish(c, w);
}

export interface TaxonomyEvaluation {
  labelled: number;
  validLabels: number;
  invalidLabels: number;
  domain: LevelMetrics;
  area: LevelMetrics;
  technology: LevelMetrics;
  learning: LevelMetrics;
  /** Weighted share of the sampled frame the classifier left UNKNOWN. */
  unknownRate: number | null;
  /** Among repositories labelled Engineering YES, the share predicted UNKNOWN (missed because unclassified). */
  unknownAmongEngineering: Interval | null;
  perTechnology: Record<string, { predicted: number; tp: number; fp: number; labelled: number; fn: number; precision: Interval | null; recall: Interval | null }>;
  perArea: Record<string, { predicted: number; tp: number; fp: number; labelled: number; fn: number; precision: Interval | null; recall: Interval | null }>;
  typeCounts: Record<string, number>;
  problemCases: { id: string; kind: 'domain-fp' | 'domain-fn' | 'area-fp' | 'area-fn' | 'tech-fp' | 'tech-fn' | 'learning-fp' | 'learning-fn'; detail: string }[];
}

export interface LabelValidation {
  valid: HumanLabel[];
  invalid: { id: string; reason: string }[];
}

/** A label is valid when it is complete and consistent; anything else is reported, not silently repaired. */
export function validateLabels(labels: readonly HumanLabel[], knownAreas: ReadonlySet<string>, knownTechs: ReadonlySet<string>): LabelValidation {
  const valid: HumanLabel[] = [];
  const invalid: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    const bad = (reason: string) => invalid.push({ id: l.id, reason });
    if (!l.id) { bad('missing id'); continue; }
    if (seen.has(l.id)) { bad('duplicate id'); continue; }
    seen.add(l.id);
    if (!['YES', 'NO', 'UNCERTAIN'].includes(l.domainEngineering)) { bad('domainEngineering must be YES, NO or UNCERTAIN'); continue; }
    if (!['YES', 'NO', 'UNCERTAIN'].includes(l.learning)) { bad('learning must be YES, NO or UNCERTAIN'); continue; }
    if (l.type !== null && !(REPO_TYPES as readonly string[]).includes(l.type)) { bad(`unknown repository type ${String(l.type)}`); continue; }
    const badArea = l.areas.find((a) => !knownAreas.has(a));
    if (badArea) { bad(`unknown area ${badArea}`); continue; }
    const badTech = l.technologies.find((t) => !knownTechs.has(t));
    if (badTech) { bad(`unknown technology ${badTech}`); continue; }
    if (l.domainEngineering === 'NO' && (l.areas.length > 0 || l.technologies.length > 0)) { bad('areas/technologies given for a repository labelled not Engineering'); continue; }
    if (l.type === null) { bad('type is required'); continue; }
    valid.push(l);
  }
  return { valid, invalid };
}

export function evaluateTaxonomy(labels: readonly HumanLabel[], predictions: readonly Prediction[], total: { labelled: number; invalid: number }): TaxonomyEvaluation {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const rows = labels.filter((l) => byId.has(l.id)).map((l) => ({ l, p: byId.get(l.id)! }));
  const problems: TaxonomyEvaluation['problemCases'] = [];
  const domain = binary(rows.map(({ l, p }) => ({ pred: p.domainEngineering, label: l.domainEngineering, weight: p.weight })));
  const area = multi(rows.map(({ l, p }) => ({ pred: p.areas, truth: l.areas, weight: p.weight, ambiguous: l.domainEngineering === 'UNCERTAIN' })));
  const technology = multi(rows.map(({ l, p }) => ({ pred: p.technologies, truth: l.technologies, weight: p.weight, ambiguous: l.domainEngineering === 'UNCERTAIN' })));
  const learning = binary(rows.map(({ l, p }) => ({ pred: p.learning, label: l.learning, weight: p.weight })));

  const perTechnology: TaxonomyEvaluation['perTechnology'] = {};
  const perArea: TaxonomyEvaluation['perArea'] = {};
  const bump = (m: TaxonomyEvaluation['perTechnology'], key: string, field: 'predicted' | 'tp' | 'fp' | 'labelled' | 'fn') => {
    m[key] ??= { predicted: 0, tp: 0, fp: 0, labelled: 0, fn: 0, precision: null, recall: null };
    m[key]![field] += 1;
  };
  for (const { l, p } of rows) {
    if (l.domainEngineering === 'UNCERTAIN') continue;
    for (const [predList, truthList, table, kind] of [[p.technologies, l.technologies, perTechnology, 'tech'], [p.areas, l.areas, perArea, 'area']] as const) {
      const truth = new Set(truthList);
      const pred = new Set(predList);
      for (const x of pred) {
        bump(table, x, 'predicted');
        if (truth.has(x)) bump(table, x, 'tp');
        else {
          bump(table, x, 'fp');
          problems.push({ id: l.id, kind: kind === 'tech' ? 'tech-fp' : 'area-fp', detail: `predicted ${x}; labelled [${truthList.join(', ') || 'none'}]` });
        }
      }
      for (const x of truth) {
        bump(table, x, 'labelled');
        if (!pred.has(x)) {
          bump(table, x, 'fn');
          problems.push({ id: l.id, kind: kind === 'tech' ? 'tech-fn' : 'area-fn', detail: `labelled ${x}; predicted [${predList.join(', ') || 'none'}]` });
        }
      }
    }
    if (p.domainEngineering && l.domainEngineering === 'NO') problems.push({ id: l.id, kind: 'domain-fp', detail: 'predicted Engineering, labelled not Engineering' });
    if (!p.domainEngineering && l.domainEngineering === 'YES') problems.push({ id: l.id, kind: 'domain-fn', detail: `labelled Engineering, predicted ${p.predictedUnknown ? 'UNKNOWN' : 'not Engineering'}` });
    if (p.learning && l.learning === 'NO') problems.push({ id: l.id, kind: 'learning-fp', detail: 'flagged learning content, labelled not' });
    if (!p.learning && l.learning === 'YES') problems.push({ id: l.id, kind: 'learning-fn', detail: 'labelled learning content, not flagged' });
  }
  for (const t of [perTechnology, perArea]) {
    for (const v of Object.values(t)) {
      v.precision = wilson(v.tp, v.tp + v.fp);
      v.recall = wilson(v.tp, v.tp + v.fn);
    }
  }
  const wAll = rows.reduce((a, { p }) => a + p.weight, 0);
  const wUnknown = rows.reduce((a, { p }) => a + (p.predictedUnknown ? p.weight : 0), 0);
  const engYes = rows.filter(({ l }) => l.domainEngineering === 'YES');
  const typeCounts: Record<string, number> = {};
  for (const { l } of rows) if (l.type) typeCounts[l.type] = (typeCounts[l.type] ?? 0) + 1;
  return {
    labelled: total.labelled,
    validLabels: rows.length,
    invalidLabels: total.invalid,
    domain,
    area,
    technology,
    learning,
    unknownRate: wAll > 0 ? +(wUnknown / wAll).toFixed(4) : null,
    unknownAmongEngineering: wilson(engYes.filter(({ p }) => p.predictedUnknown).length, engYes.length),
    perTechnology,
    perArea,
    typeCounts,
    problemCases: problems,
  };
}

/** Cohen's kappa for two raters on the same items (categorical labels). Null when undefined (no items, or chance agreement is 1). */
export function cohensKappa(a: readonly string[], b: readonly string[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  const observed = a.filter((x, i) => x === b[i]).length / n;
  let expected = 0;
  for (const c of cats) expected += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  if (expected === 1) return null;
  return +((observed - expected) / (1 - expected)).toFixed(4);
}

/** Verdict on one technology from its labelled evidence (the thresholds are declared in docs/PHASE-6.3.1-TAXONOMY-VALIDATION.md). */
export function technologyVerdict(v: { predicted: number; tp: number; fp: number; labelled: number; fn: number }, minEvidence = 5): 'useful' | 'too-broad' | 'too-narrow' | 'ambiguous' | 'insufficient-evidence' {
  if (v.predicted + v.labelled < minEvidence) return 'insufficient-evidence';
  const precision = v.predicted > 0 ? v.tp / v.predicted : null;
  const recall = v.labelled > 0 ? v.tp / v.labelled : null;
  if (precision !== null && precision < 0.6) return 'too-broad';
  if (recall !== null && recall < 0.5 && v.labelled >= 3) return 'too-narrow';
  if (precision !== null && precision >= 0.8 && (recall === null || recall >= 0.7)) return 'useful';
  return 'ambiguous';
}
