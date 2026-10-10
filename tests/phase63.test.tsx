import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, utcDate } from '../src/analysis/starHistory';
import { computeWindowsFromGains } from '../src/analysis/windows';
import { loadTaxonomy } from '../src/classification/config';
import { gainsOf, type RepositoryRecord } from '../src/collect/dataset';
import { admit, AdmissionConfigError, loadAdmissionConfig, parseAdmissionConfig, worstCaseHistoryRequestsPerDay, type AdmissionCandidate, type AdmissionConfig } from '../src/discovery/admission';
import { DOMAIN_RECORD_KEYS, bandLabel, domainMomentumFields } from '../src/domain/contract';
import { DomainConfigError, loadDomainConfig, parseDomainConfig, radarDomainOf } from '../src/domain';
import { explainDomainMomentum, topPercentLabel } from '../src/explain/domainExplain';
import { parsePatternConfig } from '../src/explain/pattern';
import { loadMomentumConfig } from '../src/momentum/config';
import { bandIndexOf, normalize, percentileRank, quantile, quantileBounds, type NormalizationParams, type NormalizationRow } from '../src/momentum/normalize';
import { observableRow } from '../src/momentum/rows';
import { PUBLIC_REPOSITORY_KEYS, publicSchemaProblems } from '../src/pipeline/gate';
import { ageBandOf, detectLearning, detectTechnologies, loadTaxonomyV2, parseTaxonomyV2, taxonomyOf, TaxonomyV2Error } from '../src/taxonomy';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const tax = loadTaxonomyV2();

