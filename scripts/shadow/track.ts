/**
 * Phase 6.3.1 shadow tracker: the daily half of the production shadow. It keeps a SHADOW POOL of admitted repositories, refreshes the due ones
 * with the real tracking policy (tiers and due grace), and records the daily evidence (history requests, failures, rate-limit state, runtime).
 * SHADOW ONLY: it reads the production state, writes only inside --shadow-dir, and refuses any shadow directory under data/ or public/.
 *
 *   tsx scripts/shadow/track.ts <production state data dir> --shadow-dir <dir> [--date YYYY-MM-DD] [--admitted <admitted-YYYY-MM-DD.json>] [--discovery <discovery-YYYY-MM-DD.json>]
 *
 * Budget guard: the run stops requesting history when (production requests today + shadow requests) would reach the configured ceiling; the
 * ceiling is never raised by this script. Token: GITHUB_TOKEN / GH_TOKEN from the environment (never printed); anonymous otherwise.
 */
import { OBSERVED_PRODUCTION_PEAK, shadowHistoryBudget } from '../../src/shadow/budget';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildRecord } from '../../src/collect/dataset';
import { loadAdmissionConfig } from '../../src/discovery/admission';
import { AuthenticationError, RateLimitError } from '../../src/github/errors';
import { loadToken } from '../../src/github/config';
import { GitHubHttpClient } from '../../src/github/http';
import { createLogger } from '../../src/github/logger';
import { RateGuard } from '../../src/github/rateGuard';
import { RestStarHistoryProvider } from '../../src/github/starHistoryProvider';
import type { RepositorySnapshot } from '../../src/model/repositorySnapshot';
import type { DailyRecord, DiscoveryReport } from '../../src/shadow/report';
import { loadTrackingPolicy } from '../../src/tracking/config';
import { metricsFor } from '../../src/tracking/datasets';
import { decideTracking, selectDue } from '../../src/tracking/engine';
import type { TrackingStatus } from '../../src/tracking/types';

const argv = process.argv.slice(2);
const stateDir = argv[0] as string;
const arg = (n: string, d: string | null) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const shadowArg = arg('--shadow-dir', null);
if (!shadowArg) throw new Error('--shadow-dir is required');
const shadowDir: string = shadowArg;
for (const forbidden of ['data', 'public', 'out', '.next']) {
  const abs = resolve(shadowDir);
  if (abs === resolve(forbidden) || abs.startsWith(resolve(forbidden) + sep)) throw new Error(`shadow isolation: refusing to use ${forbidden}/ as the shadow directory`);
}
const date = arg('--date', new Date().toISOString().slice(0, 10)) as string;
const admittedPath = arg('--admitted', null);
const discoveryPath = arg('--discovery', null);
mkdirSync(join(shadowDir, 'daily'), { recursive: true });

interface PoolEntry { id: string; fullName: string; owner: string; name: string; admittedAt: string; snapshot: RepositorySnapshot; tier: TrackingStatus; nextRefreshAt: string; lastCollectedAt: string | null; failures: number }
const poolPath = join(shadowDir, 'pool.json');
const pool: PoolEntry[] = existsSync(poolPath) ? (JSON.parse(readFileSync(poolPath, 'utf8')) as { entries: PoolEntry[] }).entries : [];

