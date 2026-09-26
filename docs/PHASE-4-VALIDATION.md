# PHASE 4 VALIDATION — due collection and momentum

Date 2026-09-25. Legend: **MEASURED** · **ESTIMATED** · **ASSUMED** · **CONFIGURED** · **UNKNOWN**.

## Status: implementation complete, full-scale measurement NOT complete

No GitHub token was available in this session, and the first assessment of the 3,048 unassessed repositories needs about 3,003 more core requests (anonymous limit: 60/hour, about 50 hours). What was done and what was not:

| Acceptance item | Status |
|---|---|
| Fresh reuse audit | done (PHASE-4-REUSE-AUDIT.md) |
| Due-based collection, existing star-history provider reused, UNASSESSED handled | **done and tested; ran live on 45 repositories** |
| Missing growth history collected | **partial: 45 of 3,048 (1.5%). 3,003 remain. Exact command in DUE-COLLECTION.md §1** |
| Growth metrics 7/30/90, percent, stars/day, null when missing | done and tested |
| Tracking re-evaluated / HOT-WARM-DORMANT measured on a wider population | **partial**: 410 measured repositories (365 tracked from the 500-set plus 45 new), which is not a wide population. DORMANT is **unmeasured** on any old quiet repository |
| Threshold changes documented | done (§6, MOMENTUM.md §7); tracking thresholds otherwise **unchanged** (review on a wide population still pending) |
| Momentum signals, MomentumScore v1, Rising, Biggest Movers, Sustained, New Entrants | done, deterministic, explainable, tested |
| Classification independent from momentum; tracking independent from category | done, tested |
| Rate-limit and partial-dataset protections preserved | done, tested; two live findings fixed |
| Tests / tsc | 343 tests pass, `tsc --noEmit` clean |
| Real-data validation | **partial**: momentum on 545 real repositories (500 authenticated + 45 new); no representative wide population yet |
| Manual sample review | done on the 545 (§9) |

Phase 4 should not be called complete until the 3,003-repository first assessment has run and §6/§7 are re-measured on it.

## 1. Reuse audit
See PHASE-4-REUSE-AUDIT.md. The due collector is composition of existing Phase 2/3 parts. Momentum concepts (velocity-dominant weighting, relative growth with a floor, acceleration, separate New Entrants) adapted from RepoMeteor (Apache-2.0, no code/text copied) and informed by Trending-Intelligence (MIT); oss-pulse (no LICENSE file) referenced only; two pitfalls seen elsewhere designed out (score saturation at 100, newness bonuses). No dependencies added.

## 2. Due-collection implementation
`src/collect/dueCollector.ts`, `scripts/collect/due.ts`, `npm run collect -- --due`; tracking engine extended with **UNASSESSED** (not a tier), due order, young-repository rules. Details and safety properties in DUE-COLLECTION.md.

## 3. Repositories assessed (MEASURED)
- Tracked 3,413; measured before Phase 4: 365 (500-set minus 135 UNKNOWN); measured after: **410** (365 + 45); **UNASSESSED 3,003 (88.0%)**.
- The 45 were the youngest UNASSESSED repositories (aged 1-6 days), chosen by the collector's own ordering, so they are **not representative**.

## 4. API usage (MEASURED, anonymous)
45 star-history requests, 0 retries, 0 failures, 0 GraphQL; core limit 60/h with 15 remaining afterwards; 2,823 bytes total (63 B per response, young repositories); about 6 s at concurrency 3; the re-run from the persisted cache used 0 requests (45 hits). Not measured: authenticated due run, GraphQL in a due run, anything above 45 repositories. Phase 2 remains the authenticated reference (500 repositories: 599 REST + 10 GraphQL, 6.6 minutes).

