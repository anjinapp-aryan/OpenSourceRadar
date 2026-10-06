import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Trajectory from '../components/Trajectory';
import WhyPanel from '../components/WhyPanel';
import { addDays, utcDate } from '../src/analysis/starHistory';
import { computeWindowsFromGains } from '../src/analysis/windows';
import type { ClassifiedDataset } from '../src/classification/datasets';
import { gainsOf, type Dataset, type RepositoryRecord } from '../src/collect/dataset';
import { classifyPattern, evidenceOf, parsePatternConfig, PATTERNS, type PatternConfig, type PatternInput } from '../src/explain/pattern';
import { PATTERN_LABEL, renderWhy } from '../src/explain/render';
import { buildHistory, historyQuality, sumLast, trajectoryFor } from '../src/history';
import { classifyLifecycle, LIFECYCLE_STATES, parseLifecycleConfig, type LifecycleConfig, type LifecycleInput } from '../src/lifecycle';
import { loadMomentumConfig } from '../src/momentum/config';
import { buildMomentumDataset, derivePublic } from '../src/momentum/dataset';
import { historyProblems, runGate, structuralProblems, type GateConfig } from '../src/pipeline/gate';
import { assetsToDelete, datedStateName } from '../src/pipeline/state';

const pipelineCfg = JSON.parse(readFileSync('config/pipeline.json', 'utf8')) as { gate: GateConfig; lifecycle: unknown; history: { days: number; maxBytes: number } };
const pcfg: PatternConfig = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const lcfg: LifecycleConfig = parseLifecycleConfig(pipelineCfg.lifecycle);
const mcfg = loadMomentumConfig();
const NOW = new Date('2026-10-06T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function pi(over: Partial<PatternInput> = {}): PatternInput {
  return { stars: 5000, ageDays: 400, growth7d: 20, growth30d: 80, growth90d: 240, velocity7d: 2.9, velocity30d: 2.7, velocity90d: 2.7, priorVelocity: 2.8, accelerationRatio: 1, trend: 'STEADY', flags: { sustained: false, newEntrant: false }, ...over };
}

