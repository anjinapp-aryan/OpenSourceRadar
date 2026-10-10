/**
 * Phase 6.3: UNKNOWN classifier investigation with INDEPENDENT labels. Offline, read-only.
 *
 *   tsx scripts/classify/unknown-experiment.ts <state data dir> <OSS Insight engineering collections dir> <OSS Insight AI collections dir> [--cache results/phase6.2.2/cache]
 *
 * Labels: membership in a curated OSS Insight collection (pingcap/ossinsight configs/collections, Apache-2.0) says which DOMAIN a repository belongs to
 * (an AI collection or an engineering collection). These labels were not produced by this project's tooling. For every UNKNOWN repository that is a
 * labelled member we ask: would the experimental rule E1 (Phase 6.2) have fired, and was the proposed domain the labelled one? That is a held-out
 * domain-precision estimate, with a Wilson interval. The production classifier's own domain agreement on labelled, classified members is the baseline.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { applyE1, EXPERIMENT_E1, EXPERIMENT_E1_AI } from '../../src/classification/experimental';

const [dir, engDir, aiDir] = process.argv.slice(2) as [string, string, string];
const argv = process.argv.slice(2);
const cacheDir = argv.includes('--cache') ? (argv[argv.indexOf('--cache') + 1] as string) : 'results/phase6.2.2/cache';

interface Repo { id: string; fullName: string; name: string; description: string | null; topics: string[]; language: string | null }
const repos = new Map<string, Repo>();
for (const c of (JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { candidates: Repo[] }).candidates) repos.set(String(c.fullName).toLowerCase(), c);
const search = JSON.parse(readFileSync(join(cacheDir, 'raw-search.json'), 'utf8')) as { entries: Record<string, { repositories: any[] }> };
for (const e of Object.values(search.entries)) for (const r of e.repositories) if (!repos.has(String(r.fullName).toLowerCase())) repos.set(String(r.fullName).toLowerCase(), { id: r.repositoryId, fullName: r.fullName, name: r.name, description: r.description, topics: r.topics, language: r.language });

const labels = new Map<string, Set<'AI' | 'ENGINEERING'>>();
const readMembers = (d: string, label: 'AI' | 'ENGINEERING') => {
  for (const f of readdirSync(d).filter((x) => x.endsWith('.yml'))) {
    for (const l of readFileSync(join(d, f), 'utf8').split('\n')) {
      if (!l.startsWith('  - ')) continue;
      const k = l.slice(4).trim().toLowerCase();
      const s = labels.get(k) ?? new Set();
      s.add(label);
      labels.set(k, s);
    }
  }
};
readMembers(engDir, 'ENGINEERING');
readMembers(aiDir, 'AI');

const classifier = new Classifier(loadTaxonomy());
const wilson = (k: number, n: number) => {
  if (n === 0) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: +p.toFixed(3), low: +Math.max(0, c - h).toFixed(3), high: +Math.min(1, c + h).toFixed(3), k, n };
};

let labelled = 0, classified = 0, unknown = 0, baseAgree = 0, baseWrong = 0, baseBoth = 0;
const fired: Record<string, { fired: number; right: number; wrong: number }> = { 'E1 (both domains)': { fired: 0, right: 0, wrong: 0 }, 'E1-AI': { fired: 0, right: 0, wrong: 0 } };
const unknownLabelled: string[] = [];
for (const [key, lab] of labels) {
  const r = repos.get(key);
  if (!r || lab.size !== 1) continue;
  const want = [...lab][0] as 'AI' | 'ENGINEERING';
  labelled += 1;
  const res = classifier.classify({ id: r.id, name: r.name, description: r.description, topics: r.topics, language: r.language });
  if (res.topLevelCategory === 'UNKNOWN') {
    unknown += 1;
    unknownLabelled.push(r.fullName);
    for (const [name, rule] of [['E1 (both domains)', EXPERIMENT_E1], ['E1-AI', EXPERIMENT_E1_AI]] as const) {
      const d = applyE1(res, rule);
      if (!d.fired) continue;
      fired[name]!.fired += 1;
      if (d.topLevel === want) fired[name]!.right += 1;
      else fired[name]!.wrong += 1;
    }
  } else {
    classified += 1;
    if (res.topLevelCategory === 'BOTH') baseBoth += 1;
    else if (res.topLevelCategory === want) baseAgree += 1;
    else baseWrong += 1;
  }
}
const out = {
  labelSource: 'pingcap/ossinsight configs/collections (Apache-2.0): 30 engineering-family collections and 24 AI-family collections; a repository labelled by exactly one family',
  labelledRepositoriesInPool: labelled,
  productionClassified: classified,
  productionUnknown: unknown,
  unknownShareOfLabelled: +(unknown / Math.max(1, labelled)).toFixed(3),
  productionDomainAgreement: { agree: baseAgree, disagree: baseWrong, both: baseBoth, agreementAmongSingleDomain: wilson(baseAgree, baseAgree + baseWrong) },
  experiment: Object.fromEntries(Object.entries(fired).map(([k, v]) => [k, { ...v, recallOfLabelledUnknown: +(v.fired / Math.max(1, unknown)).toFixed(3), domainPrecision: wilson(v.right, v.fired) }])),
  decisionRule: 'adopt a rule only if its held-out domain precision lower bound (95% Wilson) is at least 0.80 AND it fires on at least 30 labelled UNKNOWN repositories; otherwise KEEP UNKNOWN',
  unknownLabelledExamples: unknownLabelled.slice(0, 15),
};
writeFileSync('results/phase6.3/unknown-experiment.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
