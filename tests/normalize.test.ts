import { describe, expect, it } from 'vitest';
import { InvalidResponseError } from '../src/github/errors';
import { normalizeGraphQLRepository, normalizeRestRepository } from '../src/github/normalize';
import { graphqlRepoNode, restRepoItem } from './helpers';

const NOW = '2026-09-24T00:00:00.000Z';

describe('repository normalization (GraphQL)', () => {
  it('maps every required field', () => {
    const s = normalizeGraphQLRepository(graphqlRepoNode(), NOW);
    expect(s).toMatchObject({
      repositoryId: '123',
      owner: 'vercel',
      name: 'next.js',
      fullName: 'vercel/next.js',
      url: 'https://github.com/vercel/next.js',
      description: 'The React Framework',
      stars: 100,
      forks: 10,
      openIssues: 5,
      language: 'JavaScript',
      topics: ['react', 'nextjs'],
      license: 'MIT',
      collectedAt: NOW,
      source: 'graphql',
      defaultBranch: 'canary',
      lastCommitAt: '2026-09-02T01:00:00Z',
    });
  });
  it('handles null language/license/description/branch', () => {
    const s = normalizeGraphQLRepository(
      graphqlRepoNode({ primaryLanguage: null, licenseInfo: null, description: null, defaultBranchRef: null }),
      NOW,
    );
    expect(s.language).toBeNull();
    expect(s.license).toBeNull();
    expect(s.description).toBeNull();
    expect(s.defaultBranch).toBeNull();
  });
  it('captures commitsInWindow when history present', () => {
    const s = normalizeGraphQLRepository(
      graphqlRepoNode({ defaultBranchRef: { name: 'main', target: { committedDate: 'x', history: { totalCount: 42 } } } }),
      NOW,
    );
    expect(s.commitsInWindow).toBe(42);
  });
  it.each([
    ['not an object', 'nope'],
    ['missing owner', graphqlRepoNode({ owner: null })],
    ['missing stars', graphqlRepoNode({ stargazerCount: undefined })],
    ['stars as string', graphqlRepoNode({ stargazerCount: '5' })],
    ['missing issues', graphqlRepoNode({ issues: null })],
    ['missing databaseId', graphqlRepoNode({ databaseId: undefined })],
  ])('rejects invalid node: %s', (_label, node) => {
    expect(() => normalizeGraphQLRepository(node, NOW)).toThrow(InvalidResponseError);
  });
});

describe('repository normalization (REST)', () => {
  it('maps REST item; id matches GraphQL databaseId as string', () => {
    const s = normalizeRestRepository(restRepoItem(), NOW);
    expect(s).toMatchObject({
      repositoryId: '456',
      fullName: 'acme/demo',
      stars: 7,
      openIssues: 2,
      language: 'Go',
      topics: ['ai', 'llm'],
      license: 'Apache-2.0',
      source: 'rest',
    });
  });
  it('tolerates missing topics/license', () => {
    const s = normalizeRestRepository(restRepoItem({ topics: undefined, license: null }), NOW);
    expect(s.topics).toEqual([]);
    expect(s.license).toBeNull();
  });
  it('rejects invalid item', () => {
    expect(() => normalizeRestRepository(restRepoItem({ stargazers_count: null }), NOW)).toThrow(InvalidResponseError);
    expect(() => normalizeRestRepository(null, NOW)).toThrow(InvalidResponseError);
  });
});