describe('pattern model: neutral classification of growth shape', () => {
  it('normal growth', () => expect(classifyPattern(pi(), pcfg)).toBe('NORMAL_GROWTH'));
  it('sustained growth uses the engine flag', () => expect(classifyPattern(pi({ flags: { sustained: true, newEntrant: false } }), pcfg)).toBe('SUSTAINED_GROWTH'));
  it('breakout: at least 3x the previous period, not concentrated', () => expect(classifyPattern(pi({ growth7d: 500, growth30d: 1500, accelerationRatio: 3.4 }), pcfg)).toBe('BREAKOUT'));
  it('accelerating: between the accelerating and breakout ratios', () => expect(classifyPattern(pi({ growth7d: 150, growth30d: 450, accelerationRatio: 1.6 }), pcfg)).toBe('ACCELERATING'));
  it('a high ratio on negligible growth is not a pattern (3x of almost nothing)', () => {
    expect(classifyPattern(pi({ growth7d: 48, growth30d: 200, accelerationRatio: 3.4 }), pcfg)).toBe('NORMAL_GROWTH');
    expect(classifyPattern(pi({ growth7d: 48, growth30d: 200, accelerationRatio: 1.6 }), pcfg)).toBe('NORMAL_GROWTH');
  });
  it('spike: most of the month arrived this week and the burst is meaningful', () => {
    expect(classifyPattern(pi({ growth7d: 900, growth30d: 1000, accelerationRatio: 9 }), pcfg)).toBe('SPIKE');
    expect(classifyPattern(pi({ growth7d: 50, growth30d: 60, accelerationRatio: 5 }), pcfg)).not.toBe('SPIKE'); // below the absolute floor
  });
  it('cooling follows the ranking engine status', () => expect(classifyPattern(pi({ trend: 'COOLING', accelerationRatio: 0.4, growth7d: 30, growth30d: 400 }), pcfg)).toBe('COOLING'));
  it('insufficient history: missing values are never guessed', () => {
    expect(classifyPattern(pi({ growth7d: null }), pcfg)).toBe('INSUFFICIENT_HISTORY');
    expect(classifyPattern(pi({ growth30d: null, growth90d: null, ageDays: 50 }), pcfg)).toBe('INSUFFICIENT_HISTORY');
  });
  it('new launch: a young repository has no 30-day window by design', () => expect(classifyPattern(pi({ growth30d: null, growth90d: null, ageDays: 10 }), pcfg)).toBe('NEW_LAUNCH'));
  it('zero and negative growth are FLAT, never an error', () => {
    expect(classifyPattern(pi({ growth7d: 0, growth30d: 0 }), pcfg)).toBe('FLAT');
    expect(classifyPattern(pi({ growth7d: -5, growth30d: 10 }), pcfg)).toBe('FLAT');
  });
  it('precedence: spike beats acceleration; missing data beats everything', () => {
    expect(classifyPattern(pi({ growth7d: 900, growth30d: 1000, accelerationRatio: 5 }), pcfg)).toBe('SPIKE');
    expect(classifyPattern(pi({ growth7d: null, trend: 'COOLING' }), pcfg)).toBe('INSUFFICIENT_HISTORY');
  });
  it('a zero or negative 30-day total does not divide by zero', () => {
    expect(classifyPattern(pi({ growth7d: 10, growth30d: 0 }), pcfg)).not.toBe('SPIKE');
    expect(evidenceOf(pi({ growth7d: 10, growth30d: 0 })).spikeShare30).toBeNull();
  });
  it('the vocabulary never accuses: no pattern or label implies fraud', () => {
    const all = [...PATTERNS, ...Object.values(PATTERN_LABEL)].join(' ').toLowerCase();
    for (const w of ['fake', 'bought', 'fraud', 'bot', 'manipulat', 'scam']) expect(all).not.toContain(w);
  });
  it('config validation rejects inconsistent values', () => {
    const base = () => JSON.parse(readFileSync('config/pattern.json', 'utf8'));
    const bad = (f: (c: any) => void) => () => {
      const c = base();
      f(c);
      return parsePatternConfig(c);
    };
    expect(bad((c) => (c.schemaVersion = 2))).toThrow();
    expect(bad((c) => (c.spike.minShare30 = 2))).toThrow();
    expect(bad((c) => (c.accelerating.minRatio = 5))).toThrow(/below breakout/);
    expect(bad((c) => (c.breakout.minGrowth7d = -1))).toThrow();
  });
});

