# DATA SOURCE AUDIT

Audit date 2026-09-24. Live probes were run from a residential Windows machine, unauthenticated. Limits marked (doc) come from GitHub/OSS Insight documentation and were not stress-tested.

## 1. Sources evaluated

| Source | Gives | Auth | Limit | Verified | Verdict |
|---|---|---|---|---|---|
| GitHub REST `GET /repos/{o}/{r}` | stars, forks, watchers, open issues, topics, language, created/pushed, license, archived | token | unauth 60/h **(verified: `X-RateLimit-Limit: 60`)**; Actions `GITHUB_TOKEN` 1,000/h/repo (doc); PAT 5,000/h (doc) | yes (unauth) | Secondary — one call per repo is expensive |
| GitHub **GraphQL** `repository(...)` aliases / `nodes(ids:[...])` | same fields for up to ~100 repos per request; `stargazerCount`, `forkCount`, `repositoryTopics`, `primaryLanguage` | token required | 5,000 points/h; ~1 point per 100 nodes (doc) | not run (needs token) | **Primary snapshot source** |
| GitHub Search API `search/repositories` | discovery: `created:>D stars:>N topic:x`, `pushed:>D` | none / token | unauth 10/min; auth 30/min (doc); max 1,000 results per query | yes (worked ~15 unauth calls) | Primary discovery source |
| github.com/trending HTML (`?since=daily|weekly|monthly`, `/{language}`) | ~20–25 repos with "N stars this week", forks, language | none | none published; datacenter-IP blocking risk | **yes: HTTP 200, 686 KB, 20 `Box-row` items, "stars this week" present** | Cold-start + cross-check; **must be optional** |
| GitHub stargazers with timestamps `GET /repos/{o}/{r}/stargazers` + `Accept: application/vnd.github.star+json` | `starred_at` per star; 100/page | token | counts against REST limit | not run | Cold-start backfill for top candidates only (fetch last 1–3 pages via `Link` header) |
| OSS Insight `api.ossinsight.io/v1` | collections list, collection membership, stargazer history (weekly), ranking endpoints | none | 600 req/h/IP, 1,000/min global (doc) | yes | **Rankings dead** (`unavailable_since 2026-03-01`, capture ~0.3%). Membership + history OK |
| GH Archive / BigQuery | full event firehose | none / GCP | 1 TB/mo free BigQuery (doc); hourly files ~100 MB+ | no | Reject: heavy, needs BigQuery account, OSS Insight's own capture from this source degraded |
| isboyjc JSON feed (jsDelivr / raw) | mirror of trending scrape, 4×/day | none | CDN | yes (sample read from repo) | Optional fallback; third-party dependency |
| Own snapshot history | stars/forks/issues per day | — | — | pattern proven by rising-repos-tracker (6.3 MB / 201 repos / ~4 mo, pretty-printed) | **The only durable source of true velocity** |

## 2. Findings

1. **GitHub has no official trending API.** All "trending" projects scrape HTML (repotide, isboyjc, huchenme, GitHubTrendingRSS, vitalets). The HTML selectors (`article.Box-row`, `.float-sm-right`, `a.Link--muted`) can change; repotide's parser had 20 rows parse-able today.
2. **Search API ≠ trending.** encoreshao and oss-radar-ai rank *newly created repos by total stars*. Good for new entrants, wrong for "rising" among established repos.
3. **True star velocity needs deltas.** Two options only: (a) own daily snapshots (free, accrues over time), (b) stargazer timestamps (immediate, ~1–3 calls/repo). Use both: (b) on day 0 for the initial tracked set, (a) forever after.
4. **Batching matters.** REST = 1 call/repo (rising-repos-tracker: 201 calls). GraphQL = ~1 call/100 repos. A 5,000-repo tracked set is ≈ 50 GraphQL calls/run vs 5,000 REST calls (exceeds 1,000/h Actions token). GraphQL is required at scale.
5. **Weekly/monthly trending on day 1.** GitHub's own weekly/monthly scrape gives immediate "stars gained" while own history accumulates; after 30 days own numbers take over.
6. **Category signal.** GitHub topics (free in GraphQL/REST) + OSS Insight collection membership (still live) + language + description keywords. No LLM required.
7. **Data volume.** Pretty-printed per-repo JSON ≈ 240 B/repo/day (measured). A compact day-file `{repo_id:[stars,forks,issues]}` ≈ 12–15 B/repo/day → 5,000 repos ≈ 25 MB/yr in git. Acceptable; compact monthly and downsample beyond 90 days.

## 3. Rate-budget plan (per run, Actions `GITHUB_TOKEN`, 1,000 req/h)

| Step | Calls | Notes |
|---|---|---|
| Snapshot tracked set (GraphQL, 100/req) | ~50 for 5,000 repos | daily |
| Search discovery | ~40 (queries × pages) | 1 s+ spacing, ≤30/min |
| Trending scrape | 3 periods × ~15 languages ≈ 45 page loads | optional, 1 s spacing, descriptive UA |
| Stargazer backfill (new entrants) | ≤ 200 | only newly tracked repos |
| Total | < 400 | well within budget |

## 4. Risks per source
- Trending HTML: markup change / IP block → mitigated by fixture tests, fallback to isboyjc feed, and own-snapshot primary path.
- Search API: 1,000-result cap, secondary rate limits → narrow queries by date/topic windows.
- `GITHUB_TOKEN` 1,000/h is shared across the workflow's jobs; keep one collection job.
- OSS Insight: beta, degraded; treat as optional and cache.
- Unverified live: GraphQL batching numbers and stargazer-page cost need a token-authenticated smoke test in Phase 2.
