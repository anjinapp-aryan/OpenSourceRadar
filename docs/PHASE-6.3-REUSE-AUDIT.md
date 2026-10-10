# PHASE 6.3 REUSE AUDIT

Date 2026-10-09. Rule: REUSE > ADAPT > COMPOSE > BUILD. Repository facts (license, stars, last push, archived) were read from the GitHub REST API on 2026-10-09 unless marked "not re-verified". Nothing here copies third-party code; one dataset (OSS Insight collections) is used as independent validation labels and is attributed in `THIRD_PARTY.md`. Decisions: **REUSE** (use as is) · **ADAPT** (take data or design, change it) · **COMPOSE** (combine with what exists) · **REFERENCE** (informed us, nothing taken) · **REJECT**.

## 1. What already exists in this repository (checked first)

| Need | Existing, reused unchanged | Where |
|---|---|---|
| Text matching (tokens, camelCase names, phrases, CJK) | `TextIndex`, `compileTerm`, `matchTerms`, `normalizeTopics` | `src/classification/text.ts` |
| Educational/list context | the `educational-content` signal | `config/classification.json` |
| Point-in-time evaluation with no future data | `evaluateAt`, `dateRange`, `lastHistoryDate` | `src/backtest/index.ts` |
| Growth windows, trend labels, patterns | momentum engine and Phase 6.1 patterns | `src/momentum/engine.ts`, `src/explain/pattern.ts` |
| Tracking tiers and refresh cost | `decideTracking`, `metricsFor`, `loadTrackingPolicy` | `src/tracking/` |
| GitHub client, search, star history | `GitHubHttpClient`, `RestSearchProvider`, `RestStarHistoryProvider` | `src/github/` |
| Public-data gate | `publicSchemaProblems`, `secretShapeProblems` | `src/pipeline/gate.ts` |
| Shadow discovery measurements and sampling | `normalizeHits`, `stratifiedSample`, `weightedRate`, `valueClass` | `src/discovery/shadow.ts` (Phase 6.2.2) |

Everything new in Phase 6.3 is composed from these. No module of the production ranking, classification, tracking or discovery path was modified.

## 2. External audit

