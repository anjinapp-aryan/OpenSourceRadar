import { describe, expect, it } from 'vitest';
import { GitHubApiError, InvalidResponseError, PaginationError } from '../src/github/errors';
import { GraphQLRepositoryProvider, buildRepositoriesQuery } from '../src/github/graphqlProvider';
import { parseLinkHeader } from '../src/github/pagination';
import { RestSearchProvider } from '../src/github/searchProvider';
import { clientWith, GQL_RATE, graphqlRepoNode, RL_HEADERS, restRepoItem } from './helpers';

describe('parseLinkHeader', () => {
  it('extracts page numbers', () => {
    const h =
      '<https://api.github.com/x?per_page=100&page=2>; rel="next", <https://api.github.com/x?per_page=100&page=24>; rel="last"';
    expect(parseLinkHeader(h)).toEqual({ next: 2, last: 24 });
  });
  it('handles null, garbage, and page-less urls', () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader('garbage')).toEqual({});
    expect(parseLinkHeader('<https://api.github.com/x>; rel="next"')).toEqual({});
  });
});

describe('GraphQL batching', () => {
  it('builds one aliased query with variables (no interpolation of names)', () => {
    const q = buildRepositoriesQuery(3, false);
    expect(q).toContain('r0: repository(owner: $o0, name: $n0)');
    expect(q).toContain('r2: repository(owner: $o2, name: $n2)');
    expect(q).toContain('rateLimit');
    expect(q).not.toContain('$since');
    expect(buildRepositoriesQuery(1, true)).toContain('history(since: $since)');
  });

  it('fetches a batch in one request and sums cost', async () => {
    const { client, calls } = clientWith([
      {
        body: {
          data: {
            r0: graphqlRepoNode(),
            r1: graphqlRepoNode({ databaseId: 2, name: 'react', owner: { login: 'facebook' } }),
            rateLimit: GQL_RATE,
          },
        },
      },
    ]);
    const res = await new GraphQLRepositoryProvider(client).fetchRepositories([
      { owner: 'vercel', name: 'next.js' },
      { owner: 'facebook', name: 'react' },
    ]);
    expect(calls).toHaveLength(1);
    expect(res.requests).toBe(1);
    expect(res.cost).toBe(1);
    expect(res.snapshots.map((s) => s.fullName)).toEqual(['vercel/next.js', 'facebook/react']);
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.variables).toMatchObject({ o0: 'vercel', n0: 'next.js', o1: 'facebook', n1: 'react' });
  });

  it('chunks by batchSize', async () => {
    const { client, calls } = clientWith((call) => {
      const vars = JSON.parse(String(call.init.body)).variables as Record<string, string>;
      const n = Object.keys(vars).filter((k) => k.startsWith('o')).length;
      const data: Record<string, unknown> = { rateLimit: GQL_RATE };
      for (let i = 0; i < n; i += 1) data[`r${i}`] = graphqlRepoNode({ databaseId: i + 1, name: vars[`n${i}`] });
      return { body: { data } };
    });
    const refs = Array.from({ length: 5 }, (_, i) => ({ owner: 'o', name: `r${i}` }));
    const res = await new GraphQLRepositoryProvider(client).fetchRepositories(refs, { batchSize: 2 });
    expect(calls).toHaveLength(3);
    expect(res.snapshots).toHaveLength(5);
    expect(res.cost).toBe(3);
  });

  it('splits a batch that keeps failing with 5xx and still returns every repository', async () => {
    const { client, calls } = clientWith((call) => {
      const vars = JSON.parse(String(call.init.body)).variables as Record<string, string>;
      const n = Object.keys(vars).filter((k) => k.startsWith('o')).length;
      if (n > 2) return { status: 504, body: { message: 'timeout' } };
      const data: Record<string, unknown> = { rateLimit: GQL_RATE };
      for (let i = 0; i < n; i += 1) data[`r${i}`] = graphqlRepoNode({ databaseId: i + 1, name: vars[`n${i}`] });
      return { body: { data } };
    });
    const refs = Array.from({ length: 5 }, (_, i) => ({ owner: 'o', name: `r${i}` }));
    const res = await new GraphQLRepositoryProvider(client, { sleep: async () => {} }).fetchRepositories(refs, { batchSize: 5 });
    expect(res.snapshots.map((x) => x.name)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(Math.max(...calls.map((c) => Object.keys(JSON.parse(String(c.init.body)).variables).filter((k) => k.startsWith('o')).length))).toBe(5);
  });

  it('reports NOT_FOUND aliases without failing the batch', async () => {
    const { client } = clientWith([
      {
        body: {
          data: { r0: graphqlRepoNode(), r1: null, rateLimit: GQL_RATE },
          errors: [{ type: 'NOT_FOUND', message: 'Could not resolve', path: ['r1'] }],
        },
      },
    ]);
    const res = await new GraphQLRepositoryProvider(client).fetchRepositories([
      { owner: 'vercel', name: 'next.js' },
      { owner: 'gone', name: 'gone' },
    ]);
    expect(res.snapshots).toHaveLength(1);
    expect(res.notFound).toEqual([{ owner: 'gone', name: 'gone' }]);
  });

  it('throws on non-NOT_FOUND partial errors', async () => {
    const { client } = clientWith([
      { body: { data: { r0: null, rateLimit: GQL_RATE }, errors: [{ type: 'FORBIDDEN', message: 'nope', path: ['r0'] }] } },
    ]);
    await expect(new GraphQLRepositoryProvider(client).fetchRepositories([{ owner: 'a', name: 'b' }])).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });

  it('throws InvalidResponseError when rateLimit is missing', async () => {
    const { client } = clientWith([{ body: { data: { r0: graphqlRepoNode() } } }]);
    await expect(new GraphQLRepositoryProvider(client).fetchRepositories([{ owner: 'a', name: 'b' }])).rejects.toBeInstanceOf(
      InvalidResponseError,
    );
  });
});

describe('search pagination', () => {
  const page = (n: number, total: number) => ({
    headers: RL_HEADERS,
    body: {
      total_count: total,
      incomplete_results: false,
      items: Array.from({ length: n }, (_, i) => restRepoItem({ id: i + 1, name: `r${i}` })),
    },
  });

  it('walks pages until short page', async () => {
    const { client, calls } = clientWith([page(2, 3), page(1, 3)]);
    const res = await new RestSearchProvider(client, 0).searchRepositories('topic:ai', { perPage: 2, maxPages: 5 });
    expect(res.pages).toBe(2);
    expect(res.requests).toBe(2);
    expect(res.repositories).toHaveLength(3);
    expect(res.totalCount).toBe(3);
    expect(calls[1]!.url).toContain('page=2');
  });

  it('respects maxPages', async () => {
    const { client } = clientWith([page(2, 100), page(2, 100)]);
    const res = await new RestSearchProvider(client, 0).searchRepositories('q', { perPage: 2, maxPages: 2 });
    expect(res.pages).toBe(2);
    expect(res.repositories).toHaveLength(4);
  });

  it('missing items on a later page -> PaginationError', async () => {
    const { client } = clientWith([page(2, 10), { body: { total_count: 10 } }]);
    await expect(new RestSearchProvider(client, 0).searchRepositories('q', { perPage: 2, maxPages: 3 })).rejects.toBeInstanceOf(
      PaginationError,
    );
  });

  it('missing total_count -> InvalidResponseError', async () => {
    const { client } = clientWith([{ body: { items: [] } }]);
    await expect(new RestSearchProvider(client, 0).searchRepositories('q')).rejects.toBeInstanceOf(InvalidResponseError);
  });
});
