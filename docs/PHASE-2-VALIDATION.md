# PHASE 2 VALIDATION

Date 2026-09-24. All live runs were **anonymous** (no token was available): core 60 requests/hour, search 10/minute, no GraphQL. Raw evidence is in [results/](../results/). Legend: **MEASURED** · **ESTIMATED** · **UNKNOWN**.

## Status

| Item | Result |
|---|---|
| Star-history provider live-tested | **YES** (anonymous): 4-repo smoke test, 12- and 45-repository collections, guard-abort run |
| Offline tests | 177 passing, `tsc --noEmit` clean. Line coverage of `src/` 97.9%; `src/analysis/` (windows, growth, velocity, points) 100% lines |
| Authenticated behaviour | **Tested 2026-09-25** (see "Authenticated validation" below). Actions `GITHUB_TOKEN` bucket still UNKNOWN |
| Week rollover, HTTP 403/422, ETag/304 from the star-history endpoint | **Not observed live**; covered by offline tests only |

## Live runs

| Run | Evidence file | Repos | REST requests | Outcome |
|---|---|---:|---:|---|
| star-history smoke (large, long-history, small, zero-star, 404) | results/star-history.json | 4 | 21 | 6/6 checks pass |
| collect, 12 repos (8 search queries) | results/live-collect-small.* | 12 | 8 search + 12 history (2nd run served entirely from persisted cache) | written; first attempt **failed validation** (see Data quality #1), fixed |
| collect, 45 repos (8 search queries) | results/live-collect-45.* | 45 | 53 (8 search + 45 history) | written, 0 failures, 128,249 bytes |
| guard test (same command, 15 core requests left) | results/live-collect-guard.* | — | 21 | aborted `RateLimitError` (remaining 4, reserve 5), exit 3, **existing dataset byte-identical** |
| full discovery dry run, 99 queries | results/discovery-full.* | — | 99 search | 4,409 unique candidates, 0 failed queries, 675 s |

## Star-history measurements

- HTTP 200 for every public repository; 404 -> `NotFoundError`. (MEASURED)
- **Pagination**: 30 buckets per page, `Link rel="next"/"last"`. Pages to full history: next.js 18, linux 27, encoreshao/github-trending 4, tiny repo 1; oldest bucket equals the repository creation week (next.js 2016-10-02 vs created 2016-10-05; linux 2011-09-04). (MEASURED)
- **Response size**: 528–2,179 bytes per page over 45 pages (mean **1,887 B**); smoke pages 1,061–2,058 B. (MEASURED)
- **Duration**: mean **392 ms**, max 799 ms per request, concurrency 4 (45 requests); smoke mean 362 ms sequential. (MEASURED, one network location)
- **Week rollover**: UNKNOWN live; handled and tested (duplicate week resolved, lowest page wins; gap -> one restart, then `PaginationError`).
- **Historical coverage**: first page = 30 weeks = up to 208 UTC days (the current week's future days are trimmed). Windows 7/30/90 d were fully covered for 45/45 (7d, 30d) and 45/45 (90d: 44 `ok`, 1 `zero-base`). 5 of 45 series were complete (repository younger than 30 weeks). (MEASURED)
- **Rate limit**: the endpoint draws from the `core` bucket, 404 responses count, anonymous limit 60/h, reset at a fixed time each hour. (MEASURED). Authenticated numbers: UNKNOWN.

## Discovery results (99 queries, anonymous)

| Item | Value |
|---|---|
| Queries / requests | 99 / 99 (42 AI, 57 engineering) — MEASURED |
| Wall time | 675 s (11.2 min; 6.5 s spacing + guard waits) — MEASURED |
| Average search response | 359,983 bytes, 1,643 ms — MEASURED |
| Unique repos AI / engineering (before filters) | 1,999 / 2,629 |
| Accepted AI / engineering | 1,990 / 2,627 (rejected: 9 + 2 archived, 0 forks, 0 below min stars, 0 irrelevant) |
| **Unique repositories after merging domains** | **4,409** (208 appear in both) |
| Queries returning the 100-result cap | 51 of 99 (more exist; `maxPagesPerQuery: 1` is deliberate) |
| Queries returning 0 results | 2 (`redis` fresh query, `infrastructure-as-code` fresh query) |
| Queries returning < 10 | 14, e.g. ai-music 3, kafka 1, aws 1, system-design 1, testing 7 (fresh 30-day / 25-star queries are sparse for niche topics) |
| Failed queries / retries / HTTP 403 | 0 / 0 / 0 in the final run |

## Data-quality findings

1. **Star-count drift** (MEASURED): `DietrichGebert/ponytail` history summed to 145,406 vs 145,405 stars; strict validation rejected the write. Fixed with `starDriftTolerance = max(2, 0.1% of stars)`. **The tolerance is an assumption**; 5 of 6 comparisons on complete series matched exactly earlier. After the fix, 57 repositories in two runs produced **0 stored quality warnings/errors**. Real distribution at 500–1,000 repos: UNKNOWN.
2. **Relevance filter is a no-op for topic queries** (MEASURED): 0 of ~4,600 results were rejected as irrelevant because each result already carries the queried topic. It only matters for keyword-based matches. The forks filter also rejected 0 (Search excludes forks by default).
3. **Tangential topics leak in** (MEASURED): JavaGuide (a Java interview guide) is tagged AI via topic `mcp`. Final classification must decide.
4. **Rate-limit clock skew** (MEASURED, cost a 15-minute run): a search request sent 3 s after GitHub's stated reset was still rejected. The guard now treats a bucket as reset only 3 s after `resetAt`, and primary limits that refill within 60 s are retried.
5. **Guard overshoot** (MEASURED): with concurrency 4 the core bucket reached 2 remaining against a reserve of 5, because up to `concurrency` requests are already in flight when the reserve is seen. Keep reserve >= concurrency + safety margin.
6. History has no repository id (UNKNOWN whether a rename mid-run mis-attributes history); metadata `openIssues` differs by source (REST counts PRs).
7. UTC alignment of GitHub's day buckets: UNKNOWN beyond the four repos whose weeks were UTC-midnight Sundays.

## Collection estimates (100 / 500 / 1,000 repositories)

Basis: MEASURED means above (1,887 B and 392 ms per history request; 2,850 B per stored repository = 128,249 / 45). Everything in the table is **ESTIMATED by linear scaling**, not measured at that size.

| | 100 | 500 | 1,000 |
|---|---:|---:|---:|
| History requests (30-week refresh) | 100 | 500 | 1,000 |
| Download | 184 KiB | 921 KiB | 1.8 MiB |
| History time at concurrency 4 (latency-bound) | ~10 s | ~49 s | ~98 s |
| Output file | ~285 KB | ~1.4 MB | ~2.85 MB |
| Fits anonymous 60/h (reserve 5 -> 55) | no | no | no |
| Fits Actions token 1,000/h (DOCUMENTED, unmeasured) | yes | yes | borderline / no |
| Fits PAT 5,000/h (DOCUMENTED) | yes | yes | yes |
| Full-history fetch | +3 to 26 requests per repo (MEASURED range 1-27 pages) | | |

Discovery for a full 99-query run: 99 search requests; anonymous 11.2 min (MEASURED); with a token at 30/min (DOCUMENTED) >= 3.3 min (ESTIMATED). Metadata via GraphQL with a token: cost UNKNOWN. Capacity is **not claimed** beyond the 45-repository run, which is the largest actually executed.

## Persisted cache evaluation

Useful, kept small: the 12-repo rerun was served 12/12 from the JSON cache (0 history requests) and a rate-limit abort no longer loses fetched work. It is opt-in (`--cache`), TTL 6 h, atomic writes, corrupt files discarded. No Redis or database.

## Remaining risks

- No authenticated measurement (GraphQL cost, token limits, Actions token, ETag/304).
- Drift tolerance and 12 h week-contiguity tolerance are assumptions.
- New endpoint: schema/limits may change; validation fails loudly by design.
- 1,000 repos per refresh consumes the whole hourly Actions budget.
- Discovery is candidate generation only; category tags are provisional.

## Recommended changes before Phase 3

1. Run the smoke tests and a 500-repo collection with a token; replace the DOCUMENTED limits with measurements.
2. Set `--reserve` >= concurrency + 2 (or make the guard account for in-flight requests).
3. Let the classifier decide category membership (do not rely on discovery tags); add a keyword-only query per category if topic coverage of rare categories matters.
4. Decide the refresh policy: weekly-window rankings need only page 1; refresh dormant repos less often to stay inside 1,000/h.
5. Consider the fresh-query settings (25 stars / 30 days) — sparse for niche topics.


---

# Authenticated validation (2026-09-25)

Evidence: `results/rate-limit.json`, `graphql.json`, `search.json`, `star-history.json` (with `authenticated: true`), `live-collect-500.json`. Token supplied by the user through the environment; never printed or stored. Numbers marked *(reported)* were given by the user from the run's console output; the stdout summary was not saved to `results/`.

## Smoke tests

| Script | Checks | Requests | Notes (MEASURED) |
|---|---|---|---|
| rate-limit | 6/6 | | core 5,000/h, graphql 5,000/h, **search 30/min**, `/rate_limit` free, 1-repo GraphQL query reported cost 1, invalid token -> `AuthenticationError` |
| graphql | 9/11 | 1 REST + 10 GraphQL | see below |
| search | 19/19 | 21 REST, 66.8 s | 16 topic queries + new-entrants + pagination + cap |
| star-history | 6/6 | 21 REST, 7.7 s | authenticated |

**GraphQL batching (MEASURED, cost is `rateLimit.cost`):**

| batch | cost | latency | languages / topics / licenses populated |
|---:|---:|---:|---|
| 1 | 1 | 0.48 s | 1 / 1 / 0 |
| 10 | 1 | 2.4 s | 8 / 10 / 9 |
| 25 | 1 | 3.9 s | 19 / 20 / 23 |
| 50 | 1 | 6.8 s | 41 / 43 / 44 |
| 100 | **failed: HTTP 504 "couldn't respond in time"** | | |
| 50 + commit count since 30 d | 1 (50/50 have counts) | | |
| 100 + commit count | **failed: "Resource limits for this query exceeded"** | | |

Conclusion: the maximum reliable batch is 50 (production `batchSize = 50`); the two failures are the deliberate boundary test and are not regressions. The commit-count field costs nothing extra at 50. An unknown repository is reported in `notFound` without failing the batch.

**Search (MEASURED):** totals per query range from about 1.6k to 2.6k for the AI topic queries; 3 pages x 100 gave 300 unique repositories (of 5,374 matching `topic:llm ...`); page 11 returns **HTTP 422 "Only the first 1000 search results are available"**.

**Rate-limit accounting anomaly (MEASURED, unexplained):** three REST core calls, 21 star-history calls and a GraphQL query all left `/rate_limit` at `used: 0, remaining: 5000` for this token. Whether the token is exempt, accounted elsewhere, or `/rate_limit` lags is **UNKNOWN**. Consequence: with this token the `RateGuard` never sees its reserve approached, so it cannot be validated against a real authenticated budget; do not assume 5,000/h capacity from this evidence.

## 500-repository collection

| Item | Value |
|---|---|
| Repositories written | 500 (dataset file), `metadataSource: graphql` for all 500 |
| Failures | 0 *(reported)* |
| Requests | 599 REST + 10 GraphQL *(reported)* = 500 history + 99 search; 10 GraphQL = 500/50 |
| Duration | 395,656 ms (6.6 min) *(reported)*, whole run including 99 discovery queries |
| Discovery *(reported)* | AI: 42 queries, 1,998 unique, 1,988 accepted; engineering: 57 queries, 2,619 unique, 2,617 accepted |
| Domains in the 500 (provisional discovery provenance) | 262 AI, 284 engineering (sums above 500: repos in both) |
| Growth windows | 7d ok 500/500, 30d ok 500/500, 90d ok 499 + 1 `zero-base` |
| Complete history series | 22 of 500 (younger than 30 weeks) |
| Stored quality warnings/errors | 0 of 500 |
| File size | 1,368,895 bytes = **2,738 B/repository** (predicted 2,874 from the 12-repo file) |
| `starsPerDay7d` percentiles (p50/p75/p90/p95/p99) | 11.4 / 33.4 / 81.9 / 165.9 / 565.1 (max 868.3) |
| `growthPercent7d` percentiles (p50/p75/p90/p95) | 0.23 / 0.50 / 1.04 / 1.83 |

**Selection caveat (MEASURED):** the 500 are the top candidates by stars: star p10/p50/p90 = 23,391 / 34,829 / 83,459; only 1 is younger than 90 days; all 500 were pushed within 30 days. So this dataset says almost nothing about small or new repositories.

## Gate result
Authenticated smoke tests ran, the 500-repository collection ran, results are documented here. The estimates in the earlier table are superseded for 500 repositories by the measurements above (599 REST + 10 GraphQL requests, about 6.6 minutes, 1.37 MB).
