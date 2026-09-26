# PHASE 3 VALIDATION — classification and tracking

Date 2026-09-25. Legend: **MEASURED** · **ESTIMATED** · **ASSUMED** · **CONFIGURED** · **UNKNOWN**.

## Gate
Phase 2 authenticated validation was verified from `results/` and documented in PHASE-2-VALIDATION.md before starting (smoke tests: rate-limit 6/6, graphql 9/11 with the 100-repository boundary test failing as designed, search 19/19, star-history 6/6; 500-repository collection written, 500/500 graphql metadata). Phase 3 used **no GitHub token**: it is local and deterministic; only the candidate discovery re-run used the anonymous search API.

## 1. What was implemented
- **Candidate dataset** (`data/candidates/`): discovery output saved as its own dataset (`--candidates-out`), deduplicated by repository id, provenance kept separate.
- **Deterministic classifier** (`src/classification/`): 33-category taxonomy in config, strong/weak/exclusion signals, context (negative) signals, explainable `ClassificationResult`, `classifierVersion phase3-v1`.
- **Classified dataset** (`data/classified/`) and CLI `npm run classify`.
- **Tracking engine** (`src/tracking/`): HOT/WARM/DORMANT, configurable policy (`config/tracking.json`), hysteresis, provisional tiers, reasons, `nextRefreshAt`, due selection, volume estimate.
- **Tracked dataset** (`data/tracked/`) and CLI `npm run track`.
- Fixture-based evaluation script (`scripts/classify/evaluate.ts`), 25 real-repository fixtures with pre-written expectations.
- Docs: PHASE-3-REUSE-AUDIT, CLASSIFICATION, TRACKING, DATA-MODEL (updated), THIRD_PARTY.md, this file.
- Robustness fix found by the live discovery run (see §9): primary rate-limit retry around the stated reset time.

## 2. Reuse audit results (docs/PHASE-3-REUSE-AUDIT.md)
Nothing suitable to REUSE as an engine. **ADAPT (data):** github/explore topic aliases (CC BY 4.0, attributed). **REFERENCE:** ecosyste-ms/oss-taxonomy (CC0, vocabulary only, no classifier), HiGitClass / GitRanking (research), Trending-Intelligence (keyword-hit classifier, the failure mode being fixed). **REJECT:** Hugging Face zero-shot models and NLP libraries (ML / unnecessary). Everything else BUILD, in about 600 lines of TypeScript, no dependency added.

## 3. Architecture
`discovery -> candidates.json -> classify -> classified.json -> track (+ Phase 2 growth) -> tracked.json`. Identity = GitHub repository id in every dataset; each dataset stores only what it adds; the classifier input type contains no discovery fields; tracking never reads category names (only an eligibility gate on top-level classification). Details in DATA-MODEL.md, CLASSIFICATION.md, TRACKING.md.

## 4. Taxonomy
14 AI + 19 engineering = 33 categories, unchanged. Only a display rename: slug `spring-boot` now shows as "Spring". Rules per category: strong/weak topics, strong/weak keywords, exclusion topics/keywords (+ language weights for Java, Kotlin, Scala, HCL).

## 5. Signals and rules (summary; full tables in CLASSIFICATION.md)
Strong topic 4/2/1 · weak topic 1.5 (max 3) · name strong 3 · description strong 3 (max 2) · weak 1 (max 2) · language per category · README 1 (max 2, unused by the pipeline) · exclusions −6/−4 · educational-content context halves topic evidence. Accept at score >= 6 **and** strong topic or strong name (identity evidence). BOTH only if the weaker domain >= 0.5x the stronger. All **CONFIGURED**; the values themselves are **ASSUMED** (shaped by the review below, not fitted).

## 6. Results on real data

### Classification of the full candidate set (MEASURED)
Fresh anonymous discovery: 99 queries, **4,397 unique candidates** (the authenticated run reported 1,998 + 2,619 before merging domains; the merged count differs slightly because search results shift over time).

| Result | Count | Share |
|---|---:|---:|
| AI | 1,443 | 32.8% |
| ENGINEERING | 1,727 | 39.3% |
| BOTH | 243 | 5.5% |
| UNKNOWN | 984 | 22.4% |

Per category (accepted, a repository may count in several): llm 477, ai-agents 449, ai-coding 363, java 327, mcp 273, kubernetes 242, databases 206, machine-learning 193, security 190, ... system-design 48, ai-developer-tools 50 (all 33 categories occur at least once).

