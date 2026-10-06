# PHASE 6.1 GROWTH-PATTERN AND EXPLANATION MODEL

Implementation: [src/explain/pattern.ts](../src/explain/pattern.ts), [src/explain/render.ts](../src/explain/render.ts) · configuration: [config/pattern.json](../config/pattern.json) (`patternVersion p1`) · tests: [tests/phase61.test.tsx](../tests/phase61.test.tsx) · backtest tool: `npx tsx scripts/pipeline/patterns.ts [public.json] [--list N]`.

Legend: **CONFIGURED** (a value in `config/pattern.json`) · **MEASURED** · **ASSUMED** (a design choice, justified below, not fitted) · **UNKNOWN**.

## 1. Principles
- **Neutral.** Patterns describe the shape of growth. No label or sentence says or implies that stars were bought or that a repository is fake, and a test checks the vocabulary. Unusual is not invalid.
- **Three separate things:** *pattern* (shape), *evidence* (the measured numbers), *status* (RISING / COOLING / STEADY, produced by the unchanged momentum engine and only read here).
- **Domain independent.** Inputs are growth windows, acceleration, age and the sustained flag. No category, classification or tier is read.
- **Reproducible from the public record.** The pattern is stored in `radar.json`, and can be recomputed from the same record's own public fields by the same function. The quality gate recomputes it for every record and fails the publish if any stored pattern differs.
- **The ranking is unchanged.** Momentum v1, Rising/Cooling thresholds and the sustained rule were not modified.

