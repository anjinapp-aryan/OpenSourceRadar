/**
 * Phase 6.3: measure what the additive domain fields would cost in the public data, WITHOUT writing them anywhere near production.
 *
 *   tsx scripts/domain/contract-size.ts <state data dir> [--radar data/public/radar.json] [--out results/phase6.3/contract-size.json]
 *
 * Builds the optional fields (domain, areas, technologies, facets, domainMomentum) for every record of the committed radar.json in memory,
 * serialises the extended dataset, and reports bytes (raw, gzip, brotli) against the current file. Also verifies that the new keys do not
 * collide with the current public allow-list and that the strict public gate would currently reject them (the gate is a deliberate control).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { DOMAIN_RECORD_KEYS, domainMomentumFields } from '../../src/domain/contract';
import { loadDomainConfig, radarDomainOf } from '../../src/domain';
import { normalize } from '../../src/momentum/normalize';
import { PUBLIC_REPOSITORY_KEYS, publicSchemaProblems } from '../../src/pipeline/gate';
import { loadTaxonomyV2, taxonomyOf } from '../../src/taxonomy';

const argv = process.argv.slice(2);
const dir = argv[0] as string;
const radarPath = argv.includes('--radar') ? (argv[argv.indexOf('--radar') + 1] as string) : 'data/public/radar.json';
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3/contract-size.json';

const radar = JSON.parse(readFileSync(radarPath, 'utf8')) as { generatedAt: string; repositories: any[] } & Record<string, unknown>;
const state = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r]));
const cls = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r.result]));
const adapters = loadDomainConfig();
const tax = loadTaxonomyV2();
const NOW = Date.parse(radar.generatedAt);

const eng = radar.repositories.filter((r) => radarDomainOf(r.classification.topLevel) === 'ENGINEERING');
const engAdapter = adapters.ENGINEERING;
const normalised = new Map<string, ReturnType<typeof normalize>[number]>();
if (engAdapter.mode === 'normalized') {
  const res = normalize(eng.map((r) => ({ id: r.id, stars: r.stars, growth7d: r.growth7d ?? 0, growth30d: r.growth30d, velocity7d: r.velocity7d ?? 0, accelerationRatio: r.accelerationRatio, spikeShare: 0, historyDays: Math.min(210, Math.round(r.ageDays)) })), engAdapter.params);
  for (const x of res) normalised.set(x.id, x);
}
const extended = radar.repositories.map((r) => {
  const domain = radarDomainOf(r.classification.topLevel);
  const s = state.get(r.id);
  const c = cls.get(r.id);
  const t = taxonomyOf(tax, { name: s?.name ?? r.fullName.split('/')[1], description: r.description, topics: s?.topics ?? [], language: r.language, ageDays: r.ageDays, categories: r.classification.categories, topLevel: r.classification.topLevel, contextIds: (c?.signals?.context ?? []).map((x: any) => x.id) });
  const adapter = domain ? adapters[domain] : null;
  const params = adapter && adapter.mode === 'normalized' ? adapter.params : null;
  const dm = domain ? domainMomentumFields(domain, params, normalised.get(r.id) ?? null, { growth7d: r.growth7d ?? 0, growth30d: r.growth30d, accelerationRatio: r.accelerationRatio, stars: r.stars, ageDays: r.ageDays }) : domainMomentumFields('AI', null, null, { growth7d: 0, growth30d: null, accelerationRatio: null, stars: r.stars, ageDays: r.ageDays });
  // sparse by design: AI (absolute mode) carries no domainMomentum, and a normalised record only carries the explanation when it is flagged
  return { ...r, domain, areas: t.areas, technologies: t.technologies, facets: t.facets, ...(dm.mode === 'normalized' ? { domainMomentum: dm } : {}) };
});
const before = Buffer.from(JSON.stringify(radar));
const after = Buffer.from(JSON.stringify({ ...radar, repositories: extended }));
const sz = (b: Buffer) => ({ bytes: b.length, gzip: gzipSync(b).length, brotli: brotliCompressSync(b).length });
const keyClash = DOMAIN_RECORD_KEYS.filter((k) => (PUBLIC_REPOSITORY_KEYS as readonly string[]).includes(k));
const gateNow = publicSchemaProblems({ ...radar, repositories: extended }, null);
const out = {
  records: radar.repositories.length,
  current: sz(before),
  extended: sz(after),
  addedBytes: after.length - before.length,
  addedBytesPerRecord: Math.round((after.length - before.length) / radar.repositories.length),
  addedGzipBytes: sz(after).gzip - sz(before).gzip,
  addedBrotliBytes: sz(after).brotli - sz(before).brotli,
  warnLevelBytes: 8_000_000,
  extendedUnderWarnLevel: after.length < 8_000_000,
  newKeys: DOMAIN_RECORD_KEYS,
  keyClashesWithCurrentAllowList: keyClash,
  currentGateRejectsExtendedRecords: gateNow.length > 0,
  currentGateMessage: gateNow[0] ?? null,
  engineeringNormalizedFlaggedInPublicSnapshot: [...normalised.values()].filter((x) => x.flagged).length,
  note: 'the in-memory snapshot has no per-day spike share (set to 0) and uses the public record fields; the replay results in normalization-replay.json are the validated numbers',
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
void NOW;
