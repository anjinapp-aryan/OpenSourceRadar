# PHASE 6.3.2 LIFECYCLE LEAKAGE AUDIT (final)

Date 2026-10-10. Code: `scripts/lifecycle/leakage-audit.ts` (star-driven black-box audit incl. explanation text), `scripts/lifecycle/historical-inputs-audit.ts` (New to Radar, point-in-time population, classification drift), `scripts/lifecycle/replay.ts`. Results: `results/phase6.3.2/lifecycle-leakage-audit.json`, `results/phase6.3.2/historical-inputs-audit.json`. Input: the 2026-10-09 production state (1,736 Engineering repositories, 29 replay dates 2026-09-05 to 2026-10-03) and the git history of `data/public/radar.json`. Offline, deterministic. Evidence labels: **FACT · MEASURED · PROXY · INFERENCE · LIMITATION**.

**Overall verdict: PARTIAL.** Star-driven lifecycle flags, lifecycle explanation text and New to Radar show no leakage. The classification and publication population is hindsight on 21 of 29 dates and cannot be reconstructed there; discovery cannot be tested at all. Nothing is reported as a pass where it was not tested.

## 1. Final matrix
| Component | T-bounded? | Evidence | Status |
|---|---|---|---|
| Trending | yes for star inputs | 3 future rewrites, 0 differences in 640 flag sets / 16,898 repo-date memberships; positive control 605 of 608 flag sets changed | PASS |
| Rising | yes | same audit; previous-day Trending read at index k-n, n ≥ 1 only | PASS |
| Accelerating | yes | same audit (floors 100, 50, 30) | PASS |
| Breakout | yes | same audit (floors 100, 50, 30); few members (3 to 6 member-days at point-in-time), so statistical power is low | PASS |
| Cooling | yes | same audit (4 kinds) | PASS |
| Sustained | yes | same audit (production and Engineering definitions) | PASS |
| Transitions | yes | Rising and lostTrending Cooling are functions of previous days' flags; identical up to the cut | PASS |
| New to Radar | yes | proof §3 plus bounded test: 0 differences in 21 date comparisons (2,358 memberships), positive control 21 of 21, 2,735 future first-publications checked, 0 reported | PASS |
| Explanations | yes | text compared for every Trending repository on every date: 1,633 texts up to the cut, 0 differences; positive control 2,037 of 2,045 texts changed; module has no clock, randomness, I/O | PASS |
| Classification | no: one 2026-10-09 snapshot over the whole window | point-in-time replay possible on 8 of 29 dates only; 4.8% of comparable flag memberships differ; 21 dates have no historical classification | PARTIAL |
| Discovery | not a lifecycle input; population construction | no first-seen date exists in `candidates.json` or the state; no historical candidate sets before the first publication snapshot | NOT TESTED |
| Admission | not a lifecycle input; population construction | publication-time population tested on 8 dates, confounded with classification (cannot be separated); shadow admission itself is not part of the replay | PARTIAL |
| Ranking | yes | the replay and `src/lifecycle/engineering.ts` read no ranking score or rank (searched); the trend label they read comes from `evaluateRepository` on the T-bounded record, covered by the star audit | PASS |

## 2. Star-driven audit (MEASURED)
Method: for every repository rewrite all daily star gains after a cut C (and shift `stars` by the same amount), run the unchanged replay on original and rewritten state, compare every flag set and every explanation text on every date ≤ C (negative control: must be identical) and after C (positive control: must change). Three rewrites: zeros (cut 2026-09-12), seeded random bursts 0 to 4,999 a day (cut 09-19), ×50 (cut 09-26).
| Rewrite | Cut | Flag sets ≤ cut | Memberships ≤ cut | Differences ≤ cut | Flag sets changed after cut | Explanation texts ≤ cut / differences | Texts changed after cut |
|---|---|---:|---:|---:|---:|---:|---:|
| zeros | 09-12 | 112 | 2,983 | **0** | 301 of 304 | 290 / **0** | 730 of 738 |
| bursts | 09-19 | 214 | 5,633 | **0** | 202 of 202 | 544 / **0** | 933 of 933 |
| scale50 | 09-26 | 314 | 8,282 | **0** | 102 of 102 | 799 / **0** | 374 of 374 |
| **Total** | | **640** | **16,898** | **0** | **605 of 608** | **1,633 / 0** | **2,037 of 2,045** |
**FACT** fields modified: `starHistory.dailyGains` after C and `stars`. **MEASURED** fields affected after C: all 16 lifecycle flag sets and the explanation text. The 3 flag sets and 8 texts that did not change after the cut are empty or identical in both runs.
**FACT** code review before running: in `replay.ts` the next-week quantities are stored only for scoring; no flag function receives them; `historicalRecord(r, T)` truncates `dailyGains`, subtracts later gains from `stars` and nulls `pushedAt` after T.