## 5. Growth-data coverage (MEASURED, 545 repositories with history)
- Of 545 repositories: 7-day window fully observed for 500 and reported as `partial-window` for the 45 new ones; 30-day fully observed for 500, **null by the age rule for the 45 new ones**; 90-day fully observed for 499, null for 46 (the 45 new plus a 43-day-old repository). Null is never 0.
- All 45 new histories were complete (repository younger than 30 weeks); 22 of the 500 were complete.
- Quality: 0 stored warnings in the 500; the 45 new produced star-count corrections from complete histories (STARS_FROM_HISTORY) where metadata was stale.

## 6. Tracking distribution (MEASURED) and threshold review

| | Phase 3 provisional (not measurement) | Phase 4 measured |
|---|---|---|
| Tracked | 3,413 | 3,413 |
| HOT | 121 (provisional) | **69** (2.0% of tracked) |
| WARM | 3,292 (provisional) | **341** (10.0%) |
| DORMANT | 0 | **0** |
| UNASSESSED | (not a state) | **3,003 (88.0%)** |
| Assessed / unassessed | 365 / 3,048 | 410 / 3,003 |

Among the 410 measured: HOT 16.8%, WARM 83.2%, DORMANT 0%. The Phase 3 provisional numbers (121 HOT, 3,292 WARM) were guesses for unmeasured repositories and must not be compared as if they were the same kind of data.

**Threshold review (explicit reasoning):** the measured population is 365 top-starred, recently pushed repositories plus 45 repositories under a week old. It contains no old quiet repository, so **DORMANT cannot be evaluated and no DORMANT threshold was changed**. The review did find two rule defects, fixed as defects, not as tuning: (1) stars/day divided young repositories' growth by 7 (25 of the 45 were wrongly DORMANT); (2) "DORMANT" is meaningless for a repository younger than 30 days (`rules.dormant.minAgeDays = 30`). HOT (80 stars/day, 1% and 100 stars) and WARM (8 stars/day) thresholds are unchanged: on the 500 they select 12% and 88%, but on a wider population that split is **UNKNOWN**. The distribution of 7d/30d/90d growth is in §7 and MOMENTUM.md §7.

## 7. 7d / 30d / 90d distributions (MEASURED, 500 top-starred repositories; p10 / p50 / p90 / p99)
growth7d 15 / 80 / 573 / 3,956 · growth30d 75 / 456 / 3,139 / 24,614 · growth90d 264 / 1,596 / 11,661 / 50,688 · stars/day 7d 2.1 / 11.4 / 81.9 / 565.1 · 30d 2.5 / 15.2 / 104.6 / 820.5 · 90d 2.9 / 17.7 / 129.6 / 563.2 · growth percent 30d 0.25 / 1.26 / 6.96 / 43.4. Age: median 2,055 days (only 1 repository younger than 90 days). Full percentile tables in MOMENTUM.md §7. **This is the distribution of popular repositories, not of the candidate population.**

## 8. Momentum methodology
MOMENTUM.md. Raw signals first (growth, velocity, percentage, prior velocity, acceleration, sustained, new entrant, activity), MomentumScore v1 (velocity 0.55, relative growth 0.15 gated by absolute growth, acceleration 0.15, persistence 0.15; soft-saturating, no ceiling; missing components excluded and renormalised; 0.85 inactivity multiplier), deterministic explanations, no LLM, no classification or tier input. Weights are **ASSUMED**.

## 9. Results on 545 real repositories (MEASURED)
Trend: **27 Rising, 82 Cooling, 436 Steady** (0 insufficient, 0 excluded). Lists: 27 Rising, 80 movers (6 UP, 74 DOWN), 131 sustained, 36 new entrants. Momentum computed in 300 ms for 545 repositories.

