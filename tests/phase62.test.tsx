import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WhyPanel from '../components/WhyPanel';
import { addDays, utcDate } from '../src/analysis/starHistory';
import { computeWindowsFromGains } from '../src/analysis/windows';
import { Classifier } from '../src/classification/classifier';
import { loadTaxonomy } from '../src/classification/config';
import type { ClassificationResult } from '../src/classification/types';
import { gainsOf, type RepositoryRecord } from '../src/collect/dataset';
import { discoveryQueries, matches, orphanOutcome, orphanReason, activeIds, updateRegistry, type DiscoveryQuery, type RegistryConfig, type RepoFacts } from '../src/coverage';
import { loadCategoryConfig } from '../src/discovery/config';
import { applyE1, EXPERIMENT_E1, EXPERIMENT_E1_AI } from '../src/classification/experimental';
import { evaluateAt, evaluateCurrent, dateRange, historicalRecord, lastHistoryDate, lastSnapshot, risingHistory, type HistoricalSnapshot } from '../src/backtest';
import { historyEvidence } from '../src/explain/historyEvidence';
import { parsePatternConfig } from '../src/explain/pattern';
import { recordHistoryQuality, QUALITY_THRESHOLDS } from '../src/history/quality';
import { trajectoryMetrics } from '../src/history/trajectory';
import { loadMomentumConfig } from '../src/momentum/config';
import { publicSchemaProblems, secretShapeProblems, PUBLIC_REPOSITORY_KEYS } from '../src/pipeline/gate';
import { project, treeStats } from '../src/pipeline/size';
import { loadTrackingPolicy, parseTrackingPolicy } from '../src/tracking/config';
import { selectDue } from '../src/tracking/engine';

const mcfg = loadMomentumConfig();
const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const NOW = new Date('2026-10-06T12:00:00Z');
const today = utcDate(NOW);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

/** A record whose daily gains END on `endDate` (default today); stars = baseStars + all gains (consistent). */
function rec(gains: number[], o: { endDate?: string; baseStars?: number; createdDaysAgo?: number; complete?: boolean; id?: string } = {}): RepositoryRecord {
  const end = o.endDate ?? today;
  const firstDate = addDays(end, -(gains.length - 1));
  const complete = o.complete ?? false;
  const starHistory = { source: 'github-star-history' as const, fetchedAt: `${end}T12:00:00.000Z`, complete, firstDate, dailyGains: gains };
  const stars = (o.baseStars ?? 20_000) + gains.reduce((a, b) => a + b, 0);
  const id = o.id ?? '1';
  return {
    id, owner: 'o', name: `r${id}`, fullName: `o/r${id}`, url: `https://github.com/o/r${id}`, description: 'd', language: 'Go', topics: [], license: null,
    createdAt: daysAgo(o.createdDaysAgo ?? 800), updatedAt: NOW.toISOString(), pushedAt: daysAgo(2), isArchived: false, stars, forks: 0, openIssues: 0, metadataSource: 'graphql',
    collectedAt: NOW.toISOString(), domains: ['ai'], categories: ['x'], starHistory, growthAsOf: `${end}T12:00:00.000Z`,
    growth: computeWindowsFromGains(gainsOf(starHistory), complete, stars, new Date(`${end}T12:00:00.000Z`)), quality: [],
  } as RepositoryRecord;
}

// ------------------------------------------------------------------------------------------------ history quality

