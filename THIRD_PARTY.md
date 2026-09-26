# THIRD-PARTY NOTICES AND ATTRIBUTION

OpenSource Radar copies **no source code** from the projects below. This file records data and design that were adapted, so the obligations of each license are visible.

## Data adapted

### GitHub topic aliases — github/explore (CC BY 4.0)
- Source: https://github.com/github/explore (`topics/*/index.md`, fields `aliases` and `related`), commit of 2026-09-04.
- License: Creative Commons Attribution 4.0 International — https://creativecommons.org/licenses/by/4.0/ (`LICENSE.txt` read).
- Used for: expanding the strong/weak **topic lists** of the classifier taxonomy in `config/categories/*.json` (`classification` blocks), e.g. `mcp` <- `model-context-protocol`, `llm` <- `large-language-model, llms`, `kubernetes` <- `k8s`, `postgresql` <- `postgres, psql, pgsql`, `spring-boot` <- `springboot`, `java` <- `java8, java11, jvm, jdk, openjdk`, `awesome` <- `awesome-lists`, `interview` <- `interview-questions`.
- Changes: aliases were selected, merged with terms of our own, and assigned to categories with strong/weak roles. The lists are not a copy of the upstream files.
- Attribution: "Topic aliases adapted from GitHub's github/explore repository, CC BY 4.0."

## Design references (no code, no data copied)

| Project | License | What informed us |
|---|---|---|
| emanuelef/daily-stars-explorer | MIT | Star-history client behaviour (Link pagination, week-rollover overlap, retries) — Phase 2 |
| FayezBast/repometeor | Apache-2.0 | Momentum-scoring design (planned for Phase 4); nothing ported yet |
| HalcyonVector/GitHub-Trending-Intelligence- | MIT | Idea of category keyword/topic seeds; our lists are our own |
| ecosyste-ms/oss-taxonomy | CC0 | Education/documentation vocabulary informed the "educational content" negative signal |
| HiGitClass (ICDM 2019), GitRanking (2023) | papers | Keyword-seeded classification; topics as noisy evidence |
| oss-radar-ai, rising-repos-tracker, repotide | MIT | Workflow and collector ideas (Phases 0-2) |

## Not used because of licensing
- vitalets/github-trending-repos (no license), caarlos0/starcharts (no license file): nothing taken.
- isboyjc/github-trending-api: LICENSE file not confirmed; nothing taken.

## Dependencies
Runtime dependencies: none. Development: TypeScript, tsx, vitest, @vitest/coverage-v8, @types/node (MIT/Apache-2.0/ISC family; a formal license scan of the lockfile is still to be run before publishing).

## Phase 4 additions

| Project | License | What informed the momentum design (no code or text copied) |
|---|---|---|
| FayezBast/repometeor | Apache-2.0 | Velocity-dominant weighting, relative growth with a minimum-base floor, acceleration between recent and preceding period, separate New Entrants collection. Changed: absolute log scaling instead of cohort percentile ranks, no fork/snapshot-density terms |
| HalcyonVector/GitHub-Trending-Intelligence- | MIT | Log-scaled velocity as the main signal. Rejected: fixed p95 constants, clipping at 100, recency multiplier |
| ErcinDedeoglu/oss-pulse | no LICENSE file in the repository root | Referenced only for a negative lesson (a clipped 0-100 score ties at the ceiling). Nothing taken |
