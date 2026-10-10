import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAdmissionConfig } from '../src/discovery/admission';
import { DOMAIN_RECORD_KEYS, LIFECYCLE_KEYS } from '../src/domain/contract';
import { isCooling, isRising, isSustained, loadLifecycleConfig, newToRadar, parseLifecycleConfig, weeklyWindows, baselineWeekly, LifecycleConfigError } from '../src/lifecycle/engineering';
import { DEFAULT_GATE_V2, publicSchemaProblemsV2, type GateV2Options } from '../src/pipeline/gateV2';
import { publicSchemaProblems } from '../src/pipeline/gate';
import { expectedHistoryRequestsPerDay, summarizeCycle, summarizeDiscovery, type DailyRecord } from '../src/shadow/report';
import { csvRecords, parseCsv, toCsv } from '../src/taxonomy/csv';
import { cohensKappa, evaluateTaxonomy, technologyVerdict, validateLabels, wilson, type HumanLabel, type Prediction } from '../src/taxonomy/evaluation';
import { loadTaxonomyV2 } from '../src/taxonomy';
import type { RepositorySnapshot } from '../src/model/repositorySnapshot';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const tax = loadTaxonomyV2();

// ------------------------------------------------------------------------------------------------------ CSV
describe('Phase 6.3.1 labelling sheet CSV', () => {
  it('parses quotes, doubled quotes, embedded commas and newlines, CRLF and a BOM', () => {
    const text = '\uFEFFid,description,notes\r\n1,"a, b ""quoted""",ok\r\n2,"line1\nline2",\r\n';
    expect(parseCsv(text)).toEqual([['id', 'description', 'notes'], ['1', 'a, b "quoted"', 'ok'], ['2', 'line1\nline2', '']]);
  });
  it('round-trips and keys records by header, with missing trailing cells empty', () => {
    const rows = [['id', 'x'], ['1', 'a,"b"\nc'], ['2', '']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(csvRecords('id,a,b\n1,x\n')).toEqual([{ id: '1', a: 'x', b: '' }]);
    expect(csvRecords('')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------ taxonomy metrics
const L = (id: string, o: Partial<HumanLabel> = {}): HumanLabel => ({ id, domainEngineering: 'YES', areas: [], technologies: [], learning: 'NO', type: 'tool', ...o });
const Pd = (id: string, o: Partial<Prediction> = {}): Prediction => ({ id, domainEngineering: true, predictedUnknown: false, areas: [], technologies: [], learning: false, weight: 1, stratum: 's', ...o });

describe('Phase 6.3.1 taxonomy precision and recall', () => {
  const labels: HumanLabel[] = [
    L('1', { areas: ['messaging'], technologies: ['kafka'] }), // correct
    L('2', { areas: ['data'], technologies: ['postgresql', 'redis'] }), // predicted only postgresql: one FN
    L('3', { areas: ['cloud-native'], technologies: ['docker'] }), // predicted kubernetes: FP + FN
    L('4', { domainEngineering: 'NO', type: 'application' }), // predicted engineering: domain FP and tech FP
    L('5', { domainEngineering: 'YES', areas: [], technologies: [] }), // predicted UNKNOWN: domain FN
    L('6', { domainEngineering: 'UNCERTAIN', type: 'other' }), // ambiguous: excluded
    L('7', { learning: 'YES', type: 'educational' }), // predicted learning: correct
    L('8', { learning: 'YES', type: 'educational' }), // not flagged: learning FN
  ];
  const preds: Prediction[] = [
    Pd('1', { areas: ['messaging'], technologies: ['kafka'] }),
    Pd('2', { areas: ['data'], technologies: ['postgresql'] }),
    Pd('3', { areas: ['cloud-native'], technologies: ['kubernetes'] }),
    Pd('4', { technologies: ['docker'] }),
    Pd('5', { domainEngineering: false, predictedUnknown: true }),
    Pd('6'),
    Pd('7', { learning: true }),
    Pd('8'),
  ];
  const ev = evaluateTaxonomy(labels, preds, { labelled: 8, invalid: 0 });
  it('counts true positives, false positives, false negatives and ambiguous cases exactly', () => {
    expect(ev.domain.counts).toEqual({ tp: 5, fp: 1, fn: 1, tn: 0, ambiguous: 1 });
    expect(ev.technology.counts).toEqual({ tp: 2, fp: 2, fn: 2, tn: 0, ambiguous: 1 });
    expect(ev.area.counts).toMatchObject({ tp: 3, fp: 0, fn: 0, ambiguous: 1 });
    expect(ev.learning.counts).toMatchObject({ tp: 1, fn: 1, ambiguous: 0 });
  });
  it('reports precision and recall together, with intervals', () => {
    expect(ev.technology.precision?.rate).toBe(0.5);
    expect(ev.technology.recall?.rate).toBe(0.5);
    expect(ev.domain.precision?.rate).toBeCloseTo(5 / 6, 3);
    expect(ev.domain.recall?.rate).toBeCloseTo(5 / 6, 3);
    expect(ev.technology.precision!.low).toBeLessThan(0.5);
    expect(ev.technology.precision!.high).toBeGreaterThan(0.5);
  });
  it('reports UNKNOWN as a rate and as a miss among labelled Engineering repositories', () => {
    expect(ev.unknownRate).toBeCloseTo(1 / 8, 3);
    expect(ev.unknownAmongEngineering?.n).toBe(6);
    expect(ev.unknownAmongEngineering?.rate).toBeCloseTo(1 / 6, 3);
  });
  it('lists the problem cases with a reason', () => {
    const kinds = ev.problemCases.map((p) => `${p.id}:${p.kind}`);
    expect(kinds).toEqual(expect.arrayContaining(['2:tech-fn', '3:tech-fp', '3:tech-fn', '4:domain-fp', '4:tech-fp', '5:domain-fn', '8:learning-fn']));
  });
  it('weights counts back to the population but keeps interval widths on the raw sample', () => {
    const w = evaluateTaxonomy([L('a', { technologies: ['kafka'] }), L('b', { technologies: ['kafka'] })], [Pd('a', { technologies: ['kafka'], weight: 10 }), Pd('b', { technologies: [], weight: 30 })], { labelled: 2, invalid: 0 });
    expect(w.technology.weighted).toEqual({ tp: 10, fp: 0, fn: 30 });
    expect(w.technology.recall?.rate).toBe(0.25);
    expect(w.technology.recall?.n).toBe(2);
  });
  it('with no labels every metric is null: nothing is invented', () => {
    const e = evaluateTaxonomy([], preds, { labelled: 0, invalid: 0 });
    expect(e.validLabels).toBe(0);
    expect(e.domain.precision).toBeNull();
    expect(e.technology.recall).toBeNull();
    expect(e.unknownRate).toBeNull();
  });
  it('validates labels instead of repairing them', () => {
    const areas = new Set(tax.engineeringAreas.map((a) => a.slug));
    const techs = new Set(tax.technologies.map((t) => t.slug));
    const v = validateLabels([L('1'), L('1'), L('2', { areas: ['nope'] }), L('3', { technologies: ['nope'] }), L('4', { domainEngineering: 'NO', areas: ['data'] }), L('5', { type: null }), L('6', { domainEngineering: 'MAYBE' as never })], areas, techs);
    expect(v.valid.map((x) => x.id)).toEqual(['1']);
    expect(v.invalid.map((x) => x.reason)).toEqual(['duplicate id', 'unknown area nope', 'unknown technology nope', 'areas/technologies given for a repository labelled not Engineering', 'type is required', 'domainEngineering must be YES, NO or UNCERTAIN']);
  });
  it('Wilson interval and Cohen kappa behave on known inputs', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(10, 10)!.high).toBe(1);
    expect(wilson(5, 10)!.low).toBeCloseTo(0.2366, 3);
    expect(cohensKappa(['a', 'b', 'a', 'b'], ['a', 'b', 'a', 'b'])).toBe(1);
    expect(cohensKappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b'])).toBe(0);
    expect(cohensKappa([], [])).toBeNull();
    expect(cohensKappa(['a', 'a'], ['a', 'a'])).toBeNull();
  });
  it('technology verdicts follow the declared thresholds', () => {
    expect(technologyVerdict({ predicted: 1, tp: 1, fp: 0, labelled: 1, fn: 0 })).toBe('insufficient-evidence');
    expect(technologyVerdict({ predicted: 10, tp: 5, fp: 5, labelled: 5, fn: 0 })).toBe('too-broad');
    expect(technologyVerdict({ predicted: 4, tp: 4, fp: 0, labelled: 10, fn: 6 })).toBe('too-narrow');
    expect(technologyVerdict({ predicted: 10, tp: 9, fp: 1, labelled: 10, fn: 1 })).toBe('useful');
    expect(technologyVerdict({ predicted: 10, tp: 7, fp: 3, labelled: 10, fn: 3 })).toBe('ambiguous');
  });
});

// ------------------------------------------------------------------------------------------------------ shadow report
const NOW = new Date('2026-10-10T00:00:00Z');
const snap = (id: string, o: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({
  repositoryId: id, owner: 'o', name: `r${id}`, fullName: `o/r${id}`, url: `https://github.com/o/r${id}`, description: 'd', stars: 5000, forks: 1, openIssues: 0, language: 'Go', topics: [], license: null,
  createdAt: '2026-06-10T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', collectedAt: NOW.toISOString(), source: 'rest', pushedAt: '2026-10-01T00:00:00Z', ...o,
});
const cfg = loadAdmissionConfig();
describe('Phase 6.3.1 shadow discovery report', () => {
  const classify = (s: RepositorySnapshot) => ({ topLevel: (s.topics.includes('x-unknown') ? 'UNKNOWN' : s.topics.includes('x-eng') ? 'ENGINEERING' : 'AI') as 'AI' | 'ENGINEERING' | 'BOTH' | 'UNKNOWN', learning: s.topics.includes('x-learn') });
  const results = [
    { key: 'a|B:top300', query: 'q1', pages: 3, repositories: [snap('1'), snap('2', { topics: ['x-eng'] }), snap('3', { topics: ['x-unknown'] }), snap('4', { isArchived: true }), snap('5', { isFork: true })] },
    { key: 'b|B:top300', query: 'q2', pages: 3, repositories: [snap('1'), snap('6', { topics: ['x-learn'] }), snap('7', { stars: 50 }), snap('8', { stars: 900, createdAt: '2020-01-01T00:00:00Z' })] },
  ];
  const r = summarizeDiscovery({ results, productionIds: new Set(['2']), poolIds: new Set(), classify, config: cfg, now: NOW });
  it('counts queries, requests, raw, unique, duplicate, archived and fork results', () => {
    expect(r.stats).toMatchObject({ queries: 2, searchRequests: 6, rawResults: 9, uniqueRepositories: 8, duplicateResults: 1, archived: 1, forks: 1, usable: 6 });
  });
  it('accounts for every usable repository exactly once', () => {
    const s = r.stats;
    expect(s.newAdmissions + s.rejectedTotal).toBe(s.usable);
    expect(s.proposedAdmissions).toBe(s.newAdmissions + s.capHits.weekly + s.capHits.pool);
    expect(s.alreadyCandidate).toBe(1);
  });
  it('reports each exclusion reason and the UNKNOWN rate among novel repositories', () => {
    expect(r.stats.rejectedByReason).toMatchObject({ 'already-candidate': 1, 'not-classified': 1, 'learning-content': 1, 'below-min-stars': 1, 'below-priority': 1 });
    expect(r.stats.classified.UNKNOWN).toBe(1);
    expect(r.stats.unknownRate).toBeCloseTo(1 / 5, 3);
    expect(r.admitted.map((a) => a.id)).toEqual(['1']);
  });
  it('states the budget arithmetic from the configuration', () => {
    expect(r.budget).toEqual({ currentHistoryRequestsPerDay: 1125, worstCaseHistoryRequestsPerDay: 1725, ceiling: 2000, headroomAtWorstCase: 275 });
    expect(expectedHistoryRequestsPerDay(1125, 150, 0.362)).toBe(1179.3);
  });
  it('is deterministic whatever the arrival order', () => {
    const b = summarizeDiscovery({ results: [...results].reverse().map((x) => ({ ...x, repositories: [...x.repositories].reverse() })), productionIds: new Set(['2']), poolIds: new Set(), classify, config: cfg, now: NOW });
    expect(b.stats).toEqual(r.stats);
    expect(b.admitted).toEqual(r.admitted);
  });
  it('honours the weekly cap and reports the cap hits', () => {
    const many = [{ key: 'c|B:top300', query: 'q', pages: 3, repositories: Array.from({ length: 200 }, (_, i) => snap(String(100 + i), { stars: 6000 + i })) }];
    const c = summarizeDiscovery({ results: many, productionIds: new Set(), poolIds: new Set(), classify, config: cfg, now: NOW });
    expect(c.stats.newAdmissions).toBe(150);
    expect(c.stats.capHits.weekly).toBe(50);
    expect(c.stats.proposedAdmissions).toBe(200);
  });
});

describe('Phase 6.3.1 weekly cycle and API budget safety', () => {
  const day = (date: string, o: Partial<DailyRecord> = {}): DailyRecord => ({ date, historyRequests: 100, historyFailures: 0, productionHistoryRequests: 1100, searchRequests: 0, poolSize: 150, newAdmissions: 0, runtimeSeconds: 300, rateLimit: { remainingAtEnd: 4000, hitLimit: false }, ...o });
  const week = (extra: Partial<DailyRecord> = {}) => ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((d, i) => day(d, i === 0 ? { searchRequests: 198, discovery: summarizeDiscoveryStub(), newAdmissions: 150, ...extra } : {}));
  function summarizeDiscoveryStub() {
    return { stats: { queries: 66, searchRequests: 198, rawResults: 10000, uniqueRepositories: 8000, duplicateResults: 2000, archived: 5, forks: 5, malformed: 0, usable: 7990, alreadyCandidate: 4000, classified: { AI: 1000, ENGINEERING: 1500, BOTH: 200, UNKNOWN: 1290 }, unknownRate: 0.3, belowStarFloor: 100, learningContent: 50, belowPriority: 3000, proposedAdmissions: 400, capHits: { weekly: 250, pool: 0 }, newAdmissions: 150, rejectedTotal: 7840, rejectedByReason: {} }, admitted: [], budget: { currentHistoryRequestsPerDay: 1125, worstCaseHistoryRequestsPerDay: 1725, ceiling: 2000, headroomAtWorstCase: 275 } };
  }
  it('is complete only with seven consecutive UTC days and a discovery run', () => {
    expect(summarizeCycle(week(), 2000).complete).toBe(true);
    expect(summarizeCycle(week().slice(0, 3), 2000).complete).toBe(false);
    const gap = week().filter((d) => d.date !== '2026-10-15');
    expect(summarizeCycle(gap, 2000).complete).toBe(false);
    expect(summarizeCycle(week().map((d) => ({ ...d, discovery: undefined })), 2000).complete).toBe(false);
  });
  it('an empty cycle reports nulls and never a result', () => {
    const e = summarizeCycle([], 2000);
    expect(e).toMatchObject({ complete: false, days: 0, historyRequestsPerDay: null, totalRequestsPerDay: null, admissionRate: null, withinCeiling: null, stopCondition: null });
  });
  it('aggregates admission, rejection, UNKNOWN rates and request statistics', () => {
    const s = summarizeCycle(week(), 2000);
    expect(s.totalCandidates).toBe(8000);
    expect(s.totalProposedAdmissions).toBe(400);
    expect(s.totalAcceptedAdmissions).toBe(150);
    expect(s.admissionRate).toBeCloseTo(150 / 7990, 4);
    expect(s.unknownRate).toBeCloseTo(1290 / 3990, 4);
    expect(s.historyRequestsPerDay).toEqual({ mean: 100, max: 100 });
    expect(s.totalRequestsPerDay).toEqual({ mean: 1200, max: 1200 });
    expect(s.searchRequestsPerWeek).toBe(198);
    expect(s.headroomAtMax).toBe(800);
    expect(s.withinCeiling).toBe(true);
    expect(s.stopCondition).toBeNull();
  });
  it('stops, and never raises the ceiling, when the maximum approaches it', () => {
    const near = week().map((d, i) => (i === 3 ? { ...d, historyRequests: 800 } : d));
    const s = summarizeCycle(near, 2000);
    expect(s.totalRequestsPerDay?.max).toBe(1900);
    expect(s.stopCondition).toContain('stop and review');
    expect(s.stopCondition).toContain('never raised');
    const over = summarizeCycle(week().map((d, i) => (i === 0 ? { ...d, historyRequests: 1200 } : d)), 2000);
    expect(over.withinCeiling).toBe(false);
  });
  it('counts failures and rate-limit hits', () => {
    const s = summarizeCycle(week().map((d, i) => (i < 2 ? { ...d, historyFailures: 3, rateLimit: { remainingAtEnd: 0, hitLimit: true } } : d)), 2000);
    expect(s.failures).toBe(6);
    expect(s.rateLimitHits).toBe(2);
  });
});

describe('Phase 6.3.1 shadow isolation', () => {
  it('the shadow runner refuses to write under production output directories and imports no publication code', () => {
    const s = readFileSync('scripts/shadow/discover.ts', 'utf8');
    expect(s).toContain("['data', 'public', 'out', '.next']");
    expect(s).toContain('shadow isolation: refusing to write');
    expect(s).not.toMatch(/writeFileSync\([^)]*data[\\/]/);
    expect(s).not.toMatch(/pipeline\/(publish|gate)|momentum\/dataset/);
    const r = readFileSync('src/shadow/report.ts', 'utf8');
    expect(r).not.toMatch(/node:fs|writeFile|pipeline\//);
  });
});

// ------------------------------------------------------------------------------------------------------ lifecycle
const lc = loadLifecycleConfig();
const gains = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
describe('Phase 6.3.1 Engineering lifecycle semantics', () => {
  it('the configuration is the one chosen by the replay and is validated', () => {
    expect(lc).toMatchObject({ rising: { persistence: 'threeOfFive' }, cooling: { kind: 'fromHigh' }, newToRadar: { primary: 'firstPublished', maxDaysSinceFirstPublished: 14 } });
    const raw = read('config/lifecycle.engineering.json');
    expect(() => parseLifecycleConfig({ ...raw, cooling: { ...raw.cooling, kind: 'x' } })).toThrow(LifecycleConfigError);
    expect(() => parseLifecycleConfig({ ...raw, newToRadar: { ...raw.newToRadar, primary: 'discovered' } })).toThrow(/firstPublished/);
    expect(() => parseLifecycleConfig({ ...raw, schemaVersion: 2 })).toThrow(LifecycleConfigError);
  });
  it('weekly windows need 35 days and sum exact calendar weeks', () => {
    expect(weeklyWindows(gains(34, () => 1))).toBeNull();
    const w = weeklyWindows(gains(35, (i) => (i < 7 ? 1 : i < 14 ? 2 : i < 21 ? 3 : i < 28 ? 4 : 5)))!;
    expect(w).toEqual({ w0: 35, w1: 28, w2: 21, w3: 14, w4: 7 });
    expect(baselineWeekly(w)).toBe(17.5);
  });
  it('Rising is durable Trending: persistence rules are exact and a missing day counts as not Trending', () => {
    expect(isRising(false, [true, true, true, true], 'none')).toBe(false);
    expect(isRising(true, [], 'none')).toBe(true);
    expect(isRising(true, [true], 'twoDays')).toBe(true);
    expect(isRising(true, [false, true], 'twoDays')).toBe(false);
    expect(isRising(true, [true, undefined, true, false], 'threeOfFive')).toBe(true); // today + 2 of the previous 4
    expect(isRising(true, [true, undefined, undefined, false], 'threeOfFive')).toBe(false);
    expect(isRising(true, [], 'threeOfFive')).toBe(false);
  });
  const w = (w0: number, w1: number, w2: number, w3: number, w4: number) => ({ w0, w1, w2, w3, w4 });
  const base = { productionCooling: false, baselinePercentile: 0.95, trendingHistory: [] as (boolean | undefined)[], trendingToday: false };
  it('Cooling candidates are exact', () => {
    // fromHigh: baseline in the top decile, this week under half of the 28-day baseline, baseline at least the floor
    expect(isCooling('fromHigh', { ...base, w: w(40, 100, 100, 100, 100) }, lc.cooling)).toBe(true);
    expect(isCooling('fromHigh', { ...base, w: w(60, 100, 100, 100, 100) }, lc.cooling)).toBe(false);
    expect(isCooling('fromHigh', { ...base, baselinePercentile: 0.5, w: w(40, 100, 100, 100, 100) }, lc.cooling)).toBe(false);
    expect(isCooling('fromHigh', { ...base, w: w(1, 20, 20, 20, 20) }, lc.cooling)).toBe(false); // baseline below the floor: a quiet repository is not "cooling"
    expect(isCooling('twoDeclines', { ...base, w: w(30, 60, 100, 100, 100) }, lc.cooling)).toBe(true);
    expect(isCooling('twoDeclines', { ...base, w: w(30, 60, 40, 100, 100) }, lc.cooling)).toBe(false);
    expect(isCooling('lostTrending', { ...base, trendingHistory: [false, true], w: w(20, 100, 80, 0, 0) }, lc.cooling)).toBe(true);
    expect(isCooling('lostTrending', { ...base, trendingToday: true, trendingHistory: [true], w: w(20, 100, 80, 0, 0) }, lc.cooling)).toBe(false);
    expect(isCooling('production', { ...base, productionCooling: true, w: w(1, 1, 1, 1, 1) }, lc.cooling)).toBe(true);
  });
  it('Sustained needs a top-percentile 30-day growth and enough weeks above the weekly floor', () => {
    expect(isSustained(w(40, 35, 31, 10, 0), 0.97, lc.sustained)).toBe(true);
    expect(isSustained(w(40, 35, 20, 10, 0), 0.97, lc.sustained)).toBe(false);
    expect(isSustained(w(40, 35, 31, 31, 0), 0.9, lc.sustained)).toBe(false);
  });
  it('New to Radar is defined by first publication, not by discovery, admission or repository age', () => {
    const f = { firstPublishedAt: '2026-10-05', createdAt: '2019-01-01T00:00:00Z', firstDiscoveredAt: '2026-10-05', firstAdmittedAt: '2026-10-05' };
    expect(newToRadar(f, '2026-10-10', lc.newToRadar)).toEqual({ newToRadar: true, daysSinceFirstPublished: 5, genuinelyNew: false });
    expect(newToRadar({ ...f, firstPublishedAt: '2026-09-01' }, '2026-10-10', lc.newToRadar).newToRadar).toBe(false);
    expect(newToRadar({ ...f, firstPublishedAt: null }, '2026-10-10', lc.newToRadar)).toMatchObject({ newToRadar: false, daysSinceFirstPublished: null });
    expect(newToRadar({ firstPublishedAt: '2026-01-01', createdAt: '2026-09-20T00:00:00Z' }, '2026-10-10', lc.newToRadar)).toMatchObject({ newToRadar: false, genuinelyNew: true });
    expect(newToRadar({ ...f, firstPublishedAt: '2026-10-14' }, '2026-10-10', lc.newToRadar).newToRadar).toBe(false); // a future date is not new
  });
  it('is deterministic', () => {
    const a = JSON.stringify([isRising(true, [true, true], 'threeOfFive'), isCooling('fromHigh', { ...base, w: w(1, 100, 100, 100, 100) }, lc.cooling)]);
    expect(a).toBe(JSON.stringify([isRising(true, [true, true], 'threeOfFive'), isCooling('fromHigh', { ...base, w: w(1, 100, 100, 100, 100) }, lc.cooling)]));
  });
});

// ------------------------------------------------------------------------------------------------------ public gate design
const OPT: GateV2Options = { knownAreas: new Set(tax.engineeringAreas.map((a) => a.slug)), knownTechnologies: new Set(tax.technologies.map((t) => t.slug)), ...DEFAULT_GATE_V2 };
const radar = read('data/public/radar.json');
function extend(r: typeof radar, mk: (rec: Record<string, unknown>) => Record<string, unknown>) {
  return { ...r, domainContractVersion: 1, repositories: r.repositories.map((rec: Record<string, any>) => (rec.classification.topLevel === 'ENGINEERING' ? { ...rec, ...mk(rec) } : rec)) };
}
const goodFields = () => ({
  domain: 'ENGINEERING', areas: ['data'], technologies: ['postgresql'], facets: { language: 'Go', ageBand: 'established', contentType: 'software' },
  domainMomentum: { mode: 'normalized', trending: true, via: 'both', domainPercentile: 99, bandPercentile: 98, band: { index: 1, label: '1,200-5,999 stars', peers: 800 }, explanation: ['30-day growth of +1,333 stars is in the top 2% of Engineering repositories (percentile 99).'] },
  engineeringLifecycle: { trending: true, rising: true, accelerating: false, breakout: false, cooling: false, sustained: false, newToRadar: false, genuinelyNew: false, firstPublishedAt: '2026-09-01' },
});
describe('Phase 6.3.1 public-data gate design (shadow)', () => {
  it('the production gate is unchanged: it still refuses every new key and the committed data passes', () => {
    expect(publicSchemaProblems(radar, null)).toEqual([]);
    const msg = publicSchemaProblems(extend(radar, goodFields), null).join(' ');
    for (const k of DOMAIN_RECORD_KEYS) expect(msg).toContain(k);
  });
  it('the designed gate accepts a well-formed Engineering extension and the unchanged dataset', () => {
    expect(publicSchemaProblemsV2(radar, null, OPT)).toEqual([]);
    expect(publicSchemaProblemsV2(extend(radar, goodFields), null, OPT)).toEqual([]);
  });
  it('PERMANENT: introducing Engineering fields leaves every AI and BOTH record, every list and the history byte-identical', () => {
    const ext = extend(radar, goodFields);
    const keep = (r: { classification: { topLevel: string } }) => r.classification.topLevel !== 'ENGINEERING';
    expect(JSON.stringify(ext.repositories.filter(keep))).toBe(JSON.stringify(radar.repositories.filter(keep)));
    expect(JSON.stringify(ext.lists)).toBe(JSON.stringify(radar.lists));
    expect(ext.repositories.length).toBe(radar.repositories.length);
    const strip = ({ domainContractVersion: _v, repositories: _r, ...rest }: Record<string, unknown>) => JSON.stringify(rest);
    expect(strip(ext)).toBe(strip(radar));
    expect(radar.repositories.filter((r: { classification: { topLevel: string } }) => r.classification.topLevel === 'ENGINEERING').length).toBeGreaterThan(1000);
  });
  it('rejects the new keys on AI and BOTH records', () => {
    const bad = { ...radar, repositories: radar.repositories.map((r: Record<string, any>, i: number) => (i === radar.repositories.findIndex((x: Record<string, any>) => x.classification.topLevel === 'AI') ? { ...r, ...goodFields() } : r)) };
    expect(publicSchemaProblemsV2(bad, null, OPT).join(' ')).toContain('only allowed on ENGINEERING');
  });
  it.each([
    ['unknown key at record level', (f: any) => ({ ...f, secret: 1 }), 'unexpected key'],
    ['unknown technology', (f: any) => ({ ...f, technologies: ['nope'] }), 'unknown slug'],
    ['unknown area', (f: any) => ({ ...f, areas: ['nope'] }), 'unknown slug'],
    ['duplicate technology', (f: any) => ({ ...f, technologies: ['redis', 'redis'] }), 'duplicates'],
    ['bad domain', (f: any) => ({ ...f, domain: 'AI' }), 'must have domain ENGINEERING'],
    ['bad facet', (f: any) => ({ ...f, facets: { language: 'Go', ageBand: 'ancient', contentType: 'software' } }), 'ageBand'],
    ['unknown facet key', (f: any) => ({ ...f, facets: { ...f.facets, quality: 9 } }), 'unexpected key'],
    ['percentile out of range', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, domainPercentile: 101 } }), 'integer 0-100'],
    ['unknown momentum key', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, score: 1 } }), 'unexpected key'],
    ['explanation with a local path', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, explanation: ['see C:\\Users\\x\\data'] } }), 'unsafe text'],
    ['explanation with a URL', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, explanation: ['see https://example.com'] } }), 'unsafe text'],
    ['explanation mentions localhost', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, explanation: ['localhost:3000'] } }), 'unsafe text'],
    ['explanation on a non-trending record', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, trending: false } }), 'only allowed on a trending'],
    ['too many sentences', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, explanation: ['a', 'b', 'c', 'd', 'e'] } }), 'more than 4 sentences'],
    ['rising without trending', (f: any) => ({ ...f, engineeringLifecycle: { ...f.engineeringLifecycle, trending: false } }), 'rising requires trending'],
    ['newToRadar without a publication date', (f: any) => ({ ...f, engineeringLifecycle: { ...f.engineeringLifecycle, newToRadar: true, firstPublishedAt: null } }), 'requires firstPublishedAt'],
    ['lifecycle key unknown', (f: any) => ({ ...f, engineeringLifecycle: { ...f.engineeringLifecycle, hot: true } }), 'unexpected key'],
    ['synthetic marker', (f: any) => ({ ...f, domainMomentum: { ...f.domainMomentum, band: { index: 0, label: '_synthetic', peers: 1 } } }), 'short safe text'],
  ])('rejects: %s', (_n, mutate, expected) => {
    const ext = extend(radar, () => mutate(goodFields()));
    expect(publicSchemaProblemsV2(ext, null, OPT).join(' | ')).toContain(expected);
  });
  it('rejects a token-shaped string, an oversized addition, an unknown top-level key and a wrong contract version', () => {
    const tok = 'ghp_' + 'a'.repeat(36);
    const withToken = extend(radar, () => ({ ...goodFields(), domainMomentum: { ...goodFields().domainMomentum, band: { index: 1, label: tok, peers: 1 } } }));
    expect(publicSchemaProblemsV2(withToken, null, OPT).length).toBeGreaterThan(0);
    const big = extend(radar, () => ({ ...goodFields(), technologies: Array.from({ length: 80 }, () => 'redis') }));
    expect(publicSchemaProblemsV2(big, null, OPT).join(' ')).toContain('bytes');
    expect(publicSchemaProblemsV2({ ...radar, extra: 1 }, null, OPT).join(' ')).toContain('unexpected top-level key');
    expect(publicSchemaProblemsV2({ ...radar, domainContractVersion: 2 }, null, OPT).join(' ')).toContain('domainContractVersion');
  });
  it('still rejects an undocumented key among the ORIGINAL keys (the original rules cannot be bypassed)', () => {
    const bad = { ...radar, repositories: radar.repositories.map((r: object, i: number) => (i === 0 ? { ...r, undocumented: 1 } : r)) };
    expect(publicSchemaProblemsV2(bad, null, OPT).join(' ')).toContain('unexpected key');
  });
  it('the contract key lists match the gate', () => {
    expect([...DOMAIN_RECORD_KEYS]).toEqual(['domain', 'areas', 'technologies', 'facets', 'domainMomentum', 'engineeringLifecycle']);
    expect([...LIFECYCLE_KEYS]).toContain('firstPublishedAt');
  });
});
