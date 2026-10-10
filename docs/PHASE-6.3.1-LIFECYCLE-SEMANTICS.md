# PHASE 6.3.1 ENGINEERING LIFECYCLE SEMANTICS

Date 2026-10-10. Code: [src/lifecycle/engineering.ts](../src/lifecycle/engineering.ts), config: [config/lifecycle.engineering.json](../config/lifecycle.engineering.json), replay: `scripts/lifecycle/replay.ts` → `results/phase6.3.1/lifecycle-replay.json`, `new-to-radar.ts` → `new-to-radar.json`. Tests: `tests/phase631.test.tsx`. Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**. These semantics are **shadow only**: no Engineering state reaches `radar.json`, and AI keeps its current definitions unchanged.

## 1. Method
Replay over 29 evaluation dates (2026-09-05 to 2026-10-03) on the 1,736 Engineering repositories of the 2026-10-07 pipeline state, using only data observable at each date (the Phase 6.3 leakage audit covers the underlying rows). The following week's growth is used **only to score** a definition. Every threshold was either taken from the existing production rules or chosen by a **rule declared in `replay.ts` before the results were read**; deviations are stated. Classification is today's (hindsight), and 29 days is short.

Notation: `w0` = stars gained in the 7 days ending at T; `w1…w4` the four previous 7-day windows; **baseline** = mean of `w1..w4` (the same 28-day span the production acceleration ratio uses). `g30` = 30-day growth. "Trending" is the Phase 6.3 hybrid (top 2% of Engineering or top 3% of the size band on `g30`, floors, acceleration ≥ 0.6, spike ≤ 60%, history ≥ 14 days).

## 2. Definitions (one rule per state, evaluated in a fixed precedence)
| State | Definition | Inputs | History needed | Source of the thresholds |
|---|---|---|---|---|
| **Trending** | Peer-relative: the hybrid flag above | stars, `g7`, `g30`, acceleration ratio, one-day spike share | 14 days | Phase 6.3 replay (`config/domains.json`) |
| **Rising** | Trending on today and on at least two of the previous four days (**three of the last five days**) | the Trending flag per day | 5 days | replay, rule below |
| **Accelerating** | production pattern machinery (`classifyPattern`): acceleration ratio ≥ 1.2 and `w0` ≥ **30** stars | acceleration ratio, `w0` | 35 days | ratio: production; floor: replay |
| **Breakout** | acceleration ratio ≥ 3 and `w0` ≥ 100 (production values), **displayed only if it holds on two consecutive days** | acceleration ratio, `w0` | 35 days | production; reliability finding below |
| **Cooling** | baseline ≥ 50 stars a week **and** baseline in the domain's top decile **and** `w0` below 50% of the baseline | weekly windows, domain percentile of the baseline | 35 days | replay, rule below |
| **Sustained** | `g30` in the domain's top 5% **and** at least 3 of the last 4 weekly windows ≥ 30 stars | `g30` percentile, weekly windows | 28 days | replay, rule below |
| **New to Radar** | the repository first appeared in the **published Radar** within the last 14 days (section 4) | `firstPublishedAt` | n/a | decision, section 4 |
| *Genuinely new* (a separate flag, not a state) | repository created within the last 90 days | `createdAt` | n/a | existing `NEW_LAUNCH` window is 30 days; 90 is the horizon of the history shown |

**Precedence and overlap.** Trending ⊇ Rising (Rising is Trending that has persisted). Cooling is **mutually exclusive with Trending** (the Cooling rule requires a fall to below half the baseline, which also fails the Trending acceleration test). Accelerating, Breakout and Sustained are **annotations** that may co-occur with Trending/Rising; production already applies one fixed precedence among patterns (spike, cooling, breakout, accelerating, sustained, normal), and Engineering uses the same function with its own floors. **New to Radar** and **Genuinely new** are orthogonal to the growth states.

## 3. Evidence and choices (FACT, replay)
### Rising: persistence filters (pre-declared: keep filters whose set is ≥ 60% of unfiltered Trending, then highest next-week persistence, then lowest short-lived share)
| Definition | Set per day (% of domain) | Day-to-day overlap | Short-lived episodes (≤ 3 days) | Persistence (next week ≥ half) | Collapse (< quarter) |
|---|---:|---:|---:|---:|---:|
| Production Rising (reference) | 5.1 (0.29%) | 0.80 | n/a | 0.677 | 0.060 |
| Trending (no filter) | 35.4 (2.13%) | 0.873 | 32.0% | 0.780 | 0.068 |
| two consecutive days | 31.9 (1.92%) | 0.850 | 28.1% | 0.784 | 0.064 |
| **three of the last five days (chosen)** | **29.4 (1.78%)** | 0.849 | **26.5%** | **0.796** | **0.057** |
The filter improves durability a little (persistence +1.6 points, collapse −1.1, short-lived episodes −5.5 points) at the cost of about three days of delay and 17% fewer repositories. The effect is **modest**; it is chosen because the declared rule selects it, not because it transforms the list. A larger list is not better: Rising 1.78% against production 0.29% is justified by higher persistence (0.796 vs 0.677), not by size.

