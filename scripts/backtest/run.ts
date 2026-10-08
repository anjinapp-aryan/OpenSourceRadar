/**
 * Phase 6.2 real-data analysis (offline; reads pipeline state, writes results/phase6.2/*.json).
 *
 *   npx tsx scripts/backtest/run.ts <state data dir> [radar.json] [--days 91]
 *
 * 1. Validates the back-tester: `evaluateCurrent` must reproduce the published score/trend/pattern exactly.
 * 2. History audit (per-record quality states + coverage percentiles).
 * 3. Daily back-test over the last N days with the CURRENT production rules -> Rising persistence, churn, patterns.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dateRange, evaluateAt, evaluateCurrent, historicalRecord, lastHistoryDate, lastSnapshot, risingHistory, type HistoricalSnapshot } from '../../src/backtest';
import type { Dataset as RepositoryDataset, RepositoryRecord } from '../../src/collect/dataset';
import { parsePatternConfig } from '../../src/explain/pattern';
import { recordHistoryQuality, HISTORY_QUALITY_STATES } from '../../src/history/quality';
import { trajectoryMetrics } from '../../src/history/trajectory';
import { loadMomentumConfig } from '../../src/momentum/config';
import type { PublicDataset } from '../../src/momentum/dataset';

const args = process.argv.slice(2);
const stateDir = args[0] ?? '.pipeline/state-2026-10-06/data';
const radarPath = args[1] && !args[1].startsWith('--') ? args[1] : 'data/public/radar.json';
const days = Number(args[args.indexOf('--days') + 1] ?? 91) || 91;
const out = 'results/phase6.2';
mkdirSync(out, { recursive: true });

const cfg = loadMomentumConfig();
const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const repos = JSON.parse(readFileSync(join(stateDir, 'repositories.json'), 'utf8')) as RepositoryDataset;
const radar = JSON.parse(readFileSync(radarPath, 'utf8')) as PublicDataset;
const candidates = new Set((JSON.parse(readFileSync(join(stateDir, 'candidates/candidates.json'), 'utf8')) as { candidates: { id: string }[] }).candidates.map((c) => c.id));
const classified = new Map((JSON.parse(readFileSync(join(stateDir, 'classified/classified.json'), 'utf8')) as { repositories: { id: string; result: { topLevelCategory: string } }[] }).repositories.map((c) => [c.id, c.result.topLevelCategory]));
const published = new Map(radar.repositories.map((r) => [r.id, r]));
const t0 = Date.now();

// ---------------------------------------------------------------- 1. back-tester validation against production
const now = new Date(radar.generatedAt);
let compared = 0;
const mismatches: string[] = [];
for (const r of repos.repositories) {
  const p = published.get(r.id);
  if (!p) continue;
  compared += 1;
  const s = evaluateCurrent(r, repos.generatedAt, now, cfg, pcfg);
  if (s.score !== p.score || s.trend !== p.trend || s.pattern !== (p.pattern ?? null) || s.growth7d !== p.growth7d || s.growth30d !== p.growth30d || s.growth90d !== p.growth90d) {
    mismatches.push(`${p.fullName}: score ${s.score}/${p.score} trend ${s.trend}/${p.trend} pattern ${s.pattern}/${p.pattern}`);
  }
}

// ---------------------------------------------------------------- 2. history audit
const asOfDate = repos.asOfDate ?? repos.generatedAt.slice(0, 10);
/** History quality is judged against the record's OWN collection date: refresh frequency (tier) is freshness, not a gap. */
const recordAsOf = (r: RepositoryRecord) => (r.growthAsOf ?? repos.generatedAt).slice(0, 10);
const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
function audit(set: RepositoryRecord[]) {
  const lens = set.map((r) => r.starHistory.dailyGains.length).sort((a, b) => a - b);
  const states = Object.fromEntries(HISTORY_QUALITY_STATES.map((s) => [s, 0])) as Record<string, number>;
  let zeroValueDays = 0;
  let totalDays = 0;
  let allZero = 0;
  let recentOnly = 0;
  for (const r of set) {
    const qu = recordHistoryQuality(r.starHistory, r.createdAt, recordAsOf(r));
    states[qu.state] = (states[qu.state] ?? 0) + 1;
    const g = r.starHistory.dailyGains;
    totalDays += g.length;
    zeroValueDays += g.filter((x) => x === 0).length;
    if (g.length > 0 && g.every((x) => x === 0)) allZero += 1;
    const ageDays = (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(r.createdAt)) / 86_400_000;
    if (g.length < 90 && ageDays >= 90 && !qu.coversLife) recentOnly += 1;
  }
  const pct = (k: number) => Math.round((1000 * set.filter((r) => r.starHistory.dailyGains.length >= k).length) / Math.max(1, set.length)) / 10;
  return {
    records: set.length,
    length: { p10: q(lens, 0.1), p25: q(lens, 0.25), p50: q(lens, 0.5), p75: q(lens, 0.75), p90: q(lens, 0.9), max: lens[lens.length - 1] ?? 0, min: lens[0] ?? 0 },
    percentAtLeast: { d7: pct(7), d30: pct(30), d90: pct(90), d180: pct(180), d210: pct(210) },
    qualityStates: states,
    zeroValueDayShare: Math.round((1000 * zeroValueDays) / Math.max(1, totalDays)) / 10,
    allZeroSeries: allZero,
    recentOnlyHistory: recentOnly,
    lastDates: Object.entries(set.reduce<Record<string, number>>((m, r) => ((m[lastHistoryDate(r) ?? 'none'] = (m[lastHistoryDate(r) ?? 'none'] ?? 0) + 1), m), {})).sort(),
    firstDates: { earliest: set.map((r) => r.starHistory.firstDate).sort()[0], latest: set.map((r) => r.starHistory.firstDate).sort().at(-1) },
  };
}
const all = repos.repositories;
const pub = all.filter((r) => published.has(r.id));
const ai = pub.filter((r) => ['AI', 'BOTH'].includes(classified.get(r.id) ?? ''));
const historyAudit = { asOfDate, all: audit(all), published: audit(pub), aiScope: audit(ai) };

