import { GitHubApiError, NetworkError, RateLimitError } from '../github/errors';
import { silentLogger, type Logger } from '../github/logger';

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Delay before retry n (1-based) is baseDelayMs * 2^(n-1). Default 500. */
  baseDelayMs?: number;
  /** A Retry-After longer than this is not waited for; the error is thrown. Default 60 s. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called once per retry actually taken (for measurement). */
  onRetry?: () => void;
  logger?: Logger;
  operation?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay before the next attempt, or null when the error must not be retried. */
export function retryDelayMs(error: unknown, attempt: number, options: RetryOptions = {}): number | null {
  const base = options.baseDelayMs ?? 500;
  const backoff = base * 2 ** (attempt - 1);
  if (error instanceof NetworkError) return backoff;
  if (error instanceof GitHubApiError) return error.status !== null && error.status >= 500 ? backoff : null;
  if (error instanceof RateLimitError) {
    if (error.retryAfterSeconds === null) {
      // Primary limit whose bucket refills within the cap (e.g. the search bucket, 60 s): wait for it.
      // A reset time that is far away (core: up to an hour) or long past is not retried.
      if (!error.resetAt) return null;
      // GitHub's reset time can lag: live, a search request 4 s AFTER the stated reset was still limited (and other
      // traffic on a shared anonymous IP can drain the bucket between our requests). So a reset within a minute either
      // side of now is worth waiting for: stated reset + 3 s skew margin, plus a growing pause per attempt.
      const untilReset = error.resetAt.getTime() - (options.now?.() ?? Date.now());
      const cap = options.maxRetryAfterMs ?? 60_000;
      if (untilReset <= -60_000 || untilReset > cap) return null;
      return Math.max(untilReset + 3000, 0) + 2000 * attempt;
    }
    const wait = error.retryAfterSeconds * 1000;
    return wait <= (options.maxRetryAfterMs ?? 60_000) ? Math.max(wait, backoff) : null;
  }
  return null; // authentication, not found, invalid response, pagination: deterministic, never retried
}

/** Run `fn`, retrying transient failures. Every retry is logged; the final error is rethrown unchanged. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? silentLogger;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      const delay = attempt < attempts ? retryDelayMs(error, attempt, options) : null;
      if (delay === null) throw error;
      logger.log({
        operation: options.operation ?? 'retry',
        attempt,
        delayMs: delay,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      options.onRetry?.();
      await sleep(delay);
    }
  }
}