### Accelerating and Breakout: growth floors (pre-declared: lowest floor whose persistence stays within 0.05 of the production floor)
| Floor (stars a week) | Accelerating set (% of domain) | Overlap | Persistence | Collapse | Breakout set (% of domain) | Breakout collapse |
|---|---:|---:|---:|---:|---:|---:|
| 100 (production) | 13.8 (0.83%) | 0.61 | 0.743 | 0.044 | 0.52 (0.03%) | 0.231 |
| 50 | 29.1 (1.76%) | 0.59 | 0.801 | 0.035 | 0.79 (0.05%) | 0.211 |
| **30 (chosen for Accelerating)** | 45.6 (2.75%) | 0.59 | 0.814 | 0.029 | 1.03 (0.06%) | 0.269 |
**Accelerating** moves to a floor of 30: persistence rises and collapse falls as the floor drops. **LIMITATION:** the label flickers (median episode 2 days, overlap 0.59), so it must be shown as an annotation on Trending/Rising repositories, not as a list. **Breakout is not reliable in Engineering at any floor:** 0.5 to 1 repository a day, median episode **1 day**, 21 to 27% of flagged repository-days collapse the next week (production floor: 23%). The declared rule keeps the production floor (a lower floor does not keep persistence within 0.05). Decision: Breakout is displayed only after two consecutive days (which in this window almost never happens), so it is effectively an **annotation with no list** in the MVP.

### Cooling (pre-declared: eligible at ≥ 0.2% of the domain per day; highest confirmed rate, then lowest recovery rate)
Outcome definitions: **confirmed** = the next week's growth stays under 60% of the 28-day baseline; **recovered** (the false-cooling measure) = it returns to at least 80% of the baseline.
| Definition | Set per day (% of domain) | Overlap | Median episode (days) | Short-lived (≤ 3 days) | Confirmed | Recovered (false cooling) |
|---|---:|---:|---:|---:|---:|---:|
| production (absolute rule) | 21.1 (1.27%) | 0.81 | 5 | 38.4% | 77.6% | 10.1% |
| **fromHigh (chosen)** | 20.3 (1.22%) | 0.79 | 4 | 48.9% | **83.5%** | **8.2%** |
| twoDeclines | 7.2 (0.44%) | 0.45 | 2 | 76.5% | 74.7% | 9.0% |
| lostTrending | 5.4 (0.33%) | 0.61 | 5 | 32.5% | 76.7% | 17.3% |
**Reading:** the production Cooling rule is already usable on Engineering (78% confirmed, 10% recovered). The chosen peer-relative definition is better by **5.9 points confirmed and 1.9 points false cooling**, at the price of more flicker (short-lived 49% vs 38%). The improvement is modest. The definition's key property is that a quiet repository can never be "cooling": it needs a baseline of at least 50 stars a week and a place in the top decile, so Cooling means *a repository that was growing strongly has fallen below half of its own recent pace*, not "a large repository is slow". About 8% of cooling flags are false (the repository rebounds the following week); the UI must therefore word Cooling as "growth halved versus its recent baseline", not as a prediction.

### Sustained (report-only comparison; choose the Engineering definition if still-sustained-after-7-days is higher and the set is not smaller)
| Definition | Set (% of domain) | Median episode | Still sustained 7 days later |
|---|---:|---:|---:|
| production flag | 19.0 (1.14%) | 10 | 81.4% |
| **Engineering (chosen)** | 80.1 (4.83%) | 29 | **95.0%** |
**LIMITATION:** the Engineering definition is almost static (median episode = the whole window): it describes the repositories that are consistently in the top 5% by 30-day growth. It is a stable membership, not an event; it should not be presented as news.

## 4. New to Radar: the one primary definition
Candidates: **discovered recently**, **admitted recently**, **classified recently**, **measured recently**, **first appearing in the published Radar**; and, separately, **genuinely new** (a recently created repository).
**FACT (the published daily snapshots in Git history, 14 dates):** repositories enter the published Radar in **weekly batches** on the Monday discovery days (2026-09-28: 139; 2026-10-05: 273; zero on the other 11 days). Of the 412 newly published repositories, **50.2% were created within 90 days**; for **Engineering only, 26.4% (37 of 140)**, with a median age of **1,915 days (5.2 years)**. The Top-300 shadow admission also arrives as one weekly batch: of the 150 repositories admitted in the 2026-10-10 shadow run, **28% (42) were created within 90 days, 79% (119) within a year and 21% (31) are older than a year**, so a definition tied to admission would call 72% of a batch new although they are older than 90 days.
**Decision: New to Radar = first appearance in the published Radar within the last 14 days.** Reasons: (1) it is the only candidate a reader can verify (it is what the reader saw appear); (2) discovery, admission and classification dates are infrastructure events and would label years-old repositories new when a batch is admitted or a taxonomy rule changes; (3) "measured recently" is an artefact of the due-collection schedule (a repository moving between tiers). The 14-day window covers two weekly batches, so the list is stable between Mondays.
**What the decision does not claim:** it does **not** mean the project is new. `genuinelyNew` (created within 90 days) is a separate, required companion flag: 26% of newly published Engineering repositories carry it, so a list titled "New to Radar" must show each repository's age, and "new projects worth evaluating" must be a different, narrower list (`genuinelyNew` and minimum evidence).
**Implementation prerequisite (not done here):** `firstPublishedAt` must be persisted in production state when a repository first appears in a published dataset. Today it can only be reconstructed from Git history (14 snapshots), which is a bootstrap, not a durable source. This is a production change and is out of scope for Phase 6.3.1.

## 5. What was not validated
- 29 days, one pipeline state, today's classification; Cooling "recovery" only for dates with a following week available.
- No human judgement of which repositories are "really" rising or cooling exists; the scores are persistence, collapse, confirmation and recovery of growth.
- Lifecycle for **AI is unchanged** and was not re-evaluated.
- The pre-declared selection was followed; the only judgement calls are the display rules (Breakout needs two consecutive days; Accelerating is an annotation).
