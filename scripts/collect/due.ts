import { readFileSync } from 'node:fs';
import type { CandidateDataset } from '../../src/collect/candidates';
import type { Dataset } from '../../src/collect/dataset';
import { runDueCollection, type DueDomain } from '../../src/collect/dueCollector';
import { loadToken } from '../../src/github/config';
import { AuthenticationError } from '../../src/github/errors';
import { GraphQLRepositoryProvider } from '../../src/github/graphqlProvider';
import { GitHubHttpClient } from '../../src/github/http';
import { createLogger } from '../../src/github/logger';
import { RateGuard } from '../../src/github/rateGuard';
import { CachingStarHistoryProvider, JsonFileStarHistoryStore } from '../../src/github/starHistoryCache';
import { RestStarHistoryProvider } from '../../src/github/starHistoryProvider';
import { readJsonIfExists } from '../../src/io/atomicWrite';
import { loadTrackingPolicy } from '../../src/tracking/config';
import type { TrackedDataset } from '../../src/tracking/datasets';

function intArg(v: string | true | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v === true || !Number.isInteger(n) || n < 0) throw new Error(`--${name} needs a non-negative integer`);
  return n;
}

/**
 * `npm run collect -- --due`: collect star history only for repositories whose tracking schedule says they are due,
 * merge into the repository dataset (--out), and print measured API usage. Exit code 3 if a rate limit stopped the run
 * (work done so far is saved; re-run to continue).
 */
export async function runDueCli(args: Record<string, string | true>): Promise<void> {
  const str = (k: string, d?: string) => (typeof args[k] === 'string' ? (args[k] as string) : d);
  let token: string | null = null;
  try {
    token = loadToken();
  } catch (e) {
    if (!(e instanceof AuthenticationError)) throw e;
    console.error('No token found: running anonymously (60 core requests/hour; metadata comes from the candidate dataset, no GraphQL).');
  }
  const logger = createLogger({ secrets: token ? [token] : [] });
  const reserve = intArg(args.reserve, 'reserve');
  const guard = new RateGuard({ ...(reserve !== undefined ? { reserve } : {}), maxWaitMs: 65_000 });
  const client = new GitHubHttpClient({ token, logger, guard });

  const outPath = str('out', 'data/repositories.json') as string;
  const tracked = JSON.parse(readFileSync(str('tracked', 'data/tracked/tracked.json') as string, 'utf8')) as TrackedDataset;
  const candidates = JSON.parse(readFileSync(str('candidates', 'data/candidates/candidates.json') as string, 'utf8')) as CandidateDataset;
  const existing = await readJsonIfExists<Dataset>(str('existing', outPath) as string);
  const policy = loadTrackingPolicy(str('policy', 'config/tracking.json'));

  const domain = (str('domain', 'all') as string) as DueDomain;
  if (!['ai', 'engineering', 'all'].includes(domain)) throw new Error('--domain must be ai, engineering or all');
  const store = typeof args.cache === 'string' ? await JsonFileStarHistoryStore.open(args.cache) : undefined;
  const provider = new RestStarHistoryProvider(client, { logger });
  const starHistory = new CachingStarHistoryProvider(provider, { store });
  const graphql = token ? new GraphQLRepositoryProvider(client) : undefined;
  const historyPagesArg = args['history-pages'];
  const now = str('now') ? new Date(str('now') as string) : undefined;

  const report = await runDueCollection(
    { graphql, starHistory, logger, now: now ? () => now : undefined },
    {
      tracked,
      candidates,
      existing,
      policy,
      outPath,
      domain,
      limit: intArg(args.limit, 'limit'),
      concurrency: intArg(args.concurrency, 'concurrency') ?? 4,
      historyPages: historyPagesArg === 'all' ? 'all' : intArg(historyPagesArg, 'history-pages') ?? 1,
      chunkSize: intArg(args['chunk-size'], 'chunk-size'),
    },
  ).catch(async (e) => {
    await store?.flush().catch(() => undefined);
    throw e;
  });
  await store?.flush();

  const core = guard.get('core');
  console.log(
    JSON.stringify(
      {
        mode: 'due',
        authenticated: token !== null,
        out: outPath,
        report,
        usage: {
          restRequests: client.stats.rest,
          graphqlRequests: client.stats.graphql,
          starHistoryPageRequests: provider.stats.pageRequests,
          starHistoryRetries: provider.stats.retries,
          starHistoryBytes: provider.stats.bytes,
          cache: starHistory.stats,
          coreRateLimit: core ? { remaining: core.remaining, limit: core.limit, resetAt: core.resetAt?.toISOString() } : null,
        },
      },
      null,
      2,
    ),
  );
  if (report.stoppedBy) {
    console.error(`STOPPED by ${report.stoppedBy}. Collected work is saved to ${outPath}; re-run to continue.`);
    process.exit(3);
  }
}