describe('explanation: deterministic, evidence-only, consistent', () => {
  const fixture = pi({ growth7d: 716, growth30d: 1920, growth90d: 5900, velocity7d: 102.2857, velocity30d: 64, priorVelocity: 33, accelerationRatio: 3.1, trend: 'RISING', flags: { sustained: true, newEntrant: false } });

  it('renders exact numbers from the record', () => {
    const w = renderWhy(fixture, 'BREAKOUT', pcfg);
    expect(w.headline).toBe('Breakout');
    expect(w.lines[0]).toBe('+716 stars in 7 days (102/day)');
    expect(w.lines[1]).toBe('+1,920 stars in 30 days (64.0/day)');
    expect(w.lines[2]).toBe('+5,900 stars in 90 days');
    expect(w.lines[3]).toBe('102/day over the last 7 days against 33.0/day over the previous 28 days (3.1×, accelerating)');
    expect(w.lines).toContain('sustained: growth stayed above the sustained threshold in every fully observed window');
    expect(w.lines.at(-1)).toBe('context: 5,000 lifetime stars (not used in the score)');
  });

  it('is deterministic and stably ordered', () => {
    const a = renderWhy(fixture, 'BREAKOUT', pcfg);
    const b = renderWhy({ ...fixture }, 'BREAKOUT', pcfg);
    expect(a).toEqual(b);
  });

  it('states unavailable windows instead of zero', () => {
    const w = renderWhy(pi({ growth30d: null, growth90d: null, ageDays: 9, growth7d: 300 }), 'NEW_LAUNCH', pcfg);
    expect(w.lines.join('|')).toContain('30-day growth not available: repository is 9 days old');
    expect(w.lines.join('|')).not.toMatch(/\+0 stars in 30 days/);
    expect(w.note).toMatch(/too young/);
  });

  it('spike: concentration is stated with its own numbers and a neutral note', () => {
    const w = renderWhy(pi({ stars: 6727, growth7d: 6308, growth30d: 6332, accelerationRatio: 813.9, velocity7d: 901, priorVelocity: 1.1, ageDays: 175 }), 'SPIKE', pcfg);
    expect(w.lines.join('|')).toContain("100% of the last 30 days' growth arrived in the last 7 days");
    expect(w.lines.join('|')).toContain('94% of all its stars were gained in the last 7 days');
    expect(w.note).toBe('Growth is concentrated in the most recent week; persistence is not yet established.');
  });

  it('only the numbers of the record (plus fixed window sizes) appear in the lines', () => {
    const rows: PatternInput[] = [];
    for (const g7 of [0, 5, 120, 900]) for (const g30 of [null, 60, 1000]) for (const a of [null, 0.4, 1, 2, 5]) for (const age of [5, 50, 500]) rows.push(pi({ growth7d: g7, growth30d: g30, growth90d: g30 === null ? null : (g30 as number) * 2, accelerationRatio: a, ageDays: age, velocity7d: g7 / 7, velocity30d: g30 === null ? null : (g30 as number) / 30, priorVelocity: a === null ? null : 4, trend: a !== null && a < 0.6 ? 'COOLING' : 'STEADY' }));
    for (const r of rows) {
      const pattern = classifyPattern(r, pcfg);
      const w = renderWhy(r, pattern, pcfg);
      const e = evidenceOf(r);
      const allowed = new Set(['7', '30', '90', '28']);
      const add = (v: number | null) => {
        if (v === null) return;
        allowed.add(String(Math.round(Math.abs(v))));
        allowed.add((Math.round(Math.abs(v) * 10) / 10).toFixed(1));
        allowed.add(String(Math.round(Math.abs(v) * 100)));
      };
      [e.growth7d, e.growth30d, e.growth90d, e.velocity7d, e.velocity30d, e.priorVelocity, e.accelerationRatio, e.spikeShare30, e.lifetimeShare7d, r.stars, Math.floor(r.ageDays), Math.max(Math.floor(r.ageDays), 1)].forEach(add);
      if (e.priorVelocity !== null && r.velocity90d) add(e.priorVelocity / r.velocity90d);
      for (const line of w.lines) {
        for (const tok of line.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []) expect(allowed.has(tok) || allowed.has(String(Number(tok))), `${tok} in "${line}"`).toBe(true);
      }
    }
  });

  it('never contradicts itself', () => {
    for (const a of [null, 0.4, 0.7, 1, 1.3, 3.5]) {
      for (const sustained of [false, true]) {
        const r = pi({ accelerationRatio: a, priorVelocity: a === null ? null : 3, flags: { sustained, newEntrant: false }, trend: a !== null && a < 0.6 ? 'COOLING' : 'STEADY' });
        const pattern = classifyPattern(r, pcfg);
        const text = renderWhy(r, pattern, pcfg).lines.join('|');
        expect(text.includes('accelerating') && text.includes('slowing')).toBe(false);
        if (pattern === 'ACCELERATING' || pattern === 'BREAKOUT') expect(text).not.toContain('slowing');
        if (!sustained) expect(text).not.toContain('sustained:');
      }
    }
  });

  it('insufficient history says so and claims nothing else', () => {
    const w = renderWhy(pi({ growth7d: null, growth30d: null, growth90d: null, velocity7d: null, velocity30d: null, accelerationRatio: null, priorVelocity: null }), 'INSUFFICIENT_HISTORY', pcfg);
    expect(w.lines[0]).toMatch(/not available/);
    expect(w.note).toMatch(/no value has been assumed/);
  });
});

