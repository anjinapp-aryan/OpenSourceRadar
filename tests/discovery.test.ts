import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  defaultConfigPath,
  expandQuery,
  loadCategoryConfig,
  parseCategoryConfig,
  type CategoryConfig,
} from '../src/discovery/config';
import { matchingCategories, mergeCandidates, SearchDiscoveryProvider } from '../src/discovery/discoveryProvider';
import { AuthenticationError, NetworkError, RateLimitError } from '../src/github/errors';
import type { GitHubSearchProvider, SearchResult } from '../src/github/providers';
import type { RepositorySnapshot } from '../src/model/repositorySnapshot';

const NOW = new Date('2026-09-24T00:00:00Z');

function snap(id: number, over: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    repositoryId: String(id),
    owner: 'o',
    name: `repo${id}`,
    fullName: `o/repo${id}`,
    url: `https://github.com/o/repo${id}`,
    description: 'an ai agent framework',
    stars: 500,
    forks: 1,
    openIssues: 0,
    language: 'Python',
    topics: ['ai-agents'],
    license: 'MIT',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    collectedAt: '2026-09-24T00:00:00.000Z',
    source: 'rest',
    isFork: false,
    isArchived: false,
    ...over,
  };
}

const config: CategoryConfig = parseCategoryConfig({
  schemaVersion: 1,
  domain: 'ai',
  discovery: { minStars: 100, freshMinStars: 25, pushedWithinDays: 30, createdWithinDays: 14, perPage: 100, maxPagesPerQuery: 1, excludeForks: true, excludeArchived: true },
  categories: [
    { slug: 'ai-agents', name: 'AI Agents', description: 'd', searchQueries: ['topic:ai-agents stars:>{minStars} pushed:>{pushedSince}', 'topic:agents created:>{createdSince} stars:>{freshMinStars}'], keywords: ['ai agent'], topics: ['ai-agents'] },
    { slug: 'mcp', name: 'MCP', description: 'd', searchQueries: ['topic:mcp stars:>{minStars}'], keywords: ['model context protocol'], topics: ['mcp'] },
  ],
});

/** Search provider returning canned results per query substring. */
function fakeSearch(byQuery: Record<string, RepositorySnapshot[] | Error>): GitHubSearchProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async searchRepositories(query): Promise<SearchResult> {
      queries.push(query);
      const key = Object.keys(byQuery).find((k) => query.includes(k));
      const hit = key ? byQuery[key] : [];
      if (hit instanceof Error) throw hit;
      return { query, totalCount: hit!.length, incompleteResults: false, repositories: hit!, pages: 1, requests: 1, rateLimit: null };
    },
  };
}

const noRetry = { retry: { attempts: 1, baseDelayMs: 0, sleep: async () => undefined } };

