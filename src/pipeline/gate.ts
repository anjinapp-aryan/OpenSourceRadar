/**
 * Data quality gate for the public dataset (Phase 6). Pure functions: no I/O, no network, deterministic.
 * A candidate dataset is compared with the previous known-good one; hard structural problems and catastrophic
 * regressions are FAIL (never published), moderate movement is WARNING, normal daily change is OK.
 * Thresholds live in config/pipeline.json; nothing here hard-codes a repository count.
 */
import { classifyPattern, PATTERNS, type PatternConfig, type PatternInput } from '../explain/pattern';
import { LIFECYCLE_STATES } from '../lifecycle';

export interface GateConfig {
  minRepositories: number;
  minAiRepositories: number;
  maxDropPercent: { repositories: number; tracked: number; measured: number; ai: number };
  warnAtFractionOfFail: number;
  risingRequireIfPreviousAtLeast: number;
  maxRisingChangePercentWarn: number;
  maxFutureSkewMinutes: number;
  maxPublicBytes: number;
  warnPublicBytes: number;
  allowedTrends: string[];
  allowedTopLevel: string[];
}

export type Level = 'OK' | 'WARNING' | 'FAIL';

export interface Metrics {
  /** Published records. */
  repositories: number;
  /** Published records plus records deliberately withheld by the lifecycle rules (so a cleanup is not mistaken for a collapse). */
  accounted: number;
  withheld: number;
  tracked: number | null;
  measured: number | null;
  ai: number;
  rising: number;
  cooling: number;
  steady: number;
  newEntrants: number;
  sustained: number;
  movers: number;
}

export interface MetricDelta {
  name: keyof Metrics;
  previous: number | null;
  current: number | null;
  delta: number | null;
  percent: number | null;
  level: Level;
}

export interface GateReport {
  level: Level;
  structuralProblems: string[];
  warnings: string[];
  metrics: { current: Metrics | null; previous: Metrics | null };
  deltas: MetricDelta[];
  bytes: number;
}

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullOrFinite = (v: unknown): boolean => v === null || finite(v);

export function metricsOf(ds: Rec): Metrics {
  const repos = (Array.isArray(ds.repositories) ? ds.repositories : []) as Rec[];
  const lists = (isObj(ds.lists) ? ds.lists : {}) as Rec;
  const stats = isObj(ds.stats) ? ds.stats : null;
  const count = (f: (r: Rec) => boolean) => repos.filter(f).length;
  const top = (r: Rec) => (isObj(r.classification) ? (r.classification.topLevel as string) : null);
  const len = (k: string) => (Array.isArray(lists[k]) ? (lists[k] as unknown[]).length : 0);
  const withheld = isObj(ds.lifecycle) && finite(ds.lifecycle.withheld) && ds.lifecycle.withheld >= 0 ? ds.lifecycle.withheld : 0;
  return {
    repositories: repos.length,
    accounted: repos.length + withheld,
    withheld,
    tracked: stats && finite(stats.tracked) ? stats.tracked : null,
    measured: stats && finite(stats.measured) ? stats.measured : null,
    ai: count((r) => top(r) === 'AI' || top(r) === 'BOTH'),
    rising: count((r) => r.trend === 'RISING'),
    cooling: count((r) => r.trend === 'COOLING'),
    steady: count((r) => r.trend === 'STEADY'),
    newEntrants: len('newEntrants'),
    sustained: len('sustained'),
    movers: len('movers'),
  };
}

/** Structural validation of one dataset. Returns human-readable problems (empty = valid). */
export interface GateContext {
  /** When given, every record's `pattern` must equal the recomputation from its own public fields. */
  pattern?: PatternConfig;
}

