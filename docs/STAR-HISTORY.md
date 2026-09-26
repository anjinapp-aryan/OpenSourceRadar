# STAR HISTORY

Implementation: [src/github/starHistoryProvider.ts](../src/github/starHistoryProvider.ts) · math: [src/analysis/](../src/analysis/) · checks: [src/quality/checks.ts](../src/quality/checks.ts) · live test: [scripts/smoke/star-history.ts](../scripts/smoke/star-history.ts)

Legend: **MEASURED** (observed live, 2026-09-24, anonymous, one network location) · **DOCUMENTED** (GitHub docs, not re-verified) · **ESTIMATED** (arithmetic on measured values) · **UNKNOWN**.

## 1. Source of truth

`GET https://api.github.com/repos/{owner}/{repo}/stargazers/history` (GitHub REST, announced 2026-09-04). Nothing else supplies historical star data:

| Removed in Phase 2 | Why |
|---|---|
| REST/GraphQL stargazer providers, `stargazers.ts` smoke test, stargazer backfill/reconstruction | The list endpoint is restricted to admins/collaborators since 2026-06-30 (**MEASURED**: 401 unauthenticated). They also exposed user identities we do not need. |

Snapshot compaction was never implemented; nothing to remove.

## 2. Endpoint contract

| Item | Value | Status |
|---|---|---|
| Auth | none needed for public repositories; a token only raises rate limits | **MEASURED** (200 anonymous) |
| Parameters | `per_page` (max/default 30), `page` (max 100) | DOCUMENTED; `per_page=100` returned 30 (MEASURED earlier) |
| Response | array of `{ "week": <unix seconds>, "total": <int>, "days": [7 ints] }` | **MEASURED** |
| Order | within a page newest -> oldest; pages go backwards toward creation | DOCUMENTED, **MEASURED** |
| `days[0]` | first day of the bucket (Sunday) | DOCUMENTED; all measured `week` values were UTC-midnight Sundays |
| Day/week alignment with UTC | "not guaranteed to align with UTC" | DOCUMENTED. We label days as UTC dates and flag any `week % 86400 != 0` (`WEEK_NOT_UTC_MIDNIGHT`). Alignment: **UNKNOWN** beyond the samples |
| Current week | trailing days after today are 0 | **MEASURED** (e.g. `[14,23,26,18,8,0,0]` on a Thursday) |
| Pagination | `Link: <...page=N>; rel="next"` and `rel="last"` | **MEASURED** |
| Errors | 200, 404 (missing repo), 422 "validation failed or endpoint spammed" | 200/404 **MEASURED**; 422 DOCUMENTED, never observed |
| Caching / CORS | `ETag`, `Cache-Control: public, max-age=60, s-maxage=60`, `Access-Control-Allow-Origin: *` | **MEASURED** on all 4 sampled repositories |
| Rate-limit bucket | `core` (limit 60/h anonymous). 404 responses also count | **MEASURED** (20 requests -> `used: 20`) |

## 3. Provider behaviour

`RestStarHistoryProvider.fetchStarHistory(repo, { maxPages })`

1. Requests page 1 (`per_page=30`), follows `Link rel="next"` sequentially until absent. `next` must equal `page+1` (else `PaginationError`). Default limit is the documented 100 pages; `maxPages: 1` = latest 30 weeks (used by the collector by default). Stopping early leaves `complete: false`.
2. **Validates every page as untrusted input** (`parseStarHistoryPage`): body must be an array; each bucket needs an integer `week`, integer `total`, exactly seven non-negative integer `days` summing to `total`; weeks strictly newest-first within the page. Anything else -> `InvalidResponseError` naming page and bucket. No field is assumed.
3. **Week rollover**: if the current week turns over (Saturday -> Sunday 00:00 UTC) while paging, pagination shifts by one week and the boundary week appears on two pages. `assembleWeeks` de-duplicates by `week`, keeping the copy from the **lowest page number** (fetched closest to the newest data), counts duplicates in `rolloverDuplicates`. Behaviour is covered by tests; **not observed live** (needs a walk spanning the boundary).
4. **Contiguity**: after sorting, consecutive weeks must be 7 days +/- 12 h apart. A gap triggers **one full restart** of the walk (`restarted: true`); a second gap throws `PaginationError`. The 12 h tolerance exists because day boundaries are "not guaranteed" UTC; tolerance is an ASSUMPTION.
5. **Retries** (`withRetry`, 3 attempts, 500 ms x 2^n): network errors/timeouts and HTTP 5xx. `Retry-After` <= 60 s on 403/429 is honoured; longer waits are not (error surfaces). 401, 404, 422, 403 without rate-limit signals, invalid responses and pagination errors are **never** retried.
6. **Timeout**: 30 s per request (`AbortSignal.timeout`), surfaced as `NetworkError` after retries.
7. **Rate limits**: an optional `RateGuard` learns `x-ratelimit-*` per bucket and refuses to start a request that would spend the reserve (default core 5, search 1), throwing `RateLimitError` with `resetAt`. It waits only when the reset is within `maxWaitMs` (CLI: 65 s, i.e. only the search bucket).
8. **Deterministic output**: ascending weeks, no duplicates, no timestamps besides `fetchedAt`.

Typed errors: `AuthenticationError` (401), `RateLimitError`, `NetworkError`, `InvalidResponseError`, `PaginationError`, `NotFoundError` (404), `GitHubApiError` (other statuses). Logs carry operation, repository, requests, duration, status, bytes and rate limit; tokens are redacted.

## 4. Normalized model

