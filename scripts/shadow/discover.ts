/**
 * Phase 6.3.1 shadow discovery: the Top-300 discovery for ALL production topics (established queries, pages 1-3), then classification and the
 * admission policy, reported with the numbers the shadow cycle must record. SHADOW ONLY: it reads the production state, writes only under
 * results/phase6.3.1/ (and its cache), and refuses any output path under data/ or public/.
 *
 *   tsx scripts/shadow/discover.ts <production state data dir> [--out-dir results/phase6.3.1/shadow] [--cache results/phase6.3.1/cache/shadow-search.json] [--date YYYY-MM-DD]
 *
 * Token: GITHUB_TOKEN / GH_TOKEN from the environment when present (never printed); otherwise anonymous (search 10/min).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { discoveryQueries } from '../../src/coverage';
import { loadAdmissionConfig } from '../../src/discovery/admission';
import { loadCategoryConfig } from '../../src/discovery/config';
import { AuthenticationError, RateLimitError } from '../../src/github/errors';
import { loadToken } from '../../src/github/config';
import { GitHubHttpClient } from '../../src/github/http';
import { createLogger } from '../../src/github/logger';
import { RestSearchProvider } from '../../src/github/searchProvider';
import { summarizeDiscovery, type DiscoveryQueryResult } from '../../src/shadow/report';
import { detectLearning, loadTaxonomyV2 } from '../../src/taxonomy';

const argv = process.argv.slice(2);
const stateDir = argv[0] as string;
const arg = (n: string, d: string) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const outDir = arg('--out-dir', 'results/phase6.3.1/shadow');
const cachePath = arg('--cache', 'results/phase6.3.1/cache/shadow-search.json');
const date = arg('--date', new Date().toISOString().slice(0, 10));

// ---- isolation: shadow output can never land in the production data
for (const p of [outDir, cachePath]) {
  const abs = resolve(p);
  for (const forbidden of ['data', 'public', 'out', '.next']) {
    if (abs.startsWith(resolve(forbidden) + sep) || abs === resolve(forbidden)) throw new Error(`shadow isolation: refusing to write under ${forbidden}/ (${p})`);
  }
}
mkdirSync(outDir, { recursive: true });
mkdirSync(resolve(cachePath, '..'), { recursive: true });

const now = new Date(`${date}T00:00:00Z`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRateLimitWait<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof RateLimitError) || attempt >= 40) throw e;
      const until = e.resetAt ? e.resetAt.getTime() + 3000 : Date.now() + 65_000;
      const wait = Math.max(5000, Math.min(until - Date.now(), 3_700_000));
      console.error(`[${new Date().toISOString().slice(11, 19)}] rate limited on ${label}; waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

const configs = [loadCategoryConfig('config/categories/ai.json'), loadCategoryConfig('config/categories/engineering.json')];
const topics = discoveryQueries(configs).filter((q) => q.kind === 'pushed').map((q) => q.topic).filter((t, i, a) => a.indexOf(t) === i).sort();
const iso = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

let token: string | null = null;
try {
  token = loadToken();
} catch (e) {
  if (!(e instanceof AuthenticationError)) throw e;
}
const logger = createLogger({ secrets: token ? [token] : [] });
const http = new GitHubHttpClient({ token, logger });
const search = new RestSearchProvider(http, token ? 2100 : 7500);

type Cache = Record<string, DiscoveryQueryResult>;
const cache: Cache = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Cache) : {};
const startedAt = Date.now();

async function main() {
  console.error(`${topics.length} topics x 3 pages (${token ? 'authenticated' : 'anonymous'}), cache holds ${Object.keys(cache).length}`);
  for (const t of topics) {
    const key = `${t}|B:top300`;
    if (cache[key]) continue;
    const query = `topic:${t} stars:>100 pushed:>${iso(30)}`;
    const res = await withRateLimitWait(key, () => search.searchRepositories(query, { sort: 'stars', order: 'desc', perPage: 100, maxPages: 3, now }));
    cache[key] = { key, query, repositories: res.repositories, pages: res.requests };
    writeFileSync(cachePath, JSON.stringify(cache));
    console.error(`${key}: ${res.repositories.length} results, ${res.requests} request(s)`);
  }

  // ---- production control: ids already candidates or tracked in the production state
  const cand = JSON.parse(readFileSync(join(stateDir, 'candidates/candidates.json'), 'utf8')) as { candidates: { id: string }[] };
  const productionIds = new Set(cand.candidates.map((c) => c.id));
  const tracked = existsSync(join(stateDir, 'tracked/tracked.json')) ? (JSON.parse(readFileSync(join(stateDir, 'tracked/tracked.json'), 'utf8')) as { repositories: { id: string }[] }).repositories : [];
  for (const r of tracked) productionIds.add(r.id);

  const classifier = new Classifier(loadTaxonomy());
  const tax2 = loadTaxonomyV2();
  const config = loadAdmissionConfig();
  const report = summarizeDiscovery({
    results: Object.values(cache),
    productionIds,
    poolIds: new Set(),
    classify: (s) => {
      const r = classifier.classify({ id: s.repositoryId, name: s.name, description: s.description, topics: s.topics, language: s.language });
      const learning = r.signals.context.some((c) => c.id === tax2.learningContextId) || detectLearning(tax2, { name: s.name, description: s.description, topics: s.topics }).learning;
      return { topLevel: r.topLevelCategory, learning };
    },
    config,
    now,
  });
  const runtimeSeconds = Math.round((Date.now() - startedAt) / 1000);
  const out = {
    date,
    mode: 'shadow',
    authenticated: token !== null,
    policyVersion: config.policyVersion,
    topics: topics.length,
    productionControl: { candidateSetIds: cand.candidates.length, trackedIds: tracked.length, controlIds: productionIds.size },
    runtimeSecondsThisInvocation: runtimeSeconds,
    note: 'runtime covers only this invocation (earlier invocations resumed from the cache); discovery search requests are anonymous-throttled',
    ...report,
  };
  writeFileSync(join(outDir, `discovery-${date}.json`), JSON.stringify(out, null, 1) + '\n');
  // the admitted repositories' snapshots (small): the shadow tracker needs owner/name/created/pushed to fetch and score them
  const byId = new Map(Object.values(cache).flatMap((r) => r.repositories).map((s) => [s.repositoryId, s]));
  writeFileSync(join(outDir, `admitted-${date}.json`), JSON.stringify({ date, policyVersion: config.policyVersion, snapshots: report.admitted.map((a) => byId.get(a.id)).filter(Boolean) }) + '\n');
  console.log(JSON.stringify({ stats: report.stats, budget: report.budget }, null, 1));
}
main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
