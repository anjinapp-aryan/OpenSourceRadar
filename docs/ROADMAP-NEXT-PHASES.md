# ROADMAP: NEXT PHASES

Date 2026-10-06. Evidence labels as in STRATEGIC-AUDIT.md. The requested phase order was changed where evidence said so; each change is explained. Effort figures are estimates (ASSUMED).

## Sequencing changes versus the suggested roadmap
| Change | Reason |
|---|---|
| "Why is it rising?" Level 1 moved **earlier** (into 6.1/6.2) | It is the stated product promise, needs no new data, and fixes explanation text that currently only restates inputs |
| Taxonomy v2 and per-domain momentum inserted **before** Engineering Radar (new Phase 6.3) | Naive Engineering Radar gives 2 Rising of 1,736 repositories and a Java page with zero Rising |
| Historical intelligence **before** cross-domain intelligence | History is the return-visit reason and the data already exists |
| LLM analyst last and optional | Needs trustworthy evidence first, and is the highest cost/risk item |

## Phase 6.1: Production hardening and data hygiene (2 to 4 days)
- **Objective:** make today's AI Radar trustworthy and the operations honest.
- **User value:** fewer wrong or stale entries; visible trust flags.
- **Work:** root README; purge 351 orphan records and stop publishing untracked ones (or track them); anomaly flags (spike share, forks per star, issues per star) and Level 1 pattern label as additive public fields; dated weekly state backup (rollback depth beyond one day); documentation of actual schedule timing and the duplicate Monday run; failure notification if a scheduled run fails (GitHub's email already exists, check it).
- **Architecture:** none; additive fields keep `schemaVersion 1`.
- **Reuse:** none new.
- **API cost:** none. **Risks:** flags misread as accusations; word them as "signals".
- **Acceptance:** 0 untracked records in the public file; every Rising entry carries a pattern label; gate still green; two weeks of green scheduled runs.

## Phase 6.2: Historical intelligence (1 to 2 weeks)
- **Objective:** trajectory, "what changed", digest.
- **User value:** the reason to come back.
- **Work:** `sparkline90` in the public file; compact daily snapshot appended to a release asset; "Since yesterday" strip; weekly digest page and static Atom feed; trajectory on repository pages.
- **Architecture:** one new asset, additive public fields; charts via uPlot or Recharts (decide by bundle size; both MIT, active).
- **API cost:** none (daily gains already stored). **Risks:** public file grows about 220 KB; Explore payload grows (watch the 500 KB gzip target).
- **Acceptance:** sparkline for 100% of repositories with at least 14 days of history; "what changed" correct against two consecutive snapshots in a unit test; feed validates.

## Phase 6.3: Taxonomy v2 and domain-normalized momentum (1 to 2 weeks)
- **Objective:** a classification and momentum model that works for both domains.
- **Work:** tags and facets (ENGINEERING-TAXONOMY.md); contentType flag; UNKNOWN review sorted by stars and growth; per-domain thresholds in config; **backtest** on reconstructed dates from stored daily gains (verify that the engine reproduces past results with `--now` first).
- **Reuse:** github/explore aliases (CC-BY-4.0), CNCF landscape (Apache-2.0, adapt), OSS Insight collection names (reference).
- **API cost:** none. **Risks:** reclassification changes rankings; keep classifier and momentum versions explicit.
- **Acceptance:** UNKNOWN at most 10%, hand-labelled precision at least 90% and recall at least 80%; Engineering Rising between 0.5% and 2% of repositories; Rising overlap day-over-day at least 70%.

## Phase 7: Engineering Radar MVP (2 to 3 weeks)
- **Objective:** technology-first radar for architects and platform engineers (ENGINEERING-RADAR-STRATEGY.md section 7).
- **Work:** `/engineering/` and area pages, technology momentum aggregates, maturity badges (age, release cadence, CNCF stage), new-to-evaluate, cooling; two additive GraphQL fields (latest release, 90-day release count); per-domain public data shards.
- **API cost:** about 1,600 star-history requests per day at 5,000 tracked (estimated); release fields add GraphQL cost per batch (unmeasured; measure first).
- **Risks:** thin technology tags, AI crossovers leaking in (acceptance caps them at 30%).
- **Acceptance:** all areas have at least 25 repositories per launched tag; no empty Rising page; gate extended with per-domain metrics.

## Phase 8: Cross-domain intelligence (1 to 2 weeks)
- **Objective:** the AI x Engineering overlap (253 repositories already classified BOTH; for example MCP servers for databases).
- **Work:** cross-area views, technology-pair movement. **Cost:** none new. **Risk:** thin evidence; do only if Phase 7 data shows real overlap.

## Phase 9: "Why" Level 2: ecosystem adoption signals (2 to 3 weeks)
- **Objective:** adoption evidence beyond stars.
- **Work:** repository-to-package mapping spike; npm weekly downloads (verified bulk API), Docker pulls with our own daily deltas, optional deps.dev scorecard badge; keep each signal optional per repository.
- **Reuse:** npm downloads API, Docker Hub API, deps.dev (CC-BY-4.0 data), ecosyste.ms only after its data licence is confirmed.
- **Risks:** mapping errors, download noise (CI, mirrors); show as supporting evidence, never as ranking input in the first version.
- **Acceptance:** mapping precision at least 95% on 100 hand-checked repositories before shipping any number.

## Phase 10: Level 3 external signals (1 to 2 weeks)
- Hacker News Algolia story by repository URL (verified live) as "discussed on" evidence; Reddit and blogs only if a free, stable source is verified. Rate limits to be measured.

## Phase 11: Natural-language layer (optional)
- Only after Levels 1 to 3 exist. LLM may narrate evidence; it never ranks. Decide model and cost then; evaluate local or low-cost options; no vector database required (evidence is structured).

## Trigger-based work (not a phase)
- Data path off Git at about 6,000 records or `.git` above 400 MB.
- Top-N static detail pages at about 5,000 pages (verify Vercel limits first).
- DuckDB in Actions when category/technology history queries outgrow JSON.

## Summary table
| Phase | Value | Complexity | API cost | Gate |
|---|---|---|---|---|
| 6.1 hardening | High (trust) | Low | None | 2 weeks green |
| 6.2 history | High (retention) | Medium | None | snapshot tests |
| 6.3 taxonomy and momentum | High (prerequisite) | Medium | None | accuracy and stability thresholds |
| 7 Engineering MVP | Very high | High | about 1,600 per day | no empty Rising |
| 8 cross-domain | Medium | Low | None | data shows overlap |
| 9 adoption signals | High | Medium | Free APIs | mapping precision |
| 10 external | Medium | Low | Free | measured limits |
| 11 narrative | Medium | Medium | Possibly paid | evidence first |
