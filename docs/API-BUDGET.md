# API BUDGET

Legend: **MEASURED** = observed in an authenticated smoke run. **DOCUMENTED** = stated in GitHub documentation, *not* re-verified in this session. **ESTIMATED** = arithmetic on measured values with stated assumptions. **UNKNOWN** = no basis yet.

**Current status: authenticated smoke tests NOT RUN (no token). Therefore there are zero MEASURED authenticated values, and every capacity figure below is UNKNOWN or DOCUMENTED.** Run `npm run smoke && npm run budget` to fill the tables; `scripts/budget.ts` computes them from the result JSON so nothing is typed in by hand.

## Limits

| Limit | Value | Status |
|---|---|---|
| Unauthenticated REST core | 60 req/hour | MEASURED (Phase 0, `X-RateLimit-Limit: 60`) |
| Authenticated REST core (PAT) | 5,000 req/hour | DOCUMENTED |
| Actions `GITHUB_TOKEN` REST core | 1,000 req/hour per repository | DOCUMENTED |
| GraphQL | 5,000 points/hour (PAT) | DOCUMENTED; MEASURED after smoke |
| GraphQL cost model | points ≈ (number of connection requests needed, each `first:N` up to 100 counts as 1) ÷ 100, minimum 1 | DOCUMENTED; validate with `rateLimit.cost` in smoke |
| GraphQL node limit | 500,000 nodes per query | DOCUMENTED |
| Search | 30 req/min authenticated (10/min unauth); max 1,000 results/query | DOCUMENTED (unauth search worked in Phase 0; limits not measured) |
| Secondary limits (concurrency/burst) | unpublished thresholds | UNKNOWN |

## Snapshot collection (GraphQL batching) — 100 / 500 / 1,000 repos

| Quantity | 100 | 500 | 1,000 |
|---|---|---|---|
| Cost per repo (points) | UNKNOWN | UNKNOWN | UNKNOWN |
| Requests per run at batch size B | ⌈100/B⌉ (formula) | ⌈500/B⌉ | ⌈1000/B⌉ |
| Points per run | UNKNOWN | UNKNOWN | UNKNOWN |
| Daily snapshot, points/month (×30) | UNKNOWN | UNKNOWN | UNKNOWN |
| Weekly collection, points/month (×4) | UNKNOWN | UNKNOWN | UNKNOWN |
| Monthly collection, points/month (×1) | UNKNOWN | UNKNOWN | UNKNOWN |

Design expectation (hypothesis, to be confirmed or refuted by smoke): the repository fragment has no connection with `first > 1` except `repositoryTopics(first:20)`, so cost per repo should be small and batching should keep 1,000 repos inside a handful of requests. **Not measured — do not rely on it.**

## Discovery (Search API)
| Quantity | Value |
|---|---|
| Requests for the 16 topic queries + new-entrants query, 1 page each | 17 (by construction of `search.ts`) — MEASURED usage pending |
| Minimum wall time at 2.1 s spacing | ≈ 36 s (ESTIMATED arithmetic) |
| Repos per request | UNKNOWN (asks for 100) |

## Star history (replaces the Phase 1 "stargazer backfill" section)
The stargazer list endpoint is restricted; history now comes from `GET /repos/{o}/{r}/stargazers/history` (30 weeks per request). Measured figures, estimates and the 100/500/1,000 tables are in **PHASE-2-VALIDATION.md** and STAR-HISTORY.md. In short: 1 request per repository for a 30-week refresh (MEASURED page-1 size 1.6 KB, ~0.36 s), 4-27 requests for a full history of the sampled repositories (MEASURED); rate-limit numbers other than the anonymous 60/h are still DOCUMENTED only.

## Actions-specific
The Actions `GITHUB_TOKEN` cannot be assumed to behave like a PAT (lower REST limit, different GraphQL `viewer` behaviour). The smoke suite avoids `viewer`; **run it once from an Actions runner as well** to measure that bucket. UNKNOWN until then.

## Safe collection policy (provisional — set after measurement)
- Keep a hard stop when `rateLimit.remaining` drops below 20% of `limit` (implement in Phase 2 collector; `RateLimitError` already carries `resetAt`).
- Never run search calls faster than 2.1 s apart (implemented in `RestSearchProvider`).
- One collector job at a time (workflow `concurrency`), sequential requests only.