describe('lifecycle: every reason has a state, missing data is never "no growth"', () => {
  const tracked = (over: Partial<{ tier: string; lastCollectedAt: string | null; refreshIntervalHours: number }> = {}) => ({ tier: 'WARM', lastCollectedAt: daysAgo(0.5), refreshIntervalHours: 72, ...over });
  const base: LifecycleInput = { archived: false, inCandidates: true, tracked: tracked(), classificationTopLevel: 'AI', now: NOW };
  const st = (o: Partial<LifecycleInput> = {}) => classifyLifecycle({ ...base, ...o }, lcfg).state;

  it('active', () => expect(st()).toBe('ACTIVE'));
  it('stale after two intervals plus grace, tier-aware', () => {
    expect(st({ tracked: tracked({ lastCollectedAt: daysAgo(6.9) }) })).toBe('ACTIVE'); // limit 2*72+24 = 168 h = 7 d
    expect(st({ tracked: tracked({ lastCollectedAt: daysAgo(7.1) }) })).toBe('STALE');
    expect(st({ tracked: tracked({ tier: 'HOT', refreshIntervalHours: 24, lastCollectedAt: daysAgo(3.1) }) })).toBe('STALE'); // limit 72 h
  });
  it('orphan: not in the candidate set', () => expect(st({ inCandidates: false })).toBe('ORPHAN'));
  it('excluded: classified UNKNOWN and therefore not tracked', () => {
    const r = classifyLifecycle({ ...base, tracked: null, classificationTopLevel: 'UNKNOWN' }, lcfg);
    expect(r.state).toBe('EXCLUDED');
    expect(r.reason).toMatch(/UNKNOWN/);
  });
  it('unassessed: tracked but never collected', () => {
    expect(st({ tracked: tracked({ tier: 'UNASSESSED', lastCollectedAt: null }) })).toBe('UNASSESSED');
    expect(st({ tracked: tracked({ lastCollectedAt: null }) })).toBe('UNASSESSED');
  });
  it('archived wins over everything', () => expect(st({ archived: true, inCandidates: false })).toBe('ARCHIVED'));
  it('missing data never becomes a tracking tier: DORMANT is not a lifecycle state', () => {
    expect((LIFECYCLE_STATES as readonly string[]).includes('DORMANT')).toBe(false);
    expect(st({ tracked: null })).not.toBe('ACTIVE');
  });
  it('config validation', () => {
    expect(() => parseLifecycleConfig({ staleAfterIntervals: 0, graceHours: 1, publish: ['ACTIVE'] })).toThrow();
    expect(() => parseLifecycleConfig({ staleAfterIntervals: 2, graceHours: 1, publish: ['NOPE'] })).toThrow();
  });
});

// ---------------------------------------------------------------- fixtures for history / publication

interface Opts {
  id: string;
  gains: number[];
  stars?: number;
  createdDaysAgo?: number;
}
function rec(o: Opts): RepositoryRecord {
  const complete = false;
  const firstDate = addDays(utcDate(NOW), -(o.gains.length - 1));
  const starHistory = { source: 'github-star-history' as const, fetchedAt: NOW.toISOString(), complete, firstDate, dailyGains: o.gains };
  const stars = o.stars ?? 50_000;
  return {
    id: o.id, owner: 'o', name: `r${o.id}`, fullName: `o/r${o.id}`, url: `https://github.com/o/r${o.id}`, description: 'd', language: 'Go', topics: [], license: null,
    createdAt: daysAgo(o.createdDaysAgo ?? 800), updatedAt: NOW.toISOString(), pushedAt: daysAgo(2), isArchived: false, stars, forks: 0, openIssues: 0, metadataSource: 'graphql',
    collectedAt: NOW.toISOString(), domains: ['ai'], categories: ['x'], starHistory, growthAsOf: NOW.toISOString(),
    growth: computeWindowsFromGains(gainsOf(starHistory), complete, stars, NOW), quality: [],
  };
}
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
const dataset = (records: RepositoryRecord[]): Dataset => ({ schemaVersion: 1, generatedAt: NOW.toISOString(), asOfDate: utcDate(NOW), historyPagesPerRepository: 1, stats: { repositories: records.length, byDomain: {} }, repositories: records });
const classified = (ids: string[], top = 'AI'): ClassifiedDataset =>
  ({ schemaVersion: 1, classifierVersion: 't', generatedAt: NOW.toISOString(), source: {}, summary: {}, repositories: ids.map((id) => ({ id, fullName: `o/r${id}`, result: { topLevelCategory: top, categories: [{ slug: 'llm' }] } })) }) as unknown as ClassifiedDataset;

