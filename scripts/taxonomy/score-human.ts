/**
 * Phase 6.3.2: score two independent human labelers' completed sheets against the system (sample key).
 *
 *   tsx scripts/taxonomy/score-human.ts --a <A.csv> --rater-a <name> --b <B.csv> --rater-b <name> [--adjudicated <csv>] [--key results/phase6.3.1/labelling/sample-key.json] [--scope engineering-only|engineering-or-both] [--out results/phase6.3.2/human/scores-human.json]
 *
 * Real evidence only. The output is stamped `REAL HUMAN EVIDENCE` and is written only if the independence checks pass and each rater has at least
 * 200 valid rows; otherwise it exits non-zero and the status stays PENDING. Synthetic data is never accepted here (tests use the pure functions).
 * Methodology and thresholds: docs/PHASE-6.3.2-HUMAN-TAXONOMY.md (declared before any real label existed).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadTaxonomyV2 } from '../../src/taxonomy';
import { csvRecords } from '../../src/taxonomy/csv';
import { evaluateTaxonomy, technologyVerdict, validateLabels, type Prediction, type RepoType, type Tri } from '../../src/taxonomy/evaluation';
import { agreement, consensus, f1, independenceProblems, projectTechnologies, type Confidence, type RaterLabel } from '../../src/taxonomy/humanValidation';

const argv = process.argv.slice(2);
const arg = (n: string, d: string | null) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const need = (n: string) => { const v = arg(n, null); if (!v) throw new Error(`${n} is required`); return v; };
const pathA = need('--a'), pathB = need('--b'), raterA = need('--rater-a'), raterB = need('--rater-b');
const adjPath = arg('--adjudicated', null);
const keyPath = arg('--key', 'results/phase6.3.1/labelling/sample-key.json') as string;
const scope = arg('--scope', 'engineering-only') as string;
if (scope !== 'engineering-only' && scope !== 'engineering-or-both') throw new Error('--scope must be engineering-only or engineering-or-both');
const outPath = arg('--out', 'results/phase6.3.2/human/scores-human.json') as string;
const MIN_VALID = 200;

const tax = loadTaxonomyV2();
const areaSlugs = tax.engineeringAreas.map((a) => a.slug);
const techSlugs = tax.technologies.map((t) => t.slug);
const split = (s: string) => s.split(/[;,]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function load(path: string): { labelled: RaterLabel[]; blank: number } {
  const labelled: RaterLabel[] = [];
  let blank = 0;
  for (const r of csvRecords(readFileSync(path, 'utf8'))) {
    if (!r.domainEngineering && !r.learning && !r.type) { blank += 1; continue; }
    labelled.push({ id: r.id as string, domainEngineering: (r.domainEngineering ?? '').trim().toUpperCase() as Tri, areas: split(r.areas ?? ''), technologies: split(r.technologies ?? ''), technologiesUsed: split(r.technologiesUsed ?? ''), learning: (r.learning ?? '').trim().toUpperCase() as Tri, confidence: ((r.confidence ?? '').trim().toUpperCase() || null) as Confidence | null, type: ((r.type ?? '').trim().toLowerCase() || null) as RepoType | null, notes: r.notes });
  }
  return { labelled, blank };
}
const validate = (labelled: RaterLabel[]) => {
  const { valid, invalid } = validateLabels(labelled, new Set(areaSlugs), new Set(techSlugs));
  const ok = new Set(valid.map((v) => v.id));
  // a touched technology must exist and the primary ones must be a subset of the touched ones; otherwise the row is invalid and reported
  const extra: { id: string; reason: string }[] = [];
  const kept = labelled.filter((l) => {
    if (!ok.has(l.id)) return false;
    const unknown = l.technologiesUsed.filter((t) => !techSlugs.includes(t));
    if (unknown.length) { extra.push({ id: l.id, reason: `unknown technologiesUsed slug: ${unknown.join(',')}` }); return false; }
    return true;
  });
  return { kept, invalid: [...invalid, ...extra] };
};

const A = load(pathA), B = load(pathB);
const va = validate(A.labelled), vb = validate(B.labelled);
const problems = independenceProblems(raterA, raterB, va.kept, vb.kept);
const status = { raterA: { validRows: va.kept.length, invalid: va.invalid.length, blank: A.blank }, raterB: { validRows: vb.kept.length, invalid: vb.invalid.length, blank: B.blank } };
if (problems.length) { console.error(JSON.stringify({ status: 'PENDING', reason: 'independence', problems })); process.exit(2); }
if (va.kept.length < MIN_VALID || vb.kept.length < MIN_VALID) { console.error(JSON.stringify({ status: 'PENDING', reason: `each rater needs at least ${MIN_VALID} valid rows`, ...status })); process.exit(3); }

const key = JSON.parse(readFileSync(keyPath, 'utf8')) as { items: { id: string; stratum: string; weight: number; prediction: { topLevel: string; predictedUnknown: boolean; areas: string[]; technologies: string[]; learning: boolean } }[] };
const inScope = (top: string) => (scope === 'engineering-only' ? top === 'ENGINEERING' : top === 'ENGINEERING' || top === 'BOTH');
const predictions: Prediction[] = key.items.map((i) => { const on = inScope(i.prediction.topLevel); return { id: i.id, domainEngineering: on, predictedUnknown: i.prediction.predictedUnknown, areas: on ? i.prediction.areas : [], technologies: on ? i.prediction.technologies : [], learning: i.prediction.learning, weight: i.weight, stratum: i.stratum }; });

const ag = agreement(va.kept, vb.kept, areaSlugs, techSlugs);
const adjudicated = adjPath ? validate(load(adjPath).labelled).kept : [];
const cons = consensus(va.kept, vb.kept, adjudicated);

const score = (labels: RaterLabel[], definition: 'primary' | 'touches') => {
  const proj = projectTechnologies(labels, definition);
  const ev = evaluateTaxonomy(proj, predictions, { labelled: labels.length, invalid: 0 });
  return { ev, perTechnology: Object.fromEntries(techSlugs.map((t) => [t, { ...(ev.perTechnology[t] ?? { predicted: 0, tp: 0, fp: 0, labelled: 0, fn: 0, precision: null, recall: null }), verdict: technologyVerdict(ev.perTechnology[t] ?? { predicted: 0, tp: 0, fp: 0, labelled: 0, fn: 0 }) }])) };
};
const view = (labels: RaterLabel[]) => {
  const primary = score(labels, 'primary');
  const touches = score(labels, 'touches');
  const e = primary.ev;
  return {
    rows: labels.length,
    domain: { ...e.domain, f1: f1(e.domain) }, area: { ...e.area, f1: f1(e.area) }, learning: { ...e.learning, f1: f1(e.learning) }, unknownRate: e.unknownRate, unknownAmongEngineering: e.unknownAmongEngineering,
    technology: { definition: 'primary (Option B labels)', ...e.technology, f1: f1(e.technology) },
    technologySemantics: {
      note: 'The same system tags are scored against both label definitions; the decision rule is declared in docs/PHASE-6.3.2-TECHNOLOGY-SEMANTICS.md',
      touchesOptionA: { ...touches.ev.technology, f1: f1(touches.ev.technology), falsePositives: touches.ev.problemCases.filter((p) => p.kind === 'tech-fp'), falseNegatives: touches.ev.problemCases.filter((p) => p.kind === 'tech-fn') },
      primaryOptionB: { ...primary.ev.technology, f1: f1(primary.ev.technology), falsePositives: primary.ev.problemCases.filter((p) => p.kind === 'tech-fp'), falseNegatives: primary.ev.problemCases.filter((p) => p.kind === 'tech-fn') },
    },
    perTechnologyPrimary: primary.perTechnology,
    perTechnologyTouches: touches.perTechnology,
    perArea: e.perArea,
    problemCases: e.problemCases,
  };
};

const out = {
  evidence: 'REAL HUMAN EVIDENCE',
  scope,
  raters: { a: raterA, b: raterB },
  files: { a: pathA, b: pathB, adjudicated: adjPath },
  status,
  invalid: { a: va.invalid, b: vb.invalid },
  agreement: ag,
  consensus: { agreedRows: cons.agreedRows, adjudicatedRows: cons.adjudicatedRows, unresolvedRows: cons.unresolvedIds.length, unresolvedIds: cons.unresolvedIds },
  systemVsRaterA: view(va.kept),
  systemVsRaterB: view(vb.kept),
  systemVsConsensus: view(cons.labels),
  coverage: { sampleRows: key.items.length, bothRatersLabelled: ag.rowsBoth, consensusRows: cons.labels.length },
  confidence: { a: tally(va.kept.map((l) => l.confidence)), b: tally(vb.kept.map((l) => l.confidence)) },
};
function tally(xs: (string | null)[]) { const m: Record<string, number> = {}; for (const x of xs) m[x ?? 'none'] = (m[x ?? 'none'] ?? 0) + 1; return m; }
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ evidence: out.evidence, rows: ag.rowsBoth, kappa: { domain: ag.domain.kappa, learning: ag.learning.kappa, areas: ag.areas.kappa, technologies: ag.technologies.kappa, technologiesUsed: ag.technologiesUsed.kappa }, disagreementRate: ag.disagreementRate, consensus: out.consensus, out: outPath }, null, 1));
