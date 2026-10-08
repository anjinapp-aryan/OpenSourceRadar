# PHASE 6.2 VALIDATION REPORT

Date 2026-10-08. Legend: **MEASURED** (observed in this run) · **INFERENCE** · **LIMITATION** · **NOT DONE**. Status: **READY WITH LIMITATIONS** (section "Recommendation").

## Executive Summary
Phase 6.2 gives OpenSource Radar a verified historical layer without touching its ranking: a point-in-time back-tester that reproduces production on 3,471 of 3,471 records and passed a future-leakage audit of 2,939 real samples with zero differences; a history-quality model; "over time" evidence in the Why panel; an orphan investigation that identifies a systemic discovery bias; a bounded candidate-retention design (built and tested, not enabled); an experimental classification rule (evaluated, not adopted); an independent size audit against Vercel's documented limits; and an allow-list gate for public data. **One production behaviour change was made, as a correctness fix:** due selection skipped 240 of 241 HOT repositories on 2026-10-07 because the run started 13 to 19 minutes earlier than the previous run finished; a 3-hour grace was added (details below). Ranking, classification rules, tiers and discovery are unchanged.

Headline findings: Rising is short-lived (median closed episode 8 days, two thirds followed by a Cooling day within two weeks); 94% of UNKNOWN repositories have category evidence and the cause is the classifier's one-category-at-a-time scoring; 351 orphans are 99% relevant repositories lost mainly to the 30-day push window and a top-100-by-stars discovery cut that under-samples exactly the small, fast-growing repositories the product targets; the static export is 140 MB (not 148) and the real unknown is Vercel's 2,048-routes limit; Git growth is about 60 MB a year, not 300.

**Provenance note (read this).** When this phase started the working tree already contained **uncommitted, unreviewed Phase 6.2 work of unknown origin** dated 2026-10-06 23:07 to 23:28 (`src/backtest`, `src/coverage`, `src/history/{quality,trajectory}.ts`, `src/classification/experimental.ts`, three scripts, `results/phase6.2/*`, no tests, no documents). No transcript of this project records its creation. I treated it as inherited code, **reviewed it, re-ran every script on the current data, found and fixed one defect (episodes closed by uncovered days), added the missing tests and documents, and reproduced its numbers** (the classification experiment reproduced byte for byte). Anything in the results that I could not re-derive is labelled.

## Baseline (re-measured 2026-10-08, pipeline state of 2026-10-07)
| Item | Measured |
|---|---|
| Git | `main` = `origin/main` = `acc51a0` (bot data commit after `e10d4b5`), 23 commits |
| Tests / TypeScript / build before this phase's changes | 441 passed (the existing files, re-run with the new test file excluded) / clean / passes (Phase 6.1 final state; the working tree already held the inherited, untested modules) |
| State records | 3,958 (repositories dataset), candidates 4,490, classified 4,490, tracked 3,471 |
| Published | 3,471; withheld 486 (351 orphan, 135 excluded); accounted 3,957 |
| Tracked / measured | 3,471 / 3,471 (0 unassessed); HOT 241, WARM 2,280, DORMANT 950 |
| UNKNOWN | 1,018 of 4,490 candidates (22.7%) |
| Rising | 37 published (47 by the rules, 10 withheld) |
| AI scope | 1,735 |
| `radar.json` / `history.json` | 3,695,992 / 366,183 bytes |
| History length | p10 31, p50 206, max 210 days |
| Phase 6.1 workflow on GitHub | the scheduled run of 2026-10-07 (id 37611719714) **succeeded** in 173 s on the new workflow and created `state-2026-10-07.tar.gz`; `state-prev.tar.gz` is correctly retained until a second dated copy exists. The single-cron Monday behaviour is **still not observed** (next Monday: 2026-10-12) |