async function main() {
  const t0 = Date.now();
  const cfg = loadAdmissionConfig();
  const policy = loadTrackingPolicy();
  const now = new Date();
  let token: string | null = null;
  try {
    token = loadToken();
  } catch (e) {
    if (!(e instanceof AuthenticationError)) throw e;
  }
  const logger = createLogger({ secrets: token ? [token] : [] });
  const http = new GitHubHttpClient({ token, logger, guard: new RateGuard({ maxWaitMs: 65_000 }) });
  const provider = new RestStarHistoryProvider(http, { logger, now: () => now });

  // ---- admission: add this week's admitted repositories, within the caps
  let newAdmissions = 0;
  if (admittedPath && existsSync(admittedPath)) {
    const adm = JSON.parse(readFileSync(admittedPath, 'utf8')) as { snapshots: RepositorySnapshot[] };
    const have = new Set(pool.map((p) => p.id));
    for (const s of adm.snapshots) {
      if (have.has(s.repositoryId)) continue;
      if (newAdmissions >= cfg.budget.maxNewPerWeek || pool.length >= cfg.budget.maxAdmittedPool) break;
      pool.push({ id: s.repositoryId, fullName: s.fullName, owner: s.owner, name: s.name, admittedAt: date, snapshot: s, tier: 'UNASSESSED', nextRefreshAt: now.toISOString(), lastCollectedAt: null, failures: 0 });
      newAdmissions += 1;
    }
  }

  // ---- production load today, from the production state (for the shared ceiling)
  const tracked = existsSync(join(stateDir, 'tracked/tracked.json')) ? (JSON.parse(readFileSync(join(stateDir, 'tracked/tracked.json'), 'utf8')) as { repositories: { lastCollectedAt?: string }[] }).repositories : [];
  const productionLast = tracked.reduce<string | null>((m, r) => (r.lastCollectedAt && (m === null || r.lastCollectedAt > m) ? r.lastCollectedAt : m), null);
  const productionToday = tracked.filter((r) => (r.lastCollectedAt ?? '').startsWith(date)).length;
  const discovery = discoveryPath && existsSync(discoveryPath) ? (JSON.parse(readFileSync(discoveryPath, 'utf8')) as DiscoveryReport) : undefined;
  // Production has recorded nothing today (late, failed or still running): reserve its observed peak, not its average.
  const shared = shadowHistoryBudget({ ceiling: cfg.budget.maxHistoryRequestsPerDay, baseline: cfg.budget.currentHistoryRequestsPerDay, observedPeak: OBSERVED_PRODUCTION_PEAK, productionRecordedToday: productionToday, shadowOtherRequests: (discovery ? discovery.stats.searchRequests : 0) + 1 });
  const budgetForShadow = shared.budget;

  // ---- refresh the due pool with the real tracking policy
  const due = selectDue(pool, now, policy.dueOrder, (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1), policy.dueGraceHours);
  let failures = 0;
  let hitLimit = false;
  let budgetStopped = false;
  for (const e of due) {
    if (provider.stats.pageRequests >= budgetForShadow) { budgetStopped = true; break; }
    try {
      const series = await provider.fetchStarHistory({ owner: e.owner, name: e.name }, { maxPages: 1 });
      const rec = buildRecord(e.snapshot, { domains: ['ai'], categories: [] }, series, [], new Date(series.fetchedAt));
      const { metrics, lastRefreshedAt } = metricsFor({ stars: e.snapshot.stars, createdAt: e.snapshot.createdAt, pushedAt: e.snapshot.pushedAt ?? null, isArchived: e.snapshot.isArchived ?? null }, rec);
      const d = decideTracking({ id: e.id, topLevelCategory: 'AI', metrics, lastRefreshedAt }, policy, now, e.tier === 'UNASSESSED' ? undefined : { tier: e.tier, tierSince: e.lastCollectedAt ?? now.toISOString() });
      e.tier = d.tier;
      e.lastCollectedAt = now.toISOString();
      e.nextRefreshAt = d.nextRefreshAt;
      e.failures = 0;
    } catch (err) {
      failures += 1;
      e.failures += 1;
      if (err instanceof RateLimitError) { hitLimit = true; break; }
    }
  }

  let remaining: number | null = null;
  try {
    const r = await http.rest<{ resources?: { core?: { remaining?: number } } }>('/rate_limit', { operation: 'rateLimit.check' });
    remaining = r.data.resources?.core?.remaining ?? null;
  } catch {
    remaining = null;
  }
  const daily: DailyRecord = {
    date,
    historyRequests: provider.stats.pageRequests,
    historyFailures: failures,
    productionHistoryRequests: productionToday,
    searchRequests: discovery ? discovery.stats.searchRequests : 0,
    poolSize: pool.length,
    newAdmissions,
    runtimeSeconds: Math.round((Date.now() - t0) / 1000),
    rateLimit: { remainingAtEnd: remaining, hitLimit },
    startedAt: new Date(t0).toISOString(),
    tierCounts: pool.reduce((a, e) => { const k = (e.tier === 'HOT' || e.tier === 'WARM' || e.tier === 'DORMANT' ? e.tier : 'UNASSESSED') as 'HOT' | 'WARM' | 'DORMANT' | 'UNASSESSED'; a[k] += 1; return a; }, { HOT: 0, WARM: 0, DORMANT: 0, UNASSESSED: 0 }),
    retries: provider.stats.retries,
    restRequests: provider.stats.pageRequests + (discovery ? discovery.stats.searchRequests : 0) + 1,
    graphqlRequests: 0,
    totalApiRequests: provider.stats.pageRequests + (discovery ? discovery.stats.searchRequests : 0) + 1,
    budgetForShadow,
    budgetBasis: shared.basis,
    productionLastCollectedAt: productionLast,
    startedAfterProduction: productionLast === null ? null : productionLast.startsWith(date) && Date.parse(productionLast) <= t0,
    discoveryStrategy: discovery ? 'Top-300 topic discovery (66 topics, pages 1-3)' : 'tracking only (no discovery today)',
    ...(discovery ? { discovery: { stats: discovery.stats, admitted: discovery.admitted, budget: discovery.budget } } : {}),
  };
  writeFileSync(poolPath, JSON.stringify({ updatedAt: now.toISOString(), entries: pool }) + '\n');
  writeFileSync(join(shadowDir, 'daily', `${date}.json`), JSON.stringify({ ...daily, budgetStopped, dueToday: due.length, authenticated: token !== null }, null, 1) + '\n');
  console.log(JSON.stringify({ date, poolSize: pool.length, newAdmissions, due: due.length, historyRequests: daily.historyRequests, failures, hitLimit, budgetStopped, productionToday, budgetForShadow, budgetBasis: shared.basis }, null, 1));
}
main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
