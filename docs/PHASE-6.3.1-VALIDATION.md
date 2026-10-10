# PHASE 6.3.1 VALIDATION

Date 2026-10-10. Verdict: **PARTIAL. PHASE 7 NOT READY.** Detail documents: [REUSE-AUDIT](PHASE-6.3.1-REUSE-AUDIT.md) · [SHADOW-VALIDATION](PHASE-6.3.1-SHADOW-VALIDATION.md) · [TAXONOMY-VALIDATION](PHASE-6.3.1-TAXONOMY-VALIDATION.md) · [LIFECYCLE-SEMANTICS](PHASE-6.3.1-LIFECYCLE-SEMANTICS.md). Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**. Nothing in this phase changes production behaviour: `radar.json`, AI ranking, classification, tracking, discovery, the production workflow and the UI are untouched, and Engineering is still "Coming soon".

## 1. Baseline (verified, not taken from the brief)
`main` at `6a18aee`, equal to origin/main; working tree clean except two untracked cache folders. **The brief said Phase 6.3 was not committed; it is** (commit `6a18aee`, pushed). Phase 6.2.2 is closed (`08e2671`). Latest production data commit `a0cb38d` (2026-10-09 run). The three scheduled runs of 10-07, 10-08 and 10-09 all succeeded. Phase 6.3 is shadow-only: nothing imports it from a production module (a test asserts this).

## 2. What this phase delivered
| Goal | Delivered | Status |
|---|---|---|
| A. Top-300 admission in a real scheduled production-shadow cycle | Shadow runner, tracker, cycle aggregator, an inert (variable-gated) workflow, full 66-topic discovery measured once (manual, anonymous), one manual tracking day, admission-quality review | **PARTIAL: the weekly cycle is NOT YET OBSERVED** |
| B. Human-labelled taxonomy evaluation (at least 200) | 237-row blind labelling pack, validated scorer, labeller guide; **preliminary assistant labels** scored | **NOT DONE: 0 human labels** |
| C. Engineering lifecycle semantics | Definitions, config, pure module, replay on 29 days, Cooling and New-to-Radar validated | done (replay evidence, hindsight classification) |
| D. Safety gate for publishing Engineering data | Designed gate (`gateV2`), data contract, permanent AI byte-identical CI assertion, 25 gate tests | done as design; production gate **unchanged** |

