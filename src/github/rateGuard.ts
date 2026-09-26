import { RateLimitError } from './errors';
import type { RateLimitInfo } from './rateLimit';

/** Live evidence (2026-09-24): a search request sent 3 s after the stated reset was still rate limited. */
const RESET_SKEW_MS = 3000;

export type RateResource = 'core' | 'search' | 'graphql';

export interface RateGuardOptions {
  /** Never spend the last N requests of a bucket. A number applies to every bucket; default core/graphql 5, search 2 (the search bucket is only 10-30 per minute and refills every 60 s). */
  reserve?: number | Partial<Record<RateResource, number>>;
  /**
   * If the bucket is at its reserve but resets within this many ms, wait for the
   * reset instead of failing. Default 0 (fail fast: no silent long sleeps).
   */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Pre-emptive budget guard. Learns each bucket's remaining/reset from response
 * headers and refuses to start a request that would eat into the reserve.
 * It never invents numbers: with no observation yet, requests are allowed.
 */
export class RateGuard {
  private readonly buckets = new Map<string, RateLimitInfo>();
  private readonly reserve: Record<RateResource, number>;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: RateGuardOptions = {}) {
    const r = options.reserve;
    this.reserve =
      typeof r === 'number'
        ? { core: r, graphql: r, search: r }
        : { core: r?.core ?? 5, graphql: r?.graphql ?? 5, search: r?.search ?? 2 };
    this.maxWaitMs = options.maxWaitMs ?? 0;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  /** Record the latest observation for a bucket. */
  record(resource: string | null, info: RateLimitInfo | null): void {
    if (!info || info.remaining === null) return;
    this.buckets.set(resource ?? info.resource ?? 'core', info);
  }

  /** Last observation for a bucket, if any. */
  get(resource: string): RateLimitInfo | undefined {
    return this.buckets.get(resource);
  }

  /** Call before each request. Throws RateLimitError when the reserve is reached. */
  async beforeRequest(resource: RateResource): Promise<void> {
    const info = this.buckets.get(resource);
    const reserve = this.reserve[resource];
    if (!info || info.remaining === null || info.remaining > reserve) return;

    // GitHub's clock and ours differ; a bucket is only treated as reset SKEW_MS after its stated reset time.
    const resetMs = info.resetAt ? info.resetAt.getTime() - this.now() + RESET_SKEW_MS : null;
    if (resetMs !== null && resetMs <= 0) {
      // Bucket has reset since we last looked; forget the stale observation.
      this.buckets.delete(resource);
      return;
    }
    if (resetMs !== null && resetMs <= this.maxWaitMs) {
      await this.sleep(resetMs + 1000);
      this.buckets.delete(resource);
      return;
    }
    throw new RateLimitError(
      `${resource} rate-limit reserve reached (remaining ${info.remaining}, reserve ${reserve})`,
      { resetAt: info.resetAt, resource },
    );
  }
}

/** Which bucket a REST path draws from. */
export function resourceForPath(path: string): RateResource {
  return path.includes('/search/') ? 'search' : 'core';
}