describe('history quality: independent of momentum, explicit boundaries', () => {
  const q = (days: number, over: { createdAt?: string; complete?: boolean; asOf?: string; firstDate?: string } = {}) => {
    const asOf = over.asOf ?? today;
    return recordHistoryQuality({ firstDate: over.firstDate ?? addDays(asOf, -(days - 1)), dailyGains: flat(days, 3), complete: over.complete ?? false }, over.createdAt ?? daysAgo(900), asOf);
  };
  it('thresholds are the production windows', () => {
    expect(QUALITY_THRESHOLDS).toEqual({ long: 180, adequate: 90, limited: 30, maxTrailingGapDays: 1 });
  });
  it('boundary values', () => {
    expect(q(29).state).toBe('INSUFFICIENT');
    expect(q(30).state).toBe('LIMITED');
    expect(q(89).state).toBe('LIMITED');
    expect(q(90).state).toBe('ADEQUATE');
    expect(q(179).state).toBe('ADEQUATE');
    expect(q(180).state).toBe('LONG');
    expect(q(210).state).toBe('LONG');
  });
  it('FULL when the series reaches the repository creation, however short', () => {
    expect(q(12, { createdAt: daysAgo(11) }).state).toBe('FULL');
    expect(q(12, { complete: true }).state).toBe('FULL');
  });
  it('GAPPED when the series stops more than one day before the evaluation date', () => {
    const lag1 = recordHistoryQuality({ firstDate: addDays(today, -190), dailyGains: flat(190, 1), complete: false }, daysAgo(900), today);
    expect(lag1.state).toBe('LONG'); // ends yesterday: allowed
    const lag2 = recordHistoryQuality({ firstDate: addDays(today, -191), dailyGains: flat(190, 1), complete: false }, daysAgo(900), today);
    expect(lag2.state).toBe('GAPPED');
    expect(lag2.trailingGapDays).toBe(2);
  });
  it('INVALID for negative, fractional, non-finite values and unreadable dates; empty is insufficient, not zero growth', () => {
    const base = { firstDate: addDays(today, -9), complete: false };
    expect(recordHistoryQuality({ ...base, dailyGains: [1, -1, 2] }, daysAgo(900), today).state).toBe('INVALID');
    expect(recordHistoryQuality({ ...base, dailyGains: [1, 1.5] }, daysAgo(900), today).state).toBe('INVALID');
    expect(recordHistoryQuality({ ...base, dailyGains: [1, Number.NaN] }, daysAgo(900), today).state).toBe('INVALID');
    expect(recordHistoryQuality({ firstDate: '2026/01/01', dailyGains: [1], complete: false }, daysAgo(900), today).state).toBe('INVALID');
    expect(recordHistoryQuality({ ...base, dailyGains: [] }, daysAgo(900), today).state).toBe('INSUFFICIENT');
  });
  it('zero-growth days are valid data, not a quality problem', () => {
    expect(recordHistoryQuality({ firstDate: addDays(today, -99), dailyGains: flat(100, 0), complete: false }, daysAgo(900), today).state).toBe('ADEQUATE');
  });
  it('is a function of the history only: the same series is RISING-agnostic', () => {
    expect(recordHistoryQuality.length).toBe(3); // (history, createdAt, asOf): no momentum, trend or score argument
  });
});

// ------------------------------------------------------------------------------------------------ trajectory metrics

describe('trajectory metrics: null when undefined, units documented', () => {
  it('constant series', () => {
    const m = trajectoryMetrics(flat(90, 10));
    expect([m.velocity7d, m.velocity30d, m.velocity90d]).toEqual([10, 10, 10]);
    expect([m.prevVelocity7d, m.prevVelocity30d]).toEqual([10, 10]);
    expect(m.weeks).toHaveLength(12); // 90 days = 12 complete 7-day blocks
    expect(m.weeks[0]).toBe(70);
    expect(m.peakDay).toBe(10);
    expect(m.positiveDays).toBe(90);
    expect(m.zeroDays).toBe(0);
    expect(m.longestPositiveStreak).toBe(90);
    expect(m.consecutivePositiveWeeks).toEqual({ weeks: 12, capped: true });
    expect(m.weeklyCv).toBe(0);
    expect(m.currentToMedianRatio).toBe(1);
  });
  it('short series: undefined windows are null, never zero', () => {
    const m = trajectoryMetrics(flat(5, 4));
    expect(m.velocity7d).toBeNull();
    expect(m.velocity30d).toBeNull();
    expect(m.prevVelocity7d).toBeNull();
    expect(m.weeks).toEqual([]);
    expect(m.medianPriorWeek).toBeNull();
    expect(m.weeklyCv).toBeNull();
    expect(m.accelerationDays).toBeNull();
    const empty = trajectoryMetrics([]);
    expect(empty.peakDay).toBeNull();
    expect(empty.days).toBe(0);
  });
  it('weekly sums, previous windows and peaks', () => {
    const g = [...flat(60, 2), ...flat(23, 5), ...flat(7, 30)];
    const m = trajectoryMetrics(g);
    expect(m.weeks[0]).toBe(210);
    expect(m.weeks[1]).toBe(35);
    expect(m.velocity7d).toBe(30);
    expect(m.prevVelocity7d).toBe(5);
    expect(m.peakDay).toBe(30);
    expect(m.peakWeek).toBe(210);
  });
  it('zero days, streaks and quiet weeks before a burst', () => {
    const g = [...flat(34, 0), ...flat(7, 400), ...flat(42, 0), ...flat(7, 70)];
    const m = trajectoryMetrics(g);
    expect(m.longestPositiveStreak).toBe(7);
    expect(m.zeroDays).toBe(76);
    expect(m.positiveDays).toBe(14);
    expect(m.quietWeeksBefore).toEqual({ weeks: 6, capped: false }); // six quiet weeks, then the older burst
    expect(trajectoryMetrics([...flat(77, 0), ...flat(7, 70)]).quietWeeksBefore).toEqual({ weeks: 11, capped: true });
  });
  it('acceleration days: how long the 7-day pace has beaten the 28 days before', () => {
    const g = [...flat(80, 10), ...flat(5, 40)];
    const m = trajectoryMetrics(g);
    expect(m.accelerationDays?.days).toBeGreaterThanOrEqual(1);
    expect(trajectoryMetrics(flat(80, 10)).accelerationDays).toBeNull(); // holds on no day
  });
  it('median of prior weeks needs at least four prior weeks', () => {
    expect(trajectoryMetrics(flat(28, 3)).medianPriorWeek).toBeNull(); // 3 prior weeks
    expect(trajectoryMetrics(flat(35, 3)).medianPriorWeek).toBe(21);
  });
  it('is a pure function of the array it is given (a prefix gives the same answer as the past)', () => {
    const g = [...flat(60, 3), ...flat(30, 500)];
    expect(trajectoryMetrics(g.slice(0, 60))).toEqual(trajectoryMetrics(flat(60, 3)));
  });
});

