import type { RepositoryRef, RepositorySnapshot } from '../model/repositorySnapshot';
import type { StarHistorySeries } from '../model/starHistory';
import type { RateLimitInfo } from './rateLimit';

export interface FetchRepositoriesOptions {
  /** Repos per GraphQL request. Default 50 (raise after measuring). */
  batchSize?: number;
  /** Also request commit count on the default branch since this date (adds cost). */
  commitsSince?: Date;
  /** Override "now" for collectedAt (tests). */
  now?: Date;
}

export interface FetchRepositoriesResult {
  snapshots: RepositorySnapshot[];
  /** Refs GitHub could not resolve (deleted/private/renamed away). */
  notFound: RepositoryRef[];
  requests: number;
  /** Sum of GraphQL `rateLimit.cost` across requests. */
  cost: number;
  /** Rate limit reported by the last request. */
  rateLimit: RateLimitInfo | null;
}

export interface GitHubGraphQLProvider {
  fetchRepositories(refs: readonly RepositoryRef[], options?: FetchRepositoriesOptions): Promise<FetchRepositoriesResult>;
}

export interface SearchOptions {
  sort?: 'stars' | 'forks' | 'updated' | 'help-wanted-issues';
  order?: 'asc' | 'desc';
  /** 1..100. Default 100. */
  perPage?: number;
  /** Default 1. Search API caps at 1,000 results (10 pages of 100). */
  maxPages?: number;
  now?: Date;
}

export interface SearchResult {
  query: string;
  /** GitHub-reported total (may exceed 1,000 retrievable). */
  totalCount: number;
  incompleteResults: boolean;
  repositories: RepositorySnapshot[];
  pages: number;
  requests: number;
  rateLimit: RateLimitInfo | null;
}

export interface GitHubSearchProvider {
  searchRepositories(query: string, options?: SearchOptions): Promise<SearchResult>;
}

export interface StarHistoryOptions {
  /**
   * Stop after this many pages (30 weeks each). Default and maximum 100 (the documented cap).
   * When the limit stops the walk early, `complete` is false.
   */
  maxPages?: number;
}

export interface GitHubStarHistoryProvider {
  /** Weekly star buckets for a public repository, validated and ascending. */
  fetchStarHistory(repo: RepositoryRef, options?: StarHistoryOptions): Promise<StarHistorySeries>;
}
