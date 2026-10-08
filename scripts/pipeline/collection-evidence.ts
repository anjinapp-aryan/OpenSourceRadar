/**
 * Read-only: per tier, how many repositories were due at a run's start and how many were actually collected.
 *   tsx scripts/pipeline/collection-evidence.ts <before tracked.json> <after tracked.json> <runStartIso> [graceHours]
 * `before` is the state the run started from, `after` the state it produced. Collected = lastCollectedAt >= runStart in `after`.
 */
import { readFileSync } from 'node:fs';
import { selectDue } from '../../src/tracking/engine';
import type { TrackingStatus } from '../../src/tracking/types';

interface Row { id: string; tier: TrackingStatus; nextRefreshAt: string; lastCollectedAt?: string }
const load = (p: string): Row[] => (JSON.parse(readFileSync(p, 'utf8')) as { repositories: Row[] }).repositories;

const [beforePath, afterPath, startIso, graceArg] = process.argv.slice(2);
if (!beforePath || !afterPath || !startIso) throw new Error('usage: collection-evidence <before> <after> <runStartIso> [graceHours]');
const start = new Date(startIso);
const grace = graceArg ? Number(graceArg) : 3;
const before = load(beforePath);
const after = new Map(load(afterPath).map((r) => [r.id, r]));
const tiers: TrackingStatus[] = ['HOT', 'WARM', 'DORMANT', 'UNASSESSED'];
const dueStrict = new Set(selectDue(before, start).map((r) => r.id));
const dueGrace = new Set(selectDue(before, start, undefined, undefined, grace).map((r) => r.id));
const rows = tiers.map((tier) => {
  const t = before.filter((r) => r.tier === tier);
  const collected = t.filter((r) => (after.get(r.id)?.lastCollectedAt ?? '') >= start.toISOString());
  return {
    tier,
    tracked: t.length,
    dueWithoutGrace: t.filter((r) => dueStrict.has(r.id)).length,
    dueWithGrace: t.filter((r) => dueGrace.has(r.id)).length,
    collected: collected.length,
    dueButNotCollected: t.filter((r) => dueGrace.has(r.id) && !collected.some((c) => c.id === r.id)).length,
    collectedWhileNotDue: collected.filter((r) => !dueGrace.has(r.id)).length,
  };
});
console.log(JSON.stringify({ runStart: start.toISOString(), graceHours: grace, tiers: rows }, null, 2));
