import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, utcDate } from '../src/analysis/starHistory';
import { computeWindowsFromGains } from '../src/analysis/windows';
import type { ClassifiedDataset } from '../src/classification/datasets';
import { gainsOf, type Dataset, type RepositoryRecord } from '../src/collect/dataset';
import { MomentumConfigError, loadMomentumConfig, parseMomentumConfig } from '../src/momentum/config';
import { buildMomentumDataset, derivePublic, validateMomentumDataset } from '../src/momentum/dataset';
import { computeGrowthMetrics, evaluateRepository } from '../src/momentum/engine';

const cfg = loadMomentumConfig();
const NOW = new Date('2026-09-25T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

interface Opts {
  id?: string;
  createdDaysAgo?: number;
  stars: number;
  gains: number[];
  complete?: boolean;
  pushedDaysAgo?: number | null;
  archived?: boolean;
  name?: string;
}

/** A repository record whose daily gains end on NOW's date. */
function rec(o: Opts): RepositoryRecord {
  const complete = o.complete ?? false;
  const firstDate = addDays(utcDate(NOW), -(o.gains.length - 1));
  const starHistory = { source: 'github-star-history' as const, fetchedAt: NOW.toISOString(), complete, firstDate, dailyGains: o.gains };
  const id = o.id ?? '1';
  return {
    id, owner: 'o', name: o.name ?? `r${id}`, fullName: `o/${o.name ?? `r${id}`}`, url: `https://github.com/o/${o.name ?? `r${id}`}`, description: 'A repository description',
    language: 'Go', topics: [], license: null, createdAt: daysAgo(o.createdDaysAgo ?? 800), updatedAt: NOW.toISOString(),
    pushedAt: o.pushedDaysAgo === null ? null : daysAgo(o.pushedDaysAgo ?? 2), isArchived: o.archived ?? false,
    stars: o.stars, forks: 0, openIssues: 0, metadataSource: 'graphql', collectedAt: NOW.toISOString(), domains: ['ai'], categories: ['x'],
    starHistory, growthAsOf: NOW.toISOString(),
    growth: computeWindowsFromGains(gainsOf(starHistory), complete, o.stars, NOW), quality: [],
  };
}

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
/** `days` of `old` stars/day followed by 7 days of `recent` stars/day. */
const shaped = (days: number, old: number, recent: number) => [...flat(days - 7, old), ...flat(7, recent)];
const evalOne = (r: RepositoryRecord) => evaluateRepository(r, NOW.toISOString(), NOW, cfg);
const dataset = (records: RepositoryRecord[]): Dataset => ({ schemaVersion: 1, generatedAt: NOW.toISOString(), asOfDate: utcDate(NOW), historyPagesPerRepository: 1, stats: { repositories: records.length, byDomain: {} }, repositories: records });

describe('growth metrics: 7d / 30d / 90d, percent, stars per day', () => {
  const r = rec({ stars: 5000, gains: flat(120, 10) });
  const gm = computeGrowthMetrics(r, NOW, cfg);

  it('L/M/N. growth over 7, 30 and 90 days', () => {
    expect([gm.w7.growth, gm.w30.growth, gm.w90.growth]).toEqual([70, 300, 900]);
    expect([gm.w7.full, gm.w30.full, gm.w90.full]).toEqual([true, true, true]);
  });

  it('O. percentage growth = growth / stars at window start', () => {
    expect(gm.w7.growthPercent).toBe(1.4199); // 70 / 4930
    expect(gm.w30.growthPercent).toBe(6.383); // 300 / 4700
    expect(gm.w90.growthPercent).toBe(21.9512); // 900 / 4100
  });

  it('P. stars per day over each window (spec example: +1,400 in 7 days -> 200/day)', () => {
    expect([gm.w7.velocity, gm.w30.velocity, gm.w90.velocity]).toEqual([10, 10, 10]);
    const spec = computeGrowthMetrics(rec({ stars: 10_000, gains: shaped(100, 50, 200) }), NOW, cfg);
    expect(spec.w7).toMatchObject({ growth: 1400, velocity: 200 });
    expect(10_000 - (spec.w7.growth as number)).toBe(8600);
  });

  it('J. positive growth; I. zero growth is a measured 0, not null', () => {
    const quiet = computeGrowthMetrics(rec({ stars: 1000, gains: flat(100, 0) }), NOW, cfg);
    expect(quiet.w7.growth).toBe(0);
    expect(quiet.w7.velocity).toBe(0);
    expect(quiet.w7.status).toBe('ok');
    expect(quiet.w30.growth).toBe(0);
    expect(gm.w7.growth).toBeGreaterThan(0);
  });

  it('G/H. history that does not reach back far enough gives null, never 0', () => {
    const short = computeGrowthMetrics(rec({ stars: 1000, gains: flat(20, 5) }), NOW, cfg);
    expect(short.w7.growth).toBe(35);
    expect(short.w30).toMatchObject({ growth: null, growthPercent: null, velocity: null, status: 'insufficient-history' });
    expect(short.w90).toMatchObject({ growth: null, status: 'insufficient-history' });
  });

  it('K. invalid history (sums to more than the star count) is inconsistent: null, not a made-up number', () => {
    const bad = computeGrowthMetrics(rec({ stars: 100, gains: flat(100, 10) }), NOW, cfg);
    expect(bad.w30).toMatchObject({ growth: null, status: 'inconsistent' });
    expect(bad.w90.velocity).toBeNull();
  });

  it('a stale history (does not reach the as-of day) is insufficient, not zero', () => {
    const r2 = rec({ stars: 1000, gains: flat(100, 5) });
    r2.starHistory.firstDate = addDays(r2.starHistory.firstDate, -10); // history ends 10 days before asOf
    expect(computeGrowthMetrics(r2, NOW, cfg).w7.status).toBe('insufficient-history');
  });
});

describe('small / new repositories are not penalised', () => {
  it('created 5 days ago: 7d reported over the days that exist, 30d and 90d null (never 0)', () => {
    const gm = computeGrowthMetrics(rec({ createdDaysAgo: 5, stars: 500, gains: flat(6, 100).slice(0, 5).concat([0]), complete: true }), NOW, cfg);
    expect(gm.w7).toMatchObject({ status: 'partial-window', growth: 500, observedDays: 5, velocity: 100, full: false });
    expect(gm.w30).toMatchObject({ status: 'insufficient-age', growth: null, velocity: null, growthPercent: null });
    expect(gm.w90).toMatchObject({ status: 'insufficient-age', growth: null });
  });

  it('created 20 days ago: 7d full, 30d null', () => {
    const gm = computeGrowthMetrics(rec({ createdDaysAgo: 20, stars: 400, gains: flat(20, 20), complete: true }), NOW, cfg);
    expect(gm.w7.full).toBe(true);
    expect(gm.w30.status).toBe('insufficient-age');
  });

  it('a young repository still gets a score from its 7-day evidence, with completeness < 1 and an explanation of what is missing', () => {
    const e = evalOne(rec({ createdDaysAgo: 5, stars: 500, gains: [100, 100, 100, 100, 100, 0], complete: true }));
    expect(e.momentum.score).not.toBeNull();
    expect(e.momentum.completeness).toBeLessThan(1);
    expect(e.explanation.join('\n')).toContain('30-day growth not available: repository is 5 days old');
    expect(e.explanation.join('\n')).toContain('90-day growth not available');
  });
});

describe('momentum: signals and score', () => {
  it('exposes raw signals before any composite', () => {
    const s = evalOne(rec({ stars: 20_000, gains: shaped(120, 10, 30) })).signals;
    expect(s).toMatchObject({ growth7d: 210, growth30d: 210 + 23 * 10, velocity7d: 30, priorVelocity: 10, accelerationRatio: 3, velocityDelta: 20, lifetimeStars: 20_000 });
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['growth7d', 'growth30d', 'growth90d', 'velocity7d', 'velocity30d', 'velocity90d', 'growthPercent7d', 'accelerationRatio', 'sustained', 'newEntrant']));
  });

  it('lifetime stars do not dominate: 10k stars at +2,500/week beats 100k stars at +100/week', () => {
    const a = evalOne(rec({ id: '1', stars: 100_000, gains: flat(120, 100 / 7) .map((x) => Math.round(x * 7) / 7) }));
    const b = evalOne(rec({ id: '2', stars: 10_000, gains: flat(120, 2500 / 7) }));
    expect((b.momentum.score as number)).toBeGreaterThan((a.momentum.score as number) + 20);
    // and lifetime stars are context only: same growth on a bigger base changes only the percentage component
    const small = evalOne(rec({ id: '3', stars: 20_000, gains: flat(120, 50) }));
    const big = evalOne(rec({ id: '4', stars: 2_000_000, gains: flat(120, 50) }));
    expect(small.momentum.components.find((c) => c.name === 'velocity')!.value).toBe(big.momentum.components.find((c) => c.name === 'velocity')!.value);
  });

  it('percentage-growth trap: +200% from a tiny base does not beat +20% on a large base', () => {
    const tiny = evalOne(rec({ id: '1', stars: 30, gains: [...flat(90, 0), ...flat(23, 0), ...flat(7, 20 / 7)].slice(0, 120), complete: false }));
    const large = evalOne(rec({ id: '2', stars: 12_000, gains: flat(120, 2000 / 30) }));
    expect(tiny.signals.growthPercent30d).toBeGreaterThan(large.signals.growthPercent30d as number);
    expect(large.momentum.score as number).toBeGreaterThan(tiny.momentum.score as number);
    const rel = tiny.momentum.components.find((c) => c.name === 'relativeGrowth')!;
    expect(rel.note).toContain('weighted by');
  });

  it('the score has no ceiling that produces ties: two huge velocities still differ, and stay below 100', () => {
    const x = evalOne(rec({ id: '1', stars: 500_000, gains: flat(120, 5000) }));
    const y = evalOne(rec({ id: '2', stars: 500_000, gains: flat(120, 8000) }));
    expect(y.momentum.score as number).toBeGreaterThan(x.momentum.score as number);
    expect(y.momentum.score as number).toBeLessThan(100);
  });

  it('missing components are excluded and the weights renormalised (not treated as zero)', () => {
    const full = evalOne(rec({ stars: 20_000, gains: shaped(120, 10, 10) }));
    const short = evalOne(rec({ stars: 20_000, gains: flat(20, 10) }));
    expect(full.momentum.completeness).toBe(1);
    expect(short.momentum.completeness).toBeLessThan(1);
    expect(short.momentum.components.find((c) => c.name === 'persistence')!.value).toBeNull();
    expect(short.momentum.score).not.toBeNull();
  });

  it('an inactive repository is multiplied, visibly', () => {
    const active = evalOne(rec({ stars: 20_000, gains: flat(120, 40), pushedDaysAgo: 3 }));
    const idle = evalOne(rec({ stars: 20_000, gains: flat(120, 40), pushedDaysAgo: 400 }));
    expect(idle.momentum.multipliers[0]).toMatchObject({ name: 'inactive-repository', factor: 0.85 });
    expect(idle.momentum.score as number).toBeLessThan(active.momentum.score as number);
  });

  it('Q. deterministic: same record, same result, byte for byte', () => {
    const r = rec({ stars: 20_000, gains: shaped(120, 10, 30) });
    expect(JSON.stringify(evalOne(r))).toBe(JSON.stringify(evalOne(r)));
    expect(evalOne(r)).toEqual(evalOne(JSON.parse(JSON.stringify(r))));
  });

  it('archived repositories are excluded with no score', () => {
    const e = evalOne(rec({ stars: 20_000, gains: flat(120, 100), archived: true }));
    expect(e.momentum.score).toBeNull();
    expect(e.trend).toBe('EXCLUDED');
  });
});

