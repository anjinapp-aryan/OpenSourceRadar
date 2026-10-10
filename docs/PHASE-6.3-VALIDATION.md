# PHASE 6.3 VALIDATION

Date 2026-10-09. Base: `main` at `08e2671` (Phase 6.2.2 closed), working tree clean at start except the untracked 6.2.2 cache. Verdict: **PASS WITH LIMITATIONS. PHASE 7 NOT READY** (section 12). Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**. Detail documents: [REUSE-AUDIT](PHASE-6.3-REUSE-AUDIT.md) · [TAXONOMY](PHASE-6.3-TAXONOMY.md) · [MOMENTUM-VALIDATION](PHASE-6.3-MOMENTUM-VALIDATION.md) · [DISCOVERY-ROLLOUT](PHASE-6.3-DISCOVERY-ROLLOUT.md).

## 1. Objective
Build the shared intelligence foundation for AI Radar and a future Engineering Radar: a deterministic Domain → Area → Technology taxonomy, a domain adapter on the common engine, domain-aware momentum normalisation validated on history, a bounded Top-300 admission policy, and the data contract, **without** changing the AI Radar, publishing anything new, adding a dependency, a database, an LLM or an Engineering UI.

## 2. Baseline (FACT, verified from the repository, not from the prompt)
HEAD `08e2671`; origin/main equal; production data refreshed daily by the bot (`a0cb38d`, run 37923095319, 2026-10-09 11:27 UTC). Public data: 3,470 records; AI+BOTH 1,735; Engineering 1,736. Production Rising: 36 AI/BOTH. Engineering production Rising on the last replay day: 3 of 1,736 (0.17%). Phase 6.2.1 due-grace fix observed working on 2026-10-09 (HOT 225 of 227 collected where 2 were due without the grace).

## 3. What was audited and reused
Existing architecture (discovery → candidates → classification → tracking → star history → growth → momentum → patterns → `radar.json` → Next.js): the shared infrastructure is everything after classification; AI-specific logic is the absolute thresholds in `config/momentum.json` and the AI categories. Reused unchanged: the text matcher, the back-tester (`evaluateAt`), the momentum engine, the tracking engine, the GitHub clients, the public gate and the 6.2.2 shadow helpers. Fresh open-source audit: 24 external projects evaluated; the only data adopted is OSS Insight collection membership as **validation labels** (Apache-2.0) and github/explore aliases (CC-BY-4.0); no GPL/AGPL/unknown-license code or data; no dependency added. Details in `PHASE-6.3-REUSE-AUDIT.md`.

## 4. What was built (all additive; none imported by production code)
| Area | Files |
|---|---|
| Taxonomy v2 | `config/taxonomy.v2.json` (46 technologies, 8 areas, facets), `src/taxonomy/index.ts` |
| Domain model and adapter | `src/domain/index.ts` (`RadarDomain`, adapter config), `config/domains.json` (AI absolute; Engineering hybrid) |
| Normalisation | `src/momentum/normalize.ts`, `src/momentum/rows.ts` |
| Deterministic explanations and data contract | `src/explain/domainExplain.ts`, `src/domain/contract.ts` |
| Bounded admission (shadow) | `src/discovery/admission.ts`, `config/admission.json` |
| Experiments and gates | `scripts/momentum/{replay-rows,normalization-eval,engineering-validation,leakage-audit,ai-regression}.ts`, `scripts/taxonomy/validate.ts`, `scripts/classify/unknown-experiment.ts`, `scripts/discovery/admission-sim.ts`, `scripts/domain/contract-size.ts` |
| Tests | `tests/phase63.test.tsx` (49 tests); two Phase 6.2.2 guard tests narrowed (section 9) |
| Results | `results/phase6.3/*.json` (the 15 MB replay cache is not for commit) |
| Documents | the five `PHASE-6.3-*.md`, `THIRD_PARTY.md` entry |
Not changed: discovery, classification rules, tracking, momentum engine and thresholds, pipeline, workflow, public data, UI, `package.json`.

## 5. Results summary
| Question | Answer |
|---|---|
| Winning normalisation (Engineering) | Hybrid: domain percentile 0.98 or size-band percentile 0.97 on 30-day growth, bands 1,200/6,000, floors 50/30, acceleration ≥ 0.6, spike ≤ 60%, history ≥ 14 days (`MOMENTUM-VALIDATION` section 7, including the departure from the pre-declared ranking) |
| Engineering effect | Rising/Trending 0.17% → 1.79% of the domain (3 → 31 repositories, last day); persistence 0.677 → 0.784; collapse 0.060 → 0.066; under-5,000-star share 10.9% → 33.3%; over-50,000-star share 42% → 21% |
| AI | Unchanged by construction and by test: 1,735 records, **0 differences** after re-running the production pipeline |
| Leakage | **0 differences** in 24,000 repository-date pairs; positive control differs on 18,889 of 21,431 pairs |
| Taxonomy | 86.5% of Engineering repositories get a technology; held-out area recall 85.2% against independent labels; learning facet false-positive rate 0.9% |
| Top-300 admission | Shadow policy admits 150 per week, all five classified Rising probe repositories included; worst case 1,725 history requests per day (current 1,125; ceiling 2,000) |
| UNKNOWN classifier | **Kept.** E1 is promising (21 of 21 correct domain on independent labels) but below the pre-declared evidence bar of 30 |