// ---------------------------------------------------------------- 3. daily back-test, newest -> oldest, then reversed
const dates = dateRange(asOfDate, days).reverse(); // oldest .. newest
const series = new Map<string, Array<HistoricalSnapshot | null>>();
for (const r of all) series.set(r.id, dates.map((d) => evaluateAt(r, d, cfg, pcfg)));

// Coverage by date: records are refreshed on different days (HOT daily, WARM every 3 days, DORMANT weekly), so the newest
// grid dates are covered for fewer records. Churn is therefore computed on the records covered on BOTH days.
const coveredByDate = dates.map((_, i) => all.filter((r) => series.get(r.id)?.[i] != null));
const risingSets = dates.map((_, i) => new Set(all.filter((r) => series.get(r.id)?.[i]?.trend === 'RISING').map((r) => r.id)));
const churnAll = dates.slice(1).map((d, k) => {
  const i = k + 1;
  const both = new Set(all.filter((r) => series.get(r.id)?.[i] != null && series.get(r.id)?.[i - 1] != null).map((r) => r.id));
  const now = new Set([...(risingSets[i] as Set<string>)].filter((x) => both.has(x)));
  const prev = new Set([...(risingSets[i - 1] as Set<string>)].filter((x) => both.has(x)));
  const entered = [...now].filter((x) => !prev.has(x)).length;
  const exited = [...prev].filter((x) => !now.has(x)).length;
  const union = new Set([...prev, ...now]).size;
  return { date: d, covered: (coveredByDate[i] as RepositoryRecord[]).length, comparable: both.size, size: now.size, entered, exited, jaccard: union ? Math.round(((now.size + prev.size - union) / union) * 1000) / 1000 : 1 };
});
// A day is only used for churn when at least half of the published records are covered on it and the day before; the newest days
// are covered for fewer records because records are refreshed on different days.
const minComparable = Math.ceil(published.size / 2);
const churn = churnAll.filter((c) => c.comparable >= minComparable);
const churnExcludedDates = churnAll.filter((c) => c.comparable < minComparable).map((c) => c.date);

