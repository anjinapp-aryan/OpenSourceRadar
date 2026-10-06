# COMPETITIVE AUDIT

Date checked: **2026-10-06**. Evidence labels: **FACT** (observed in this audit, source given) · **OBSERVATION** (seen but not independently confirmed) · **INFERENCE** (my conclusion from facts) · **RECOMMENDATION**.

## Method and limits
Live API calls (OSS Insight, npm, Docker Hub, deps.dev, ecosyste.ms, Hacker News Algolia), page fetches (GitHub Trending, OSS Insight collections, npm/PyPI Stats docs, Libraries.io and deps.dev docs, GitHub changelog, star-history blog), and GitHub repository metadata (licence, stars, last push) read through the GitHub API. **Not researched** (say so rather than guess): GitHub Octoverse, Trendshift and similar trending aggregators, GH Archive, Reddit communities, Repology beyond its licence, and the details of OpenDigger's metrics (the page fetched did not list them). The unauthenticated GitHub API limit was nearly exhausted during the audit, so repository metadata was gathered once; nothing was re-checked.

## 1. Landscape changes that matter (FACT)
| Date | Event | Source |
|---|---|---|
| 2026-03-01 | OSS Insight's event-derived rankings became **unavailable**: its capture of GitHub public events fell to roughly 0.3% of baseline, so the ordering would be noise. Its API still answers, with an explicit `data_quality: unavailable` block. Totals synced directly from GitHub stay accurate | `https://api.ossinsight.io/v1/trends/repos/` response, checked 2026-10-06 |
| 2026-06-30 | GitHub restricted the stargazers list to a repository's admins/collaborators; tools that used it (Star History, OSS Insight) lost data | star-history.com blog "GitHub Has Restricted Access to Star Data" (search result), github.blog changelog |
| 2026-09-04 | GitHub added a privacy-safe star-history endpoint: weekly buckets with a `days` array, 30 weeks per page, 100-page maximum, works on any public repository | github.blog changelog 2026-09-04; star-history.com blog "The New GitHub Star History API" |
| 2026-03 | Stack Overflow's Trends tool retired (data still reachable through the Data Explorer) | web search result, single source: **OBSERVATION** |

**INFERENCE:** the "what is accelerating" niche is currently under-served by open products, because the two event/stargazer-based incumbents were hit by upstream changes. OpenSource Radar already runs on the new endpoint. **Risk (FACT-based):** the new endpoint's availability level (GA vs preview), rate limits and authentication terms are *not stated* in the changelog fetched; the whole product depends on it.

