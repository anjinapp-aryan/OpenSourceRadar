import { describe, expect, it } from 'vitest';
import { loadTrackingPolicy } from '../src/tracking/config';
import { hoursFor, selectDue } from '../src/tracking/engine';
import type { TrackingStatus } from '../src/tracking/types';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-08T04:17:00Z');
const at = (offsetMinutes: number) => new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString();
const rec = (id: string, tier: TrackingStatus, dueInMinutes: number) => ({ id, tier, nextRefreshAt: at(dueInMinutes) });
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe('Phase 6.2.1 due-grace matrix', () => {
  const policy = loadTrackingPolicy();

  it('production grace is 3 hours and shorter than every tier interval', () => {
    expect(policy.dueGraceHours).toBe(3);
    for (const t of ['HOT', 'WARM', 'DORMANT', 'UNASSESSED'] as TrackingStatus[]) expect(hoursFor(policy, t)).toBeGreaterThan(policy.dueGraceHours);
  });

  it.each([
    ['exactly due', 0, true],
    ['overdue', -600, true],
    ['13 minutes early (observed 2026-10-07)', 13, true],
    ['19 minutes early (observed 2026-10-07)', 19, true],
    ['just inside the grace', 179, true],
    ['exactly at the grace horizon', 180, true],
    ['one minute beyond the grace', 181, false],
    ['a day early', 1440, false],
  ])('%s -> due: %s (grace 3h)', (_n, minutes, due) => {
    expect(selectDue([rec('x', 'HOT', minutes as number)], NOW, undefined, undefined, 3).length).toBe(due ? 1 : 0);
  });

  it('zero grace reproduces the defect: a repository due 13 minutes later is skipped', () => {
    expect(selectDue([rec('x', 'HOT', 13)], NOW).length).toBe(0);
    expect(selectDue([rec('x', 'HOT', 13)], NOW, undefined, undefined, 3).length).toBe(1);
  });

  it('grace never changes the order: tier, then oldest due, then tiebreak', () => {
    const rs = [rec('d', 'DORMANT', -5), rec('w', 'WARM', 60), rec('h2', 'HOT', 100), rec('h1', 'HOT', -20), rec('u', 'UNASSESSED', 0)];
    expect(ids(selectDue(rs, NOW, undefined, undefined, 3))).toEqual(['h1', 'h2', 'u', 'w', 'd']);
  });

  it('is monotone in grace and does not mutate its input', () => {
    const rs = Array.from({ length: 50 }, (_, i) => rec(`r${i}`, 'WARM', i * 10 - 100));
    const copy = JSON.stringify(rs);
    let prev = -1;
    for (const g of [0, 1, 2, 3, 6]) {
      const n = selectDue(rs, NOW, undefined, undefined, g).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(JSON.stringify(rs)).toBe(copy);
  });
});

/** Deterministic mulberry32 so the simulation is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sim { collected: Record<string, number[]>; maxGapHours: Record<string, number>; hotRunsMissed: number }

/** 14 daily runs; the start time jitters 0-150 minutes around 04:17; each collected record is due again `interval` after collection. */
function simulate(graceHours: number, seed: number, capPerRun = Infinity): Sim {
  const policy = loadTrackingPolicy();
  const rand = rng(seed);
  const counts: Record<string, number> = { HOT: 240, WARM: 900, DORMANT: 2000 };
  const start = Date.parse('2026-09-24T04:17:00Z');
  let recs: { id: string; tier: TrackingStatus; nextRefreshAt: string; last: number }[] = [];
  for (const [tier, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) recs.push({ id: `${tier}${i}`, tier: tier as TrackingStatus, nextRefreshAt: new Date(start).toISOString(), last: start });
  }
  const sim: Sim = { collected: { HOT: [], WARM: [], DORMANT: [] }, maxGapHours: { HOT: 0, WARM: 0, DORMANT: 0 }, hotRunsMissed: 0 };
  for (let day = 0; day < 14; day++) {
    const now = new Date(start + day * 24 * HOUR + Math.floor(rand() * 150) * 60_000);
    const due = selectDue(recs, now, undefined, undefined, graceHours).slice(0, capPerRun);
    const set = new Set(due.map((d) => d.id));
    const counted: Record<string, number> = { HOT: 0, WARM: 0, DORMANT: 0 };
    recs = recs.map((r) => {
      if (!set.has(r.id)) return r;
      if (day > 0) sim.maxGapHours[r.tier] = Math.max(sim.maxGapHours[r.tier]!, (now.getTime() - r.last) / HOUR);
      counted[r.tier] = (counted[r.tier] ?? 0) + 1;
      return { ...r, last: now.getTime(), nextRefreshAt: new Date(now.getTime() + hoursFor(policy, r.tier) * HOUR).toISOString() };
    });
    for (const t of ['HOT', 'WARM', 'DORMANT']) sim.collected[t]!.push(counted[t]!);
    if (day > 0 && counted.HOT! < counts.HOT! * 0.95) sim.hotRunsMissed += 1;
  }
  return sim;
}

describe('Phase 6.2.1 14-day scheduler simulation (seeded)', () => {
  it('without grace HOT repositories are repeatedly skipped when the run starts earlier than the day before', () => {
    const misses = [1, 2, 3, 4, 5].map((s) => simulate(0, s).hotRunsMissed);
    expect(Math.max(...misses)).toBeGreaterThan(0);
  });

  it('with the production grace every HOT repository is collected on every run and the gap stays under 27 hours', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = simulate(3, seed);
      expect(s.hotRunsMissed).toBe(0);
      expect(s.collected.HOT!.slice(1).every((n) => n === 240)).toBe(true);
      expect(s.maxGapHours.HOT).toBeLessThanOrEqual(24 + 3 + 2.5);
    }
  });

  it('with grace WARM and DORMANT cadence stays at or below one run past the interval (no starvation)', () => {
    const s = simulate(3, 7);
    expect(s.maxGapHours.WARM).toBeLessThanOrEqual(72 + 24);
    expect(s.maxGapHours.DORMANT).toBeLessThanOrEqual(168 + 24);
  });

  it('grace costs little extra: total collections over 14 days within 1.5x of the no-grace baseline', () => {
    const sum = (s: Sim) => Object.values(s.collected).flat().reduce((a, b) => a + b, 0);
    expect(sum(simulate(3, 11))).toBeLessThanOrEqual(sum(simulate(0, 11)) * 1.5);
  });

  it('with a per-run cap the HOT tier is served first', () => {
    const s = simulate(3, 3, 400);
    expect(s.collected.HOT!.slice(1).every((n) => n === 240)).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
describe('Phase 6.2.1 synthetic scale pages are fenced off from production', () => {
  const page = readFileSync('app/repo/[owner]/[name]/page.tsx', 'utf8');
  const workflow = readFileSync('.github/workflows/radar.yml', 'utf8');
  it('are only generated when RADAR_SYNTHETIC_PAGES is set, capped at 20,000', () => {
    expect(page).toContain('process.env.RADAR_SYNTHETIC_PAGES');
    expect(page).toContain('n <= 20_000');
  });
  it('the production workflow fails on any synthetic path or env var and never sets the variable', () => {
    expect(workflow).toContain('out/repo/_synthetic');
    expect(workflow).toContain('RADAR_SYNTHETIC_PAGES:-');
    expect(workflow.match(/RADAR_SYNTHETIC_PAGES/g)!.length).toBe(1);
    expect(workflow).not.toMatch(/^\s*RADAR_SYNTHETIC_PAGES\s*:/m);
  });
  it('vercel.json is absent on main (production config untouched)', () => {
    expect(() => readFileSync('vercel.json', 'utf8')).toThrow();
  });
});
