# REUSE AUDIT — OpenSource Radar

Audit date: 2026-09-24. Method: shallow `git clone` of each candidate, read LICENSE file, workflows, scripts and data samples; live probes of external data sources. README claims were checked against code where noted. Anything not verified is marked **UNVERIFIED**.

Rule: REUSE > ADAPT > COMPOSE > BUILD.

## 1. Headline findings

1. **No candidate covers the goal.** No project combines weekly + monthly + rising + movers + new entrants + categories + history + Next.js/Vercel + zero DB. Closest is `patrick-creates/rising-repos-tracker` (history + velocity + Actions + JSON, but flat AI-only list, single HTML file, days-old project).
2. **OSS Insight event-derived rankings are broken.** Live probe of `api.ossinsight.io/v1/trends/repos/` and `/collections/{id}/ranking_by_stars/` returns empty rows with `data_quality.status = "unavailable"`, `unavailable_since: 2026-03-01`, event capture at ~0.3% of baseline. Do NOT depend on it for trending/movers. Still working: `/collections/` (list), `/collections/{id}/repos/` (membership), `/repos/{o}/{r}/stargazers/history/` (historical curve, HTTP 200; freshness of recent points not verified).
3. **Two named candidates do not exist under those names**: `trending-collection` (search returned only unrelated repos) and `GitHub-Trending-Intelligence` (nearest is `LokeshNanda/oss-radar-ai`). `github-trending-api` is two different repos (huchenme: stale since 2023; isboyjc: alive). `repotide` resolves to `bowjoww/repotide` (0 stars, MIT, Next.js). `rising-repos-tracker` resolves to `patrick-creates/rising-repos-tracker`.
4. **No project has a usable category system for AI vs Software Engineering.** Only `encoreshao/github-trending` (25 hard-coded topics) and `dailyRepo` (6 categories, MongoDB) have anything.
5. **Best building blocks are small and MIT**: repotide's trending parser (cheerio, ~110 lines), rising-repos-tracker's snapshot/discover pattern, oss-radar-ai's guarded double-cron workflow.

## 2. Candidate table

| # | Project | Stars | License (file checked) | Last push | Verdict |
|---|---|---|---|---|---|
| 1 | patrick-creates/rising-repos-tracker | 0 | MIT (LICENSE read) | 2026-09-24 | ADAPT pattern |
| 2 | bowjoww/repotide | 0 | MIT (LICENSE read) | 2026-05-01 | ADAPT parser + route structure |
| 3 | isboyjc/github-trending-api | 29 | MIT per GitHub API; **LICENSE file not seen** (checkout failed on Windows-invalid filenames) — re-verify | 2026-08-26 | REFERENCE / optional fallback feed |
| 4 | huchenme/github-trending-api | 834 | MIT (LICENSE present) | 2023-01-06 | REFERENCE only (stale) |
| 5 | encoreshao/github-trending | 57 | MIT (LICENSE read) | 2026-09-24 | REFERENCE |
| 6 | LokeshNanda/oss-radar-ai | 23 | MIT (LICENSE read) | 2026-09-21 | REFERENCE |
| 7 | tianpai/dailyRepo | 4 | MIT (LICENSE read) | 2026-08-22 | REJECT (MongoDB) |
| 8 | EvanLi/Github-Ranking | 12212 | MIT (LICENSE read) | 2026-09-24 | REFERENCE |
| 9 | mshibanami/GitHubTrendingRSS | 366 | MIT (LICENSE read) | 2026-09-24 | REFERENCE |
| 10 | vitalets/github-trending-repos | 3008 | **NONE — no LICENSE file** | 2025-11-23 | REFERENCE idea only; copy nothing |
| 11 | ai-martin-lau/github-trending-radar | 7 | MIT (LICENSE read) | 2026-06-23 | REFERENCE |
| 12 | pingcap/ossinsight | 2509 | Apache-2.0 (fetched) | 2026-09-08 | REJECT as engine; use collections membership only |
| 13 | star-history/star-history | 9526 | MIT (fetched) | 2026-09-12 | REFERENCE (technique) |
| 14 | trending-collection | — | not found | — | N/A |
| 15 | GitHub-Trending-Intelligence | — | not found | — | N/A |

