export type GitHubErrorCode =
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'PAGINATION'
  | 'NOT_FOUND'
  | 'GITHUB_API';

export abstract class GitHubError extends Error {
  abstract readonly code: GitHubErrorCode;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Missing/invalid token, or HTTP 401. */
export class AuthenticationError extends GitHubError {
  readonly code = 'AUTHENTICATION' as const;
}

/** Primary or secondary rate limit hit (or our own reserve guard tripped). */
export class RateLimitError extends GitHubError {
  readonly code = 'RATE_LIMIT' as const;
  readonly resetAt: Date | null;
  readonly retryAfterSeconds: number | null;
  readonly resource: string | null;

  constructor(
    message: string,
    details: { resetAt?: Date | null; retryAfterSeconds?: number | null; resource?: string | null } = {},
  ) {
    super(message);
    this.resetAt = details.resetAt ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.resource = details.resource ?? null;
  }
}

/** fetch() itself failed (DNS, connection, timeout). */
export class NetworkError extends GitHubError {
  readonly code = 'NETWORK' as const;
}

/** Response was not the shape we require. */
export class InvalidResponseError extends GitHubError {
  readonly code = 'INVALID_RESPONSE' as const;
}

/** Pagination produced an inconsistent or malformed page. */
export class PaginationError extends GitHubError {
  readonly code = 'PAGINATION' as const;
  readonly page: number | null;

  constructor(message: string, page: number | null = null) {
    super(message);
    this.page = page;
  }
}

/** HTTP 404: repository missing, renamed away, or hidden. */
export class NotFoundError extends GitHubError {
  readonly code = 'NOT_FOUND' as const;
}

/** Any other non-success answer from GitHub (5xx, 4xx, GraphQL errors). */
export class GitHubApiError extends GitHubError {
  readonly code = 'GITHUB_API' as const;
  readonly status: number | null;
  readonly graphqlErrors: readonly GraphQLErrorItem[];

  constructor(message: string, details: { status?: number | null; graphqlErrors?: readonly GraphQLErrorItem[] } = {}) {
    super(message);
    this.status = details.status ?? null;
    this.graphqlErrors = details.graphqlErrors ?? [];
  }
}

export interface GraphQLErrorItem {
  type?: string;
  message: string;
  path?: readonly (string | number)[];
}
