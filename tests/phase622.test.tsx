import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRecord } from '../src/collect/dataset';
import { evaluateCurrent } from '../src/backtest';
import { parsePatternConfig } from '../src/explain/pattern';
import { dailyCost, isValidSnapshot, normalizeHits, seededSample, shadowQueries, stratifiedSample, valueClass, weightedRate, type ValueThresholds } from '../src/discovery/shadow';
import { loadMomentumConfig } from '../src/momentum/config';
import type { RepositorySnapshot } from '../src/model/repositorySnapshot';
import type { StarHistorySeries } from '../src/model/starHistory';

const NOW = new Date('2026-10-08T00:00:00Z');
const snap = (id: string, o: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({
  repositoryId: id,
  owner: 'o',
  name: `r${id}`,
  fullName: `o/r${id}`,
  url: `https://github.com/o/r${id}`,
  description: 'd',
  stars: 500,
  forks: 1,
  openIssues: 0,
  language: 'Go',
  topics: ['llm'],
  license: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  collectedAt: NOW.toISOString(),
  source: 'rest',
  pushedAt: '2026-10-01T00:00:00Z',
  ...o,
});

describe('Phase 6.2.2 repository identity, dedup and filtering', () => {
  it('deduplicates by numeric repository id, so a rename does not create a second candidate', () => {
    const r = normalizeHits([snap('7', { fullName: 'old/name' }), snap('7', { fullName: 'new/name' }), snap('8')]);
    expect(r.repositories.map((x) => x.repositoryId)).toEqual(['7', '8']);
    expect(r.rejected.duplicate).toBe(1);
  });
  it('drops forks and archived repositories and counts them', () => {
    const r = normalizeHits([snap('1', { isFork: true }), snap('2', { isArchived: true }), snap('3')]);
    expect(r.repositories.map((x) => x.repositoryId)).toEqual(['3']);
    expect(r.rejected).toEqual({ malformed: 0, fork: 1, archived: 1, duplicate: 0 });
  });
  it('rejects malformed results instead of throwing', () => {
    const bad: unknown[] = [
      null,
      'x',
      42,
      {},
      { repositoryId: 'abc', fullName: 'a/b', stars: 1, createdAt: '2026-01-01', topics: [] },
      snap('9', { stars: -1 }),
      snap('10', { createdAt: 'nope' }),
      { ...snap('11'), topics: 'llm' },
      snap('12', { fullName: 'noslash' }),
    ];
    const r = normalizeHits(bad);
    expect(r.repositories).toEqual([]);
    expect(r.rejected.malformed).toBe(bad.length);
    expect(isValidSnapshot(snap('1'))).toBe(true);
  });
  it('is independent of arrival order', () => {
    const items = ['5', '1', '30', '2'].map((i) => snap(i));
    expect(normalizeHits(items).repositories).toEqual(normalizeHits([...items].reverse()).repositories);
    expect(normalizeHits(items).repositories.map((x) => x.repositoryId)).toEqual(['1', '2', '5', '30']);
  });
});

describe('Phase 6.2.2 strategy determinism and API budget', () => {
  it('the same topic and date always give the same queries, with unique keys and fixed sorts', () => {
    const a = shadowQueries('llm', NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(shadowQueries('llm', NOW)));
    expect(new Set(a.map((q) => q.key)).size).toBe(a.length);
    expect(a.every((q) => ['stars', 'updated', 'forks'].includes(q.sort))).toBe(true);
    expect(a.find((q) => q.key === 'llm|B:top300')).toMatchObject({ pages: 3, sort: 'stars' });
  });
  it('costs at most 9 search requests per topic and never asks for more than 3 pages', () => {
    const qs = shadowQueries('rag', NOW);
    expect(qs.reduce((a, q) => a + q.pages, 0)).toBeLessThanOrEqual(9);
    expect(Math.max(...qs.map((q) => q.pages))).toBe(3);
  });
  it('bands are bounded and use a date window relative to the run date', () => {
    const c = shadowQueries('mcp', NOW).filter((q) => q.strategy === 'C');
    expect(c.length).toBe(4);
    expect(c.every((q) => /stars:\d+\.\.\d+/.test(q.query))).toBe(true);
    expect(c.some((q) => q.query.includes('created:>2026-04-11'))).toBe(true);
  });
  it('daily cost adds weekly searches spread over seven days to history refreshes', () => {
    const c = dailyCost({ searchRequestsPerWeek: 700, addedTracked: 100, historyRequestsPerRepoPerDay: 0.5, searchPerMinute: 30 });
    expect(c.searchPerDay).toBe(100);
    expect(c.historyPerDay).toBe(50);
    expect(c.totalPerDay).toBe(150);
    expect(c.weeklySearchMinutes).toBeCloseTo(700 / 30);
  });
});

describe('Phase 6.2.2 sampling and estimation', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), s: i % 4 === 0 ? 'x' : 'y' }));
  it('seeded sampling is reproducible and different seeds differ', () => {
    const a = seededSample(items, 20, 1, (t) => t.id);
    expect(a).toEqual(seededSample([...items].reverse(), 20, 1, (t) => t.id));
    expect(a).not.toEqual(seededSample(items, 20, 2, (t) => t.id));
  });
  it('stratified sample covers every stratum and reports stratum sizes for weighting', () => {
    const s = stratifiedSample(items, (t) => t.s, 40, 7, (t) => t.id);
    const x = s.filter((r) => r.stratum === 'x');
    const y = s.filter((r) => r.stratum === 'y');
    expect(x.length).toBeGreaterThan(0);
    expect(y.length).toBeGreaterThan(x.length);
    expect(x[0]!.stratumSize).toBe(50);
    expect(y[0]!.stratumSize).toBe(150);
    expect(JSON.stringify(s)).toBe(JSON.stringify(stratifiedSample(items, (t) => t.s, 40, 7, (t) => t.id)));
  });
  it('weighted rate recovers the population rate and brackets it with an interval', () => {
    const samples = [...Array(10)].map((_, i) => ({ weight: 10, hit: i < 3 })).concat([...Array(10)].map(() => ({ weight: 30, hit: false })));
    const r = weightedRate(samples)!;
    expect(r.population).toBe(400);
    expect(r.estimatedHits).toBe(30);
    expect(r.rate).toBeCloseTo(0.075);
    expect(r.low).toBeLessThan(r.rate);
    expect(r.high).toBeGreaterThan(r.rate);
    expect(weightedRate([])).toBeNull();
  });
});

