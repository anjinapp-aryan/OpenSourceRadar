/**
 * Phase 6.3: build the replay table for the normalisation experiment. For every repository and every evaluation date T it records only
 * what was observable at T (via the production back-tester `evaluateAt`, which hides everything after T), plus, separately labelled,
 * the OUTCOME growth in the following seven days, used only to score algorithms, never as an input to them.
 *
 *   tsx scripts/momentum/replay-rows.ts <state data dir> <out json> [--end 2026-10-03] [--days 29]
 *
 * Read-only against the state; writes only <out json>.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateAt, dateRange, lastHistoryDate } from '../../src/backtest';
import { gainsOf } from '../../src/collect/dataset';
import { parsePatternConfig } from '../../src/explain/pattern';
import { loadMomentumConfig } from '../../src/momentum/config';
import { radarDomainOf, type TopLevel } from '../../src/domain';

const [dir = '.pipeline/state-2026-10-06/data', outPath = 'results/phase6.3/cache/replay-rows.json'] = process.argv.slice(2);
const argv = process.argv.slice(2);
const end = argv.includes('--end') ? (argv[argv.indexOf('--end') + 1] as string) : '2026-10-03';
const days = argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) : 29;

const cfg = loadMomentumConfig();
const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const repos = (JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { repositories: any[] }).repositories;
const cls = new Map<string, any>((JSON.parse(readFileSync(join(dir, 'classified/classified.json'), 'utf8')) as { repositories: any[] }).repositories.map((r) => [r.id, r.result]));
const dates = dateRange(end, days).reverse(); // oldest first

interface Row {
  /** repository index into `repos` */
  i: number;
  stars: number;
  g7: number;
  g30: number | null;
  g90: number | null;
  v7: number;
  accel: number | null;
  trend: string;
  pattern: string | null;
  spike: number;
  hist: number;
  /** OUTCOME ONLY: stars gained in the 7 days after T; null when the series does not cover T+7 */
  next7: number | null;
}

const repoMeta = repos.map((r) => {
  const c = cls.get(r.id);
  const top = (c?.topLevelCategory ?? 'UNKNOWN') as TopLevel;
  return { id: r.id as string, fullName: r.fullName as string, domain: radarDomainOf(top), top, cat: (c?.categories?.[0]?.slug ?? null) as string | null, created: r.createdAt as string };
});

const out: { meta: unknown; repos: typeof repoMeta; dates: string[]; rows: Record<string, Row[]> } = { meta: { end, days, generatedFrom: dir }, repos: repoMeta, dates, rows: {} };
const t0 = Date.now();
for (const T of dates) {
  const rows: Row[] = [];
  repos.forEach((r, i) => {
    const m = repoMeta[i]!;
    if (!m.domain) return;
    const s = evaluateAt(r, T, cfg, pcfg);
    if (!s || s.growth7d === null || s.velocity7d === null) return;
    const all = gainsOf(r.starHistory) as { date: string; count: number }[];
    const upToT = all.filter((g) => g.date <= T);
    const last7 = upToT.slice(-7).map((g) => g.count);
    const sum7 = last7.reduce((a, b) => a + b, 0);
    const lastDate = lastHistoryDate(r);
    let next7: number | null = null;
    const target = new Date(Date.parse(`${T}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    if (lastDate && lastDate >= target) next7 = all.filter((g) => g.date > T).slice(0, 7).reduce((a, g) => a + g.count, 0);
    rows.push({ i, stars: s.stars, g7: s.growth7d, g30: s.growth30d, g90: s.growth90d, v7: s.velocity7d, accel: s.accelerationRatio, trend: s.trend, pattern: s.pattern, spike: sum7 > 0 ? Math.max(...last7) / sum7 : 0, hist: upToT.length, next7 });
  });
  out.rows[T] = rows;
  console.error(`${T}: ${rows.length} rows (${Math.round((Date.now() - t0) / 1000)}s)`);
}
writeFileSync(outPath, JSON.stringify(out));
console.error('written', outPath);
