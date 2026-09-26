import {
  AuthenticationError,
  GitHubApiError,
  InvalidResponseError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  type GraphQLErrorItem,
} from './errors';
import { silentLogger, type Logger } from './logger';
import { resourceForPath, type RateGuard } from './rateGuard';
import { parseRestRateLimit, type RateLimitInfo } from './rateLimit';

export interface HttpClientOptions {
  /** Token string, or `null` for anonymous access (public REST endpoints only; 60 req/h). An empty string is rejected. */
  token: string | null;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  /** Optional pre-emptive rate-limit guard. */
  guard?: RateGuard;
}

export interface CallContext {
  operation: string;
  repository?: string;
}

export interface RestResult<T> {
  data: T;
  headers: Headers;
  status: number;
  rateLimit: RateLimitInfo | null;
  /** Response body size in bytes (as received, before JSON parsing). */
  bytes: number;
  durationMs: number;
}

export interface GraphQLResult<T> {
  data: T | null;
  errors: GraphQLErrorItem[];
  rateLimit: RateLimitInfo | null;
}

export interface RequestStats {
  rest: number;
  graphql: number;
}

/**
 * Thin GitHub client. Maps every failure to a typed error, logs every call
 * (never the token), counts requests and feeds an optional RateGuard.
 */
export class GitHubHttpClient {
  readonly stats: RequestStats = { rest: 0, graphql: 0 };
  readonly authenticated: boolean;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly guard: RateGuard | undefined;

  constructor(options: HttpClientOptions) {
    if (options.token === '') throw new AuthenticationError('GitHubHttpClient requires a token (pass null for anonymous access)');
    this.token = options.token;
    this.authenticated = options.token !== null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? silentLogger;
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.userAgent = options.userAgent ?? 'opensource-radar/0.1 (+https://github.com/opensource-radar)';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.guard = options.guard;
  }

  async rest<T>(
    path: string,
    ctx: CallContext,
    options: { query?: Record<string, string | number>; accept?: string } = {},
  ): Promise<RestResult<T>> {
    const url = new URL(path.startsWith('http') ? path : this.baseUrl + path);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, String(v));
    const resource = resourceForPath(url.pathname);
    await this.guard?.beforeRequest(resource);
    this.stats.rest += 1;
    const { response, body, durationMs, bytes } = await this.send(
      url.toString(),
      { method: 'GET', headers: { Accept: options.accept ?? 'application/vnd.github+json' } },
      ctx,
      resource,
    );
    const rateLimit = parseRestRateLimit(response.headers);
    this.guard?.record(resource, rateLimit);
    this.logger.log({ ...ctx, requests: 1, durationMs, status: response.status, bytes, rateLimit });
    return { data: body as T, headers: response.headers, status: response.status, rateLimit, bytes, durationMs };
  }

  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    ctx: CallContext,
  ): Promise<GraphQLResult<T>> {
    if (!this.authenticated) throw new AuthenticationError(`${ctx.operation}: the GraphQL API requires a token`);
    await this.guard?.beforeRequest('graphql');
    this.stats.graphql += 1;
    const { response, body, durationMs } = await this.send(
      `${this.baseUrl}/graphql`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) },
      ctx,
      'graphql',
    );
    const rateLimit = parseRestRateLimit(response.headers);
    this.guard?.record('graphql', rateLimit);
    if (typeof body !== 'object' || body === null) {
      throw new InvalidResponseError(`${ctx.operation}: GraphQL body is not an object`);
    }
    const envelope = body as { data?: T | null; errors?: GraphQLErrorItem[] };
    const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
    this.logger.log({ ...ctx, requests: 1, durationMs, status: response.status, rateLimit, graphqlErrors: errors.length });

    const limited = errors.find((e) => e.type === 'RATE_LIMITED');
    if (limited) {
      throw new RateLimitError(`GraphQL rate limited: ${limited.message}`, {
        resetAt: rateLimit?.resetAt ?? null,
        resource: 'graphql',
      });
    }
    if (!envelope.data && errors.length > 0) {
      throw new GitHubApiError(`${ctx.operation}: GraphQL error: ${errors[0]?.message ?? 'unknown'}`, {
        status: response.status,
        graphqlErrors: errors,
      });
    }
    return { data: envelope.data ?? null, errors, rateLimit };
  }

  private async send(
    url: string,
    init: RequestInit,
    ctx: CallContext,
    resource: string,
  ): Promise<{ response: Response; body: unknown; durationMs: number; bytes: number }> {
    const started = Date.now();
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers as Record<string, string>),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      const durationMs = Date.now() - started;
      const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      this.logger.log({ ...ctx, requests: 1, durationMs, error: `network: ${reason}` });
      throw new NetworkError(`${ctx.operation}: network failure: ${reason}`, { cause });
    }
    const durationMs = Date.now() - started;

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      throw new NetworkError(`${ctx.operation}: failed reading response body: ${reason}`, { cause });
    }
    const bytes = Buffer.byteLength(text);
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (cause) {
        if (response.ok) {
          this.logger.log({ ...ctx, requests: 1, durationMs, error: 'invalid JSON body' });
          throw new InvalidResponseError(`${ctx.operation}: response body is not valid JSON`, { cause });
        }
      }
    }

    if (!response.ok) {
      const rateLimit = parseRestRateLimit(response.headers);
      this.guard?.record(resource, rateLimit);
      const message =
        typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: unknown }).message) : response.statusText;
      this.logger.log({ ...ctx, requests: 1, durationMs, status: response.status, rateLimit, error: message });
      throw this.mapHttpError(response, message, rateLimit, ctx);
    }
    return { response, body, durationMs, bytes };
  }

  private mapHttpError(response: Response, message: string, rateLimit: RateLimitInfo | null, ctx: CallContext): Error {
    const status = response.status;
    if (status === 401) return new AuthenticationError(`${ctx.operation}: GitHub rejected the credentials (401): ${message}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;
    const limited =
      status === 429 || (status === 403 && (rateLimit?.remaining === 0 || /rate limit/i.test(message) || hasRetryAfter));
    if (limited) {
      return new RateLimitError(`${ctx.operation}: rate limited (${status}): ${message}`, {
        resetAt: rateLimit?.resetAt ?? null,
        retryAfterSeconds: hasRetryAfter ? retryAfter : null,
        resource: rateLimit?.resource ?? null,
      });
    }
    if (status === 404) return new NotFoundError(`${ctx.operation}: not found (404): ${message}`);
    return new GitHubApiError(`${ctx.operation}: GitHub API error ${status}: ${message}`, { status });
  }
}