describe('history evidence lines (Why panel): only what the series supports', () => {
  it('a long positive run with a burst after quiet weeks', () => {
    const e = historyEvidence([...flat(70, 1), ...flat(13, 2), ...flat(7, 60)]);
    expect(e.lines.join('|')).toContain('the last 7 days (+420) are');
    expect(e.lines.join('|')).toContain('weeks at one third or less');
    expect(e.days).toBe(90);
  });
  it('is silent on short histories and on a flat series, and never invents numbers', () => {
    expect(historyEvidence(flat(10, 5)).lines).toEqual([]);
    const flatLines = historyEvidence(flat(90, 5)).lines.join('|');
    expect(flatLines).not.toContain('one third');
    expect(flatLines).not.toContain('consecutive days');
    for (const tok of flatLines.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []) expect(['12', '7', '35', '1.0', '11', '90']).toContain(tok);
  });
  it('states "at least" when the record runs out', () => {
    const e = historyEvidence(flat(90, 5)).lines.join('|');
    expect(e).toContain('each of the 12 weeks of the published 90-day history');
  });
  it('very large ratios are shown as whole numbers', () => {
    expect(historyEvidence([...flat(77, 0), ...flat(7, 1)]).lines.join('|')).not.toContain('median week');
    expect(historyEvidence([...flat(40, 1), ...flat(43, 1), ...flat(7, 500)]).lines.join('|')).toMatch(/are \d+× the median/);
  });
  it('is deterministic', () => {
    const g = [...flat(50, 3), ...flat(40, 90)];
    expect(historyEvidence(g)).toEqual(historyEvidence([...g]));
  });
  it('the Why panel shows an "Over time" block only when there is evidence', () => {
    const repo = { id: '1', fullName: 'o/r1', url: 'https://github.com/o/r1', description: 'd', language: 'Go', stars: 5000, classification: null, growth7d: 420, growth30d: 500, velocity7d: 60, velocity30d: 16, score: 50, trend: 'RISING', flags: { rising: true, sustained: false, newEntrant: false, mover: null }, summary: 's', growth90d: 700, velocity90d: 8, growthPercent7d: 9, priorVelocity: 1, accelerationRatio: 60, velocityDelta: 59, ageDays: 400, explanation: [] } as never;
    const withHistory = renderToStaticMarkup(<WhyPanel repo={repo} cfg={pcfg} gains={[...flat(70, 1), ...flat(13, 2), ...flat(7, 60)]} />);
    expect(withHistory).toContain('Over time');
    expect(renderToStaticMarkup(<WhyPanel repo={repo} cfg={pcfg} gains={null} />)).not.toContain('Over time');
    expect(renderToStaticMarkup(<WhyPanel repo={repo} cfg={pcfg} gains={flat(5, 1)} />)).not.toContain('Over time');
  });
});

// ------------------------------------------------------------------------------------------------ backtesting

