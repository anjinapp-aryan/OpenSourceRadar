import { GraphQLRepositoryProvider } from '../../src/github/graphqlProvider';
import { RATE_LIMIT_SELECTION, parseGraphQLRateLimit } from '../../src/github/rateLimit';
import { RestSearchProvider } from '../../src/github/searchProvider';
import type { RepositoryRef } from '../../src/model/repositorySnapshot';
import { isoDaysAgo, makeClient, Recorder } from './common';

const BATCH_SIZES = [1, 10, 25, 50, 100];

async function main() {
  const { client } = makeClient();
  const rec = new Recorder('graphql', client);
  const provider = new GraphQLRepositoryProvider(client);

  // 1. GraphQL authentication + cost of the smallest possible query.
  await rec.check('graphql authentication (rateLimit-only query)', async () => {
    const { data } = await client.graphql<{ rateLimit: unknown }>(`query { ${RATE_LIMIT_SELECTION} }`, {}, { operation: 'smoke.graphql.auth' });
    const cost = parseGraphQLRateLimit(data?.rateLimit);
    rec.measurements.authQuery = { cost: cost.cost, limit: cost.limit, remaining: cost.remaining, resetAt: cost.resetAt.toISOString() };
    return rec.measurements.authQuery;
  });

  // Sample of 100 well-known repos (1 REST search request).
  let refs: RepositoryRef[] = [];
  await rec.check('sample 100 repositories via REST search (stars:>50000)', async () => {
    const search = new RestSearchProvider(client);
    const res = await search.searchRepositories('stars:>50000', { sort: 'stars', perPage: 100, maxPages: 1 });
    refs = res.repositories.map((r) => ({ owner: r.owner, name: r.name }));
    return { retrieved: refs.length, totalCount: res.totalCount };
  });
  if (refs.length === 0) {
    rec.finish();
    return;
  }

  // 2. Batching: repeat with growing batch sizes; every run is ONE GraphQL request.
  const batches: unknown[] = [];
  for (const n of BATCH_SIZES) {
    if (refs.length < n) continue;
    await rec.check(`batch of ${n} repositories in a single request`, async () => {
      const t0 = Date.now();
      const res = await provider.fetchRepositories(refs.slice(0, n), { batchSize: n });
      const durationMs = Date.now() - t0;
      const s = res.snapshots;
      const row = {
        batchSize: n,
        requests: res.requests,
        cost: res.cost,
        remainingAfter: res.rateLimit?.remaining ?? null,
        durationMs,
        returned: s.length,
        notFound: res.notFound.length,
        withLanguage: s.filter((x) => x.language).length,
        withTopics: s.filter((x) => x.topics.length > 0).length,
        withLicense: s.filter((x) => x.license).length,
        withLastCommit: s.filter((x) => x.lastCommitAt).length,
        withDescription: s.filter((x) => x.description).length,
      };
      batches.push(row);
      if (res.requests !== 1) throw new Error(`expected 1 request for batch ${n}, got ${res.requests}`);
      if (s.length + res.notFound.length !== n) throw new Error(`batch ${n}: ${s.length} returned + ${res.notFound.length} notFound`);
      return row;
    });
  }
  rec.measurements.batches = batches;

  // 3. Optional commit-activity field: cost with vs without.
  const commitRows: unknown[] = [];
  for (const n of [50, 100]) {
    if (refs.length < n) continue;
    await rec.check(`batch of ${n} with commit count since 30d`, async () => {
      const res = await provider.fetchRepositories(refs.slice(0, n), { batchSize: n, commitsSince: new Date(isoDaysAgo(30)) });
      const row = {
        batchSize: n,
        requests: res.requests,
        cost: res.cost,
        withCommitCount: res.snapshots.filter((x) => typeof x.commitsInWindow === 'number').length,
        sampleCommitsInWindow: res.snapshots.slice(0, 3).map((x) => [x.fullName, x.commitsInWindow]),
      };
      commitRows.push(row);
      return row;
    });
  }
  rec.measurements.commitActivity = commitRows;

  // 4. Response shape of one normalized snapshot (public data).
  await rec.check('normalized snapshot sample', async () => {
    const res = await provider.fetchRepositories(refs.slice(0, 1));
    rec.measurements.sampleSnapshot = res.snapshots[0];
    return res.snapshots[0]?.fullName;
  });

  // 5. NOT_FOUND handling in a batch.
  await rec.check('unknown repository reported in notFound, batch still succeeds', async () => {
    const res = await provider.fetchRepositories([refs[0]!, { owner: 'this-owner-should-not-exist-xyz', name: 'nope-nope-nope' }]);
    if (res.notFound.length !== 1 || res.snapshots.length !== 1) throw new Error(`snapshots=${res.snapshots.length} notFound=${res.notFound.length}`);
    return { cost: res.cost };
  });

  rec.finish();
}

main().catch((e) => {
  console.error('smoke:graphql crashed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