| Capability | Project | License | Quality (stars, last push) | Decision | Reason |
|---|---|---|---|---|---|
| Taxonomy vocabulary | github/explore | CC-BY-4.0 | 4,905, 2026-10-07 | **ADAPT** | Topic aliases (`k8s`, `postgres`, `springboot`, `valkey`, `opentofu` …) seed the technology rules in `config/taxonomy.v2.json`; selected, regrouped and extended, not copied. Already attributed in `THIRD_PARTY.md` |
| Technology validation labels | pingcap/ossinsight (`configs/collections/*.yml`) | Apache-2.0 | 2,506, 2026-09-08 | **ADAPT** (labels only) | 138 curated collections. 54 (30 engineering-family, 24 AI-family, plus 1 courses) are used as **independent held-out labels** for taxonomy recall and for the UNKNOWN experiment. Not used as production rules or as a runtime dependency. Attribution added to `THIRD_PARTY.md` |
| Cloud-native seeds | cncf/landscape | Apache-2.0 | 10,005, 2026-10-07 | **REFERENCE** | Right source for cloud-native names and maturity, but a landscape join belongs to the Engineering MVP (Phase 7). The v2 technology list was checked against its categories by hand |
| Landscape site generator | cncf/landscape2 | Apache-2.0 | 365, 2026-07-27 | **REJECT** | Generates a site; we need data, not a site |
| Language facet | github-linguist/linguist | MIT | 13,728, 2026-10-08 | **REUSE (indirectly)** | GitHub's own `language` field is Linguist's output and is already in every record; running Linguist ourselves would add nothing |
| Education vocabulary | ecosyste-ms/oss-taxonomy | CC0-1.0 | 43, 2026-09-07 | **ADAPT** | Terms informed the `facets.learning` rules (already in `THIRD_PARTY.md`) |
| Package/repository metadata | ecosyste-ms/repos | AGPL-3.0 | 75, 2026-10-06 | **REJECT** | AGPL |
| Package metadata | librariesio/libraries.io | AGPL-3.0 | 1,159, 2026-10-02 | **REJECT** | AGPL; adoption signals are out of scope in Phase 6.3 |
| Community analytics platform | chaoss/grimoirelab | GPL-3.0 | 630, 2026-10-06 | **REJECT** | GPL, heavy infrastructure |
| Technology radar (editorial) | zalando/tech-radar | MIT | 1.9k (page), activity not re-verified | **REFERENCE** | Hand-curated adopt/trial/hold rings; not a measured-momentum model |
| Technology radar generator | thoughtworks/build-your-own-radar | AGPL-3.0 | 2.6k (page) | **REJECT** | AGPL, manual curation |
| Cohort percentile-rank momentum | FayezBast/repometeor | Apache-2.0 | 0 stars, 2026-10-01 | **REFERENCE** (design already credited in Phase 4) | The one project found that ranks repositories by cohort percentile. It uses percentile ranks over a single cohort inside a blended score; Phase 6.3 differs: percentiles per domain **and** size band, used as gates with absolute floors, replayed on point-in-time history. No code or text taken |
| Percentile / quantile | simple-statistics/simple-statistics | ISC | 3,526, 2026-10-01 | **REFERENCE → BUILD (25 lines)** | The project's runtime has zero dependencies. The needed functions are a mid-rank percentile and a nearest-rank quantile, whose tie behaviour is part of the specification and is covered by tests. Adding a dependency to the build for two tiny pure functions fails the cost test |
| Percentile / quantile | d3/d3-array | ISC | 464, 2025-03-16 | **REFERENCE** | Same reasoning; documents the interpolation variants (we use nearest-rank on purpose: the value is a real observation) |
| Statistics library | jstat/jstat | MIT | 1,805, 2026-02-28 | **REJECT** | Large, no benefit |
| Weighted ranking of repositories | ossf/criticality_score | Apache-2.0 | 1,460, 2026-08-27 | **REFERENCE** | A weighted log-score for "criticality", not peer-relative momentum; confirms that transparent weights are the norm |
| Time-series change detection | deepcharles/ruptures (Python) | BSD-2-Clause | 2,096, 2026-10-06 | **REFERENCE** | Change-point detection in Python; our stack is TypeScript, and the Phase 6.1 pattern model already covers spikes/breakouts deterministically |
| Time-series features | blue-yonder/tsfresh (Python) | MIT | 9,470, 2026-07-06 | **REJECT** | Python, feature-extraction for ML; no benefit for a rule-based, explainable ranking |
| Anomaly detection | twitter/AnomalyDetection | GPL-3.0 | 3,606, archived 2019 | **REJECT** | GPL and archived |
| Repository discovery by partitioning a capped search | GitHub Search partitioning idea (date or star ranges); the MIT Nextflow `Github-Crawler` describes it (not re-verified) | MIT (not re-verified) | n/a | **REFERENCE** | Used as an idea in the Phase 6.2.2 shadow strategies |
| Trending / rising signals | OSS Insight public API, GH Archive | Apache-2.0 service; data set | n/a | **REFERENCE** | Runtime dependency on a third-party service, or BigQuery, is excluded by the architecture; kept as a possible independent recall check |
| Dependents, versions, scorecards | deps.dev API | CC-BY-4.0 data (per the strategy review) | n/a | **REFERENCE (Phase 2)** | External adoption signals are explicitly out of scope |

## 3. Decisions that follow

1. **Taxonomy rules: BUILD, with adapted vocabulary.** No permissively licensed project provides a deterministic Domain → Area → Technology detector for GitHub repositories with explainable evidence. The nearest data sources (github/explore aliases, CNCF landscape names, OSS Insight collections) are inputs, not engines. What is built is a thin layer over the existing text matcher.
2. **Validation labels: ADAPT OSS Insight collections.** This replaces the weakest point of Phase 6.2 (labels assigned by the experimenter) with human-curated labels from a different organisation.
3. **Normalisation: BUILD, tiny.** Percentile rank and quantile are 25 lines with tested tie semantics. No dependency added.
4. **Nothing better was found for percentile-relative, cohort-based momentum ranking:** the closest tools are closed services (GitGem, RepoInsider, Repo Scout; Phase 6.2.1 review) or non-peer-relative scorers. No licensed solution is displaced.
5. **No GPL, AGPL or unknown-license code or data is used.** Rejected rows above: AGPL (ecosyste-ms/repos, libraries.io, build-your-own-radar), GPL (grimoirelab, AnomalyDetection).

## 4. Attribution added

`THIRD_PARTY.md` records the OSS Insight collections (Apache-2.0) as validation labels. No dependency was added to `package.json`.
