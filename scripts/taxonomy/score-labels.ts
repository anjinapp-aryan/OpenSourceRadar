/**
 * Phase 6.3.1: score a completed labelling sheet against the sample key. Read-only; writes only the report.
 *
 *   tsx scripts/taxonomy/score-labels.ts <labels.csv|labels.json> --kind human|assistant [--rater name] [--key results/phase6.3.1/labelling/sample-key.json] [--out path]
 *
 * `--kind` is mandatory and is stamped into the report: labels written by this tooling's own assistant are NOT independent human labels and
 * the report says so. With zero valid labels every metric is null; nothing is inferred.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { csvRecords } from '../../src/taxonomy/csv';
import { evaluateTaxonomy, technologyVerdict, validateLabels, type HumanLabel, type Prediction, type RepoType, type Tri } from '../../src/taxonomy/evaluation';
import { loadTaxonomyV2 } from '../../src/taxonomy';

const argv = process.argv.slice(2);
const labelsPath = argv[0] as string;
const arg = (n: string, d: string | null) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const kind = arg('--kind', null);
if (kind !== 'human' && kind !== 'assistant') throw new Error('--kind human|assistant is required (assistant labels are never reported as human)');
const rater = arg('--rater', 'unspecified') as string;
const keyPath = arg('--key', 'results/phase6.3.1/labelling/sample-key.json') as string;
const scope = arg('--scope', 'engineering-only') as string;
if (scope !== 'engineering-only' && scope !== 'engineering-or-both') throw new Error('--scope must be engineering-only or engineering-or-both');
const outPath = arg('--out', `results/phase6.3.1/labelling/scores-${kind}-${scope}.json`) as string;

const tax = loadTaxonomyV2();
const key = JSON.parse(readFileSync(keyPath, 'utf8')) as { items: { id: string; stratum: string; weight: number; prediction: { topLevel: string; domainEngineering: boolean; predictedUnknown: boolean; areas: string[]; technologies: string[]; learning: boolean } }[] };
const split = (s: string) => s.split(/[;,]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const tri = (s: string): Tri => (s.trim().toUpperCase() as Tri);

const raw = readFileSync(labelsPath, 'utf8');
let labelled: HumanLabel[] = [];
let blank = 0;
if (labelsPath.endsWith('.json')) {
  labelled = (JSON.parse(raw) as { labels: HumanLabel[] }).labels;
} else {
  for (const r of csvRecords(raw)) {
    if (!r.domainEngineering && !r.learning && !r.type) { blank += 1; continue; }
    labelled.push({ id: r.id as string, domainEngineering: tri(r.domainEngineering ?? ''), areas: split(r.areas ?? ''), technologies: split(r.technologies ?? ''), learning: tri(r.learning ?? ''), type: ((r.type ?? '').toLowerCase() || null) as RepoType | null, notes: r.notes });
  }
}
const areaSet = new Set(tax.engineeringAreas.map((a) => a.slug));
const techSet = new Set(tax.technologies.map((t) => t.slug));
const { valid, invalid } = validateLabels(labelled, areaSet, techSet);
// Scope. engineering-only = what the Engineering Radar would contain (BOTH repositories rank with AI, see config/domains.json); engineering-or-both = every repository the taxonomy is applied to.
const inScope = (top: string) => (scope === 'engineering-only' ? top === 'ENGINEERING' : top === 'ENGINEERING' || top === 'BOTH');
const predictions: Prediction[] = key.items.map((i) => { const on = inScope(i.prediction.topLevel); return { id: i.id, domainEngineering: on, predictedUnknown: i.prediction.predictedUnknown, areas: on ? i.prediction.areas : [], technologies: on ? i.prediction.technologies : [], learning: i.prediction.learning, weight: i.weight, stratum: i.stratum }; });
const ev = evaluateTaxonomy(valid, predictions, { labelled: labelled.length, invalid: invalid.length });
const verdicts = Object.fromEntries(tax.technologies.map((t) => [t.slug, { ...(ev.perTechnology[t.slug] ?? { predicted: 0, tp: 0, fp: 0, labelled: 0, fn: 0, precision: null, recall: null }), verdict: technologyVerdict(ev.perTechnology[t.slug] ?? { predicted: 0, tp: 0, fp: 0, labelled: 0, fn: 0 }) }]));
const out = {
  kind,
  scope,
  independence: kind === 'human' ? 'human-labelled' : 'ASSISTANT-LABELLED: written by the same tooling that produced the predictions; NOT independent, NOT human. Use for tooling checks and problem-case discovery only.',
  rater,
  labelsPath,
  sampleSize: key.items.length,
  blankRows: blank,
  invalid,
  requiredValidLabels: 200,
  meetsMinimum: ev.validLabels >= 200,
  evaluation: { ...ev, perTechnology: undefined, perArea: undefined, problemCases: ev.problemCases },
  perArea: ev.perArea,
  perTechnology: verdicts,
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ kind, valid: ev.validLabels, invalid: invalid.length, meetsMinimum: out.meetsMinimum, domain: { p: ev.domain.precision, r: ev.domain.recall }, area: { p: ev.area.precision, r: ev.area.recall }, technology: { p: ev.technology.precision, r: ev.technology.recall }, learning: { p: ev.learning.precision, r: ev.learning.recall }, unknownRate: ev.unknownRate, unknownAmongEngineering: ev.unknownAmongEngineering }, null, 1));