```
StarHistorySeries   weeks[] (ascending, contiguous), complete, pages, requests, bytes,
                    rolloverDuplicates, restarted, fetchedAt
StarHistoryPoint    date (UTC YYYY-MM-DD), stars (cumulative at end of day),
                    dailyCount, weekStart, source = "github-star-history"
```

`stars` is derived, never guessed: `stars(date) = starsNow - sum(gains after date)`. The anchor is the repository's current star count, or the sum of all buckets when the series is complete. A partial series with no anchor yields **null**. Raw buckets are not stored in datasets (only per-day gains; see DATA-FORMAT.md).

## 5. Windows, growth and velocity

`computeStarWindows` / `computeWindowsFromGains`. Window *N* = the N UTC dates ending at the as-of date, **today included (partial day)**.

```
growthN        = sum of daily gains over the window
starsNdAgo     = starsNow - growthN
growthPercentN = growthN / starsNdAgo * 100      (4 dp; null when starsNdAgo = 0)
starsPerDayN   = growthN / N                      (4 dp; divides by N even for repos younger than N)
```

Worked example from the spec (tested): starsNow 10,000, stars7dAgo 8,600 -> growth7d 1,400, growthPercent7d 16.2791, starsPerDay7d 200.

Status per window: `ok`, `zero-base` (0 stars at window start: growth and velocity defined, percent null), `insufficient-history` (everything **null**), `inconsistent` (implied past stars < 0: everything null). **Missing data is never returned as zero**: an empty series, a stale series, a missing day inside the window, or a partial series that does not reach back far enough all give `insufficient-history`. A *complete* series does get one inference: days before the first bucket are zero because the repository did not exist yet.

Flat spec names (`starsNow, stars7dAgo, growth30d, growthPercent90d, starsPerDay7d ...`) are produced by `flattenWindows`.

Star-count drift: metadata and history are fetched at different moments and GitHub's aggregate can differ slightly from `stargazers_count`. The code tolerates `max(2, 0.1% of stars)` (`starDriftTolerance`), clamping a window's past count to 0 and recording `STAR_COUNT_DRIFT` (info). Larger disagreement is an error/`inconsistent`. **The tolerance is an assumption**; see §7.

## 6. Data-quality checks

| Check | Where | Result on violation |
|---|---|---|
| non-negative integers, 7 days, day sum = total | parse | `InvalidResponseError` |
| weeks ordered within a page | parse | `InvalidResponseError` |
| duplicate weeks (rollover) | assemble | resolved, counted, info |
| missing weeks (gap) | assemble | restart once, then `PaginationError` |
| valid/ordered/not-future dates | `checkStarHistory` | error / warning |
| week not at UTC midnight | `checkStarHistory` | info (alignment UNKNOWN) |
| sum of all buckets vs star count (complete series) | `checkStarHistory` | info within tolerance, else warning |
| history exceeds star count | `checkStarHistory` | info within tolerance, else error (partial) / warning (complete) |
| cumulative stars decreasing | n/a | Not possible by construction: buckets are non-negative. Whether GitHub can ever report net-negative days is **UNKNOWN**; we would reject them as malformed |
| repository ID match | dataset | history is fetched by owner/name; **ID equality between metadata and history is not verifiable** (the endpoint returns no repository id) — renamed repositories rely on GitHub redirects. UNKNOWN |

## 7. Measured results (live, anonymous, 2026-09-24)

Source: `results/star-history.json` (`npm run smoke:star-history`), 21 REST requests, 5.6 s total.

| Repo | Stars | Pages to full history | Page-1 bytes | Page-1 ms | Full-history coverage check |
|---|---:|---:|---:|---:|---|
| vercel/next.js | 142,423 | 18 | 1,860 | 433 | oldest bucket 2016-10-02 (repo created 2016-10-05) |
| torvalds/linux | 250,006 | 27 | 2,058 | 339 | oldest bucket 2011-09-04 (repo created 2011-09-04) |
| encoreshao/github-trending | 57 | 4 (walked fully, 114 buckets) | 1,593 | 321 | sum of buckets 57 = stars 57; first bucket <= creation |
| patrick-creates/rising-repos-tracker | 0 | 1 (walked fully, 20 buckets) | 1,061 | 353 | sum 0 = stars 0 |

- Average page-1 response **1,643 bytes**, **362 ms** (4 repos). Pages hold 30 buckets (last page fewer). Long-history repositories need 18–27 pages (**MEASURED**); `ceil(weeks/30)` (ESTIMATED formula, matches all four).
- A 404 for a nonexistent repository maps to `NotFoundError` (**MEASURED**).
- Earlier probes (Phase 1.5): sums equalled `stargazers_count` for 3 further repositories (9,527; 404; 0).
- **Live drift observed in the collector run:** `DietrichGebert/ponytail` history summed to 145,406 against 145,405 stars in metadata fetched about a minute earlier (delta +1, ~0.0007%) — the reason the tolerance exists. 5 of 6 live comparisons matched exactly. Distribution at scale: **UNKNOWN**.
- Rollover, HTTP 403/422 and ETag/304 behaviour were **not observed live** (see `notObserved` in the results file).

## 8. Known limitations

- Daily resolution only (no hourly). Counts current stars by date; users who un-starred are not in the history, so past cumulative counts are understated (magnitude UNKNOWN; sums matched exactly on 5 of 6 repos).
- Day boundaries are labelled UTC but GitHub does not promise it.
- One request per 30 weeks, sequentially per repository; different repositories are fetched with bounded concurrency (default 4).
- The response has no repository id, so history cannot be tied to an ID from this endpoint alone.
- The endpoint is new (2026-09-04): schema or limits may change; the validation layer is designed to fail loudly.