describe('explanation is deterministic and made of measured numbers', () => {
  it('R. explains why, with the actual figures', () => {
    const e = evalOne(rec({ stars: 30_000, gains: shaped(120, 20, 120) }));
    const text = e.explanation.join('\n');
    expect(text).toContain('+840 stars in 7 days (120/day)');
    expect(text).toMatch(/\+\d[\d,]* stars in 30 days/);
    expect(text).toContain('accelerating: last week 6x the previous 28 days');
    expect(text).toContain('context: 30,000 lifetime stars (not used in the score)');
    expect(e.summary).toBe('Gained 840 stars in 7 days and 1,300 in 30 days, with acceleration over the last week.');
  });

  it('says what is missing instead of hiding it', () => {
    const e = evalOne(rec({ createdDaysAgo: 20, stars: 400, gains: flat(20, 20), complete: true }));
    expect(e.explanation.join('\n')).toContain('30-day growth not available: repository is 20 days old');
  });
});

describe('trends: Rising, Cooling, Sustained, New entrants, Biggest movers', () => {
  it('Rising needs strong AND holding momentum; a fading repository is Cooling even with huge totals', () => {
    const rising = evalOne(rec({ stars: 30_000, gains: shaped(120, 120, 130) }));
    const fading = evalOne(rec({ stars: 30_000, gains: shaped(120, 400, 120) }));
    expect(rising.trend).toBe('RISING');
    expect(fading.signals.accelerationRatio).toBe(0.3);
    expect(fading.trend).toBe('COOLING');
  });

  it('a quiet repository is Steady; no history is INSUFFICIENT_DATA', () => {
    expect(evalOne(rec({ stars: 20_000, gains: flat(120, 3) })).trend).toBe('STEADY');
    const none = evalOne(rec({ stars: 20_000, gains: [] }));
    expect(none.trend).toBe('INSUFFICIENT_DATA');
    expect(none.momentum.score).toBeNull();
  });

  it('stale data cannot be Rising', () => {
    const r = rec({ stars: 30_000, gains: shaped(120, 120, 130) });
    const stale = evaluateRepository(r, NOW.toISOString(), new Date(NOW.getTime() + 6 * 86_400_000), cfg);
    expect(stale.signals.staleDays).toBe(6);
    expect(stale.trend).toBe('STEADY');
    expect(stale.explanation.join('\n')).toContain('data is 6 days old');
  });

  it('S. new entrant: a signal, not momentum. New and quiet -> newEntrant but not Rising; new and exploding -> Rising through velocity', () => {
    const quiet = evalOne(rec({ createdDaysAgo: 10, stars: 300, gains: flat(10, 30), complete: true }));
    expect(quiet.signals.newEntrant).toBe(true);
    expect(quiet.trend).not.toBe('RISING');
    const boom = evalOne(rec({ createdDaysAgo: 4, stars: 4000, gains: [1000, 1000, 1000, 1000, 0], complete: true }));
    expect(boom.signals.newEntrant).toBe(true);
    expect(boom.trend).toBe('RISING');
    const old = evalOne(rec({ createdDaysAgo: 900, stars: 4000, gains: flat(120, 30) }));
    expect(old.signals.newEntrant).toBe(false);
  });

  it('T. sustained: every fully observed window at or above the threshold; missing windows are not required, unknown is not false', () => {
    expect(evalOne(rec({ stars: 50_000, gains: flat(120, 40) })).signals.sustained).toBe(true);
    expect(evalOne(rec({ stars: 50_000, gains: shaped(120, 5, 60) })).signals.sustained).toBe(false); // 30d and 90d too slow
    const forty = evalOne(rec({ createdDaysAgo: 40, stars: 2000, gains: flat(40, 50), complete: true }));
    expect(forty.growth.w90.status).toBe('insufficient-age');
    expect(forty.signals.windowsComparable).toBe(2);
    expect(forty.signals.sustained).toBe(true);
    const young = evalOne(rec({ createdDaysAgo: 5, stars: 500, gains: [100, 100, 100, 100, 100, 0], complete: true }));
    expect(young.signals.windowsComparable).toBe(0);
    expect(young.signals.sustained).toBe(false);
    expect(young.explanation.join('\n')).not.toContain('not sustained'); // too little data to say "not sustained"
  });

  it('U. biggest movers are ranked by the size of the change in velocity, both directions, separately from Rising', () => {
    const up = rec({ id: '1', stars: 30_000, gains: shaped(120, 20, 220) }); // +200/day
    const down = rec({ id: '2', stars: 30_000, gains: shaped(120, 400, 100) }); // -300/day
    const flatRepo = rec({ id: '3', stars: 30_000, gains: flat(120, 100) });
    const m = buildMomentumDataset(dataset([up, down, flatRepo]), NOW, cfg);
    expect(m.lists.movers.map((x) => [x.id, x.direction])).toEqual([['2', 'DOWN'], ['1', 'UP']]);
    expect(m.lists.moversUp.map((x) => x.id)).toEqual(['1']);
    expect(m.lists.moversDown.map((x) => x.id)).toEqual(['2']);
    expect(m.lists.rising).not.toContain('2'); // the biggest mover is not Rising
  });

  it('rank movement compares velocity ranks now vs 7 days ago inside the cohort', () => {
    const a = rec({ id: '1', stars: 30_000, gains: shaped(120, 300, 100) }); // was #1, now #3
    const b = rec({ id: '2', stars: 30_000, gains: shaped(120, 200, 200) }); // #2, #2
    const c = rec({ id: '3', stars: 30_000, gains: shaped(120, 50, 400) }); // was #3, now #1
    const m = buildMomentumDataset(dataset([a, b, c]), NOW, cfg);
    const by = Object.fromEntries(m.repositories.map((r) => [r.id, r.rankMovement]));
    expect(by['1']).toEqual({ rankNow: 3, rankBefore: 1, delta: -2 });
    expect(by['3']).toEqual({ rankNow: 1, rankBefore: 3, delta: 2 });
    expect(by['2']!.delta).toBe(0);
  });

  it('lists are sorted deterministically and validated', () => {
    const recs = [rec({ id: '5', stars: 30_000, gains: flat(120, 200) }), rec({ id: '6', stars: 30_000, gains: flat(120, 300) })];
    const m = buildMomentumDataset(dataset(recs), NOW, cfg);
    expect(m.lists.rising).toEqual(['6', '5']);
    expect(validateMomentumDataset(m)).toEqual([]);
    expect(JSON.stringify(buildMomentumDataset(dataset(recs), NOW, cfg))).toBe(JSON.stringify(m));
    const bad = JSON.parse(JSON.stringify(m));
    bad.lists.rising.push('999');
    bad.repositories[0].momentum.score = 150;
    expect(validateMomentumDataset(bad).join(' ')).toMatch(/unknown id 999.*out of range|out of range.*unknown id 999/s);
  });
});

