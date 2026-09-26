# MOMENTUM

Implementation: [src/momentum/](../src/momentum/) · configuration: [config/momentum.json](../config/momentum.json) · CLI: `npm run momentum` · tests: [tests/momentum.test.ts](../tests/momentum.test.ts)

Legend: **CONFIGURED** (value in `config/momentum.json`) · **MEASURED** · **ASSUMED** (engineering choice, not fitted) · **UNKNOWN**.

**What momentum means here:** *measured recent momentum* — how strongly a repository has been gaining stars over the last 7/30/90 days, from GitHub's star-history data. It does not predict success, popularity or value, and it is not statistically fitted. The system describes past behaviour.

Layers stay separate and inspectable: `star history -> growth metrics -> momentum signals -> MomentumScore v1 -> trend / lists -> explanation`. Classification and tracking tiers are **not inputs**: `evaluateRepository(record, datasetGeneratedAt, now, config)` has no category, tier or classification parameter (tests: identical momentum for records that differ only in domain/category; the public file joins classification by id afterwards).

## 1. Raw growth metrics

Per repository, from the stored daily gains (Phase 2 window maths, reused): for the 7, 30 and 90-day windows ending on the record's as-of day (today included, partial):

- `growth` (stars gained), `growthPercent` (`growth / stars at window start`), `velocity` (stars/day).
- **`null` means "not measurable"; `0` means "measured, no growth".** Test: a quiet repository has `growth7d = 0`; a history that does not reach back 30 days has `growth30d = null` with status `insufficient-history`; history that contradicts the star count is `inconsistent` (null).
- **Age rule (new in Phase 4).** A window longer than the repository's life would compare a young repository with old ones, so: 30d and 90d are `null` (`insufficient-age`) until the repository is that old; the 7-day window is reported over the days that exist (`partial-window`, `observedDays = ceil(age)`), with velocity = growth / observedDays so a young repository is not penalised. Example (tested): created 5 days ago -> 7d available (500 stars, 100/day), 30d null, 90d null.
- Star-count drift: unchanged Phase 2 tolerance (`max(2, 0.1%)`); a complete history newer than stale metadata corrects the count (see DUE-COLLECTION.md).

## 2. Signals (`MomentumSignals`, all inspectable, none is a score)

`growth7d/30d/90d`, `velocity7d/30d/90d`, `growthPercent7d/30d/90d`, plus:

| Signal | Definition |
|---|---|
| `priorVelocity` | average stars/day over the 28 days ending 7 days before as-of; null if the repository is younger than 35 days or history is missing |
| `accelerationRatio` | `velocity7d / priorVelocity`; null if the prior period averaged less than 1 star/day (a ratio from ~zero is noise) |
| `velocityDelta` | `velocity7d - priorVelocity` (stars/day, signed) |
| `windowsComparable` / `windowsAboveSustainedThreshold` / `sustained` | fully observed windows, how many are >= 30 stars/day (CONFIGURED), and `sustained` = at least 2 fully observed windows including 30d and **all** of them above the threshold. A young repository with fewer windows is not "not sustained": it is unknown (no such line in its explanation) |
| `newEntrant` | age <= 30 days and at least 30 stars gained since creation. **Newness is a signal, not momentum** |
| `recentlyActive`, `pushedDaysAgo` | last push within 30 days |
| `lifetimeStars` | context only; **not used in the score** |
| `staleDays` | days between the record's as-of and the evaluation time |

Not implemented (not available or not established): fork growth (no history API), contributors, issue/PR activity, per-commit activity. Rank movement exists only as a cohort-relative signal (see §5).

## 3. MomentumScore v1

