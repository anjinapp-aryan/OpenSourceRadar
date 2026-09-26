import { InvalidResponseError, PaginationError } from './errors';
import type { GitHubHttpClient } from './http';
import { silentLogger, type Logger } from './logger';
import { parseLinkHeader } from './pagination';
import type { GitHubStarHistoryProvider, StarHistoryOptions } from './providers';
import { refToString, type RepositoryRef } from '../model/repositorySnapshot';
import type { StarHistorySeries, WeekBucket } from '../model/starHistory';
import { withRetry, type RetryOptions } from '../util/retry';

const WEEK_SECONDS = 7 * 86_400;
/** Consecutive weeks may differ from exactly 7 days by up to this much before we call it a gap/overlap (docs: boundaries "not guaranteed to align with UTC"). */
const WEEK_TOLERANCE_SECONDS = 12 * 3600;
const PER_PAGE = 30; // documented maximum and default
const DEFAULT_MAX_PAGES = 100; // documented maximum

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/**
 * Validate one page of the untrusted response. Nothing is assumed: top level
 * must be an array, every bucket must have an integer `week`, an integer
 * `total`, seven non-negative integer `days` that sum to `total`, and weeks
 * within the page must be strictly descending (documented newest -> oldest).
 */
export function parseStarHistoryPage(data: unknown, page: number, repo: string): WeekBucket[] {
  const ctx = `star history ${repo} page ${page}`;
  if (!Array.isArray(data)) throw new InvalidResponseError(`${ctx}: expected an array, got ${data === null ? 'null' : typeof data}`);
  const buckets: WeekBucket[] = [];
  data.forEach((raw, i) => {
    if (!isRecord(raw)) throw new InvalidResponseError(`${ctx}: bucket ${i} is not an object`);
    const { week, total, days } = raw;
    if (!nonNegInt(week)) throw new InvalidResponseError(`${ctx}: bucket ${i} has invalid "week"`);
    if (!nonNegInt(total)) throw new InvalidResponseError(`${ctx}: bucket ${i} has invalid "total"`);
    if (!Array.isArray(days) || days.length !== 7 || !days.every(nonNegInt)) {
      throw new InvalidResponseError(`${ctx}: bucket ${i} "days" must be 7 non-negative integers`);
    }
    const sum = (days as number[]).reduce((a, b) => a + b, 0);
    if (sum !== total) throw new InvalidResponseError(`${ctx}: bucket ${i} days sum ${sum} != total ${total}`);
    const previous = buckets[buckets.length - 1];
    if (previous && week >= previous.week) throw new InvalidResponseError(`${ctx}: weeks are not strictly newest-first at bucket ${i}`);
    buckets.push({ week, total, days: days as number[] });
  });
  return buckets;
}

interface PageBuckets {
  page: number;
  buckets: WeekBucket[];
}

/**
 * Merge pages into one ascending series. Duplicate weeks appear when the current
 * week rolls over to a new Sunday while pages are being fetched: pagination shifts
 * by one week and adjacent pages overlap. The copy from the LOWEST page number
 * (fetched closest to the newest data) wins, deterministically.
 */
export function assembleWeeks(pages: readonly PageBuckets[]): { weeks: WeekBucket[]; duplicates: number; gaps: number } {
  const byWeek = new Map<number, { page: number; bucket: WeekBucket }>();
  let duplicates = 0;
  for (const { page, buckets } of pages) {
    for (const bucket of buckets) {
      const existing = byWeek.get(bucket.week);
      if (existing) {
        duplicates += 1;
        if (page < existing.page) byWeek.set(bucket.week, { page, bucket });
      } else {
        byWeek.set(bucket.week, { page, bucket });
      }
    }
  }
  const weeks = [...byWeek.values()].map((v) => v.bucket).sort((a, b) => a.week - b.week);
  let gaps = 0;
  for (let i = 1; i < weeks.length; i += 1) {
    const diff = (weeks[i] as WeekBucket).week - (weeks[i - 1] as WeekBucket).week;
    if (Math.abs(diff - WEEK_SECONDS) > WEEK_TOLERANCE_SECONDS) gaps += 1;
  }
  return { weeks, duplicates, gaps };
}

export interface RestStarHistoryProviderOptions {
  retry?: RetryOptions;
  logger?: Logger;
  now?: () => Date;
}

/**
 * GET /repos/{owner}/{repo}/stargazers/history - GitHub's privacy-safe star history.
 * Public repositories need no token. Follows `Link rel="next"`, validates every
 * bucket, retries transient failures, resolves week-rollover overlap, and
 * restarts the walk once if the assembled series is not contiguous.
 */
export class RestStarHistoryProvider implements GitHubStarHistoryProvider {
  /** Measured usage since construction: attempts include retries. */
  readonly stats = { pageRequests: 0, retries: 0, bytes: 0, series: 0 };
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(
    private readonly http: GitHubHttpClient,
    private readonly options: RestStarHistoryProviderOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
  }

  async fetchStarHistory(repo: RepositoryRef, options: StarHistoryOptions = {}): Promise<StarHistorySeries> {
    const name = refToString(repo);
    const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
    let requests = 0;
    let bytes = 0;

    for (let walk = 1; walk <= 2; walk += 1) {
      const pages: PageBuckets[] = [];
      let page = 1;
      let complete = false;

      for (;;) {
        const res = await withRetry(
          () => {
            requests += 1; // counts every attempt, including retries
            this.stats.pageRequests += 1;
            return this.http.rest<unknown>(
              `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/stargazers/history`,
              { operation: 'starHistory.fetchPage', repository: `${name} p${page}` },
              { query: { per_page: PER_PAGE, page } },
            );
          },
          { ...this.options.retry, logger: this.logger, operation: 'starHistory.retry', onRetry: () => (this.stats.retries += 1) },
        );
        bytes += res.bytes;
        this.stats.bytes += res.bytes;
        const buckets = parseStarHistoryPage(res.data, page, name);
        if (page > 1 && buckets.length === 0) throw new PaginationError(`star history ${name}: page ${page} is empty after a "next" link`, page);
        pages.push({ page, buckets });

        const next = parseLinkHeader(res.headers.get('link')).next;
        if (next === undefined) {
          complete = true;
          break;
        }
        if (next !== page + 1) throw new PaginationError(`star history ${name}: expected next page ${page + 1}, Link says ${next}`, page);
        if (pages.length >= maxPages) break; // caller-imposed limit; `complete` stays false
        page = next;
      }

      const { weeks, duplicates, gaps } = assembleWeeks(pages);
      if (gaps > 0 && walk === 1) {
        this.logger.log({ operation: 'starHistory.restart', repository: name, gaps, reason: 'non-contiguous weeks (possible rollover)' });
        continue;
      }
      if (gaps > 0) throw new PaginationError(`star history ${name}: ${gaps} gap(s) between weekly buckets after a restart`);

      this.stats.series += 1;
      return {
        repository: name,
        weeks,
        complete,
        pages: pages.length,
        requests,
        bytes,
        rolloverDuplicates: duplicates,
        restarted: walk === 2,
        fetchedAt: this.now().toISOString(),
      };
    }
    /* c8 ignore next */
    throw new PaginationError(`star history ${name}: unreachable`);
  }
}
