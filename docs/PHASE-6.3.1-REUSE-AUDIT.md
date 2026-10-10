# PHASE 6.3.1 REUSE AUDIT

Date 2026-10-10. Rule: REUSE > ADAPT > COMPOSE > BUILD. Repository facts (license, stars, last push, archived) were read from the GitHub REST API on 2026-10-10. Nothing here copies third-party code and no dependency was added to `package.json`. Decisions: **REUSE** · **ADAPT** · **COMPOSE** · **REFERENCE** · **REJECT**.

## 1. What the repository already provides (checked first)
| Need | Existing capability reused unchanged |
|---|---|
| Scheduled job, secrets, state between runs | `radar.yml` pattern: `schedule`, `RADAR_GITHUB_TOKEN`, a release asset for state (`data-state`), `actions/cache`, `actions/upload-artifact@v7` |
| GitHub clients, rate-limit handling | `GitHubHttpClient`, `RateGuard`, `RestSearchProvider`, `RestStarHistoryProvider` |
| Tracking tiers and due grace | `decideTracking`, `selectDue`, `metricsFor`, `config/tracking.json` |
| Classification and taxonomy detection | v1 classifier, `taxonomyOf` (Phase 6.3) |
| Admission policy and budget arithmetic | `src/discovery/admission.ts` (Phase 6.3) |
| Weighted estimates and intervals | `weightedRate`, Wilson interval (`src/discovery/shadow.ts`, `src/taxonomy/evaluation.ts`) |
| Regression assertions | Vitest (already the test runner); byte comparison with `JSON.stringify` |
| Public gate | `publicSchemaProblems`, `secretShapeProblems` |

## 2. External audit
| Capability | Project | URL | License | Activity | Decision | Reason |
|---|---|---|---|---|---|---|
| Human annotation tool | Label Studio | https://github.com/HumanSignal/label-studio | Apache-2.0 | 28,430 stars, pushed 2026-10-09 | **REFERENCE** | The standard open annotation platform. A server (Docker/Python) for a 200-row, one-labeller task is more infrastructure than the task needs; reconsider when several labellers need adjudication. Its JSON export shape was used as a model for the label schema |
| Annotation tool | doccano | https://github.com/doccano/doccano | MIT | 10,792, pushed 2026-04-14 | **REFERENCE** | Text-focused, less active, same infrastructure cost |
| Annotation + feedback | Argilla | https://github.com/argilla-io/argilla | Apache-2.0 | 5,142, pushed 2026-10-06 | **REFERENCE** | Built for LLM feedback loops; heavier than needed |
| Label-error detection | cleanlab | https://github.com/cleanlab/cleanlab | Apache-2.0 | 11,692, pushed 2026-01-13 | **REFERENCE** | Finds suspect labels in large ML datasets; irrelevant at n = 200 with a rule-based system |
| Classification metrics, kappa | scikit-learn | https://github.com/scikit-learn/scikit-learn | BSD-3-Clause | 67,511, pushed 2026-10-09 | **REFERENCE** | Definitions of precision, recall and Cohen's kappa. Python; the project is TypeScript with no runtime dependencies. The 15-line implementations are tested against known values |
| Confidence intervals | statsmodels | https://github.com/statsmodels/statsmodels | BSD-3-Clause | 11,681, pushed 2026-10-08 | **REFERENCE** | `proportion_confint(method="wilson")` is the definition; the TypeScript Wilson interval is checked against its known value (5 of 10 gives a lower bound of 0.2366) |
| Spreadsheet labelling | CSV opened in any spreadsheet | n/a | n/a | n/a | **BUILD (parser only, about 40 lines)** | Humans label in a spreadsheet; quoting rules need a real parser. No dependency for 40 lines |
| Taxonomy scoring (multi-label, weighted, per-technology verdicts) | none found | n/a | n/a | n/a | **BUILD** | The schema (areas and technologies as sets, UNCERTAIN excluded, stratum weights) is specific to this taxonomy; the closest tools score flat single-label classifiers |
| Experiment/ML monitoring reports | Evidently | https://github.com/evidentlyai/evidently | Apache-2.0 | 7,979, pushed 2026-09-29 | **REJECT** | Python dashboards for ML drift; not a fit |
| LLM evaluation | deepeval | https://github.com/confident-ai/deepeval | Apache-2.0 | 18,725, pushed 2026-10-10 | **REJECT** | LLM-as-judge: the ranking and labelling here are deterministic and human |
| CI regression comparison | Vitest | https://github.com/vitest-dev/vitest | MIT | 17,195, pushed 2026-10-09 | **REUSE** | Already the runner; the permanent AI byte-identical assertion is an ordinary test |
| Scheduled shadow job | GitHub Actions `schedule`, `workflow_dispatch`, `concurrency` | https://docs.github.com/actions | platform | n/a | **REUSE** | Same mechanism as `radar.yml` |
| Evidence retention | actions/upload-artifact | https://github.com/actions/upload-artifact | MIT | 4,218, pushed 2026-10-07 | **REUSE** | Already used (v7) by `radar.yml` |
| Workflow linting | actionlint | https://github.com/rhysd/actionlint | MIT | 4,310, pushed 2026-07-16 | **REUSE (as a one-off check, not a dependency)** | The new workflow cannot be run before it is merged; actionlint v1.7.12 was downloaded and run on `shadow.yml` and `radar.yml`: both clean |
| Sampling design | stratified sampling with Horvitz-Thompson weights | standard statistics | n/a | n/a | **COMPOSE** | Reuses `seededSample` and `weightedRate` from Phase 6.2.2 |

## 3. Decisions
1. **No new dependency.** Every metric (precision, recall, Wilson, kappa, weighted estimates) is a short pure function with tests on known values; the audited libraries are Python or are services.
2. **Labelling workflow: CSV plus a scorer, not an annotation server.** The blind sheet is a spreadsheet; the scorer validates labels against the taxonomy slugs before scoring. Label Studio is the documented upgrade path when several labellers are involved.
3. **Shadow infrastructure: reuse the production workflow pattern.** A separate workflow, inert unless a repository variable is set, with its own release for state; it never commits.
4. **Nothing licensed under GPL, AGPL or an unknown license is used.** Rejected rows are rejected for fit, not for license.
