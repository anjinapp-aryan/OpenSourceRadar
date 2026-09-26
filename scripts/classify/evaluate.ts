import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import type { ClassificationInput } from '../../src/classification/types';

/**
 * Measures the classifier on the curated real-repository fixtures. These numbers describe THIS FIXTURE ONLY
 * (25 repositories chosen and labelled by hand); they are not production accuracy.
 */
interface Fixture {
  input: ClassificationInput;
  fullName: string;
  expect: { top: string[]; desired: string[]; includes: string[]; excludesDomains: string[] };
  rationale: string;
}

const fixtures = JSON.parse(readFileSync('tests/fixtures/real-repos.json', 'utf8')).repositories as Fixture[];
const classifier = new Classifier(loadTaxonomy());

const rows = fixtures.map((f) => {
  const r = classifier.classify(f.input);
  const predicted = r.topLevelCategory;
  const hasAi = predicted === 'AI' || predicted === 'BOTH';
  const hasEng = predicted === 'ENGINEERING' || predicted === 'BOTH';
  const desiredAi = f.expect.desired.some((d) => d === 'AI' || d === 'BOTH');
  const desiredEng = f.expect.desired.some((d) => d === 'ENGINEERING' || d === 'BOTH');
  const forbidsAi = f.expect.excludesDomains.includes('ai') || !desiredAi;
  const forbidsEng = f.expect.excludesDomains.includes('engineering') || !desiredEng;
  return {
    repository: f.fullName,
    desired: f.expect.desired,
    predicted,
    categories: r.categories.map((c) => `${c.slug}:${c.score}`),
    exact: f.expect.desired.includes(predicted),
    acceptable: f.expect.top.includes(predicted),
    falseAi: hasAi && forbidsAi,
    falseEng: hasEng && forbidsEng,
    missed: predicted === 'UNKNOWN' && !f.expect.desired.includes('UNKNOWN'),
    hasAi,
    hasEng,
    reason: r.classificationReason,
  };
});

const n = rows.length;
const count = (p: (r: (typeof rows)[number]) => boolean) => rows.filter(p).length;
const aiPredicted = count((r) => r.hasAi);
const engPredicted = count((r) => r.hasEng);
const summary = {
  scope: 'curated 25-repository fixture (hand-labelled, real metadata); NOT production accuracy',
  fixtures: n,
  exactMatches: count((r) => r.exact),
  acceptableOutcomes: count((r) => r.acceptable),
  aiPredicted,
  aiPrecision: aiPredicted ? (aiPredicted - count((r) => r.falseAi)) / aiPredicted : null,
  engineeringPredicted: engPredicted,
  engineeringPrecision: engPredicted ? (engPredicted - count((r) => r.falseEng)) / engPredicted : null,
  falseAi: rows.filter((r) => r.falseAi).map((r) => r.repository),
  falseEngineering: rows.filter((r) => r.falseEng).map((r) => r.repository),
  falseNegatives: rows.filter((r) => r.missed).map((r) => r.repository),
  unknownRate: count((r) => r.predicted === 'UNKNOWN') / n,
  bothRate: count((r) => r.predicted === 'BOTH') / n,
  byPredicted: Object.fromEntries(['AI', 'ENGINEERING', 'BOTH', 'UNKNOWN'].map((k) => [k, count((r) => r.predicted === k)])),
};

mkdirSync('results', { recursive: true });
writeFileSync('results/classification-fixtures.json', JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of rows.filter((x) => !x.exact)) console.log(`NOT EXACT: ${r.repository} desired=${r.desired.join('|')} predicted=${r.predicted} ${r.categories.join(' ')}\n   ${r.reason}`);
