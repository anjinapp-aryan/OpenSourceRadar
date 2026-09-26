# REUSE AUDIT — PHASE 1.5

Audit date: 2026-09-24. Supersedes conclusions in REUSE-AUDIT.md where stated. Method: shallow clones of every candidate, LICENSE files opened, source read, live probes of GitHub APIs. Anything not verified is marked **UNVERIFIED**. Repo star counts were read from the GitHub API earlier in the session; for three newer repos the unauthenticated API budget (60/h) was exhausted by the star-history probes, so their star counts are **not retrieved**.

## 0. Headline findings

1. **The ground moved: GitHub has a purpose-built star-history endpoint, and it makes our Phase 1 stargazer providers obsolete.**
   - Effective 2026-06-30 GitHub restricted `GET /repos/{o}/{r}/stargazers` and `/subscribers` to admins/collaborators ([changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/), read). The changelog names REST only; daily-stars-explorer's README states the GraphQL `Repository.stargazers` connection was restricted too (**third-party claim, not verified by us**).
   - Live probe today (unauthenticated): `GET /repos/vercel/next.js/stargazers` with `star+json` -> **401 "Requires authentication"**.
   - On 2026-09-04 GitHub shipped `GET /repos/{owner}/{repo}/stargazers/history` ([changelog](https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/), [docs](https://docs.github.com/en/rest/activity/starring)). **Verified live, unauthenticated, HTTP 200**: weekly buckets `{week, total, days[7]}`, 30 weeks/page, newest first, `Link` header with `rel="last"`, `Access-Control-Allow-Origin: *`, `ETag`, `Cache-Control: public, max-age=60`. Sum of `total` over all pages equalled `stargazers_count` **exactly on all three repos tested** (9,527 = 9,527; 404 = 404; 0 = 0).
2. **Existing projects already solve more than we assumed** — but none fits our constraints as a foundation:
   - `emanuelef/daily-stars-explorer` (MIT, Go): a complete, tested client for the new endpoint. **Design is reusable; code is Go.**
   - `FayezBast/repometeor` (Apache-2.0, Go + PostgreSQL + Next.js): a documented, deterministic momentum formula (`momentum-v1`) with confidence, eligibility and collections (Rising / Hidden Gems / New Entrants / Established). **Formula design reusable; the system needs Postgres and an always-on worker — rejected as foundation.**
   - `HalcyonVector/GitHub-Trending-Intelligence-` (MIT): the project Phase 0 wrongly recorded as "not found" (its repo name ends in a hyphen). FastAPI + Celery + PostgreSQL + Next.js. **Category seed data and momentum shape reusable; stack rejected.**
3. **Correction to Phase 0:** REUSE-AUDIT.md item 15 ("GitHub-Trending-Intelligence not found") is wrong. It exists at the URL above. `trending-collection` still could not be found.
4. **No candidate ships a TypeScript, database-free, static-JSON implementation of what we need.** The minimum custom code is now: a small star-history client, GraphQL snapshots (already built), a momentum scorer, and a rules classifier with seed data.

## 1. Candidate cards

Decision key: REUSE (use as-is) · ADAPT (copy/port with attribution) · COMPOSE (call as a service/dependency) · REFERENCE (read for design, write our own) · REJECT.

### 1.1 patrick-creates/rising-repos-tracker
- **URL** https://github.com/patrick-creates/rising-repos-tracker
- **License** MIT (LICENSE read: "Copyright (c) 2026 patrick-creates")
- **Activity** pushed 2026-09-24; data history from 2026-05-18; 0 stars; single maintainer
- **Relevant capabilities** daily REST snapshots of ~201 repos into per-repo `history.json`; Search-API discovery (`stars:>100 created:>cutoff topic:x`); lifetime-average velocity; Chart.js single-page dashboard (361 lines); README stats generator; 4 workflows (collect/discover/summarize/screenshot)
- **Reusable code** none worth lifting: `collect.js` is 65 lines of one-REST-call-per-repo; `discover.js` 100 lines with hard-coded AI topics; velocity in the dashboard is `stars_per_day_at_add` (lifetime average) falling back to history slope
- **Reusable architecture** commit-data-to-git via Actions; JSON history; static dashboard; `git diff --cached --quiet ||` idiom
- **Limitations** no weekly/monthly windows, no movers, no categories, no classifier; one file per repo per repo (not per day); its own snapshots are now unnecessary for star history because GitHub returns history directly; summarize.js needs a GitHub Models token
- **License concerns** none (MIT; keep notice if any file copied)
- **Per-component decisions**

| Component | Decision | Why |
|---|---|---|
| Repository discovery (discover.js) | REFERENCE | Query shape is 3 lines; our topic lists are broader and config-driven |
| GitHub Search queries | REFERENCE | Phase 1 `RestSearchProvider` already covers this with throttling and typed errors |
| Daily snapshots (collect.js) | REJECT | REST 1 call/repo; our GraphQL batch provider replaces it (pending live cost measurement) |
| Velocity calculation | REJECT | Lifetime average; superseded by exact windowed growth |
| JSON storage layout | REFERENCE | Per-repo files scale poorly; we use day-files/derived files |
| GitHub Actions workflows | REFERENCE | Commit idiom + off-peak cron; oss-radar-ai's guard job is the better pattern |
| Repository tracking model (`repos.json`) | REFERENCE | Registry concept only |
| Dashboard patterns (index.html) | REJECT | Single HTML + Chart.js; we build Next.js |
- **Decision: REFERENCE.** It cannot be the data-collection foundation (Q6 = no). Forking it would import an AI-only, lifetime-velocity, one-call-per-repo design we would immediately replace.

### 1.2 emanuelef/daily-stars-explorer
- **URL** https://github.com/emanuelef/daily-stars-explorer
- **License** MIT ("Copyright (c) 2024 Emanuele Fumagalli")
- **Activity** pushed 2026-09-13 (git log) / 2026-09-18 (API); 404 stars; active, already migrated to the new endpoint
- **Relevant capabilities** `starhistory/` package (Go, 529-line client + 251-line history + types, ~1,900 lines with tests) for `stargazers/history`; week-to-day expansion; derived stats (max periods etc.); in-memory cache; rate-limit/`Retry-After` handling with capped retries and page concurrency; `action.yml` GitHub Action generating star charts (PNG/SVG/Mermaid); React frontend; CSV/JSON export; repo compare
- **Reusable code** none directly (Go; we are TypeScript). Algorithms worth porting (small): parse `rel="last"` from `Link`, fetch page 1 first, fetch remaining pages with bounded concurrency, sort weeks ascending, **normalise week overlap** when the current week rolls to a new Sunday mid-fetch (pagination shifts by one week — a real bug class documented in `client.go`), expand weeks to per-UTC-day using the repo creation date as anchor
- **Reusable architecture** star history only from the aggregate endpoint; no PAT needed; cost scales with repo age (`ceil(weeks/30)`), not star count; ~1–33 requests per repo (its README; consistent with our 18/20/6 pages measured)
- **Limitations** Go; server app with cache; hourly star data gone (no API provides it now); README notes totals can differ from `stargazers_count` by a star or two (deleted/suspended accounts) — we saw 0 difference on 3 repos
- **License concerns** none for ports of ideas; if code is translated, keep MIT notice. Go module dependency licenses **not audited**
- **Decision: REFERENCE** for the client design (write a ~100-line TS port following its edge-case handling; MIT notice retained in `THIRD_PARTY.md` if structure is closely followed). Its `action.yml` chart Action is a **COMPOSE** option for README badges only, not needed for the product.

### 1.3 star-history/star-history
- **URL** https://github.com/star-history/star-history
- **License** MIT ("Copyright (c) 2025 Star History")
- **Activity** pushed 2026-09-12; ~9.5k stars; issue #553 "use new endpoint" closed 2026-09-05
- **Relevant capabilities** TypeScript monorepo: Next.js 14 frontend, Node backend, `shared/` d3 SVG chart (`shared/packages/xy-chart.tsx`, 437 lines, d3-scale/selection/shape + dayjs + lodash), compare/legend/tooltip components, `gh/` BigQuery/SQLite tooling, badge/OG-card generation
- **Reusable code** `xy-chart.tsx` + `components/ToolTip.tsx` + axis/legend helpers (imperative d3-on-SVG, MIT). **Not** the API client: in this checkout `shared/common/api.tsx` still calls `/repos/{repo}/stargazers` (now restricted for public repos) and samples pages — obsolete for our purpose
- **Reusable architecture** none needed
- **Limitations** imperative d3 tied to their SVG/watermark design; adapting costs more than using a maintained React chart library for our sparklines, bars and line comparison
- **License concerns** none (MIT). Note dependency `lodash`, d3 (ISC/BSD) — fine
- **Decision: REFERENCE.** Q7 answer: **no** — not worth adapting for our charts; use a chart library. Do not use its API client (obsolete).

### 1.4 SahirVhora/trending-repo
- **URL** https://github.com/SahirVhora/trending-repo
- **License** MIT ("Copyright (c) 2026 Sahir Vhora")
- **Activity** pushed 2026-08-23; 0 stars; daily snapshots from 2026-06-06 in `data/trending_YYYY-MM-DD.json`
- **Relevant capabilities** scrapes github.com/trending (552-line `fetch_trending.py`), snapshot comparison (entered/left/stayed), markdown report, Flask API, 770-line single HTML dashboard with search/sort/charts/CSV export, 3 workflows
- **Reusable code** none in TS. The compare logic is ~40 lines and trivially rewritten
- **Reusable architecture** daily JSON snapshots + compare — same as ours
- **Limitations** built on the trending-page scrape (ToS/stability risk we chose not to depend on); Python; no star growth of its own; top ~25 only
- **License concerns** none
- **Decision: REFERENCE.** Q9 answer: **no reusable snapshot/dashboard functionality**.

### 1.5 bonfy/github-trending
- **URL** https://github.com/bonfy/github-trending
- **License** MIT ("Copyright (c) 2022 Kai Chen")
- **Activity** pushed 2026-09-24; 1,163 stars
- **Relevant capabilities** daily markdown archive of the trending page (2015–2026), `scraper.py` (pyquery), one `schedule.yml`
- **Reusable code** none
- **Reusable architecture** none
- **Limitations** markdown output not JSON; trending-scrape based; Python
- **License concerns** none
- **Decision: REJECT** (as a component). Interesting only as a free multi-year archive of what GitHub Trending showed; not needed.

### 1.6 Marcos66236/github-stars-history
- **URL** https://github.com/Marcos66236/github-stars-history
- **License** MIT ("Copyright (c) 2026 Marcos66236")
- **Activity** pushed 2026-09-18/19; 277 stars
- **Relevant capabilities** single 270-line Python file already migrated to `/repos/{repo}/stargazers/history`; daily/weekly growth, peak detection, comparison, CSV/JSON
- **Reusable code** none — same job as daily-stars-explorer, weaker tested
- **Limitations / concerns** README is heavily marketing for buygithub.com (a service that sells GitHub stars); `README`/search snippet inconsistently describes the endpoint. Reputational risk of associating with it
- **License concerns** MIT is fine; **reputation** is the concern
- **Decision: REJECT.**

### 1.7 FayezBast/repometeor  (new discovery)
- **URL** https://github.com/FayezBast/repometeor
- **License** Apache-2.0 (LICENSE read; NOTICE file present: "Copyright 2026 RepoMeteor contributors")
- **Activity** last commit 2026-08-01; stars **not retrieved**
- **Relevant capabilities** momentum engine on aggregate snapshots: 6h/24h/7d windows; pure versioned `momentum-v1`; percentile-rank normalisation of `log1p` features with 1% winsorisation; weights 0.32 star velocity / 0.23 relative growth (20-star floor) / 0.17 acceleration / 0.10 fork velocity / 0.13 activity / 0.05 freshness; confidence multiplier `0.75 + 0.25·confidence`; eligibility rules (>=5 stars, description, non-fork/archived); collections Rising, Daily, Weekly, **Hidden Gems, New Entrants, Established Movers**; reason strings; anomaly flags; API, CLI, Atom feed, badges. Scoring package ~1,000 lines of Go plus ~1,300 lines of tests (3,250 total)
- **Reusable code** none directly (Go)
- **Reusable architecture / design** the *formula and collection definitions* in `docs/SCORING.md` are the best documented prior art for our momentum engine
- **Limitations** Go API + worker + PostgreSQL + Docker Compose — violates no-DB/no-backend; history only from its own accumulating snapshots (no star-history endpoint use — it predates it/does not call it); demo mode uses fictional data
- **License concerns** Apache-2.0: if we port code or closely follow the formula text, retain copyright + license notice, mark changes, carry over NOTICE contents where applicable; no trademark use. A formula (idea) is not copyrightable, but a close TS translation is a derivative work -> comply
- **Decision: ADAPT (design only).** Port the *ideas* (percentile-rank of log1p, winsorise, confidence, eligibility, collections) into a TS scorer; cite RepoMeteor in `THIRD_PARTY.md`. **REJECT as foundation.**

### 1.8 HalcyonVector/GitHub-Trending-Intelligence-  (previously mis-recorded)
- **URL** https://github.com/HalcyonVector/GitHub-Trending-Intelligence-
- **License** MIT ("Copyright (c) 2026 Sagnik (@halcyon-vector)")
- **Activity** last commit 2026-09-14; stars not retrieved
- **Relevant capabilities** momentum 0–100 (`normalize_log` against fixed p95 constants; weights 0.45 star / 0.20 fork / 0.20 contributor / 0.10 commit / 0.05 issue, x1.2 if <30 d, x1.1 if <90 d); 15 categories with `keywords` and `github_topics` seeds (in `infra/schema.sql` lines 247–263); keyword∩topics classifier (~30 lines, Python); radar status; weekly digest; AI analyst (Ollama/Groq); Next.js dashboard; FastAPI + Celery + PostgreSQL; 4 workflows
- **Reusable code** the **category seed data** (names, keywords, GitHub topics) is directly reusable data; classifier logic trivial
- **Limitations** FastAPI + Celery + Postgres (all explicitly excluded); fixed p95 constants are arbitrary; AI analyst out of scope; only 15 categories, our list needs 13 AI + 19 engineering
- **License concerns** MIT; keep notice when copying seed lists
- **Decision: ADAPT (data) / REFERENCE (scoring, UI ideas). REJECT as foundation.**

### 1.9 caarlos0/starcharts
- **URL** https://github.com/caarlos0/starcharts
- **License** **unresolved** — `git ls-files` shows no LICENSE file in the default-branch tree (README license claims **not checked**)
- **Activity** last commit 2026-09-01; stars not retrieved
- **Capabilities** Go service rendering star charts; smart sampling for big repos (old stargazers-based approach)
- **Decision: REJECT** (license unresolved -> copy nothing; Go; obsolete data path).

### 1.10 Carry-over candidates from Phase 0 (status)
| Project | Decision now | Note |
|---|---|---|
| bowjoww/repotide (MIT) | REUSE parser **only if** we scrape trending at all | Trending scrape is optional; may be dropped entirely (see ARCHITECTURE-PHASE-1.5) |
| LokeshNanda/oss-radar-ai (MIT) | REFERENCE | Guarded double-cron workflow |
| isboyjc/github-trending-api | REFERENCE (LICENSE file still unconfirmed) | Optional fallback feed only |
| pingcap/ossinsight (Apache-2.0) | COMPOSE (collections membership only) | Rankings dead since 2026-03-01; **also** its star-history curve endpoint is now redundant |
| tianpai/dailyRepo, EvanLi/Github-Ranking, mshibanami/GitHubTrendingRSS, ai-martin-lau/github-trending-radar, huchenme/github-trending-api | REFERENCE / REJECT unchanged | |
| vitalets/github-trending-repos | REJECT (no license) | |

### 1.11 Found but not open source / not inspected
GitExplorer, GitStar, Trendshift, Apify actors ("GitHub Trending Tracker", "Topic Momentum Tracker"): hosted or paid services; not inspected, cannot be reused as code. Not candidates.

## 2. Capability decisions (Phase 1.5)

| Capability | Phase 1 plan | Phase 1.5 decision | Source |
|---|---|---|---|
| Daily star history | own stargazer providers | **COMPOSE**: GitHub `stargazers/history` | GitHub API, verified live |
| Weekly / monthly star growth | own snapshots over time | **COMPOSE**: computed from the same endpoint on day 0 | GitHub API |
| Historical backfill | stargazer walk | **COMPOSE**: full history = `ceil(weeks/30)` requests | GitHub API |
| Star-history client (TS) | – | **ADAPT (port ~100 lines)** | daily-stars-explorer design |
| Repository snapshots (forks, issues, topics, license, pushed) | GraphQL batch (Phase 1) | **KEEP** (still needed; live cost unmeasured) | Phase 1 code |
| Discovery | Search provider (Phase 1) | **KEEP** | Phase 1 code |
| Momentum scoring | BUILD | **ADAPT design** (BUILD code in TS) | RepoMeteor momentum-v1 |
| Collections (Rising, Hidden Gems, New Entrants, Established Movers) | BUILD | **ADAPT design** | RepoMeteor |
| Biggest movers | BUILD | **BUILD** (rank(t) vs rank(t-7d) computable from history alone) | – |
| Category seed data | OSS Insight + topics | **ADAPT** seed lists (+ extend to requested 13 AI / 19 Eng) | Trending-Intelligence schema.sql, OSS Insight collections |
| Classifier | BUILD | **BUILD** (rules; ~50 lines) | – |
| Charts | chart lib | **COMPOSE** chart library | npm |
| GitHub Trending scrape | ADAPT repotide | **DEMOTE to optional / drop** | – |
| Dashboard UI | BUILD | **BUILD** | – |
| Snapshot compaction | BUILD | **DEFER** (much less needed) | – |

## 3. Final decision (the ten questions)
See ARCHITECTURE-PHASE-1.5.md §7 for the answers.
