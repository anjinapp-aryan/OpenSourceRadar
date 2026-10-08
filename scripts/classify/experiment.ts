/**
 * Phase 6.2 classification experiment (offline, no network).
 *
 *   npx tsx scripts/classify/experiment.ts sample   <state data dir>   writes blind label sheets to results/phase6.2/
 *   npx tsx scripts/classify/experiment.ts evaluate <state data dir>   reads results/phase6.2/classification-labels.json
 *
 * Tuning and held-out samples are disjoint seeded draws from the repositories the experimental rule would change.
 * The held-out sheet is written WITHOUT the proposal so the label (domain) is assigned before the proposal is seen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { toClassificationInput } from '../../src/classification/datasets';
import { applyE1, EXPERIMENT_E1, EXPERIMENT_E1_AI } from '../../src/classification/experimental';
import type { CandidateDataset } from '../../src/collect/candidates';

const [mode, dir = '.pipeline/state-2026-10-06/data'] = process.argv.slice(2);
const cand = JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as CandidateDataset;
const stored = new Map((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: { id: string; result: { topLevelCategory: string } }[] }).repositories.map((r) => [r.id, r.result.topLevelCategory]));
const classifier = new Classifier(loadTaxonomy());
const rows = cand.candidates.map((c) => {
  const result = classifier.classify(toClassificationInput(c));
  return { c, result, e1: applyE1(result) };
});
const reproduced = rows.filter((r) => stored.get(r.c.id) === r.result.topLevelCategory).length;
const unknown = rows.filter((r) => r.result.topLevelCategory === 'UNKNOWN');
const fired = rows.filter((r) => r.e1.fired);

function seeded<T>(xs: T[], seed: number): T[] {
  const out = [...xs].sort((a: any, b: any) => (BigInt(a.c.id) < BigInt(b.c.id) ? -1 : 1));
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
const line = (r: (typeof rows)[number]) => `${r.c.fullName}\t${r.c.stars}\t${r.c.language ?? ''}\t${(r.c.description ?? '').replace(/\s+/g, ' ').slice(0, 200)}\t${r.c.topics.join(',')}`;

const NAMED = ['browser-use/browser-use', 'harry0703/MoneyPrinterTurbo', 'puppeteer/puppeteer'];
const named = fired.filter((r) => NAMED.includes(r.c.fullName));
const shuffled = seeded(fired.filter((r) => !NAMED.includes(r.c.fullName)), 7);
const tuning = [...named, ...shuffled.slice(0, 40 - named.length)];
const holdout = shuffled.slice(40 - named.length, 40 - named.length + 80);
const unknownSample = seeded(unknown, 99).slice(0, 60);

if (mode === 'sample') {
  writeFileSync('results/phase6.2/classification-tuning.tsv', ['fullName\tstars\tlanguage\tdescription\ttopics\tE1 proposal\tE1 evidence', ...tuning.map((r) => `${line(r)}\t${r.e1.topLevel}/${r.e1.slug}\t${r.e1.evidence?.join(' | ')}`)].join('\n'));
  writeFileSync('results/phase6.2/classification-holdout-blind.tsv', ['fullName\tstars\tlanguage\tdescription\ttopics', ...holdout.map(line)].join('\n'));
  writeFileSync('results/phase6.2/classification-unknown-sample.tsv', ['fullName\tstars\tlanguage\tdescription\ttopics\tbest near miss', ...unknownSample.map((r) => `${line(r)}\t${r.result.signals.nearMisses[0] ? `${r.result.signals.nearMisses[0].slug} ${r.result.signals.nearMisses[0].score}` : 'none'}`)].join('\n'));
  console.log(JSON.stringify({ candidates: rows.length, reproducedStoredTopLevel: reproduced, unknown: unknown.length, fired: fired.length, firedByDomain: { ai: fired.filter((r) => r.e1.domain === 'ai').length, engineering: fired.filter((r) => r.e1.domain === 'engineering').length }, tuning: tuning.length, holdout: holdout.length, unknownSample: unknownSample.length }, null, 1));
} else if (mode === 'evaluate') {
  // labels: { "<fullName>": { domain: "AI"|"ENGINEERING"|"BOTH"|"IRRELEVANT", category?: "ok"|"wrong", type?: string, inTax?: boolean } }
  // held-out domains come from the frozen blind sheet; category is judged after the reveal and only matters when the domain is right.
  // type/inTax label the UNKNOWN population sample: inTax = an EXISTING category should cover it (recall denominator).
  type Label = { domain: string; category?: string; type?: string; inTax?: boolean };
  const labels = JSON.parse(readFileSync('results/phase6.2/classification-labels.json', 'utf8')) as Record<string, Label>;
  const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const evaluateRule = (rule: typeof EXPERIMENT_E1 | typeof EXPERIMENT_E1_AI) => {
    const decide = new Map(rows.map((r) => [r.c.id, applyE1(r.result, rule)]));
    const evalSet = (set: (typeof rows)[number][], name: string) => {
      let tp = 0;
      let domainOkCategoryWrong = 0;
      let fp = 0;
      let notFired = 0;
      const errors: string[] = [];
      for (const r of set) {
        const l = labels[r.c.fullName];
        if (!l) throw new Error(`missing label for ${r.c.fullName} (${name})`);
        const d = decide.get(r.c.id)!;
        if (!d.fired) {
          notFired += 1; // the variant abstains: stays UNKNOWN (no false positive, no gain)
          continue;
        }
        const domainOk = l.domain === d.topLevel || l.domain === 'BOTH';
        if (domainOk && l.category !== 'wrong') tp += 1;
        else if (domainOk) {
          domainOkCategoryWrong += 1;
          errors.push(`${r.c.fullName}: category ${d.slug} wrong (label ${l.domain})`);
        } else {
          fp += 1;
          errors.push(`${r.c.fullName}: proposed ${d.topLevel}/${d.slug}, label ${l.domain}`);
        }
      }
      const firedN = set.length - notFired;
      return { set: name, n: set.length, fired: firedN, correct: tp, domainRightCategoryWrong: domainOkCategoryWrong, wrongDomain: fp, precision: pct(tp, firedN), domainPrecision: pct(tp + domainOkCategoryWrong, firedN), errors };
    };
    const firedAll = rows.filter((r) => decide.get(r.c.id)!.fired);
    // recall proxy on the UNKNOWN population sample: of the repositories an existing category should cover, how many recovered correctly?
    // (category correctness for these is judged as "domain right"; the sample was not labelled at category level)
    const us = unknownSample.map((r) => ({ r, l: labels[r.c.fullName], d: decide.get(r.c.id)! }));
    const inTax = us.filter((x) => x.l?.inTax);
    const recovered = inTax.filter((x) => x.d.fired && (x.l!.domain === x.d.topLevel || x.l!.domain === 'BOTH'));
    const firedWrongInSample = us.filter((x) => x.d.fired && !(x.l?.domain === x.d.topLevel || x.l?.domain === 'BOTH'));
    const tuningR = evalSet(tuning, 'tuning (optimistic: rule designed with these in view)');
    const holdoutR = evalSet(holdout, 'held-out');
    const prec = (holdoutR.precision ?? 0) / 100;
    const expectedCorrect = Math.round(firedAll.length * prec);
    return {
      rule: rule.id,
      firedOnUnknown: firedAll.length,
      tuning: tuningR,
      holdout: holdoutR,
      recallProxyOnUnknownSample: { sample: us.length, shouldBeCoveredByExistingCategory: inTax.length, recoveredDomainCorrect: recovered.length, firedInSample: us.filter((x) => x.d.fired).length, firedWrongDomainInSample: firedWrongInSample.map((x) => x.r.c.fullName), recall: pct(recovered.length, inTax.length) },
      projection: { unknownAfterIfEnabled: unknown.length - firedAll.length, unknownRateAfter: pct(unknown.length - firedAll.length, rows.length), expectedCorrectFromHeldOutPrecision: expectedCorrect, expectedIncorrect: firedAll.length - expectedCorrect },
    };
  };
  const us = unknownSample.map((r) => labels[r.c.fullName]);
  if (us.some((l) => !l?.type)) throw new Error('UNKNOWN sample not fully labelled');
  const count = (f: (l: Label) => string) => us.reduce<Record<string, number>>((m, l) => ((m[f(l!)] = (m[f(l!)] ?? 0) + 1), m), {});
  const result = {
    candidates: rows.length,
    reproducedStoredTopLevel: reproduced,
    unknownCurrent: unknown.length,
    unknownRateCurrent: pct(unknown.length, rows.length),
    unknownSample: { n: us.length, byType: count((l) => l.type!), byDomain: count((l) => l.domain), coverableByExistingCategory: us.filter((l) => l!.inTax).length },
    rules: [evaluateRule(EXPERIMENT_E1), evaluateRule(EXPERIMENT_E1_AI)],
  };
  writeFileSync('results/phase6.2/classification-experiment.json', JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
} else {
  console.error('usage: experiment.ts sample|evaluate <state data dir>');
  process.exit(1);
}
