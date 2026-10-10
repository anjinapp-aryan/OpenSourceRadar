# PHASE 6.3.1 SHADOW VALIDATION (Top-300 discovery and bounded admission)

Date 2026-10-10. Code: `src/shadow/report.ts`, `scripts/shadow/{discover,track,cycle}.ts`, `.github/workflows/shadow.yml`, `config/admission.json`. Results: `results/phase6.3.1/shadow/`, `results/phase6.3.1/review/`. Tests: `tests/phase631.test.tsx`, `tests/phase631b.test.tsx`. Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**.

## 0. Status in one paragraph
**One complete weekly cycle in real scheduled conditions: NOT YET OBSERVED.** The scheduled shadow was built, linted and tested, but it cannot run before it is merged and enabled, and this phase may not commit. What was observed is **one manual, anonymous, local run** of the full 66-topic Top-300 discovery and admission policy (2026-10-10) and **one manual day** of shadow tracking. Those are real GitHub measurements and are reported as such; they are **not** a scheduled week and the cycle summary says `INCOMPLETE: 1 of 7 days observed`. Nothing reaches `radar.json`.

## 1. Shadow design (implemented, inert until enabled)
```
GitHub Search (66 topics x pages 1-3, stars desc)  ->  dedupe by repository id  ->  drop archived/forks
  -> deterministic classification (v1 rules, unchanged) + learning-content facet
  -> admission policy (config/admission.json: classified AI/ENGINEERING/BOTH, no learning content, not already a candidate,
                       lifetime-stars/day PROXY >= 10, 150 new per week, pool <= 600)
  -> shadow pool (own state) -> shadow tracking with the real tiers and due grace -> daily record -> weekly cycle summary
```
- **Isolation, enforced three ways.** (1) `discover.ts` and `track.ts` refuse an output path under `data/`, `public/`, `out/` or `.next/`; (2) `.github/workflows/shadow.yml` restores production state read-only into its own directory (`.shadow-prod`), never commits or pushes, and has a **Verify isolation** step that fails the job if any tracked file changed or anything was created under `data/` or `public/`; (3) tests assert the workflow text (no `git commit/push/add`, no `vercel`, no writes to `data/`) and that the shadow modules import no publication code.
- **Inert by default.** The job runs only when the repository variable `SHADOW_ENABLED` is `true`; merging the file starts nothing. Trigger: daily 13:47 UTC (after the production run, which starts 10:00 to 11:30 UTC), discovery on Mondays or on request.
- **Budget guard.** The tracker stops requesting history when production's requests today plus the shadow's would reach the configured ceiling (2,000); the limit is never raised by the script, and the cycle summary reports a STOP when the observed maximum reaches 90% of the ceiling.
- **Linting.** `actionlint` v1.7.12 (MIT) was run on `shadow.yml` and `radar.yml`: both clean. The workflow itself has **not** run on GitHub.

## 2. What was observed: the full Top-300 discovery (FACT, manual local run, anonymous, 2026-10-10)
66 topics, pages 1 to 3 of `topic:X stars:>100 pushed:>30d` sorted by stars; control = the production candidate set and tracked set of 2026-10-09 (4,490 candidates, 3,470 tracked).
| Measure | Value |
|---|---:|
| Queries / search requests | 66 / **148** (many topics return fewer than 300 results; 18.4 minutes at 7.5 s spacing, no rate-limit wait) |
| Raw results | 12,310 |
| **Unique repositories** | **8,224** |
| Duplicate results | 4,086 |
| Archived / forks | 22 / 0 |
| Usable | 8,202 |
| Already production candidates | 3,875 |
| **Novel candidates** | **4,327** |
| Novel classified AI / Engineering / BOTH / UNKNOWN | 1,162 / 1,861 / 215 / 1,089 |
| **UNKNOWN rate (novel)** | **25.2%** (production candidates: 22.7%) |
| Below the star floor | 0 (the query already requires more than 100 stars) |
| Learning-content exclusions | 121 |
| Lifetime-stars/day below 10 | 2,953 |
| Not classified (UNKNOWN) | 1,089 |
| **Proposed admissions** (pass every gate before the caps) | **164** |
| Weekly-cap hits | 14 |
| Pool-cap hits | 0 |
| **New shadow admissions** | **150** |
| Rejected in total | 8,052 (admission rate 1.8%, rejection rate 98.2% of usable) |
**Compared with the Phase 6.3 extrapolation:** the earlier estimate scaled 14 topics to 66 by ×4.7 and allowed up to 919 admissions; the measured number is **164**. The extrapolation was a ceiling, not a forecast. Likewise the added search cost: page 2-3 requests add **82** requests a week (148 against today's 66 established page-1 queries), not the 132 estimated.
Of the 150 admitted: **28% were created within 90 days, 79% within a year, 21% are older**; they include all five classified Rising probe repositories of Phase 6.2.2.

## 3. What was observed: one manual shadow tracking day (FACT, anonymous)
The tracker added the 150 admitted repositories and refreshed the due ones with the production tracking policy until the anonymous quota (60 core requests an hour) ended.
| Measure | Value |
|---|---:|
| Pool size / new admissions | 150 / 150 |
| Due | 150 (every new repository is due once: the first-fetch burst) |
| History requests | 55 (quota-limited) |
| History failures | 1 (the rate limit) |
| Rate-limit state | hit the anonymous limit |
| Runtime | 18 s |
| **Tier assigned to the 54 measured repositories** | **HOT 14 (26%), WARM 40 (74%), DORMANT 0** |
| **Mean refresh requests per repository per day (from those tiers)** | **0.506** |
**Reading (INFERENCE):** admitted repositories are overwhelmingly active; the planning figure of 0.362 requests per repository per day (from the Phase 6.2.2 sample) was too low. Only 54 repositories are measured, so this is an early estimate.

## 4. API budget: current, expected, actual, worst case, ceiling
| Case | History requests per day | Basis |
|---|---:|---|
| **Current** (production average) | 1,125 | tracked repositories at the production tier mix |
| Production **actual** days (per run) | 2026-10-07 about 110 (HOT skipped, see Phase 6.2.1) · 10-08 821 (HOT 238 + WARM 583) · **10-09 1,795** (HOT 225 + WARM 1,570) | `collection-evidence.ts` on the dated state backups |
| **Expected with the shadow, first weeks** | 1,125 + 150 × 0.506 = **about 1,201** (pool 150), up to **about 1,429** at a full pool of 600 | measured tier mix |
| **Observed shadow day 1** | 55 added (anonymous quota) | one manual day |
| **Worst case** | **1,725** | production 1,125 + the whole pool of 600 refreshed daily (HOT rate) |
| **Configured ceiling** | **2,000** | enforced at load: a configuration whose worst case exceeds it is refused |
Search: production 99 per week; Top-300 adds 82 (about 2.7 minutes authenticated).
**Finding (FACT):** production's own load is not flat. The 2026-10-09 run collected 1,795 requests (catch-up after the 10-07 skip); with the shadow's first-fetch burst of 150 that day would have been 1,945, within 3% of the ceiling, which the 90% stop rule would have flagged. The tracker's guard (budget for the shadow = ceiling minus production's requests of the same day) therefore makes the shadow **yield on a heavy production day**: on a 1,795-request day it would have 205 requests left. This costs nothing in correctness (undone work stays due) but means the first-fetch burst may spread over several days. **No actual scheduled usage has been measured**, so "actual remains safely below the ceiling" is **not yet demonstrated**.

