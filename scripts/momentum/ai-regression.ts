/**
 * Phase 6.3 AI regression gate. Re-runs the PRODUCTION momentum pipeline on a state, with the committed dataset's own evaluation time,
 * and compares every AI (and BOTH) record and list with the committed public data.
 *
 *   tsx scripts/momentum/ai-regression.ts <state data dir> [--radar data/public/radar.json] [--history data/public/history.json] [--out results/phase6.3/ai-regression.json]
 *
 * Also records the SHA-256 of the production ranking sources, so a test can fail when they change without the artefact being refreshed.
 * Exit code 1 on any AI difference.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const dir = argv[0] as string;
const arg = (n: string, d: string) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const radarPath = arg('--radar', 'data/public/radar.json');
const historyPath = arg('--history', 'data/public/history.json');
const outPath = arg('--out', 'results/phase6.3/ai-regression.json');

const committed = JSON.parse(readFileSync(radarPath, 'utf8')) as { generatedAt: string; repositories: any[]; lists: Record<string, string[]> };
const tmp = mkdtempSync(join(tmpdir(), 'radar-ai-reg-'));
const run = spawnSync(
  'npx',
  ['tsx', 'scripts/momentum/index.ts', '--repositories', join(dir, 'repositories.json'), '--classified', join(dir, 'classified/classified.json'), '--tracked', join(dir, 'tracked/tracked.json'), '--candidates', join(dir, 'candidates/candidates.json'), '--out', join(tmp, 'momentum.json'), '--public', join(tmp, 'radar.json'), '--history', join(tmp, 'history.json'), '--now', committed.generatedAt],
  { encoding: 'utf8', shell: true },
);
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(2);
}
const rerun = JSON.parse(readFileSync(join(tmp, 'radar.json'), 'utf8')) as typeof committed;
const isAi = (r: any) => r.classification.topLevel === 'AI' || r.classification.topLevel === 'BOTH';
const A = committed.repositories.filter(isAi);
const byId = new Map(rerun.repositories.map((r) => [r.id, r]));
const aiIds = new Set(A.map((r) => r.id));
let added = 0, removed = 0, scoreChanges = 0, trendChanges = 0, patternChanges = 0, anyFieldChange = 0;
for (const r of A) {
  const o = byId.get(r.id);
  if (!o) { removed += 1; continue; }
  if (o.score !== r.score) scoreChanges += 1;
  if (o.trend !== r.trend) trendChanges += 1;
  if (o.pattern !== r.pattern) patternChanges += 1;
  if (JSON.stringify(o) !== JSON.stringify(r)) anyFieldChange += 1;
}
for (const r of rerun.repositories.filter(isAi)) if (!aiIds.has(r.id)) added += 1;
const aiOrder = (d: typeof committed) => d.repositories.filter(isAi).map((r) => r.id);
const lists: Record<string, boolean> = {};
for (const k of Object.keys(committed.lists)) lists[k] = JSON.stringify(committed.lists[k]!.filter((i) => aiIds.has(i))) === JSON.stringify((rerun.lists[k] ?? []).filter((i) => aiIds.has(i)));
// line endings differ between Windows and Linux checkouts: hash the text with LF endings
const sha = (p: string) => createHash('sha256').update(readFileSync(p, 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10))).digest('hex');
const protectedSources = ['src/momentum/engine.ts', 'src/momentum/config.ts', 'src/momentum/dataset.ts', 'config/momentum.json', 'config/pattern.json', 'config/tracking.json', 'config/classification.json', 'src/classification/classifier.ts'];
const identicalHistory = JSON.stringify(JSON.parse(readFileSync(historyPath, 'utf8'))) === JSON.stringify(JSON.parse(readFileSync(join(tmp, 'history.json'), 'utf8')));
const out = {
  evaluatedAt: committed.generatedAt,
  aiAndBothRecords: A.length,
  added,
  removed,
  reordered: JSON.stringify(aiOrder(committed)) === JSON.stringify(aiOrder(rerun)) ? 0 : 1,
  scoreChanges,
  trendChanges,
  patternChanges,
  recordsWithAnyFieldChange: anyFieldChange,
  listsIdentical: lists,
  wholeRepositoriesArrayIdentical: JSON.stringify(committed.repositories) === JSON.stringify(rerun.repositories),
  historyIdentical: identicalHistory,
  protectedSourceSha256: Object.fromEntries(protectedSources.map((p) => [p, sha(p)])),
  verdict: added + removed + scoreChanges + trendChanges + patternChanges + anyFieldChange === 0 && Object.values(lists).every(Boolean) && identicalHistory ? 'AI UNCHANGED' : 'AI CHANGED',
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
if (out.verdict !== 'AI UNCHANGED') process.exit(1);