## 3. Results
### Shadow (FACT, manual local run; see SHADOW-VALIDATION)
66 topics, 148 search requests, 12,310 raw results, **8,224 unique**, 4,086 duplicates, 22 archived, 0 forks, **4,327 novel**; novel UNKNOWN **25.2%**; 121 learning exclusions; 2,953 below the lifetime-stars/day threshold; **164 proposed, 14 held by the weekly cap, 150 admitted**. Phase 6.3's 14-topic extrapolation (up to 919) overestimated the pool; the measured number is 164. Admitted repositories: 28% created within 90 days, 79% within a year. **Admission precision proxy 90% (79.9–95.3%)** on 60 reviewed (assistant review). 64% of sampled UNKNOWN rejections are in scope (classifier, unchanged). Shadow tier mix of 54 measured admitted repositories: HOT 26%, WARM 74%, DORMANT 0; mean 0.506 history requests per repository per day.
### API budget (history requests per day)
Current 1,125 (production actual days: about 110, 821, **1,795**) · expected with the shadow about 1,201 growing to about 1,429 at a 600 pool · **worst case 1,725** · ceiling 2,000 · observed shadow day 1: 55 (anonymous quota). Search +82 a week. **Actual scheduled usage: not measured**; production's own peak (1,795) plus the shadow's first-fetch burst would reach 1,945, so the shadow yields to production on heavy days (guard built and tested).
### Taxonomy (preliminary, ASSISTANT labels: NOT human, NOT independent; engineering-only scope)
Domain precision 0.913 raw (0.963 weighted) and recall 0.852 (0.774); area precision 0.560 and recall 0.786; **technology precision 0.475 raw (0.583 weighted)**, recall 0.872 (0.803); learning precision 0.893, recall 0.641; **UNKNOWN 24.0%** of the frame, 9.6% of labelled Engineering. 46 technologies: 3 useful, 3 ambiguous, 25 too broad, 15 insufficient evidence. Main finding: the rule accepts a technology from a topic alone, which implements "touches", not "is about". **Not changed.** Details and the exploratory trade-off (precision 0.42 to 0.73, recall 0.91 to 0.47) are in TAXONOMY-VALIDATION.
### Lifecycle (FACT, replay on 1,736 Engineering repositories, 29 days)
Rising = Trending on three of the last five days (1.78% of the domain, next-week persistence 0.796, collapse 0.057; production Rising 0.29%, 0.677); Accelerating floor 30 stars a week (flickers: annotation only); **Breakout unreliable** (1 day episodes, 21–27% collapse: annotation after two days); Cooling = baseline in the top decile and this week under half of it (83.5% confirmed, 8.2% false cooling, against 77.6% and 10.1% for the production rule); Sustained = top 5% of 30-day growth with three of the last four weeks at or above 30 (static, 95% still sustained a week later); **New to Radar = first appearance in the published Radar within 14 days** (published in weekly batches: for Engineering only 26.4% of newly published repositories are genuinely new, median age 5.2 years; so a genuinely-new flag is required alongside).
### AI regression (hard gate): ZERO differences, before and after
1,735 AI/BOTH records: 0 added, 0 removed, 0 reordered, 0 score, 0 trend, 0 pattern changes, 0 records with any field change, all six lists and `history.json` identical; before and after artefacts are byte-identical; the pinned hashes of the ranking sources equal those of Phase 6.3.
### Leakage
The Phase 6.3 audit (24,000 repository-date pairs, 0 differences, positive control 18,889 of 21,431) covers the observable rows and the normalisation used here. **No separate leakage audit was run for the lifecycle replay**; its inputs are those T-bounded rows plus weekly windows built from gains up to T, and the next week's growth is used only to score. LIMITATION: extend the audit to the lifecycle module before relying on it.

## 4. Public-data gate design (shadow; production gate unchanged)
`src/pipeline/gateV2.ts` states exactly what would change, as code and 25 tests:
1. **One new top-level key** in `radar.json`: `domainContractVersion` (the integer 1).
2. **Six new optional record keys**: `domain`, `areas`, `technologies`, `facets`, `domainMomentum`, `engineeringLifecycle`, allowed **only on ENGINEERING records** (AI and BOTH records must stay unchanged).
3. **Every new value is validated**: closed value sets (domain, age band, content type, `via`), taxonomy slugs checked against the loaded taxonomy, integer percentiles 0–100, small non-negative integers, a maximum of 1,024 added bytes per record, explanations of at most 4 sentences and 240 characters that must pass an unsafe-text check (local paths, URLs, `localhost`, internal directory names, "shadow", "experiment", `_synthetic`), the explanation only on a Trending record, `rising` requires `trending`, `newToRadar` requires `firstPublishedAt`.
4. **The original rules still apply**: the unchanged production checks run on the dataset with the new keys removed; secret-shape checks run on the whole text; unknown keys at any level, synthetic markers and token-shaped strings are rejected.
**Permanent CI assertions** (`tests/phase631.test.tsx`): the production gate still rejects every new key; the designed gate accepts the committed data and a well-formed extension; **introducing Engineering fields leaves every AI and BOTH record, every list and the history byte-identical**; new keys on an AI record are rejected; 18 malformed-value cases, a token, an oversized addition, an unknown top-level key and a wrong contract version are rejected; the original keys cannot be bypassed.
**Data contract** (shadow): `src/domain/contract.ts` (types, key lists, builders); size measured in Phase 6.3: +835,040 bytes raw (+27.6 KB brotli), 4.53 MB against an 8 MB warning level. `firstPublishedAt` is a **production-state prerequisite not yet built**.

