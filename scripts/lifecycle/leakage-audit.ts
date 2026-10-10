/**
 * Phase 6.3.2: future-data leakage audit of the Engineering LIFECYCLE replay (Trending, Rising, Accelerating, Breakout, Cooling, Sustained).
 * Black-box: it rewrites everything after a cut date C for EVERY repository (zeros, random bursts, or x50, keeping present-day star counts
 * consistent), runs the unchanged `replay.ts` on the original and on each rewritten state, and compares every flag set on every date up to C.
 * Any difference on a date <= C is leakage. Flags after C must differ (positive control: the rewrite changes what the replay sees).
 *
 *   tsx scripts/lifecycle/leakage-audit.ts <state data dir> --work <scratch dir> [--out results/phase6.3.2/lifecycle-leakage-audit.json]
 *
 * Read-only against the state; writes only under --work and the result file.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gainsOf } from '../../src/collect/dataset';

const argv = process.argv.slice(2);
const stateDir = argv[0] as string;
const arg = (n: string, d: string | null) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const work = arg('--work', null);
if (!work) throw new Error('--work <scratch dir> is required');
const outPath = arg('--out', 'results/phase6.3.2/lifecycle-leakage-audit.json') as string;
mkdirSync(work, { recursive: true });
mkdirSync('results/phase6.3.2', { recursive: true });

let seed = 632;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
type Variant = 'zeros' | 'bursts' | 'scale50';
function rewrite(r: any, cut: string, variant: Variant): any {
  const gains = gainsOf(r.starHistory) as { date: string; count: number }[];
  let delta = 0;
  const next = gains.map((g) => {
    if (g.date <= cut) return g.count;
    const v = variant === 'zeros' ? 0 : variant === 'bursts' ? Math.floor(rnd() * 5000) : g.count * 50;
    delta += v - g.count;
    return v;
  });
  return { ...r, stars: r.stars + delta, starHistory: { ...r.starHistory, dailyGains: next } };
}

const repos = JSON.parse(readFileSync(join(stateDir, 'repositories.json'), 'utf8')) as { repositories: any[] } & Record<string, unknown>;
const run = (dir: string, tag: string) => {
  const flags = join(work, `${tag}.flags.json`);
  const expl = join(work, `${tag}.explanations.json`);
  const r = spawnSync('npx', ['tsx', 'scripts/lifecycle/replay.ts', dir, '--out', join(work, `${tag}.replay.json`), '--dump-flags', flags, '--dump-explanations', expl], { encoding: 'utf8', shell: true, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`replay failed for ${tag}: ${r.stderr?.slice(-400)}`);
  return { flags: JSON.parse(readFileSync(flags, 'utf8')) as Record<string, Record<string, number[]>>, expl: JSON.parse(readFileSync(expl, 'utf8')) as Record<string, Record<string, string[]>> };
};

const original = run(stateDir, 'original');
const base = original.flags;
const results: Record<string, unknown>[] = [];
let totalExplCompared = 0, totalExplDiffs = 0, explControl = 0, explControlDiffering = 0;
let totalCompared = 0, totalDiffs = 0, controlDates = 0, controlDiffering = 0;
for (const [cut, variant] of [['2026-09-12', 'zeros'], ['2026-09-19', 'bursts'], ['2026-09-26', 'scale50']] as [string, Variant][]) {
  const dir = join(work, `mut-${variant}`);
  mkdirSync(join(dir, 'classified'), { recursive: true });
  writeFileSync(join(dir, 'repositories.json'), JSON.stringify({ ...repos, repositories: repos.repositories.map((r) => rewrite(r, cut, variant)) }));
  copyFileSync(join(stateDir, 'classified/classified.json'), join(dir, 'classified/classified.json'));
  const mutRun = run(dir, `mut-${variant}`);
  const mut = mutRun.flags;
  let compared = 0, diffs = 0;
  const differingNames = new Set<string>();
  let afterDates = 0, afterDiffering = 0, pairsCompared = 0, pairsDiffering = 0, pairsAfter = 0, pairsAfterDiffering = 0;
  for (const name of Object.keys(base)) {
    for (const [date, ids] of Object.entries(base[name]!)) {
      const other = mut[name]?.[date] ?? [];
      const same = JSON.stringify(ids) === JSON.stringify(other);
      const o = new Set(other);
      const sym = ids.filter((x) => !o.has(x)).length + other.filter((x) => !ids.includes(x)).length;
      if (date <= cut) {
        compared += 1;
        pairsCompared += new Set([...ids, ...other]).size;
        pairsDiffering += sym;
        if (!same) { diffs += 1; differingNames.add(`${name}@${date}`); }
      } else {
        afterDates += 1;
        pairsAfter += new Set([...ids, ...other]).size;
        pairsAfterDiffering += sym;
        if (!same) afterDiffering += 1;
      }
    }
  }
  // explanations: the text of every Trending repository on every date, compared as text
  let explCompared = 0, explDiffs = 0, explAfter = 0, explAfterDiffering = 0;
  const dates = new Set([...Object.keys(original.expl), ...Object.keys(mutRun.expl)]);
  for (const date of dates) {
    const a = original.expl[date] ?? {}, b = mutRun.expl[date] ?? {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const same = JSON.stringify(a[id] ?? null) === JSON.stringify(b[id] ?? null);
      if (date <= cut) { explCompared += 1; if (!same) explDiffs += 1; } else { explAfter += 1; if (!same) explAfterDiffering += 1; }
    }
  }
  totalExplCompared += explCompared; totalExplDiffs += explDiffs; explControl += explAfter; explControlDiffering += explAfterDiffering;
  const explanationsResult = { comparedUpToCut: explCompared, differencesUpToCut: explDiffs, positiveControl: { afterCut: explAfter, differingAfterCut: explAfterDiffering } };
  totalCompared += compared; totalDiffs += diffs; controlDates += afterDates; controlDiffering += afterDiffering;
  results.push({ cut, variant, memberDaysUpToCut: pairsCompared, memberDaysDifferingUpToCut: pairsDiffering, positiveControlMemberDays: { total: pairsAfter, differing: pairsAfterDiffering }, explanations: explanationsResult, flagSetsComparedUpToCut: compared, differencesUpToCut: diffs, differing: [...differingNames].slice(0, 10), positiveControl: { flagSetsAfterCut: afterDates, differingAfterCut: afterDiffering } });
  console.error(`${variant} cut ${cut}: ${compared} flag sets compared, ${diffs} differences; after the cut ${afterDiffering} of ${afterDates} differ`);
}
const summary = {
  states: results.length,
  flagSetsComparedUpToCut: totalCompared,
  explanations: { comparedUpToCut: totalExplCompared, differencesUpToCut: totalExplDiffs, positiveControl: { afterCut: explControl, differingAfterCut: explControlDiffering } },
  differencesUpToCut: totalDiffs,
  positiveControl: { flagSetsAfterCut: controlDates, differingAfterCut: controlDiffering, note: 'after the cut the rewritten future must change the flags, proving the rewrite is visible to the replay' },
  verdict: totalDiffs === 0 && totalExplDiffs === 0 && controlDiffering > 0 && explControlDiffering > 0 ? 'NO LEAKAGE: zero differences on or before the cut, and the rewrite is visible after it' : totalDiffs > 0 || totalExplDiffs > 0 ? 'LEAKAGE DETECTED' : 'INCONCLUSIVE: the rewrite changed nothing after the cut',
  flagNames: Object.keys(base),
};
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
if (totalDiffs !== 0 || totalExplDiffs !== 0) process.exit(1);
