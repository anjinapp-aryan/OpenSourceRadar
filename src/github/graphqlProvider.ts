import { GitHubApiError, InvalidResponseError, NetworkError } from './errors';
import { withRetry, type RetryOptions } from '../util/retry';
import type { GitHubHttpClient } from './http';
import { normalizeGraphQLRepository } from './normalize';
import { graphqlCostToInfo, parseGraphQLRateLimit, RATE_LIMIT_SELECTION, type RateLimitInfo } from './rateLimit';
import type { FetchRepositoriesOptions, FetchRepositoriesResult, GitHubGraphQLProvider } from './providers';
import { refToString, type RepositoryRef } from '../model/repositorySnapshot';

const BASE_FIELDS = `
  databaseId name url description
  stargazerCount forkCount
  issues(states: OPEN) { totalCount }
  primaryLanguage { name }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  licenseInfo { spdxId }
  createdAt updatedAt pushedAt isArchived isFork
  owner { login }`;

/** Build the aliased batch query. Owner/name go through variables, never string-interpolated. */
export function buildRepositoriesQuery(count: number, withCommits: boolean): string {
  const branch = withCommits
    ? 'defaultBranchRef { name target { ... on Commit { committedDate history(since: $since) { totalCount } } } }'
    : 'defaultBranchRef { name target { ... on Commit { committedDate } } }';
  const vars = Array.from({ length: count }, (_, i) => `$o${i}: String!, $n${i}: String!`);
  if (withCommits) vars.push('$since: GitTimestamp!');
  const body = Array.from(
    { length: count },
    (_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) { ${BASE_FIELDS} ${branch} }`,
  );
  return `query(${vars.join(', ')}) {\n${body.join('\n')}\n${RATE_LIMIT_SELECTION}\n}`;
}

export class GraphQLRepositoryProvider implements GitHubGraphQLProvider {
  constructor(
    private readonly http: GitHubHttpClient,
    private readonly retry: RetryOptions = {},
  ) {}

  async fetchRepositories(
    refs: readonly RepositoryRef[],
    options: FetchRepositoriesOptions = {},
  ): Promise<FetchRepositoriesResult> {
    const batchSize = Math.max(1, Math.min(options.batchSize ?? 50, 100));
    const result: FetchRepositoriesResult = { snapshots: [], notFound: [], requests: 0, cost: 0, rateLimit: null };

    for (let start = 0; start < refs.length; start += batchSize) {
      await this.fetchChunk(refs.slice(start, start + batchSize), options, result);
    }
    return result;
  }

  /**
   * One GraphQL request for `chunk`. Transient failures (5xx, network) are retried; if a batch still fails with a
   * server error it is split in half and each half is retried, down to single repositories, so one heavy repository
   * cannot take 49 others down with it. Batches are never made LARGER than the configured size (100 failed with 504).
   */
  private async fetchChunk(chunk: readonly RepositoryRef[], options: FetchRepositoriesOptions, result: FetchRepositoriesResult): Promise<void> {
    const collectedAt = (options.now ?? new Date()).toISOString();
    const variables: Record<string, unknown> = {};
    chunk.forEach((ref, i) => {
      variables[`o${i}`] = ref.owner;
      variables[`n${i}`] = ref.name;
    });
    if (options.commitsSince) variables.since = options.commitsSince.toISOString();

    let response;
    try {
      response = await withRetry(
        () =>
          this.http.graphql<Record<string, unknown>>(buildRepositoriesQuery(chunk.length, Boolean(options.commitsSince)), variables, {
            operation: 'graphql.fetchRepositories',
            repository: `${chunk.length} repos (${refToString(chunk[0]!)}…)`,
          }),
        { attempts: 2, baseDelayMs: 1000, ...this.retry, operation: 'graphql.retry' },
      );
    } catch (error) {
      const serverSide = (error instanceof GitHubApiError && error.status !== null && error.status >= 500) || error instanceof NetworkError;
      if (serverSide && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        await this.fetchChunk(chunk.slice(0, mid), options, result);
        await this.fetchChunk(chunk.slice(mid), options, result);
        return;
      }
      throw error;
    }
    const { data, errors } = response;
    if (!data) throw new InvalidResponseError('graphql.fetchRepositories: response has no data');
    result.requests += 1;

    // Partial errors are only acceptable when they are NOT_FOUND for a single alias.
    const notFoundAliases = new Set<string>();
    for (const err of errors) {
      const alias = err.path?.[0];
      if (err.type === 'NOT_FOUND' && typeof alias === 'string') notFoundAliases.add(alias);
      else throw new GitHubApiError(`graphql.fetchRepositories: ${err.message}`, { graphqlErrors: errors });
    }

    const cost = parseGraphQLRateLimit(data.rateLimit);
    result.cost += cost.cost;
    result.rateLimit = graphqlCostToInfo(cost);

    chunk.forEach((ref, i) => {
      const alias = `r${i}`;
      const node = data[alias];
      if (node === null || node === undefined || notFoundAliases.has(alias)) {
        result.notFound.push(ref);
        return;
      }
      result.snapshots.push(normalizeGraphQLRepository(node, collectedAt));
    });
  }
}

export type { RateLimitInfo };