describe('category configuration', () => {
  it('shipped ai.json has the 14 required categories', () => {
    const c = loadCategoryConfig(defaultConfigPath('ai'));
    expect(c.categories.map((x) => x.name)).toEqual([
      'AI Agents', 'LLM', 'RAG', 'MCP', 'AI Coding', 'Local AI', 'Multimodal', 'AI Infrastructure',
      'AI Developer Tools', 'Machine Learning', 'Generative AI', 'AI Music', 'AI Image', 'AI Video',
    ]);
    for (const cat of c.categories) {
      expect(cat.searchQueries.length).toBeGreaterThan(0);
      expect(cat.topics.length).toBeGreaterThan(0);
      expect(cat.keywords.length).toBeGreaterThan(0);
    }
  });

  it('shipped engineering.json has the 19 required categories', () => {
    const c = loadCategoryConfig(defaultConfigPath('engineering'));
    expect(c.categories.map((x) => x.slug)).toEqual([
      'java', 'spring-boot', 'microservices', 'kafka', 'kubernetes', 'docker', 'aws', 'cloud', 'postgresql', 'redis',
      'databases', 'devops', 'observability', 'security', 'distributed-systems', 'system-design', 'developer-tools',
      'infrastructure-as-code', 'testing',
    ]);
  });

  it('rejects invalid configuration with a path in the message', () => {
    const bad = (mutate: (c: any) => void) => {
      const c = JSON.parse(JSON.stringify(config));
      mutate(c);
      return () => parseCategoryConfig(c, 'x.json');
    };
    expect(bad((c) => (c.schemaVersion = 2))).toThrow(ConfigError);
    expect(bad((c) => (c.domain = 'cooking'))).toThrow(/domain/);
    expect(bad((c) => (c.categories = []))).toThrow(/non-empty/);
    expect(bad((c) => (c.categories[0].slug = 'Bad Slug'))).toThrow(/kebab/);
    expect(bad((c) => (c.categories[1].slug = 'ai-agents'))).toThrow(/duplicated/);
    expect(bad((c) => (c.categories[0].searchQueries = []))).toThrow(/must not be empty/);
    expect(bad((c) => (c.categories[0].searchQueries = ['topic:x {nope}']))).toThrow(/unknown placeholder/);
    expect(bad((c) => (c.discovery.perPage = 500))).toThrow(/<= 100/);
    expect(bad((c) => (c.discovery.minStars = -1))).toThrow(/minStars/);
  });

  it('a missing file is a ConfigError', () => {
    expect(() => loadCategoryConfig('config/categories/nope.json')).toThrow(ConfigError);
  });

  it('expandQuery fills placeholders from settings and the supplied clock', () => {
    const q = expandQuery('topic:x stars:>{minStars} pushed:>{pushedSince} created:>{createdSince} s:>{freshMinStars}', config.discovery, NOW);
    expect(q).toBe('topic:x stars:>100 pushed:>2026-08-25 created:>2026-09-10 s:>25');
    expect(() => expandQuery('{bogus}', config.discovery, NOW)).toThrow(ConfigError);
  });
});

describe('category matching (relevance, not classification)', () => {
  it('matches by topic (exact) or keyword (substring of name + description)', () => {
    const cats = config.categories;
    expect(matchingCategories(snap(1, { topics: ['mcp'], description: null }), cats)).toEqual(['mcp']);
    expect(matchingCategories(snap(2, { topics: [], description: 'Speaks the Model Context Protocol' }), cats)).toEqual(['mcp']);
    expect(matchingCategories(snap(3, { topics: [], description: 'a todo app' }), cats)).toEqual([]);
    expect(matchingCategories(snap(4, { topics: ['AI-Agents'] }), cats)).toContain('ai-agents');
  });
});