describe('history: 7 / 30 / 90 days, honest about gaps', () => {
  const r = rec({ id: '1', gains: [...flat(180, 10), ...flat(7, 100)] });
  const h = buildHistory([r], new Set(['1']), 90, NOW.toISOString());

  it('keeps the last 90 days verbatim and records the end date', () => {
    const e = h.repositories['1']!;
    expect(e.g).toHaveLength(90);
    expect(e.g.slice(-7)).toEqual(flat(7, 100));
    expect(e.e).toBe(utcDate(NOW));
    expect(e.g).toEqual(r.starHistory.dailyGains.slice(-90));
  });
  it('7, 30 and 90 day views are slices of the same series', () => {
    const entry = h.repositories['1']!;
    const t7 = trajectoryFor(entry, 800, 7);
    const t30 = trajectoryFor(entry, 800, 30);
    const t90 = trajectoryFor(entry, 800, 90);
    expect([t7, t30, t90].map((t) => (t.kind === 'ok' ? t.gains.length : -1))).toEqual([7, 30, 90]);
    expect(sumLast(entry.g, 7)).toBe(700);
    expect(sumLast(entry.g, 30)).toBe(700 + 230);
  });
  it('only included repositories get an entry; empty histories get none', () => {
    const none = buildHistory([r, rec({ id: '2', gains: [] })], new Set(['1', '2']), 90, NOW.toISOString());
    expect(Object.keys(none.repositories)).toEqual(['1']);
    expect(Object.keys(buildHistory([r], new Set(), 90, NOW.toISOString()).repositories)).toEqual([]);
  });
  it('young repository: shown for its whole life, flagged young, not padded with zeros', () => {
    const young = buildHistory([rec({ id: '3', gains: flat(20, 5), createdDaysAgo: 20 })], new Set(['3']), 90, NOW.toISOString()).repositories['3']!;
    const t = trajectoryFor(young, 20, 90);
    expect(t.kind).toBe('ok');
    if (t.kind === 'ok') {
      expect(t.gains).toHaveLength(20);
      expect(t.young).toBe(true);
    }
  });
  it('insufficient history: an old repository with a short series is not drawn', () => {
    const short = { e: utcDate(NOW), g: flat(20, 5) };
    expect(trajectoryFor(short, 400, 90)).toEqual({ kind: 'insufficient', have: 20, need: 90 });
    expect(trajectoryFor(undefined, 400, 90)).toEqual({ kind: 'missing' });
    expect(trajectoryFor({ e: utcDate(NOW), g: [] }, 400, 30)).toEqual({ kind: 'missing' });
  });
  it('quality report over stored histories', () => {
    const recs = [r, rec({ id: '3', gains: flat(20, 5), createdDaysAgo: 20 }), rec({ id: '4', gains: [...flat(10, 2), -1, ...flat(5, 1)] })];
    const q = historyQuality(recs, (x) => (x.id === '3' ? 20 : 800), () => utcDate(NOW));
    expect(q.records).toBe(3);
    expect(q.atLeast90Days).toBe(1);
    expect(q.youngerThan90Days).toBe(1);
    expect(q.invalidValues).toBe(1);
    expect(q.insufficient).toBe(1); // record 4: 16 days for an 800-day-old repository
    expect(q.length.max).toBe(187);
  });
});