## Reuse Audit
[PHASE-6.2-REUSE-AUDIT.md](PHASE-6.2-REUSE-AUDIT.md): about 25 external candidates checked for licence and activity across the ten requested areas. Reused: Node `zlib`, inline SVG, GitHub release assets, github/explore, Vercel's published limits. Referenced: sktime's cutoff principle, Scrapy/Crawlee/Frontera frontier ideas, OSS Insight collections, star-history. Rejected with reasons: finance backtesters (GPL or non-OSI), PyOD, simple-statistics, browser compression libraries, DuckDB/Parquet-Wasm (for now). Built small: the candidate registry and the size command. **No dependency added.**

## Historical Data Audit
[PHASE-6.2-HISTORICAL-MODEL.md](PHASE-6.2-HISTORICAL-MODEL.md). Storage: `starHistory { firstDate, dailyGains[], complete }` per repository id, UTC days, contiguous (gaps and duplicates are unrepresentable), at most 210 days. Coverage of published records with at least 1 / 7 / 30 / 60 / 90 / 180 / 210 days: 100 / 100 / 92.2 / 87.2 / 85.8 / 80.2 / 18.9 %; AI scope 100 / 99.9 / 86.5 / 78.9 / 76.4 / 66.6 / 15.8 %. Percentiles p10 / p25 / p50 / p75 / p90 / max: 31 / 205 / 206 / 206 / 210 / 210 (published). Gap, duplicate and invalid values: 0%. Zero-gain days are 43% of stored days (31% in the AI scope); 8 published series are entirely zero. 64% of records sit at the 210-day endpoint cap.

## History Quality
Seven states (FULL, LONG, ADEQUATE, LIMITED, INSUFFICIENT, GAPPED, INVALID) with the production windows as boundaries, independent of momentum (the function takes no trend or score). Today only FULL (776) and LONG (2,695) occur because any series shorter than 210 days belongs to a repository younger than that. Boundary tests at 29/30, 89/90, 179/180 days, one- and two-day trailing gaps, invalid values and the empty series.

## Historical Intelligence
Metrics implemented and tested (formulas, units, edge cases in the historical-model document): 7/30/90-day and previous-window velocity, weekly sums, peaks, median prior week, current-to-median ratio, positive/zero days and streaks, consecutive positive weeks, quiet weeks before, acceleration days, weekly variation. **Shipped to the product** (Why panel, "Over time"): consecutive positive weeks, current-to-median ratio, acceleration days and quiet weeks before, each only when the 90 published days support it. **Evaluated and not shipped:** coefficient of variation, streaks, zero ratios (no product value), percentile of current velocity (needs a cohort baseline: Phase 6.3). On the 35 Rising repositories that have a history, 26 gain at least one "over time" line and 9 none (too little history or no unusual feature); every number is derivable from `history.json`.

## Backtesting
[PHASE-6.2-BACKTEST.md](PHASE-6.2-BACKTEST.md). `evaluateAt(record, T)` runs the unchanged production engine and the pattern model on the series truncated at T. **Validation:** 3,471 of 3,471 published records reproduced exactly (score, trend, pattern, 7/30/90-day growth); newest-day Rising set equals production's 37.

## Future Leakage Validation
Property tests for evaluation dates 0, 1, 7, 14, 30, 60 and 90 days back with three different "futures"; the January-to-April/March-1 example from the task; a real-data audit of **2,939 random (repository, date) pairs with everything after T replaced by random values: 0 differences**; a later push does not leak; boundaries (the day itself included, the day after excluded, uncovered dates return null). Fidelity limits that are not leakage: removed stars vanish from the past; archive status and `complete` are current values; classification, tier and discovery membership at T are not reconstructed.

## Rising Persistence
Closed episodes (291): 1 to 6 days 35.7%, 7 to 14 days 39.2%, 15 to 30 days 19.6%, 31 to 60 days 5.2%, 61+ days 0.3%; median 8, mean 10.9, p90 23. 47 episodes ongoing, 64 left-censored. 88 repositories had two or more episodes. 29% of closed episodes were Cooling the next day and 67% had a Cooling day within 14 days. The current Rising list: median streak 7 days; 19 of 37 are 7 days or fewer, 7 are more than 30. Spike-entry episodes last as long as other entries (median 9). Observed behaviour only; no causality claimed.