export function structuralProblems(ds: unknown, cfg: GateConfig, now: Date, ctx: GateContext = {}): string[] {
  const p: string[] = [];
  if (!isObj(ds)) return ['dataset is not an object'];
  if (ds.schemaVersion !== 1) p.push(`schemaVersion must be 1 (got ${String(ds.schemaVersion)})`);
  if (typeof ds.momentumVersion !== 'string') p.push('momentumVersion missing');
  const gen = typeof ds.generatedAt === 'string' ? Date.parse(ds.generatedAt) : NaN;
  if (Number.isNaN(gen)) p.push('generatedAt missing or invalid');
  else if (gen > now.getTime() + cfg.maxFutureSkewMinutes * 60_000) p.push('generatedAt is in the future');
  if (!isObj(ds.lists)) p.push('lists missing');
  if (!Array.isArray(ds.repositories)) return [...p, 'repositories must be an array'];
  if (ds.repositories.length === 0) p.push('repositories is empty');
  const categories = Array.isArray(ds.categories) ? (ds.categories as Rec[]) : null;
  if (!categories || categories.length === 0) p.push('categories missing');
  const slugs = new Set((categories ?? []).map((c) => c.slug));
  const ids = new Set<string>();
  let bad = 0;
  const note = (msg: string) => {
    bad += 1;
    if (bad <= 15) p.push(msg);
  };
  for (const raw of ds.repositories as unknown[]) {
    if (!isObj(raw)) {
      note('repository record is not an object');
      continue;
    }
    const r = raw;
    const name = String(r.fullName);
    if (typeof r.id !== 'string' || r.id === '') note(`${name}: id missing`);
    else if (ids.has(r.id)) note(`${name}: duplicate id ${r.id}`);
    else ids.add(r.id);
    if (typeof r.fullName !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(r.fullName)) note(`${name}: fullName is not owner/name`);
    if (typeof r.url !== 'string' || !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(r.url)) note(`${name}: malformed url`);
    if (!finite(r.stars) || r.stars < 0 || !Number.isInteger(r.stars)) note(`${name}: stars must be a non-negative integer`);
    for (const k of ['growth7d', 'growth30d', 'growth90d', 'velocity7d', 'velocity30d', 'velocity90d', 'priorVelocity', 'growthPercent7d', 'accelerationRatio', 'velocityDelta'] as const) {
      if (!nullOrFinite(r[k])) note(`${name}: ${k} is not a finite number or null`);
    }
    if (finite(r.growth7d) && finite(r.stars) && r.growth7d > r.stars) note(`${name}: growth7d exceeds total stars`);
    if (finite(r.growth30d) && finite(r.stars) && r.growth30d > r.stars) note(`${name}: growth30d exceeds total stars`);
    if (r.score !== null && (!finite(r.score) || r.score < 0 || r.score > 100)) note(`${name}: score outside 0..100`);
    if (typeof r.trend !== 'string' || !cfg.allowedTrends.includes(r.trend)) note(`${name}: invalid trend ${String(r.trend)}`);
    if (finite(r.ageDays) ? r.ageDays < 0 : true) note(`${name}: ageDays invalid`);
    if (r.classification !== null) {
      if (!isObj(r.classification) || !cfg.allowedTopLevel.includes(r.classification.topLevel as string)) note(`${name}: invalid classification`);
      else if (!Array.isArray(r.classification.categories) || (r.classification.categories as unknown[]).some((c) => !slugs.has(c))) note(`${name}: unknown category slug`);
    }
    if (r.pattern !== undefined && !(PATTERNS as readonly string[]).includes(r.pattern as string)) note(`${name}: invalid pattern ${String(r.pattern)}`);
    if (r.lifecycle !== undefined && r.lifecycle !== 'STALE') note(`${name}: invalid lifecycle ${String(r.lifecycle)}`);
    if (ds.patternVersion !== undefined && r.pattern === undefined) note(`${name}: pattern missing although patternVersion is set`);
    if (ctx.pattern && typeof r.pattern === 'string' && (PATTERNS as readonly string[]).includes(r.pattern) && classifyPattern(r as unknown as PatternInput, ctx.pattern) !== r.pattern) note(`${name}: pattern ${r.pattern} does not match its own fields`);
    if (!Array.isArray(r.explanation)) note(`${name}: explanation missing`);
    if (typeof r.summary !== 'string') note(`${name}: summary missing`);
  }
  if (bad > 15) p.push(`... and ${bad - 15} more invalid records`);
  if (isObj(ds.lists)) {
    const l = ds.lists as Rec;
    for (const k of ['rising', 'sustained', 'newEntrants']) {
      for (const id of (Array.isArray(l[k]) ? l[k] : []) as string[]) if (!ids.has(id)) p.push(`lists.${k} references unknown id ${id}`);
    }
    for (const k of ['movers', 'moversUp', 'moversDown']) {
      for (const m of (Array.isArray(l[k]) ? l[k] : []) as Rec[]) if (!ids.has(m.id as string) || !finite(m.velocityDelta)) p.push(`lists.${k} has an invalid entry`);
    }
  }
  if (ds.lifecycle !== undefined) {
    const lc = ds.lifecycle;
    if (!isObj(lc) || !isObj(lc.counts) || !finite(lc.withheld) || lc.withheld < 0 || !Number.isInteger(lc.withheld)) p.push('lifecycle block is malformed');
    else {
      for (const [k, v] of Object.entries(lc.counts)) if (!(LIFECYCLE_STATES as readonly string[]).includes(k) || !finite(v) || v < 0) p.push(`lifecycle.counts has an invalid entry ${k}`);
    }
  }
  if (isObj(ds.stats)) {
    const s = ds.stats;
    if (!finite(s.tracked) || !finite(s.measured) || s.measured > s.tracked || s.measured < 0) p.push('stats: tracked/measured are not sane');
  }
  return p;
}