describe('public dataset: lifecycle, pattern and the gate', () => {
  const recs = [
    rec({ id: '1', gains: [...flat(83, 10), ...flat(7, 100)] }), // active, accelerating
    rec({ id: '2', gains: flat(90, 10) }), // orphan (not in candidates)
    rec({ id: '3', gains: flat(90, 10) }), // excluded (UNKNOWN, not tracked)
    rec({ id: '4', gains: flat(90, 10) }), // stale
  ];
  const ds = dataset(recs);
  const momentum = buildMomentumDataset(ds, NOW, mcfg);
  const lifecycle = {
    config: lcfg,
    candidateIds: new Set(['1', '3', '4']),
    tracking: new Map([
      ['1', { tier: 'HOT', lastCollectedAt: daysAgo(0.2), refreshIntervalHours: 24 }],
      ['4', { tier: 'HOT', lastCollectedAt: daysAgo(20), refreshIntervalHours: 24 }],
    ]),
    now: NOW,
  };
  const pub = derivePublic(momentum, ds, classified(['1', '2', '3', '4']), { pattern: pcfg, lifecycle });

  it('withholds orphan and excluded records, publishes active and stale, counts everything', () => {
    expect(pub.repositories.map((r) => r.id)).toEqual(['1', '4']);
    expect(pub.lifecycle).toEqual({ counts: { ACTIVE: 1, STALE: 1, UNASSESSED: 0, ORPHAN: 1, EXCLUDED: 1, ARCHIVED: 0 }, withheld: 2 });
  });
  it('flags stale records visibly; active records carry no lifecycle field', () => {
    expect(pub.repositories.find((r) => r.id === '4')!.lifecycle).toBe('STALE');
    expect(pub.repositories.find((r) => r.id === '1')!.lifecycle).toBeUndefined();
  });
  it('stores a pattern that equals its recomputation from the record itself', () => {
    expect(pub.patternVersion).toBe(pcfg.patternVersion);
    for (const r of pub.repositories) expect(r.pattern).toBe(classifyPattern(r, pcfg));
  });
  it('lists never reference withheld records', () => {
    const ids = new Set(pub.repositories.map((r) => r.id));
    for (const list of [pub.lists.rising, pub.lists.sustained, pub.lists.newEntrants]) for (const id of list) expect(ids.has(id)).toBe(true);
  });
  it('without lifecycle extras every scored record is published (backward compatible)', () => {
    const plain = derivePublic(momentum, ds, classified(['1', '2', '3', '4']));
    expect(plain.repositories).toHaveLength(4);
    expect(plain.lifecycle).toBeUndefined();
    expect(plain.repositories[0]!.pattern).toBeUndefined();
  });

  const gcfg: GateConfig = { ...pipelineCfg.gate, minRepositories: 1, minAiRepositories: 1 };
  it('gate accepts a deliberate withholding but still rejects a real loss of records', () => {
    const synthetic = (nAi: number, nOther: number, withheld: number) => {
      const base = pub.repositories.find((r) => r.id === '1')!;
      const mk = (i: number, ai: boolean) => ({ ...base, id: String(1000 + i), fullName: `o/b${i}`, url: `https://github.com/o/b${i}`, classification: ai ? { topLevel: 'AI', categories: ['llm'] } : null });
      return {
        ...pub,
        lists: { rising: [], movers: [], moversUp: [], moversDown: [], sustained: [], newEntrants: [] },
        categories: [{ slug: 'llm', name: 'LLM', domain: 'ai' }],
        repositories: [...Array.from({ length: nAi }, (_, i) => mk(i, true)), ...Array.from({ length: nOther }, (_, i) => mk(nAi + i, false))],
        ...(withheld > 0 ? { lifecycle: { counts: { ACTIVE: nAi + nOther, STALE: 0, UNASSESSED: 0, ORPHAN: withheld, EXCLUDED: 0, ARCHIVED: 0 }, withheld } } : {}),
      };
    };
    const previous = synthetic(80, 20, 0); // 100 records, 80 of them AI
    const cleaned = runGate(synthetic(80, 0, 20), previous, gcfg, { now: NOW, pattern: pcfg });
    expect(cleaned.structuralProblems, JSON.stringify(cleaned.structuralProblems)).toEqual([]);
    expect(cleaned.level).not.toBe('FAIL');
    const lost = runGate(synthetic(80, 0, 0), previous, gcfg, { now: NOW, pattern: pcfg }); // 20 records vanished, none accounted for
    expect(lost.level).toBe('FAIL');
    expect(lost.structuralProblems.join('|')).toMatch(/repositories \(published \+ withheld\) dropped/);
  });
  it('gate rejects a tampered pattern, an invalid pattern and a malformed lifecycle block', () => {
    const t = JSON.parse(JSON.stringify(pub));
    t.repositories[0].pattern = t.repositories[0].pattern === 'SPIKE' ? 'FLAT' : 'SPIKE';
    expect(structuralProblems(t, { ...pipelineCfg.gate, minRepositories: 1, minAiRepositories: 1 }, NOW, { pattern: pcfg }).join('|')).toMatch(/does not match its own fields/);
    const u = JSON.parse(JSON.stringify(pub));
    u.repositories[0].pattern = 'FRAUDULENT';
    expect(structuralProblems(u, gcfg, NOW).join('|')).toMatch(/invalid pattern/);
    const v = JSON.parse(JSON.stringify(pub));
    v.lifecycle = { counts: { DORMANT: 3 }, withheld: 1 };
    expect(structuralProblems(v, gcfg, NOW).join('|')).toMatch(/lifecycle.counts/);
  });
  it('history is traceable: window growth equals the sum of the published daily values', () => {
    const history = buildHistory(recs, new Set(pub.repositories.map((r) => r.id)), 90, NOW.toISOString());
    expect(historyProblems(history, pub, { maxBytes: pipelineCfg.history.maxBytes })).toEqual([]);
    const bad = JSON.parse(JSON.stringify(history));
    bad.repositories['1'].g[89] += 1;
    expect(historyProblems(bad, pub, { maxBytes: 1e9 }).join('|')).toMatch(/growth7d .* does not equal the sum/);
  });
  it('history gate rejects malformed files, unknown repositories, negative days and oversize', () => {
    const ok = buildHistory(recs, new Set(['1']), 90, NOW.toISOString());
    const mk = (f: (h: any) => void) => {
      const h = JSON.parse(JSON.stringify(ok));
      f(h);
      return historyProblems(h, pub, { maxBytes: 1e9 }).join('|');
    };
    expect(historyProblems(null, pub, { maxBytes: 1 })).toEqual(['history is not an object']);
    expect(mk((h) => (h.schemaVersion = 2))).toMatch(/schemaVersion/);
    expect(mk((h) => (h.repositories['99'] = { e: '2026-10-06', g: [1] }))).toMatch(/no public record/);
    expect(mk((h) => (h.repositories['1'].g[0] = -3))).toMatch(/negative/);
    expect(mk((h) => (h.repositories['1'].g = []))).toMatch(/length/);
    expect(historyProblems(ok, pub, { maxBytes: 10 }, 1000).join('|')).toMatch(/bytes/);
  });
});

