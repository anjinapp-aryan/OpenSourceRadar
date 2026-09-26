import { AuthenticationError, RateLimitError } from '../github/errors';
import { silentLogger, type Logger } from '../github/logger';
import type { GitHubSearchProvider } from '../github/providers';
import type { RepositorySnapshot } from '../model/repositorySnapshot';
import { withRetry, type RetryOptions } from '../util/retry';
import { expandQuery, type CategoryConfig, type CategoryDefinition, type Domain } from './config';

export interface DiscoveredRepository {
  /** Snapshot as returned by search (source "rest"). */
  snapshot: RepositorySnapshot;
  domains: Domain[];
  /**
   * Provisional tags: categories whose topics/keywords match this repository.
   * NOT the final classification (that is a later phase).
   */
  categories: string[];
  /** Number of (query, page) result sets that contained this repository. */
  hits: number;
}

export interface DiscoveryStats {
  domain: Domain;
  queries: number;
  requests: number;
  failedQueries: { query: string; error: string }[];
  rawResults: number;
  uniqueRepositories: number;
  rejected: { belowMinStars: number; fork: number; archived: number; irrelevant: number };
  accepted: number;
  perCategory: Record<string, { queries: number; rawResults: number; accepted: number }>;
}

export interface DiscoveryResult {
  domain: Domain;
  candidates: DiscoveredRepository[];
  stats: DiscoveryStats;
}

export interface DiscoveryRunOptions {
  now?: Date;
  /** Only these category slugs. */
  categories?: readonly string[];
  /** Cap on queries per category (useful for cheap live tests). */
  maxQueriesPerCategory?: number;
}

export interface DiscoveryProvider {
  discover(config: CategoryConfig, options?: DiscoveryRunOptions): Promise<DiscoveryResult>;
}

/** Categories whose topics or keywords match the repository (topics exact, keywords by substring on name + description). */
export function matchingCategories(snapshot: RepositorySnapshot, categories: readonly CategoryDefinition[]): string[] {
  const topics = new Set(snapshot.topics.map((t) => t.toLowerCase()));
  const text = `${snapshot.name} ${snapshot.description ?? ''}`.toLowerCase().replace(/[-_]+/g, ' ');
  return categories
    .filter((c) => c.topics.some((t) => topics.has(t)) || c.keywords.some((k) => text.includes(k)))
    .map((c) => c.slug);
}

/**
 * Merge discovery results (e.g. AI + Engineering). Deduplicates on repositoryId - never on
 * owner/name, which changes when a repository is renamed or transferred. The most recently
 * collected snapshot wins; domains, categories and hits are unioned/summed.
 */
export function mergeCandidates(results: readonly (readonly DiscoveredRepository[])[]): DiscoveredRepository[] {
  const byId = new Map<string, DiscoveredRepository>();
  for (const list of results) {
    for (const c of list) {
      const existing = byId.get(c.snapshot.repositoryId);
      if (!existing) {
        byId.set(c.snapshot.repositoryId, { ...c, domains: [...c.domains], categories: [...c.categories] });
        continue;
      }
      existing.domains = [...new Set([...existing.domains, ...c.domains])].sort() as Domain[];
      existing.categories = [...new Set([...existing.categories, ...c.categories])].sort();
      existing.hits += c.hits;
      if (c.snapshot.collectedAt > existing.snapshot.collectedAt) existing.snapshot = c.snapshot;
    }
  }
  return sortCandidates([...byId.values()]);
}