// ---------------------------------------------------------------------------------------------------------------- taxonomy v2
describe('Phase 6.3 taxonomy v2: Domain -> Area -> Technology', () => {
  it('loads, is versioned, and every technology belongs to a declared area', () => {
    expect(tax.taxonomyVersion).toBe(2);
    const areas = new Set(tax.engineeringAreas.map((a) => a.slug));
    expect(areas.size).toBe(8);
    for (const t of tax.technologies) expect(areas.has(t.area)).toBe(true);
    expect(new Set(tax.technologies.map((t) => t.slug)).size).toBe(tax.technologies.length);
  });
  it('accounts for every v1 engineering category: an area, or null for concept/content categories', () => {
    const v1 = loadTaxonomy().categories.filter((c) => c.domain === 'engineering').map((c) => c.slug);
    for (const c of v1) expect(Object.prototype.hasOwnProperty.call(tax.categoryToArea, c), `category ${c}`).toBe(true);
  });
  it('detects a technology from a topic alone and reports exactly what matched', () => {
    const m = detectTechnologies(tax, { name: 'akhq', description: 'GUI for Apache Kafka', topics: ['kafka-connect', 'ui'] });
    expect(m.map((x) => x.slug)).toContain('kafka');
    expect(m.find((x) => x.slug === 'kafka')?.evidence.topics).toEqual(['kafka-connect']);
    expect(m.find((x) => x.slug === 'kafka')?.area).toBe('messaging');
  });
  it('a name match alone is not enough; name plus description is', () => {
    expect(detectTechnologies(tax, { name: 'kafka-notes', description: 'my notes', topics: [] }).map((x) => x.slug)).not.toContain('kafka');
    expect(detectTechnologies(tax, { name: 'kafka-notes', description: 'notes about kafka brokers', topics: [] }).map((x) => x.slug)).toContain('kafka');
  });
  it('a description phrase alone never matches', () => {
    expect(detectTechnologies(tax, { name: 'tool', description: 'works with postgres and kafka and docker', topics: [] })).toEqual([]);
  });
  it('is deterministic and independent of topic order and case', () => {
    const a = detectTechnologies(tax, { name: 'x', description: null, topics: ['Docker', 'KUBERNETES', 'redis'] });
    const b = detectTechnologies(tax, { name: 'x', description: null, topics: ['redis', 'kubernetes', 'docker'] });
    expect(a).toEqual(b);
    expect(a.map((x) => x.slug)).toEqual([...a].sort((p, q) => q.score - p.score || (p.slug < q.slug ? -1 : 1)).map((x) => x.slug));
  });
  it('does not add technologies to AI-only repositories and falls back to the v1 category for the area', () => {
    const ai = taxonomyOf(tax, { name: 'agent', description: 'x', topics: ['docker', 'kubernetes'], language: 'Python', ageDays: 100, categories: ['ai-agents'], topLevel: 'AI', contextIds: [] });
    expect(ai.technologies).toEqual([]);
    expect(ai.areas).toEqual([]);
    const eng = taxonomyOf(tax, { name: 'svc', description: 'x', topics: [], language: 'Java', ageDays: 2000, categories: ['kafka'], topLevel: 'ENGINEERING', contextIds: [] });
    expect(eng.technologies).toEqual([]);
    expect(eng.areas).toEqual(['messaging']);
    expect(eng.facets).toEqual({ language: 'Java', ageBand: 'established', contentType: 'software' });
  });
  it('age bands have exact boundaries', () => {
    expect(ageBandOf(tax, 0)).toBe('emerging');
    expect(ageBandOf(tax, 364.9)).toBe('emerging');
    expect(ageBandOf(tax, 365)).toBe('growing');
    expect(ageBandOf(tax, 1095)).toBe('established');
    expect(ageBandOf(tax, 2920)).toBe('mature');
  });
  it('learning content is detected from evidence and from the v1 context signal; software is left alone', () => {
    expect(detectLearning(tax, { name: 'awesome-java', description: 'A curated list of Java frameworks', topics: ['awesome'] }).learning).toBe(true);
    expect(detectLearning(tax, { name: '30-Days-Of-Python', description: 'a step-by-step guide to learn Python', topics: [] }).learning).toBe(true);
    expect(detectLearning(tax, { name: 'postgres', description: 'The world most advanced relational database', topics: ['postgresql'] }).learning).toBe(false);
    const viaContext = taxonomyOf(tax, { name: 'x', description: 'x', topics: [], language: null, ageDays: 10, categories: [], topLevel: 'ENGINEERING', contextIds: ['educational-content'] });
    expect(viaContext.facets.contentType).toBe('learning');
  });
  it('rejects a malformed taxonomy', () => {
    const raw = read('config/taxonomy.v2.json');
    expect(() => parseTaxonomyV2({ ...raw, taxonomyVersion: 1 })).toThrow(TaxonomyV2Error);
    expect(() => parseTaxonomyV2({ ...raw, technologies: [...raw.technologies, raw.technologies[0]] })).toThrow(/duplicate technology/);
    expect(() => parseTaxonomyV2({ ...raw, technologies: [{ ...raw.technologies[0], area: 'nope' }] })).toThrow(/unknown area/);
    expect(() => parseTaxonomyV2({ ...raw, categoryToArea: { java: 'nope' } })).toThrow(/unknown area/);
  });
});

// ---------------------------------------------------------------------------------------------------------------- domain model
describe('Phase 6.3 domain model and adapter configuration', () => {
  it('maps top-level categories to a ranking population', () => {
    expect(radarDomainOf('AI')).toBe('AI');
    expect(radarDomainOf('BOTH')).toBe('AI');
    expect(radarDomainOf('ENGINEERING')).toBe('ENGINEERING');
    expect(radarDomainOf('UNKNOWN')).toBeNull();
  });
  it('AI keeps the production absolute rules; Engineering is normalised', () => {
    const c = loadDomainConfig();
    expect(c.AI.mode).toBe('absolute');
    expect(c.ENGINEERING.mode).toBe('normalized');
    if (c.ENGINEERING.mode === 'normalized') {
      expect(c.ENGINEERING.params).toMatchObject({ algorithm: 'hybrid', metric: 'g30', domainPercentile: 0.98, bandPercentile: 0.97, bandBounds: [1200, 6000] });
    }
  });
  it('rejects invalid configurations', () => {
    const raw = read('config/domains.json');
    expect(() => parseDomainConfig({ ...raw, schemaVersion: 2 })).toThrow(DomainConfigError);
    expect(() => parseDomainConfig({ ...raw, domains: { ...raw.domains, ENGINEERING: { mode: 'sometimes' } } })).toThrow(/mode/);
    expect(() => parseDomainConfig({ ...raw, domains: { ...raw.domains, ENGINEERING: { mode: 'normalized', params: { ...raw.domains.ENGINEERING.params, domainPercentile: 1 } } } })).toThrow(/strictly between/);
    expect(() => parseDomainConfig({ ...raw, domains: { ...raw.domains, ENGINEERING: { mode: 'normalized', params: { ...raw.domains.ENGINEERING.params, bandBounds: [6000, 1200] } } } })).toThrow(/ascending/);
  });
});