## 3. New to Radar (A1)
**Definition (FACT, `newToRadar` in `src/lifecycle/engineering.ts`):** first appearance in the published Radar within 14 days of T, with `firstPublishedAt` = the earliest snapshot date containing the repository (`firstPublishedMap`). `genuinelyNew` uses `createdAt` only.
**Proof (INFERENCE by construction, then tested).** `firstPublishedMap` returns, for each id, the minimum date over snapshots that contain it. For an evaluation date T: if that minimum is ≤ T it is also the minimum over snapshots ≤ T, so appending later snapshots cannot change it; if it is > T the repository was not yet published at T. History is append-only, so the value at T cannot depend on anything after T. **A defect was found and fixed in review:** for a first publication after T the function returned `newToRadar: false` (correct) but `daysSinceFirstPublished` as a negative number, which exposed the future date. It now returns null; a test asserts it.
**Bounded test (MEASURED).** Using the production code path (`firstPublishedMap` over all snapshots, then `newToRadar` at T) on 14 real publication snapshots (2026-09-26 to 2026-10-09): rewrite every snapshot after a cut (drop half of the ids, add 300 invented ids). Three cuts (09-29, 10-02, 10-05): 0 differences on every date ≤ cut (21 comparisons, 2,358 New-to-Radar memberships), 21 of 21 dates after the cut differ (positive control valid). 2,735 (repository, date) pairs with a first publication after the date: 0 reported as new or with a day count.
**LIMITATIONS:** (1) the first snapshot is a baseline, so repositories already present then are never new (their real first publication is unknown); (2) the snapshot date is the date of the last commit that day taken from the commit author timestamp including its offset, so a local-time manual commit could land on a neighbouring UTC date; (3) a rewrite of git history would invalidate the premise; (4) `firstPublishedAt` does not exist in production state, so this is evidence for the definition, not for a deployed field.

## 4. Explanations (A2)
**FACT.** `explainDomainMomentum` takes only stored numbers (percentiles, growth, acceleration, gates, stars, age); tests assert it contains no `Date`, `Math.random`, `fs`, `process.env` or `fetch`, and that equal facts give equal text. **MEASURED.** The text built from the T-bounded facts was compared before and after the future rewrite (§2): 0 differences up to the cut. The percentiles inside the text come from the same T-bounded normalization population, so explanation inherits the population hindsight of §5.

## 5. Classification, discovery, admission, ranking (A3, A4)
1. **Do the lifecycle calculations use future star or activity data? MEASURED: no** (§2).
2. **Does the fixed classification change lifecycle eligibility? MEASURED: yes, slightly.** Replaying with the Engineering population as published at T (latest snapshot ≤ T) instead of today's classification of all tracked repositories: on the 8 dates 2026-09-26 to 10-03, comparable flag memberships 2,183, symmetric difference **104 (4.8%)**: Trending 12 of 259, Sustained (Engineering) 34 of 651, Cooling 6 to 16 of 51 to 204, Accelerating 8 of 104 to 347, Breakout 0, Sustained (production) 0. The point-in-time population is 1,721 to 1,726 repositories against 1,736 today. Rising and lostTrending Cooling read previous days' Trending and the earlier replay dates have no population, so they are **not comparable** and excluded (marked in the result file). This is a population-composition effect on peer percentiles, not information from the future in a star series.
3. **Do historical classification snapshots exist? Partly.** Only the published Radar in git: 14 daily snapshots from 2026-09-26. Classification drift between them is real: 115 repositories changed domain on 09-28 (47 away from Engineering) and 272 on 10-05 (10 into, 93 away from Engineering), none on the other days. **No classification exists for 2026-09-05 to 09-25 (21 of 29 replay dates). It is not reconstructed.**
4. **Discovery, admission, ranking.** Discovery and admission decide which repositories enter the tracked set (population construction); the lifecycle flags do not read them. `candidates.json` has `discovery` counts but no first-seen date, so which repositories were already known on an earlier date **cannot be recovered**: **NOT TESTED — HISTORICAL INPUT UNAVAILABLE**. Publication timing is partly captured by the point-in-time population of item 2 but is confounded with classification. Ranking: not an input (searched).

## 6. Conclusion
**MEASURED / FACT:** no leakage in the star-driven flags, the transitions, the explanation text or New to Radar, with valid positive controls. **LIMITATION (not ruled out):** the Engineering population on 21 of 29 dates uses today's classification and tracked set; the effect where measurable is 4.8% of memberships. **Gate verdict: PARTIAL.** To close it fully, keep a daily snapshot of classification and of the candidate/tracked set (including first-seen dates) from now on; the first-published field is already planned. The production lifecycle (Phase 7+) would run forward in time, where this hindsight does not exist: the limitation affects the validation replay, not a live computation.

## 7. Reproduce
`npx tsx scripts/lifecycle/leakage-audit.ts <state data dir> --work <scratch>` (about 10 minutes) and `npx tsx scripts/lifecycle/historical-inputs-audit.ts <state data dir> --work <scratch>` (about 5 minutes; needs the repository's git history). Offline; the burst generator is seeded. The replay also accepts `--population <file>` (date to ids) and `--dump-explanations`.
