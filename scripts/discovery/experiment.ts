/**
 * Phase 6.2.1 offline discovery-bias experiment. Read-only against GitHub (Search API), anonymous, never writes pipeline state.
 *
 *   npx tsx scripts/discovery/experiment.ts fetch <raw.json> <state data dir> [--topics N]   unauthenticated search (10/min), cached per query
 *   npx tsx scripts/discovery/experiment.ts analyse <raw.json> <state data dir>              writes results/phase6.2.1/discovery.json
 *
 * Strategies, per crowded topic (established-query shape: stars>100, pushed in the last 30 days, sorted by stars):
 *   A current        page 1 (top 100)
 *   C deeper         pages 1-3 (top 300)
 *   D diversified    A plus "recently created" (created in the last 180 days) plus a mid-size star band (100..1000)
 *   B retention      modelled offline from state (docs/PHASE-6.2-COVERAGE-RECOVERY.md); needs no extra search requests
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { discoveryQueries } from '../../src/coverage';
import { loadCategoryConfig } from '../../src/discovery/config';
import { GitHubHttpClient } from '../../src/github/http';
import { RestSearchProvider } from '../../src/github/searchProvider';

const [mode, file, dirArg] = process.argv.slice(2);
const NOW = new Date('2026-10-08T00:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

interface Hit {
  id: string;
  fullName: string;
  name: string;
  stars: number;
  topics: string[];
  description: string | null;
  language: string | null;
  createdAt: string;
  pushedAt: string | null;
  isFork: boolean;
  isArchived: boolean;
}
type Raw = Record<string, Hit[]>; // key = "<topic>|<A|C|D1|D2>"

const slim = (r: any): Hit => ({
  id: r.repositoryId,
  fullName: r.fullName,
  name: r.name,
  stars: r.stars,
  topics: r.topics,
  description: r.description,
  language: r.language,
  createdAt: r.createdAt,
  pushedAt: r.pushedAt ?? null,
  isFork: r.isFork === true,
  isArchived: r.isArchived === true,
});

async function fetchAll() {
  const topicsN = process.argv.includes('--topics') ? Number(process.argv[process.argv.indexOf('--topics') + 1]) : 14;
  const dir = dirArg ?? '.pipeline/state-2026-10-06/data';
  const cand = JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { candidates: { topics: string[] }[] };
  const queries = discoveryQueries([loadCategoryConfig('config/categories/ai.json'), loadCategoryConfig('config/categories/engineering.json')]).filter((q) => q.kind === 'pushed');
  const count = new Map<string, number>();
  for (const c of cand.candidates) for (const t of c.topics) count.set(t, (count.get(t) ?? 0) + 1);
  const topics = queries
    .map((q) => q.topic)
    .filter((t, i, a) => a.indexOf(t) === i)
    .sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))
    .slice(0, topicsN);
  const raw: Raw = existsSync(file as string) ? JSON.parse(readFileSync(file as string, 'utf8')) : {};
  const http = new GitHubHttpClient({ token: null }); // anonymous on purpose: 10 searches/min
  const search = new RestSearchProvider(http, 7500);
  const jobs: [string, string, number][] = [];
  for (const t of topics) {
    jobs.push([`${t}|C`, `topic:${t} stars:>100 pushed:>${day(30)}`, 3]); // pages 1-3; page 1 is strategy A
    jobs.push([`${t}|D1`, `topic:${t} stars:>100 pushed:>${day(30)} created:>${day(180)}`, 1]);
    jobs.push([`${t}|D2`, `topic:${t} stars:100..1000 pushed:>${day(30)}`, 1]);
  }
  console.error(`topics (${topics.length}): ${topics.join(', ')}; ${jobs.length} queries`);
  for (const [key, q, pages] of jobs) {
    if (raw[key]) continue;
    const res = await search.searchRepositories(q, { sort: 'stars', order: 'desc', perPage: 100, maxPages: pages, now: NOW });
    raw[key] = res.repositories.map(slim);
    if (key.endsWith('|C')) raw[key.replace('|C', '|A')] = raw[key].slice(0, 100);
    writeFileSync(file as string, JSON.stringify(raw));
    console.error(`${key}: ${res.repositories.length} (total ${res.totalCount}, requests ${res.requests})`);
  }
}

function analyse() {
  const raw = JSON.parse(readFileSync(file as string, 'utf8')) as Raw;
  const dir = dirArg as string;
  const cand = JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { candidates: { id: string }[] };
  const repos = JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as { repositories: { id: string }[] };
  const inCand = new Set(cand.candidates.map((c) => c.id));
  const inState = new Set(repos.repositories.map((r) => r.id));
  const classifier = new Classifier(loadTaxonomy());
  const topics = [...new Set(Object.keys(raw).map((k) => k.split('|')[0] as string))];
  const keep = (h: Hit) => !h.isFork && !h.isArchived;
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const share = (n: number, d: number) => Number((n / Math.max(1, d)).toFixed(3));
  const relevant = (h: Hit) => classifier.classify({ id: h.id, name: h.name, description: h.description, topics: h.topics, language: h.language }).topLevelCategory !== 'UNKNOWN';
  const young = (h: Hit) => (NOW.getTime() - Date.parse(h.createdAt)) / 86_400_000 <= 180;
  const strategies: Record<string, { keys: string[]; requestsPerTopic: number }> = {
    A: { keys: ['A'], requestsPerTopic: 1 },
    C: { keys: ['C'], requestsPerTopic: 3 },
    D: { keys: ['A', 'D1', 'D2'], requestsPerTopic: 3 },
  };
  const aIds = new Set<string>();
  for (const t of topics) for (const h of raw[`${t}|A`] ?? []) if (keep(h)) aIds.add(h.id);
  const result: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(strategies)) {
    const byId = new Map<string, Hit>();
    for (const t of topics) for (const k of s.keys) for (const h of raw[`${t}|${k}`] ?? []) if (keep(h)) byId.set(h.id, h);
    const hits = [...byId.values()];
    const novel = hits.filter((h) => !inCand.has(h.id));
    result[name] = {
      searchRequestsPerTopic: s.requestsPerTopic,
      estimatedWeeklyRequestsAt99Queries: s.requestsPerTopic * 99,
      uniqueRepos: hits.length,
      gainOverA: hits.filter((h) => !aIds.has(h.id)).length,
      notInCurrentCandidateSet: novel.length,
      notInStateAtAll: hits.filter((h) => !inState.has(h.id)).length,
      relevantShare: share(hits.filter(relevant).length, hits.length),
      novelRelevant: novel.filter(relevant).length,
      medianStars: median(hits.map((h) => h.stars)),
      medianStarsNovel: median(novel.map((h) => h.stars)),
      shareUnder1000Stars: share(hits.filter((h) => h.stars < 1000).length, hits.length),
      shareNovelUnder1000Stars: share(novel.filter((h) => h.stars < 1000).length, novel.length),
      shareCreatedLast180d: share(hits.filter(young).length, hits.length),
      shareNovelCreatedLast180d: share(novel.filter(young).length, novel.length),
    };
  }
  const perTopic = topics.map((t) => ({
    topic: t,
    aReturned: (raw[`${t}|A`] ?? []).length,
    aLastRankStars: (raw[`${t}|A`] ?? []).at(-1)?.stars ?? null,
    cReturned: (raw[`${t}|C`] ?? []).length,
    cLastRankStars: (raw[`${t}|C`] ?? []).at(-1)?.stars ?? null,
  }));
  const out = { generatedAgainst: 'pipeline state of 2026-10-07', topics, strategies: result, perTopic };
  writeFileSync('results/phase6.2.1/discovery.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === 'fetch') fetchAll().catch((e) => { console.error(e); process.exit(1); });
else if (mode === 'analyse') analyse();
else throw new Error('usage: fetch <raw.json> <state dir> | analyse <raw.json> <state dir>');
