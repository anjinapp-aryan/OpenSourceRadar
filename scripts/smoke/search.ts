import { RestSearchProvider } from '../../src/github/searchProvider';
import { isoDaysAgo, makeClient, Recorder } from './common';

const PUSHED = isoDaysAgo(30).slice(0, 10);
const CREATED = isoDaysAgo(7).slice(0, 10);

/** label -> base qualifier. Every query also gets stars:>100 pushed:>30d. */
const TOPIC_QUERIES: Record<string, string> = {
  'AI repositories': 'topic:ai',
  'AI agents': 'topic:ai-agents',
  LLM: 'topic:llm',
  MCP: 'topic:mcp',
  RAG: 'topic:rag',
  'machine learning': 'topic:machine-learning',
  Java: 'language:Java',
  Spring: 'topic:spring-boot',
  Kafka: 'topic:kafka',
  Kubernetes: 'topic:kubernetes',
  AWS: 'topic:aws',
  PostgreSQL: 'topic:postgresql',
  Redis: 'topic:redis',
  microservices: 'topic:microservices',
  'distributed systems': 'topic:distributed-systems',
  'developer tools': 'topic:developer-tools',
};

async function main() {
  const { client } = makeClient();
  const rec = new Recorder('search', client);
  const search = new RestSearchProvider(client);
  const rows: unknown[] = [];

  for (const [label, base] of Object.entries(TOPIC_QUERIES)) {
    await rec.check(`search: ${label}`, async () => {
      const q = `${base} stars:>100 pushed:>${PUSHED}`;
      const t0 = Date.now();
      const res = await search.searchRepositories(q, { sort: 'stars', perPage: 100, maxPages: 1 });
      const row = {
        label,
        query: q,
        requests: res.requests,
        totalCount: res.totalCount,
        retrieved: res.repositories.length,
        incompleteResults: res.incompleteResults,
        remaining: res.rateLimit?.remaining ?? null,
        limit: res.rateLimit?.limit ?? null,
        resource: res.rateLimit?.resource ?? null,
        durationMs: Date.now() - t0,
      };
      rows.push(row);
      if (res.repositories.length === 0) throw new Error('no results');
      return row;
    });
  }
  rec.measurements.queries = rows;

  await rec.check('search: new entrants (created in last 7d, stars>50)', async () => {
    const q = `created:>${CREATED} stars:>50`;
    const res = await search.searchRepositories(q, { sort: 'stars', perPage: 100, maxPages: 1 });
    const row = { query: q, requests: res.requests, totalCount: res.totalCount, retrieved: res.repositories.length, remaining: res.rateLimit?.remaining ?? null };
    rec.measurements.newEntrants = row;
    return row;
  });

  await rec.check('search pagination: 3 pages x 100 for topic:llm, no duplicate ids', async () => {
    const q = `topic:llm stars:>10 pushed:>${PUSHED}`;
    const res = await search.searchRepositories(q, { sort: 'stars', perPage: 100, maxPages: 3 });
    const ids = new Set(res.repositories.map((r) => r.repositoryId));
    const row = {
      query: q,
      requests: res.requests,
      pages: res.pages,
      totalCount: res.totalCount,
      retrieved: res.repositories.length,
      unique: ids.size,
      remaining: res.rateLimit?.remaining ?? null,
    };
    rec.measurements.pagination = row;
    if (ids.size !== res.repositories.length) throw new Error('duplicate repositories across pages');
    return row;
  });

  await rec.check('search result cap: page 11 x 100 is not retrievable (documented 1,000 cap)', async () => {
    const res = await client
      .rest<{ items?: unknown[]; message?: string }>('/search/repositories', { operation: 'smoke.search.cap' }, {
        query: { q: `stars:>1000`, per_page: 100, page: 11 },
      })
      .then((r) => ({ status: r.status, items: Array.isArray(r.data.items) ? r.data.items.length : null }))
      .catch((e: Error) => ({ status: null as number | null, items: null as number | null, error: `${e.name}: ${e.message}` }));
    rec.measurements.pageBeyondCap = res;
    return res;
  });

  rec.finish();
}

main().catch((e) => {
  console.error('smoke:search crashed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
