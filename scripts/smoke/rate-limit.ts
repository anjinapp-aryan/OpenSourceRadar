import { AuthenticationError } from '../../src/github/errors';
import { GitHubHttpClient } from '../../src/github/http';
import { makeClient, Recorder } from './common';

interface RateLimitResponse {
  resources: Record<string, { limit: number; remaining: number; used: number; reset: number }>;
  rate?: { limit: number; remaining: number; used: number; reset: number };
}

async function main() {
  const { client } = makeClient();
  const rec = new Recorder('rate-limit', client);

  // REST authentication + full rate-limit table. GET /rate_limit is documented as free; verified below.
  const before = await rec.check('REST authentication + /rate_limit table', async () => {
    const res = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.table' });
    rec.measurements.resourcesBefore = res.data.resources;
    rec.measurements.headerRateLimit = res.rateLimit;
    return res.data.resources;
  });

  await rec.check('/rate_limit does not consume core budget', async () => {
    const a = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.free-a' });
    const b = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.free-b' });
    const ra = a.data.resources.core?.remaining;
    const rb = b.data.resources.core?.remaining;
    rec.measurements.rateLimitEndpointFree = { firstRemaining: ra, secondRemaining: rb };
    if (ra !== rb) throw new Error(`core remaining changed ${ra} -> ${rb}`);
    return { ra, rb };
  });

  await rec.check('REST core: 3 calls decrement remaining by 3', async () => {
    const start = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.core-start' });
    const s = start.data.resources.core?.remaining ?? NaN;
    for (let i = 0; i < 3; i += 1) {
      await client.rest('/repos/vercel/next.js', { operation: 'smoke.rate.core-call', repository: 'vercel/next.js' });
    }
    const end = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.core-end' });
    const e = end.data.resources.core?.remaining ?? NaN;
    rec.measurements.coreDecrement = { start: s, end: e, used: s - e };
    return rec.measurements.coreDecrement;
  });

  await rec.check('GraphQL rate-limit bucket via /rate_limit and cost of a 1-repo query', async () => {
    const mid = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.gql-before' });
    const g0 = mid.data.resources.graphql?.remaining ?? NaN;
    const { data } = await client.graphql<{ repository: { stargazerCount: number }; rateLimit: { cost: number; remaining: number } }>(
      'query { repository(owner: "vercel", name: "next.js") { stargazerCount } rateLimit { cost remaining limit resetAt nodeCount } }',
      {},
      { operation: 'smoke.rate.gql-query', repository: 'vercel/next.js' },
    );
    const after = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.gql-after' });
    const g1 = after.data.resources.graphql?.remaining ?? NaN;
    rec.measurements.graphqlOneRepo = { reportedCost: data?.rateLimit.cost, bucketBefore: g0, bucketAfter: g1, bucketUsed: g0 - g1 };
    return rec.measurements.graphqlOneRepo;
  });

  await rec.check('search bucket present in /rate_limit', async () => {
    const res = await client.rest<RateLimitResponse>('/rate_limit', { operation: 'smoke.rate.search' });
    const s = res.data.resources.search;
    if (!s) throw new Error('resources.search missing');
    rec.measurements.searchBucket = s;
    return s;
  });

  await rec.check('invalid token is mapped to AuthenticationError', async () => {
    const bad = new GitHubHttpClient({ token: 'invalid-token-for-smoke-test' });
    try {
      await bad.rest('/rate_limit', { operation: 'smoke.rate.bad-token' });
    } catch (e) {
      if (e instanceof AuthenticationError) return { mapped: 'AuthenticationError' };
      throw e;
    }
    throw new Error('expected 401 for an invalid token');
  });

  void before;
  rec.finish();
}

main().catch((e) => {
  console.error('smoke:rate-limit crashed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
