# PHASE 6.3.2 VALIDATION

Date 2026-10-10. Verdict: **PARTIAL. PHASE 7 NOT READY.** Detail: [REUSE-AUDIT](PHASE-6.3.2-REUSE-AUDIT.md) · [LIFECYCLE-LEAKAGE](PHASE-6.3.2-LIFECYCLE-LEAKAGE.md) · [HUMAN-TAXONOMY](PHASE-6.3.2-HUMAN-TAXONOMY.md) · [TECHNOLOGY-SEMANTICS](PHASE-6.3.2-TECHNOLOGY-SEMANTICS.md) · [SHADOW](PHASE-6.3.2-SHADOW.md). Evidence labels: **FACT · MEASURED · PROXY · INFERENCE · LIMITATION**. Nothing in this phase changes production: `radar.json`, `history.json`, AI ranking, classification, tracking, `radar.yml`, the UI and `package.json` are untouched, gateV2 is not enabled, and no Engineering data is published.

## Gate table
| Gate | Status |
|------|--------|
| Reuse audit | PASS |
| Star-driven leakage | PASS |
| Full lifecycle leakage | PARTIAL |
| Human taxonomy | PENDING |
| Technology semantics | PENDING |
| Shadow safety | PASS |
| 7-day shadow | PENDING |
| AI regression | PASS |
| Tests | PASS |
| Typecheck | PASS |
| Build | PASS |
| Security | PASS |
| Production unchanged | PASS |

## 1. Reuse audit (PASS)
Targeted addendum done (five searches, API-verified licenses). No dependency added; Cohen's kappa, precision, recall, F1 and Wilson intervals stay as TypeScript functions, cross-checked offline against scikit-learn, statsmodels and NLTK definitions (reference only). Rejected: disagree (no declared license), KappaGUI (GPL), Python static leakage analysers. Peek's truncation idea is adapted into the leakage audit.

## 2. Lifecycle leakage (star-driven PASS, full PARTIAL)
**MEASURED:** three future rewrites (zeros, seeded bursts, ×50) with 640 flag sets and 16,898 repo-date memberships compared up to the cut: **0 differences**; positive control 605 of 608 flag sets changed after the cut; 1,633 explanation texts compared: 0 differences, 2,037 of 2,045 changed after the cut. New to Radar: proof by append-only construction plus a bounded test on 14 real publication snapshots, 0 differences in 21 date comparisons, positive control 21 of 21, 2,735 future first-publications checked and none reported. **Defect found and fixed:** `newToRadar` returned a negative day count for a first publication after T, exposing the future; it now returns null. **Not closed:** the Engineering population uses today's classification on all dates; a point-in-time population is possible on 8 of 29 dates only and changes 4.8% of the comparable flag memberships (104 of 2,183); discovery cannot be tested (no first-seen dates): NOT TESTED — HISTORICAL INPUT UNAVAILABLE.

## 3. Human taxonomy validation (PENDING)
**0 real human labels.** Built: two clean packages (`results/phase6.3.2/labeler-packages/LABELER_A`, `LABELER_B`: a blind 237-row sheet and a guide that names no key, prediction, score or assistant file; a test asserts this), a two-rater scorer (`scripts/taxonomy/score-human.ts`) with Cohen's kappa, pooled kappa for multi-valued fields, disagreement rate, consensus and adjudication, system versus rater A, rater B and consensus, P/R/F1 for domain, area, technology and learning, UNKNOWN rate and coverage; independence guards (different names, no model names, files not identical, at least 200 valid rows each) that make the scorer refuse and exit non-zero otherwise. Methodology and thresholds were frozen in the HUMAN-TAXONOMY document before any label existed. Synthetic tests are marked `SYNTHETIC - NOT REAL EVIDENCE`, write nothing to `results/`, and a test asserts that no real score file exists. The assistant's 6.3.1 labels are not counted.

## 4. Technology semantics (PENDING)
Harness built: the same system tags are scored against both definitions ("primarily about" and "touches or uses"), per rater and consensus, with P/R/F1, false positives and negatives with repository ids, and per-technology verdicts. The decision rule (label reliability, accuracy, product fit via the touches-only share) was declared up front. No winner is declared. The classifier is unchanged.

## 5. Shadow (safety PASS; 7-day PENDING)
LOCAL VALIDATED yes · MERGED no · ENABLED no · EXECUTED no · OBSERVED no · 7-DAYS COMPLETE no. Audit findings and two hardening changes (step-scoped token, evidence secret scan) are in the SHADOW document. **A budget defect was found and fixed:** with no production record for the day the guard assumed an average production day and could have let production (peak 1,795) plus the shadow reach 2,670 requests; it now reserves the observed peak, giving the shadow at most 205 (56 on a Monday), and subtracts its own search requests. Property-tested: production + shadow budget is at most 2,000 for every production load up to 1,795. Daily evidence fields for the seven days (tiers, REST/GraphQL, retries, start relative to production, budget basis) were added and tested with synthetic records. **Nothing about seven days has been observed.**

## 6. API budget
Ceiling 2,000 (not raised). Average production 1,125, observed peak 1,795, shadow budget 205 to 875 depending on the day. **Actual scheduled usage: not measured** (LIMITATION). The guarantee holds while production stays at or below its observed peak; a higher peak is detected by the 90% STOP rule, not prevented.

## 7. AI regression (PASS)
Re-run on the 2026-10-09 state after all 6.3.2 work: 1,735 AI/BOTH records, **0 differences** in records, order, lists, history, score, trend and pattern; whole repository array and history identical; result identical to the 6.3.1 result; the pinned hashes of the production ranking sources are unchanged. Recorded in `results/phase6.3.2/ai-regression-final.json`; a test asserts it.

## 8. Tests, build, security
- **Tests:** 712 pass in 27 files (667 before; +45). Network-dependent tests: none; the leakage and historical-inputs audits are offline integration scripts, not unit tests.
- **Typecheck:** clean. **Build:** succeeds. **actionlint** v1.7.12: clean on `shadow.yml` and `radar.yml`.
- **Security scan** of source, scripts, tests, docs, config, workflows, public data and the 6.3.1 and 6.3.2 results (9,001 files, caches excluded): no GitHub token, PAT, bearer value or API key; the only token-shaped string is the fake `ghp_TEST…` fixture in `tests/helpers.ts` (pre-existing); `_synthetic` appears only in the gate that rejects it and in docs that describe it. `localhost:3000` appears in the local, git-ignored `out/` build because the site URL falls back to localhost when no site URL variable is set (`lib/site.ts`); `out/` is not tracked or deployed from here.
- **Fixed in passing:** several files edited by script had been rewritten with Windows line endings, which broke text tests; normalised to LF.

## 9. Production safety (PASS)
`git status` is empty for `data/`, ranking config and sources, classification, tracking, `src/collect`, `app/`, `lib/`, `components/`, `radar.yml`, `package.json`. The AI regression is zero. The changed shared file is `src/domain/contract.ts` (shadow data contract, not imported by production; unchanged in 6.3.2).

## 10. Limitations
No human labels; population hindsight for lifecycle validation; discovery untested; workflow never executed on GitHub; actual API use unmeasured; admission-quality review still assistant-made; `firstPublishedAt` is not in production state.

## 11. Phase 7 recommendation
**NOT READY.** Three gates need people or calendar time that this phase cannot supply: two independent labelers, a merged and enabled shadow with a token, and seven real days. Lifecycle leakage can be closed fully only by keeping daily classification and tracked-set snapshots from now on.

PHASE 7 NOT READY