**Rising examples (top by score, all measured):** vectorize-io/hindsight (+3,956 stars in 7 days, 565/day, accelerating 4.97x, score 76.2), farion1231/cc-switch (+3,022, 2.29x), Tencent/WeKnora (+2,653, 1.55x), mizorewww/laya-mlx (6 days old, +6,248), stablyai/orca (+5,560). 27 qualify; all are listed in `data/momentum/momentum.json` (`lists.rising`) with explanations.
**Biggest movers UP:** hindsight (+451.5 stars/day vs its prior four weeks), cc-switch (+243.4), WeKnora (+133.8), browserbase/stagehand (+116.2, accelerating 7.97x; not Rising because its 30-day velocity is 44.5/day, below the 50/day floor), paperless-ngx (+72.5). **DOWN:** tt-a1i/archify (-1,239.5/day), deepseek-harness (-849.2), ponytail (-743.8).
**Sustained examples:** archify, deepseek-harness, ponytail, ayghri/i-have-adhd, affaan-m/ECC (every observed window >= 30 stars/day).
**New entrant examples (age in days, 7d growth):** laya-mlx (6, 6,248; Rising through velocity), mikehasa/golive-skill (2, 896; Rising), yetone/magpie (2, 690; STEADY: below the Rising growth floor), short-video-generator-AI (1, 282; STEADY), jev-chat-windows (4, 535; STEADY).
Not selected by hand: these are the top of each deterministic list. Whether 27 Rising is "right" is UNKNOWN; it is what the configured criteria produce on this sample.

## 10. Manual review (single reviewer, 545 repositories; directional, not statistical)
Groups looked at: high lifetime stars / low growth (gemini-cli 107k stars +148/week -> STEADY 31.7; pytorch 103k, +191/week -> STEADY 32.7; kubernetes 128k, +171/week, ratio 0.21 -> COOLING 42.1): sensible. Low lifetime / high growth (hindsight 27.8k, WeKnora 29.7k, floci 25.5k): Rising, sensible. Old repositories (awesome-selfhosted, 11 years old, +1,398/week -> Rising 51.1; caddy 11 years, +236/week -> STEADY 44.8): sensible; the score does not penalise age. Lowest scores (RxJava +2 stars in 7 days -> 5.8; mocha, MPAndroidChart, sequelize): sensible. New repositories (laya-mlx, golive-skill Rising; others Steady): consistent with "newness is not momentum". HOT / WARM: HOT are the fast or new-and-growing; WARM are large and active. UNASSESSED and UNKNOWN: not scored / not tracked, by design.
**Errors found and fixed by this review:** (1) repositories whose last week ran at 15-50% of the previous four weeks were labelled Rising (archify, ponytail, deepseek-harness ...) -> added the "holding" rule (ratio >= 0.6), they are Cooling; (2) a gap between Rising's 0.6 and Cooling's 0.5 left fast-fading repositories as STEADY (deepseek-harness at 0.51) -> Cooling boundary set to 0.6; (3) 25 of 45 young repositories wrongly DORMANT (tracking). **Known imperfections left:** the Movers list is dominated by DOWN entries and by large repositories; classification UNKNOWN repositories can be Rising (awesome-selfhosted, firecrawl: momentum is independent of classification by design).

## 11. Tests (MEASURED)
**343 tests, 14 files, all passing** (Phase 3: 280; +63). New: due collector 21, momentum 33, tracking +9 (UNASSESSED, young rules). Coverage of `src/`: 97.2% lines. All required cases A-Z covered (due / not-due, HOT/WARM/DORMANT policy, UNASSESSED, insufficient 30d/90d, zero vs null, positive growth, invalid history, 7d/30d/90d, percentage, stars/day, momentum determinism, explanation, new entrant, sustained, biggest mover, classification independence, tracking independence, partial-collection protection, rate-limit handling, cache).

## 12. Performance (MEASURED)
momentum 545 repositories 300 ms; tracking 3,413 repositories about 35 ms; due selection and merge of 45 repositories 143 ms from cache.