## 6. Success criteria
| Criterion | Status |
|---|---|
| Fresh reuse audit | done |
| Existing architecture audited | done |
| Taxonomy v2 defined | done (versioned) |
| Domain / Area / Technology model implemented | **implemented as library + config + tests; not wired into the pipeline** |
| Engineering domain adapter implemented | implemented (`config/domains.json` + `normalize`); **not wired** |
| Candidate algorithms evaluated | done (59 configurations per domain) |
| Historical replay | done (29 days, 3,471 repositories) |
| Leakage audit passes | **pass** |
| Top-300 in bounded/shadow form | implemented (policy, config, simulation); the weekly discovery step does not call it |
| API budget measured | done (numbers in `DISCOVERY-ROLLOUT` section 5) |
| UNKNOWN decision evidence | documented; KEEP UNKNOWN |
| AI regression passes | **pass** |
| Engineering ranking improves or is better justified | improves breadth and size balance with durability above production; Kafka and Spring produce essentially nothing (reported) |
| Deterministic explanations | done (`explainDomainMomentum`, exact-string tests) |
| Schema compatibility | verified: new keys do not clash with the allow-list; the strict gate **refuses** them today (a gate change is needed to publish) |
| AI Radar preserved | yes |
| All tests / typecheck / build | pass (section 9) |
| Security and token scan | pass |
| Quality gates | unchanged and unexercised by new code; the existing gate tests pass |
| Documentation | five documents |
| No DB, no LLM, no paid API, no Engineering UI | confirmed |
**Not met in the strong sense:** normalisation and taxonomy are *proven offline and shadow-wired*, but **not published**: no new field reaches `radar.json`. That is deliberate (section 8) and is why the verdict is "with limitations".

## 7. Performance and storage (FACT, measured 2026-10-09)
| Measure | Now | With the additive fields (in-memory estimate) |
|---|---:|---:|
| `radar.json` | 3,698,337 B (gzip 583 KB, brotli 369 KB) | 4,533,377 B (+835,040 B = +241 B per record; brotli +27.6 KB); warning level 8,000,000 B |
| `history.json` | 366 KB | unchanged |
| Static pages / files / bytes | 1,740 / 8,715 / 139,863,733 | unchanged (no UI change) |
| Git | pack 21.14 MiB; about 171 KB per daily data commit | unchanged until the fields are published (+28 KB brotli per commit, +about 10 MB per year of commits at that rate; INFERENCE) |
| GitHub requests per day | 1,125 | expected 1,196 to 1,458; worst case 1,725 |
| Workflow runtime | 2.0 to 11.4 min over eight scheduled runs | worst case comparable to the 8.7-minute run that collected 1,795 requests |
No database, cache or service was introduced.

## 8. Why nothing is published yet
Publishing the fields needs (1) a change to the strict public gate (it currently rejects unknown keys, by design), (2) wiring the taxonomy and adapter into the momentum/publish step, (3) a decision about explanation strings in the public data, and (4) a byte-identical AI regression in CI. Each is a production change outside the "prove the data and intelligence first" boundary and needs review. Until then the layer is exercised by the experiments, the regression artefact and 49 tests.

## 9. Tests, build, security (FACT)
Full suite: see the final run in the report. Typecheck clean. Production build: 1,740 pages; the byte count differs from earlier builds only because the daily data changed. Greps over `out/` and `data/public/` (token patterns, internal dataset names, local paths, `_synthetic`, `localhost:3000`): 0. New files contain no token-shaped strings or credential names. Production paths (`data`, ranking config and sources, classification, tracking, lifecycle, pipeline, collect, `app`, `lib`, `components`, `.github`, `package.json`) have no diff against HEAD.
Two Phase 6.2.2 guard tests were adjusted, not weakened in intent: one now allows `scripts/discovery/admission-sim.ts` to import the 6.2.2 shadow helpers, the other lists the unchanged production ranking sources by name instead of the whole `src/momentum` directory (which now also holds the new `normalize.ts` and `rows.ts`). A new test pins the SHA-256 of the production ranking sources.

## 10. Rollback
Nothing production-facing changed, so nothing needs reverting. To remove Phase 6.3: delete the new files listed in section 4 and the `THIRD_PARTY.md` entry. If the layer is later wired in and must be disabled: set the ENGINEERING mode in `config/domains.json` to `absolute`, admission `mode` to `off`; both are configuration-only, and the previous dataset and atomic publication remain.

## 11. Limitations and remaining risks
1. Replay uses today's classification and star counts; durability metrics are proxies; no ground truth of rising repositories.
2. Taxonomy precision is unmeasured (recall only); 11.7% of independently labelled members are UNKNOWN to the v1 classifier; 13 of 46 technologies have fewer than 25 repositories.
3. Size-band bounds are frozen from one window.
4. The normalised set contains tools the v1 classifier labels Engineering that a reader may not call "engineering technology"; this is the existing classification.
5. The Top-300 pool and budget for 66 topics are extrapolations from 14 topics; high admission thresholds rest on small samples.
6. The pre-declared selection rule's winner was not chosen (documented); one metric was added after the first run (disclosed).
7. Phase 6.2.1's three documents (`VALIDATION`, `DISCOVERY-AUDIT`, `SCALE-AUDIT`) are still unwritten.

## 12. Phase 7 readiness: **PHASE 7 NOT READY**
The intelligence is validated offline, but an Engineering Radar needs it **in the published data**. Before Phase 7 (UI): (a) wire the taxonomy and the domain adapter into the momentum/publish step behind the gate, with AI byte-identical in CI; (b) run the Top-300 admission in shadow in production for at least one weekly cycle and measure the real 66-topic pool; (c) measure taxonomy **precision** with a human gold set (≥ 200 Engineering repositories) rather than recall only; (d) decide how Cooling and New-entrant lists behave for large steady and tiny repositories (Engineering lists were not changed here). None of these is large, but they are not done, so the honest answer is not ready.
