import { readJsonIfExists, writeJsonAtomic } from '../io/atomicWrite';
import type { RepositoryRef } from '../model/repositorySnapshot';
import { refToString } from '../model/repositorySnapshot';
import type { StarHistorySeries } from '../model/starHistory';
import type { GitHubStarHistoryProvider, StarHistoryOptions } from './providers';

/** Optional persistence behind the in-memory cache. */
export interface StarHistoryStore {
  get(key: string): StarHistorySeries | undefined;
  set(key: string, series: StarHistorySeries): void;
  flush(): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  /** Requests that joined an in-flight identical request. */
  coalesced: number;
  /** Hits served from the persistent store. */
  storeHits: number;
}

export interface CachingOptions {
  store?: StarHistoryStore;
  /** Persistent entries older than this are ignored. Default 6 h. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * Per-run in-memory cache (with in-flight coalescing) and optional persistent
 * store. Keyed by lower-cased owner/name + page limit. Failures are never cached.
 */
export class CachingStarHistoryProvider implements GitHubStarHistoryProvider {
  readonly stats: CacheStats = { hits: 0, misses: 0, coalesced: 0, storeHits: 0 };
  private readonly memory = new Map<string, Promise<StarHistorySeries>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: GitHubStarHistoryProvider,
    private readonly options: CachingOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 6 * 3_600_000;
    this.now = options.now ?? Date.now;
  }

  static keyFor(repo: RepositoryRef, options: StarHistoryOptions): string {
    return `${refToString(repo).toLowerCase()}#pages=${options.maxPages ?? 'all'}`;
  }

  fetchStarHistory(repo: RepositoryRef, options: StarHistoryOptions = {}): Promise<StarHistorySeries> {
    const key = CachingStarHistoryProvider.keyFor(repo, options);
    const inFlight = this.memory.get(key);
    if (inFlight) {
      this.stats.coalesced += 1;
      return inFlight;
    }
    const stored = this.options.store?.get(key);
    if (stored && this.now() - Date.parse(stored.fetchedAt) <= this.ttlMs) {
      this.stats.hits += 1;
      this.stats.storeHits += 1;
      const p = Promise.resolve(stored);
      this.memory.set(key, p);
      return p;
    }
    this.stats.misses += 1;
    const p = this.inner.fetchStarHistory(repo, options).then(
      (series) => {
        this.options.store?.set(key, series);
        return series;
      },
      (error) => {
        this.memory.delete(key); // never cache a failure
        throw error;
      },
    );
    this.memory.set(key, p);
    return p;
  }
}

/** Single JSON file `{ version, entries: { key: series } }`, written atomically. */
export class JsonFileStarHistoryStore implements StarHistoryStore {
  private entries: Record<string, StarHistorySeries> = {};
  private dirty = false;

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<JsonFileStarHistoryStore> {
    const store = new JsonFileStarHistoryStore(path);
    try {
      const raw = await readJsonIfExists<{ version?: number; entries?: Record<string, StarHistorySeries> }>(path);
      if (raw?.version === 1 && raw.entries && typeof raw.entries === 'object') store.entries = raw.entries;
    } catch {
      store.entries = {}; // a corrupt cache is discarded, never trusted
    }
    return store;
  }

  get(key: string): StarHistorySeries | undefined {
    return this.entries[key];
  }

  set(key: string, series: StarHistorySeries): void {
    this.entries[key] = series;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await writeJsonAtomic(this.path, { version: 1, entries: this.entries });
    this.dirty = false;
  }
}