describe('state backups: dated recovery points with explicit retention', () => {
  const a = (...names: string[]) => names.map((name) => ({ name }));
  it('keeps the newest N dated copies and never touches the live state or unrelated assets', () => {
    const assets = a('state.tar.gz', 'other.txt', ...['01', '02', '03', '04', '05'].map((d) => `state-2026-10-${d}.tar.gz`));
    expect(assetsToDelete(assets, 3)).toEqual(['state-2026-10-01.tar.gz', 'state-2026-10-02.tar.gz']);
    expect(assetsToDelete(assets, 14)).toEqual([]);
  });
  it('sorts by date, not by listing order', () => {
    const assets = a('state-2026-10-05.tar.gz', 'state-2026-10-01.tar.gz', 'state-2026-10-03.tar.gz');
    expect(assetsToDelete(assets, 2)).toEqual(['state-2026-10-01.tar.gz']);
  });
  it('removes the legacy single backup only once two dated copies exist', () => {
    expect(assetsToDelete(a('state.tar.gz', 'state-prev.tar.gz', 'state-2026-10-06.tar.gz'), 14)).toEqual([]);
    expect(assetsToDelete(a('state.tar.gz', 'state-prev.tar.gz', 'state-2026-10-05.tar.gz', 'state-2026-10-06.tar.gz'), 14)).toEqual(['state-prev.tar.gz']);
  });
  it('always keeps at least one dated copy and names copies by UTC date', () => {
    expect(assetsToDelete(a('state-2026-10-05.tar.gz', 'state-2026-10-06.tar.gz'), 0)).toEqual(['state-2026-10-05.tar.gz']);
    expect(datedStateName(new Date('2026-10-06T23:59:59Z'))).toBe('state-2026-10-06.tar.gz');
  });
  it('the shipped configuration keeps two weeks', () => {
    expect((JSON.parse(readFileSync('config/pipeline.json', 'utf8')) as { state: { keepDaily: number } }).state.keepDaily).toBe(14);
  });
});