## Rising Churn
37 to 81 members over 91 days; 3.7 enter and 3.9 leave per day; mean day-to-day Jaccard 0.883 (89 usable days; 2026-10-07 excluded for low coverage).

## Orphan Investigation
[PHASE-6.2-COVERAGE-RECOVERY.md](PHASE-6.2-COVERAGE-RECOVERY.md). 351 orphans, **all 351 checked live (HEAD, no token): 343 reachable, 8 not found, 2 renamed**; 98.9% relevant by the current classifier. Reasons: push window 234, rank cut-off 65, search miss 47, star floor 3, topic 2. Outcomes: discovery gap 300, recoverable 39, not found 8, reclassify 4. Most are quiet (14-repository sample: median growth since collection 0 to 1 stars); the valuable ones are the rank-cut-off cases (`headcount` +338 stars in a week). Systemic cause: discovery returns only the top 100 by stars per topic query and forgets everything not returned.

## Candidate Retention
Lifecycle ACTIVE, RETAINED, RETIRED, forgotten; at most 4 missed discoveries, capacity 1,000 by recent growth; deleted and archived retired at once; renames by id; forks never carried. Estimated +22% candidates, about +330 requests a day, +0.8 MB state. **Implemented as pure functions with 5 tests, not enabled in production**; enabling changes discovery and is a Phase 6.3 decision. Rank-cut-off bias needs a separate fix (deeper pages or non-star-biased queries).

## UNKNOWN Classification
[PHASE-6.2-CLASSIFICATION-EXPERIMENT.md](PHASE-6.2-CLASSIFICATION-EXPERIMENT.md). 94.1% of the 1,018 UNKNOWN have a near-miss category (36% score 5 to 5.99 against an acceptance score of 6); 5.9% have none; 10.9% are educational/list. `browser-use` has ai-agents 5 and llm 4 and is rescued only by corroboration. Experimental rule E1: held-out precision 53.8% (both domains) and 66.7% (AI only), domain precision 86% and 95%, recall proxy 15 to 28%; UNKNOWN would fall from 22.7% to 16.9% or 19.8%. **Not adopted.** Labels came from the experiment's author (an assistant), not an independent human, and samples are small: both stated as limits.

## Anomaly Evaluation
Pattern shares over 311,089 repository-days: normal 70.1%, flat 14.9%, new launch 5.1%, cooling 3.3%, sustained 3.3%, accelerating 2.3%, spike 0.94%, breakout 0.12%. BREAKOUT runs last a median **1 day** (boundary flicker); spike runs 6 days. 14 days after a spike: 32% Cooling, 13% Rising. Recommendations only (hysteresis or a 2-day rule before showing a ratio pattern prominently); **no threshold was changed.**

## Why Rising
The historical evidence is mathematically backed by the stored daily gains and shown only where the series supports it (examples on live data: `morluto/rea` "the last 7 days (+6,308) are 701x the median week of the 11 before (+9)", `hindsight` "5.0x the median week of the 11 before (+634)", `Panniantong/Agent-Reach` "2.3x the median week ... for 5 consecutive days of acceleration"). The Why panel keeps pattern, evidence and status separate. No LLM, no outside facts. The wording was corrected during validation so a capped series reads "of the published 90-day history", not "on record", for repositories older than 90 days.

## Vercel / Static Size
[PHASE-6.2-SIZE-AUDIT.md](PHASE-6.2-SIZE-AUDIT.md). Independently measured: **1,740 pages, 8,715 files, 139.7 MB logical** (the earlier 148 MB was block-rounded `du`); 56% of the bytes are Next payload `.txt` files; about 80 KB per repository page; build 11 to 16 s. Vercel documents Hobby limits of 45 minutes build time, 100 deployments a day, no output-size cap, slowdown expected near 100,000 files; the **2,048 routes per deployment limit is the one unknown** (does a pre-rendered static page count?), to be settled by a preview deployment with about 2,300 synthetic pages before the AI scope reaches about 1,900.