function percent(prev: number, cur: number): number | null {
  return prev === 0 ? null : ((cur - prev) / prev) * 100;
}

function levelForDrop(pct: number | null, failAt: number, warnAt: number): Level {
  if (pct === null || pct >= 0) return 'OK';
  const drop = -pct;
  return drop >= failAt ? 'FAIL' : drop >= warnAt ? 'WARNING' : 'OK';
}

/** Full gate: candidate dataset vs previous good dataset (previous may be absent on the first run). */
export function runGate(candidate: unknown, previous: unknown | null, cfg: GateConfig, opts: { now?: Date; bytes?: number; pattern?: PatternConfig } = {}): GateReport {
  const now = opts.now ?? new Date();
  const bytes = opts.bytes ?? 0;
  const problems = structuralProblems(candidate, cfg, now, opts.pattern ? { pattern: opts.pattern } : {});
  const warnings: string[] = [];
  const report: GateReport = { level: 'OK', structuralProblems: problems, warnings, metrics: { current: null, previous: null }, deltas: [], bytes };
  if (bytes > cfg.maxPublicBytes) problems.push(`public dataset is ${bytes} bytes (limit ${cfg.maxPublicBytes})`);
  else if (bytes > cfg.warnPublicBytes) warnings.push(`public dataset is ${bytes} bytes (warn above ${cfg.warnPublicBytes})`);
  if (problems.length > 0 && !isObj(candidate)) {
    report.level = 'FAIL';
    return report;
  }
  const cur = metricsOf(candidate as Rec);
  report.metrics.current = cur;
  if (cur.repositories < cfg.minRepositories) problems.push(`only ${cur.repositories} repositories (minimum ${cfg.minRepositories})`);
  if (cur.ai < cfg.minAiRepositories) problems.push(`only ${cur.ai} AI repositories (minimum ${cfg.minAiRepositories})`);

  const prevOk = isObj(previous) && Array.isArray((previous as Rec).repositories);
  const prev = prevOk ? metricsOf(previous as Rec) : null;
  report.metrics.previous = prev;
  const names: (keyof Metrics)[] = ['repositories', 'accounted', 'withheld', 'tracked', 'measured', 'ai', 'rising', 'cooling', 'steady', 'newEntrants', 'sustained', 'movers'];
  const failKeys = cfg.maxDropPercent as Record<string, number>;
  for (const name of names) {
    const c = cur[name];
    const pv = prev ? prev[name] : null;
    let level: Level = 'OK';
    const delta = c !== null && pv !== null ? c - pv : null;
    const pct = c !== null && pv !== null ? percent(pv, c) : null;
    // Published `repositories` is judged through `accounted` (published + withheld by lifecycle rules) so that a deliberate
    // withholding is not a collapse, while a real loss of records still is.
    const dropKey = name === 'accounted' ? 'repositories' : name;
    const label = name === 'accounted' ? 'repositories (published + withheld)' : name;
    if (name !== 'repositories' && c !== null && pv !== null && failKeys[dropKey] !== undefined) {
      level = levelForDrop(pct, failKeys[dropKey] as number, (failKeys[dropKey] as number) * cfg.warnAtFractionOfFail);
      if (level === 'FAIL') problems.push(`${label} dropped ${(-(pct as number)).toFixed(1)}% (${pv} to ${c}); limit ${failKeys[dropKey]}%`);
      else if (level === 'WARNING') warnings.push(`${label} dropped ${(-(pct as number)).toFixed(1)}% (${pv} to ${c})`);
    }
    if (name === 'rising' && prev) {
      if (cur.rising === 0 && prev.rising >= cfg.risingRequireIfPreviousAtLeast) {
        level = 'FAIL';
        problems.push(`Rising fell from ${prev.rising} to 0 (needs an explicit override to publish)`);
      } else if (pct !== null && Math.abs(pct) >= cfg.maxRisingChangePercentWarn && level === 'OK') {
        level = 'WARNING';
        warnings.push(`Rising changed ${pct.toFixed(0)}% (${prev.rising} to ${cur.rising})`);
      }
    }
    report.deltas.push({ name, previous: pv, current: c, delta, percent: pct === null ? null : Math.round(pct * 10) / 10, level });
  }
  if (prev && cur.tracked !== null && prev.tracked !== null && cur.measured !== null && prev.measured !== null) {
    // Partial collection: measured coverage share collapsed even if raw counts look fine.
    const share = prev.tracked > 0 ? prev.measured / prev.tracked : 1;
    const shareNow = cur.tracked > 0 ? cur.measured / cur.tracked : 0;
    if (share - shareNow > 0.1) problems.push(`measured coverage fell from ${(share * 100).toFixed(1)}% to ${(shareNow * 100).toFixed(1)}% of tracked`);
  }
  report.level = problems.length > 0 ? 'FAIL' : warnings.length > 0 || report.deltas.some((d) => d.level === 'WARNING') ? 'WARNING' : 'OK';
  return report;
}

