import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { formatReportMarkdown, historyProblems, publicSchemaProblems, runGate, checkProductionPage, secretShapeProblems, type GateConfig, type GateReport, type HistoryGateConfig } from '../../src/pipeline/gate';
import { project, treeStats } from '../../src/pipeline/size';
import { readdirSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { parsePatternConfig } from '../../src/explain/pattern';
import { assetsToDelete, datedStateName } from '../../src/pipeline/state';
import { siteUrl } from '../../lib/site';
import { GitHubApiError, NetworkError } from '../../src/github/errors';
import { withRetry } from '../../src/util/retry';

const USAGE = `Usage: tsx scripts/pipeline/index.ts <command> [options]
  preflight                     check GitHub rate-limit capacity (needs GITHUB_TOKEN); exit 0 ok, 10 = not enough capacity, 1 = error
  validate  [--next p] [--previous p] [--report p]
                                run the data quality gate on the candidate public dataset (default data/public/radar.next.json
                                vs data/public/radar.json); exit 0 OK/WARNING, 1 FAIL
  publish   [--next p] [--out p] validate again, then atomically replace the public dataset (and its history file) with compact copies
  prune-state [--keep n]        read the JSON of gh release view data-state --json assets on stdin, print the backup assets to delete (one per line)
  state-name                    print the dated backup asset name for today (UTC)
  size      [--out out] [--public data/public]
                                measure the public data (raw, gzip, brotli) and the static export; print JSON (read-only)
  summary   [--dir .pipeline]   write a Markdown run summary to $GITHUB_STEP_SUMMARY (or stdout)
  verify    [--url u] [--wait]  production smoke test; --wait polls until the new dataset is live (uses config verify.*)
Local and deterministic except preflight and verify (network). Secrets are never printed.`;

const CONFIG = JSON.parse(readFileSync('config/pipeline.json', 'utf8')) as {
  preflight: { minCoreRemaining: number; minGraphqlRemaining: number };
  gate: GateConfig;
  verify: { pollIntervalSeconds: number; timeoutMinutes: number };
  history: HistoryGateConfig & { days: number };
  state: { keepDaily: number };
};

function args(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const readJsonSafe = (p: string): unknown | null => {
  try {
    return existsSync(p) ? readJson(p) : null;
  } catch {
    return null;
  }
};
function setOutput(k: string, v: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}

async function preflight(): Promise<number> {
  const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim();
  if (!token) {
    console.error('preflight: no token in GITHUB_TOKEN / GH_TOKEN');
    return 1;
  }
  // GitHub answers 5xx now and then (seen live: 503 on /rate_limit). Retry transient failures, never a 401.
  let res: Response;
  try {
    res = await withRetry(
      async () => {
        let r: Response;
        try {
          r = await fetch('https://api.github.com/rate_limit', { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'opensource-radar-pipeline' } });
        } catch (e) {
          throw new NetworkError(`rate_limit request failed: ${(e as Error).message}`);
        }
        if (r.status >= 500) throw new GitHubApiError(`rate_limit request failed with ${r.status}`, { status: r.status });
        return r;
      },
      { attempts: 5, baseDelayMs: 3000, onRetry: () => console.error('preflight: transient GitHub error, retrying') },
    );
  } catch (e) {
    console.error(`preflight: ${(e as Error).message} (after retries)`);
    return 1;
  }
  if (res.status === 401) {
    console.error('preflight: GitHub rejected the token (401)');
    return 1;
  }
  if (!res.ok) {
    console.error(`preflight: rate_limit request failed with ${res.status}`);
    return 1;
  }
  const body = (await res.json()) as { resources: Record<string, { limit: number; remaining: number; reset: number }> };
  const core = body.resources.core;
  const gql = body.resources.graphql;
  const ok = !!core && !!gql && core.remaining >= CONFIG.preflight.minCoreRemaining && gql.remaining >= CONFIG.preflight.minGraphqlRemaining;
  const info = { ok, core, graphql: gql, required: CONFIG.preflight };
  console.log(JSON.stringify(info));
  setOutput('preflight_ok', String(ok));
  if (!ok) console.error(`preflight: not enough API capacity (core ${core?.remaining}/${core?.limit}, graphql ${gql?.remaining}/${gql?.limit}); the run is skipped and previous data stays live`);
  return ok ? 0 : 10;
}

function validate(a: Record<string, string | true>): number {
  const nextPath = (a.next as string) ?? 'data/public/radar.next.json';
  const prevPath = (a.previous as string) ?? 'data/public/radar.json';
  const reportPath = (a.report as string) ?? '.pipeline/gate.json';
  let candidate: unknown;
  let bytes = 0;
  try {
    bytes = statSync(nextPath).size;
    candidate = readJson(nextPath);
  } catch (e) {
    const rep = { level: 'FAIL', structuralProblems: [`candidate dataset unreadable: ${(e as Error).message}`], warnings: [], metrics: { current: null, previous: null }, deltas: [], bytes };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(rep, null, 1));
    console.error(rep.structuralProblems[0]);
    return 1;
  }
  const patternCfg = parsePatternConfig(readJson('config/pattern.json'));
  const report = runGate(candidate, readJsonSafe(prevPath), CONFIG.gate, { bytes, pattern: patternCfg });
  const historyPath = nextPath.replace(/radar(\.next)?\.json$/, 'history$1.json');
  // Public/private separation: only allow-listed fields, and no token-shaped string, may reach the public files.
  const safety = [
    ...publicSchemaProblems(candidate, existsSync(historyPath) ? readJsonSafe(historyPath) : null),
    ...secretShapeProblems(readFileSync(nextPath, 'utf8'), 'radar dataset'),
    ...(existsSync(historyPath) ? secretShapeProblems(readFileSync(historyPath, 'utf8'), 'history dataset') : []),
  ];
  if (safety.length > 0) {
    report.structuralProblems.push(...safety);
    report.level = 'FAIL';
  }
  if (existsSync(historyPath)) {
    const hp = historyProblems(readJsonSafe(historyPath), candidate, CONFIG.history, statSync(historyPath).size);
    if (hp.length > 0) {
      report.structuralProblems.push(...hp);
      report.level = 'FAIL';
    }
  } else {
    report.warnings.push(`history file ${historyPath} not found; trajectories will be unavailable`);
    if (report.level === 'OK') report.level = 'WARNING';
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 1));
  console.log(formatReportMarkdown(report));
  setOutput('gate_level', report.level);
  return report.level === 'FAIL' ? 1 : 0;
}