## 13. Dataset sizes (MEASURED)
candidates 5.2 MB · classified 14.1 MB · tracked 3.3 MB · repositories (545 with history) 1.49 MB · momentum (internal) 1.75 MB · **public 457 KB pretty / 321 KB minified for 545 repositories (590 B each)**. ESTIMATED for all 3,413 tracked: repositories about 9 MB, momentum internal about 11 MB, public about 2 MB minified. Strategy: the frontend loads only the public file; internal files are not shipped (MOMENTUM.md §6).

## 14. Rate-limit observations (MEASURED)
Anonymous core 60/h with a fixed hourly reset; 45 requests used 45. The earlier finding stands: anonymous search buckets can be drained by other traffic on a shared IP and GitHub's stated reset can lag by seconds; the retry/guard changes from Phase 3 handled it. The authenticated accounting anomaly (`/rate_limit` showing `used: 0` after requests) is still unexplained: **authenticated capacity UNKNOWN**.

## 15. Known limitations
- 88% of tracked repositories are still UNASSESSED; every conclusion about the wider population is UNKNOWN.
- Thresholds and weights are assumptions tuned on 500 popular repositories; DORMANT never observed on a real quiet repository.
- Star history reflects current stars by date (un-starred users vanish); daily resolution; day boundaries labelled UTC.
- The Movers ranking favours large repositories and, on this sample, decline.
- No fork / contributor / issue signals; momentum can be inflated by non-organic star spikes and does not try to detect them.
- Momentum is descriptive; it makes no claim about future success, popularity or value.

## 16. Phase 5 readiness
Not yet. Before the dashboard: (1) run the first assessment (command in DUE-COLLECTION.md §1), then `npm run track` and `npm run momentum`; (2) re-measure the tracking distribution and re-review the tier and Rising thresholds on the wide population (keep a tuning and a validation subset separate); (3) decide how `data/public/radar.json` is refreshed (it is the frontend contract; `schemaVersion 1`); (4) measure an authenticated due run (GraphQL + rate limit accounting). The data model, engines, safety properties and public/internal split are ready for that.

---

## Addendum: full-scale authenticated run (2026-09-26)

Supersedes the "NOT complete" status above for assessment coverage. Token supplied only through the `GITHUB_TOKEN` environment variable of the running process; it is stored nowhere in the repository.

**Run 1** (`npm run collect -- --due --domain all --concurrency 4 --cache .cache/sh-due.json --out data/repositories.json`): 2,997 due, 2,695 collected, 302 failures. Almost all failures were GraphQL 504 on whole 50-repository batches (metadata stage). Star history itself: 200 fresh requests, 0 retries (the rest came from the persisted cache), 335 KB.

**Fix:** `GraphQLRepositoryProvider` now retries a failing request once and, if a 5xx/network failure persists, splits the batch in halves down to single repositories. Batch size is never raised above 50. Test added (344 tests pass).

**Run 2** (same command): 47 due, 45 collected, 2 failures: `755596985/Sure-Xu` and `laolaoshiren/claude-code-skills-zh`, both "not found by GraphQL" (deleted or renamed away; stay UNASSESSED). Core rate limit afterwards 4,753/5,000.

**Final state**
| Item | Value |
|---|---|
| Tracked | 3,413 (984 unclassified excluded) |
| Tiers | HOT 219, WARM 2,249, DORMANT 943, UNASSESSED 2 |
| Estimated daily refreshes | 1,103 |
| Dataset records | 3,546 |
| Momentum | RISING 35, COOLING 195, STEADY 3,316; movers 123, sustained 164, new entrants 293 |

DORMANT is now measured on a real wide population (943 repositories). Thresholds were NOT changed after seeing these results. The 500-repository tuning set and the rest remain separate; the Rising list top entries (e.g. vectorize-io/hindsight, rocketride-org/rocketride-server, farion1231/cc-switch) have 7-day growth of 700 to 6,000 stars and look plausible, but a full manual review of the wide population is still open. Evidence: `results/phase4/run2/`.
