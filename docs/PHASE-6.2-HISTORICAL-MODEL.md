# PHASE 6.2 HISTORICAL MODEL

Date 2026-10-08. Evidence labels: **FACT** (measured on the pipeline state of 2026-10-07 and the published datasets) · **INFERENCE** · **RECOMMENDATION**. Code: [src/history/quality.ts](../src/history/quality.ts), [src/history/trajectory.ts](../src/history/trajectory.ts), [src/explain/historyEvidence.ts](../src/explain/historyEvidence.ts). Tests: [tests/phase62.test.tsx](../tests/phase62.test.tsx).

## 1. What is stored (FACT)
| Item | Value |
|---|---|
| Location | `data/repositories.json` in the pipeline state (release asset `data-state`), one record per repository |
| Identifier | GitHub repository id as a string (`id`), stable across renames |
| Structure | `starHistory { source: "github-star-history", fetchedAt, complete, firstDate, dailyGains[] }` |
| Date format | `firstDate` is `YYYY-MM-DD`; `dailyGains[i]` belongs to the date `firstDate + i`. No per-day dates are stored |
| Timezone | UTC days (the endpoint's weekly buckets are expanded to days) |
| Granularity | daily; the last value is the current UTC day, a **partial** day |
| Length | at most 210 days: the collector fetches one page of 30 weeks. 2,528 of 3,958 records (64%) sit at the cap (206 to 210 days) |
| `complete` | true when the series reaches the repository's creation (955 records) |
| Earliest / latest start | `firstDate` from 2026-03-01 to 2026-10-04 |
| Latest value | 2026-09-25 to 2026-10-07; records are refreshed on different days (see section 5) |

**Missing dates and duplicates cannot exist in this format:** the array is contiguous from `firstDate`, one value per index. Tests assert the consequences (an array shorter than a repository's age is "insufficient", never padded). **Invalid values:** 0 negative, 0 non-integer, 0 unreadable `firstDate` among 3,958 records.

## 2. Measured coverage
| Records with at least | 1 d | 7 d | 30 d | 60 d | 90 d | 180 d | 210 d |
|---|---:|---:|---:|---:|---:|---:|---:|
| All state records (3,958) | 100% | 99.9% | 92.6% | 85.1% | 83.7% | 78.3% | 20.8% |
| Published (3,471) | 100% | 100% | 92.2% | 87.2% | 85.8% | 80.2% | 18.9% |
| AI scope (1,735) | 100% | 99.9% | 86.5% | 78.9% | 76.4% | 66.6% | 15.8% |

Length percentiles (days), p10 / p25 / p50 / p75 / p90 / max: all 31 / 205 / 206 / 207 / 210 / 210 (minimum 3); published 31 / 205 / 206 / 206 / 210 / 210; AI scope 23 / 105 / 206 / 206 / 210 / 210. Gap, duplicate and invalid percentage: 0% each. **Zero-gain days are 43.0% of all stored days among published records (30.8% in the AI scope)** and 8 published series are entirely zero: most repositories are quiet on most days, so zeros are data and are never treated as missing. Short series belong to young repositories: the AI scope has more of them (24% are younger than 90 days).

## 3. History quality model (independent of momentum)
A repository can be RISING with LIMITED history; the two are separate fields and the quality function does not receive a trend or a score (a test asserts its signature).

| State | Definition (thresholds are the production windows, not tuned) | Published records today |
|---|---|---:|
| `INVALID` | a value is negative, fractional or non-finite, or `firstDate` is unreadable | 0 |
| `GAPPED` | the series ends more than 1 day before the evaluation date | 0 |
| `FULL` | the series reaches the repository's creation (every day of its life is known) | 776 |
| `LONG` | at least 180 days (covers the 90-day window plus 90 days of back-testing) | 2,695 |
| `ADEQUATE` | at least 90 days (covers 7, 30 and 90) | 0 |
| `LIMITED` | at least 30 days (the 90-day window is missing) | 0 |
| `INSUFFICIENT` | fewer than 30 days on a repository older than its series, or empty | 0 |

**Evidence for the terminology:** with the current collector only FULL and LONG occur. Any series shorter than 210 days belongs to a repository younger than that, so it covers its whole life (FULL); every other series is at the cap (LONG). ADEQUATE, LIMITED, INSUFFICIENT and GAPPED are kept because they are exactly what a collector failure, a lowered page limit or a stalled refresh would produce, and the boundaries are tested at 29/30, 89/90 and 179/180 days and at a one-day and two-day trailing gap. Quality is judged against the record's own collection date: a WARM repository refreshed three days ago is fresh, not gapped (freshness is the lifecycle's job, see PHASE-6.1-OPERATIONS.md).

## 4. Trajectory metrics: which exist, which ship
Week 0 is the last 7 days (today included), week k the 7 days before it. Every metric is `null`, never 0, when the series is too short. Units: stars, stars per day, ratios, days or weeks.

| Metric | Formula | Edge cases | Decision |
|---|---|---|---|
| Velocity 7 / 30 / 90 d | sum of the last n days / n | `null` when fewer than n days | In production (the engine), reproduced here for evaluation only |
| Previous 7 d / 30 d velocity | the same sum over the n days before the window | `null` when absent | Evaluation only (production has its own prior-28-day velocity) |
| Weekly sums (up to 12) | consecutive complete 7-day blocks | the remaining 6 days of a 90-day series are not a week | Internal building block |
| Peak day / peak week | maximum single day / maximum weekly sum | `null` on empty | Peak day is already on the chart; peak week analysis only |
| Median prior week | median of weeks 1 to 12 | `null` with fewer than 4 prior weeks | Building block |
| Current-to-median ratio | week 0 / median prior week | `null` when the median is null or 0 | **Ships** in the Why panel: "the last 7 days (+X) are R times the median week of the N before" |
| Positive / zero days; longest positive streak | counts over the last 90 days | | Analysis only (no clear product value; zero days are common) |
| Consecutive positive weeks | weeks counted back from week 0 with a sum above 0 | `capped` when it reaches the oldest week | **Ships**: "stars were gained in each of the last N weeks" (shown from 4 weeks) |
| Quiet weeks before | weeks before week 0 whose sum is at most a third of week 0 | `capped` flag; `null` when week 0 is 0 | **Ships**: "preceded by N weeks at one third or less of the last week's gains" (from 2 weeks); this is the evidence behind a breakout after a quiet period |
| Acceleration days | days for which the 7-day pace has been at least 1.2 times the previous 28 days (prior average at least 1 star per day) | `null` when it does not hold today | **Ships** (from 2 days): "has been at least 1.2x ... for N consecutive days" |
| Weekly coefficient of variation | std / mean of up to 12 weekly sums | `null` with fewer than 4 weeks or mean 0 | Evaluated, **not shipped**: hard to read and no decision depends on it |
| Percentile of current velocity | rank within a cohort | needs a population baseline | **Not implemented**: it is a cohort statistic and belongs to the domain baselines of Phase 6.3 |

The constants reuse existing production numbers: 1.2 (the engine's and the pattern model's "accelerating" cut), 3 (the engine's acceleration cap and the BREAKOUT ratio) and 1 star per day (the engine's `minPriorVelocity`).

## 5. Refresh coverage, a finding that affects history
Records are collected on different days (HOT 24 h, WARM 72 h, DORMANT 168 h), so on any date only some records have a value. In the 2026-10-07 state the published records end on 2026-10-03 (825), 2026-10-05 (694), 2026-10-06 (1,842) and 2026-10-07 (110). The 110 is not the daily HOT set: see PHASE-6.2-VALIDATION.md for the due-selection defect this exposed and its fix. Consequence for analysis: a historical evaluation date is only meaningful for the records whose series covers it; the back-tester returns "not covered" instead of guessing.

## 6. Limits
Star history reflects the stars a repository holds today (users who un-starred disappear from the past). Only about 210 days exist, so 90-day back-tests are possible for the last 120 days and 180-day trajectories are impossible. The current day is partial. Classification, discovery membership and tracking tier at a past date are not stored and are not reconstructed.
