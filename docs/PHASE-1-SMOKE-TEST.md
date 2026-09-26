# PHASE 1 — AUTHENTICATED SMOKE TEST

> **UPDATE (Phase 1.5, 2026-09-24):** the stargazer sections below are **superseded**. GitHub restricted the stargazer list endpoint on 2026-06-30 and shipped `stargazers/history` on 2026-09-04. See DATA-SOURCE-AUDIT-PHASE-1.5.md. The `stargazers.ts` smoke test and the stargazer providers are scheduled for removal and replacement with a star-history test.

**STATUS: NOT RUN. Phase 1 is NOT complete.**

Reason: no GitHub token was available in this environment (`GITHUB_TOKEN` / `GH_TOKEN` unset in the process, user and machine environment; no `gh` login). Per the phase rules the token is read only from the environment and is never hardcoded, so the authenticated tests could not be executed. **No authenticated number appears in this document because none was measured.**

What *was* done and verified: the full test harness, providers, error model and offline unit tests are built (54 tests passing, `tsc --noEmit` clean), and `npm run smoke` was executed without a token to confirm it fails safe (exit code 2, "NOT RUN", no token printed).

## How to run (needs a token)

```bash
# PowerShell:  $env:GITHUB_TOKEN = "<token>"      bash: export GITHUB_TOKEN=<token>
npm install
npm test               # offline, no token needed
npm run smoke          # runs rate-limit, graphql, search, star-history; writes results/*.json
npm run budget         # turns results into results/budget.md
```

Token needs: a classic or fine-grained PAT with **public repository read** only (no write scopes). Worst-case footprint of `npm run smoke`, by construction of the scripts: about 30 REST search/core calls, ~25 GraphQL requests, stargazer walks capped at 3 pages per repo on 3 repos. Results are written to `scripts/smoke/results/` (git-ignored). After running, paste the numbers into the sections below (or point to the JSON).

## What each script tests

| Script | Requirement covered | Checks |
|---|---|---|
| `scripts/smoke/rate-limit.ts` | REST auth, rate-limit info (#8, #10) | `/rate_limit` table (core/search/graphql limits); `/rate_limit` is free; 3 core calls decrement by 3; GraphQL bucket delta vs reported cost; search bucket present; invalid token maps to `AuthenticationError` |
| `scripts/smoke/graphql.ts` | GraphQL auth, query, batching, cost (#1, #3, #4, #9) | rateLimit-only query cost; sample 100 repos; batches of 1/10/25/50/100 in **one request each** with cost, latency and field-completeness counts; commit-count-since-30d variant cost; NOT_FOUND alias handling |
| `scripts/smoke/search.ts` | Search API, pagination (#5, #7) | 16 topic/language discovery queries (AI, agents, LLM, MCP, RAG, ML, Java, Spring, Kafka, Kubernetes, AWS, PostgreSQL, Redis, microservices, distributed systems, developer tools), new-entrants query, 3-page pagination with duplicate check, page beyond the 1,000 cap |
| `scripts/smoke/stargazers.ts` | Stargazer API, pagination (#6, #7) | tiny/medium/large sample: REST (`star+json`, last-page-first) vs GraphQL (`STARRED_AT DESC`) for a 7-day window; full reconstruction on the tiny repo (timestamps vs `stargazerCount`); REST deep-pagination on the large repo; batched newest-100 stargazers for all sample repos in one GraphQL request |

## Results

### Rate limits (rate-limit.ts)
| Item | Value |
|---|---|
| core limit / remaining / reset | **NOT MEASURED (authenticated)** |
| graphql limit | NOT MEASURED |
| search limit | NOT MEASURED |
| `/rate_limit` free? | NOT MEASURED |
| REST core cost per call | NOT MEASURED |

Only measurement available (from Phase 0, **unauthenticated**): `X-RateLimit-Limit: 60` on `api.github.com/repos/vercel/next.js`; ~15 unauthenticated Search API calls succeeded.

### GraphQL (graphql.ts)
| Item | Value |
|---|---|
| GraphQL authentication | NOT MEASURED |
| Batching works (1 request for N repos) | NOT MEASURED |
| Max batch tried / accepted | NOT MEASURED |
| Cost per batch (1/10/25/50/100) | NOT MEASURED |
| Latency per batch | NOT MEASURED |
| Fields populated (language/topics/license/lastCommit) | NOT MEASURED |
| Commit-count field extra cost | NOT MEASURED |
| Query used | see `buildRepositoriesQuery()` in `src/github/graphqlProvider.ts` (aliased `repository(owner:$oN, name:$nN)` + fragment + `rateLimit{cost limit remaining resetAt nodeCount}`) |
| Response shape | `data.rN` = Repository node or null; `data.rateLimit`; partial `errors[]` with `type: NOT_FOUND`, `path:[rN]` (shape handled by code and unit tests with **synthetic** fixtures, not yet confirmed against the live API) |

### Search (search.ts)
| Item | Value |
|---|---|
| Queries, requests, totalCount, retrieved per query | NOT MEASURED |
| Repos per request | NOT MEASURED (request asks for per_page=100) |
| Search bucket remaining | NOT MEASURED |
| Pagination behaviour / 1,000 cap | NOT MEASURED |

### Stargazers (stargazers.ts)
| Item | Value |
|---|---|
| REST star+json access | NOT MEASURED |
| GraphQL `STARRED_AT DESC` access | NOT MEASURED |
| Requests/cost per repo for 7-day window | NOT MEASURED |
| Deep-pagination limits (REST) | NOT MEASURED |
| Timestamps vs `stargazerCount` (reconstruction fidelity) | NOT MEASURED |
| Batched newest-100 for several repos, cost | NOT MEASURED |

**Known design consideration (reasoned, not measured):** a stargazer list contains only *current* stargazers. Users who un-starred vanish, so a curve rebuilt from timestamps will understate past star counts. The smoke test measures the gap on one repo; forward daily snapshots remain the source of truth.

## Unit-test evidence (offline, synthetic fixtures)

`npm test`: 5 files, 54 tests, all passing at time of writing. Covers: authentication configuration, response normalization (GraphQL + REST, valid and invalid), pagination (Link parsing, search paging, REST stargazer backward walk, GraphQL DESC cursor walk, malformed pages), rate-limit parsing (REST headers, GraphQL object), invalid responses, typed error mapping (401, 403 primary/secondary, 429, 5xx, network, invalid JSON, GraphQL RATE_LIMITED), and redaction of tokens from logs/errors. These prove the code handles the shapes we *expect*; they do not prove GitHub returns those shapes.
