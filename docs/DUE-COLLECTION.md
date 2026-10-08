# DUE COLLECTION

Implementation: [src/collect/dueCollector.ts](../src/collect/dueCollector.ts), CLI [scripts/collect/due.ts](../scripts/collect/due.ts) · tracking: [src/tracking/](../src/tracking/), [config/tracking.json](../config/tracking.json) · tests: [tests/dueCollector.test.ts](../tests/dueCollector.test.ts), [tests/tracking.test.ts](../tests/tracking.test.ts)

Legend: **CONFIGURED** (value in config) · **MEASURED** (observed on real data) · **ASSUMED** · **UNKNOWN**.

## 1. What it does

`npm run collect -- --due` reads the tracking schedule (`data/tracked/tracked.json`), picks the repositories whose `nextRefreshAt` has passed, collects star history **only for those**, and merges the results into the repository dataset (`--out`, default `data/repositories.json`). Repositories that are not due cause **no GitHub call** (test). It reuses the Phase 2 star-history provider, GraphQL provider (batch **50**), cache, rate guard, retries and atomic writer; nothing was reimplemented.

Flow: `tracked.json` + `candidates.json` (metadata) -> due selection -> [GraphQL metadata refresh, batches of 50, when a token exists] -> star history (bounded concurrency) -> quality check -> per-record validation -> merge -> atomic checkpoint. Afterwards run `npm run track -- --growth <out>` (new measurements move repositories out of UNASSESSED) and `npm run momentum`.

```
npm run collect -- --due --domain all --concurrency 4 --cache .cache/sh-due.json --out data/repositories.json
npm run track   -- --growth data/repositories.json
npm run momentum -- --repositories data/repositories.json --classified data/classified/classified.json
```

Options: `--domain ai|engineering|all` (collection scope: BOTH belongs to both; it never influences a tier), `--limit N`, `--concurrency N` (default 4), `--cache <file>` (persisted star-history cache, TTL 6 h), `--history-pages N|all` (30 weeks per page, default 1), `--chunk-size N` (checkpoint every N repositories, default 100), `--tracked`, `--candidates`, `--existing`, `--policy`, `--reserve`, `--now`. The original discovery collection (`npm run collect` without `--due`) is unchanged.

## 2. Tracking states and the refresh schedule

| State | Meaning | Refresh (CONFIGURED) |
|---|---|---|
| **HOT** | measured: high velocity / high percentage growth / young and growing | 24 h |
| **WARM** | measured: moderate growth, or large and recently active, or too young to be dormant | 72 h |
| **DORMANT** | measured: low growth **and** at least 30 days old | 168 h |
| **UNASSESSED** | **no star history measured yet.** Not a tier | due immediately; `unassessed.refreshHours` (24) is the retry interval after a failed first attempt |

**UNASSESSED is not DORMANT.** DORMANT is a measurement ("we looked and found little activity"); UNASSESSED is the absence of one. Phase 3 wrote provisional HOT/WARM tiers for unmeasured repositories; that was wrong to present as tracking behaviour and is gone: an unmeasured repository is now UNASSESSED regardless of age or stars, a legacy provisional record is read as UNASSESSED, and the first measurement is recorded as a transition (`first assessment: ...`). `dueOrder` (CONFIGURED: HOT, UNASSESSED, WARM, DORMANT) decides what is collected first when a rate limit or `--limit` cuts a run short; within the same state and due time, **younger repositories go first** (repository ids are creation-ordered, so id order would do the opposite; the first live run showed why).

Due rule: `nextRefreshAt <= now`, where `nextRefreshAt = lastCollectedAt + refreshIntervalHours` for measured repositories and `now` for UNASSESSED. The schedule is computed by the tracking engine only; the collector contains no tier logic. Intervals are operational policy, not optimised.

Tracking never uses category or classification score (test: identical measurements give identical decisions for AI, ENGINEERING and BOTH). Classification is only an eligibility gate (AI, ENGINEERING or BOTH are tracked; UNKNOWN and archived are not).

### Young repositories (a finding of this phase)
The first live due run measured 45 repositories aged 1-6 days. Tracking then labelled **25 of them DORMANT** because (a) stars/day divided the growth by 7 even for a 5-day-old repository, and (b) DORMANT can only mean "low growth over a long period", which a 5-day-old repository cannot show. Fixed: stars/day now uses the days that exist for repositories younger than 7 days, and a repository younger than `rules.dormant.minAgeDays` (30, CONFIGURED) cannot be DORMANT. After the fix: 24 HOT, 21 WARM, 0 DORMANT for those 45 (MEASURED). The 25 wrong DORMANT records were only ever written to local results, not used downstream.

## 3. Safety properties