Performance (MEASURED, one machine): classification of 4,397 repositories **486 ms** (about 0.11 ms each), tracking 35 ms, no network.

### Classification tests and fixtures
- Test suite: **280 tests pass in 12 files** (177 before Phase 3; +103 new = 70 classification + 33 tracking), `tsc --noEmit` clean. Line coverage of `src/` 96.8%; `src/classification` 98.4%, `src/tracking` 97.5%.
- Real-repository fixture (25 repos, expectations written from metadata before running): **24/25 exact, 25/25 acceptable**. AI precision 8/8, engineering precision 14/14, false AI 0, false engineering 0, false negatives 1, UNKNOWN rate 16%, BOTH rate 4%. **Contaminated** (tuning data overlap); not production accuracy.

### JavaGuide regression (MEASURED, automated)
Real metadata (topics include `mcp`, `ai`, `agent`, `deepseek`, `springai`): result **ENGINEERING / Java, score 8**, no AI category; negative signals list the educational-content context and the 2-point topic discount. Tests assert: not AI; MCP score below acceptance; the `mcp` topic alone never makes a repository AI; independent of discovery provenance.

### False positives (MEASURED by manual review, single reviewer, n small)
From 44 classified candidates outside the tuning set: 2 clear (Android launcher -> Java; cancer knowledge graph -> MCP), 2 borderline (distrobox -> Docker, JRuby -> Java). From the 500-set review during tuning: provider-tag leakage (LibreChat gets AWS/Cloud from `aws`/`azure` tags), Playwright tools -> Testing (fixed), tutorial repositories -> Databases (mitigated by the educational context).

### False negatives (MEASURED by manual review)
In a 30-item UNKNOWN sample, about 12-13 were classifiable by a human (couchdb, kedro, grafana/beyla, resonate, OpenAEV, a Gradle plugin set, image-generation playground ...). Cause: exactly one strong topic plus weak support (score 5-5.9). The recall problem is real: UNKNOWN 22.4% is partly wrong. A corroborated lower threshold (score 5 with 2 evidence kinds) recovered 201 repositories but about 10-20% of those were wrong; it is implemented, tested and **disabled**.

### Tracking (MEASURED policy output)
Thresholds were set from percentiles of the 500 authenticated growth measurements (starsPerDay7d p90 = 81.9 -> HOT >= 80).

| Set | Tracked | HOT | WARM | DORMANT | Provisional (unassessed) | Not tracked |
|---|---:|---:|---:|---:|---:|---|
| 500 measured repos (growth known) | 365 | 45 (12.3%) | 320 (87.7%) | 0 | 0 | 135 UNKNOWN |
| Full 4,397 candidates (growth for the 500 only) | 3,413 | 121 | 3,292 | 0 | 3,048 (2,972 WARM + 76 HOT) | 984 UNKNOWN, 0 archived |

The by-category split of tiers shows tier is not a function of category (500-set: AI 33 HOT / 144 WARM, ENGINEERING 6 / 161, BOTH 6 / 15). **DORMANT is empty in both** because the sample is top-starred and all pushed within 30 days: whether the thresholds separate a broader population is **UNKNOWN**.

### Tracking transitions (automated tests, 33 tests)
DORMANT->WARM, WARM->HOT (immediate); HOT->WARM, WARM->DORMANT (after minimum days, below 70% of thresholds); demotion damped by minimum-days and by the 70% band; one level at a time; provisional evaluation never demotes; tier independent of category; refresh hours from config; determinism.

### Estimated daily collection volume and API usage
Requests per day = sum(tier count / (refresh hours / 24)); each is one star-history request (1 core request, MEASURED avg 1.9 KB and 0.4 s in Phase 2).

| Scenario | Requests/day | Status |
|---|---:|---|
| The 500-set as tracked (45 HOT, 320 WARM) | **151.7** | computed from MEASURED tier counts and CONFIGURED intervals |
| All 3,413 tracked, currently provisional (unassessed WARM at 24 h) | 1,218 | computed; includes the one-time first assessment |
| One-time first assessment of the 3,048 unassessed | 3,048 requests | exact count; at 5,000/h documented PAT limit about 40 min of budget, at the 1,000/h Actions limit about 3 h (limits DOCUMENTED, authenticated accounting anomaly still UNKNOWN) |
| Steady state after assessment, if the 500-set's split held (12% HOT / 88% WARM) | about 1,400 | ESTIMATED under an assumption that is probably too pessimistic; true steady state UNKNOWN |
| Metadata refresh (GraphQL, 50 repos per request, cost 1) | about 69 requests per full refresh | ESTIMATED from measured batch cost |