## 3. Per-candidate detail (20-point audit)

### 3.1 patrick-creates/rising-repos-tracker — ADAPT
1. https://github.com/patrick-creates/rising-repos-tracker
2/3. MIT; LICENSE: "Copyright (c) 2026 patrick-creates".
4/5. 0 stars; pushed 2026-09-24; history in data starts 2026-05-18 (clone was shallow, so commit count not meaningful).
6. Architecture: Actions cron → Node script → JSON committed to repo → single `index.html` on GitHub Pages.
7. Node 20, vanilla JS (scripts total 510 lines).
8/9. GitHub REST `GET /repos/{o}/{r}` with `GITHUB_TOKEN`, 200 ms delay per repo (201 repos ≈ 201 calls/day). Discovery via Search API.
10. Yes: `data/{owner}/{repo}/history.json`, daily `{date, stars, forks, watchers, open_issues, description}`; 6.3 MB for 201 repos over ~4 months.
11/12. Weekly/monthly views not implemented as such (dashboard internals **UNVERIFIED**); derivable from history.
13. `stars_per_day_at_add` = lifetime average (stars ÷ age); README table uses history-based Stars/day.
14. None. 15. Single HTML file. 16. Four workflows: collect (daily 05:17 UTC), discover, summarize, screenshot. 17. Static, trivially Vercel-hostable. 18. None. 19. Active, one maintainer, very young. 20. Pattern reusable; the collector is 65 lines so copying is cheaper than depending.
Weaknesses: AI-only hard-coded topics in discover.js; one file per repo (thousands of tiny files at scale); git history growth; summarize.js targets `models.inference.ai.azure.com` (needs a GitHub Models token; optional).
**Reuse:** snapshot pattern, discover queries (`stars:>100 created:>cutoff topic:x`), off-peak cron, `git diff --cached --quiet ||` commit idiom.

### 3.2 bowjoww/repotide — ADAPT
2/3. MIT; LICENSE "Copyright (c) 2026 Joow Labs".
4/5. 0 stars; single commit 2026-05-01.
6/7. Next.js 15 App Router, `app/[period]`, `app/api/{feed,probe}`, ISR revalidate 15 min / 1 h / 4 h; TypeScript; cheerio.
8. **Scrapes github.com/trending HTML** per request with a browser User-Agent (`lib/fetcher.ts`).
10. None. 11/12. daily/weekly/monthly through trending `since`.
13. Sort by the scraped "N stars this week" text — not computed by the project.
14. Language filter only (20 languages). 15. Dark, mobile-first UI, OG images, sitemap. 16. `ci.yml` only. 17. `vercel.json` present. 18. None. 19. Unproven. 20. `lib/parser.ts` is good: allow-listed avatar host, repo-path regex, k/m number parsing.
Weaknesses: runtime scraping from Vercel datacenter IPs (its own `/api/probe` exists to test blocking); no history; page holds ~20–25 repos only.
**Reuse:** `parser.ts` + `types.ts`, moved into the Action-side collector (scrape on schedule, not per request).

### 3.3 isboyjc/github-trending-api — REFERENCE / fallback
License: MIT per GitHub API; file not confirmed locally. 29 stars; pushed 2026-08-26; cron 4×/day (01/07/13/19 UTC). Actions → pnpm build → commits `data/{daily,weekly,monthly}/{language}.json|xml`. Source is the trending scrape. Item fields: title, url, description, language, languageColor, stars ("2,053" string), forks, addStars ("1,199" string), contributors. No history (overwritten). Served via raw.githubusercontent and jsDelivr.
Value: confirms the Actions-scrape-to-JSON model and offers a free third-party fallback feed. Risk: single maintainer, string-typed numbers.

### 3.4 huchenme/github-trending-api — REFERENCE
MIT. Stale since 2023-01-06 despite 834 stars. Scrape-based API incl. developers list. Do not depend.

