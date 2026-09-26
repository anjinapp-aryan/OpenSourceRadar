import { InvalidResponseError, PaginationError } from './errors';
import type { GitHubHttpClient } from './http';
import { normalizeRestRepository } from './normalize';
import type { GitHubSearchProvider, SearchOptions, SearchResult } from './providers';

/** GitHub Search returns at most 1,000 results per query. */
export const SEARCH_RESULT_CAP = 1000;

export class RestSearchProvider implements GitHubSearchProvider {
  /**
   * @param minIntervalMs spacing between search calls (search bucket is 30/min authenticated).
   */
  constructor(
    private readonly http: GitHubHttpClient,
    private readonly minIntervalMs = 2100,
  ) {}

  private lastCallAt = 0;

  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }

  async searchRepositories(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const perPage = Math.max(1, Math.min(options.perPage ?? 100, 100));
    const maxPages = Math.max(1, options.maxPages ?? 1);
    const collectedAt = (options.now ?? new Date()).toISOString();

    const result: SearchResult = {
      query,
      totalCount: 0,
      incompleteResults: false,
      repositories: [],
      pages: 0,
      requests: 0,
      rateLimit: null,
    };

    for (let page = 1; page <= maxPages; page += 1) {
      if ((page - 1) * perPage >= SEARCH_RESULT_CAP) break;
      await this.throttle();
      const res = await this.http.rest<unknown>('/search/repositories', { operation: 'search.repositories', repository: query }, {
        query: {
          q: query,
          per_page: perPage,
          page,
          ...(options.sort ? { sort: options.sort, order: options.order ?? 'desc' } : {}),
        },
      });
      result.requests += 1;
      result.rateLimit = res.rateLimit;

      const body = res.data as { total_count?: unknown; incomplete_results?: unknown; items?: unknown } | null;
      if (!body || typeof body.total_count !== 'number') {
        throw new InvalidResponseError('search.repositories: total_count missing');
      }
      if (!Array.isArray(body.items)) {
        throw new PaginationError(`search.repositories: page ${page} has no items array`, page);
      }
      result.totalCount = body.total_count;
      result.incompleteResults = result.incompleteResults || body.incomplete_results === true;
      result.pages += 1;
      for (const item of body.items) result.repositories.push(normalizeRestRepository(item, collectedAt));

      const retrieved = result.repositories.length;
      if (body.items.length < perPage || retrieved >= Math.min(body.total_count, SEARCH_RESULT_CAP)) break;
    }
    return result;
  }
}