function publish(a: Record<string, string | true>): number {
  const nextPath = (a.next as string) ?? 'data/public/radar.next.json';
  const outPath = (a.out as string) ?? 'data/public/radar.json';
  const code = validate({ ...a, next: nextPath });
  if (code !== 0) {
    console.error('publish: gate failed, the known-good public dataset is untouched');
    return code;
  }
  const compact = JSON.stringify(readJson(nextPath));
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, compact);
  JSON.parse(readFileSync(tmp, 'utf8')); // re-read before replacing
  renameSync(tmp, outPath); // atomic replace on the same volume
  console.log(`publish: wrote ${outPath} (${compact.length} bytes, compact)`);
  const histNext = nextPath.replace(/radar(\.next)?\.json$/, 'history$1.json');
  const histOut = outPath.replace(/radar(\.next)?\.json$/, 'history$1.json');
  if (existsSync(histNext) && histNext !== nextPath) {
    const hc = JSON.stringify(readJson(histNext));
    const ht = `${histOut}.tmp`;
    writeFileSync(ht, hc);
    JSON.parse(readFileSync(ht, 'utf8'));
    renameSync(ht, histOut);
    console.log(`publish: wrote ${histOut} (${hc.length} bytes, compact)`);
  }
  return 0;
}

function summary(a: Record<string, string | true>): number {
  const dir = (a.dir as string) ?? '.pipeline';
  const j = (n: string) => readJsonSafe(`${dir}/${n}.json`) as Record<string, any> | null;
  const collect = j('collect');
  const track = j('track');
  const momentum = j('momentum');
  const gate = j('gate');
  const pre = j('preflight');
  const lines: string[] = ['## OpenSource Radar pipeline run', '', `Run: ${process.env.GITHUB_RUN_ID ?? 'local'} · ${new Date().toISOString()}`, ''];
  if (pre) lines.push(`API capacity before run: core ${pre.core?.remaining}/${pre.core?.limit}, graphql ${pre.graphql?.remaining}/${pre.graphql?.limit}`, '');
  if (collect?.report) {
    const r = collect.report;
    const u = collect.usage ?? {};
    lines.push('### Collection', `- tracked ${r.tracked}, due ${r.due}, collected ${r.collected}, failures ${r.failures?.length ?? 0}${r.stoppedBy ? `, stopped by ${r.stoppedBy}` : ''}`, `- requests: REST ${u.restRequests ?? 'n/a'}, GraphQL ${u.graphqlRequests ?? 'n/a'}, star history pages ${u.starHistoryPageRequests ?? 'n/a'}, retries ${u.starHistoryRetries ?? 'n/a'}`, `- cache: hits ${u.cache?.hits ?? 'n/a'}, misses ${u.cache?.misses ?? 'n/a'}`, `- duration ${Math.round((r.durationMs ?? 0) / 1000)} s`, '');
  }
  if (track) lines.push('### Tracking', `- tracked ${track.tracked} · HOT ${track.byTier?.HOT} · WARM ${track.byTier?.WARM} · DORMANT ${track.byTier?.DORMANT} · UNASSESSED ${track.byTier?.UNASSESSED}`, '');
  const sz = j('size');
  if (sz) {
    const f = (sz.files ?? {}) as Record<string, { bytes: number; brotli: number }>;
    const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
    lines.push('### Size', `- radar.json ${mb(f['radar.json']?.bytes ?? 0)} (brotli ${mb(f['radar.json']?.brotli ?? 0)}), history.json ${mb(f['history.json']?.bytes ?? 0)} (brotli ${mb(f['history.json']?.brotli ?? 0)})`, sz.staticExport ? `- static export: ${sz.staticExport.htmlPages} pages, ${sz.staticExport.files} files, ${mb(sz.staticExport.bytes)}` : '- static export: not measured', '');
  }
  const lc = (momentum as Record<string, any> | null)?.lifecycle as { counts: Record<string, number>; withheld: number } | null | undefined;
  if (lc) lines.push('### Lifecycle', `- ${Object.entries(lc.counts).map(([k, v]) => `${k} ${v}`).join(' · ')} · withheld from the public dataset: ${lc.withheld}`, '');
  if (momentum?.summary) {
    const s = momentum.summary;
    lines.push('### Momentum', `- Rising ${s.byTrend?.RISING} · Cooling ${s.byTrend?.COOLING} · Steady ${s.byTrend?.STEADY} · New entrants ${s.newEntrants} · Sustained ${s.sustained} · Movers ${s.movers}`, '');
  }
  if (gate) lines.push(formatReportMarkdown(gate as unknown as GateReport), '');
  const text = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  else console.log(text);
  return 0;
}