### 3.5 encoreshao/github-trending — REFERENCE
MIT. React 18 + Vite + antd. `index.js` uses the GitHub **Search API**: "daily" = repos created in last 7 days, "weekly" = 30 days, "monthly" = 90 days, sorted by total stars, top 20; writes JSON/CSV to `docs/`. That is *newest repos by total stars*, **not star growth**. 25 topics in `src/data/topics.js`. No workflow files in checkout. Demo page asks users to paste a GitHub token in the browser. Reference only.

### 3.6 LokeshNanda/oss-radar-ai — REFERENCE
MIT. Python + MkDocs Material. Weekly Actions run: Search API (most-starred repos created in last 7 days) → README fetch → **LLM analysis (needs an API key → cost)** → markdown → Pages, plus RSS and JSON API. Valuable idea: guard job + fallback cron one day later, because `schedule` events at :00 get dropped. Not reusable: Python + MkDocs + paid LLM.

### 3.7 tianpai/dailyRepo — REJECT
MIT. NestJS backend + Vite/React + **MongoDB Atlas**; the workflow whitelists the runner IP in Atlas. Violates no-DB rule. Six categories (linux-tool, cli, productivity, web-dev, ai-ml, security) usable as reference.

### 3.8 EvanLi/Github-Ranking — REFERENCE
MIT, 12k stars, active. Python, daily CSVs of top stars/forks per language since 2018-12 in `Data/`, run from the author's own crontab (not Actions). Absolute ranking only, no velocity. Proof that CSV-in-git history survives years.

### 3.9 mshibanami/GitHubTrendingRSS — REFERENCE
MIT. Swift feed generator + Actions. RSS only. Skip.

### 3.10 vitalets/github-trending-repos — REFERENCE only
No LICENSE file; GitHub API reports none → all rights reserved. Posts trending to GitHub issues for notifications. Copy nothing.

### 3.11 ai-martin-lau/github-trending-radar — REFERENCE
MIT. Local Python + Node server (macOS launchd, needs `gh` CLI). Metric = total stars ÷ age days, snapshot diff for "new since last scan", and pulls real star timestamps for top candidates — same technique recommended here. Not deployable to Vercel.

### 3.12 pingcap/ossinsight — REJECT as engine
Apache-2.0. TiDB Cloud + GH Archive (10B+ rows); cannot self-host at zero cost. Public API is beta, 600 req/h/IP, no data license stated, and event-derived rankings dead since 2026-03-01 (verified live).

### 3.13 star-history/star-history — REFERENCE
MIT. Star curve rendering by sampling stargazer timestamps. Technique only.

## 4. Discovery
Searches for star velocity / momentum / rising / history dashboards found nothing newer or better beyond the above (`Marcos66236/github-stars-history` 277★ MIT and `bonfy/github-trending` 1163★ MIT Python scraper surfaced but were **not inspected in depth**). Gap confirmed: BUILD the core.

## 5. Capability classification

| Capability | Class | Source |
|---|---|---|
| Trending scrape (daily/weekly/monthly + stars gained) | ADAPT | repotide parser → Action collector |
| Daily snapshots of tracked repos | ADAPT | rising-repos-tracker collect.js |
| Discovery / new entrants | ADAPT | rising-repos-tracker discover.js + Search API |
| Guarded scheduled workflow | ADAPT | oss-radar-ai trending.yml |
| RSS/JSON outputs | REFERENCE | oss-radar-ai, isboyjc |
| Star history backfill | COMPOSE | GitHub stargazers API (`star+json`) and/or OSS Insight `stargazers/history` |
| Category seeds | COMPOSE | OSS Insight collection membership + GitHub topics |
| Fallback trending feed | COMPOSE | isboyjc JSON via jsDelivr |
| Charts, tables, UI | REUSE (libraries) | Next.js, chart lib, UI kit (verify licenses at install) |
| Velocity / momentum / movers / new-entrant scoring | BUILD | none exists |
| AI vs SWE classifier | BUILD | rules over topics/keywords |
| Weekly/monthly deltas from own history | BUILD | JSON snapshots |
| Snapshot sharding/compaction | BUILD | |
