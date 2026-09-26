import { InvalidResponseError } from './errors';

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: Date | null;
  /** core | search | graphql ... (REST header x-ratelimit-resource) */
  resource: string | null;
}

export interface GraphQLCost {
  cost: number;
  nodeCount: number | null;
  limit: number;
  remaining: number;
  resetAt: Date;
}

function num(value: string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse x-ratelimit-* response headers. Returns null when none are present. */
export function parseRestRateLimit(headers: Headers): RateLimitInfo | null {
  const limit = num(headers.get('x-ratelimit-limit'));
  const remaining = num(headers.get('x-ratelimit-remaining'));
  const used = num(headers.get('x-ratelimit-used'));
  const reset = num(headers.get('x-ratelimit-reset'));
  const resource = headers.get('x-ratelimit-resource');
  if (limit === null && remaining === null && reset === null) return null;
  return {
    limit,
    remaining,
    used,
    resetAt: reset === null ? null : new Date(reset * 1000),
    resource,
  };
}

/** Parse the `rateLimit { cost limit remaining resetAt nodeCount }` GraphQL object. */
export function parseGraphQLRateLimit(value: unknown): GraphQLCost {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidResponseError('GraphQL response is missing the rateLimit object');
  }
  const v = value as Record<string, unknown>;
  const { cost, limit, remaining, resetAt, nodeCount } = v;
  if (typeof cost !== 'number' || typeof limit !== 'number' || typeof remaining !== 'number') {
    throw new InvalidResponseError('GraphQL rateLimit has non-numeric cost/limit/remaining');
  }
  const reset = typeof resetAt === 'string' ? new Date(resetAt) : null;
  if (!reset || Number.isNaN(reset.getTime())) {
    throw new InvalidResponseError('GraphQL rateLimit.resetAt is not a valid date');
  }
  return { cost, limit, remaining, resetAt: reset, nodeCount: typeof nodeCount === 'number' ? nodeCount : null };
}

/** GraphQL rate-limit selection to append to a query. */
export const RATE_LIMIT_SELECTION = 'rateLimit { cost limit remaining resetAt nodeCount }';

/** Convert GraphQL cost info to the shared RateLimitInfo shape. */
export function graphqlCostToInfo(c: GraphQLCost): RateLimitInfo {
  return { limit: c.limit, remaining: c.remaining, used: c.limit - c.remaining, resetAt: c.resetAt, resource: 'graphql' };
}