const histories = all.map((r) => ({ r, h: risingHistory(series.get(r.id) as Array<HistoricalSnapshot | null>) })).filter((x) => x.h.risingDays > 0);
const episodes = histories.flatMap((x) => x.h.episodes.map((e) => ({ ...e, id: x.r.id, fullName: x.r.fullName })));
const closed = episodes.filter((e) => !e.ongoing && !e.leftCensored);
const durs = closed.map((e) => e.days).sort((a, b) => a - b);
const bucketOf = (d: number) => (d < 7 ? '1-6' : d <= 14 ? '7-14' : d <= 30 ? '15-30' : d <= 60 ? '31-60' : '61+');
const bucketize = (xs: number[]) => xs.reduce<Record<string, number>>((m, d) => ((m[bucketOf(d)] = (m[bucketOf(d)] ?? 0) + 1), m), { '1-6': 0, '7-14': 0, '15-30': 0, '31-60': 0, '61+': 0 });
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// what followed the end of a closed Rising episode: the next covered trends within 7 and 14 days (Cooling after Rising)
const dateIdx = new Map(dates.map((d, i) => [d, i] as const));
const after7 = { exits: 0, cooling: 0, steady: 0, rising: 0, notCovered: 0 };
const after14Cooling = { exits: 0, coolingAtSomePoint: 0 };
for (const e of closed) {
  const s = series.get(e.id) as Array<HistoricalSnapshot | null>;
  const i0 = (dateIdx.get(e.end) ?? -1) + 1;
  if (i0 <= 0 || i0 + 14 >= s.length) continue; // need the whole horizon
  const next = s.slice(i0, i0 + 14);
  const first = next[0];
  after7.exits += 1;
  if (first === null || first === undefined) after7.notCovered += 1;
  else if (first.trend === 'COOLING') after7.cooling += 1;
  else if (first.trend === 'RISING') after7.rising += 1;
  else after7.steady += 1;
  after14Cooling.exits += 1;
  if (next.slice(0, 14).some((x) => x?.trend === 'COOLING')) after14Cooling.coolingAtSomePoint += 1;
}
const durationByEntry = Object.fromEntries(['SUSTAINED_GROWTH', 'ACCELERATING', 'SPIKE', 'NEW_LAUNCH', 'BREAKOUT'].map((p) => { const xs = closed.filter((e) => e.entryPattern === p).map((e) => e.days).sort((a, b) => a - b); return [p, { closed: xs.length, median: xs.length ? q(xs, 0.5) : null, mean: mean(xs), shareAtMost7Days: xs.length ? Math.round((1000 * xs.filter((d) => d <= 7).length) / xs.length) / 10 : null }]; }));

// pattern frequency per day and day-to-day transitions (scored records only)
const patternDays: Record<string, number> = {};
const transitions: Record<string, number> = {};
const persistence: Record<string, number[]> = {};
for (const r of all) {
  const s = series.get(r.id) as Array<HistoricalSnapshot | null>;
  let run: { p: string; n: number } | null = null;
  s.forEach((x, i) => {
    const p = x?.pattern ?? null;
    if (p) patternDays[p] = (patternDays[p] ?? 0) + 1;
    const prev = i > 0 ? s[i - 1]?.pattern ?? null : null;
    if (p && prev) transitions[`${prev}>${p}`] = (transitions[`${prev}>${p}`] ?? 0) + 1;
    if (p && run && run.p === p) run.n += 1;
    else {
      if (run && i > 0) (persistence[run.p] ??= []).push(run.n);
      run = p ? { p, n: 1 } : null;
    }
  });
}
const persistSummary = Object.fromEntries(Object.entries(persistence).map(([p, xs]) => { const s = [...xs].sort((a, b) => a - b); return [p, { runs: s.length, median: q(s, 0.5), p90: q(s, 0.9), mean: mean(s) }]; }));

