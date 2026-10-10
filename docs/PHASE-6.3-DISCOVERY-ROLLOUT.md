# PHASE 6.3 DISCOVERY ROLLOUT: CONTROLLED TOP-300 ADMISSION

Date 2026-10-09. Code: [src/discovery/admission.ts](../src/discovery/admission.ts), [config/admission.json](../config/admission.json), [scripts/discovery/admission-sim.ts](../scripts/discovery/admission-sim.ts) → `results/phase6.3/admission-simulation.json`, `admission-shadow.json`. Builds on `PHASE-6.2.2-DISCOVERY-RECALL.md`. Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**. **State: shadow. Nothing is admitted to tracking and the production discovery configuration is unchanged** (`maxPagesPerQuery` stays 1).

## 1. Objective
Phase 6.2.2 found Rising repositories behind the top-100 cut-off (8 in the probe; B top-300 found all) but also that a typical newly discovered repository is quiet (0 Rising in 200 random, 8.0% growers vs 13.1% in the current pool). Top-300 discovery is therefore worth adopting only with **bounded admission**: this document defines the policy, measures it on the 6.2.2 data, and states the budget.

## 2. Pipeline
```
Current discovery (top 100, unchanged)
+ Top-300 discovery (established queries, pages 1-3)         <- shadow, weekly
        |
        v  deduplicate by repository id, drop forks/archived
        v  deterministic classification (unchanged rules; UNKNOWN stays UNKNOWN)
        v  quality filters: learning content, minimum stars
        v  novelty: not already a candidate, not already admitted
        v  admission priority (lifetime stars/day PROXY, metadata only) >= threshold
        v  caps: new admissions per week, admitted pool size, worst-case history requests
        v  [shadow list today; tracking + star history when enabled]
        v  momentum (unchanged) -> Radar
```

## 3. Admission policy (`config/admission.json`, `policyVersion phase6.3-v1`)
| Gate | Rule | Why (evidence) |
|---|---|---|
| Mode | `shadow` (computed and reported, never fed to tracking) | Rollout is staged (section 7) |
| Relevance | classified AI, ENGINEERING or BOTH; UNKNOWN is **not** admitted | The classifier is not relaxed (section 6) |
| Quality | learning/list content excluded; minimum 100 stars | 59 of 2,751 candidates are learning content; 130 are under the star floor |
| Lifecycle | no archived, no forks | as production discovery |
| Novelty | not in the production candidate set, not already admitted | no double tracking |
| **Priority** | **lifetime stars per day ≥ 10** (stars ÷ age). An **admission priority proxy** (metadata only), **not momentum** | Table below |
| Weekly cap | at most **150** new admissions per run, highest priority first | fills the pool over four weeks |
| Pool cap | at most **600** admitted repositories tracked at once | worst-case budget (section 5) |

### Why a threshold of 10 (FACT, Phase 6.2.2 measurements, 14 experiment topics)
Candidates after relevance, quality and lifecycle gates, with outcomes from the **real tracking engine and momentum code** applied to the measured repositories (random sample weighted to the pool; probe reported only as existence):
| Minimum priority | Admitted (14 topics) | Share of novel pool | Estimated growers among admitted | Grower rate | Probe Rising / Near-Rising captured | Mean history requests per admitted repository per day | Added requests per day (14 topics) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 (everything classified) | 1,754 | 63.8% | 195 | 11.1% | 5 / 1 | 0.274 | 481 |
| 5 | 373 | 13.6% | 140 | 36.2% | 5 / 1 | 0.368 | 137 |
| **10** | **195** | **7.1%** | **84** | **35.6%** | **5 / 1** | **0.362** | **71** |
| 20 | 72 | 2.6% | 42 | 50.5% | 5 / 1 | 0.333 | 24 |
| 50 | 17 | 0.6% | n/a (0 in the random sample) | n/a | 5 / 1 | n/a | n/a |
Reading: every threshold from 0 to 50 captures the same five classified Rising and one Near-Rising probe repository, because all of them have a proxy ≥ 50. The threshold therefore decides **how many quiet repositories come with them**: from 1,754 to 17. Ten keeps a margin below the observed risers (the 10–50 band held 29% growers in the 6.2.2 sample) and cuts the admitted set by 89% against admit-everything, while the grower rate rises from 11% to 36%. 50 is rejected as too thin to measure (no random-sample repository at or above it); 0 and 5 admit mostly quiet repositories.
Tier mix assigned by the real tracking engine to the 200 random repositories: WARM 104, DORMANT 92, HOT 4 (mean 0.274 requests per day each).

## 4. Shadow result with the configured policy (FACT)
Applied to the same pool (14 topics): **150 admitted** (limited by the weekly cap; 195 pass the priority gate and 45 are held by `weekly-cap`), 1,559 rejected below the priority threshold, 808 not classified, 59 learning content, 130 below the star floor. **All five classified Rising probe repositories are among the 150** (`lexmount/moli`, `coreyhaines31/marketingskills`, `Ryze-AI-Adgent/open-seo-mcp-skills`, `pacifio/atlas`, `miqdadbadjuber/anti-slop`; the three Rising repositories classified UNKNOWN are not admitted). Config validation refuses to load a configuration whose worst case exceeds its ceiling.

