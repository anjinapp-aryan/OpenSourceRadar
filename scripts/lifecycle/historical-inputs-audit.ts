/**
 * Phase 6.3.2: the lifecycle inputs the star-rewrite audit cannot vary: New to Radar, the classified population, and the published population.
 * Offline. Reads the git history of data/public/radar.json (the only historical publication/classification record that exists) and a state dir.
 *
 *   tsx scripts/lifecycle/historical-inputs-audit.ts <state data dir> --work <scratch dir> [--out results/phase6.3.2/historical-inputs-audit.json]
 *
 * 1. NEW TO RADAR: negative control (rewriting every publication snapshot AFTER a cut must not change the result on any date <= cut, using the
 *    production code path: firstPublishedMap over ALL snapshots + the T guard in newToRadar) and positive control (the same rewrite must change
 *    the result after the cut).
 * 2. POINT-IN-TIME POPULATION: the replay is rerun with, on each date T, only the repositories that the PUBLISHED Radar at T (latest snapshot <= T)
 *    classed ENGINEERING, instead of today's classification of every tracked repository. The flag sets are compared with the fixed-snapshot run.
 *    This is a sensitivity MEASUREMENT of classification and publication hindsight, not a leakage test: only dates with a snapshot can be tested.
 * 3. CLASSIFICATION DRIFT between consecutive published snapshots.
 */
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstPublishedMap, loadLifecycleConfig, newToRadar } from '../../src/lifecycle/engineering';

const argv = process.argv.slice(2);
const stateDir = argv[0] as string;
const arg = (n: string, d: string | null) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const work = arg('--work', null);
if (!work) throw new Error('--work <scratch dir> is required');
const outPath = arg('--out', 'results/phase6.3.2/historical-inputs-audit.json') as string;
mkdirSync(work, { recursive: true });
mkdirSync('results/phase6.3.2', { recursive: true });