describe('independence from classification and tracking', () => {
  it('V/W. momentum is identical whatever the record says about domains/categories, and takes no tier or classification input', () => {
    const base = rec({ stars: 30_000, gains: shaped(120, 20, 120) });
    const asAi = { ...base, domains: ['ai' as const], categories: ['llm', 'ai-agents'] };
    const asJava = { ...base, domains: ['engineering' as const], categories: ['java'] };
    expect(evalOne(asAi)).toEqual(evalOne(asJava));
    expect(evaluateRepository.length).toBe(4); // (record, datasetGeneratedAt, now, config): no category, tier or classification parameter
  });

  it('the internal momentum dataset does not change when classification is supplied; only the public file does', () => {
    const recs = [rec({ id: '1', stars: 30_000, gains: flat(120, 200) })];
    const repos = dataset(recs);
    const m = buildMomentumDataset(repos, NOW, cfg);
    const classified = { repositories: [{ id: '1', fullName: 'o/r1', result: { topLevelCategory: 'AI', categories: [{ slug: 'llm' }] } }] } as unknown as ClassifiedDataset;
    expect(derivePublic(m, repos).repositories[0]!.classification).toBeNull();
    expect(derivePublic(m, repos, classified).repositories[0]!.classification).toEqual({ topLevel: 'AI', categories: ['llm'] });
    expect(derivePublic(m, repos, classified).repositories[0]!.score).toBe(derivePublic(m, repos).repositories[0]!.score);
  });
});