describe('UI: why panel and trajectory', () => {
  const uiDs = dataset([rec({ id: '1', gains: [...flat(83, 10), ...flat(7, 100)] })]);
  const uiPub = derivePublic(buildMomentumDataset(uiDs, NOW, mcfg), uiDs, classified(['1']), { pattern: pcfg });
  const repo = { ...(uiPub.repositories[0] as NonNullable<(typeof uiPub.repositories)[0]>) };
  it('why panel shows heading, pattern, status, evidence lines and the deterministic note', () => {
    const html = renderToStaticMarkup(<WhyPanel repo={repo} cfg={pcfg} />);
    expect(html).toContain('Why this is');
    expect(html).toContain(PATTERN_LABEL[repo.pattern!]);
    expect(html).toContain('stars in 7 days');
    expect(html).toContain('No AI-written text');
  });
  it('shows an overdue notice for stale records', () => {
    expect(renderToStaticMarkup(<WhyPanel repo={{ ...repo, lifecycle: 'STALE' }} cfg={pcfg} />)).toContain('overdue for refresh');
  });
  it('falls back to recomputing the pattern for older datasets', () => {
    const { pattern: _p, ...old } = repo;
    void _p;
    expect(renderToStaticMarkup(<WhyPanel repo={old} cfg={pcfg} />)).toContain(PATTERN_LABEL[classifyPattern(old, pcfg)]);
  });
  it('trajectory: window buttons, summary and an accessible label for the chart', () => {
    const entry = { e: '2026-10-06', g: flat(90, 10) };
    const html = renderToStaticMarkup(<Trajectory entry={entry} ageDays={800} name="o/r1" />);
    expect(html).toContain('aria-pressed="true"');
    for (const w of ['7 days', '30 days', '90 days']) expect(html).toContain(w);
    expect(html).toContain('Stars gained per day for o/r1, last 90 days: total 900');
    expect(html).toContain('partial day');
  });
  it('trajectory: states insufficient, missing and young histories in words, never as zeros', () => {
    expect(renderToStaticMarkup(<Trajectory entry={{ e: '2026-10-06', g: flat(20, 5) }} ageDays={400} name="x" />)).toContain('Insufficient history: 20 of 90 days available');
    expect(renderToStaticMarkup(<Trajectory entry={null} ageDays={400} name="x" />)).toContain('No daily history is available');
    expect(renderToStaticMarkup(<Trajectory entry={{ e: '2026-10-06', g: flat(20, 5) }} ageDays={20} name="x" />)).toContain('all 20 days of its life');
  });
});