## 5. Admission quality (assistant review, NOT independent and NOT human)
A seeded sample of **60 of the 150 admitted** repositories was read (name, description, topics, stars, age):
| Class | Count | Share |
|---|---:|---:|
| Clearly relevant (AI or Engineering software a reader of the Radar would expect) | 39 | 65% |
| Probably relevant | 15 | 25% |
| Questionable | 6 | 10% |
| Irrelevant | 0 | 0% |
**Admission precision proxy: 54 of 60 = 90% (95% interval 79.9% to 95.3%)** counting clearly plus probably relevant; 65% counting only clearly relevant. Obvious false positives (questionable): `mdpsec/bug-bounty-hunting-prompts` (a prompt collection), `asciimoo/hister`, `HughYau/qiushi-skill`, `mengxi-ream/read-frog`, `MaxMiksa/Auto-Company`, `romgX/openrelay`.
**Rejected candidates (samples read):**
| Rejection reason | Sampled | Finding |
|---|---:|---|
| Not classified (UNKNOWN) | 25 | **16 of 25 (64%) are in scope** (a Git client, a GitHub merge bot, an SSL scanner, a secret-management toolchain, an AI chat workspace, an SGLang runtime, a robotics model, an AI coding platform …): obvious false negatives caused by the unchanged classifier |
| Lifetime stars/day below 10 | 25 | 24 are relevant AI or Engineering repositories: rejected **by design** (the policy looks for repositories that may be rising; Phase 6.2.2 found 0 Rising in 175 randomly sampled repositories below 10) |
| Learning content | 10 | 9 correctly excluded; **1 false exclusion** (`Athena-OS/athena-nix`, an operating-system configuration) |
| Weekly cap | 14 | all 14 relevant, all at priority 10.0 to 10.5: held only by the cap |
**No threshold was changed.** The UNKNOWN false negatives are a classification problem (Phase 6.3 decision: the classifier stays unchanged); the cap-held and below-priority rejections are by design. A controlled comparison would be needed to change any threshold.

## 6. What the scheduled cycle will record
`scripts/shadow/cycle.ts` aggregates the daily records into: days observed and whether the cycle is **complete** (seven consecutive UTC days including one discovery day), total candidates, proposed and accepted admissions, admission, rejection and UNKNOWN rates, history requests per day (mean and maximum), total requests per day with production, search requests per week, failures, rate-limit hits, ceiling headroom at the observed maximum, and a STOP condition when the maximum reaches 90% of the ceiling. With no days it reports `NOT YET OBSERVED`; with fewer than seven it reports `INCOMPLETE`. Unit tests cover complete, incomplete, empty, gap, stop and failure cases.

## 7. Verdict
**PARTIAL.** Measured: the real 66-topic pool and admission counts, one tracking day, the shadow's real tier mix, an admission-quality review (90%), isolation and budget safeguards, a lint-clean inert workflow. **Not measured:** a complete scheduled week, actual daily usage over seven days, production-concurrent behaviour, history failures over time. **To complete:** merge `shadow.yml`, set `SHADOW_ENABLED=true`, let seven days run (including a Monday), then read `cycle-summary.json`. Success conditions: complete cycle, maximum total requests per day below 1,800 (90% of the ceiling), isolation step green every day, and the review repeated on that week's admissions.

## 8. Limitations
Anonymous manual run (no token), single snapshot, 54 repositories measured for tiers, admission review by the assistant that built the policy, the 14-topic extrapolations of Phase 6.3 were replaced by this measurement but only for one week's results (weekly flow unknown), Monday flow of admissions after the first week unknown.
