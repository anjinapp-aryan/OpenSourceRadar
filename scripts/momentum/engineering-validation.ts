/**
 * Phase 6.3 Engineering ranking validation. Read-only.
 *
 *   tsx scripts/momentum/engineering-validation.ts <state data dir> <replay-rows.json> [--out results/phase6.3/engineering-validation.json]
 *
 * Compares the production Rising label with the configured Engineering normalisation (config/domains.json) on the real Engineering
 * population over the replay window, overall, by pattern, and by technology/area from taxonomy v2. No technology is forced into the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDomainConfig } from '../../src/domain';
import { normalize } from '../../src/momentum/normalize';
import { loadTaxonomyV2, taxonomyOf } from '../../src/taxonomy';

const argv = process.argv.slice(2);
const dir = argv[0] as string;
const replayPath = argv[1] as string;
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3/engineering-validation.json';

const adapter = loadDomainConfig().ENGINEERING;
if (adapter.mode !== 'normalized') throw new Error('ENGINEERING adapter is not normalized');
const params = adapter.params;
const tax = loadTaxonomyV2();
const replay = JSON.parse(readFileSync(replayPath, 'utf8')) as { dates: string[]; repos: { id: string; fullName: string; domain: string | null; cat: string | null }[]; rows: Record<string, any[]> };
const repoRecords = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r]));
const cls = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r.result]));
const last = replay.dates[replay.dates.length - 1] as string;
const NOW = Date.parse(`${last}T00:00:00Z`);

const tags = replay.repos.map((m) => {
  if (m.domain !== 'ENGINEERING') return null;
  const r = repoRecords.get(m.id);
  const c = cls.get(m.id);
  return taxonomyOf(tax, {
    name: r.name, description: r.description, topics: r.topics, language: r.language, ageDays: (NOW - Date.parse(r.createdAt)) / 86_400_000,
    categories: (c?.categories ?? []).map((x: any) => x.slug), topLevel: c?.topLevelCategory ?? 'UNKNOWN', contextIds: (c?.signals?.context ?? []).map((x: any) => x.id),
  });
});

// per-date flags
let learningExcluded = 0;
const flagged = new Map<string, Map<number, { via: string | null; domainPercentile: number; bandPercentile: number }>>();
for (const T of replay.dates) {
  const rows = (replay.rows[T] ?? []).filter((r) => replay.repos[r.i]!.domain === 'ENGINEERING');
  const res = normalize(rows.map((r) => ({ id: String(r.i), stars: r.stars, growth7d: r.g7, growth30d: r.g30, velocity7d: r.v7, accelerationRatio: r.accel, spikeShare: r.spike, historyDays: r.hist })), params);
  // learning/list content (tutorials, awesome lists, interview prep) is never a Trending/Rising candidate
  const hits = res.filter((x) => x.flagged);
  const kept = hits.filter((x) => tags[Number(x.id)]?.facets.contentType !== 'learning');
  learningExcluded += hits.length - kept.length;
  flagged.set(T, new Map(kept.map((x) => [Number(x.id), { via: x.via, domainPercentile: x.domainPercentile, bandPercentile: x.bandPercentile }])));
}

const rowsLast = (replay.rows[last] ?? []).filter((r) => replay.repos[r.i]!.domain === 'ENGINEERING');
const pct = (n: number, d: number) => +((100 * n) / Math.max(1, d)).toFixed(2);
const patternCount = (name: string) => rowsLast.filter((r) => r.pattern === name).length;
const overall = {
  date: last,
  engineeringRepositories: rowsLast.length,
  measured: rowsLast.length,
  productionRising: rowsLast.filter((r) => r.trend === 'RISING').length,
  productionRisingPct: pct(rowsLast.filter((r) => r.trend === 'RISING').length, rowsLast.length),
  normalizedFlagged: flagged.get(last)!.size,
  normalizedFlaggedPct: pct(flagged.get(last)!.size, rowsLast.length),
  overlapBoth: [...flagged.get(last)!.keys()].filter((i) => rowsLast.find((r) => r.i === i)?.trend === 'RISING').length,
  patterns: {
    ACCELERATING: { n: patternCount('ACCELERATING'), pct: pct(patternCount('ACCELERATING'), rowsLast.length) },
    BREAKOUT: { n: patternCount('BREAKOUT'), pct: pct(patternCount('BREAKOUT'), rowsLast.length) },
    COOLING: { n: patternCount('COOLING'), pct: pct(patternCount('COOLING'), rowsLast.length) },
    SUSTAINED_GROWTH: { n: patternCount('SUSTAINED_GROWTH'), pct: pct(patternCount('SUSTAINED_GROWTH'), rowsLast.length) },
    NEW_LAUNCH: { n: patternCount('NEW_LAUNCH'), pct: pct(patternCount('NEW_LAUNCH'), rowsLast.length) },
    SPIKE: { n: patternCount('SPIKE'), pct: pct(patternCount('SPIKE'), rowsLast.length) },
  },
  note: 'pattern labels are the production Phase 6.1 labels and are unchanged; only the Rising/Trending decision differs',
};

// technology table
const wanted: { label: string; match: (i: number) => boolean }[] = [
  { label: 'Java (language facet)', match: (i) => repoRecords.get(replay.repos[i]!.id)?.language === 'Java' },
  { label: 'Spring', match: (i) => tags[i]?.technologies.includes('spring') ?? false },
  { label: 'Kafka', match: (i) => tags[i]?.technologies.includes('kafka') ?? false },
  { label: 'Kubernetes', match: (i) => tags[i]?.technologies.includes('kubernetes') ?? false },
  { label: 'Docker', match: (i) => tags[i]?.technologies.includes('docker') ?? false },
  { label: 'AWS', match: (i) => tags[i]?.technologies.includes('aws') ?? false },
  { label: 'PostgreSQL', match: (i) => tags[i]?.technologies.includes('postgresql') ?? false },
  { label: 'Redis', match: (i) => tags[i]?.technologies.includes('redis') ?? false },
  { label: 'Terraform', match: (i) => tags[i]?.technologies.includes('terraform') ?? false },
  { label: 'Observability (area)', match: (i) => tags[i]?.areas.includes('observability') ?? false },
  { label: 'Developer tools (area)', match: (i) => tags[i]?.areas.includes('devtools') ?? false },
  { label: 'Microservices', match: (i) => tags[i]?.technologies.includes('microservices') ?? false },
  { label: 'Security (area)', match: (i) => tags[i]?.areas.includes('security') ?? false },
  { label: 'Data and storage (area)', match: (i) => tags[i]?.areas.includes('data') ?? false },
];
const technology = wanted.map((w) => {
  const members = rowsLast.filter((r) => w.match(r.i));
  const prodNow = members.filter((r) => r.trend === 'RISING');
  const flaggedNow = members.filter((r) => flagged.get(last)!.has(r.i));
  const ever = new Set<number>(), everProd = new Set<number>();
  for (const T of replay.dates) {
    for (const r of (replay.rows[T] ?? [])) {
      if (replay.repos[r.i]!.domain !== 'ENGINEERING' || !w.match(r.i)) continue;
      if (flagged.get(T)!.has(r.i)) ever.add(r.i);
      if (r.trend === 'RISING') everProd.add(r.i);
    }
  }
  return {
    technology: w.label,
    repositories: members.length,
    productionRisingNow: prodNow.length,
    normalizedFlaggedNow: flaggedNow.length,
    productionRisingDistinct29d: everProd.size,
    normalizedFlaggedDistinct29d: ever.size,
    examplesFlaggedNow: flaggedNow.sort((a, b) => b.g30 - a.g30).slice(0, 4).map((r) => `${replay.repos[r.i]!.fullName} (${r.stars} stars, +${r.g30} in 30d)`),
  };
});

// what the normalisation adds: flagged members (last day) that production would not call Rising
const added = rowsLast.filter((r) => flagged.get(last)!.has(r.i) && r.trend !== 'RISING');
const via = { domain: 0, band: 0, both: 0 } as Record<string, number>;
for (const [, v] of flagged.get(last)!) if (v.via) via[v.via] = (via[v.via] ?? 0) + 1;
const out = {
  params,
  overall,
  viaGate: via,
  learningContentExcludedFlagDays: learningExcluded,
  technology,
  addedOverProductionExamples: added.sort((a, b) => b.g30 - a.g30).slice(0, 15).map((r) => ({ repo: replay.repos[r.i]!.fullName, stars: r.stars, growth7d: r.g7, growth30d: r.g30, productionTrend: r.trend, via: flagged.get(last)!.get(r.i)!.via, areas: tags[r.i]?.areas, technologies: tags[r.i]?.technologies })),
  window: { from: replay.dates[0], to: last },
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ overall, viaGate: via, technology: technology.map((t) => ({ ...t, examplesFlaggedNow: undefined })) }, null, 1));
