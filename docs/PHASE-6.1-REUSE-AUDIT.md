# PHASE 6.1 REUSE AUDIT

Date 2026-10-06. Licence, stars and last push were read from the GitHub API on that date. Decision keys: REUSE · ADAPT · COMPOSE · REFERENCE · REJECT. No code was copied from any project.

| Capability | Candidate | Licence | Stars | Last push | Decision | Reason |
|---|---|---|---|---|---|---|
| Sparkline / daily bars | **Existing frontend** (React + inline SVG) | n/a | n/a | n/a | **REUSE** | 90 bars are 90 rectangles; no runtime dependency added |
| Sparkline / charts | uPlot (leeoniya/uPlot) | MIT | 10.5k | 2026-10-05 | **REJECT for now** | About 50 KB of JS for a bar chart that needs none; revisit when interactive multi-series charts are needed |
| Sparkline / charts | Recharts (recharts/recharts) | MIT | 27.6k | 2026-10-06 | **REJECT for now** | Larger bundle, React component tree per chart; same reason |
| Anomaly detection | simple-statistics (simple-statistics/simple-statistics) | ISC | 3.5k | 2026-10-01 | **REJECT** | The model is five comparisons on numbers already computed (share of 30-day growth, acceleration ratio, age); statistical outlier methods would be less explainable and need tuning, which the phase forbids without backtesting. The deterministic rules are in `src/explain/pattern.ts` |
| Repository health signals | OpenSSF Scorecard (ossf/scorecard) | Apache-2.0 | 5.7k | 2026-10-06 | **REFERENCE** | Measures security practice, not growth shape; also out of scope for this phase (no external signals) |
| Historical snapshot storage | Existing pipeline state (`repositories.json` already holds up to 210 daily gains per repository) | n/a | n/a | n/a | **REUSE** | No new collection and no new store; the public file is a compact projection of it |
| Backup / version retention | GitHub Releases assets via the `gh` CLI (already used for state) | n/a | n/a | n/a | **REUSE** | Dated assets plus a pure pruning function; no new service. Actions artifacts rejected: 90-day maximum retention and not addressable by the restore step |
| Backup / version retention | Git LFS, object storage | n/a | n/a | n/a | **REJECT** | Added service or quota for a 3.6 MB archive |
| README conventions | standard-readme (RichardLitt/standard-readme) | MIT | 6.4k | 2026-09-29 | **REFERENCE** | Section ordering ideas only; the README follows the headings the phase required |

## Dependencies added
None, runtime or dev.

## Not verified
Alternatives such as npm sparkline packages and anomaly libraries were not surveyed beyond the two named above; the decision rests on the rules being trivially expressible and on the explainability requirement, not on a market survey.