describe('Phase 6.2.2 value classes use the production Rising rules', () => {
  const t: ValueThresholds = { grower: { minVelocity7d: 8, minGrowth7d: 56 }, nearFraction: 0.5, rising: { minVelocity7d: 100, minGrowth7d: 700 } };
  const g = (growth7d: number | null, velocity7d: number | null, trend = 'STEADY') => ({ growth7d, growth30d: null, growth90d: null, velocity7d, velocity30d: null, trend, score: null });
  it('classifies in a fixed best-first order', () => {
    expect(valueClass(g(null, null), t)).toBe('UNMEASURED');
    expect(valueClass(g(900, 128, 'RISING'), t)).toBe('RISING');
    expect(valueClass(g(400, 57, 'STEADY'), t)).toBe('NEAR_RISING');
    expect(valueClass(g(349, 49.9), t)).toBe('GROWER');
    expect(valueClass(g(60, 8.6), t)).toBe('GROWER');
    expect(valueClass(g(20, 2.8), t)).toBe('QUIET');
  });
});

describe('Phase 6.2.2 star-history measurement reuses the production pipeline', () => {
  const mcfg = loadMomentumConfig();
  const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
  // 30 contiguous weeks ending with the week 2026-09-30..10-06: 10 stars/day, then 100/day in the last two weeks
  const weeks = Array.from({ length: 30 }, (_, i) => {
    const start = Date.parse('2026-09-30T00:00:00Z') / 1000 - (29 - i) * 7 * 86400;
    const per = i >= 28 ? 100 : 10;
    return { week: start, total: per * 7, days: Array(7).fill(per) as number[] };
  });
  const series: StarHistorySeries = { repository: 'o/r1', weeks, complete: false, pages: 1, requests: 1, bytes: 1, rolloverDuplicates: 0, restarted: false, fetchedAt: '2026-10-06T12:00:00.000Z' };
  it('7, 30 and 90 day growth come out of the same code that publishes the Radar', () => {
    const asOf = new Date('2026-10-06T12:00:00Z');
    const r = buildRecord(snap('1', { stars: 9000, createdAt: '2025-01-01T00:00:00Z', pushedAt: '2026-10-05T00:00:00Z' }), { domains: ['ai'], categories: [] }, series, [], asOf);
    const e = evaluateCurrent(r, asOf.toISOString(), asOf, mcfg, pcfg);
    expect(e.growth7d).toBe(700);
    expect(e.growth30d).toBe(14 * 100 + 16 * 10);
    expect(e.growth90d).toBe(14 * 100 + 76 * 10);
    expect(e.velocity7d).toBe(100);
  });
});