// ---------------------------------------------------------------------------------------------------------------- normalisation
const P = (over: Partial<NormalizationParams> = {}): NormalizationParams => ({
  algorithm: 'hybrid', metric: 'g30', domainPercentile: 0.98, bandPercentile: 0.97, minGrowth7d: 50, minBandGrowth7d: 30, minAcceleration: 0.6, maxSpikeShare: 0.6, minHistoryDays: 14, bandBounds: [1200, 6000], minPeers: 30, ...over,
});
const row = (id: string, stars: number, g7: number, g30: number, o: Partial<NormalizationRow> = {}): NormalizationRow => ({ id, stars, growth7d: g7, growth30d: g30, velocity7d: g7 / 7, accelerationRatio: 1, spikeShare: 0.2, historyDays: 90, ...o });
function population(): NormalizationRow[] {
  const rows: NormalizationRow[] = [];
  for (let i = 0; i < 120; i += 1) rows.push(row(`s${i}`, 500, i % 10, i % 40));
  for (let i = 0; i < 120; i += 1) rows.push(row(`m${i}`, 3000, i % 20, (i % 50) * 2));
  for (let i = 0; i < 60; i += 1) rows.push(row(`l${i}`, 20000, 40 + i, 100 + i * 10));
  return rows;
}
const viaOf = (rows: NormalizationRow[], p: NormalizationParams) => new Map(normalize(rows, p).map((r) => [r.id, r]));

