/**
 * Phase 6.3 taxonomy validation. Read-only.
 *
 *   tsx scripts/taxonomy/validate.ts <state data dir> <OSS Insight collections dir> [--out results/phase6.3/taxonomy-validation.json]
 *
 * 1. Coverage and over-breadth of the technology rules on the real Engineering population.
 * 2. Held-out check against INDEPENDENT labels: OSS Insight's curated collections (Apache-2.0, pingcap/ossinsight, configs/collections/*.yml).
 *    Each collection is mapped by hand (below) to the area it should fall in; a collection lists members of that technology family, so
 *    this measures recall of the rules (and of the v1 classifier, including how many members are UNKNOWN), not precision.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTaxonomyV2, taxonomyOf, detectTechnologies } from '../../src/taxonomy';

const [dir, collectionsDir] = process.argv.slice(2) as [string, string];
const argv = process.argv.slice(2);
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3/taxonomy-validation.json';

const tax = loadTaxonomyV2();
const cand = (JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { candidates: any[] }).candidates;
const cls = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r.result]));
const NOW = Date.parse('2026-10-07T00:00:00Z');

const rows = cand.map((c) => {
  const r = cls.get(c.id);
  const top = r?.topLevelCategory ?? 'UNKNOWN';
  const t = taxonomyOf(tax, {
    name: c.name,
    description: c.description,
    topics: c.topics,
    language: c.language,
    ageDays: (NOW - Date.parse(c.createdAt)) / 86_400_000,
    categories: (r?.categories ?? []).map((x: any) => x.slug),
    topLevel: top,
    contextIds: (r?.signals?.context ?? []).map((x: any) => x.id),
  });
  return { c, top, t };
});
const eng = rows.filter((x) => x.top === 'ENGINEERING' || x.top === 'BOTH');

// ------------------------------------------------------------ coverage
const techCount: Record<string, number> = {};
for (const x of eng) for (const s of x.t.technologies) techCount[s] = (techCount[s] ?? 0) + 1;
const areaCount: Record<string, number> = {};
for (const x of eng) for (const a of x.t.areas) areaCount[a] = (areaCount[a] ?? 0) + 1;
const withTech = eng.filter((x) => x.t.technologies.length > 0).length;
const withArea = eng.filter((x) => x.t.areas.length > 0).length;
const multi = eng.filter((x) => x.t.technologies.length >= 3).length;
const coverage = {
  engineeringOrBoth: eng.length,
  withAtLeastOneTechnology: withTech,
  withAtLeastOneTechnologyShare: +(withTech / eng.length).toFixed(3),
  withAtLeastOneArea: withArea,
  withAtLeastOneAreaShare: +(withArea / eng.length).toFixed(3),
  threeOrMoreTechnologies: multi,
  technologyCounts: Object.fromEntries(Object.entries(techCount).sort((a, b) => b[1] - a[1])),
  techsWithAtLeast25: Object.entries(techCount).filter(([, n]) => n >= 25).length,
  techsTotal: tax.technologies.length,
  techsNeverMatched: tax.technologies.filter((t) => !techCount[t.slug]).map((t) => t.slug),
  broadest: Object.entries(techCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => ({ slug: s, n, share: +(n / eng.length).toFixed(3) })),
  areaCounts: areaCount,
  learningContent: eng.filter((x) => x.t.facets.contentType === 'learning').length,
  ageBands: Object.fromEntries(['emerging', 'growing', 'established', 'mature'].map((b) => [b, eng.filter((x) => x.t.facets.ageBand === b).length])),
};

// ------------------------------------------------------------ held-out: OSS Insight collections (independent labels)
const EXPECT: Record<string, { area: string; techs?: string[] }> = {
  'message-and-streaming': { area: 'messaging' },
  'relational-database': { area: 'data' },
  'time-series-database': { area: 'data' },
  'graph-database': { area: 'data' },
  'key-value-database': { area: 'data' },
  'open-source-database': { area: 'data' },
  'rust-database': { area: 'data' },
  'go-database': { area: 'data' },
  'search-engine': { area: 'data' },
  'distributed-file-storage': { area: 'data' },
  'data-integration': { area: 'data' },
  'modern-data-stack': { area: 'data' },
  'kubernetes-tooling': { area: 'cloud-native', techs: ['kubernetes'] },
  'serverless-framework': { area: 'cloud-native', techs: ['serverless'] },
  'webassembly-runtime': { area: 'cloud-native', techs: ['webassembly'] },
  cicd: { area: 'infrastructure', techs: ['ci-cd'] },
  'configuration-management-tools': { area: 'infrastructure' },
  'x-as-code': { area: 'infrastructure' },
  finops: { area: 'infrastructure' },
  paas: { area: 'infrastructure' },
  'monitoring-tool': { area: 'observability' },
  'apm-tool': { area: 'observability' },
  'chaos-engineering': { area: 'observability' },
  'security-tool': { area: 'security' },
  'identity-server': { area: 'security' },
  'testing-tool': { area: 'devtools', techs: ['testing'] },
  'documentation-generator': { area: 'devtools' },
  'mocking-stubbing-tools': { area: 'devtools' },
  'go-web-frameworks': { area: 'backend' },
  'api-tool-for-developer': { area: 'backend' },
};
const byName = new Map(rows.map((x) => [String(x.c.fullName).toLowerCase(), x]));
const heldOut: Record<string, unknown>[] = [];
let tot = { members: 0, inPool: 0, unknown: 0, classifiedEng: 0, rightArea: 0, anyArea: 0, techExpected: 0, techRight: 0 };
for (const f of readdirSync(collectionsDir).filter((x) => x.endsWith('.yml'))) {
  const slug = f.replace('.yml', '');
  const exp = EXPECT[slug];
  if (!exp) continue;
  const members = readFileSync(join(collectionsDir, f), 'utf8').split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4).trim().toLowerCase());
  let inPool = 0, unknown = 0, classifiedEng = 0, rightArea = 0, anyArea = 0, techExp = 0, techRight = 0;
  const missed: string[] = [];
  for (const m of members) {
    const x = byName.get(m);
    if (!x) continue;
    inPool += 1;
    if (x.top === 'UNKNOWN') { unknown += 1; continue; }
    if (x.top === 'AI') continue;
    classifiedEng += 1;
    if (x.t.areas.length > 0) anyArea += 1;
    if (x.t.areas.includes(exp.area)) rightArea += 1;
    else if (missed.length < 6) missed.push(`${x.c.fullName} -> [${x.t.areas.join(',') || 'none'}]`);
    if (exp.techs) {
      techExp += 1;
      if (x.t.technologies.some((t) => exp.techs!.includes(t))) techRight += 1;
    }
  }
  tot = { members: tot.members + members.length, inPool: tot.inPool + inPool, unknown: tot.unknown + unknown, classifiedEng: tot.classifiedEng + classifiedEng, rightArea: tot.rightArea + rightArea, anyArea: tot.anyArea + anyArea, techExpected: tot.techExpected + techExp, techRight: tot.techRight + techRight };
  heldOut.push({ collection: slug, expectedArea: exp.area, members: members.length, inCandidatePool: inPool, classifiedUnknown: unknown, classifiedEngineering: classifiedEng, areaCorrect: rightArea, areaAny: anyArea, technologyExpected: techExp, technologyCorrect: techRight, missedExamples: missed });
}
const heldOutSummary = {
  source: 'pingcap/ossinsight configs/collections (Apache-2.0); mapping collection -> area is ours and is recorded in scripts/taxonomy/validate.ts',
  collections: heldOut.length,
  ...tot,
  poolShareOfMembers: +(tot.inPool / tot.members).toFixed(3),
  unknownShareOfPoolMembers: +(tot.unknown / Math.max(1, tot.inPool)).toFixed(3),
  areaRecallAmongClassifiedEngineering: +(tot.rightArea / Math.max(1, tot.classifiedEng)).toFixed(3),
  areaRecallAmongPoolMembers: +(tot.rightArea / Math.max(1, tot.inPool)).toFixed(3),
  technologyRecallWhereTechnologyExpected: +(tot.techRight / Math.max(1, tot.techExpected)).toFixed(3),
};
writeFileSync(outPath, JSON.stringify({ taxonomyVersion: tax.taxonomyVersion, coverage, heldOutSummary, heldOut }, null, 1) + '\n');
console.log(JSON.stringify({ coverage: { ...coverage, technologyCounts: undefined }, heldOutSummary }, null, 1));
void detectTechnologies;

// ------------------------------------------------------------ learning/list facet against independent labels (appended in Phase 6.3)
// positives: OSS Insight `computer-science-courses` members; negatives: members of the software collections above (a tutorial is not a database).
import { existsSync } from 'node:fs';
import { detectLearning } from '../../src/taxonomy';
const learnDir = argv.includes('--learn') ? (argv[argv.indexOf('--learn') + 1] as string) : null;
if (learnDir && existsSync(learnDir)) {
  const pos = new Set<string>();
  for (const f of readdirSync(learnDir).filter((x) => x.endsWith('.yml'))) for (const l of readFileSync(join(learnDir, f), 'utf8').split('\n')) if (l.startsWith('  - ')) pos.add(l.slice(4).trim().toLowerCase());
  const neg = new Set<string>();
  for (const f of readdirSync(collectionsDir).filter((x) => x.endsWith('.yml'))) for (const l of readFileSync(join(collectionsDir, f), 'utf8').split('\n')) if (l.startsWith('  - ')) neg.add(l.slice(4).trim().toLowerCase());
  let pIn = 0, pHit = 0, nIn = 0, nHit = 0;
  const fp: string[] = [];
  for (const [k, x] of byName) {
    const hit = detectLearning(tax, { name: x.c.name, description: x.c.description, topics: x.c.topics }).learning || x.t.facets.contentType === 'learning';
    if (pos.has(k)) { pIn += 1; if (hit) pHit += 1; }
    if (neg.has(k) && !pos.has(k)) { nIn += 1; if (hit) { nHit += 1; if (fp.length < 10) fp.push(x.c.fullName); } }
  }
  const learningOut = { positivesInPool: pIn, positivesFlagged: pHit, recall: +(pHit / Math.max(1, pIn)).toFixed(3), softwareMembersInPool: nIn, softwareMembersFlagged: nHit, falsePositiveRate: +(nHit / Math.max(1, nIn)).toFixed(3), falsePositiveExamples: fp, engineeringLearningFlagged: eng.filter((x) => x.t.facets.contentType === 'learning').length, engineeringLearningShare: +(eng.filter((x) => x.t.facets.contentType === 'learning').length / eng.length).toFixed(3) };
  console.log(JSON.stringify({ learningFacet: learningOut }, null, 1));
  const prev = JSON.parse(readFileSync(outPath, 'utf8'));
  writeFileSync(outPath, JSON.stringify({ ...prev, learningFacet: learningOut }, null, 1) + '\n');
}
