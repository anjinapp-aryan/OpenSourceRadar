/**
 * Phase 6.3 future-data leakage audit for the normalisation layer. Read-only against the state; writes the result file only.
 *
 *   tsx scripts/momentum/leakage-audit.ts <state data dir> [--trials 24] [--sample 500] [--out results/phase6.3/leakage-audit.json]
 *
 * For random evaluation dates T: take a random subset of repositories per domain, build the observable rows and the normalised result at T;
 * then rewrite EVERYTHING after T for every repository (zeros, random bursts, or a 50x scale-up, always keeping the present-day star count
 * consistent) and rebuild. The rows, percentiles, band assignments and flags at T must be identical. Any difference is leakage.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays } from '../../src/analysis/starHistory';
import { gainsOf } from '../../src/collect/dataset';
import { parsePatternConfig } from '../../src/explain/pattern';
import { loadDomainConfig, radarDomainOf, type RadarDomain } from '../../src/domain';
import { loadMomentumConfig } from '../../src/momentum/config';
import { normalize } from '../../src/momentum/normalize';
import { observableRow } from '../../src/momentum/rows';

const argv = process.argv.slice(2);
const dir = argv[0] ?? '.pipeline/state-2026-10-06/data';
const arg = (n: string, d: number) => (argv.includes(n) ? Number(argv[argv.indexOf(n) + 1]) : d);
const trials = arg('--trials', 24);
const sample = arg('--sample', 500);
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3/leakage-audit.json';

const cfg = loadMomentumConfig();
const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const adapters = loadDomainConfig();
const repos = (JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { repositories: any[] }).repositories;
const cls = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r.result]));

let seed = 63;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(xs: T[], n: number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
};

type Variant = 'zeros' | 'bursts' | 'scale50';
function rewriteFuture(r: any, T: string, variant: Variant): any {
  const gains = gainsOf(r.starHistory) as { date: string; count: number }[];
  const counts = gains.map((g) => g.count);
  let delta = 0;
  const next = counts.map((c, i) => {
    if ((gains[i] as { date: string }).date <= T) return c;
    const v = variant === 'zeros' ? 0 : variant === 'bursts' ? Math.floor(rnd() * 5000) : c * 50;
    delta += v - c;
    return v;
  });
  return { ...r, stars: r.stars + delta, starHistory: { ...r.starHistory, dailyGains: next } };
}

const lastDate = '2026-10-03';
const dayMs = 86_400_000;
const earliest = '2026-06-01';
const spanDays = Math.round((Date.parse(lastDate) - Date.parse(earliest)) / dayMs);
const results: Record<string, unknown>[] = [];
let controlSensitive = 0, controlPairs = 0;
let pairs = 0, diffs = 0, rowDiffs = 0, flagDiffs = 0, pctDiffs = 0, bandDiffs = 0;
const variants: Variant[] = ['zeros', 'bursts', 'scale50'];

for (let t = 0; t < trials; t += 1) {
  const T = addDays(earliest, Math.floor(rnd() * spanDays));
  const variant = variants[t % variants.length] as Variant;
  for (const domain of ['ENGINEERING', 'AI'] as RadarDomain[]) {
    const pool = repos.filter((r) => radarDomainOf((cls.get(r.id)?.topLevelCategory ?? 'UNKNOWN') as any) === domain);
    const chosen = pick(pool, sample);
    const mutated = chosen.map((r) => rewriteFuture(r, T, variant));
    const base = chosen.map((r) => observableRow(r, T, cfg, pcfg));
    const mut = mutated.map((r) => observableRow(r, T, cfg, pcfg));
    let rowDiff = 0;
    for (let i = 0; i < chosen.length; i += 1) if (JSON.stringify(base[i]) !== JSON.stringify(mut[i])) rowDiff += 1;
    const adapter = adapters[domain];
    let flagDiff = 0, pctDiff = 0, bandDiff = 0, normalised = 0;
    if (adapter.mode === 'normalized') {
      const a = normalize(base.filter((x): x is NonNullable<typeof x> => x !== null), adapter.params);
      const b = normalize(mut.filter((x): x is NonNullable<typeof x> => x !== null), adapter.params);
      normalised = a.length;
      a.forEach((x, i) => {
        const y = b[i]!;
        if (x.flagged !== y.flagged || x.via !== y.via) flagDiff += 1;
        if (x.domainPercentile !== y.domainPercentile || x.bandPercentile !== y.bandPercentile) pctDiff += 1;
        if (x.bandIndex !== y.bandIndex) bandDiff += 1;
      });
    }
    // Positive control: a deliberately leaky quantity (growth over [T-6, T+7]) MUST differ between base and rewritten data, proving the audit can see leakage.
    const leaky = (r: any) => (gainsOf(r.starHistory) as { date: string; count: number }[]).filter((g) => g.date >= addDays(T, -6) && g.date <= addDays(T, 7)).reduce((a, g) => a + g.count, 0);
    chosen.forEach((r, i) => {
      if (base[i] === null) return;
      controlPairs += 1;
      if (leaky(r) !== leaky(mutated[i])) controlSensitive += 1;
    });
    pairs += chosen.length;
    rowDiffs += rowDiff;
    flagDiffs += flagDiff;
    pctDiffs += pctDiff;
    bandDiffs += bandDiff;
    diffs += rowDiff + flagDiff + pctDiff + bandDiff;
    results.push({ T, domain, variant, repositories: chosen.length, normalised, rowDifferences: rowDiff, flagDifferences: flagDiff, percentileDifferences: pctDiff, bandDifferences: bandDiff });
  }
}
const summary = { positiveControl: { pairs: controlPairs, pairsWhereAFutureReadingWouldDiffer: controlSensitive, note: 'a quantity that reads T+1..T+7 differs on these pairs; the audited quantities differ on none' }, trials, domains: 2, repositoryDatePairs: pairs, rowDifferences: rowDiffs, flagDifferences: flagDiffs, percentileDifferences: pctDiffs, bandDifferences: bandDiffs, totalDifferences: diffs, verdict: diffs === 0 ? 'NO LEAKAGE: zero differences' : 'LEAKAGE DETECTED' };
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
if (diffs !== 0) process.exit(1);
