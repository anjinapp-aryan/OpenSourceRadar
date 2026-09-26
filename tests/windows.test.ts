import { describe, expect, it } from 'vitest';
import { addDays, buildStarHistoryPoints, utcDate, weeksToDailyGains } from '../src/analysis/starHistory';
import { computeStarWindows, computeWindowsFromGains, flattenWindows } from '../src/analysis/windows';
import { InvalidResponseError } from '../src/github/errors';
import type { DailyGain } from '../src/model/starHistory';
import { bucket, seriesOf, weeksEndingAt } from './shHelpers';

const AS_OF = new Date('2026-09-24T12:00:00Z'); // a Thursday

/** `count` days ending at `end` inclusive, `perDay(i)` stars each (i counted from the oldest day). */
function gains(end: string, count: number, perDay: number | ((i: number) => number)): DailyGain[] {
  return Array.from({ length: count }, (_, i) => ({
    date: addDays(end, -(count - 1 - i)),
    count: typeof perDay === 'number' ? perDay : perDay(i),
  }));
}

describe('date helpers', () => {
  it('utcDate / addDays', () => {
    expect(utcDate(new Date('2026-09-24T23:59:59Z'))).toBe('2026-09-24');
    expect(addDays('2026-09-24', 7)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weeksToDailyGains expands each week to 7 consecutive UTC days', () => {
    const out = weeksToDailyGains([bucket(0, [1, 2, 3, 4, 5, 6, 7]), bucket(1, [0, 0, 0, 0, 0, 0, 8])]);
    expect(out).toHaveLength(14);
    expect(out[0]).toEqual({ date: '2026-01-04', count: 1 });
    expect(out[6]).toEqual({ date: '2026-01-10', count: 7 });
    expect(out[13]).toEqual({ date: '2026-01-17', count: 8 });
  });
});

describe('windows: growth, percent, velocity', () => {
  it('spec example: 10,000 now, 8,600 seven days ago -> growth 1,400, 200 stars/day', () => {
    const g = gains('2026-09-24', 100, (i) => (i >= 93 ? 200 : 50)); // last 7 days = 200 each
    const w = computeWindowsFromGains(g, false, 10_000, AS_OF);
    expect(w['7d']).toEqual({ days: 7, status: 'ok', starsAgo: 8600, growth: 1400, growthPercent: 16.2791, starsPerDay: 200 });
  });

  it('30d and 90d on a constant 100/day history', () => {
    const g = gains('2026-09-24', 120, 100);
    const w = computeWindowsFromGains(g, false, 20_000, AS_OF);
    expect(w['30d']).toMatchObject({ growth: 3000, starsAgo: 17_000, growthPercent: 17.6471, starsPerDay: 100, status: 'ok' });
    expect(w['90d']).toMatchObject({ growth: 9000, starsAgo: 11_000, growthPercent: 81.8182, starsPerDay: 100 });
  });

  it('window is exactly N days inclusive of today (boundary check)', () => {
    const g = gains('2026-09-24', 10, 0);
    g[2]!.count = 1000; // 2026-09-17: first day OUTSIDE a 7-day window ending 09-24 (window = 09-18..09-24)
    g[3]!.count = 5; //   2026-09-18: first day INSIDE
    const w = computeWindowsFromGains(g, true, 2000, AS_OF);
    expect(w['7d'].growth).toBe(5);
  });

  it('future-dated buckets after asOf do not count', () => {
    const g = [...gains('2026-09-24', 30, 1), { date: '2026-09-25', count: 500 }];
    expect(computeWindowsFromGains(g, false, 1000, AS_OF)['7d'].growth).toBe(7);
  });

  it('through a real series (current week has trailing zero days)', () => {
    const weeks = weeksEndingAt('2026-09-24', 30, 10);
    const w = computeStarWindows(seriesOf(weeks, false), 5000, AS_OF);
    expect(w['7d'].growth).toBe(70);
    expect(w['90d'].growth).toBe(900);
    expect(flattenWindows(5000, w)).toMatchObject({ starsNow: 5000, stars7dAgo: 4930, growth7d: 70, starsPerDay7d: 10, stars90dAgo: 4100 });
  });
});

describe('windows: missing data is null, never zero', () => {
  it('partial history covers 7d but not 30d/90d', () => {
    const w = computeWindowsFromGains(gains('2026-09-24', 20, 5), false, 1000, AS_OF);
    expect(w['7d'].status).toBe('ok');
    expect(w['30d']).toEqual({ days: 30, status: 'insufficient-history', starsAgo: null, growth: null, growthPercent: null, starsPerDay: null });
    expect(w['90d'].growth).toBeNull();
  });

  it('empty history -> all windows insufficient (an empty answer is not "zero stars")', () => {
    const w = computeWindowsFromGains([], true, 100, AS_OF);
    expect([w['7d'].status, w['30d'].status, w['90d'].status]).toEqual(['insufficient-history', 'insufficient-history', 'insufficient-history']);
  });

  it('stale history (newest day before asOf) -> insufficient', () => {
    const w = computeWindowsFromGains(gains('2026-09-20', 100, 1), false, 500, AS_OF);
    expect(w['7d'].status).toBe('insufficient-history');
  });

  it('a missing day inside the window -> insufficient', () => {
    const g = gains('2026-09-24', 100, 1).filter((x) => x.date !== '2026-09-20');
    const w = computeWindowsFromGains(g, false, 500, AS_OF);
    expect(w['7d'].status).toBe('insufficient-history');
    expect(w['90d'].status).toBe('insufficient-history');
  });

  it('history that implies negative past stars -> inconsistent', () => {
    const w = computeWindowsFromGains(gains('2026-09-24', 100, 100), false, 500, AS_OF);
    expect(w['30d'].status).toBe('inconsistent');
    expect(w['30d'].growth).toBeNull();
  });
});

describe('windows: young repositories (complete history)', () => {
  it('created 10 days ago: 30d window is zero-base, growth known, percent undefined', () => {
    const w = computeWindowsFromGains(gains('2026-09-24', 10, 20), true, 200, AS_OF);
    expect(w['30d']).toEqual({ days: 30, status: 'zero-base', starsAgo: 0, growth: 200, growthPercent: null, starsPerDay: 6.6667 });
    expect(w['7d']).toMatchObject({ status: 'ok', starsAgo: 60, growth: 140 });
  });

  it('a partial (incomplete) short history does NOT get the zero-before-creation treatment', () => {
    const w = computeWindowsFromGains(gains('2026-09-24', 10, 20), false, 200, AS_OF);
    expect(w['30d'].status).toBe('insufficient-history');
  });

  it('zero-star repository with complete history: everything is a real zero', () => {
    const w = computeWindowsFromGains(gains('2026-09-24', 200, 0), true, 0, AS_OF);
    expect(w['7d']).toEqual({ days: 7, status: 'zero-base', starsAgo: 0, growth: 0, growthPercent: null, starsPerDay: 0 });
  });
});

describe('cumulative points', () => {
  const weeks = weeksEndingAt('2026-09-24', 4, 10);

  it('anchors on the star count and ends at it on asOf', () => {
    const pts = buildStarHistoryPoints(seriesOf(weeks, false), AS_OF, 1000)!;
    expect(pts[pts.length - 1]).toMatchObject({ date: '2026-09-24', stars: 1000, dailyCount: 10, source: 'github-star-history' });
    expect(pts[pts.length - 2]!.stars).toBe(990);
    expect(pts.every((p, i) => i === 0 || p.stars >= pts[i - 1]!.stars)).toBe(true);
    expect(pts[0]!.weekStart).toBe(utcDate(weeks[0]!.week * 1000));
    expect(pts.every((p) => p.date <= '2026-09-24')).toBe(true);
  });

  it('a complete series anchors itself on the sum of its buckets', () => {
    const total = weeks.reduce((s, w) => s + w.total, 0);
    const pts = buildStarHistoryPoints(seriesOf(weeks, true), AS_OF)!;
    expect(pts[pts.length - 1]!.stars).toBe(total);
    expect(pts[0]!.stars - pts[0]!.dailyCount).toBe(0);
  });

  it('a partial series without an anchor returns null instead of guessing', () => {
    expect(buildStarHistoryPoints(seriesOf(weeks, false), AS_OF)).toBeNull();
  });

  it('history exceeding the star count is rejected', () => {
    expect(() => buildStarHistoryPoints(seriesOf(weeks, false), AS_OF, 5)).toThrow(InvalidResponseError);
  });
});

describe('star-count drift tolerance (metadata and history are fetched at different moments)', () => {
  it('history 1 above the star count is tolerated: window clamps to a zero base', () => {
    // complete 10-day history summing to 201 against 200 stars (live example: 145,406 vs 145,405)
    const w = computeWindowsFromGains(gains('2026-09-24', 10, 20).map((g, i) => (i === 0 ? { ...g, count: 21 } : g)), true, 200, AS_OF);
    expect(w['30d']).toMatchObject({ status: 'zero-base', starsAgo: 0, growth: 201 });
  });

  it('history far above the star count is still inconsistent', () => {
    const w = computeWindowsFromGains(gains('2026-09-24', 10, 20), true, 100, AS_OF);
    expect(w['30d'].status).toBe('inconsistent');
  });

  it('cumulative points never go negative within tolerance', () => {
    const weeks = weeksEndingAt('2026-09-24', 2, 1);
    const total = weeks.reduce((s, w) => s + w.total, 0);
    const pts = buildStarHistoryPoints(seriesOf(weeks, false), AS_OF, total - 1)!;
    expect(Math.min(...pts.map((p) => p.stars))).toBe(0);
  });
});
