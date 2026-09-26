# PHASE 6 CACHE STRATEGY

## Finding (from the code and earlier runs)
`JsonFileStarHistoryStore` uses a 6-hour TTL, while the schedule is daily. A cache persisted between daily runs would be **expired and useless**. API usage across days is bounded by the **due schedule** (tracking tiers HOT 24 h, WARM 72 h, DORMANT 168 h; about 1,100 refreshes per day), not by the cache. The cache matters only when a run is repeated within 6 hours, for example after a rate-limit stop (the first authenticated Phase 4 run made only 200 fresh requests because a same-day cache supplied 2,495 hits).

## Mechanism
- **actions/cache@v4** for `.cache/sh-due.json`, key `sh-<UTC date>-<run id>`, restore-keys `sh-<UTC date>-`. A same-day re-run restores the newest same-day cache; a new day misses (correct, entries are expired) and starts empty.
- **Size:** at most 12 MB (repository cap 10 GB). **Retention:** GitHub evicts unused caches after 7 days.
- **Branch behaviour:** no `pull_request` trigger, so caches live in the default-branch scope only.
- **Concurrency:** one run at a time, so two runs never write the same cache key.
- **Partial failure:** the collector checkpoints the repository dataset every 100 records; a rate-limit stop exits 3, the workflow continues with the saved progress and lets the quality gate judge coverage. A hard failure stops before any commit.
- **Miss:** the pipeline works unchanged and only issues more requests (bounded by the due list).

## Not cached
The 31 MB pipeline state is **not** an Actions cache (evictable, not authoritative). It lives in the `data-state` release asset (PHASE-6-DATA-STORAGE.md). Caching the whole repository was rejected.

## Invalidation
The key includes the date. Entries are self-validating (per-entry TTL, star-count drift checks).

## Not measured
The benefit of the cache in a real Actions re-run was not measured in this session.