function walk(dir: string): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push({ path: p, size: statSync(p).size });
  }
  return out;
}

/** Read-only size report: public data (raw / gzip / brotli) and the static export (files, bytes, by extension). */
function size(a: Record<string, string | true>): number {
  const pubDir = (a.public as string) ?? 'data/public';
  const outDir = (a.out as string) ?? 'out';
  const files: Record<string, unknown> = {};
  let records = 0;
  for (const name of ['radar.json', 'history.json']) {
    const path = join(pubDir, name);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    files[name] = { bytes: buf.length, gzip: gzipSync(buf).length, brotli: brotliCompressSync(buf).length };
    if (name === 'radar.json') records = (JSON.parse(buf.toString('utf8')) as { repositories: unknown[] }).repositories.length;
  }
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/');
  const tree = existsSync(outDir) ? walk(outDir).map((f) => ({ path: norm(f.path), size: f.size })) : [];
  const exp = tree.length > 0 ? treeStats(tree) : null;
  const pages = tree.filter((f) => f.path.endsWith('/index.html')).length;
  const radarBytes = (files['radar.json'] as { bytes: number } | undefined)?.bytes ?? 0;
  const projections = records > 0 ? { radarJson: project({ records, bytes: radarBytes }, [5000, 10000, 20000]), staticExportByHtmlPage: exp ? project({ records: Math.max(1, pages), bytes: exp.bytes }, [5000, 10000, 20000]) : null } : null;
  console.log(JSON.stringify({ publicRecords: records, files, staticExport: exp ? { ...exp, htmlPages: pages } : null, projections, note: 'projections are linear in records (estimate)' }, null, 1));
  return 0;
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache', 'user-agent': 'opensource-radar-verify' } });
  return { status: res.status, body: await res.text() };
}