## 2. Comparison matrix
| Product | Measures | Data | Strongest feature | Does NOT provide | Learn | Do not copy |
|---|---|---|---|---|---|---|
| **GitHub Trending** (github.com/trending) | Stars gained "today / this week / this month" (shows e.g. "1,720 stars today"), filter by language and spoken language | GitHub internal | Zero-friction, canonical, includes new repos | No acceleration or persistence, no topic taxonomy, no explanation, no history, window is short and noisy | Offer date-range presets and a language facet | A single star-gain list with no context |
| **GitHub Search** | Sort by stars / forks / updated, topic and language qualifiers | GitHub | Power queries, free API | No velocity at all; 1,000-result cap | Topic/language qualifiers are our discovery input | n/a |
| **Star History** (MIT, 9.6k stars, pushed 2026-09-12) | Star curves, comparisons | New GitHub star-history API | Best-known star chart and embeds | No ranking, no discovery, no momentum | Comparison charts are what users share | Per-repo-only product shape |
| **daily-stars-explorer** (MIT, 406 stars, pushed 2026-10-04) | Daily star charts | GitHub | Daily resolution, small codebase | No ranking | Was used as a design reference in Phase 2 | n/a |
| **OSS Insight** (pingcap/ossinsight Apache-2.0, 2.5k stars, pushed 2026-09-08) | Rankings by stars/PRs/issues/contributors, **138 curated collections** (verified via API), 2011-onwards history, natural-language Data Explorer, MCP API | GitHub event firehose in TiDB | Collections (curated technology groupings), long history, developer geography, comparisons | Event-derived rankings **down since 2026-03-01**; no acceleration/why; heavy infrastructure (TiDB) | Collection list is the best public taxonomy reference (many AI collections: "Agent Harness", "MCP Servers", "LLM Inference Engines", "AI Agent Memory", "Agent Skills & AGENTS.md"...) | Dependence on the firehose; LLM-to-SQL as a core feature |
| **deps.dev** (Google; CC-BY-4.0 generated data) | Versions, licences, dependencies, advisories, project stars/forks/issues and OpenSSF Scorecard | 7 ecosystems (Go, RubyGems, npm, Cargo, Maven, PyPI, NuGet) | Free API (live test returned stars, forks, scorecard for next.js), no key observed | No trend or velocity; dependents not shown in the docs fetched | Scorecard as a maturity/trust badge | n/a |
| **Libraries.io** (AGPL-3.0 code, 1.2k stars) | Package metadata, dependents, SourceRank across 30+ managers | Registries | Dependents graph | API key required, 60 requests/min, no velocity; data licence not stated in docs fetched | Dependents as an adoption signal | AGPL code (do not vendor) |
| **ecosyste.ms** (packages/repos AGPL-3.0, ~100 stars) | Package and repository metadata (live test returned npm `react` with versions count, release dates and repo stats) | Registries + forges | Open API without key, repository-to-package linkage | Small projects; data licence unverified | Candidate adoption-signal source | AGPL code |
| **npm downloads API** | Downloads per day/range, bulk up to 128 packages, up to 18 months | npm | Free, bulk, verified live (react 224M/week) | Downloads include CI and mirrors; npm only | Cheapest adoption signal for JS/TS | n/a |
| **PyPI Stats** | Downloads, 180-day retention, IP rate limited | PyPI | Free | Short history; mirrors excluded but CI noise remains; BigQuery recommended for bulk | PyPI adoption for AI/Python tools | Heavy polling |
| **Docker Hub API** | Cumulative `pull_count` and stars per image | Docker Hub | Verified live for `library/redis` | Cumulative only (deltas need our own snapshots) | Adoption signal for infra images | n/a |
| **CNCF Landscape** (Apache-2.0, 10k stars, pushed 2026-10-06) | Curated cloud-native map with categories and project maturity | Community-curated YAML (`landscape.yml`, 1.15 MB, fetched OK) | Authoritative cloud-native taxonomy and maturity stage | Cloud-native only; no velocity | Seed for the Cloud Native area and maturity badges | n/a |
| **Hacker News (Algolia API)** | Stories by URL and date | HN | Verified live: searching `github.com/vectorize-io/hindsight` returned the story "Hindsight – An open-source memory system for AI agents" | Coverage is a fraction of repos; rate limit not confirmed here | Best cheap "why now" evidence | Relying on it for ranking |
| **OpenDigger / OpenRank** (Apache-2.0, 367 stars) | Contributor-network based influence metric | GitHub events | Importance beyond stars | Metrics not confirmed in this audit; depends on events | Idea of non-star importance | Event-firehose dependence |
| **OpenSSF Scorecard / criticality_score** (Apache-2.0, 5.7k / 1.5k stars) | Security-practice score; project criticality | GitHub + registries | Maturity/trust signals | Not momentum | Badge for architects | n/a |
| **Stack Overflow Trends** | Question volume per tag | Stack Overflow | Long-running technology interest curve | **Retired March 2026** (OBSERVATION) | Technology-level trend view | n/a |
| **CHAOSS Augur** | Community health metrics | GitHub | n/a | Repository **archived** (FACT via API) | n/a | Everything |

## 3. What OpenSource Radar uniquely does today (OBSERVATION from the repository)
Deterministic, documented momentum over 7/30/90-day windows with acceleration, persistence, new-entrant and cooling states; explainable lines per repository; daily automated refresh with quality gates; $0 hosting. **Trending shows stars today; Radar shows whether growth is speeding up, holding or fading.**

## 4. What competitors do better (be blunt)
1. **History:** OSS Insight and Star History show full trajectories; Radar shows none (the data exists in our state, see STRATEGIC-AUDIT section on history).
2. **Taxonomy richness:** OSS Insight has 138 collections; Radar has 33 categories with measurable overlap.
3. **Adoption evidence beyond stars:** deps.dev, Libraries.io, npm and Docker give adoption signals that stars cannot; Radar uses stars only.
4. **Comparisons and sharing:** Star History's comparison chart is what people post. Radar has no share artifact.

