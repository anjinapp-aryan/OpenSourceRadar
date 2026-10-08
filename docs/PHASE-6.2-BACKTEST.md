# PHASE 6.2 BACKTEST

Date 2026-10-08. Code: [src/backtest/index.ts](../src/backtest/index.ts), [scripts/backtest/run.ts](../scripts/backtest/run.ts); result: `results/phase6.2/backtest.json`; tests: [tests/phase62.test.tsx](../tests/phase62.test.tsx). Reproduce: `npx tsx scripts/backtest/run.ts <state data dir> data/public/radar.json --days 91` (about 3 minutes). Evidence labels: **FACT** (measured) · **INFERENCE** · **LIMITATION**. The back-tester **only reads** state and applies the **current production rules**; no ranking rule, threshold or classifier was changed.

## 1. What it does
"If today's production rules had evaluated this repository at the end of UTC date T, what would they have said?" For T = now, T-7, T-30, T-60, T-90 or any day in between, `evaluateAt(record, T)`:
- keeps daily gains **on dates up to and including T only** (everything later is dropped before any calculation);
- derives stars at T as stars now minus the gains after T (the storage format's own definition of past star counts);
- keeps `pushedAt` only if it is on or before T (a later push hides the earlier one, so it becomes unknown, not borrowed);
- sets the evaluation instant to the end of T, and "now" to the same instant (data is fresh at T);
- calls the **unchanged** production engine (`evaluateRepository`) and the Phase 6.1 pattern model (`classifyPattern`), so score, trend (Rising, Cooling, Steady), pattern, sustained flag and new-entrant flag come from the real code.
It returns "not covered" (null), never a guess, when T is later than the series, earlier than its first day, or before the repository existed.

## 2. Validation against production (FACT)
On the pipeline state of 2026-10-07: evaluating each published repository with the same instants production used reproduces the published score, trend, pattern and 7/30/90-day growth for **3,471 of 3,471 records, 0 mismatches**. The newest-day Rising set equals the production Rising list: 37 of 37 in both, none only in one (a further 10 repositories are Rising by the rules but withheld from the public data: `awesome-selfhosted`, `browser-use`, `hello-agents`, `claude-skills`, `hyperframes`, `ai-engineering-from-scratch`, `book-to-skill`, `open-seo-mcp-skills`, `agent-memory`, `short-video-generator-AI`).

## 3. Future-leakage validation (FACT)
"Never use future data to explain the past." Three independent checks:
1. **Property tests** (`tests/phase62.test.tsx`): for evaluation dates 0, 1, 7, 14, 30, 60 and 90 days back, replacing everything after T with zeros, with 5,000 per day, or with an arbitrary sequence (while keeping the present-day star count consistent, because stars at T derive from it) never changes the snapshot at T.
2. **The worked example from the task:** a series from 2026-01-01 to 2026-04-01 evaluated on 2026-03-01 contains exactly 60 days ending 2026-03-01, no value from 2026-03-02 on, and a series that is enormous after March 1 gives a snapshot identical to one that is zero after March 1.
3. **Real data audit:** 2,939 random (repository, date) pairs from the state, each re-evaluated after replacing every later day with random values: **0 differences**. Also tested: a later push does not leak into T, the evaluation date itself is included and the day after is not, uncovered dates return null.
**LIMITATIONS that are not leakage but affect fidelity:** star history reflects the stars a repository still holds today, so a star later removed is missing from the past; `isArchived` and the `complete` flag are today's values (one archived record exists); classification, discovery membership, tracking tier and the freshness limit at T are not reconstructed (the freshness test is always satisfied at T).

## 4. Coverage is not behaviour (a defect found and fixed in the back-tester)
Records are refreshed on different days, so the newest dates are covered for fewer records (2026-10-03: 3,655 records, 10-04: 2,656, 10-05: 2,647, 10-06: 1,953, 10-07: 110). The first version of the analysis treated "not covered" as "not Rising", which closed every open episode and reported an empty Rising list on the newest day. Fixed: trailing uncovered days neither start nor end an episode (an episode open on the record's last covered day is `ongoing`), churn compares only records covered on **both** days, and a date is used for churn only if at least half of the published records are covered on it (2026-10-07 is excluded). Tests: 4 cases on episodes with leading and trailing nulls.

## 5. Rising persistence and churn (FACT: last 91 days, all 3,958 records, current rules)
**Set size and churn** (89 usable day-to-day comparisons): the Rising set has between **37 and 81** members (64 on 2026-07-10, 37 on 2026-10-06). Per day on average **3.7 enter and 3.9 leave**; the mean day-to-day Jaccard overlap is **0.883**, so about 12% of the list changes each day.

**Episodes** (consecutive Rising days per repository): 397 episodes for 241 repositories (202 still published). 291 are **closed** (start and end inside the window), 47 are ongoing and 64 start on the first evaluated day (left-censored: their true length is longer).

| Duration of closed episodes | Count | Share |
|---|---:|---:|
| 1 to 6 days | 104 | 35.7% |
| 7 to 14 days | 114 | 39.2% |
| 15 to 30 days | 57 | 19.6% |
| 31 to 60 days | 15 | 5.2% |
| 61 days or more | 1 | 0.3% |
Mean 10.9 days, **median 8**, 90th percentile 23. 55 episodes lasted 3 days or fewer and 135 lasted a week or less. Ongoing episodes so far: 20 are 1 to 6 days, 13 are 7 to 14, 3 are 15 to 30, 2 are 31 to 60 and 9 are 61 or more (lower bounds).

**Repeat entries:** 88 repositories were Rising in two or more separate episodes and 38 in three or more.
**After Rising:** of 229 closed episodes with a full 14-day horizon, **66 (29%)** were Cooling on the very next day, 163 Steady, and **153 (67%)** showed at least one Cooling day within 14 days. None was Rising the next day (by definition).
**By entry pattern (closed episodes):** sustained-growth entries lasted a median 8 days (48.5% ended within 7 days), accelerating 8 (48.8%), spike 9 (32.8%), new launch 7 (58.7%), breakout 16 (16.7%, only 6 episodes).

**The current Rising list (37 published, 2026-10-07):** current Rising streak median 7 days (quartiles 6 and 16, maximum 90); 19 have been Rising 7 days or less, 8 for 8 to 14, 3 for 15 to 30 and 7 for more than 30 days. 17 were Rising on at least 20 of the last 30 days; 20 are in their first episode and 17 are repeat entrants. By pattern: sustained 16, new launch 9, accelerating 8, spike 4.

**Reading (INFERENCE, no causality claimed):** the Rising label is short-lived for most repositories: a typical episode is a week or two, about 3 in 4 closed episodes end within two weeks and two thirds are followed by a Cooling day. A small core stays Rising for a month or more. Spike entries do not end sooner than the others (median 9 days), so a spike-driven entry is not by itself a sign of a short stay. The product copy should keep describing Rising as "strong recent growth", not as a durable status.

## 6. Anomaly (pattern) evaluation (FACT, all records, 311,089 repository-days)
| Pattern | Share of repository-days | Persistence of a run (median / 90th pct, days) | Share of Rising-days |
|---|---:|---|---:|
| NORMAL_GROWTH | 70.1% | 11 / 89 | 0 |
| FLAT | 14.9% | 5 / 24 | 0 |
| NEW_LAUNCH | 5.1% | 25 / 30 (ends by definition at 30 days) | 8.0% |
| COOLING | 3.3% | 5 / 22 | 0 |
| SUSTAINED_GROWTH | 3.3% | 6 / 30 | 51.1% |
| ACCELERATING | 2.3% | 4 / 9 | 25.1% |
| SPIKE | 0.94% | 6 / 9 | 13.6% |
| BREAKOUT | 0.12% | **1 / 3** | 2.1% |
| INSUFFICIENT_HISTORY | one repository-day | | |

**What follows a pattern (14 days after its first day; 30 for new launches):**
- **BREAKOUT** (220 starts): 44% Cooling, 30% Normal growth, 11% Rising. A median run length of **one day** (258 runs) says BREAKOUT is a transient, boundary-sensitive label: a repository crosses the 3x ratio and falls back the next day.
- **SPIKE** (418 starts): 32% Cooling, 13% Rising, 2% still a spike. A spike label lasts about 6 days.
- **ACCELERATING** (1,309 starts): 26% Cooling, 11% Rising.
- **NEW_LAUNCH** (274 starts, 30 days): 49% Normal growth, 32% not covered 30 days later (the series ends before the horizon), 5% Rising.
**Most frequent transitions (excluding staying put):** FLAT and NORMAL_GROWTH exchange about 4,000 times each way (repositories around zero weekly growth), then ACCELERATING and NORMAL_GROWTH, SPIKE to ACCELERATING (211), SPIKE to BREAKOUT (132), ACCELERATING to SPIKE (126). **Flicker among SPIKE, BREAKOUT and ACCELERATING is common**, as expected for labels built from ratios near their cuts.

**False-positive candidates (observations, not changes):** one-day BREAKOUT runs (a ratio crossing 3 for a day); ACCELERATING runs of one or two days. **False-negative candidates:** none can be measured without labelled data; the 100-star weekly floor (Phase 6.1) means small repositories never carry a ratio pattern by design. **Recommendation (not applied):** if the pattern is shown more prominently, require it to hold for 2 consecutive days or add hysteresis; thresholds are untouched pending that decision.

## 7. Boundary behaviour and limits
Tested: evaluation date equal to the last stored day, the day after it, before the first day, before creation, empty series, a young repository, record without a push date, spike-then-quiet futures. History is at most 210 days, so a 91-day back-test with 90-day windows is possible; a 180-day back-test is not. The grid ends at the newest date covered for at least half of the published records. Only AI-scope records have a public trajectory, but the back-test covers all 3,958 records.