## Storage Decision
Keep JSON in Git. Packed Git growth is about 60 MB a year (14 bot commits added 2.4 MB total), correcting the 300 MB estimate in the strategic audit (loose-object artefact). Compressed history representations, per-repository history files and external object storage are not needed (history is 85 KB brotli). No database. First binding constraint: the explore page payload (about 3,500 AI repositories for 500 KB gzip).

## Engineering Radar Readiness
What Phase 6.2 provides: a validated point-in-time evaluator that can compute **domain baselines from history** (measured below); history that is **richer for engineering repositories than for AI** (published engineering-only records with at least 90 days: **95.3%**, with at least 180 days 93.7%; AI 75.8% and 66.4%); a verified discovery-bias diagnosis; the public-data allow-list; the size and routes analysis.

| Weekly star gain (12 weeks, published, with 12 weeks of history) | p50 | p90 | p99 |
|---|---:|---:|---:|
| AI only (1,133 repositories) | 17 | 259 | 2,265 |
| ENGINEERING only (1,655) | **3** | **44** | **294** |
| BOTH (203) | 10 | 177 | 2,405 |
Engineering weekly growth is an order of magnitude below AI at every percentile, which is exactly why per-domain normalisation is a prerequisite.

**Still missing (Phase 6.3 must provide):** taxonomy v2 with technology tags and a content-type flag; per-domain momentum baselines and a back-tested threshold choice; the persistent candidate registry or a discovery fix (engineering discovery has the same top-100 cut, so engineering repositories are under-sampled the same way); release cadence and maturity metadata; fork/mirror flags (the candidate record does not store the fork flag); a decision on the 2,048-routes question before engineering pages are added.

## Performance
| Item | Before | After |
|---|---|---|
| Tests | 441 tests, 2.5 s (2.5 s re-run today; the 12.4 s in the Phase 6.1 report was measured under load) | 500 tests, 2.5 s (the new 59 tests take 1.9 s alone, mostly startup) |
| Build | 13.5 s (Phase 6.1), 10.8 to 16.4 s today | 10.8 s (clean build after the changes) |
| Static export | 140 MB logical | 139.7 MB logical; repository pages grew from 35.3 KB to 36.1 KB (the "over time" lines) |
| `radar.json` | 3.70 MB (3.65 MB compact when committed) | unchanged |
| `history.json` | 366 KB | unchanged |
| Pipeline run | 173 s (2026-10-07, observed) | +1 monitoring step (`pipeline size`, under a second); not yet run on GitHub |
| Offline back-test (not part of the pipeline) | n/a | 168 s for 3,958 records x 91 days |
**No regression found.** Test duration is noise-level; nothing was optimised.

## Security
Searched source, scripts, app, lib, components, config, tests, docs, workflow, public data, build output and results for token shapes (GitHub personal, fine-grained, OAuth, AWS keys, private-key blocks), for the names `RADAR_GITHUB_TOKEN`, `GITHUB_TOKEN` and `GH_TOKEN` in browser-facing code, and for `Authorization`/`Bearer` in the build output and public data. **Result: no real credential anywhere.** The three token-shaped hits are deliberate fake values in tests (`TEST_TOKEN`, a regex-test fixture, and the text "BEGIN RSA PRIVATE KEY" in the new gate test). The built output contains no `localhost:3000`. New in this phase: a gate that fails publishing if a public record carries a field outside the documented allow-list or any token-shaped string (verified by a negative run that blocked a record with an injected `starHistory` and a fake token, without echoing the value). No new external call, no secret added.

## Tests
**500 tests pass in 18 files** (441 existing plus 59 new; no existing test was edited or removed); `tsc --noEmit` clean; production build passes (1,740 pages); browser validation (`VALIDATE_OUT=results/phase6.2/browser node scripts/browser-validate.mjs`, normal and reduced motion): **60 page loads at 1440, 1280, 1024, 768, 390 and 375 px, 0 problems**, axe 0 violations, trajectory buttons verified. New tests cover history quality boundaries, trajectory metrics, history evidence, back-test truncation and leakage, Rising episodes, discovery queries/reasons/outcomes, the candidate registry, the experimental classifier, public-data allow-list and secret shapes, size accounting, and due-selection grace. The real-data gate run on the committed `radar.json` and `history.json` passes.

