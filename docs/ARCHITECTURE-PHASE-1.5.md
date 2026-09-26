# ARCHITECTURE — PHASE 1.5

Status: audit and recommendation only. No Phase 2 code was written. Basis: REUSE-AUDIT-PHASE-1.5, FEATURE-MATRIX-PHASE-1.5, LICENSE-AUDIT-PHASE-1.5, DATA-SOURCE-AUDIT-PHASE-1.5.

## 1. What is different from ARCHITECTURE.md (Phase 0)

1. **Star history no longer needs our own accumulated snapshots.** GitHub's `stargazers/history` returns exact daily counts for any public repository, unauthenticated, 30 weeks per request (verified live). Weekly, monthly, rising, movers and persistence are computable on day 0.
2. **The Phase 1 stargazer providers must go.** The list endpoint is restricted (401 unauthenticated; admin/collaborator only per GitHub's changelog), and GraphQL's `stargazers` is reported restricted by a third party.
3. **GitHub Trending scraping is no longer needed** and is demoted to an optional cross-check (or dropped). The ToS/stability risk buys us nothing we cannot compute.
4. **Scoring has prior art.** RepoMeteor's `momentum-v1` (percentile-ranked, winsorised, confidence-weighted, with eligibility and named collections) is the most mature open design; we adapt its design, not its stack.
5. **Category seed data exists** (Trending-Intelligence, MIT) and OSS Insight collection membership still works.

## 2. Option comparison

| | A. Custom collectors on GitHub APIs | B. rising-repos-tracker code + concepts | C. Existing trending project + existing star-history project + custom classifier/momentum | D. **Composed minimal pipeline (recommended)**: A + new star-history endpoint + adapted RepoMeteor scoring design + adapted seed categories |
|---|---|---|---|---|
| Needs DB/backend | no | no | **yes** (RepoMeteor: Postgres+Go; Trending-Intelligence: Postgres+Celery; star-history/daily-stars-explorer: servers) | no |
| Reuses existing code | Phase 1 code | ~165 lines of JS we would replace | almost none in our stack (Go/Python) | Phase 1 (HTTP, errors, GraphQL snapshots, search) + ported ideas |
| Day-0 weekly/monthly | only with stargazer backfill (now restricted) | ✗ (lifetime average) | depends | **yes** (star-history endpoint) |
| Star history source | stargazers (dead) | own daily snapshots (slow) | third-party services | **GitHub endpoint** |
| Momentum score | build | lifetime velocity | build (RepoMeteor is Go, not embeddable) | adapt design, build TS (~200 lines) |
| Categories | build | none | seed from Trending-Intelligence | adapt seed + rules |
| Zero-cost on Vercel + Actions | yes | yes | **no** | **yes** |
| Custom code | most | most (after discarding its parts) | classifier + scorer + glue to two servers we can't host | **least that still meets the constraints** |
| Verdict | superseded by D (same but wrong star source) | REJECT as foundation | REJECT (backend requirements; nothing embeddable) | **SELECT** |

Why not fork or run an existing system: every existing system that has both history and momentum (RepoMeteor, Trending-Intelligence) is built on PostgreSQL and an always-on worker, and neither uses the new endpoint. Every TypeScript/JS project that is database-free (rising-repos-tracker, repotide) lacks windows, movers and categories. The union we need is small enough that composing is simpler than adapting either stack.

## 3. Selected architecture (Option D)

```
GitHub Actions (cron, guarded)                       Git repo (data)                     Vercel (static / SSG)
┌───────────────────────────────────┐                ┌─────────────────────────────┐     ┌────────────────────────┐
│ discover   GitHub Search           │──candidates──▶│ data/registry.json           │     │ Next.js (TypeScript)   │
│ history    stargazers/history p1   │──daily stars─▶│ data/stars/*.json (30 weeks) │     │ reads derived JSON at   │
│ snapshot   GraphQL batch (P1 code) │──forks/issues▶│ data/snapshots/YYYY-MM-DD    │─────▶ build time; charts     │
│ classify   rules + seed lists      │──tags────────▶│ data/derived/{ai,swe}/*.json │     │ client-side; detail page │
│ score      momentum (TS, adapted)  │──rankings────▶│                              │     │ may call star-history   │
└───────────────────────────────────┘                └─────────────────────────────┘     │ endpoint from browser   │
                                                                                          └────────────────────────┘
```

No database, no FastAPI, no Redis, no Celery, no LLM in ranking, no paid API.

### Component sourcing

| Component | Source | Class |
|---|---|---|
| HTTP client, typed errors, logger, rate-limit parsing | Phase 1 code (done, tested offline) | KEEP |
| GraphQL repository snapshots | Phase 1 `GraphQLRepositoryProvider` | KEEP (live cost still unmeasured) |
| Search discovery | Phase 1 `RestSearchProvider` | KEEP |
| **Star-history client** | GitHub endpoint; design from daily-stars-explorer `starhistory/client.go` | **NEW, ADAPT (port ~100 lines TS)** |
| Stargazer providers (REST + GraphQL) + `stargazers.ts` smoke test | Phase 1 | **REMOVE** |
| Momentum scoring, collections (Rising, Hidden Gems, New Entrants, Established Movers) | RepoMeteor `momentum-v1` design | **ADAPT design; BUILD TS** |
| Biggest movers | rank now vs rank 7 days ago from the same history | BUILD (small) |
| Classifier | keyword/topic rules + seed lists | BUILD (~50 lines) + ADAPT seed data |
| Category seeds | Trending-Intelligence `schema.sql` lines 247–263 (MIT), OSS Insight collections (membership) | ADAPT / COMPOSE |
| Charts | maintained chart library (not star-history's d3 code) | COMPOSE |
| Guarded cron + commit idiom | oss-radar-ai, rising-repos-tracker | REFERENCE |
| Dashboards | – | BUILD |
| Trending scrape (repotide parser) | optional | DROP unless a cross-check is wanted |

## 4. Star-history client — required behaviours (from daily-stars-explorer, verified where noted)
1. Fetch page 1; read `rel="last"` from `Link`; fetch remaining pages only for full history. (Link verified live.)
2. Windowed refresh (daily job) = page 1 only: 30 weeks cover the 7/30/90-day windows.
3. Normalise **week overlap**: if the current week rolls over a Sunday while pages are fetched, pagination shifts by one week and adjacent pages overlap (documented in `client.go`; not reproduced by us).
4. Expand weeks to days with `days[0]` = Sunday; current week has trailing zeros; docs say boundaries "are not guaranteed to align with UTC".
5. Honour `Retry-After`; treat 422 as "spammed" (documented); cap page concurrency; typed errors (reuse Phase 1 hierarchy).
6. Tolerate `total` differing from `stargazers_count` by a star or two (README claim; 0 difference in our 3 samples).
7. Optionally send `If-None-Match` (ETag present; 304 cost behaviour **unverified**).

## 5. Data layout (revised, smaller than Phase 0)
- `data/registry.json` – tracked repos and tags.
- `data/stars/{shard}.json` – per repo latest 30 weeks of `days` (compact ints). About 210 numbers/repo -> ~1 KB/repo; 1,000 repos ≈ 1 MB, refreshed in place (no per-day accumulation needed).
- `data/snapshots/YYYY-MM-DD.json` – GraphQL fields that have no history endpoint (forks, issues, pushedAt, commits). Accrues; compact day-files as in ARCHITECTURE.md §4. Only needed for fork/activity signals.
- `data/derived/{ai|swe}/{weekly|monthly|rising|movers|new|categories}.json` – what the site renders.
Compaction/downsampling (Phase 0 BUILD item) is **deferred**: star history no longer grows in git.

## 6. Risks and open items
1. **All numbers here are unauthenticated.** Authenticated rate cost, ETag/304 behaviour and GraphQL cost/repo are unmeasured (no token). Run the Phase 1 smoke tests, replacing `stargazers.ts` with a `star-history.ts` script.
2. **New endpoint stability.** Brand new (2026-09-04); could gain limits or change shape. Mitigation: fixtures, typed `InvalidResponseError`, one adapter class.
3. **Actions token budget.** 1,000 repos = 1,000 requests per refresh = a full hourly budget of `GITHUB_TOKEN` (1,000/h documented). Use a PAT secret, shard across hours, or lower refresh frequency for dormant repos.
4. **Contributors / issue-opened signals unverified.** Do not put them in v0 scoring.
5. **Un-starred/suspended users.** Endpoint appears to count current stars only; a repo that lost stars shows past growth slightly understated. Tolerable for ranking.
6. **GraphQL stargazers restriction is a third-party claim.** Irrelevant to the design now.
7. **RepoMeteor licensing.** Apache-2.0 notice/NOTICE handling if any text/code is ported.
8. **Marcos66236 and starcharts** must not be used (reputation / no license).
9. **Vercel Hobby non-commercial terms** and deploy limits (unverified) unchanged from Phase 0.

## 7. Final decision

1. **What existing repository should we reuse?** No single repository as a foundation. Reuse (COMPOSE) **GitHub's `stargazers/history` endpoint**; reuse (ADAPT) design from **emanuelef/daily-stars-explorer** (client), **FayezBast/repometeor** (momentum formula and collections; Apache-2.0) and **HalcyonVector/GitHub-Trending-Intelligence-** (category seed data; MIT).
2. **What exact code should we reuse?** No code is copied verbatim from these projects. Concretely: (a) daily-stars-explorer `starhistory/client.go` behaviours listed in §4, re-written in TS; (b) RepoMeteor `docs/SCORING.md` structure (log1p, 1% winsorisation, percentile ranks, confidence multiplier, eligibility, collections); (c) the 15 category rows (keywords + GitHub topics) in Trending-Intelligence `infra/schema.sql` lines 247–263 as data. From Phase 1: HTTP client, errors, logger, GraphQL snapshot and search providers stay.
3. **What exact architecture should we adapt?** Option D: Actions cron -> Search + star-history + GraphQL collectors -> committed JSON (registry, stars, snapshots, derived) -> Next.js SSG on Vercel. The commit-data-to-git + JSON idea comes from rising-repos-tracker; guarded cron from oss-radar-ai.
4. **Should our current stargazer implementation remain?** **No. Remove both providers and the stargazer smoke script**; replace with a star-history provider.
5. **Should we use GitHub's new star-history API?** **Yes** — verified live: 200 unauthenticated, exact sums on 3 of 3 repos, 1 request for a 30-week window, CORS `*`.
6. **Can rising-repos-tracker become our data-collection foundation?** **No.** It is 165 lines of REST-per-repo snapshot code with lifetime-average velocity and AI-only discovery; its purpose is superseded by the endpoint and by our GraphQL batch. Keep as REFERENCE.
7. **Can star-history/star-history provide reusable chart/history components?** **Not worth it.** Its API client is obsolete in the checkout, and its chart is imperative d3 SVG (437 lines) with their branding; a maintained React chart library is less code. REFERENCE only.
8. **Can daily-stars-explorer provide reusable history/API logic?** **Yes as design, not as code** (Go). Port its client algorithm (~100 lines TS); it is the most complete, tested handling of the new endpoint, including the week-rollover edge case.
9. **Can trending-repo provide reusable snapshot/dashboard functionality?** **No.** Python + trending-scrape; its snapshot comparison is ~40 lines and its dashboard is a single HTML file. REFERENCE.
10. **What functionality still genuinely needs to be built?** (a) a small TS star-history provider; (b) the momentum scorer and collections (adapting RepoMeteor's design); (c) biggest-movers ranking (rank delta over two windows); (d) the rules classifier with 13 AI + 19 engineering categories (seed data adapted; taxonomy extended by us); (e) the derived-JSON generator and workflows; (f) both dashboards, category and repo-detail UI (glue around a chart library). Not needed any more: stargazer backfill, snapshot compaction, trending scrape.