describe('Phase 6.2.2 is isolated from production', () => {
  it('no production module imports the shadow experiment', () => {
    const hits = execSync('git grep --untracked -l "discovery/shadow" -- src scripts app lib components .github', { encoding: 'utf8' }).split('\n').filter(Boolean);
    // Phase 6.3 added scripts/discovery/admission-sim.ts and Phase 6.3.1 src/shadow/report.ts and scripts/taxonomy/build-sample.ts, which reuse the shadow helpers: experiment code importing experiment code
    expect(hits.sort()).toEqual(['scripts/discovery/admission-sim.ts', 'scripts/discovery/shadow.ts', 'scripts/taxonomy/build-sample.ts', 'src/shadow/report.ts']);
  });
  it('the shadow script writes only through the cache and results/phase6.2.2 paths', () => {
    const s = readFileSync('scripts/discovery/shadow.ts', 'utf8');
    expect(s).toContain("const OUT = 'results/phase6.2.2'");
    expect([...s.matchAll(/writeJson\(([^,]+),/g)].every((m) => /SEARCH_CACHE|HISTORY_CACHE|join\(OUT/.test(m[1] as string))).toBe(true);
    expect(s).not.toMatch(/writeFileSync\([^)]*(data\/|config\/)/);
  });
});

describe('Phase 6.2.2 result artefacts are internally consistent', () => {
  const read = (f: string) => JSON.parse(readFileSync(`results/phase6.2.2/${f}`, 'utf8'));
  it('final sample is complete and the probe is fully accounted for', () => {
    const c = read('comparison.json');
    expect(c.meta.sampleRun.measured).toBe(200);
    expect(c.meta.sampleRun.failed).toBe(0);
    const p = read('probe.json');
    expect(p.selected).toBe(40);
    expect(p.n).toBe(40);
    expect(Object.values(p.byClass as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(40);
    expect(p.qualifyingRising).toBe(p.byClass.RISING);
    expect(p.selection).toContain('LIFETIME STAR/DAY DISCOVERY PROXY');
  });
  it('probe Rising by strategy never exceeds the probe Rising total, and every repository carries its evidence', () => {
    const p = read('probe.json');
    for (const v of Object.values(p.risingFoundByStrategy as Record<string, number>)) expect(v).toBeLessThanOrEqual(p.qualifyingRising);
    for (const r of p.repositories as Record<string, unknown>[]) {
      for (const k of ['fullName', 'classification', 'stars', 'ageDays', 'trend', 'foundBy', 'knownToPipelineState', 'onCurrentQueryPage1']) expect(r).toHaveProperty(k);
    }
  });
  it('the comparison table covers current, B, C, D and E with the same measured values as the strategy files', () => {
    const t = read('table.json');
    expect(Object.keys(t).sort()).toEqual(['B', 'C', 'D', 'E', 'current', 'note']);
    expect(t.B.newCandidates).toBe(read('top300.json').newRepos);
    expect(t.C.newCandidates).toBe(read('recent-star-bands.json').newRepos);
    expect(t.D.newCandidates).toBe(read('multi-sort.json').newRepos);
    expect(t.E.newCandidates).toBe(read('hybrid.json').newRepos);
  });
  it('production public data is untouched by the experiment', () => {
    const status = execSync('git status --porcelain -- data config/momentum.json config/pattern.json config/tracking.json config/classification.json config/categories src/momentum/engine.ts src/momentum/config.ts src/momentum/dataset.ts src/momentum/types.ts src/tracking src/classification app lib components', { encoding: 'utf8' });
    expect(status.trim()).toBe('');
  });
});
