import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  GitHubApiError,
  InvalidResponseError,
  NetworkError,
  RateLimitError,
} from '../src/github/errors';
import { GitHubHttpClient } from '../src/github/http';
import { createLogger } from '../src/github/logger';
import { clientWith, RL_HEADERS, TEST_TOKEN } from './helpers';

const ctx = { operation: 'test.op', repository: 'a/b' };

describe('GitHubHttpClient', () => {
  it('sends bearer auth, counts requests, returns parsed rate limit', async () => {
    const { client, calls } = clientWith([{ body: { ok: true }, headers: RL_HEADERS }]);
    const res = await client.rest<{ ok: boolean }>('/rate_limit', ctx);
    expect(res.data.ok).toBe(true);
    expect(res.rateLimit?.remaining).toBe(4990);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(client.stats.rest).toBe(1);
  });

  it('constructor rejects empty token but allows explicit anonymous', () => {
    expect(() => new GitHubHttpClient({ token: '' })).toThrow(AuthenticationError);
    expect(new GitHubHttpClient({ token: null }).authenticated).toBe(false);
  });

  it('401 -> AuthenticationError without leaking the token', async () => {
    const { client } = clientWith([{ status: 401, body: { message: 'Bad credentials' } }]);
    const err = await client.rest('/user', ctx).catch((e) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(String(err.message)).not.toContain(TEST_TOKEN);
  });

  it('403 with remaining 0 -> RateLimitError with resetAt', async () => {
    const { client } = clientWith([
      { status: 403, body: { message: 'API rate limit exceeded' }, headers: { ...RL_HEADERS, 'x-ratelimit-remaining': '0' } },
    ]);
    const err = await client.rest('/x', ctx).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resetAt).toEqual(new Date(1790000000 * 1000));
  });

  it('403 secondary limit with retry-after -> RateLimitError', async () => {
    const { client } = clientWith([
      { status: 403, body: { message: 'You have exceeded a secondary rate limit' }, headers: { 'retry-after': '60' } },
    ]);
    const err = await client.rest('/x', ctx).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterSeconds).toBe(60);
  });

  it('429 -> RateLimitError', async () => {
    const { client } = clientWith([{ status: 429, body: { message: 'slow down' } }]);
    await expect(client.rest('/x', ctx)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('403 without rate-limit signals -> GitHubApiError', async () => {
    const { client } = clientWith([{ status: 403, body: { message: 'Resource not accessible' }, headers: RL_HEADERS }]);
    await expect(client.rest('/x', ctx)).rejects.toBeInstanceOf(GitHubApiError);
  });

  it('500 -> GitHubApiError with status', async () => {
    const { client } = clientWith([{ status: 500, body: { message: 'boom' } }]);
    const err = await client.rest('/x', ctx).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(500);
  });

  it('fetch failure -> NetworkError', async () => {
    const { client } = clientWith(() => new TypeError('fetch failed'));
    await expect(client.rest('/x', ctx)).rejects.toBeInstanceOf(NetworkError);
  });

  it('200 with non-JSON body -> InvalidResponseError', async () => {
    const { client } = clientWith([{ rawBody: '<html>nope</html>' }]);
    await expect(client.rest('/x', ctx)).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('GraphQL: errors + no data -> GitHubApiError', async () => {
    const { client } = clientWith([{ body: { errors: [{ message: 'Parse error' }] } }]);
    await expect(client.graphql('query{x}', {}, ctx)).rejects.toBeInstanceOf(GitHubApiError);
  });

  it('GraphQL: RATE_LIMITED error -> RateLimitError', async () => {
    const { client } = clientWith([{ body: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } }]);
    await expect(client.graphql('query{x}', {}, ctx)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('GraphQL: partial errors are returned alongside data', async () => {
    const { client } = clientWith([{ body: { data: { r0: null }, errors: [{ type: 'NOT_FOUND', message: 'x', path: ['r0'] }] } }]);
    const res = await client.graphql<{ r0: null }>('query{x}', {}, ctx);
    expect(res.errors).toHaveLength(1);
    expect(client.stats.graphql).toBe(1);
  });

  it('logs operation/requests/duration and never the token', async () => {
    const lines: string[] = [];
    const logger = createLogger({ secrets: [TEST_TOKEN], sink: (l) => lines.push(l) });
    const { impl } = clientWith([{ status: 401, body: { message: `Bad credentials for ${TEST_TOKEN}` } }]);
    const client = new GitHubHttpClient({ token: TEST_TOKEN, fetchImpl: impl, logger });
    await client.rest('/x', ctx).catch(() => undefined);
    const joined = lines.join('\n');
    expect(joined).not.toContain(TEST_TOKEN);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ operation: 'test.op', repository: 'a/b', requests: 1 });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.error).toContain('Bad credentials');
  });
});
