/**
 * Phase 6.3: score candidate normalisation algorithms on the replay table, per domain. Read-only; deterministic.
 *
 *   tsx scripts/momentum/normalization-eval.ts <replay-rows.json> [--out results/phase6.3/normalization-replay.json]
 *
 * Inputs to every algorithm are the observable-at-T columns only. `next7` (stars gained in the following week) is used here, and only here,
 * to score outcomes: it is never passed to `normalize`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { bandIndexOf, normalize, quantile, quantileBounds, type NormalizationParams, type NormalizationRow } from '../../src/momentum/normalize';

const inPath = process.argv[2] ?? 'results/phase6.3/cache/replay-rows.json';
const argv = process.argv.slice(2);
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3/normalization-replay.json';

interface Row { i: number; stars: number; g7: number; g30: number | null; g90: number | null; v7: number; accel: number | null; trend: string; pattern: string | null; spike: number; hist: number; next7: number | null }
const data = JSON.parse(readFileSync(inPath, 'utf8')) as { meta: unknown; repos: { id: string; fullName: string; domain: 'AI' | 'ENGINEERING' | null; top: string; cat: string | null }[]; dates: string[]; rows: Record<string, Row[]> };

type BandScheme = 'none' | 'fixed' | 'frozen' | 'terciles' | 'quartiles';
interface Config {
  name: string;
  algorithm: NormalizationParams['algorithm'] | 'production';
  metric: NormalizationParams['metric'];
  domainPercentile: number;
  bandPercentile: number;
  bands: BandScheme;
}

const configs: Config[] = [{ name: 'P production Rising label', algorithm: 'production', metric: 'g7', domainPercentile: 0, bandPercentile: 0, bands: 'none' }];
configs.push({ name: 'A raw absolute gates (velocity>=100, growth>=700)', algorithm: 'raw', metric: 'g7', domainPercentile: 0.98, bandPercentile: 0.97, bands: 'none' });
for (const metric of ['g7', 'g30', 'blend'] as const) {
  for (const dp of [0.95, 0.98, 0.99]) configs.push({ name: `B domain percentile ${dp} ${metric}`, algorithm: 'domain', metric, domainPercentile: dp, bandPercentile: 0.97, bands: 'none' });
  for (const scheme of ['fixed', 'frozen', 'terciles', 'quartiles'] as const) {
    for (const bp of [0.95, 0.97, 0.99]) configs.push({ name: `C band percentile ${bp} ${scheme} ${metric}`, algorithm: 'band', metric, domainPercentile: 0.98, bandPercentile: bp, bands: scheme });
    configs.push({ name: `D hybrid 0.98/0.97 ${scheme} ${metric}`, algorithm: 'hybrid', metric, domainPercentile: 0.98, bandPercentile: 0.97, bands: scheme });
  }
}

const FLOORS = { AI: { domain: 100, band: 50 }, ENGINEERING: { domain: 50, band: 30 } } as const;

function boundsFor(scheme: BandScheme, stars: number[]): number[] {
  if (scheme === 'fixed') return [1000, 10000];
  // frozen: rounded empirical terciles of the Engineering star distribution (1,133-1,275 and 5,713-6,007 across the replay window)
  if (scheme === 'frozen') return [1200, 6000];
  if (scheme === 'terciles') return quantileBounds(stars, 3);
  if (scheme === 'quartiles') return quantileBounds(stars, 4);
  return [];
}

function flaggedSets(domain: 'AI' | 'ENGINEERING', cfg: Config): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const T of data.dates) {
    const rows = (data.rows[T] ?? []).filter((r) => data.repos[r.i]!.domain === domain);
    if (cfg.algorithm === 'production') {
      out.set(T, new Set(rows.filter((r) => r.trend === 'RISING').map((r) => r.i)));
      continue;
    }
    const nrows: NormalizationRow[] = rows.map((r) => ({ id: String(r.i), stars: r.stars, growth7d: r.g7, growth30d: r.g30, velocity7d: r.v7, accelerationRatio: r.accel, spikeShare: r.spike, historyDays: r.hist }));
    const params: NormalizationParams = {
      algorithm: cfg.algorithm as NormalizationParams['algorithm'],
      metric: cfg.metric,
      domainPercentile: cfg.domainPercentile,
      bandPercentile: cfg.bandPercentile,
      minGrowth7d: FLOORS[domain].domain,
      minBandGrowth7d: FLOORS[domain].band,
      minAcceleration: 0.6,
      maxSpikeShare: 0.6,
      minHistoryDays: 14,
      bandBounds: boundsFor(cfg.bands, rows.map((r) => r.stars)),
      minPeers: 30,
    };
    out.set(T, new Set(normalize(nrows, params).filter((x) => x.flagged).map((x) => Number(x.id))));
  }
  return out;
}

const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);
const r3 = (n: number) => +n.toFixed(3);

function evaluate(domain: 'AI' | 'ENGINEERING', cfg: Config, prod: Map<string, Set<number>>) {
  const sets = flaggedSets(domain, cfg);
  const dates = data.dates;
  const popSize = (data.rows[dates[dates.length - 1]!] ?? []).filter((r) => data.repos[r.i]!.domain === domain).length;
  const byDate = new Map(dates.map((T) => [T, new Map((data.rows[T] ?? []).map((r) => [r.i, r]))]));
  const sizes = dates.map((T) => sets.get(T)!.size);
  const jac: number[] = [];
  const jacProd: number[] = [];
  const shareOfProd: number[] = [];
  const memberShareProd: number[] = [];
  for (let k = 0; k < dates.length; k += 1) {
    const s = sets.get(dates[k]!)!;
    const p = prod.get(dates[k]!)!;
    const inter = [...s].filter((x) => p.has(x)).length;
    if (s.size > 0) memberShareProd.push(inter / s.size);
    if (p.size > 0) shareOfProd.push(inter / p.size);
    const u = new Set([...s, ...p]).size;
    if (u > 0) jacProd.push(inter / u);
    if (k > 0) {
      const a = sets.get(dates[k - 1]!)!;
      const i2 = [...a].filter((x) => s.has(x)).length;
      const u2 = new Set([...a, ...s]).size;
      if (u2 > 0) jac.push(i2 / u2);
    }
  }
  const members: Row[] = [];
  const ids = new Set<number>();
  dates.forEach((T) => {
    for (const i of sets.get(T)!) {
      const r = byDate.get(T)!.get(i);
      if (r) { members.push(r); ids.add(i); }
    }
  });
  const lens: number[] = [];
  for (const i of ids) {
    let run = 0;
    for (const T of dates) {
      if (sets.get(T)!.has(i)) run += 1;
      else if (run) { lens.push(run); run = 0; }
    }
    if (run) lens.push(run);
  }
  // outcomes (dates where the following week is covered)
  let known = 0, keep = 0, collapse = 0, topNext = 0, popKnown = 0, popTop = 0, topBandNext = 0, popBandTop = 0;
  // Band-neutral outcome added after the first run showed the domain-wide lift is biased against band-relative algorithms by construction:
  // 'top 5% of next-week growth within the repository's own size band' (bands fixed at the frozen empirical bounds for every config).
  const outcomeBounds = domain === 'ENGINEERING' ? [1200, 6000] : [1000, 10000];
  const floor = FLOORS[domain].band;
  for (const T of dates) {
    const rows = [...byDate.get(T)!.values()].filter((r) => data.repos[r.i]!.domain === domain && r.next7 !== null);
    if (rows.length < 50) continue;
    const cut = quantile(rows.map((r) => r.next7 as number), 0.95);
    const bandCuts = new Map<number, number>();
    for (let b = 0; b <= outcomeBounds.length; b += 1) {
      const vals = rows.filter((r) => bandIndexOf(r.stars, outcomeBounds) === b).map((r) => r.next7 as number);
      bandCuts.set(b, vals.length ? quantile(vals, 0.95) : Infinity);
    }
    const s = sets.get(T)!;
    for (const r of rows) {
      const isTop = (r.next7 as number) >= Math.max(cut, floor);
      const isTopBand = (r.next7 as number) >= Math.max(bandCuts.get(bandIndexOf(r.stars, outcomeBounds)) as number, floor);
      popKnown += 1;
      if (isTop) popTop += 1;
      if (isTopBand) popBandTop += 1;
      if (!s.has(r.i)) continue;
      if (isTopBand) topBandNext += 1;
      known += 1;
      if ((r.next7 as number) >= 0.5 * r.g7) keep += 1;
      if ((r.next7 as number) < 0.25 * r.g7) collapse += 1;
      if (isTop) topNext += 1;
    }
  }
  const catCount = new Map<string, number>();
  for (const m of members) { const c = data.repos[m.i]!.cat ?? 'none'; catCount.set(c, (catCount.get(c) ?? 0) + 1); }
  const topCat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const baseTop = popTop / Math.max(1, popKnown);
  return {
    config: cfg.name,
    meanSetSize: r3(sizes.reduce((a, b) => a + b, 0) / sizes.length),
    shareOfDomainPct: r3((sizes.reduce((a, b) => a + b, 0) / sizes.length / popSize) * 100),
    dayToDayJaccard: r3(jac.reduce((a, b) => a + b, 0) / Math.max(1, jac.length)),
    distinctRepos: ids.size,
    medianEpisodeDays: median(lens),
    medianStarsOfMembers: median(members.map((m) => m.stars)),
    shareUnder5kStars: r3(members.filter((m) => m.stars < 5000).length / Math.max(1, members.length)),
    shareOver50kStars: r3(members.filter((m) => m.stars >= 50000).length / Math.max(1, members.length)),
    spikeDominatedShare: r3(members.filter((m) => m.spike > 0.6).length / Math.max(1, members.length)),
    topCategoryShare: topCat ? [topCat[0], r3(topCat[1] / Math.max(1, members.length))] : null,
    memberShareThatIsProductionRising: r3(memberShareProd.reduce((a, b) => a + b, 0) / Math.max(1, memberShareProd.length)),
    productionRisingCaptured: r3(shareOfProd.reduce((a, b) => a + b, 0) / Math.max(1, shareOfProd.length)),
    jaccardWithProduction: r3(jacProd.reduce((a, b) => a + b, 0) / Math.max(1, jacProd.length)),
    outcomeMemberDays: known,
    persistenceNext7AtLeastHalf: r3(keep / Math.max(1, known)),
    collapseNext7UnderQuarter: r3(collapse / Math.max(1, known)),
    liftNext7Top5pct: r3(topNext / Math.max(1, known) / Math.max(1e-9, baseTop)),
    liftNext7Top5pctWithinBand: r3(topBandNext / Math.max(1, known) / Math.max(1e-9, popBandTop / Math.max(1, popKnown))),
  };
}

const result: Record<string, unknown> = { meta: data.meta, dates: [data.dates[0], data.dates[data.dates.length - 1]], floors: FLOORS, shared: { minAcceleration: 0.6, maxSpikeShare: 0.6, minHistoryDays: 14, minPeers: 30 } };
for (const domain of ['ENGINEERING', 'AI'] as const) {
  const prod = flaggedSets(domain, configs[0]!);
  result[domain] = configs.map((c) => evaluate(domain, c, prod));
}
// Pre-declared selection rule (written before looking at which configuration wins), applied to ENGINEERING:
//  eligible = set size 1.0-2.5% of the domain, day-to-day overlap >= 0.80, persistence >= 0.75, collapse <= 0.08, spike-dominated <= 0.05
//  rank eligible by share of members under 5k stars (small-repository representation), then persistence, then overlap.
type Metrics = ReturnType<typeof evaluate>;
const eligible = (result.ENGINEERING as Metrics[]).filter(
  (m) => m.config !== configs[0]!.name && m.shareOfDomainPct >= 1.0 && m.shareOfDomainPct <= 2.5 && m.dayToDayJaccard >= 0.8 && m.persistenceNext7AtLeastHalf >= 0.75 && m.collapseNext7UnderQuarter <= 0.08 && m.spikeDominatedShare <= 0.05,
);
eligible.sort((a, b) => b.shareUnder5kStars - a.shareUnder5kStars || b.persistenceNext7AtLeastHalf - a.persistenceNext7AtLeastHalf || b.dayToDayJaccard - a.dayToDayJaccard);
result.selection = {
  rule: 'eligible: set size 1.0-2.5% of domain, day-to-day overlap >= 0.80, persistence >= 0.75, collapse <= 0.08, spike-dominated <= 0.05; rank by share of members under 5k stars, then persistence, then overlap',
  eligibleCount: eligible.length,
  top8: eligible.slice(0, 8),
  winner: eligible[0] ?? null,
};
writeFileSync(outPath, JSON.stringify(result, null, 1) + '\n');
console.log('\n== SELECTION (ENGINEERING) ==', eligible.length, 'eligible');
for (const m of eligible.slice(0, 10)) console.log(`${m.config.padEnd(52)} set ${m.shareOfDomainPct}% jac ${m.dayToDayJaccard} <5k ${m.shareUnder5kStars} >50k ${m.shareOver50kStars} keep ${m.persistenceNext7AtLeastHalf} coll ${m.collapseNext7UnderQuarter} lift ${m.liftNext7Top5pct} liftBand ${m.liftNext7Top5pctWithinBand}`);
for (const domain of ['ENGINEERING', 'AI'] as const) {
  console.log(`\n== ${domain} ==`);
  for (const r of result[domain] as ReturnType<typeof evaluate>[]) {
    console.log(`${r.config.padEnd(52)} set ${String(r.meanSetSize).padStart(6)} (${String(r.shareOfDomainPct).padStart(5)}%) jac ${r.dayToDayJaccard} ep ${r.medianEpisodeDays} stars~${r.medianStarsOfMembers} <5k ${r.shareUnder5kStars} >50k ${r.shareOver50kStars} spike ${r.spikeDominatedShare} prodShare ${r.memberShareThatIsProductionRising} keep ${r.persistenceNext7AtLeastHalf} coll ${r.collapseNext7UnderQuarter} lift ${r.liftNext7Top5pct}`);
  }
}