## 5. Tests, build, security (FACT)
- **Tests:** 667 pass in 24 files (588 before; +79). Two Phase 6.2.2 / 6.3 guard tests were adjusted so experiment code may import experiment code and so the production-module guard names the unchanged production files instead of whole directories; their intent is unchanged.
- **Typecheck:** clean. **Build:** 1,740 pages, 8,715 files, 139,863,733 bytes (unchanged page count). 
- **Security:** token patterns, Bearer values, internal dataset names, local paths, `localhost:3000`, `_synthetic` and credential variable names: **0** in `out/`, the public data, source, scripts, docs and the new results. The 9 MB search cache and the local shadow pool are untracked and not for commit.
- **Workflow lint:** `actionlint` v1.7.12 clean on `shadow.yml` and `radar.yml`.
- **Production paths:** no change under `data/`, ranking config and sources, classification, tracking, `src/pipeline` publication modules, `src/collect`, `app/`, `lib/`, `components/`, `radar.yml`, `package.json`.

## 6. Success criteria
| Criterion | Status |
|---|---|
| Starts clean / baseline understood | yes (premise corrected: 6.3 is committed) |
| Fresh reuse audit | yes |
| Top-300 runs in real shadow mode | **partial**: manual local run; scheduled workflow built, inert, not run |
| One complete weekly cycle observed | **NO** |
| Shadow data never reaches `radar.json` | yes (enforced, tested; nothing reached it) |
| Admission behaviour measured | yes, one run |
| 50+ shadow admissions manually reviewed | yes, 60 (assistant review, not independent) |
| API budget measured | partly (arithmetic, tier mix, day 1); **actual usage not measured** |
| Actual API usage safely below ceiling | **not demonstrated** |
| 200+ Engineering repositories human-labelled | **NO: 0 human labels** (237 assistant labels, preliminary) |
| Domain / area / technology precision and recall measured | **preliminary only** |
| UNKNOWN rate measured | preliminary (24.0%; 9.6% of labelled Engineering) |
| 46-technology taxonomy reviewed | preliminary |
| Lifecycle semantics defined; Cooling and New-to-Radar validated; replay completed | yes |
| AI regression zero | yes |
| Public-data gate design completed | yes |
| No Engineering UI; "Coming soon" kept; no Engineering data in production; AI unchanged | yes |
| Tests, typecheck, build, security | yes |
| Documentation | yes (five documents) |

## 7. Stop conditions
- **6. "Taxonomy evaluation cannot obtain 200 valid labels": TRIGGERED** (for human labels). Reported; no workaround: the assistant's labels are labelled as such and are not counted.
- 5. "Taxonomy precision is poor": on the preliminary labels technology precision is 0.475 raw; reported, not acted upon.
- 1, 2, 3, 4, 7, 8, 9, 10: not triggered (no shadow data in `radar.json`; AI unchanged; budget within the ceiling on paper; Top-300 growth bounded by caps; lifecycle is deterministic; no gate weakened; no UI needed).

## 8. Remaining risks
1. No human taxonomy labels; the technology tag meaning (subject or stack) is undecided.
2. The scheduled week has not been observed; production's catch-up days leave little headroom beside a shadow burst.
3. 25% of novel candidates are UNKNOWN and about two thirds of those sampled are in scope: admission cannot fix classification.
4. `firstPublishedAt` does not exist in production state.
5. Lifecycle replay: 29 days, today's classification, no dedicated leakage audit, no human judgement of "really rising".
6. The admission and labelling reviews were written by the same assistant that built the tools.

## 9. Decision
**PHASE 6.3.1: PARTIAL.** Two of the four goals are done as designed (lifecycle semantics, gate design); the other two are built and measured only as far as can be done without external time and a human: the weekly shadow cycle and the 200 human labels are the missing evidence. **Phase 7 is not ready.** To turn this into a PASS: (1) merge `shadow.yml`, set `SHADOW_ENABLED=true` and observe seven days; (2) have two people label `sheet.csv` blind and run the scorer with `--kind human`; (3) decide the meaning of a technology tag and re-measure if it changes; (4) extend the leakage audit to the lifecycle module.

PHASE 7 NOT READY