describe('backtest: only data on or before T is ever used', () => {
  const g = [...flat(110, 40), ...flat(10, 400)];
  const r = rec(g);

  it('historicalRecord truncates at T and derives stars at T from the stored format', () => {
    const T = addDays(today, -30);
    const h = historicalRecord(r, T)!;
    expect(h.starHistory.dailyGains).toHaveLength(g.length - 30);
    expect(lastHistoryDate(h)).toBe(T);
    expect(h.stars).toBe(r.stars - g.slice(-30).reduce((a, b) => a + b, 0));
    expect(h.growthAsOf).toBe(`${T}T23:59:59.999Z`);
  });

  it('the issue example: a series from January to April evaluated on 1 March cannot see March 2 onward', () => {
    const base = Array.from({ length: 91 }, (_, i) => 10 + (i % 3)); // 2026-01-01 .. 2026-04-01
    const spiky = base.map((v, i) => (i >= 60 ? 9000 : v)); // everything from 2026-03-02 is enormous
    const quiet = base.map((v, i) => (i >= 60 ? 0 : v)); // everything from 2026-03-02 is zero
    const mk = (gains: number[]) => rec(gains, { endDate: '2026-04-01', createdDaysAgo: 400 });
    const a = historicalRecord(mk(spiky), '2026-03-01')!;
    expect(lastHistoryDate(a)).toBe('2026-03-01');
    expect(a.starHistory.dailyGains).toHaveLength(60);
    expect(a.starHistory.dailyGains.some((x) => x >= 9000)).toBe(false);
    const sa = evaluateAt(mk(spiky), '2026-03-01', mcfg, pcfg);
    const sb = evaluateAt(mk(quiet), '2026-03-01', mcfg, pcfg);
    expect(JSON.stringify(sa)).toBe(JSON.stringify(sb));
  });

  it('FUTURE LEAKAGE: replacing everything after T with arbitrary values never changes the snapshot at T', () => {
    for (const back of [0, 1, 7, 14, 30, 60, 90]) {
      const T = addDays(today, -back);
      const keep = g.length - back;
      const atT = historicalRecord(r, T)!;
      for (const future of [flat(back, 0), flat(back, 5000), Array.from({ length: back }, (_, i) => (i * 977) % 4000)]) {
        const gains = [...g.slice(0, keep), ...future];
        const mutated = { ...rec(gains), createdAt: r.createdAt, stars: atT.stars + future.reduce((a, b) => a + b, 0) } as RepositoryRecord;
        expect(JSON.stringify(evaluateAt(mutated, T, mcfg, pcfg))).toBe(JSON.stringify(evaluateAt(r, T, mcfg, pcfg)));
      }
    }
  });

  it('a later push does not leak: pushedAt after T is unknown at T', () => {
    const T = addDays(today, -30);
    expect(historicalRecord(r, T)!.pushedAt).toBeNull();
    expect(historicalRecord(r, today)!.pushedAt).toBe(r.pushedAt);
  });

  it('returns null, never a guess, for dates the series does not cover or before the repository existed', () => {
    expect(evaluateAt(r, addDays(today, 1), mcfg, pcfg)).toBeNull();
    expect(evaluateAt(r, addDays(today, -500), mcfg, pcfg)).toBeNull();
    expect(evaluateAt(rec(flat(20, 5), { createdDaysAgo: 19 }), addDays(today, -25), mcfg, pcfg)).toBeNull();
    expect(historicalRecord(rec([]), today)).toBeNull();
  });

  it('reproduces the production evaluation exactly on the newest day (same engine, same rules)', () => {
    const prod = evaluateCurrent(r, r.growthAsOf as string, new Date(r.growthAsOf as string), mcfg, pcfg);
    const bt = evaluateAt(r, today, mcfg, pcfg)!;
    expect([bt.score, bt.trend, bt.pattern, bt.growth7d, bt.growth30d, bt.growth90d]).toEqual([prod.score, prod.trend, prod.pattern, prod.growth7d, prod.growth30d, prod.growth90d]);
  });

  it('historical Rising, score, pattern and acceleration are reconstructed day by day', () => {
    const series = dateRange(today, 91).reverse().map((d) => evaluateAt(r, d, mcfg, pcfg));
    expect(series[series.length - 1]?.trend).toBe('RISING');
    expect(series[series.length - 1]?.pattern).toBe('SPIKE');
    expect(series[series.length - 31]?.trend).toBe('STEADY'); // 30 days earlier the same repository was not Rising
    expect(series[series.length - 31]?.pattern).toBe('SUSTAINED_GROWTH');
    const h = risingHistory(series);
    expect(h.episodes).toHaveLength(1);
    expect(h.episodes[0]).toMatchObject({ days: 9, ongoing: true, leftCensored: false, entryPattern: 'SPIKE' }); // Rising from 9 days ago, not before the burst had a week of weight
    expect(h.currentStreak).toBe(9);
  });

  it('boundary: the evaluation date itself is included, the day after is not', () => {
    const T = addDays(today, -10);
    const h = historicalRecord(r, T)!;
    expect(h.starHistory.dailyGains.at(-1)).toBe(g[g.length - 11]);
  });

  it('a record with duplicate-free, ordered dates: dateRange is newest first and contiguous', () => {
    const d = dateRange('2026-10-06', 4);
    expect(d).toEqual(['2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03']);
  });
});