/** Deterministic order: stars desc, then repositoryId asc (numeric). */
export function sortCandidates(list: DiscoveredRepository[]): DiscoveredRepository[] {
  return list.sort((a, b) => {
    if (b.snapshot.stars !== a.snapshot.stars) return b.snapshot.stars - a.snapshot.stars;
    const ia = BigInt(a.snapshot.repositoryId);
    const ib = BigInt(b.snapshot.repositoryId);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

export interface SearchDiscoveryProviderOptions {
  retry?: RetryOptions;
  logger?: Logger;
}

/**
 * Runs the configured Search queries for one domain, deduplicates by repository
 * id, drops forks/archived/low-star results, and tags each survivor with the
 * categories it matches. Search ranking is not trusted: a result that matches no
 * category topic or keyword is rejected as irrelevant.
 */
export class SearchDiscoveryProvider implements DiscoveryProvider {
  private readonly logger: Logger;

  constructor(
    private readonly search: GitHubSearchProvider,
    private readonly options: SearchDiscoveryProviderOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
  }

  async discover(config: CategoryConfig, options: DiscoveryRunOptions = {}): Promise<DiscoveryResult> {
    const now = options.now ?? new Date();
    const only = options.categories ? new Set(options.categories) : null;
    const selected = config.categories.filter((c) => !only || only.has(c.slug));
    const settings = config.discovery;

    const stats: DiscoveryStats = {
      domain: config.domain,
      queries: 0,
      requests: 0,
      failedQueries: [],
      rawResults: 0,
      uniqueRepositories: 0,
      rejected: { belowMinStars: 0, fork: 0, archived: 0, irrelevant: 0 },
      accepted: 0,
      perCategory: {},
    };
    const byId = new Map<string, { snapshot: RepositorySnapshot; hits: number }>();

    for (const category of selected) {
      const queries = category.searchQueries.slice(0, options.maxQueriesPerCategory ?? category.searchQueries.length);
      const perCat = (stats.perCategory[category.slug] = { queries: 0, rawResults: 0, accepted: 0 });
      for (const template of queries) {
        const query = expandQuery(template, settings, now);
        stats.queries += 1;
        perCat.queries += 1;
        try {
          const result = await withRetry(
            () =>
              this.search.searchRepositories(query, {
                sort: 'stars',
                perPage: settings.perPage,
                maxPages: settings.maxPagesPerQuery,
                now,
              }),
            { ...this.options.retry, logger: this.logger, operation: 'discovery.retry' },
          );
          stats.requests += result.requests;
          stats.rawResults += result.repositories.length;
          perCat.rawResults += result.repositories.length;
          for (const snapshot of result.repositories) {
            const existing = byId.get(snapshot.repositoryId);
            if (existing) existing.hits += 1;
            else byId.set(snapshot.repositoryId, { snapshot, hits: 1 });
          }
          this.logger.log({ operation: 'discovery.query', repository: category.slug, query, requests: result.requests, results: result.repositories.length, totalCount: result.totalCount });
        } catch (error) {
          // Running out of budget or credentials makes every later query pointless: stop loudly.
          if (error instanceof RateLimitError || error instanceof AuthenticationError) throw error;
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          stats.failedQueries.push({ query, error: message });
          this.logger.log({ operation: 'discovery.query', repository: category.slug, query, error: message });
        }
      }
    }

    stats.uniqueRepositories = byId.size;
    const candidates: DiscoveredRepository[] = [];
    for (const { snapshot, hits } of byId.values()) {
      if (snapshot.stars < Math.min(settings.minStars, settings.freshMinStars)) {
        stats.rejected.belowMinStars += 1;
        continue;
      }
      if (settings.excludeForks && snapshot.isFork) {
        stats.rejected.fork += 1;
        continue;
      }
      if (settings.excludeArchived && snapshot.isArchived) {
        stats.rejected.archived += 1;
        continue;
      }
      const categories = matchingCategories(snapshot, selected);
      if (categories.length === 0) {
        stats.rejected.irrelevant += 1;
        continue;
      }
      for (const slug of categories) (stats.perCategory[slug] as { accepted: number }).accepted += 1;
      candidates.push({ snapshot, domains: [config.domain], categories, hits });
    }
    stats.accepted = candidates.length;
    return { domain: config.domain, candidates: sortCandidates(candidates), stats };
  }
}
