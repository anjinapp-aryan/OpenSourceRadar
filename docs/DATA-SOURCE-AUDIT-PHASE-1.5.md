# DATA SOURCE AUDIT — PHASE 1.5 (star history re-evaluation)

Audit date 2026-09-24. **Live probes were unauthenticated** (no token available). They exhausted the 60/hour unauthenticated core budget; results below are exactly what was observed.

## 1. What changed in 2026 (sources read)

| Date | Change | Source |
|---|---|---|
| 2026-06-30 | `GET /repos/{o}/{r}/stargazers` and `/subscribers` restricted to admins/collaborators; stargazers/watchers UI views restricted; `/users/{u}/subscriptions` deprecated | [GitHub changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/). It does **not** mention GraphQL. daily-stars-explorer's README says `Repository.stargazers` (GraphQL) was restricted as well — **unverified by us** |
| 2026-09-04 | New `GET /repos/{owner}/{repo}/stargazers/history` | [changelog](https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/), [docs](https://docs.github.com/en/rest/activity/starring) |

## 2. Measured facts about the new endpoint (all live, unauthenticated)

| Fact | Observation |
|---|---|
| Status | HTTP 200 for public repos, no token |
| Shape | `[{"week": <unix Sunday>, "total": N, "days": [Sun..Sat]}, ...]`, newest week first; current week has trailing zeros for future days (e.g. `[14,23,26,18,8,0,0]` on a Thursday) |
| Page size | 30 weeks; `per_page=100` returned 30 (max 30 per docs) |
| Pagination | `Link` with `rel="next"` / `rel="last"`; pages go backwards toward creation; docs: max 100 pages |
| Pages needed | vercel/next.js: 18; star-history/star-history: 20; daily-stars-explorer: 6; tiny repo: 1 |
| Accuracy | Sum of all `total` == `stargazers_count` on 3 of 3 repos: 9,527 / 404 / 0 |
| Headers | `Access-Control-Allow-Origin: *` (browser-callable), `ETag: W/"…"`, `Cache-Control: public, max-age=60, s-maxage=60`, `X-RateLimit-Resource: core`, limit 60/h unauthenticated |
| Old REST list | `stargazers` with `Accept: application/vnd.github.star+json` -> **401 "Requires authentication"** (unauth) |
| Not measured | authenticated rate cost; whether `If-None-Match` 304 is free; GraphQL `stargazers` behaviour for non-collaborators; time-zone alignment (docs: "week and day boundaries are not guaranteed to align with UTC"); un-starred/suspended-user drift beyond the 3 samples |

## 3. Comparison A–D

| Criterion | A. GitHub star-history API | B. GraphQL stargazers | C. REST stargazers | D. Existing OSS (daily-stars-explorer, Marcos66236) |
|---|---|---|---|---|
| Availability for public repos we don't own | **Yes (verified)** | Restricted per daily-stars-explorer (unverified by us) | **No** (401 unauth; admin/collaborator only per changelog) | Only by calling A |
| Daily star history | **Yes, exact** | per-star timestamps (if allowed) | per-star timestamps (if allowed) | Yes (via A) |
| Weekly / monthly growth | Yes, from day buckets | derivable | derivable | Yes |
| Hourly | No | would be | would be | No (documented as retired) |
| Historical backfill cost | `ceil(weeks/30)` requests: 1 (tiny) to 20 (~10 y repo) | `ceil(stars/100)`: hundreds+ for big repos | same | same as A |
| 7/30-day window cost | **1 request** (page 1 = 30 weeks) | `ceil(stars_in_window/100)`+ | 2+ | 1 |
| Privacy | no stargazer identity | exposes users | exposes users | none if A |
| Token required | No (60/h unauth; PAT/Actions token raise limits) | Yes | Yes | No |
| Works from browser | Yes (CORS *) | No (token) | No | n/a |
| Fit for our repo counts | Excellent | Poor | Poor | n/a |

**Conclusion.** Source A is the only currently valid, cheap, exact, privacy-safe, tokenless source. B and C are restricted or expensive; D contributes only client design. Phase 1's `RestStargazerProvider` and `GraphQLStargazerProvider` should be **removed**, not kept as fallbacks: they cannot return data for repositories we do not own and expose stargazer identities we do not need.

## 4. Effects on the rest of the data strategy

| Item | Before (Phase 0/1) | Now |
|---|---|---|
| Cold start | weekly ranking honest only after ~7 days of own snapshots; monthly after ~30 | **Day 0**: weekly, monthly, 90-day growth, acceleration, persistence and mover ranks (rank now vs rank 7 days ago) all computable from history alone |
| Own snapshot store | source of truth for stars | needed only for signals with no history API (forks, issues, commits) and for a deterministic audit trail |
| Trending-page scrape | primary accelerator | unnecessary; drop or keep as optional cross-check |
| Backfill of stargazer timestamps | required | not needed |
| Detail page history | precomputed | can be fetched live in the browser (CORS `*`, 1–20 requests) |

## 5. API budget (star history), ESTIMATED from MEASURED page counts

Assumptions: 1 request = 1 core-bucket call; page 1 (30 weeks ≈ 210 days) covers 7/30/90-day windows; limits are the DOCUMENTED ones (PAT 5,000/h; Actions `GITHUB_TOKEN` 1,000/h/repo; unauthenticated 60/h **measured**).

| Tracked repos | Requests for one refresh (page 1 each) | Within 1,000/h Actions token? | Within 5,000/h PAT? |
|---|---:|---|---|
| 100 | 100 | yes | yes |
| 500 | 500 | yes (half the hour) | yes |
| 1,000 | 1,000 | borderline: uses the entire hourly budget | yes |

Full-history fetch (detail page or one-off backfill): `ceil(weeks/30)` requests per repo (**MEASURED** 1–20 for the four sampled repos; ~33 max per daily-stars-explorer's README for the oldest repos). Backfilling 1,000 repos fully is **ESTIMATED** in the low thousands of requests (UNKNOWN until sampled on a representative set); do it in shards across hours, or lazily per detail page.

Cost levers (not measured): ETag conditional requests (a `304` is documented as not counting toward primary limits for REST — **D**, verify), spreading refreshes across several cron runs, refreshing dormant repos weekly instead of daily.

## 6. Other sources — status

| Source | Role | Status |
|---|---|---|
| GitHub GraphQL batched repository query | forks, issues, topics, license, pushed, commits | Phase 1 code; **live cost UNMEASURED** (no token). Required before deciding how many repos per hour |
| GitHub Search API | discovery, new entrants | Phase 1 code; unauth calls worked in Phase 0; auth limits UNMEASURED |
| OSS Insight collections membership | category seeds | worked in Phase 0; rankings dead since 2026-03-01; star-history curve now redundant |
| GitHub trending page | optional cross-check | HTTP 200 in Phase 0; ToS/stability risk; no longer needed |
| GitHub `/contributors`, `/stats/commit_activity`, issue counts | contributor/activity signals | **UNKNOWN** — smoke-test with a token before promising them |

## 7. Required follow-up (needs a token; not done)
1. Measure `stargazers/history` authenticated: rate-limit bucket, cost per call, ETag/304 behaviour, `Retry-After` on 422 ("endpoint spammed" is a documented 422).
2. Run the Phase 1 GraphQL batch smoke test to obtain cost/repo.
3. Confirm week/day boundary alignment against a repo with known timestamps (sum of `days` vs `total` and vs UTC day counts).
4. Verify (or refute) that GraphQL `Repository.stargazers` is restricted, only to close the question; not needed for the design.