`score = 100 x (sum of weight_i x component_i) / (sum of weights of the components that exist) x multipliers`, one decimal, `null` if there is no velocity. Never clipped: each component is `x / (x + half point)`, strictly increasing and below 1, so scores do not tie at a ceiling (a 0-100 score that saturates was the pitfall seen in another project's output).

| Component | Weight (ASSUMED) | Definition |
|---|---:|---|
| velocity | 0.55 | blend of available velocities, 0.6 x 7d + 0.3 x 30d + 0.1 x 90d (renormalised over what exists; 30d/90d only when fully observed); `log1p(v) / (log1p(v) + log1p(50))`, i.e. 0.5 at 50 stars/day |
| relative growth | 0.15 | 30-day percentage (needs a full 30-day window), capped at 100%, `p / (p + 5)`, **times `min(1, growth30d / 100)`** so a tiny base cannot dominate |
| acceleration | 0.15 | `clamp((ratio - 1) / (3 - 1), 0, 1)`: only speed-ups count; slowing contributes 0 (the trend label handles fading) |
| persistence | 0.15 | share of fully observed windows at or above 30 stars/day (needs at least 2) |

Multiplier: **0.85** if the last push was more than 90 days ago (`inactive-repository`), shown in the result. **Missing data:** a missing component is excluded and the remaining weights renormalised (`completeness` says what share of the weight was available); it is never treated as zero. **Weights, half points, caps and thresholds are engineering assumptions**, chosen by reasoning and by looking at the distribution of the tuning set (§7); they are not fitted to any outcome.

### The two traps, and how they are handled (documented tradeoff)
- **Lifetime stars must not dominate.** Lifetime stars are not a term. Tested: 10k stars at +2,500/week scores far above 100k stars at +100/week; the same growth on a 20k vs a 2M base gives the same velocity component.
- **Percentage growth must not dominate.** +200% from 10 to 30 stars would otherwise beat +20% from 10,000 to 12,000. Percentage growth has weight 0.15, is capped, and is multiplied by an absolute-size gate; velocity (absolute, stars/day) carries 0.55. Cost: genuinely small repositories with a real percentage surge score lower than large ones with the same velocity. That is intended for a "what is rising" list, and it is a tradeoff, not a truth.
- **Age.** Young repositories are not compared using windows they cannot fill (§1); their percentage component is unavailable (needs a full 30-day window), so it does not inflate them; newness itself adds nothing.

## 4. Trend classification and lists

Deterministic, from signals and score, thresholds CONFIGURED (the values were set from the measured distribution of the tuning set, not to hit a count; the resulting counts are outcomes):

- **RISING**: `score >= 50` and `velocity7d >= 100` stars/day and `growth7d >= 700` and (`velocity30d >= 50`, or the repository is younger than 30 days and judged on 7-day evidence) and **holding**: `accelerationRatio` is null or `>= 0.6` and data fresher than 4 days. Not sorted by total stars and not by one-day gains.
- **COOLING**: not Rising, `accelerationRatio <= 0.6` and `velocity30d >= 10`: strong in the past, fading now. (0.6 is the same boundary as Rising's "holding", so a fast repository is either one or the other; a review found repositories at 0.5-0.6 labelled STEADY when the boundary was 0.5.)
- **STEADY**: scored, neither. **INSUFFICIENT_DATA**: no velocity. **EXCLUDED**: archived.
- **Sustained** list: `sustained` true, sorted by 30-day velocity.
- **New entrants** list: `newEntrant` true, sorted by 7-day velocity. A new entrant is **not** automatically Rising (test: quiet new repository is STEADY; an exploding one is Rising *through its velocity*).
- **Biggest movers** (a different concept): repositories whose velocity **changed** most: `|velocityDelta| >= 25` stars/day, ranked by `|velocityDelta|`, split into `moversUp` and `moversDown`. Rising and Biggest Movers overlap but are not the same (test: the biggest mover, a decelerating repository, is not Rising). `rankMovement` (rank by 7-day velocity now vs 7 days ago, inside the evaluated cohort) is reported per repository as a secondary signal; it is cohort-relative and needs age >= 14 days.

## 5. Explanation

Every record carries `explanation[]` and a one-line `summary`, generated from templates with measured numbers only, no LLM. Example (tested):

```
+840 stars in 7 days (120/day)
+1,300 stars in 30 days (43.3/day)
accelerating: last week 6x the previous 28 days
context: 30,000 lifetime stars (not used in the score)
"Gained 840 stars in 7 days and 1,300 in 30 days, with acceleration over the last week."
```

What is missing is stated ("30-day growth not available: repository is 20 days old", "data is 6 days old").

## 6. Data model and compaction

Internal `data/momentum/momentum.json` (per repository: growth windows, signals, score components, multipliers, trend, flags, rank movement, explanation; plus the configuration used and the lists). Public `data/public/radar.json` (`derivePublic`): identity, url, description trimmed to 140 chars, language, stars, classification summary joined by id (never a momentum input), 7d/30d growth and velocity, score, trend, flags, one-line summary; only scored repositories. MEASURED for 545 repositories: internal 1.75 MB, public 457 KB pretty-printed (321 KB minified, 590 B/repository, so about 2 MB minified ESTIMATED for 3,400). The frontend should load only the public file; classified (14 MB), tracked (3.3 MB), star history and evidence stay internal. Nothing internal is deleted.

## 7. Tuning versus validation (honest accounting)

- **Tuning set:** the 500 authenticated repositories (top-starred, all recently pushed). Their distribution (p10 / p25 / p50 / p75 / p90 / p95 / p99): velocity7d 2.1 / 5.3 / 11.4 / 33.4 / 81.9 / 165.9 / 565.1; velocity30d 2.5 / 6.3 / 15.2 / 42.1 / 104.6 / 233.0 / 820.5; growth7d 15 / 37 / 80 / 234 / 573 / 1,161 / 3,956; growth30d 75 / 188 / 456 / 1,263 / 3,139 / 6,989 / 24,614; growth90d 264 / 622 / 1,596 / 4,477 / 11,661 / 22,105 / 50,688; growthPercent30d 0.25 / 0.49 / 1.26 / 2.69 / 6.96 / 12.96 / 43.4; accelerationRatio 0.51 / 0.62 / 0.74 / 0.89 / 1.08 / 1.23 / 2.29; score 14 / 34 / 40 / 47 / 53 / 57 / 65. Documented before setting thresholds. Initial guesses (Rising: velocity 20/day) labelled 157 of 500 Rising; thresholds were then set to round values near the 90th percentile (100 stars/day, 700 stars/week, 50/day over 30 days, score 50), and "holding" (>= 0.6, near the 25th percentile of acceleration) was added after reading the list, because several repositories with ratio 0.15-0.5 were Rising. Counts: 39 Rising of the 500 (41 of 545) before the holding rule, 27 of 545 after; final trend counts on 545: 27 Rising, 82 Cooling, 436 Steady.
- **Validation set:** 45 repositories collected afterwards by the due collector (young, out-of-sample). They were not used to set any threshold, except the tracking fix in DUE-COLLECTION.md, which is a measurement bug, not a tuned threshold. Result: 2 Rising, 36 flagged new entrants, 43 STEADY. Too small and too different in kind (all under 7 days old) to say anything statistical.
- **Not done:** validation on a representative wide population (needs the 3,003 remaining assessments).

## 8. Known limitations
- Tuned on top-starred repositories; behaviour on the wider population is **UNKNOWN**.
- Weights and thresholds are assumptions. Scores are comparable within a run, not across versions (`v1`; any change must bump it).
- The 500-set decelerates on average (median ratio 0.74), so the Movers list is dominated by DOWN entries (74 DOWN vs 6 UP of 80): a property of that sample and of stars decaying after spikes.
- Movers are ranked by absolute change in stars/day, which favours large repositories; a relative variant is a possible later addition.
- Stars can be gamed or spike for non-organic reasons; the score cannot tell, and no accusation is made. No fork, contributor or issue signals.
- Rank movement is cohort-relative and needs a sizeable cohort.
- Repositories with mixed collection dates are each evaluated as of their own collection; freshness is reported (`staleDays`) and stale ones cannot be Rising.