describe('SearchDiscoveryProvider', () => {
  it('deduplicates by repository id, even when the name changed between results', async () => {
    const renamed = snap(7, { name: 'new-name', fullName: 'o/new-name' });
    const search = fakeSearch({ 'topic:ai-agents': [snap(7), snap(8)], 'topic:agents': [renamed] });
    const res = await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW, categories: ['ai-agents'] });
    expect(res.candidates.map((c) => c.snapshot.repositoryId).sort()).toEqual(['7', '8']);
    const seven = res.candidates.find((c) => c.snapshot.repositoryId === '7')!;
    expect(seven.hits).toBe(2);
    expect(res.stats.rawResults).toBe(3);
    expect(res.stats.uniqueRepositories).toBe(2);
  });

  it('does not treat two different ids with the same full name as one repository', async () => {
    const search = fakeSearch({ 'topic:ai-agents': [snap(1, { fullName: 'o/same' }), snap(2, { fullName: 'o/same' })] });
    const res = await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW, categories: ['ai-agents'] });
    expect(res.candidates).toHaveLength(2);
  });

  it('expands queries with the given clock and honours maxQueriesPerCategory', async () => {
    const search = fakeSearch({});
    await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW, maxQueriesPerCategory: 1 });
    expect(search.queries).toEqual(['topic:ai-agents stars:>100 pushed:>2026-08-25', 'topic:mcp stars:>100']);
  });

  it('rejects forks, archived, tiny and irrelevant results and counts each reason', async () => {
    const search = fakeSearch({
      'topic:ai-agents': [
        snap(1),
        snap(2, { isFork: true }),
        snap(3, { isArchived: true }),
        snap(4, { stars: 3 }),
        snap(5, { topics: [], description: 'gardening tips' }),
      ],
    });
    const res = await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW, categories: ['ai-agents'] });
    expect(res.candidates.map((c) => c.snapshot.repositoryId)).toEqual(['1']);
    expect(res.stats.rejected).toEqual({ belowMinStars: 1, fork: 1, archived: 1, irrelevant: 1 });
    expect(res.stats.accepted).toBe(1);
    expect(res.candidates[0]!.categories).toEqual(['ai-agents']);
  });

  it('is deterministic: stars desc, then id asc', async () => {
    const search = fakeSearch({ 'topic:ai-agents': [snap(30, { stars: 10_000 }), snap(2, { stars: 500 }), snap(1, { stars: 500 })] });
    const res = await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW, categories: ['ai-agents'] });
    expect(res.candidates.map((c) => c.snapshot.repositoryId)).toEqual(['30', '1', '2']);
  });

  it('a failing query is recorded and the run continues', async () => {
    const search = fakeSearch({ 'topic:ai-agents': new NetworkError('boom'), 'topic:mcp': [snap(9, { topics: ['mcp'] })] });
    const res = await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW });
    expect(res.stats.failedQueries.length).toBeGreaterThan(0);
    expect(res.stats.failedQueries[0]!.error).toContain('NetworkError');
    expect(res.candidates.map((c) => c.snapshot.repositoryId)).toEqual(['9']);
  });

  it('rate limiting or bad credentials abort the whole run', async () => {
    const limited = fakeSearch({ 'topic:ai-agents': new RateLimitError('limit') });
    await expect(new SearchDiscoveryProvider(limited, noRetry).discover(config, { now: NOW })).rejects.toBeInstanceOf(RateLimitError);
    const auth = fakeSearch({ 'topic:ai-agents': new AuthenticationError('bad') });
    await expect(new SearchDiscoveryProvider(auth, noRetry).discover(config, { now: NOW })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('one repository matching several categories is tagged with all of them', async () => {
    const search = fakeSearch({ 'topic:ai-agents': [snap(1, { topics: ['ai-agents', 'mcp'] })] });
    const res = await new SearchDiscoveryProvider(search, noRetry).discover(config, { now: NOW });
    expect(res.candidates[0]!.categories).toEqual(['ai-agents', 'mcp']);
    expect(res.stats.perCategory.mcp!.accepted).toBe(1);
  });
});

describe('mergeCandidates (cross-domain)', () => {
  it('merges the same repository id found in two domains', () => {
    const a = { snapshot: snap(1, { stars: 10 }), domains: ['ai' as const], categories: ['llm'], hits: 2 };
    const b = { snapshot: snap(1, { stars: 20, collectedAt: '2026-09-25T00:00:00.000Z', name: 'renamed', fullName: 'o/renamed' }), domains: ['engineering' as const], categories: ['devops'], hits: 1 };
    const c = { snapshot: snap(2, { stars: 99 }), domains: ['ai' as const], categories: ['llm'], hits: 1 };
    const merged = mergeCandidates([[a, c], [b]]);
    expect(merged.map((m) => m.snapshot.repositoryId)).toEqual(['2', '1']);
    const one = merged.find((m) => m.snapshot.repositoryId === '1')!;
    expect(one.domains).toEqual(['ai', 'engineering']);
    expect(one.categories).toEqual(['devops', 'llm']);
    expect(one.hits).toBe(3);
    expect(one.snapshot.name).toBe('renamed'); // newest snapshot wins
  });

  it('does not mutate its inputs', () => {
    const a = { snapshot: snap(1), domains: ['ai' as const], categories: ['llm'], hits: 1 };
    const b = { snapshot: snap(1), domains: ['engineering' as const], categories: ['devops'], hits: 1 };
    mergeCandidates([[a], [b]]);
    expect(a.domains).toEqual(['ai']);
    expect(a.categories).toEqual(['llm']);
  });
});