## 5. API budget (numbers, not adjectives)
Search: **+132 requests per week** for Top-300 (2 extra pages × 66 established topics) on top of today's 99; at the authenticated 30 per minute that is 7.7 minutes a week.
History requests per day:
| Case | Requests per day | Basis |
|---|---:|---|
| **Current** | **1,125** | 3,471 tracked at the production tier mix (0.324 per repository per day; the 2026-10-09 run collected 1,795 including catch-up) |
| **Proposed, expected** | **about 1,125 + 71 to 333 = 1,196 to 1,458** | 71 is the 14-topic measurement at threshold 10; 333 is the same scaled to 66 topics (×4.7, an **upper bound**: the other 52 topics are smaller and 10.8% of new candidates repeat across topics), both before the 600 cap |
| **Worst case** | **1,725** | current + the whole admitted pool of 600 refreshed at the HOT rate (1 per day each) |
| Ceiling in the configuration | 2,000 | worst case must stay under it (enforced at load) |
Core API allowance: 5,000 requests per hour; the worst case is 1,725 per day (1.4% of a day's allowance). Workflow runtime observed 2.0 to 11.4 minutes over the last eight scheduled runs; the heaviest recent run collected 1,795 history requests in 8.7 minutes, so the worst case (1,725) is about the same load. **Compared with 6.2.2's estimate** (every new candidate tracked: up to 3,444 per day), bounded admission reduces the worst case by half and the expected case by 80 to 90%.
**Limitation:** the pool-size estimate for all 66 topics is an extrapolation from 14 topics; the first shadow weeks measure it directly.

## 6. UNKNOWN classification (decision: keep UNKNOWN)
Three of the eight probe Rising repositories are UNKNOWN. `scripts/classify/unknown-experiment.ts` tested the Phase 6.2 rule E1 (same-domain corroboration) against **independent labels** (54 OSS Insight collections, Apache-2.0): of 354 labelled repositories in the pool, 47 are v1 UNKNOWN (13.3%); the v1 classifier agrees with the labelled domain on 279 of 289 single-domain members (96.5%, 95% interval 93.7–98.1%); E1 fired on 21 labelled UNKNOWN repositories and proposed the right domain for all 21 (95% lower bound 0.845). The pre-declared adoption rule required **at least 30** fired labelled repositories and a lower bound of 0.80, so the evidence is **insufficient** (n = 21): **KEEP UNKNOWN.** Why the three Rising UNKNOWN repositories stay out: `monid` and `treg` ("OpenRouter for agent tools") have near-misses in two different domains (AI agents 5, developer tools 4/5.5), which E1 by design does not combine; `openGym` is a fitness tracker with an `mcp` topic that is correctly outside both domains. Of the 20 UNKNOWN probe repositories, most are near-misses at 4 to 5.5 (acceptance is 6), several are genuinely off-domain (a fitness tracker, blockchain contracts, a stock panel), and a group belongs to one plugin ecosystem. **Not a population-wide classification failure; 3 of 8 must not be generalised.** Open item for later: a labelled UNKNOWN set of at least 30 per domain to re-test E1.

## 7. Staged rollout and rollback
1. **Shadow (this phase):** `mode: shadow`. The weekly discovery step would write the Top-300 candidates and the admission list as a separate artefact; classification, tracking and the public data ignore it.
2. **Shadow week(s) in production:** measure the real 66-topic pool, how many pass each gate, the page-1-versus-deeper split, and the weekly flow. Success criteria are set before: new admissions per week ≤ 150; pool ≤ 600; worst case ≤ 2,000 requests per day (enforced); no change to existing repositories' scores (byte-identical regression, `scripts/momentum/ai-regression.ts`).
3. **Pilot (`mode: on`, not enabled):** wire the admitted list into the candidate set for classification and tracking; admitted repositories carry an `admission` marker in state so they can be identified and removed; keep for three weeks.
4. **Promote or stop** on pre-set criteria: new Rising/Near-Rising reaching the public data, quiet share of the admitted pool, request budget, regression.
**Rollback:** set `mode` to `off` (or `maxPagesPerQuery` back to 1); admission is recomputed every week, so the pool shrinks to zero with no persistent state; the previous dataset and atomic publication are untouched. **Retention stays disabled.**

## 8. Limitations
- The admission priority is a metadata proxy; it was validated on 240 measured repositories (14 topics, one snapshot day), and high thresholds have very few random-sample repositories.
- The probe is selection-biased; thresholds are justified by existence of risers at ≥ 50 and by grower rates in the 10–50 band, not by a population Rising rate.
- Budget for 66 topics is an upper-bound extrapolation.
- Classification gaps still withhold some risers (section 6).
