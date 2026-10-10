/**
 * Phase 6.3.1: historical replay of candidate Engineering lifecycle semantics. Read-only; writes only the result file.
 *
 *   tsx scripts/lifecycle/replay.ts <state data dir> [--out results/phase6.3.1/lifecycle-replay.json]
 *
 * For every Engineering repository and each of 29 evaluation dates T (2026-09-05 .. 2026-10-03) it computes, from data observable at T only:
 * Trending (the hybrid from config/domains.json), Rising with three persistence filters, Accelerating and Breakout under three growth floors,
 * four Cooling definitions and two Sustained definitions. The following week's growth is used ONLY to score them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dateRange, historicalRecord } from '../../src/backtest';
import { gainsOf } from '../../src/collect/dataset';
import { loadDomainConfig, radarDomainOf } from '../../src/domain';
import { domainMomentumFields } from '../../src/domain/contract';
import { classifyPattern, parsePatternConfig, type PatternConfig } from '../../src/explain/pattern';
import { baselineWeekly, isCooling, isRising, isSustained, loadLifecycleConfig, weeklyWindows, type CoolingKind, type LifecycleConfig } from '../../src/lifecycle/engineering';
import { loadMomentumConfig } from '../../src/momentum/config';
import { evaluateRepository } from '../../src/momentum/engine';
import { normalize, percentileRank } from '../../src/momentum/normalize';

const argv = process.argv.slice(2);
const dir = argv[0] as string;
const dumpFlags = argv.includes('--dump-flags') ? (argv[argv.indexOf('--dump-flags') + 1] as string) : null;
const dumpExplanations = argv.includes('--dump-explanations') ? (argv[argv.indexOf('--dump-explanations') + 1] as string) : null;
// Phase 6.3.2: {date: [repository ids]} restricts the population on each date (a point-in-time classification / publication population). Dates without an entry are skipped.
const populationPath = argv.includes('--population') ? (argv[argv.indexOf('--population') + 1] as string) : null;
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3.1/lifecycle-replay.json';

const mcfg = loadMomentumConfig();
const base = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const withFloor = (f: number): PatternConfig => ({ ...base, spike: { ...base.spike, minGrowth7d: f }, breakout: { ...base.breakout, minGrowth7d: f }, accelerating: { ...base.accelerating, minGrowth7d: f } });
const patternConfigs: Record<string, PatternConfig> = { F100: base, F50: withFloor(50), F30: withFloor(30) };
const lc = loadLifecycleConfig();
const adapter = loadDomainConfig().ENGINEERING;
if (adapter.mode !== 'normalized') throw new Error('ENGINEERING adapter must be normalized');

const repos = (JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { repositories: any[] }).repositories;
const cls = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r.result]));
const eng = repos.filter((r) => radarDomainOf((cls.get(r.id)?.topLevelCategory ?? 'UNKNOWN') as any) === 'ENGINEERING');
const dates = dateRange('2026-10-03', 29).reverse();
const popSets = populationPath ? new Map(Object.entries(JSON.parse(readFileSync(populationPath, 'utf8')) as Record<string, string[]>).map(([d, ids]) => [d, new Set(ids)])) : null;
const explanations: Record<string, Record<string, string[]>> = {};

interface Feat { i: number; stars: number; g7: number; g30: number | null; w: NonNullable<ReturnType<typeof weeklyWindows>>; next7: number | null; next14: number | null; productionTrend: string; sustainedProd: boolean; patterns: Record<string, string>; trending: boolean; domainPctG30: number; baselinePct: number }
const feats: Record<string, Map<number, Feat>> = {};
const flagsByName: Record<string, Map<string, Set<number>>> = {};
const addFlag = (name: string, T: string, i: number) => {
  flagsByName[name] ??= new Map();
  const m = flagsByName[name]!;
  if (!m.has(T)) m.set(T, new Set());
  m.get(T)!.add(i);
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---- pass 1: observable features per date
const trendingByDate = new Map<string, Set<number>>();
for (const T of dates) {
  const tmp: { i: number; e: ReturnType<typeof evaluateRepository>; gains: number[]; dates: string[]; hr: any; r: any }[] = [];
  eng.forEach((r, i) => {
    if (popSets && !popSets.get(T)?.has(r.id)) return;
    const hr = historicalRecord(r, T);
    if (!hr) return;
    const e = evaluateRepository(hr, hr.growthAsOf as string, new Date(hr.growthAsOf as string), mcfg);
    const all = gainsOf(r.starHistory) as { date: string; count: number }[];
    const upTo = all.filter((g) => g.date <= T);
    tmp.push({ i, e, gains: upTo.map((g) => g.count), dates: upTo.map((g) => g.date), hr, r });
    void all;
  });
  const rows = tmp.filter((t) => t.e.signals.growth7d !== null && t.e.signals.velocity7d !== null && weeklyWindows(t.gains) !== null);
  const nrows = rows.map((t) => {
    const last7 = t.gains.slice(-7);
    const s = last7.reduce((a, b) => a + b, 0);
    return { id: String(t.i), stars: t.hr.stars as number, growth7d: t.e.signals.growth7d as number, growth30d: t.e.signals.growth30d, velocity7d: t.e.signals.velocity7d as number, accelerationRatio: t.e.signals.accelerationRatio, spikeShare: s > 0 ? Math.max(...last7) / s : 0, historyDays: t.gains.length };
  });
  const res = normalize(nrows, adapter.params);
  const baselines = rows.map((t) => baselineWeekly(weeklyWindows(t.gains)!));
  const m = new Map<number, Feat>();
  const trending = new Set<number>();
  rows.forEach((t, k) => {
    const w = weeklyWindows(t.gains)!;
    const sig = t.e.signals;
    const all = gainsOf(t.r.starHistory) as { date: string; count: number }[];
    const after = all.filter((g) => g.date > T);
    const target7 = addDays(T, 7);
    const target14 = addDays(T, 14);
    const lastDate = all.length ? all[all.length - 1]!.date : '';
    const next7 = lastDate >= target7 ? after.slice(0, 7).reduce((a, g) => a + g.count, 0) : null;
    const next14 = lastDate >= target14 ? after.slice(7, 14).reduce((a, g) => a + g.count, 0) : null;
    const pi = { stars: t.hr.stars, ageDays: sig.ageDays, growth7d: sig.growth7d, growth30d: sig.growth30d, growth90d: sig.growth90d, velocity7d: sig.velocity7d, velocity30d: sig.velocity30d, velocity90d: sig.velocity90d, priorVelocity: sig.priorVelocity, accelerationRatio: sig.accelerationRatio, trend: t.e.trend, flags: { sustained: sig.sustained, newEntrant: sig.newEntrant } };
    const patterns = Object.fromEntries(Object.entries(patternConfigs).map(([name, c]) => [name, classifyPattern(pi, c)]));
    const nr = res[k]!;
    if (nr.flagged) {
      const dm = domainMomentumFields('ENGINEERING', adapter.params, nr, { growth7d: sig.growth7d as number, growth30d: sig.growth30d, accelerationRatio: sig.accelerationRatio, stars: t.hr.stars, ageDays: sig.ageDays });
      (explanations[T] ??= {})[String(t.i)] = dm.explanation;
    }
    const f: Feat = { i: t.i, stars: t.hr.stars, g7: sig.growth7d as number, g30: sig.growth30d, w, next7, next14, productionTrend: t.e.trend, sustainedProd: sig.sustained, patterns, trending: nr.flagged, domainPctG30: nr.domainPercentile, baselinePct: percentileRank(baselines, baselines[k] as number) };
    m.set(t.i, f);
    if (nr.flagged) trending.add(t.i);
  });
  feats[T] = m;
  trendingByDate.set(T, trending);
}

// ---- pass 2: semantics
const dateIdx = new Map(dates.map((d, k) => [d, k]));
flagsByName['trending'] = new Map(dates.map((d) => [d, trendingByDate.get(d)!]));
for (const T of dates) {
  const k = dateIdx.get(T) as number;
  for (const [i, f] of feats[T]!) {
    const hist = [1, 2, 3, 4, 5].map((n) => (k - n >= 0 ? trendingByDate.get(dates[k - n] as string)!.has(i) : undefined));
    for (const [name, persistence] of [['rising:none', 'none'], ['rising:twoDays', 'twoDays'], ['rising:threeOfFive', 'threeOfFive']] as const) if (isRising(f.trending, hist, persistence)) addFlag(name, T, i);
    for (const kind of ['production', 'fromHigh', 'twoDeclines', 'lostTrending'] as CoolingKind[]) {
      if (isCooling(kind, { w: f.w, productionCooling: f.productionTrend === 'COOLING', baselinePercentile: f.baselinePct, trendingHistory: hist, trendingToday: f.trending }, lc.cooling)) addFlag(`cooling:${kind}`, T, i);
    }
    if (f.sustainedProd) addFlag('sustained:production', T, i);
    if (isSustained(f.w, f.domainPctG30, lc.sustained)) addFlag('sustained:engineering', T, i);
    for (const [floor, p] of Object.entries(f.patterns)) {
      if (p === 'ACCELERATING') addFlag(`accelerating:${floor}`, T, i);
      if (p === 'BREAKOUT') addFlag(`breakout:${floor}`, T, i);
    }
  }
}

// ---- metrics
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);
const r3 = (n: number) => +n.toFixed(3);
function metrics(name: string, kind: 'growth' | 'cooling' | 'sustained') {
  const sets = flagsByName[name] ?? new Map();
  const get = (T: string) => sets.get(T) ?? new Set<number>();
  const sizes = dates.map((T) => get(T).size);
  const pop = dates.map((T) => feats[T]!.size);
  const jac: number[] = [];
  for (let k = 1; k < dates.length; k += 1) {
    const a = get(dates[k - 1]!), b = get(dates[k]!);
    const u = new Set([...a, ...b]).size;
    if (u > 0) jac.push([...a].filter((x) => b.has(x)).length / u);
  }
  const ids = new Set<number>();
  for (const T of dates) for (const i of get(T)) ids.add(i);
  const lens: number[] = [];
  for (const i of ids) {
    let run = 0;
    for (const T of dates) { if (get(T).has(i)) run += 1; else if (run) { lens.push(run); run = 0; } }
    if (run) lens.push(run);
  }
  let known = 0, keep = 0, collapse = 0, confirmed = 0, recovered = 0, still = 0, stillKnown = 0;
  for (const T of dates) {
    const k = dateIdx.get(T) as number;
    for (const i of get(T)) {
      const f = feats[T]!.get(i)!;
      if (f.next7 === null) continue;
      known += 1;
      if (f.next7 >= 0.5 * f.w.w0) keep += 1;
      if (f.next7 < 0.25 * f.w.w0) collapse += 1;
      const b = baselineWeekly(f.w);
      if (f.next7 < 0.6 * b) confirmed += 1;
      if (f.next7 >= 0.8 * b) recovered += 1;
      if (kind === 'sustained' && k + 7 < dates.length) { stillKnown += 1; if (get(dates[k + 7] as string).has(i)) still += 1; }
    }
  }
  const short = lens.filter((l) => l <= 3).length;
  const meanPop = pop.reduce((a, b) => a + b, 0) / pop.length;
  return {
    name,
    meanSetSize: r3(sizes.reduce((a, b) => a + b, 0) / sizes.length),
    shareOfDomainPct: r3((sizes.reduce((a, b) => a + b, 0) / sizes.length / meanPop) * 100),
    dayToDayJaccard: r3(jac.reduce((a, b) => a + b, 0) / Math.max(1, jac.length)),
    distinctRepos: ids.size,
    episodes: lens.length,
    medianEpisodeDays: median(lens),
    shortLivedEpisodeShare: r3(short / Math.max(1, lens.length)),
    outcomeMemberDays: known,
    persistenceNext7AtLeastHalfOfWeek: r3(keep / Math.max(1, known)),
    collapseNext7UnderQuarterOfWeek: r3(collapse / Math.max(1, known)),
    ...(kind === 'cooling' ? { confirmedNext7Under60PctOfBaseline: r3(confirmed / Math.max(1, known)), recoveredNext7AtLeast80PctOfBaseline: r3(recovered / Math.max(1, known)) } : {}),
    ...(kind === 'sustained' ? { stillSustainedSevenDaysLater: r3(still / Math.max(1, stillKnown)), sustainedOutcomeDays: stillKnown } : {}),
  };
}
const out: Record<string, any> = { window: [dates[0], dates[dates.length - 1]], engineeringRepositories: eng.length, config: lc, patternFloors: { F100: 'production (100 stars/week)', F50: 50, F30: 30 } };
out.trending = metrics('trending', 'growth');
out.rising = ['rising:none', 'rising:twoDays', 'rising:threeOfFive'].map((n) => metrics(n, 'growth'));
out.accelerating = ['accelerating:F100', 'accelerating:F50', 'accelerating:F30'].map((n) => metrics(n, 'growth'));
out.breakout = ['breakout:F100', 'breakout:F50', 'breakout:F30'].map((n) => metrics(n, 'growth'));
out.cooling = ['cooling:production', 'cooling:fromHigh', 'cooling:twoDeclines', 'cooling:lostTrending'].map((n) => metrics(n, 'cooling'));
out.sustained = ['sustained:production', 'sustained:engineering'].map((n) => metrics(n, 'sustained'));

// overlap check: Cooling (chosen kind) and Trending must be mutually exclusive by construction
{
  let both = 0, cooling = 0;
  for (const T of dates) {
    const c = flagsByName['cooling:fromHigh']?.get(T) ?? new Set<number>();
    const t = trendingByDate.get(T)!;
    cooling += c.size;
    for (const i of c) if (t.has(i)) both += 1;
  }
  out.overlaps = { coolingFromHighMemberDays: cooling, coolingFromHighAlsoTrending: both };
}

// ---- pre-declared selections (written before the results were looked at)
const risingBase = out.rising[0];
const risingOk = out.rising.filter((m: any) => m.meanSetSize >= 0.6 * risingBase.meanSetSize);
risingOk.sort((a: any, b: any) => b.persistenceNext7AtLeastHalfOfWeek - a.persistenceNext7AtLeastHalfOfWeek || a.shortLivedEpisodeShare - b.shortLivedEpisodeShare);
const coolingEligible = out.cooling.filter((m: any) => m.shareOfDomainPct >= 0.2);
coolingEligible.sort((a: any, b: any) => b.confirmedNext7Under60PctOfBaseline - a.confirmedNext7Under60PctOfBaseline || a.recoveredNext7AtLeast80PctOfBaseline - b.recoveredNext7AtLeast80PctOfBaseline);
const f100 = (arr: any[]) => arr[0].persistenceNext7AtLeastHalfOfWeek;
const lowestFloor = (arr: any[]) => [arr[2], arr[1], arr[0]].find((m) => m.persistenceNext7AtLeastHalfOfWeek >= f100(arr) - 0.05 && m.meanSetSize > 0) ?? arr[0];
out.selection = {
  rule: {
    rising: 'among the persistence filters keep those whose mean set size is at least 60% of the unfiltered Trending set; choose the highest next-week persistence, then the lower short-lived episode share',
    cooling: 'eligible: at least 0.2% of the domain per day; choose the highest confirmed rate (next week under 60% of the 28-day baseline), then the lowest recovery rate',
    patterns: 'choose the lowest growth floor whose next-week persistence is within 0.05 of the production floor (a lower floor widens coverage without lowering quality)',
    sustained: 'report only: choose the Engineering definition if it is still sustained seven days later more often than the production flag and its set is not smaller',
  },
  rising: risingOk[0]?.name ?? null,
  cooling: coolingEligible[0]?.name ?? null,
  accelerating: lowestFloor(out.accelerating).name,
  breakout: lowestFloor(out.breakout).name,
  sustained: out.sustained[1].stillSustainedSevenDaysLater > out.sustained[0].stillSustainedSevenDaysLater && out.sustained[1].meanSetSize >= out.sustained[0].meanSetSize ? out.sustained[1].name : out.sustained[0].name,
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
// every flag set per date, for the leakage audit (scripts/lifecycle/leakage-audit.ts)
if (dumpFlags) writeFileSync(dumpFlags, JSON.stringify(Object.fromEntries(Object.entries(flagsByName).map(([n, m]) => [n, Object.fromEntries([...m.entries()].map(([d, set]) => [d, [...set].sort((a, b) => a - b)]))]))));
if (dumpExplanations) writeFileSync(dumpExplanations, JSON.stringify(explanations));
const line = (m: any) => `${m.name.padEnd(26)} set ${String(m.meanSetSize).padStart(6)} (${String(m.shareOfDomainPct).padStart(5)}%) jac ${m.dayToDayJaccard} ep ${m.medianEpisodeDays} short ${m.shortLivedEpisodeShare} keep ${m.persistenceNext7AtLeastHalfOfWeek} coll ${m.collapseNext7UnderQuarterOfWeek}${m.confirmedNext7Under60PctOfBaseline !== undefined ? ` confirmed ${m.confirmedNext7Under60PctOfBaseline} recovered ${m.recoveredNext7AtLeast80PctOfBaseline}` : ''}${m.stillSustainedSevenDaysLater !== undefined ? ` still ${m.stillSustainedSevenDaysLater}` : ''}`;
for (const k of ['rising', 'accelerating', 'breakout', 'cooling', 'sustained']) { console.log(`\n== ${k}`); for (const m of out[k]) console.log(line(m)); }
console.log('\ntrending', line(out.trending), '\nselection', JSON.stringify(out.selection));
void ({} as LifecycleConfig);