async function verifyOnce(base: string, generatedAt: string | null, repo: string): Promise<string[]> {
  const problems: string[] = [];
  const pages: [Parameters<typeof checkProductionPage>[0], string][] = [
    ['home', '/'],
    ['explore', '/explore/'],
    ['methodology', '/methodology/'],
    ['repo', `/repo/${repo}/`],
    ['robots', '/robots.txt'],
    ['sitemap', '/sitemap.xml'],
  ];
  for (const [kind, path] of pages) {
    try {
      const { status, body } = await get(`${base}${path}`);
      if (status !== 200) problems.push(`${kind}: HTTP ${status}`);
      else problems.push(...checkProductionPage(kind, body, base, { repo }));
      if (kind === 'home' && generatedAt && status === 200) {
        const stamp = `${generatedAt.slice(0, 10)} ${generatedAt.slice(11, 16)} UTC`;
        if (!body.includes(stamp)) problems.push(`home: not showing the new dataset yet (expected "Updated ${stamp}")`);
      }
    } catch (e) {
      problems.push(`${kind}: request failed (${(e as Error).message})`);
    }
  }
  return problems;
}

async function verify(a: Record<string, string | true>): Promise<number> {
  const base = ((a.url as string) ?? process.env.SITE_URL ?? siteUrl()).replace(/\/+$/, '');
  const radar = readJsonSafe('data/public/radar.json') as { generatedAt?: string; repositories?: { fullName: string; classification: { topLevel: string } | null }[] } | null;
  const repo = radar?.repositories?.find((r) => r.classification?.topLevel === 'AI')?.fullName ?? 'vectorize-io/hindsight';
  const deadline = Date.now() + CONFIG.verify.timeoutMinutes * 60_000;
  let problems: string[] = [];
  do {
    problems = await verifyOnce(base, a.wait ? (radar?.generatedAt ?? null) : null, repo);
    if (problems.length === 0) break;
    if (!a.wait) break;
    console.error(`verify: ${problems.length} problem(s), retrying in ${CONFIG.verify.pollIntervalSeconds}s: ${problems[0]}`);
    await new Promise((r) => setTimeout(r, CONFIG.verify.pollIntervalSeconds * 1000));
  } while (Date.now() < deadline);
  console.log(JSON.stringify({ base, repo, ok: problems.length === 0, problems }, null, 1));
  return problems.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  switch (cmd) {
    case 'preflight':
      return preflight();
    case 'validate':
      return validate(a);
    case 'publish':
      return publish(a);
    case 'summary':
      return summary(a);
    case 'prune-state': {
      const raw = readFileSync(0, 'utf8');
      const assets = (JSON.parse(raw) as { assets?: { name: string }[] }).assets ?? [];
      const keep = typeof a.keep === 'string' ? Number(a.keep) : CONFIG.state.keepDaily;
      if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep needs an integer >= 1');
      for (const name of assetsToDelete(assets, keep)) console.log(name);
      return 0;
    }
    case 'size':
      return size(a);
    case 'state-name':
      console.log(datedStateName(new Date()));
      return 0;
    case 'verify':
      return verify(a);
    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error('pipeline failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  },
);