// what followed BREAKOUT / SPIKE / ACCELERATING / NEW_LAUNCH within 14 and 30 days
function followUp(target: string, horizon: number) {
  const outcomes: Record<string, number> = {};
  let starts = 0;
  for (const r of all) {
    const s = series.get(r.id) as Array<HistoricalSnapshot | null>;
    for (let i = 1; i < s.length; i += 1) {
      if (s[i]?.pattern !== target || s[i - 1]?.pattern === target) continue;
      if (i + horizon >= s.length) continue; // need the full horizon (no truncation bias)
      starts += 1;
      const end = s[i + horizon];
      const key = end === null || end === undefined ? 'not covered' : `${end.pattern}/${end.trend}`;
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
  }
  return { starts, horizonDays: horizon, outcomes: Object.fromEntries(Object.entries(outcomes).sort((a, b) => b[1] - a[1])) };
}

// current Rising list (newest date) with history
const newest = dates.length - 1;
const lastSnap = (r: RepositoryRecord) => lastSnapshot(series.get(r.id) as Array<HistoricalSnapshot | null>);
// "Current" = each record's own newest covered day (what production publishes), not the newest grid date.
const currentRising = all.filter((r) => lastSnap(r)?.trend === 'RISING');
const currentRisingDetail = currentRising.map((r) => {
  const s = series.get(r.id) as Array<HistoricalSnapshot | null>;
  const h = risingHistory(s);
  const tm = trajectoryMetrics(r.starHistory.dailyGains);
  const qu = recordHistoryQuality(r.starHistory, r.createdAt, recordAsOf(r));
  const last30 = s.slice(-30).filter((x) => x?.trend === 'RISING').length; // days (of the last 30 grid days) on which it was Rising
  return { fullName: r.fullName, published: published.has(r.id), score: lastSnap(r)?.score, pattern: lastSnap(r)?.pattern, historyQuality: qu.state, historyDays: qu.days, risingDaysLast30: last30, risingDaysLastN: h.risingDays, currentStreak: h.currentStreak, longestStreak: h.longestStreak, episodes: h.episodes.length, positiveWeeks: tm.consecutivePositiveWeeks, quietWeeksBefore: tm.quietWeeksBefore, accelerationDays: tm.accelerationDays, currentToMedianRatio: tm.currentToMedianRatio };
}).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

const prodRising = new Set(radar.lists.rising);
const btRisingPublished = new Set(currentRising.filter((r) => published.has(r.id)).map((r) => r.id));
const newestDayAgreement = {
  productionRising: prodRising.size,
  backtestRisingNewestDayAll: currentRising.length,
  backtestRisingNewestDayPublished: btRisingPublished.size,
  inBoth: [...prodRising].filter((x) => btRisingPublished.has(x)).length,
  onlyProduction: [...prodRising].filter((x) => !btRisingPublished.has(x)).map((x) => published.get(x)?.fullName),
  onlyBacktest: [...btRisingPublished].filter((x) => !prodRising.has(x)).map((x) => published.get(x)?.fullName),
  backtestRisingWithheld: currentRising.filter((r) => !published.has(r.id)).map((r) => r.fullName),
};

// ---------------------------------------------------------------- 4. future-leakage audit on real data
// For sampled (repository, date) pairs: replace EVERYTHING after the date with arbitrary values (keeping the present-day
// star count consistent, because stars-at-T is derived from it) and require an identical snapshot.
function seeded(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const rnd = seeded(20261006);
let leakSamples = 0;
let leakMismatches = 0;
const leakExamples: string[] = [];
const eligible = all.filter((r) => r.starHistory.dailyGains.length >= 60);
for (let n = 0; n < 3000 && eligible.length > 0; n += 1) {
  const r = eligible[Math.floor(rnd() * eligible.length)] as RepositoryRecord;
  const date = dates[Math.floor(rnd() * (dates.length - 1))] as string;
  const base = historicalRecord(r, date);
  if (base === null) continue;
  const keep = base.starHistory.dailyGains.length;
  const full = r.starHistory.dailyGains;
  const garbage = full.slice(keep).map(() => Math.floor(rnd() * 5000));
  const starsAtT = base.stars;
  const mutated: RepositoryRecord = { ...r, stars: starsAtT + garbage.reduce((a2, b2) => a2 + b2, 0), starHistory: { ...r.starHistory, dailyGains: [...full.slice(0, keep), ...garbage] }, pushedAt: r.pushedAt };
  const a1 = evaluateAt(r, date, cfg, pcfg);
  const a2 = evaluateAt(mutated, date, cfg, pcfg);
  leakSamples += 1;
  if (JSON.stringify(a1) !== JSON.stringify(a2)) {
    leakMismatches += 1;
    if (leakExamples.length < 5) leakExamples.push(`${r.fullName} @ ${date}`);
  }
}

const result = {
  newestDayAgreement,
  generatedFrom: { stateDir, radar: radarPath, stateGeneratedAt: repos.generatedAt, radarGeneratedAt: radar.generatedAt, asOfDate, daysBacktested: days, firstDate: dates[0], lastDate: dates[newest] },
  validation: { comparedWithPublished: compared, mismatches: mismatches.length, examples: mismatches.slice(0, 10) },
  leakageAudit: { samples: leakSamples, mismatches: leakMismatches, examples: leakExamples, method: 'everything after T replaced by random values, present-day stars kept consistent; snapshot at T must be identical' },
  coverage: { gridDays: dates.length, publishedRecords: published.size, coveredByDate: dates.map((d, i) => ({ date: d, covered: (coveredByDate[i] as RepositoryRecord[]).length })).slice(-10) },
  historyAudit,
  backtest: {
    risingSetSizeByDate: churn.map((c) => ({ date: c.date, covered: c.covered, size: c.size })),
    churn: { days: churn.length, basis: 'records covered on both days', meanEntered: mean(churn.map((c) => c.entered)), meanExited: mean(churn.map((c) => c.exited)), meanJaccard: mean(churn.map((c) => c.jaccard * 1000))! / 1000, minSize: Math.min(...churn.map((c) => c.size)), maxSize: Math.max(...churn.map((c) => c.size)) },
    repositoriesEverRising: histories.length,
    repositoriesEverRisingPublishedNow: histories.filter((x) => published.has(x.r.id)).length,
    episodes: { total: episodes.length, closed: closed.length, ongoing: episodes.filter((e) => e.ongoing).length, leftCensored: episodes.filter((e) => e.leftCensored).length, closedDurationMean: mean(durs), closedDurationMedian: q(durs, 0.5), closedDurationP90: q(durs, 0.9), longestStreak: Math.max(0, ...episodes.map((e) => e.days)) },
    shortClosedEpisodes: { atMost3Days: durs.filter((d) => d <= 3).length, atMost7Days: durs.filter((d) => d <= 7).length },
    durationBuckets: { closedDays: bucketize(durs), ongoingDaysSoFar: bucketize(episodes.filter((e) => e.ongoing).map((e) => e.days)), leftCensoredDaysSoFar: bucketize(episodes.filter((e) => e.leftCensored).map((e) => e.days)), note: 'closed = started and ended inside the window; ongoing and left-censored episodes are lower bounds' },
    risingExit: { within1Day: after7, anyCoolingWithin14Days: after14Cooling },
    durationByEntryPattern: durationByEntry,
    churnExcludedDates,
    entryPatternOfEpisodes: episodes.reduce<Record<string, number>>((m, e) => ((m[e.entryPattern ?? 'none'] = (m[e.entryPattern ?? 'none'] ?? 0) + 1), m), {}),
    repeatedEntries: { twoOrMoreEpisodes: histories.filter((x) => x.h.episodes.length >= 2).length, threeOrMore: histories.filter((x) => x.h.episodes.length >= 3).length },
    risingDaysDistribution: (() => { const xs = histories.map((x) => x.h.risingDays).sort((a, b) => a - b); return { p25: q(xs, 0.25), p50: q(xs, 0.5), p75: q(xs, 0.75), p90: q(xs, 0.9), max: xs.at(-1) }; })(),
    risingDaysByPattern: (() => { const m: Record<string, number> = {}; for (const r of all) for (const x of series.get(r.id) ?? []) if (x?.trend === 'RISING') m[x.pattern ?? 'none'] = (m[x.pattern ?? 'none'] ?? 0) + 1; return m; })(),
    patternDays,
    patternPersistence: persistSummary,
    topTransitions: Object.fromEntries(Object.entries(transitions).filter(([k]) => !k.startsWith('NORMAL_GROWTH>NORMAL_GROWTH') && k.split('>')[0] !== k.split('>')[1]).sort((a, b) => b[1] - a[1]).slice(0, 25)),
    followUps: { BREAKOUT: followUp('BREAKOUT', 14), SPIKE: followUp('SPIKE', 14), ACCELERATING: followUp('ACCELERATING', 14), NEW_LAUNCH: followUp('NEW_LAUNCH', 30), SPIKE30: followUp('SPIKE', 30), BREAKOUT30: followUp('BREAKOUT', 30) },
    longestEpisodes: [...episodes].sort((a, b) => b.days - a.days).slice(0, 15).map((e) => ({ fullName: e.fullName, days: e.days, start: e.start, end: e.end, ongoing: e.ongoing, leftCensored: e.leftCensored })),
    mostRepeated: histories.sort((a, b) => b.h.episodes.length - a.h.episodes.length).slice(0, 10).map((x) => ({ fullName: x.r.fullName, episodes: x.h.episodes.length, risingDays: x.h.risingDays })),
    currentRising: currentRisingDetail,
  },
  runtimeSeconds: Math.round((Date.now() - t0) / 100) / 10,
};
writeFileSync(join(out, 'backtest.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ validation: result.validation, leakageAudit: result.leakageAudit, historyAudit: { all: historyAudit.all.length, pub: historyAudit.published.percentAtLeast, states: historyAudit.published.qualityStates }, churn: result.backtest.churn, episodes: result.backtest.episodes, runtimeSeconds: result.runtimeSeconds }, null, 1));