export function formatReportMarkdown(r: GateReport): string {
  const lines = [`### Data quality gate: ${r.level}`, ''];
  if (r.structuralProblems.length > 0) lines.push('**Problems (publishing blocked):**', ...r.structuralProblems.map((x) => `- ${x}`), '');
  if (r.warnings.length > 0) lines.push('**Warnings:**', ...r.warnings.map((x) => `- ${x}`), '');
  lines.push('| Metric | Previous | Current | Delta | % | Level |', '|---|---:|---:|---:|---:|---|');
  for (const d of r.deltas) lines.push(`| ${d.name} | ${d.previous ?? 'n/a'} | ${d.current ?? 'n/a'} | ${d.delta ?? 'n/a'} | ${d.percent ?? 'n/a'} | ${d.level} |`);
  lines.push('', `Public dataset size: ${(r.bytes / 1e6).toFixed(2)} MB`);
  return lines.join('\n');
}

/** Production smoke test on fetched HTML; returns problems (empty = pass). Pure so it is unit-testable. */
export function checkProductionPage(kind: 'home' | 'explore' | 'methodology' | 'repo' | 'robots' | 'sitemap', body: string, base: string, opts: { repo?: string } = {}): string[] {
  const p: string[] = [];
  if (body.includes('localhost:3000')) p.push(`${kind}: contains localhost:3000`);
  if (/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(body)) p.push(`${kind}: contains a token pattern`);
  if (kind === 'robots') {
    if (!body.includes(`Sitemap: ${base}/sitemap.xml`)) p.push('robots: Sitemap line does not use the production URL');
  } else if (kind === 'sitemap') {
    if (!body.includes(`<loc>${base}/</loc>`)) p.push('sitemap: home URL missing or wrong host');
  } else {
    const canonical = new RegExp(`rel="canonical" href="${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^"]*"`);
    if (!canonical.test(body)) p.push(`${kind}: canonical does not use ${base}`);
    if (!body.includes('<h1')) p.push(`${kind}: no h1 rendered`);
    if (kind === 'repo' && opts.repo && !body.includes(opts.repo)) p.push(`repo: page does not mention ${opts.repo}`);
  }
  return p;
}

