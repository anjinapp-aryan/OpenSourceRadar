/**
 * Phase 6.3.1: build the stratified, BLIND Engineering labelling sample. Read-only against state and caches; writes only under
 * results/phase6.3.1/labelling/.
 *
 *   tsx scripts/taxonomy/build-sample.ts <production state data dir> [--size 240] [--novel results/phase6.3.1/cache/shadow-search.json]
 *
 * Outputs
 *   sheet.csv       what a human labeller sees: repository facts and EMPTY label columns. No prediction of ours appears in it.
 *   sample-key.json the strata, sampling weights and OUR predictions, kept apart from the labeller.
 *
 * Frame: every production candidate (so that false negatives can be found among UNKNOWN and AI-classified repositories, not only among
 * those we already call Engineering) plus the novel Top-300 discovery when its cache exists. Strata are disjoint (a repository falls in the
 * first stratum it matches, rarest first), so weights are stratum size over sampled count.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { seededSample } from '../../src/discovery/shadow';
import { toCsv } from '../../src/taxonomy/csv';
import { detectLearning, detectTechnologies, loadTaxonomyV2, taxonomyOf } from '../../src/taxonomy';

const argv = process.argv.slice(2);
const dir = argv[0] as string;
const arg = (n: string, d: string) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const size = Number(arg('--size', '240'));
const novelCache = arg('--novel', 'results/phase6.3.1/cache/shadow-search.json');
const outDir = 'results/phase6.3.1/labelling';
mkdirSync(outDir, { recursive: true });

const NOW = Date.parse('2026-10-10T00:00:00Z');
const tax = loadTaxonomyV2();
const classifier = new Classifier(loadTaxonomy());

interface Repo { id: string; fullName: string; name: string; description: string | null; topics: string[]; language: string | null; stars: number; createdAt: string; source: 'production' | 'novel-top300' }
const frame = new Map<string, Repo>();
for (const c of (JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { candidates: any[] }).candidates) {
  frame.set(c.id, { id: c.id, fullName: c.fullName, name: c.name, description: c.description, topics: c.topics, language: c.language, stars: c.stars, createdAt: c.createdAt, source: 'production' });
}
if (existsSync(novelCache)) {
  const cache = JSON.parse(readFileSync(novelCache, 'utf8')) as Record<string, { repositories: any[] }>;
  for (const e of Object.values(cache)) for (const r of e.repositories) {
    if (!frame.has(r.repositoryId) && r.isFork !== true && r.isArchived !== true && r.stars >= 100) frame.set(r.repositoryId, { id: r.repositoryId, fullName: r.fullName, name: r.name, description: r.description, topics: r.topics, language: r.language, stars: r.stars, createdAt: r.createdAt, source: 'novel-top300' });
  }
}

interface Row { r: Repo; top: string; cats: string[]; ctx: string[]; techs: ReturnType<typeof detectTechnologies>; t2: ReturnType<typeof taxonomyOf>; ageDays: number }
const rows: Row[] = [...frame.values()].map((r) => {
  const c = classifier.classify({ id: r.id, name: r.name, description: r.description, topics: r.topics, language: r.language });
  const cats = c.categories.map((x) => x.slug);
  const ctx = c.signals.context.map((x) => x.id);
  const ageDays = (NOW - Date.parse(r.createdAt)) / 86_400_000;
  const t2 = taxonomyOf(tax, { name: r.name, description: r.description, topics: r.topics, language: r.language, ageDays, categories: cats, topLevel: c.topLevelCategory, contextIds: ctx });
  return { r, top: c.topLevelCategory, cats, ctx, techs: detectTechnologies(tax, r), t2, ageDays };
});

// ---- strata: first match wins, rarest technology first
const has = (x: Row, tech: string) => x.t2.technologies.includes(tech);
const eng = (x: Row) => x.top === 'ENGINEERING' || x.top === 'BOTH';
const STRATA: { name: string; target: number; match: (x: Row) => boolean }[] = [
  { name: 'area:messaging (Kafka, RabbitMQ, NATS, Pulsar)', target: 14, match: (x) => eng(x) && x.t2.areas.includes('messaging') },
  { name: 'tech:terraform', target: 7, match: (x) => eng(x) && has(x, 'terraform') },
  { name: 'tech:microservices', target: 7, match: (x) => eng(x) && has(x, 'microservices') },
  { name: 'tech:spring', target: 7, match: (x) => eng(x) && has(x, 'spring') },
  { name: 'tech:aws', target: 7, match: (x) => eng(x) && has(x, 'aws') },
  { name: 'tech:redis', target: 7, match: (x) => eng(x) && has(x, 'redis') },
  { name: 'tech:postgresql', target: 7, match: (x) => eng(x) && has(x, 'postgresql') },
  { name: 'tech:kubernetes', target: 7, match: (x) => eng(x) && has(x, 'kubernetes') },
  { name: 'tech:docker', target: 7, match: (x) => eng(x) && has(x, 'docker') },
  { name: 'category:databases', target: 7, match: (x) => eng(x) && x.cats.includes('databases') },
  { name: 'category:cloud', target: 7, match: (x) => eng(x) && x.cats.includes('cloud') },
  { name: 'area:observability', target: 7, match: (x) => eng(x) && x.t2.areas.includes('observability') },
  { name: 'area:infrastructure', target: 7, match: (x) => eng(x) && x.t2.areas.includes('infrastructure') },
  { name: 'area:devtools', target: 7, match: (x) => eng(x) && x.t2.areas.includes('devtools') },
  { name: 'language:java', target: 7, match: (x) => eng(x) && x.r.language === 'Java' },
  { name: 'borderline:weak-technology-evidence', target: 18, match: (x) => eng(x) && x.techs.some((t) => t.evidence.topics.length === 0) },
  { name: 'predicted-engineering:no-technology', target: 20, match: (x) => eng(x) && x.t2.technologies.length === 0 },
  { name: 'predicted-both', target: 14, match: (x) => x.top === 'BOTH' },
  { name: 'predicted-unknown', target: 30, match: (x) => x.top === 'UNKNOWN' },
  { name: 'predicted-ai', target: 18, match: (x) => x.top === 'AI' },
  { name: 'learning-flagged', target: 14, match: (x) => x.t2.facets.contentType === 'learning' },
  { name: 'novel-top300:engineering', target: 14, match: (x) => x.r.source === 'novel-top300' && eng(x) },
  { name: 'novel-top300:unknown', target: 10, match: (x) => x.r.source === 'novel-top300' && x.top === 'UNKNOWN' },
  { name: 'novel-top300:ai', target: 6, match: (x) => x.r.source === 'novel-top300' && x.top === 'AI' },
];
// the 'novel' stratum is tested first so that novel repositories do not disappear into the production strata
// novel strata first (so novel repositories do not disappear into production strata), then the borderline stratum, then the rest in the listed order
const isNovel = (n: string) => n.startsWith('novel-top300');
const order = [...STRATA.filter((s) => isNovel(s.name)), ...STRATA.filter((s) => s.name.startsWith('borderline')), ...STRATA.filter((s) => !isNovel(s.name) && !s.name.startsWith('borderline'))];
const assigned = new Map<string, string>();
const members = new Map<string, Row[]>();
for (const x of rows) {
  const s = order.find((st) => st.match(x));
  if (!s) continue;
  assigned.set(x.r.id, s.name);
  members.set(s.name, [...(members.get(s.name) ?? []), x]);
}

// scale targets to the requested size
const totalTarget = STRATA.reduce((a, s) => a + s.target, 0);
const scale = size / totalTarget;
const band = (x: Row) => `${x.r.stars < 1200 ? 'small' : x.r.stars < 6000 ? 'medium' : 'large'}/${x.ageDays < 365 ? 'new' : 'mature'}`;
function balanced(list: Row[], n: number, seed: number): Row[] {
  // round-robin over size/age cells so small, medium, large, new and mature repositories are all present
  const cells = new Map<string, Row[]>();
  for (const x of list) cells.set(band(x), [...(cells.get(band(x)) ?? []), x]);
  const queues = [...cells.keys()].sort().map((k) => seededSample(cells.get(k)!, cells.get(k)!.length, seed, (r) => r.r.id));
  const out: Row[] = [];
  for (let i = 0; out.length < n && queues.some((q) => q.length > i); i += 1) for (const q of queues) if (q[i] && out.length < n) out.push(q[i]!);
  return out;
}
const chosen: { x: Row; stratum: string; weight: number }[] = [];
for (const s of STRATA) {
  const list = members.get(s.name) ?? [];
  const n = Math.min(list.length, Math.max(1, Math.round(s.target * scale)));
  const pick = balanced(list, n, 63 + s.name.length);
  for (const x of pick) chosen.push({ x, stratum: s.name, weight: list.length / Math.max(1, pick.length) });
}
chosen.sort((a, b) => (BigInt(a.x.r.id) < BigInt(b.x.r.id) ? -1 : 1));

// ---- blind sheet and key
const header = ['id', 'fullName', 'url', 'description', 'topics', 'language', 'stars', 'ageDays', 'domainEngineering', 'areas', 'technologies', 'learning', 'type', 'notes'];
const sheet = [header, ...chosen.map(({ x }) => [x.r.id, x.r.fullName, `https://github.com/${x.r.fullName}`, (x.r.description ?? '').replace(/\s+/g, ' ').trim(), x.r.topics.join('; '), x.r.language ?? '', String(x.r.stars), String(Math.round(x.ageDays)), '', '', '', '', '', ''])];
writeFileSync(join(outDir, 'sheet.csv'), toCsv(sheet));
const key = {
  built: '2026-10-10',
  frame: { total: rows.length, production: rows.filter((x) => x.r.source === 'production').length, novelTop300: rows.filter((x) => x.r.source === 'novel-top300').length },
  strata: STRATA.map((s) => ({ name: s.name, frame: (members.get(s.name) ?? []).length, sampled: chosen.filter((c) => c.stratum === s.name).length })),
  items: chosen.map(({ x, stratum, weight }) => ({
    id: x.r.id,
    fullName: x.r.fullName,
    stratum,
    weight: +weight.toFixed(4),
    prediction: {
      topLevel: x.top,
      domainEngineering: eng(x),
      predictedUnknown: x.top === 'UNKNOWN',
      areas: x.t2.areas,
      technologies: x.t2.technologies,
      learning: x.t2.facets.contentType === 'learning',
    },
  })),
};
writeFileSync(join(outDir, 'sample-key.json'), JSON.stringify(key, null, 1) + '\n');
const cellCounts: Record<string, number> = {};
for (const { x } of chosen) cellCounts[band(x)] = (cellCounts[band(x)] ?? 0) + 1;
console.log(JSON.stringify({ sampled: chosen.length, frame: key.frame, strata: key.strata, sizeAgeCells: cellCounts }, null, 1));
void detectLearning;
