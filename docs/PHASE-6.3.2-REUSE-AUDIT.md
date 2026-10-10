# PHASE 6.3.2 REUSE AUDIT (targeted addendum to PHASE-6.3.1-REUSE-AUDIT)

Date 2026-10-10. Rule: REUSE > ADAPT > COMPOSE > BUILD. Repository facts (license, stars, last push, archived) read from the GitHub REST API or PyPI on 2026-10-10 (**FACT**). Search results themselves are web-search summaries and were not code-reviewed (**LIMITATION**). Nothing is copied and **no dependency is added**.

## 1. Cross-check with Phase 6.3.1
Unchanged decisions: Label Studio, doccano, Argilla, cleanlab, scikit-learn, statsmodels, Evidently, deepeval: REFERENCE or REJECT as before. fast-krippendorff: GPL-3.0, REJECT. sktime, darts, skforecast, pingcap/ossinsight: REFERENCE. Vitest, actionlint, upload-artifact, GitHub Actions: REUSE as before.

## 2. New candidates (five targeted searches)
| Need | Project | License | Activity | Decision | Reason |
|---|---|---|---|---|---|
| Blind annotation + agreement | disagree (PyPI 1.2.7) | none declared on PyPI | not checked | **REJECT** | No declared license; Python; we need two-rater kappa only |
| Agreement metrics | NLTK `nltk.metrics.agreement` (github.com/nltk/nltk) | Apache-2.0 | 14,735 stars, pushed 2026-10-07 | **REFERENCE** | Second independent definition of Cohen's kappa and Krippendorff alpha to cross-check the TypeScript functions; Python, not a dependency |
| Agreement UI | KappaGUI (R/Shiny, front end of R `irr`) | GPL | n/a | **REJECT** | GPL, R, GUI |
| Blind phase method | "Guidelines for the Creation of an Annotated Corpus" (arXiv 2601.13353) | n/a (paper) | n/a | **REFERENCE** | Confirms the design: at least two experts label a sample independently and blind; Cohen's kappa for two raters |
| Leakage detection by truncation | Peek (OnePunchMonk/peek) | MIT | 0 stars, 1 commit, pushed 2026-08-01 | **REFERENCE** | Its causality check (recompute on a truncated series, a changed value means the feature saw the future) is the idea the audit already uses, plus a stronger positive control (rewrite the future). Python, tiny project, not a dependency |
| Static look-ahead analysis | leakguard-mcp, tsauditor (PyPI, MIT 0.6.0) | MIT / n/a | young | **REJECT** | Python static analysers for pandas-style code; this code is TypeScript |
| Point-in-time joins | ere (PyPI, MIT 0.3.0) | MIT | young | **REFERENCE** | Same principle (as-of reads), Polars only |
| Backtest data guard | backtest-kit (tripolskypetr) | MIT | 70 stars, pushed 2026-10-09 | **REFERENCE** | Structural approach (the data layer refuses data past "now"); ours is `historicalRecord(r, T)` plus a black-box rewrite audit |
| Shadow evaluation | champion/challenger pattern (Dataiku, Pega, ModelOp docs); MLflow (Apache-2.0, pushed 2026-10-10), KServe (Apache-2.0), Seldon Core (licence NOASSERTION) | mixed | active | **REFERENCE** | Confirms the pattern: challenger runs on live data, outputs recorded, never served; promotion gated on metrics. They are serving platforms, not a fit for a static site with no servers. No open-source shadow pipeline for this problem was found |
| Discovery monitoring | GitHub Trending, OhNiceRepo, GitTrends, RepoRank, Apify repo monitor | mixed, not verified | n/a | **REFERENCE** | Confirms the problem (Trending favours old repositories with a one-day spike). None is a reusable deterministic pipeline; GitHub Trending has no public API; the Apify actor is hosted |

## 3. Decisions
1. **No new dependency.** Cohen's kappa, precision, recall, F1, Wilson intervals are short pure TypeScript functions with known-value tests. NLTK and scikit-learn/statsmodels are used only offline as a cross-check of the numbers, never at runtime.
2. **Leakage audit: ADAPT the truncation idea** (Peek) with a rewrite-the-future positive control, implemented in `scripts/lifecycle/leakage-audit.ts`.
3. **Labelling: CSV + scorer** (BUILD, about 40 lines for the parser) rather than an annotation server; Label Studio stays the documented upgrade path.
4. **Shadow: REUSE the production workflow pattern** (GitHub Actions `schedule`, release-asset state, `upload-artifact`); the champion/challenger pattern is the reference design.
5. Nothing GPL, AGPL or without a declared license is used.