export interface HistoryGateConfig {
  maxBytes: number;
}

/**
 * Validation of the public history file against the public dataset. Every drawn number must be traceable: when a record
 * has both a window growth figure and a history entry that covers the window, the sums must agree exactly.
 */
export function historyProblems(history: unknown, pub: unknown, cfg: HistoryGateConfig, bytes = 0): string[] {
  const p: string[] = [];
  if (!isObj(history)) return ['history is not an object'];
  if (history.schemaVersion !== 1) p.push(`history schemaVersion must be 1 (got ${String(history.schemaVersion)})`);
  if (typeof history.generatedAt !== 'string' || Number.isNaN(Date.parse(history.generatedAt))) p.push('history generatedAt missing or invalid');
  if (!finite(history.days) || history.days < 7) p.push('history days invalid');
  if (!isObj(history.repositories)) return [...p, 'history repositories must be an object'];
  if (bytes > cfg.maxBytes) p.push(`history is ${bytes} bytes (limit ${cfg.maxBytes})`);
  const days = finite(history.days) ? history.days : 90;
  const byId = new Map<string, Rec>();
  if (isObj(pub) && Array.isArray(pub.repositories)) for (const r of pub.repositories as Rec[]) if (isObj(r) && typeof r.id === 'string') byId.set(r.id, r);
  let bad = 0;
  const note = (m: string) => {
    bad += 1;
    if (bad <= 15) p.push(m);
  };
  for (const [id, raw] of Object.entries(history.repositories)) {
    const rec = byId.get(id);
    if (!rec) {
      note(`history entry ${id} has no public record`);
      continue;
    }
    const name = String(rec.fullName);
    if (!isObj(raw) || typeof raw.e !== 'string' || Number.isNaN(Date.parse(`${raw.e}T00:00:00Z`)) || !Array.isArray(raw.g)) {
      note(`${name}: malformed history entry`);
      continue;
    }
    const g = raw.g as unknown[];
    if (g.length === 0 || g.length > days) note(`${name}: history length ${g.length} outside 1..${days}`);
    if (g.some((x) => !Number.isInteger(x) || (x as number) < 0)) {
      note(`${name}: history contains a non-integer or negative day`);
      continue;
    }
    const nums = g as number[];
    const sum = (n: number) => nums.slice(-n).reduce((a, b) => a + b, 0);
    for (const [key, n] of [['growth7d', 7], ['growth30d', 30], ['growth90d', 90]] as const) {
      const v = rec[key];
      if (finite(v) && nums.length >= n && sum(n) !== v) note(`${name}: ${key} ${v} does not equal the sum of the last ${n} history days (${sum(n)})`);
    }
  }
  if (bad > 15) p.push(`... and ${bad - 15} more history problems`);
  return p;
}