describe('Rising episodes: coverage is not behaviour', () => {
  const snap = (date: string, trend: HistoricalSnapshot['trend']): HistoricalSnapshot => ({ date, score: 50, trend, pattern: 'NORMAL_GROWTH', stars: 1, growth7d: 1, growth30d: 1, growth90d: 1, velocity7d: 1, velocity30d: 1, accelerationRatio: 1, sustained: false, newEntrant: false, ageDays: 100 });
  const R = (d: string) => snap(d, 'RISING');
  const S = (d: string) => snap(d, 'STEADY');
  it('trailing uncovered days do not end an episode (records refresh on different days)', () => {
    const h = risingHistory([S('1'), R('2'), R('3'), null, null]);
    expect(h.episodes).toHaveLength(1);
    expect(h.episodes[0]).toMatchObject({ start: '2', end: '3', days: 2, ongoing: true });
    expect(h.currentStreak).toBe(2);
    expect(h.daysEvaluated).toBe(3);
  });
  it('leading uncovered days do not start an episode; leftCensored only when Rising on the first grid day', () => {
    expect(risingHistory([null, R('2'), S('3')]).episodes[0]?.leftCensored).toBe(false);
    expect(risingHistory([R('1'), R('2')]).episodes[0]?.leftCensored).toBe(true);
  });
  it('separate episodes, durations and the longest streak', () => {
    const h = risingHistory([R('1'), S('2'), R('3'), R('4'), R('5'), S('6'), R('7')]);
    expect(h.episodes.map((e) => e.days)).toEqual([1, 3, 1]);
    expect(h.longestStreak).toBe(3);
    expect(h.risingDays).toBe(5);
    expect(h.currentStreak).toBe(1);
  });
  it('never Rising and entirely uncovered series', () => {
    expect(risingHistory([S('1'), S('2')]).episodes).toEqual([]);
    expect(risingHistory([null, null])).toMatchObject({ episodes: [], risingDays: 0, daysEvaluated: 0 });
    expect(lastSnapshot([S('1'), null])?.date).toBe('1');
    expect(lastSnapshot([null])).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ coverage / orphans / retention

describe('discovery coverage: why a repository is missing, and what should happen to it', () => {
  const queries = discoveryQueries([loadCategoryConfig('config/categories/ai.json'), loadCategoryConfig('config/categories/engineering.json')]);
  const D = new Date('2026-10-05T10:52:54Z');
  const facts = (o: Partial<RepoFacts> & { topics: string[] }): RepoFacts => ({ id: '10', stars: 5000, createdAt: '2020-01-01T00:00:00Z', pushedAt: '2026-10-01T00:00:00Z', isArchived: false, ...o });
  const topic = queries.find((q) => q.kind === 'pushed')!.topic;

  it('parses the configured queries into structured rules (99 queries: 66 established, 33 fresh)', () => {
    expect(queries).toHaveLength(99);
    expect(queries.filter((q) => q.kind === 'pushed')).toHaveLength(66);
    expect(queries.filter((q) => q.kind === 'fresh')).toHaveLength(33);
    expect(new Set(queries.map((q) => q.limit))).toEqual(new Set([100]));
  });
  it('rejects a query template it does not understand instead of guessing', () => {
    expect(() => discoveryQueries([{ discovery: { minStars: 1, pushedWithinDays: 1, createdWithinDays: 1, freshMinStars: 1, perPage: 10, maxPagesPerQuery: 1 }, categories: [{ searchQueries: ['language:go'] }] } as never])).toThrow(/unsupported/);
  });
  it('matches: topic, star floor, push window, archived and fork are all required', () => {
    const q: DiscoveryQuery = { topic: 'mcp', kind: 'pushed', minStarsExclusive: 100, windowDays: 30, limit: 100 };
    expect(matches(q, facts({ topics: ['mcp'] }), D)).toBe(true);
    expect(matches(q, facts({ topics: ['other'] }), D)).toBe(false);
    expect(matches(q, facts({ topics: ['mcp'], stars: 100 }), D)).toBe(false); // strictly greater
    expect(matches(q, facts({ topics: ['mcp'], pushedAt: '2026-08-31T00:00:00Z' }), D)).toBe(false);
    expect(matches(q, facts({ topics: ['mcp'], isArchived: true }), D)).toBe(false);
    expect(matches(q, facts({ topics: ['mcp'], isFork: true }), D)).toBe(false);
  });
  it('reason: archived, topic mismatch, star floor, push window, rank cutoff, search miss', () => {
    expect(orphanReason(facts({ topics: [topic], isArchived: true }), [], queries, D).reason).toBe('ARCHIVED');
    expect(orphanReason(facts({ topics: ['no-such-topic-xyz'] }), [], queries, D).reason).toBe('TOPIC_MISMATCH');
    expect(orphanReason(facts({ topics: [topic], stars: 1 }), [], queries, D).reason).toBe('BELOW_STAR_FLOOR');
    expect(orphanReason(facts({ topics: [topic], pushedAt: '2026-08-31T00:00:00Z' }), [], queries, D).reason).toBe('PUSH_WINDOW');
    const crowd = Array.from({ length: 120 }, (_, i) => facts({ id: String(1000 + i), topics: [topic], stars: 900_000 - i }));
    const out = orphanReason(facts({ topics: [topic], stars: 5000 }), crowd, queries, D);
    expect(out.reason).toBe('RANK_CUTOFF');
    expect(out.bestRank).toBeGreaterThan(100);
    expect(orphanReason(facts({ topics: [topic], stars: 5000 }), [], queries, D).reason).toBe('SEARCH_MISS');
  });
  it('outcome: not found, archived, fork, unknown, reclassify, recoverable, discovery gap', () => {
    const miss = { reason: 'SEARCH_MISS', matchingQueries: 1, bestRank: 3, detail: '' } as const;
    const gap = { reason: 'PUSH_WINDOW', matchingQueries: 0, bestRank: null, detail: '' } as const;
    const ok = { status: 200, renamedTo: null } as const;
    expect(orphanOutcome(miss, true, { status: 404, renamedTo: null })).toBe('NOT_FOUND');
    expect(orphanOutcome(miss, true, { ...ok, isArchived: true })).toBe('ARCHIVED');
    expect(orphanOutcome({ ...gap, reason: 'ARCHIVED' }, true, null)).toBe('ARCHIVED');
    expect(orphanOutcome(miss, true, { ...ok, isFork: true })).toBe('FORK');
    expect(orphanOutcome(miss, true, null)).toBe('UNKNOWN'); // reachability not checked: never claimed
    expect(orphanOutcome(miss, true, { status: 503, renamedTo: null })).toBe('UNKNOWN');
    expect(orphanOutcome(miss, false, ok)).toBe('RECLASSIFY');
    expect(orphanOutcome(miss, true, ok)).toBe('RECOVERABLE');
    expect(orphanOutcome(gap, true, ok)).toBe('DISCOVERY_GAP');
  });
});

describe('candidate registry (designed, not enabled): bounded retention', () => {
  const cfg: RegistryConfig = { maxMissedDiscoveries: 4, maxRetained: 2, forgetRetiredAfterWeeks: 8 };
  const found = (...ids: string[]) => new Map(ids.map((i) => [i, `o/r${i}`] as const));
  const week = (n: number) => addDays('2026-10-05', 7 * n);
  it('discovered repositories are ACTIVE; a missed one is RETAINED, then RETIRED after the allowed misses', () => {
    let reg = updateRegistry(null, { discovered: found('1', '2'), facts: new Map(), date: week(0) }, cfg);
    expect(Object.values(reg.entries).map((e) => e.status)).toEqual(['ACTIVE', 'ACTIVE']);
    for (let w = 1; w <= 4; w += 1) reg = updateRegistry(reg, { discovered: found('1'), facts: new Map([['2', { priority: 1 }]]), date: week(w) }, cfg);
    expect(reg.entries['2']).toMatchObject({ status: 'RETAINED', missedDiscoveries: 4 });
    reg = updateRegistry(reg, { discovered: found('1'), facts: new Map([['2', { priority: 1 }]]), date: week(5) }, cfg);
    expect(reg.entries['2']).toMatchObject({ status: 'RETIRED', retiredReason: 'missed 5 discoveries' });
    expect(activeIds(reg)).toEqual(['1']);
  });
  it('rediscovery recovers a retained repository and resets its misses', () => {
    let reg = updateRegistry(null, { discovered: found('1', '2'), facts: new Map(), date: week(0) }, cfg);
    reg = updateRegistry(reg, { discovered: found('1'), facts: new Map([['2', { priority: 1 }]]), date: week(1) }, cfg);
    reg = updateRegistry(reg, { discovered: found('1', '2'), facts: new Map(), date: week(2) }, cfg);
    expect(reg.entries['2']).toMatchObject({ status: 'ACTIVE', missedDiscoveries: 0, firstSeen: week(0) });
  });
  it('archived, not found and unclassified repositories are retired immediately with a reason', () => {
    const reg0 = updateRegistry(null, { discovered: found('1', '2', '3', '4'), facts: new Map(), date: week(0) }, cfg);
    const reg = updateRegistry(reg0, { discovered: found('1'), facts: new Map([['2', { archived: true, priority: 1 }], ['3', { notFound: true, priority: 1 }], ['4', { unclassified: true, priority: 1 }]]), date: week(1) }, cfg);
    expect(['2', '3', '4'].map((i) => reg.entries[i]?.retiredReason)).toEqual(['archived', 'not found', 'no category under the current classifier']);
  });
  it('capacity: the highest-priority retained repositories survive, ties broken by id, deterministically', () => {
    const reg0 = updateRegistry(null, { discovered: found('1', '2', '3', '4', '5'), facts: new Map(), date: week(0) }, cfg);
    const facts = new Map([['2', { priority: 10 }], ['3', { priority: 50 }], ['4', { priority: 50 }], ['5', { priority: 1 }]]);
    const a = updateRegistry(reg0, { discovered: found('1'), facts, date: week(1) }, cfg);
    const b = updateRegistry(reg0, { discovered: found('1'), facts, date: week(1) }, cfg);
    expect(a).toEqual(b);
    expect(activeIds(a)).toEqual(['1', '3', '4']);
    expect(a.entries['2']).toMatchObject({ status: 'RETIRED', retiredReason: 'retention capacity' });
  });
  it('renames are handled by id and retired entries are eventually forgotten', () => {
    const reg0 = updateRegistry(null, { discovered: found('1', '2'), facts: new Map(), date: week(0) }, cfg);
    const reg1 = updateRegistry(reg0, { discovered: found('1'), facts: new Map([['2', { priority: 1, fullName: 'new/name' }]]), date: week(1) }, cfg);
    expect(reg1.entries['2']?.fullName).toBe('new/name');
    const gone = updateRegistry(reg0, { discovered: found('1'), facts: new Map([['2', { notFound: true, priority: 1 }]]), date: week(1) }, cfg);
    expect(gone.entries['2']?.status).toBe('RETIRED');
    const later = updateRegistry(gone, { discovered: found('1'), facts: new Map(), date: week(1 + 8) }, cfg);
    expect(later.entries['2']).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ classification experiment

describe('experimental classification rule E1 (never used in production)', () => {
  const miss = (slug: string, domain: 'ai' | 'engineering', score: number, ...terms: string[]) => ({ slug, name: slug, domain, score, positive: terms.map((term) => ({ kind: 'strong-topic', term, points: 3, field: 'topics' })) });
  const unknown = (nearMisses: unknown[], context: unknown[] = []) => ({ topLevelCategory: 'UNKNOWN', categories: [], signals: { accepted: [], nearMisses, suppressed: [], context } }) as unknown as ClassificationResult;

  it('fires only on UNKNOWN with two same-domain near misses resting on different strong topics', () => {
    const r = unknown([miss('ai-agents', 'ai', 5, 'ai-agents'), miss('llm', 'ai', 4, 'llm')]);
    const d = applyE1(r, EXPERIMENT_E1_AI);
    expect(d).toMatchObject({ fired: true, slug: 'ai-agents', topLevel: 'AI' });
  });
  it('never changes an already classified repository', () => {
    const r = { ...unknown([miss('ai-agents', 'ai', 5, 'a'), miss('llm', 'ai', 4, 'b')]), topLevelCategory: 'AI' } as ClassificationResult;
    expect(applyE1(r).fired).toBe(false);
  });
  it('leaves educational/list context alone, requires two categories, and the same topic twice is not corroboration', () => {
    expect(applyE1(unknown([miss('ai-agents', 'ai', 5, 'a'), miss('llm', 'ai', 4, 'b')], [{ kind: 'educational' }])).fired).toBe(false);
    expect(applyE1(unknown([miss('ai-agents', 'ai', 5, 'a')])).fired).toBe(false);
    expect(applyE1(unknown([miss('ai-agents', 'ai', 5, 'same'), miss('llm', 'ai', 4, 'same')])).fired).toBe(false);
  });
  it('cross-domain pairs never fire; the AI-only variant ignores engineering stacks', () => {
    expect(applyE1(unknown([miss('ai-agents', 'ai', 5, 'a'), miss('docker', 'engineering', 4, 'b')])).fired).toBe(false);
    const eng = unknown([miss('kubernetes', 'engineering', 5, 'k8s'), miss('docker', 'engineering', 4, 'docker')]);
    expect(applyE1(eng, EXPERIMENT_E1).fired).toBe(true);
    expect(applyE1(eng, EXPERIMENT_E1_AI).fired).toBe(false);
  });
  it('is not imported by the production classification script', () => {
    expect(readFileSync('scripts/classify/index.ts', 'utf8')).not.toContain('experimental');
    expect(new Classifier(loadTaxonomy())).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ public data and storage

describe('public data: allow-listed fields, no secret shapes, deterministic size accounting', () => {
  const radar = JSON.parse(readFileSync('data/public/radar.json', 'utf8'));
  const history = JSON.parse(readFileSync('data/public/history.json', 'utf8'));
  it('the committed public datasets contain only allow-listed fields', () => {
    expect(publicSchemaProblems(radar, history)).toEqual([]);
  });
  it('an internal field reaching a public record is caught', () => {
    const bad = JSON.parse(JSON.stringify(radar));
    bad.repositories[0].starHistory = { dailyGains: [1] };
    bad.diagnostics = {};
    const h = JSON.parse(JSON.stringify(history));
    Object.values(h.repositories as Record<string, Record<string, unknown>>)[0]!.path = 'C:/x';
    const p = publicSchemaProblems(bad, h).join('|');
    expect(p).toMatch(/top-level key\(s\): diagnostics/);
    expect(p).toMatch(/records have unexpected key\(s\): starHistory/);
    expect(p).toMatch(/entries have unexpected key\(s\): path/);
  });
  it('the allow-list is exactly the documented contract (adding a field is a deliberate change)', () => {
    expect(PUBLIC_REPOSITORY_KEYS).toContain('pattern');
    expect(PUBLIC_REPOSITORY_KEYS).not.toContain('topics');
    expect(PUBLIC_REPOSITORY_KEYS).not.toContain('starHistory');
  });
  it('detects token SHAPES and names the kind, never echoing the value; plain mentions are allowed', () => {
    const fake = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
    const found = secretShapeProblems(`{"x":"${fake}"}`, 'radar dataset');
    expect(found).toEqual(['radar dataset contains a GitHub personal access token shape']);
    expect(found.join()).not.toContain(fake);
    expect(secretShapeProblems('{"description":"Reads GITHUB_TOKEN and sends an Authorization header"}', 'radar dataset')).toEqual([]);
    expect(secretShapeProblems(`github_pat_${'x'.repeat(60)}`, 'h')).toHaveLength(1);
    expect(secretShapeProblems('-----BEGIN RSA PRIVATE KEY-----', 'h')).toHaveLength(1);
  });
  it('the committed public files contain no secret shape', () => {
    expect(secretShapeProblems(readFileSync('data/public/radar.json', 'utf8'), 'radar')).toEqual([]);
    expect(secretShapeProblems(readFileSync('data/public/history.json', 'utf8'), 'history')).toEqual([]);
  });
  it('size projection is linear and deterministic; tree statistics group by extension', () => {
    expect(project({ records: 1000, bytes: 1_000_000 }, [5000, 10000])).toEqual([{ records: 5000, bytes: 5_000_000 }, { records: 10000, bytes: 10_000_000 }]);
    expect(project({ records: 0, bytes: 0 }, [10])).toEqual([{ records: 10, bytes: 0 }]);
    const t = treeStats([{ path: 'out/a/index.html', size: 10 }, { path: 'out/b.js', size: 5 }, { path: 'out\\c.html', size: 20 }, { path: 'out/LICENSE', size: 1 }]);
    expect(t).toEqual({ files: 4, bytes: 36, byExtension: { '.html': { files: 2, bytes: 30 }, '.js': { files: 1, bytes: 5 }, '(none)': { files: 1, bytes: 1 } } });
    expect(treeStats([{ path: 'a.js', size: 1 }])).toEqual(treeStats([{ path: 'a.js', size: 1 }]));
  });
  it('the public files stay inside the documented budgets', () => {
    const cfg = JSON.parse(readFileSync('config/pipeline.json', 'utf8')) as { gate: { warnPublicBytes: number }; history: { maxBytes: number } };
    expect(readFileSync('data/public/radar.json').length).toBeLessThan(cfg.gate.warnPublicBytes);
    expect(readFileSync('data/public/history.json').length).toBeLessThan(cfg.history.maxBytes);
  });
});

// ------------------------------------------------------------------------------------------------ due selection grace

describe('due selection: scheduling jitter must not skip a whole run', () => {
  const t = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
  const recs = [
    { id: 'due', tier: 'HOT' as const, nextRefreshAt: t(-1) },
    { id: 'soon', tier: 'HOT' as const, nextRefreshAt: t(0.3) }, // 18 minutes after the run starts (the observed failure)
    { id: 'later', tier: 'HOT' as const, nextRefreshAt: t(5) },
  ];
  it('without grace the repository 18 minutes early is skipped (the defect)', () => {
    expect(selectDue(recs, NOW).map((r) => r.id)).toEqual(['due']);
  });
  it('with a grace period it is collected, and a repository really not due is still left alone', () => {
    expect(selectDue(recs, NOW, ['HOT', 'UNASSESSED', 'WARM', 'DORMANT'], undefined, 3).map((r) => r.id)).toEqual(['due', 'soon']);
  });
  it('the shipped policy carries the grace; it defaults to 0 when absent and rejects negatives', () => {
    expect(loadTrackingPolicy().dueGraceHours).toBe(3);
    const raw = JSON.parse(readFileSync('config/tracking.json', 'utf8'));
    delete raw.dueGraceHours;
    expect(parseTrackingPolicy(raw).dueGraceHours).toBe(0);
    expect(() => parseTrackingPolicy({ ...raw, dueGraceHours: -1 })).toThrow();
  });
  it('the grace is smaller than the shortest interval, so a repository is never collected twice in one interval', () => {
    const p = loadTrackingPolicy();
    expect(p.dueGraceHours).toBeLessThan(p.tiers.hot.refreshHours / 2);
  });
});