| Property | How | Test |
|---|---|---|
| No call for repositories that are not due | `selectDue` before any request | A/B, "nothing due" |
| Per-repository failures are recorded, never fatal | `failures[]` with stage (`metadata`, `history`, `quality`); the old record for that repository is kept | "a repository failure is recorded..." |
| Existing valid data preserved | records for repositories not collected are copied; only collected ones are replaced | "preserves records..." |
| Never replace a good dataset with partial output | every new record is validated **alone**, then the merged dataset is validated before each atomic write; a failure writes nothing and leaves the file byte-identical, no `.tmp` left | X |
| Rate limit / auth error stops new work immediately | `shouldStop` flag set inside the worker, not after the batch; work done so far is saved; the repository that hit the limit stays due; CLI exit code 3 | Y, GraphQL variant |
| Resumable | atomic checkpoint every `chunkSize`; re-running collects what is still due; the persisted cache (TTL 6 h) makes already fetched series free | "resumable" test; live: the 45 repositories were re-run from cache with 0 requests |
| Bounded concurrency, controlled request rate | `mapWithConcurrency` (default 4) + `RateGuard` (reserve 5 core / 2 search, waits only for buckets that refill within a minute) | Phase 2 tests + Y |
| Retries | network / 5xx / short `Retry-After`; primary limits that refill within a minute (with a 3 s skew margin) | Phase 2 + infra tests |
| GraphQL batch 50 | constant `GRAPHQL_BATCH_SIZE`; 100 failed with 504 / resource limits in the authenticated test | "GraphQL metadata uses ... 50" |
| Stale metadata | see below | stale-metadata tests |

### Stale metadata (a second live finding)
Anonymous runs have no GraphQL, so they reuse the candidate metadata, which was **hours old**. For fast-growing young repositories the history (fetched later) summed to more than the stale star count (e.g. 6,248 vs 6,231). The first run wrote nothing (dataset validation refused it: the safety property worked, at the cost of the whole run). Fixes: (1) a **complete** history is the newer number, so it corrects a lower metadata count and records a `STARS_FROM_HISTORY` warning; a *partial* history cannot correct anything and is judged against the metadata (quality failure of that repository only); (2) each record is validated on its own, so one bad record can no longer sink a batch. With a token, GraphQL refreshes the metadata first and this path rarely triggers.

## 4. Measured API usage (live, anonymous, 2026-09-25)

| Item | Value |
|---|---|
| Tracked / due / not due / selected | 3,413 / 3,048 / 365 / 45 (`--limit 45`) |
| Repositories collected / failed | 45 / 0 (after the fixes above) |
| Star-history page requests | **45** (1 per repository; 0 retries) |
| Core rate limit | 60/h: 15 remaining after the run (limit 60, MEASURED from headers) |
| GraphQL requests | 0 (anonymous) |
| Bytes downloaded | 2,823 total, **63 B per response** (young repositories have only a few weekly buckets; Phase 2's 1.9 KB average was for old repositories) |
| Duration | about 6 s for the 45 requests at concurrency 3; the re-run from the persisted cache: 45 cache hits, **0 requests, 143 ms** |
| Cache | 45 misses on the first run; 45 store hits on the re-run |

Not measured: authenticated GraphQL metadata cost in a due run (Phase 2: cost 1 per batch of 50), authenticated rate-limit accounting, a run larger than 45 repositories.

## 5. The full first assessment is NOT done

3,003 tracked repositories are still UNASSESSED. Anonymous access allows 60 core requests/hour, i.e. about 50 hours for the rest. The command in §1 (with a token in `GITHUB_TOKEN`) does it; it is resumable and chunked. ESTIMATED: 3,003 history requests (about 5 minutes at concurrency 4 and 0.4 s each) plus about 61 GraphQL requests of 50 repositories (about 7 minutes at the measured 6.8 s per batch of 50, sequential). Budget: about 3,064 requests, within the documented 5,000/h PAT limit; the anomalous accounting observed for the Phase 2 token (`used: 0` after many requests) means real capacity is UNKNOWN. If the run is stopped by a limit, re-run the same command.

## 6. Limitations
- Refresh intervals and thresholds are **ASSUMED** policy.
- `--domain` filters by top-level classification (AI / ENGINEERING / BOTH), which is a collection scope, not a tier input.
- Due selection uses tracking state written by `npm run track`; if the tracked file is stale, so is the schedule. Re-run tracking after each collection.
- Candidate metadata is only refreshed with a token (GraphQL); anonymous runs keep the search-time metadata and only correct star counts from complete histories.

---

## Phase 6.2 addendum: due grace
Due selection now includes repositories whose `nextRefreshAt` falls within `dueGraceHours` (3) of the run start, so scheduling jitter does not skip a whole run. Evidence, replay and tests: [TRACKING.md](TRACKING.md) section "Phase 6.2 correction".