describe('public derivation (compaction strategy)', () => {
  it('keeps identity, current metrics, momentum, trend and one-line summary; drops evidence; only scored repositories', () => {
    const long = 'x'.repeat(300);
    const recs = [{ ...rec({ id: '1', stars: 30_000, gains: flat(120, 200) }), description: long }, rec({ id: '2', stars: 30_000, gains: [] })];
    const repos = dataset(recs);
    const m = buildMomentumDataset(repos, NOW, cfg);
    const pub = derivePublic(m, repos);
    expect(pub.repositories.map((r) => r.id)).toEqual(['1']);
    expect(pub.repositories[0]!.description!.length).toBe(140);
    expect(Object.keys(pub.repositories[0]!).sort()).toEqual(['accelerationRatio', 'ageDays', 'classification', 'description', 'explanation', 'flags', 'fullName', 'growth30d', 'growth7d', 'growth90d', 'growthPercent7d', 'id', 'language', 'priorVelocity', 'score', 'stars', 'summary', 'trend', 'url', 'velocity30d', 'velocity7d', 'velocity90d', 'velocityDelta']);
    expect(JSON.stringify(pub).length).toBeLessThan(JSON.stringify(m).length / 2);
    expect(pub.lists.rising).toEqual(['1']);
  });
});

describe('configuration', () => {
  const base = () => JSON.parse(readFileSync('config/momentum.json', 'utf8'));
  it('rejects invalid configuration', () => {
    const bad = (f: (c: any) => void) => () => { const c = base(); f(c); return parseMomentumConfig(c); };
    expect(bad((c) => (c.schemaVersion = 2))).toThrow(MomentumConfigError);
    expect(bad((c) => (c.score.weights.velocity = 0.9))).toThrow(/sum to 1/);
    expect(bad((c) => (c.windows.short = 50))).toThrow(/short < medium < long/);
    expect(bad((c) => delete c.trends.rising.minScore)).toThrow(/minScore/);
    expect(() => loadMomentumConfig('config/nope.json')).toThrow(MomentumConfigError);
  });

  it('thresholds are configuration: a stricter Rising threshold removes a repository from Rising', () => {
    const r = rec({ stars: 30_000, gains: shaped(120, 120, 130) });
    expect(evalOne(r).trend).toBe('RISING');
    const strict = parseMomentumConfig({ ...base(), trends: { ...base().trends, rising: { ...base().trends.rising, minVelocity7d: 1000 } } });
    expect(evaluateRepository(r, NOW.toISOString(), NOW, strict).trend).not.toBe('RISING');
  });
});
