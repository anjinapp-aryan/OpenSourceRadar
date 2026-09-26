import { GitHubHttpClient } from '../src/github/http';

export interface FakeReply {
  status?: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** fetch stub: replies are consumed in order, or produced by a function. */
export function fakeFetch(replies: FakeReply[] | ((call: RecordedCall, n: number) => FakeReply | Error)) {
  const calls: RecordedCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const reply = typeof replies === 'function' ? replies(call, calls.length - 1) : replies[calls.length - 1];
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error('fakeFetch: no reply queued for call ' + calls.length);
    const text = reply.rawBody ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    return new Response(text, { status: reply.status ?? 200, headers: reply.headers ?? {} });
  }) as typeof fetch;
  return { impl, calls };
}

export const RL_HEADERS = {
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4990',
  'x-ratelimit-used': '10',
  'x-ratelimit-reset': '1790000000',
  'x-ratelimit-resource': 'core',
};

export const TEST_TOKEN = 'ghp_TESTTOKENTESTTOKENTESTTOKEN123456';

export function clientWith(replies: Parameters<typeof fakeFetch>[0], token = TEST_TOKEN) {
  const f = fakeFetch(replies);
  return { client: new GitHubHttpClient({ token, fetchImpl: f.impl }), ...f };
}

export function graphqlRepoNode(over: Record<string, unknown> = {}) {
  return {
    databaseId: 123,
    name: 'next.js',
    url: 'https://github.com/vercel/next.js',
    description: 'The React Framework',
    stargazerCount: 100,
    forkCount: 10,
    issues: { totalCount: 5 },
    primaryLanguage: { name: 'JavaScript' },
    repositoryTopics: { nodes: [{ topic: { name: 'react' } }, { topic: { name: 'nextjs' } }] },
    licenseInfo: { spdxId: 'MIT' },
    createdAt: '2016-10-05T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    pushedAt: '2026-09-02T00:00:00Z',
    isArchived: false,
    isFork: false,
    owner: { login: 'vercel' },
    defaultBranchRef: { name: 'canary', target: { committedDate: '2026-09-02T01:00:00Z' } },
    ...over,
  };
}

export const GQL_RATE = { cost: 1, limit: 5000, remaining: 4999, resetAt: '2026-09-24T12:00:00Z', nodeCount: 3 };

export function restRepoItem(over: Record<string, unknown> = {}) {
  return {
    id: 456,
    name: 'demo',
    owner: { login: 'acme' },
    html_url: 'https://github.com/acme/demo',
    description: null,
    stargazers_count: 7,
    forks_count: 1,
    open_issues_count: 2,
    language: 'Go',
    topics: ['ai', 'llm'],
    license: { spdx_id: 'Apache-2.0' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    pushed_at: '2026-02-01T00:00:00Z',
    default_branch: 'main',
    archived: false,
    fork: false,
    ...over,
  };
}
