/**
 * Phase 6.3.1: evidence for the "New to Radar" definition. Read-only (git history, committed data, shadow results).
 *
 *   tsx scripts/lifecycle/new-to-radar.ts [--admitted results/phase6.3.1/shadow/discovery-2026-10-10.json] [--out results/phase6.3.1/new-to-radar.json]
 *
 * For each daily data commit of data/public/radar.json it reads the published repository ids and ages, derives the date each repository FIRST
 * appeared in the published Radar, and compares the candidate definitions on how many repositories each would call "new" and how many of those are
 * genuinely new repositories (created recently).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const admittedPath = arg('--admitted', 'results/phase6.3.1/shadow/discovery-2026-10-10.json');
const outPath = arg('--out', 'results/phase6.3.1/new-to-radar.json');

const log = execSync('git log --format=%H%x09%aI -- data/public/radar.json', { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').map((l) => l.split('\t') as [string, string]);
const commits = log.map(([h, d]) => ({ hash: h, date: d.slice(0, 10) })).reverse(); // oldest first
interface Snap { date: string; ids: Map<string, { ageDays: number; domain: string }> }
const snaps: Snap[] = [];
const lastPerDate = new Map<string, string>();
for (const c of commits) lastPerDate.set(c.date, c.hash); // one snapshot per UTC date: the last commit of the day
for (const [date, hash] of [...lastPerDate.entries()].sort()) {
  let txt = '';
  try {
    txt = execSync(`git show ${hash}:data/public/radar.json`, { encoding: 'utf8', maxBuffer: 1 << 29 });
  } catch {
    continue;
  }
  const d = JSON.parse(txt) as { repositories?: { id: string; ageDays?: number; classification?: { topLevel?: string } }[] };
  if (!Array.isArray(d.repositories)) continue;
  snaps.push({ date, ids: new Map(d.repositories.map((r) => [r.id, { ageDays: r.ageDays ?? Number.NaN, domain: r.classification?.topLevel ?? 'UNKNOWN' }])) });
}

const first = new Map<string, { date: string; ageDays: number; domain: string }>();
const perDay: { date: string; published: number; newlyPublished: number; newlyPublishedGenuinelyNew: number; newlyPublishedShare90d: number | null }[] = [];
snaps.forEach((s, k) => {
  const fresh = [...s.ids.entries()].filter(([id]) => !first.has(id));
  for (const [id, v] of fresh) first.set(id, { date: s.date, ...v });
  if (k === 0) { perDay.push({ date: s.date, published: s.ids.size, newlyPublished: 0, newlyPublishedGenuinelyNew: 0, newlyPublishedShare90d: null }); return; } // the first snapshot is the baseline: everything would look new
  const gn = fresh.filter(([, v]) => v.ageDays <= 90).length;
  perDay.push({ date: s.date, published: s.ids.size, newlyPublished: fresh.length, newlyPublishedGenuinelyNew: gn, newlyPublishedShare90d: fresh.length ? +(gn / fresh.length).toFixed(3) : null });
});
const after = perDay.slice(1);
const engFirst = [...first.values()].filter((v) => v.date !== snaps[0]?.date && v.domain === 'ENGINEERING');
const engineering = { newlyPublished: engFirst.length, genuinelyNew: engFirst.filter((v) => v.ageDays <= 90).length, genuinelyNewShare: engFirst.length ? +(engFirst.filter((v) => v.ageDays <= 90).length / engFirst.length).toFixed(3) : null, medianAgeDays: engFirst.length ? [...engFirst.map((v) => v.ageDays)].sort((a, b) => a - b)[Math.floor(engFirst.length / 2)] : null };
const sum = (f: (x: (typeof perDay)[number]) => number) => after.reduce((a, x) => a + f(x), 0);
let admitted: { priority: number; stars: number; fullName: string }[] = [];
let admittedAges: { n: number; under90: number; under365: number; over365: number } | null = null;
if (existsSync(admittedPath)) {
  const a = JSON.parse(readFileSync(admittedPath, 'utf8')) as { admitted: { id: string; stars: number; priority: number; fullName: string }[] };
  admitted = a.admitted;
  // priority = stars / ageDays, so the age is recoverable without another lookup
  const ages = admitted.map((x) => x.stars / Math.max(1e-9, x.priority));
  admittedAges = { n: ages.length, under90: ages.filter((x) => x <= 90).length, under365: ages.filter((x) => x <= 365).length, over365: ages.filter((x) => x > 365).length };
}
const out = {
  snapshots: snaps.length,
  dates: [snaps[0]?.date, snaps[snaps.length - 1]?.date],
  note: 'the first snapshot is a baseline and is excluded from the counts below',
  perDay,
  firstPublished: {
    daysCompared: after.length,
    newlyPublishedTotal: sum((x) => x.newlyPublished),
    meanPerDay: after.length ? +(sum((x) => x.newlyPublished) / after.length).toFixed(1) : null,
    genuinelyNewShare: sum((x) => x.newlyPublished) ? +(sum((x) => x.newlyPublishedGenuinelyNew) / sum((x) => x.newlyPublished)).toFixed(3) : null,
  },
  engineeringOnly: engineering,
  batchDays: perDay.filter((d) => d.newlyPublished > 0).map((d) => d.date),
  ifDefinedByAdmission: admittedAges && {
    admittedInOneWeeklyRun: admittedAges.n,
    createdWithin90Days: admittedAges.under90,
    createdWithin365Days: admittedAges.under365,
    olderThan365Days: admittedAges.over365,
    olderShare: +(admittedAges.over365 / Math.max(1, admittedAges.n)).toFixed(3),
  },
  reading: 'a definition tied to discovery or admission would label the whole weekly batch new, including repositories created years ago; first publication follows the repository actually appearing for readers',
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ snapshots: out.snapshots, dates: out.dates, firstPublished: out.firstPublished, engineeringOnly: out.engineeringOnly, batchDays: out.batchDays, ifDefinedByAdmission: out.ifDefinedByAdmission, perDay: perDay.map((d) => `${d.date}: published ${d.published}, new ${d.newlyPublished}, genuinelyNew ${d.newlyPublishedGenuinelyNew}`) }, null, 1));
