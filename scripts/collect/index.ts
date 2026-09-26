import { loadToken } from '../../src/github/config';
import { AuthenticationError } from '../../src/github/errors';
import { GraphQLRepositoryProvider } from '../../src/github/graphqlProvider';
import { GitHubHttpClient } from '../../src/github/http';
import { createLogger } from '../../src/github/logger';
import { RateGuard } from '../../src/github/rateGuard';
import { RestSearchProvider } from '../../src/github/searchProvider';
import { CachingStarHistoryProvider, JsonFileStarHistoryStore } from '../../src/github/starHistoryCache';
import { RestStarHistoryProvider } from '../../src/github/starHistoryProvider';
import { runCollection, CollectionAbortedError } from '../../src/collect/pipeline';
import { defaultConfigPath, loadCategoryConfig, type Domain } from '../../src/discovery/config';
import { SearchDiscoveryProvider } from '../../src/discovery/discoveryProvider';
import { runDueCli } from './due';

const USAGE = `Usage: tsx scripts/collect/index.ts [options]
  --domain ai|engineering|all   default all
  --out <path>                  default data/repositories.json
  --limit <n>                   keep the top n candidates by stars
  --concurrency <n>             star-history requests in flight, default 4
  --history-pages <n|all>       30 weeks per page, default 1
  --categories a,b,c            only these category slugs
  --max-queries <n>             cap search queries per category
  --cache <path>                persistent star-history cache file (optional)
  --reserve <n>                 keep this many requests of every bucket unspent (default core/graphql 5, search 1)
  --max-failure-ratio <x>       default 0.05
  --candidates-out <path>       also write all discovered candidates (default: none)
  --dry-run                     discover only (still writes --candidates-out)
  --due                         due mode: collect star history only for repositories the tracking schedule says are due
                                (uses --tracked, --candidates, --out as the merged repository dataset, --domain, --limit,
                                 --concurrency, --cache, --history-pages, --chunk-size)
  --force                       allow replacing a much larger dataset
Token: GITHUB_TOKEN / GH_TOKEN. Without one the run is anonymous (60 core requests/hour, no GraphQL).`;

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}\n${USAGE}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function intArg(v: string | true | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v === true || !Number.isInteger(n) || n < 0) throw new Error(`--${name} needs a non-negative integer`);
  return n;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.due === true) return runDueCli(args);

  let token: string | null = null;
  try {
    token = loadToken();
  } catch (e) {
    if (!(e instanceof AuthenticationError)) throw e;
    console.error('No token found: running anonymously (60 core requests/hour, search 10/min, no GraphQL metadata).');
  }

  const logger = createLogger({ secrets: token ? [token] : [] });
  const reserve = intArg(args.reserve, 'reserve');
  // Wait for buckets that refill within a minute (search); anything longer (core: up to an hour) fails fast.
  const guard = new RateGuard({ ...(reserve !== undefined ? { reserve } : {}), maxWaitMs: 65_000 });
  const client = new GitHubHttpClient({ token, logger, guard });

  const domainArg = (args.domain as string | undefined) ?? 'all';
  const domains: Domain[] = domainArg === 'all' ? ['ai', 'engineering'] : [domainArg as Domain];
  if (!domains.every((d) => d === 'ai' || d === 'engineering')) throw new Error(`--domain must be ai, engineering or all\n${USAGE}`);
  const configs = domains.map((d) => loadCategoryConfig(defaultConfigPath(d)));

  const store = typeof args.cache === 'string' ? await JsonFileStarHistoryStore.open(args.cache) : undefined;
  const starHistory = new CachingStarHistoryProvider(new RestStarHistoryProvider(client, { logger }), { store });
  const search = new RestSearchProvider(client, token ? 2100 : 6500);
  const discovery = new SearchDiscoveryProvider(search, { logger });
  const graphql = token ? new GraphQLRepositoryProvider(client) : undefined;

  const historyPagesArg = args['history-pages'];
  const historyPages = historyPagesArg === 'all' ? 'all' : intArg(historyPagesArg, 'history-pages') ?? 1;

  try {
    const report = await runCollection(
      { discovery, graphql, starHistory, logger },
      {
        configs,
        outPath: (args.out as string | undefined) ?? 'data/repositories.json',
        limit: intArg(args.limit, 'limit'),
        concurrency: intArg(args.concurrency, 'concurrency') ?? 4,
        historyPages,
        categories: typeof args.categories === 'string' ? args.categories.split(',') : undefined,
        maxQueriesPerCategory: intArg(args['max-queries'], 'max-queries'),
        maxFailureRatio: args['max-failure-ratio'] ? Number(args['max-failure-ratio']) : undefined,
        candidatesOutPath: typeof args['candidates-out'] === 'string' ? args['candidates-out'] : undefined,
        dryRun: args['dry-run'] === true,
        force: args.force === true,
      },
    );
    await store?.flush();
    console.log(
      JSON.stringify(
        {
          written: report.written,
          out: report.outPath,
          candidates: report.candidates,
          selected: report.selected,
          repositories: report.dataset?.repositories.length ?? 0,
          failures: report.failures,
          durationMs: report.durationMs,
          requests: client.stats,
          cache: starHistory.stats,
          discovery: report.discovery.map((d) => ({ domain: d.domain, queries: d.queries, requests: d.requests, unique: d.uniqueRepositories, accepted: d.accepted, rejected: d.rejected, failedQueries: d.failedQueries.length })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await store?.flush().catch(() => undefined);
    if (error instanceof CollectionAbortedError) {
      console.error(`ABORTED: ${error.message}. Existing dataset left untouched. Requests: ${JSON.stringify(client.stats)}`);
      process.exit(3);
    }
    throw error;
  }
}

main().catch((e) => {
  console.error('collect failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