## Real Data
Repositories 3,958; tracked 3,471; measured 3,471; UNKNOWN 1,018 (22.7%); orphans 351; published 3,471; withheld 486. History at least 7 / 30 / 60 / 90 / 180 / 210 days (published): 100 / 92.2 / 87.2 / 85.8 / 80.2 / 18.9 %. Patterns on the published records of 2026-10-07: normal 2,225, flat 548, new launch 384, cooling 194, accelerating 41, sustained 59, spike 19, breakout 1, insufficient history 0. Rising: 37 now; 241 repositories were ever Rising in 91 days; episodes and churn as above.

## Known Limitations
- **The due-grace fix is unobserved on GitHub.** It was verified by replaying the 2026-10-07 selection (111 due without grace, 351 with) and by unit tests; the next scheduled runs must show HOT repositories collected daily.
- Back-tester fidelity limits (removed stars, archive flag, classification/tier not reconstructed). History is at most 210 days.
- Classification labels are not independent; sample sizes are small.
- The candidate registry and E1 are built but **not enabled**; discovery's top-100 bias is diagnosed, not fixed. How many repositories discovery has never found is unknown.
- Orphan live checks: 14 of 30 REST samples completed under the unauthenticated quota; HEAD checks cannot report archive or fork status.
- The 2,048-routes limit and the explore page payload are the open scaling questions.
- The pattern labels flicker near their cuts (BREAKOUT median run 1 day); untouched.
- The updated workflow step (`pipeline size`) and the Monday single-cron behaviour have not run on GitHub.
- Inherited work: its labels and samples were produced by an unidentified earlier session; I reproduced its evaluation but did not re-label.

## Files Changed
New: `src/backtest/index.ts`, `src/coverage/index.ts`, `src/history/{quality,trajectory}.ts`, `src/explain/historyEvidence.ts`, `src/classification/experimental.ts`, `src/pipeline/size.ts`, `scripts/backtest/run.ts`, `scripts/coverage/orphans.ts`, `scripts/classify/experiment.ts`, `tests/phase62.test.tsx`, seven Phase 6.2 documents, `results/phase6.2/*` (analysis outputs and browser validation). Modified: `src/tracking/{engine,config,types,datasets}.ts` and `src/collect/dueCollector.ts` and `config/tracking.json` (due grace), `src/pipeline/gate.ts` (public allow-list, secret shapes), `scripts/pipeline/index.ts` (gate wiring, `size` command, summary), `components/WhyPanel.tsx`, `app/repo/[owner]/[name]/page.tsx`, `app/globals.css` (over-time lines), `.github/workflows/radar.yml` (size step), `package.json` (one script entry, no dependency), `README.md`, `docs/{TRACKING,DUE-COLLECTION,STRATEGIC-AUDIT}.md` (addenda and a correction). **Not touched:** the momentum engine and configuration, classification code and rules, tier rules, discovery code and queries, the public data files.

## Git Diff
46 files, +13,899 / -10 lines: analysis results 11,333 added lines (`results/phase6.2`, mostly generated JSON), documents 545, tests 515, code and configuration 1,495 (about 1,100 of those are the inherited, now tested modules and scripts). `git diff --check` reports only line-ending notices. Nothing is committed or pushed.

## Recommendation
**READY WITH LIMITATIONS.** All Phase 6.2 acceptance items are met and verified locally with real data, ranking is unchanged and no database, LLM or Engineering Radar work was done. Remaining before Phase 6.3: (1) commit and push this work, then watch two scheduled runs to confirm the due-grace fix, the size step and, after 2026-10-12, the single Monday run; (2) decide the discovery changes (enable the registry, deepen or change the queries) and the classification route; (3) settle the 2,048-routes question with a preview deployment.