## 2. Patterns (evaluated in this order; the order is part of the definition)
| Order | Pattern | Rule |
|---|---|---|
| 1 | `INSUFFICIENT_HISTORY` | 7-day growth unmeasurable, or 30-day growth unmeasurable for a repository at least 30 days old |
| 2 | `NEW_LAUNCH` | 30-day growth unmeasurable because the repository is younger than 30 days (`newLaunch.maxAgeDays`) |
| 3 | `FLAT` | 7-day growth is 0 (or, defensively, negative) |
| 4 | `SPIKE` | at least 50% of the last 30 days' growth arrived in the last 7 days (`spike.minShare30`) **and** 7-day growth is at least 100 (`spike.minGrowth7d`) |
| 5 | `COOLING` | the engine's own status is COOLING (last week at or below 0.6x the previous 28 days) |
| 6 | `BREAKOUT` | acceleration ratio at least 3x (`breakout.minRatio`, equal to the score's acceleration cap) **and** 7-day growth at least 100 |
| 7 | `ACCELERATING` | acceleration ratio at least 1.2x (`accelerating.minRatio`, the same cut the engine already uses to say "accelerating") **and** 7-day growth at least 100 |
| 8 | `SUSTAINED_GROWTH` | the engine's `sustained` flag (every fully observed window at least 30 stars per day, including the 30-day one) |
| 9 | `NORMAL_GROWTH` | everything else with positive growth |

Differences from the vocabulary suggested in the phase brief, and why: `LAUNCH_SPIKE` became `SPIKE` (concentration also happens in old repositories, for example a 1,174-day-old project), `NEW_LAUNCH` was added (384 published records are younger than 30 days and have no 30-day window by design), `FLAT` was added (543 records have exactly zero weekly growth), `COOLING_AFTER_SPIKE` became `COOLING` (the engine's cooling status does not require a prior spike; when the previous 28 days ran at 2x or more of the 90-day average, the evidence line says so). Missing days cannot occur in the stored series (see PHASE-6.1-HISTORY.md), so no pattern is defined for them; a missing window is `INSUFFICIENT_HISTORY`.

## 3. Where the thresholds come from (ASSUMED, backtested, not tuned for a result)
- The ratio cuts 1.2 and 3 reuse numbers already in the engine (its prose and its acceleration cap). No new ratio was invented.
- `spike.minShare30 = 0.5` is "most of the month in one week". An even pace would be 7/30 = 0.23; among AI repositories with at least 100 stars gained in 30 days (630 of them) the share was p10 0.06, p50 0.16, p90 0.28. 0.5 is far above the 90th percentile.
- The **100-star weekly floor** was added after the manual review in section 5: the first backtest labelled `jestjs/jest` (45k stars, 4,682 days old, +48 in 7 days) and `dotnet/orleans` (+25) as **BREAKOUT**, because a ratio of 3x of almost nothing is still almost nothing. With the floor, BREAKOUT fell from 9 to 1 and ACCELERATING from 139 to 42. This is a correction of an observed mislabel, applied equally to SPIKE, BREAKOUT and ACCELERATING, and it matches the 100-star weekly figure already used by tracking for HOT. It is a judgement; it is configurable.
- Nothing was tuned to make the Rising list look a particular way.

## 4. Evidence and explanation
`evidenceOf(record)` returns the numbers behind a pattern: growth over 7/30/90 days, velocities, previous-period velocity, acceleration ratio, `spikeShare30` (share of 30-day growth in the last 7 days), `lifetimeShare7d` (share of all stars gained in the last 7 days), age and the sustained flag. Each is copied from the record or derived from two copied values.

`renderWhy(record, pattern, cfg)` turns that into fixed-order lines, for example for a Breakout fixture:
```
+716 stars in 7 days (102/day)
+1,920 stars in 30 days (64.0/day)
+5,900 stars in 90 days
102/day over the last 7 days against 33.0/day over the previous 28 days (3.1×, accelerating)
sustained: growth stayed above the sustained threshold in every fully observed window
context: 5,000 lifetime stars (not used in the score)
```
Unmeasurable windows say "not available" with the reason ("repository is 9 days old"). Patterns whose persistence is not established carry a neutral note ("Growth is concentrated in the most recent week; persistence is not yet established."). Tests assert exact numbers, determinism and ordering, that every number in the lines comes from the record (property test over 180 combinations), and that no line contradicts another (for example "accelerating" and "slowing" together).

An honest side effect: `vectorize-io/hindsight` is RISING with pattern *Sustained climb*, and the evidence line reads "455/day against 754/day ... (0.6×, slowing)". Rising requires only that the last week is at least 0.6x the previous four, so the page states both facts.

## 5. Rising eligibility (analysis; no change made)
Backtest on the 3,471 published records of 2026-10-06 (final thresholds):

| Pattern | All records | AI scope (1,735) | Rising (37) |
|---|---:|---:|---:|
| NORMAL_GROWTH | 2,229 | 1,037 | 0 |
| FLAT | 543 | 128 | 0 |
| NEW_LAUNCH | 384 | 310 | 9 |
| COOLING | 194 | 162 | 0 |
| ACCELERATING | 42 | 32 | 8 |
| SUSTAINED_GROWTH | 59 | 51 | 16 |
| SPIKE | 19 | 14 | 4 |
| BREAKOUT | 1 | 1 | 0 |
| INSUFFICIENT_HISTORY | 0 | 0 | 0 |

Options weighed: (A) remove spikes from Rising, (B) downgrade, (C) keep Rising and flag, (D) a separate Breakouts section. **Decision: C.** Filtering SPIKE would remove 4 of 37 Rising repositories (11%); also filtering NEW_LAUNCH would remove 13 (35%), and the NEW_LAUNCH group includes repositories with thousands of stars in a week, which is exactly what a radar should surface. The four spikes are `morluto/rea` (94% of all its stars in 7 days), `mvschwarz/openrig` (52%), `FalkorDB/FalkorDB` (73% of the month's growth, a 3-year-old project) and `thedotmack/claude-mem` (51%): unusual, but nothing in the data shows them invalid. They stay Rising and are labelled "Concentrated spike" with the numbers and the persistence note. A separate Breakouts section is deferred to a later phase because only one repository currently qualifies as BREAKOUT.

## 6. Manual review (single reviewer, 2026-10-06, directional)
Rising in AI scope (35): 4 spikes, 9 new launches, 7 accelerating, 15 sustained. The top 20 by score are mostly agent and coding-agent tooling. Archived: none of the published records (one archived record exists in pipeline state; the engine leaves it unscored, so it is never published). 10 oldest high-star repositories (scikit-learn, netron, xgboost, spaCy, tesseract, learnopencv, keras, tidb, tensorflow, TheAlgorithms/C-Plus-Plus): NORMAL_GROWTH except tensorflow (COOLING, +153 in 7 days); **classification mistakes seen:** `TheAlgorithms/C-Plus-Plus` and `spmallick/learnopencv` sit in `machine-learning` although they are teaching collections, `pingcap/tidb` carries `ai-agents`. 10 youngest: all NEW_LAUNCH; two are list-style (`xop01/ai_goodpractice` a guide, `VoltAgent/official-mcp-servers` a curated directory). Educational/list-style names or descriptions: 104 of 1,735 AI-scope records (heuristic), 1 of 35 Rising (`ComposioHQ/awesome-claude-skills`). Implausible growth: only the spike cases above. Forks: **UNKNOWN**, the candidate record does not store the fork flag. Stale records: 0 (see PHASE-6.1-VALIDATION.md). Orphans and UNKNOWN: reviewed in the validation report.

## 7. Known limitations
Pattern labels use growth windows only, not forks, issues or daily concentration (a single-day burst inside a week is visible on the trajectory but not in the label). The 100-star floor means small repositories always read as steady or normal. Thresholds are not calibrated against labelled data. Engineering repositories will mostly read as NORMAL_GROWTH or FLAT until per-domain thresholds exist (a later phase, deliberately not done here).