// ---- publication snapshots from git: one per UTC date (the last commit of the day)
const log = execSync('git log --format=%H%x09%aI -- data/public/radar.json', { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').map((l) => l.split('\t') as [string, string]);
const lastPerDate = new Map<string, string>();
for (const [h, d] of [...log].reverse()) lastPerDate.set(d.slice(0, 10), h);
interface Snap { date: string; domain: Map<string, string> }
const snaps: Snap[] = [];
for (const [date, hash] of [...lastPerDate.entries()].sort()) {
  let txt = '';
  try { txt = execSync(`git show ${hash}:data/public/radar.json`, { encoding: 'utf8', maxBuffer: 1 << 29 }); } catch { continue; }
  const d = JSON.parse(txt) as { repositories?: { id: string; classification?: { topLevel?: string } }[] };
  if (!Array.isArray(d.repositories)) continue;
  snaps.push({ date, domain: new Map(d.repositories.map((r) => [String(r.id), r.classification?.topLevel ?? 'UNKNOWN'])) });
}
if (snaps.length < 3) throw new Error('not enough publication snapshots in git history');

const repos = (JSON.parse(readFileSync(join(stateDir, 'repositories.json'), 'utf8')) as { repositories: { id: string; createdAt: string }[] }).repositories;
const createdAt = new Map(repos.map((r) => [String(r.id), r.createdAt]));
const lc = loadLifecycleConfig();

// ---- 1. New to Radar
type Pub = { date: string; ids: string[] };
const asPub = (): Pub[] => snaps.map((s) => ({ date: s.date, ids: [...s.domain.keys()] }));
const flagsOn = (pub: Pub[], T: string): string[] => {
  const first = firstPublishedMap(pub);
  const out: string[] = [];
  for (const [id, f] of first) {
    // the first snapshot is a baseline: its repositories were published at an unknown earlier date, so they never count as new
    if (f === pub[0]!.date) continue;
    if (newToRadar({ firstPublishedAt: f, createdAt: createdAt.get(id) ?? '1970-01-01T00:00:00Z' }, T, lc.newToRadar).newToRadar) out.push(id);
  }
  return out.sort();
};
let seed = 632;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function rewriteFuture(pub: Pub[], cut: string): Pub[] {
  // drop half of the ids and add 300 invented ids in every snapshot after the cut
  return pub.map((p) => (p.date <= cut ? p : { date: p.date, ids: [...p.ids.filter(() => rnd() < 0.5), ...Array.from({ length: 300 }, (_, k) => `synthetic-future-${p.date}-${k}`)] }));
}
const nrResults: Record<string, unknown>[] = [];
let nrCompared = 0, nrDiffs = 0, nrAfter = 0, nrAfterDiff = 0;
for (const cut of [snaps[3]!.date, snaps[6]!.date, snaps[9]!.date]) {
  const base = asPub();
  const mut = rewriteFuture(base, cut);
  let compared = 0, diffs = 0, after = 0, afterDiff = 0, memberships = 0;
  for (const s of snaps) {
    const a = flagsOn(base, s.date), b = flagsOn(mut, s.date);
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (s.date <= cut) { compared += 1; memberships += a.length; if (!same) diffs += 1; } else { after += 1; if (!same) afterDiff += 1; }
  }
  nrCompared += compared; nrDiffs += diffs; nrAfter += after; nrAfterDiff += afterDiff;
  nrResults.push({ cut, datesComparedUpToCut: compared, newToRadarMembershipsUpToCut: memberships, differencesUpToCut: diffs, positiveControl: { datesAfterCut: after, differingAfterCut: afterDiff } });
}
// a first publication dated after T must never be reported on T
const fp = firstPublishedMap(asPub());
let futureLeaks = 0, futureChecked = 0;
for (const [id, f] of fp) for (const s of snaps) if (f > s.date) { futureChecked += 1; const r = newToRadar({ firstPublishedAt: f, createdAt: createdAt.get(id) ?? '1970-01-01T00:00:00Z' }, s.date, lc.newToRadar); if (r.newToRadar || r.daysSinceFirstPublished !== null) futureLeaks += 1; }

// ---- 2. point-in-time population
const replayDates = Array.from({ length: 29 }, (_, k) => new Date(Date.parse('2026-10-03T00:00:00Z') - (28 - k) * 86_400_000).toISOString().slice(0, 10));
const population: Record<string, string[]> = {};
for (const T of replayDates) {
  const eligible = snaps.filter((s) => s.date <= T);
  if (!eligible.length) continue;
  const latest = eligible[eligible.length - 1]!;
  population[T] = [...latest.domain.entries()].filter(([, d]) => d === 'ENGINEERING').map(([id]) => id);
}
const popPath = join(work, 'population.json');
writeFileSync(popPath, JSON.stringify(population));
const run = (tag: string, extra: string[]) => {
  const flags = join(work, `${tag}.flags.json`);
  const r = spawnSync('npx', ['tsx', 'scripts/lifecycle/replay.ts', stateDir, '--out', join(work, `${tag}.replay.json`), '--dump-flags', flags, ...extra], { encoding: 'utf8', shell: true, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`replay failed for ${tag}: ${r.stderr?.slice(-400)}`);
  return JSON.parse(readFileSync(flags, 'utf8')) as Record<string, Record<string, number[]>>;
};
const fixed = run('fixed', []);
const pit = run('pointInTime', ['--population', popPath]);
const testedDates = Object.keys(population);
// Rising and lostTrending Cooling read the Trending flag of the previous 1-5 days; the replay dates before the first snapshot have no population, so on the tested dates
// those flags would see empty history. They are NOT comparable here and are excluded from the totals (reported, marked).
const historyDependent = (name: string) => name.startsWith('rising:') || name === 'cooling:lostTrending';
const perFlag: Record<string, { comparable: boolean; fixedMemberships: number; pointInTimeMemberships: number; symmetricDifference: number }> = {};
let totalFixed = 0, totalDiff = 0;
for (const name of Object.keys(fixed)) {
  let f = 0, p = 0, sd = 0;
  for (const date of testedDates) {
    const a = fixed[name]![date] ?? [], b = pit[name]?.[date] ?? [];
    const bs = new Set(b), as = new Set(a);
    f += a.length; p += b.length;
    sd += a.filter((x) => !bs.has(x)).length + b.filter((x) => !as.has(x)).length;
  }
  perFlag[name] = { comparable: !historyDependent(name), fixedMemberships: f, pointInTimeMemberships: p, symmetricDifference: sd };
  if (!historyDependent(name)) { totalFixed += f; totalDiff += sd; }
}

// ---- 3. classification drift between consecutive snapshots
const drift = snaps.slice(1).map((s, k) => {
  const prev = snaps[k]!;
  let common = 0, changed = 0, toEng = 0, fromEng = 0;
  for (const [id, d] of s.domain) { const pd = prev.domain.get(id); if (pd === undefined) continue; common += 1; if (pd !== d) { changed += 1; if (d === 'ENGINEERING') toEng += 1; if (pd === 'ENGINEERING') fromEng += 1; } }
  return { from: prev.date, to: s.date, common, changed, toEngineering: toEng, fromEngineering: fromEng, published: s.domain.size, entered: [...s.domain.keys()].filter((id) => !prev.domain.has(id)).length, left: [...prev.domain.keys()].filter((id) => !s.domain.has(id)).length };
});

const summary = {
  snapshots: snaps.length,
  snapshotDates: [snaps[0]!.date, snaps[snaps.length - 1]!.date],
  newToRadar: {
    cuts: nrResults,
    datesComparedUpToCut: nrCompared,
    differencesUpToCut: nrDiffs,
    positiveControl: { datesAfterCut: nrAfter, differingAfterCut: nrAfterDiff },
    futureFirstPublicationsChecked: futureChecked,
    futureFirstPublicationsReported: futureLeaks,
    verdict: nrDiffs === 0 && futureLeaks === 0 && nrAfterDiff > 0 ? 'NO LEAKAGE' : nrDiffs > 0 || futureLeaks > 0 ? 'LEAKAGE DETECTED' : 'INCONCLUSIVE',
  },
  pointInTimePopulation: {
    datesTested: testedDates,
    datesNotTestable: replayDates.filter((d) => !population[d]),
    reason: 'no published snapshot exists before the first date in git history; classification and publication at those dates are unavailable and are NOT reconstructed',
    populationSizeFixed: 'see replay.engineeringRepositories in the replay output',
    comparableFlagMembershipsFixed: totalFixed,
    comparableFlagMembershipsSymmetricDifference: totalDiff,
    populationSizesPointInTime: Object.fromEntries(Object.entries(population).map(([d, ids]) => [d, ids.length])),
    perFlag,
  },
  classificationDrift: drift,
};
writeFileSync(outPath, JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ newToRadar: summary.newToRadar.verdict, nrCompared, nrDiffs, nrAfterDiff, futureChecked, futureLeaks, testedDates: testedDates.length, totalFixed, totalDiff }, null, 1));
if (nrDiffs !== 0 || futureLeaks !== 0) process.exit(1);