## 5. Open-source reuse table
Existence, licence and activity verified through the GitHub API on 2026-10-06 unless marked.

| Capability | Existing project | URL | Licence | Activity | Fit | Decision |
|---|---|---|---|---|---|---|
| Collection taxonomy reference | OSS Insight collections | https://github.com/pingcap/ossinsight and `https://api.ossinsight.io/v1/collections/` | Apache-2.0 (code); **data licence not verified** | pushed 2026-09-08 | High as a cross-check of our category list | **REFERENCE** (do not import membership until licence confirmed) |
| Cloud-native taxonomy and maturity | CNCF landscape | https://github.com/cncf/landscape | Apache-2.0 | pushed 2026-10-06 | High for the Cloud Native area | **ADAPT** (seed tag aliases and maturity labels; verify the YAML schema first) |
| Topic aliases | github/explore | https://github.com/github/explore | CC-BY-4.0 | pushed 2026-10-05 | Already used in Phase 3 | **REUSE** (attribution kept in THIRD_PARTY.md) |
| Package adoption (JS) | npm downloads API | https://github.com/npm/registry (docs) | n/a (service) | live | High | **REUSE** as an API |
| Package adoption (Python) | PyPI Stats | https://pypistats.org/api/ | Apache-2.0 repo (hugovk/pypistats.org) | repo pushed 2025-10-12 | Medium (180 days, rate limited) | **REUSE** as an API, only if Python tooling matters |
| Container adoption | Docker Hub API | https://hub.docker.com/v2/ | n/a | live | Medium | **COMPOSE** (needs our snapshots for deltas) |
| Repository-to-package linkage, dependents | ecosyste.ms | https://github.com/ecosyste-ms/packages | AGPL-3.0 code; data licence unverified | pushed 2026-10-05 | High if data terms allow | **REFERENCE** until data licence is confirmed |
| Security/maturity badge | deps.dev + OpenSSF Scorecard | https://docs.deps.dev/api/v3/ , https://github.com/ossf/scorecard | CC-BY-4.0 data; Apache-2.0 code | pushed 2026-10-06 | High for architects | **REUSE** as an API (attribution) |
| Why-now evidence | Hacker News Algolia API | https://hn.algolia.com/api | n/a | live | Medium | **REUSE** as an API |
| Star charts | Star History | https://github.com/star-history/star-history | MIT | pushed 2026-09-12 | Embeds exist but need their service | **REFERENCE** (we hold daily gains ourselves) |
| Sparklines/history charts | uPlot / Recharts | https://github.com/leeoniya/uPlot , https://github.com/recharts/recharts | MIT / MIT | pushed 2026-10-05 / 2026-10-06 | uPlot small and fast; Recharts React-native | **REUSE** when history ships (decide by bundle size) |
| Embedded analytics over files | DuckDB | https://github.com/duckdb/duckdb | MIT | pushed 2026-10-06 | Future history store (Actions-side, not runtime) | **REUSE** when the history trigger in STRATEGIC-AUDIT is reached |
| Importance metrics | OpenDigger, criticality_score | https://github.com/X-lab2017/open-digger , https://github.com/ossf/criticality_score | Apache-2.0 | pushed 2026-09-21 / 2026-08-27 | Unclear (metric details unverified) | **REFERENCE** |
| Community health | CHAOSS Augur | https://github.com/chaoss/augur | none reported | **archived** | None | **REJECT** |
| Dependents graph | Libraries.io | https://github.com/librariesio/libraries.io | AGPL-3.0 | pushed 2026-10-02 | API key and 60/min | **REJECT** for MVP |
| OS package versions | Repology | https://github.com/repology/repology-updater | GPL-3.0 | pushed 2026-10-05 | Low | **REJECT** |
| Unofficial trending scrapers | huchenme/github-trending-api | https://github.com/huchenme/github-trending-api | MIT | **pushed 2023-01-06** | Stale, scraping | **REJECT** |