describe('Phase 6.3 percentile and size-band primitives', () => {
  it('mid-rank percentile treats ties symmetrically', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBeCloseTo(0.625);
    expect(percentileRank([5, 5, 5, 5], 5)).toBe(0.5);
    expect(percentileRank([], 1)).toBe(0);
    expect(percentileRank([1, 2, 3], 0)).toBe(0);
    expect(percentileRank([1, 2, 3], 9)).toBe(1);
  });
  it('nearest-rank quantile', () => {
    const v = [10, 1, 5, 9, 2, 8, 3, 7, 4, 6];
    expect(quantile(v, 0.9)).toBe(9);
    expect(quantile(v, 1)).toBe(10);
    expect(quantile(v, 0)).toBe(1);
    expect(quantile([], 0.5)).toBe(0);
  });
  it('empirical band bounds are equal-count and collapse on duplicates', () => {
    expect(quantileBounds([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([3, 6]);
    expect(quantileBounds([5, 5, 5, 5], 3)).toEqual([5]);
    expect(quantileBounds([], 3)).toEqual([]);
    expect(quantileBounds([1, 2, 3], 1)).toEqual([]);
  });
  it('band index has exact boundaries', () => {
    expect([1199, 1200, 5999, 6000, 1e6].map((s) => bandIndexOf(s, [1200, 6000]))).toEqual([0, 1, 1, 2, 2]);
    expect(bandIndexOf(5, [])).toBe(0);
  });
});

describe('Phase 6.3 hybrid normalisation', () => {
  const pop = population();
  const hero = row('hero-small', 800, 120, 300); // 3 stars-per-day-ish giant among small repositories, tiny in absolute terms
  const giant = row('giant', 25000, 200, 700);
  const all = [...pop, hero, giant];
  it('flags a small repository by its size band and a large one by the domain: the hybrid sees both', () => {
    const r = viaOf(all, P());
    expect(r.get('hero-small')?.via).toBe('band');
    expect(r.get('giant')?.flagged).toBe(true);
    expect(['domain', 'both']).toContain(r.get('giant')?.via);
  });
  it('domain-only misses the small repository; band-only misses nothing it should catch; hybrid is the union', () => {
    const d = viaOf(all, P({ algorithm: 'domain' }));
    const b = viaOf(all, P({ algorithm: 'band' }));
    const h = viaOf(all, P({ algorithm: 'hybrid' }));
    expect(d.get('hero-small')?.flagged).toBe(false);
    expect(b.get('hero-small')?.flagged).toBe(true);
    for (const id of all.map((x) => x.id)) expect(h.get(id)?.flagged).toBe(Boolean(d.get(id)?.flagged || b.get(id)?.flagged));
  });
  it('absolute floors stop a percentile from flagging a quiet repository', () => {
    const quiet = [...pop.map((r) => ({ ...r, growth7d: 0, growth30d: 0 })), row('almost', 800, 10, 20)];
    expect(viaOf(quiet, P()).get('almost')?.flagged).toBe(false);
  });
  it('the shared durability guards apply: acceleration, one-day spikes, short history', () => {
    const base = (o: Partial<NormalizationRow>) => viaOf([...pop, row('x', 800, 120, 300, o)], P()).get('x')?.flagged;
    expect(base({})).toBe(true);
    expect(base({ accelerationRatio: 0.3 })).toBe(false);
    expect(base({ accelerationRatio: null })).toBe(false);
    expect(base({ spikeShare: 0.9 })).toBe(false);
    expect(base({ historyDays: 7 })).toBe(false);
  });
  it('a band with too few peers falls back to the domain percentile', () => {
    const lonelyPop = (g30: number) => viaOf([...pop.filter((r) => r.stars >= 3000), row('lonely', 100, 120, g30)], P());
    expect(lonelyPop(300).get('lonely')?.bandPeers).toBe(1);
    expect(lonelyPop(300).get('lonely')?.flagged).toBe(false); // alone in its band it would trivially be 'top 3%': it must clear the domain cut instead
    expect(lonelyPop(900).get('lonely')?.flagged).toBe(true);
  });
  it('the rank metric changes the answer in the expected direction', () => {
    const burst = row('burst', 800, 400, 20); // big week, small month
    const steady = row('steady', 800, 60, 400);
    const pop2 = [...pop, burst, steady];
    expect(viaOf(pop2, P({ metric: 'g30' })).get('steady')?.flagged).toBe(true);
    expect(viaOf(pop2, P({ metric: 'g30' })).get('burst')?.flagged).toBe(false);
  });
  it('is deterministic and independent of input order', () => {
    const a = normalize(all, P());
    const b = normalize([...all].reverse(), P());
    const norm = (xs: typeof a) => [...xs].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)).map((x) => JSON.stringify(x));
    expect(norm(a)).toEqual(norm(b));
  });
  it('the raw algorithm keeps the production-shaped absolute gates and ignores the population', () => {
    const r = viaOf([row('a', 90000, 900, 3000, { velocity7d: 128 }), row('b', 800, 120, 300, { velocity7d: 17 })], P({ algorithm: 'raw' }));
    expect(r.get('a')?.via).toBe('raw');
    expect(r.get('b')?.flagged).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------- explanations and contract
describe('Phase 6.3 deterministic explanations and the data contract', () => {
  const facts = { domain: 'ENGINEERING' as const, via: 'both' as const, domainPercentile: 0.991, bandPercentile: 0.985, bandLabel: '1,200-5,999 stars', bandPeers: 822, growth7d: 301, growth30d: 1333, accelerationRatio: 3.24, domainGate: 0.98, bandGate: 0.97, stars: 4100, ageDays: 40 };
  it('renders exact sentences from stored numbers', () => {
    expect(explainDomainMomentum(facts)).toEqual([
      '30-day growth of +1,333 stars is in the top 2% of Engineering repositories (percentile 99).',
      'Growth is in the top 3% of the 822 repositories with 1,200-5,999 stars (percentile 99), so it is outperforming its size cohort.',
      '7-day growth is 3.2x the prior baseline.',
      'The repository is 40 days old.',
    ]);
    expect(topPercentLabel(0.98)).toBe('top 2%');
  });
  it('only states what is true: gates not passed produce no sentence', () => {
    expect(explainDomainMomentum({ ...facts, via: 'band', accelerationRatio: 0.8, ageDays: 900 })).toEqual(['Growth is in the top 3% of the 822 repositories with 1,200-5,999 stars (percentile 99), so it is outperforming its size cohort.']);
    expect(explainDomainMomentum({ ...facts, via: null })).toEqual(['7-day growth is 3.2x the prior baseline.', 'The repository is 40 days old.']);
  });
  it('is reproducible', () => {
    expect(JSON.stringify(explainDomainMomentum(facts))).toBe(JSON.stringify(explainDomainMomentum({ ...facts })));
  });
  it('band labels cover the three bands and the no-band case', () => {
    expect([0, 1, 2].map((i) => bandLabel([1200, 6000], i))).toEqual(['under 1,200 stars', '1,200-5,999 stars', '6,000+ stars']);
    expect(bandLabel([], 0)).toBe('all sizes');
  });
  it('absolute mode adds nothing; normalised mode carries percentiles, band and explanation', () => {
    expect(domainMomentumFields('AI', null, null, { growth7d: 1, growth30d: 1, accelerationRatio: 1, stars: 1, ageDays: 1 })).toMatchObject({ mode: 'absolute', trending: false, explanation: [] });
    const rows = [...population(), row('hero-small', 800, 120, 300)];
    const params = P();
    const res = normalize(rows, params).find((x) => x.id === 'hero-small')!;
    const f = domainMomentumFields('ENGINEERING', params, res, { growth7d: 120, growth30d: 300, accelerationRatio: 1.5, stars: 800, ageDays: 200 });
    expect(f).toMatchObject({ mode: 'normalized', trending: true, via: 'band', band: { index: 0, label: 'under 1,200 stars' } });
    expect(f.explanation.length).toBeGreaterThan(0);
  });
  it('the new keys are additive: no clash with the public allow-list, and the strict public gate would currently refuse them', () => {
    for (const k of DOMAIN_RECORD_KEYS) expect((PUBLIC_REPOSITORY_KEYS as readonly string[]).includes(k)).toBe(false);
    const radar = read('data/public/radar.json');
    expect(publicSchemaProblems(radar, null)).toEqual([]);
    const extended = { ...radar, repositories: radar.repositories.map((r: object) => ({ ...r, domain: 'AI' })) };
    expect(publicSchemaProblems(extended, null).join(' ')).toContain('domain');
  });
  it('the measured size of the extension stays under the public warning level', () => {
    const s = read('results/phase6.3/contract-size.json');
    expect(s.extendedUnderWarnLevel).toBe(true);
    expect(s.keyClashesWithCurrentAllowList).toEqual([]);
    expect(s.currentGateRejectsExtendedRecords).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- admission
const NOW = new Date('2026-10-08T00:00:00Z');
const cand = (id: string, stars: number, ageDays: number, o: Partial<AdmissionCandidate> = {}): AdmissionCandidate => ({
  id, fullName: `o/r${id}`, stars, createdAt: new Date(NOW.getTime() - ageDays * 86_400_000).toISOString(), topLevel: 'AI', contentType: 'software', isArchived: false, isFork: false, alreadyCandidate: false, alreadyAdmitted: false, ...o,
});
const A: AdmissionConfig = loadAdmissionConfig();
describe('Phase 6.3 bounded Top-300 admission', () => {
  it('ships in shadow mode with a worst case under its own ceiling', () => {
    expect(A.mode).toBe('shadow');
    expect(worstCaseHistoryRequestsPerDay(A)).toBeLessThanOrEqual(A.budget.maxHistoryRequestsPerDay);
    expect(worstCaseHistoryRequestsPerDay(A)).toBe(1125 + 600);
  });
  it('rejects a configuration whose worst case exceeds the ceiling', () => {
    const raw = read('config/admission.json');
    expect(() => parseAdmissionConfig({ ...raw, budget: { ...raw.budget, maxAdmittedPool: 5000 } })).toThrow(AdmissionConfigError);
    expect(() => parseAdmissionConfig({ ...raw, mode: 'maybe' })).toThrow(/mode/);
  });
  it('applies relevance, lifecycle, novelty and priority gates with a named reason for every rejection', () => {
    const list = [
      cand('1', 5000, 100), // 50/day: admit
      cand('2', 5000, 100, { topLevel: 'UNKNOWN' }),
      cand('3', 5000, 100, { contentType: 'learning' }),
      cand('4', 5000, 100, { isArchived: true }),
      cand('5', 5000, 100, { isFork: true }),
      cand('6', 50, 10), // below the star floor
      cand('7', 5000, 100, { alreadyCandidate: true }),
      cand('8', 5000, 100, { alreadyAdmitted: true }),
      cand('9', 900, 400), // 2.25/day: below priority 10
    ];
    const r = admit(list, A, NOW);
    expect(r.admitted.map((x) => x.id)).toEqual(['1']);
    expect(Object.fromEntries(r.rejected.map((x) => [x.id, x.reason]))).toEqual({ '2': 'not-classified', '3': 'learning-content', '4': 'archived', '5': 'fork', '6': 'below-min-stars', '7': 'already-candidate', '8': 'already-admitted', '9': 'below-priority' });
  });
  it('orders by priority and enforces the weekly cap and the pool cap', () => {
    const many = Array.from({ length: 300 }, (_, i) => cand(String(1000 + i), 3000 + i, 100)); // priority rises with i
    const r = admit(many, A, NOW);
    expect(r.admitted.length).toBe(150);
    expect(r.admitted[0]!.id).toBe('1299');
    expect(r.stats.byReason['weekly-cap']).toBe(150);
    const near = admit(many, A, NOW, 560);
    expect(near.admitted.length).toBe(40);
    expect(near.stats.byReason['pool-cap']).toBe(260);
    expect(admit(many, A, NOW, 600).admitted.length).toBe(0);
  });
  it('is deterministic and independent of input order', () => {
    const many = Array.from({ length: 80 }, (_, i) => cand(String(2000 + i), 4000 + (i % 7) * 100, 100));
    const a = admit(many, A, NOW);
    const b = admit([...many].reverse(), A, NOW);
    expect(a.admitted.map((x) => x.id)).toEqual(b.admitted.map((x) => x.id));
    expect(a.rejected).toEqual(b.rejected);
  });
  it('mode off admits nothing', () => {
    expect(admit([cand('1', 5000, 100)], { ...A, mode: 'off' }, NOW).admitted).toEqual([]);
  });
  it('the shadow list stays inside the configured caps and contains no unclassified repository', () => {
    const s = read('results/phase6.3/admission-shadow.json');
    expect(s.admittedCount).toBeLessThanOrEqual(A.budget.maxNewPerWeek);
    expect(s.worstCaseHistoryRequestsPerDay).toBeLessThanOrEqual(A.budget.maxHistoryRequestsPerDay);
    expect(s.admitted.every((x: { topLevel: string }) => x.topLevel !== 'UNKNOWN')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- leakage, replay, regression
const NOWD = new Date('2026-10-06T12:00:00Z');
const today = utcDate(NOWD);
const mcfg = loadMomentumConfig();
const pcfg = parsePatternConfig(read('config/pattern.json'));
function rec(gains: number[], baseStars = 1000): RepositoryRecord {
  const firstDate = addDays(today, -(gains.length - 1));
  const starHistory = { source: 'github-star-history' as const, fetchedAt: `${today}T12:00:00.000Z`, complete: false, firstDate, dailyGains: gains };
  const stars = baseStars + gains.reduce((a, b) => a + b, 0);
  return {
    id: '1', owner: 'o', name: 'r1', fullName: 'o/r1', url: 'https://github.com/o/r1', description: 'd', language: 'Go', topics: [], license: null, createdAt: new Date(NOWD.getTime() - 800 * 86_400_000).toISOString(), updatedAt: NOWD.toISOString(),
    pushedAt: new Date(NOWD.getTime() - 2 * 86_400_000).toISOString(), isArchived: false, stars, forks: 0, openIssues: 0, metadataSource: 'graphql', collectedAt: NOWD.toISOString(), domains: ['engineering'], categories: ['x'], starHistory,
    growthAsOf: `${today}T12:00:00.000Z`, growth: computeWindowsFromGains(gainsOf(starHistory), false, stars, new Date(`${today}T12:00:00.000Z`)), quality: [],
  } as RepositoryRecord;
}
function rewriteFuture(r: RepositoryRecord, T: string, f: (c: number) => number): RepositoryRecord {
  const gains = gainsOf(r.starHistory);
  let delta = 0;
  const next = gains.map((g) => {
    if (g.date <= T) return g.count;
    const v = f(g.count);
    delta += v - g.count;
    return v;
  });
  return { ...r, stars: r.stars + delta, starHistory: { ...r.starHistory, dailyGains: next } };
}
describe('Phase 6.3 leakage protection', () => {
  const base = rec(Array.from({ length: 120 }, (_, i) => 5 + (i % 9)));
  const T = addDays(today, -30);
  it('the observable row at T ignores everything after T, whatever it is', () => {
    const want = JSON.stringify(observableRow(base, T, mcfg, pcfg));
    for (const f of [() => 0, () => 5000, (c: number) => c * 50, (c: number) => (c % 2 ? 9999 : 0)]) {
      expect(JSON.stringify(observableRow(rewriteFuture(base, T, f), T, mcfg, pcfg))).toBe(want);
    }
  });
  it('the normalised result at T is unchanged when the future is rewritten for the whole population', () => {
    const recs = Array.from({ length: 60 }, (_, k) => ({ ...rec(Array.from({ length: 120 }, (_, i) => (k * 3 + i) % 17)), id: String(k + 1) }));
    const rowsOf = (rs: RepositoryRecord[]) => rs.map((r) => observableRow(r, T, mcfg, pcfg)).filter((x): x is NonNullable<typeof x> => x !== null);
    const a = normalize(rowsOf(recs), P({ minPeers: 5 }));
    const b = normalize(rowsOf(recs.map((r) => rewriteFuture(r, T, (c) => c * 40 + 3))), P({ minPeers: 5 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('a quantity that reads the future DOES change, so the check can see leakage', () => {
    const leaky = (r: RepositoryRecord) => gainsOf(r.starHistory).filter((g) => g.date <= addDays(T, 7)).reduce((a, g) => a + g.count, 0);
    expect(leaky(rewriteFuture(base, T, (c) => c * 50))).not.toBe(leaky(base));
  });
  it('classification input has no time-dependent field, and admission uses only the discovery snapshot', () => {
    const src = readFileSync('src/classification/types.ts', 'utf8');
    const input = src.slice(src.indexOf('export interface ClassificationInput'), src.indexOf('export type SignalKind'));
    expect(input).not.toMatch(/growth|history|gain|velocity|trend/i);
    const adm = readFileSync('src/discovery/admission.ts', 'utf8');
    expect(adm).not.toMatch(/starHistory|dailyGains|growth7d|growth30d/);
  });
  it('the audit on real history found zero differences, and its positive control proves it could see one', () => {
    const a = read('results/phase6.3/leakage-audit.json').summary;
    expect(a.totalDifferences).toBe(0);
    expect(a.repositoryDatePairs).toBeGreaterThanOrEqual(20000);
    expect(a.positiveControl.pairsWhereAFutureReadingWouldDiffer).toBeGreaterThan(10000);
  });
});

describe('Phase 6.3 historical replay and AI regression', () => {
  const replay = read('results/phase6.3/normalization-replay.json');
  const find = (domain: 'ENGINEERING' | 'AI', name: string) => replay[domain].find((m: { config: string }) => m.config === name);
  it('the configured Engineering algorithm is the one that was replayed and it meets the pre-declared eligibility rule', () => {
    const c = loadDomainConfig().ENGINEERING;
    expect(c.mode).toBe('normalized');
    const m = find('ENGINEERING', 'D hybrid 0.98/0.97 frozen g30');
    expect(m).toBeDefined();
    expect(m.shareOfDomainPct).toBeGreaterThanOrEqual(1);
    expect(m.shareOfDomainPct).toBeLessThanOrEqual(2.5);
    expect(m.dayToDayJaccard).toBeGreaterThanOrEqual(0.8);
    expect(m.persistenceNext7AtLeastHalf).toBeGreaterThanOrEqual(0.75);
    expect(m.collapseNext7UnderQuarter).toBeLessThanOrEqual(0.08);
    expect(m.spikeDominatedShare).toBeLessThanOrEqual(0.05);
  });
  it('against the production Rising label the hybrid is larger, stabler in size, and less dominated by very large repositories', () => {
    const prod = find('ENGINEERING', 'P production Rising label');
    const h = find('ENGINEERING', 'D hybrid 0.98/0.97 frozen g30');
    expect(h.shareOfDomainPct).toBeGreaterThan(prod.shareOfDomainPct * 5);
    expect(h.shareUnder5kStars).toBeGreaterThan(prod.shareUnder5kStars * 2);
    expect(h.shareOver50kStars).toBeLessThan(prod.shareOver50kStars);
    expect(h.persistenceNext7AtLeastHalf).toBeGreaterThan(prod.persistenceNext7AtLeastHalf);
  });
  it('AI output is unchanged by Phase 6.3: re-run of the production pipeline matches the committed data', () => {
    const r = read('results/phase6.3/ai-regression.json');
    expect(r.verdict).toBe('AI UNCHANGED');
    expect([r.added, r.removed, r.reordered, r.scoreChanges, r.trendChanges, r.patternChanges, r.recordsWithAnyFieldChange]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(r.wholeRepositoriesArrayIdentical).toBe(true);
    expect(r.historyIdentical).toBe(true);
  });
  it('the production ranking sources have not changed since the regression artefact was produced', () => {
    const r = read('results/phase6.3/ai-regression.json');
    for (const [path, sha] of Object.entries(r.protectedSourceSha256 as Record<string, string>)) {
      const text = readFileSync(path, 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
      expect(createHash('sha256').update(text).digest('hex'), `${path} changed: re-run scripts/momentum/ai-regression.ts and review the AI diff`).toBe(sha);
    }
  });
  it('no production module imports the Phase 6.3 layers (they are shadow/experiment code until wired deliberately)', () => {
    let out = '';
    try {
      out = execSync(`git grep --untracked -l -E "momentum/normalize|/taxonomy'|discovery/admission|domain/contract|/domain'" -- app lib components .github scripts/collect scripts/track scripts/pipeline scripts/momentum/index.ts src/momentum/engine.ts src/momentum/dataset.ts src/pipeline/gate.ts src/pipeline/state.ts src/pipeline/size.ts src/collect src/tracking`, { encoding: 'utf8' }).trim();
    } catch {
      out = ''; // git grep exits 1 when nothing matches
    }
    expect(out).toBe('');
  });
});