## 7. Files
Created: `src/classification/{types,text,config,classifier,datasets,index}.ts`, `src/tracking/{types,config,engine,datasets,index}.ts`, `src/collect/candidates.ts`, `config/classification.json`, `config/tracking.json`, `scripts/classify/{index,evaluate}.ts`, `scripts/track/index.ts`, `scripts/gen-classification-config.mjs`, `tests/{classification,tracking}.test.ts`, `tests/fixtures/real-repos.json`, `THIRD_PARTY.md`, `docs/{PHASE-3-REUSE-AUDIT,CLASSIFICATION,TRACKING,PHASE-3-VALIDATION}.md`, `data/{candidates,classified,tracked}/*.json`, `results/classification-fixtures.json`.
Modified: `config/categories/{ai,engineering}.json` (added `classification` blocks; renamed one display name), `src/collect/pipeline.ts` (+ `candidatesOutPath`), `scripts/collect/index.ts` (+ `--candidates-out`), `src/util/retry.ts` (rate-limit retry), `tests/infra.test.ts`, `package.json` (scripts), `docs/DATA-MODEL.md`, `docs/PHASE-2-VALIDATION.md` (authenticated results documented).
Phase 2 architecture was **not** redesigned; the two collector edits are additive.

## 8. Dependencies added
None at runtime or for Phase 3. (`@vitest/coverage-v8`, dev only, was added in Phase 2 to measure coverage.)

## 9. Findings and fixes during the phase
- **Live rate-limit behaviour (MEASURED):** anonymous search limit drained between two of our requests by other traffic on the shared IP (remaining 4 -> 0), and a request 4 s after the stated reset was still refused. Two 25-minute discovery runs failed on this before the retry logic waited for the reset (+3 s margin, growing pause). Rule now: retry a primary limit whose reset is within a minute either side of now.
- The identity-evidence rule and the exclusion lists were added after reviewing measured false positives.

## 10. Known limitations
See CLASSIFICATION.md §8 and TRACKING.md §8. Headline: recall (UNKNOWN 22.4%, about 40% of a small UNKNOWN sample were classifiable), provider-tag leakage, BOTH inflation by AI developer tools (5.5%), README evidence not collected, thresholds calibrated on top-starred repositories only, DORMANT untested on real data, classified dataset 14.1 MB, collector does not yet consume `nextRefreshAt`.

## 11. Acceptance checklist
Fresh reuse audit ✔ · no unnecessary wheel ✔ · Phase 2 architecture preserved ✔ · deterministic ✔ (test) · 33 categories ✔ (test) · AI, engineering, BOTH, UNKNOWN ✔ · strong/weak/exclusion ✔ · negative/context signals ✔ · explainable result ✔ · JavaGuide regression ✔ · determinism test ✔ · candidate/classified/tracked separation ✔ · HOT/WARM/DORMANT ✔ · tracking config externalised ✔ · transition tests ✔ · no LLM ✔ · no database ✔ · no new backend ✔ · no UI ✔ · no MomentumScore ✔ · documentation ✔ · `tsc --noEmit` ✔ · full suite (280) ✔.

## 12. Confirmations
- **MomentumScore was NOT implemented.** No rising ranking, no biggest movers, no rank movement, no sustained momentum. Tier rules use growth only as a refresh-frequency trigger.
- **No UI was implemented.** No dashboard, cards, charts or Vercel deployment.

## 13. Phase 4 readiness and recommendations
Ready to start, with these caveats:
1. Phase 4 can consume `ClassifiedRepository` (`classified.json`), `TrackedRepository` (`tracked.json`), star history (`repositories.json`) and `RepositorySnapshot` as designed.
2. **First step:** a "collect what is due" mode that reads `tracked.json` (`selectDue`), fetches history for the 3,048 unassessed repositories once, then re-runs `npm run track`. This is also what will produce the first real DORMANT/WARM/HOT distribution on a wide population; re-tune the thresholds then.
3. Improve recall deliberately: review a larger UNKNOWN sample, consider README/extra-topic evidence, and decide whether the corroborated threshold (disabled) is worth its ~10-20% wrong additions.
4. Trim `classified.json` (keep evidence for accepted + top near misses) before it goes into git or the Vercel build.
5. Measure with a token: authenticated `stargazers/history` accounting (the rate-limit anomaly), and the 500 -> 3,000 repository collection budget.
6. Do not present `confidence` in the UI as a probability.
