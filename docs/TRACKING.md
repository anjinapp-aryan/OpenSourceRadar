# TRACKING

Implementation: [src/tracking/](../src/tracking/) · policy: [config/tracking.json](../config/tracking.json) · CLI: `npm run track` · tests: [tests/tracking.test.ts](../tests/tracking.test.ts)

Legend: **CONFIGURED** (a value in `config/tracking.json`, changeable without code) · **MEASURED** (observed on real data) · **ASSUMED** (a design choice with no measured basis) · **UNKNOWN**.

## 1. What tracking is

Classification answers *what is this repository?* Tracking answers *how closely do we watch it?* It decides a **refresh tier** and a **next refresh time**. It does not compute momentum, rank anything, or change classification. Tracking never reads discovery queries or category names: a repository found by an "AI Agents" query is not HOT for that reason, and a Java repository is not WARM for being Java (test: identical metrics give identical decisions for AI, ENGINEERING and BOTH).

The pipeline stays separated and auditable:

```
data/candidates/candidates.json   what discovery found (metadata + provenance)
        ↓ npm run classify
data/classified/classified.json   what each repository is (id -> ClassificationResult)
        ↓ npm run track  (+ Phase 2 repository dataset for star growth)
data/tracked/tracked.json         how often to refresh each one (id -> TrackingDecision)
```

Identity is the GitHub repository **id** everywhere. Each dataset stores only what it adds (no repeated metadata); `fullName` is kept for readability. If a repository is renamed, the id still matches, tier history is preserved and the record carries `previousFullName` for that run (tested).

## 2. Eligibility

A repository is tracked only if it is classified `AI`, `ENGINEERING` or `BOTH` (CONFIGURED `eligibility.topLevel`) and not archived (`excludeArchived`). `UNKNOWN` repositories stay in the classified dataset and are counted in `summary.excluded`; they are never dropped from history. Classification is an eligibility gate only, never an input to the tier.

## 3. Tiers

Signals come from the Phase 2 repository dataset (7/30-day growth, stars per day) and repository metadata (age, last push, stars). Null growth never satisfies a rule.

| Tier | Rule (any one; all thresholds CONFIGURED in `rules.hot` / `rules.warm`) | Refresh |
|---|---|---|
| **HOT** | `starsPerDay7d >= 80` · or `growthPercent7d >= 1.0` **and** `growth7d >= 100` · or **new entrant**: age <= 30 days **and** `starsPerDay7d >= 10` | 24 h |
| **WARM** | `starsPerDay7d >= 8` · or `starsPerDay30d >= 8` · or pushed within 30 days **and** stars >= 1,000 | 72 h |
| **DORMANT** | none of the above | 168 h |

- "New entrant" here means *young and growing*. It is not "recently discovered": discovery time is deliberately not a signal.
- **Not implemented:** "large rank movement" (needs rankings; Phase 4) and "activity" beyond last-push recency (commit counts are available from GraphQL but their cost/benefit is not established).
- Refresh intervals 24/72/168 h are **ASSUMED** initial operating policy, not optimised. The only constraint enforced is `hot <= warm <= dormant`.

### Where the thresholds came from
MEASURED on the authenticated 500-repository dataset (top candidates by stars, all pushed within 30 days): `starsPerDay7d` p50 / p75 / p90 / p95 / p99 = 11.4 / 33.4 / 81.9 / 165.9 / 565.1; `growthPercent7d` p50 / p75 / p90 / p95 = 0.23 / 0.50 / 1.04 / 1.83. HOT's 80 stars/day and 1% weekly growth are roughly that set's 90th percentile, i.e. "HOT is the top decile of an already popular set". WARM's 8 stars/day is below its median. **These percentiles describe only that biased sample**; on the wider candidate population they are UNKNOWN until growth is collected for it.

## 4. Provisional tiers (no growth data yet)

Candidates that were discovered but never had star history fetched cannot be assessed. They get a **provisional** decision (`assessed: false`):

- age <= 30 days and stars >= 200 -> provisional HOT;
- otherwise the configured `unassessed.tier` (WARM);
- `refreshIntervalHours` = min(tier interval, `unassessed.refreshHours` = 24) and `nextRefreshAt = now` so the first history fetch happens immediately.

A provisional evaluation never demotes a tier that was earned from data.

## 5. Transitions and hysteresis

Decisions are deterministic given (metrics, policy, previous state, time). The previous tier and `tierSince` are read from the previous `tracked.json`.

1. Compute the tier the **current** metrics justify.
2. **Promotion** (DORMANT -> WARM -> HOT, or DORMANT -> HOT) is immediate.
3. **Demotion** is damped, one level at a time:
   - must have been in the tier at least `minDaysInTier` (CONFIGURED: HOT 3 d, WARM 7 d);
   - and the metrics must fail the current tier's rules even with thresholds relaxed to `demoteFactor` (0.7) of their values.
   HOT never drops straight to DORMANT.
4. Every decision carries a human-readable `reason` (`HOT because hot:starsPerDay7d>=80`, `promoted WARM -> HOT: ...`, `HOT kept: metrics within 70% of its thresholds (...)`, `HOT kept: only 1.0 of 3 minimum days in tier`) and the structured `signals.rulesFired`.

All four required transitions (DORMANT->WARM, WARM->HOT, HOT->WARM, WARM->DORMANT), the damping cases and the one-level rule are tests.

## 6. Output (`data/tracked/tracked.json`)

Per repository: `id, fullName, classification{topLevelCategory, categories}, tier, refreshIntervalHours, reason, signals, assessed, tierSince, lastEvaluatedAt, nextRefreshAt, transition`. Dataset summary: tracked count, per-tier counts, unassessed count, exclusions, `dueNow`, `estimatedDailyRefreshes`. `selectDue()` returns due repositories, hottest first, then oldest due. Nothing in the collector reads the schedule yet (see §8).

Logging (JSON lines, secrets redacted): `track.transition` (repository, tracking version, from, to, reason) and `track.done`.

## 7. Measured on real data

The results of running the real pipeline are in [PHASE-3-VALIDATION.md](PHASE-3-VALIDATION.md) (tier distribution on the 500 measured repositories, estimated daily refresh volume, and the provisional-tier volume for the full candidate set).

## 8. Known limitations

- **Thresholds are calibrated on top-starred repositories only** (see §3); with them DORMANT was empty on the 500-repository set. Whether the tiers separate a wider population well is UNKNOWN.
- No rank-movement, activity-volume or contributor signals (unmeasured or Phase 4).
- The collector does not consume `nextRefreshAt` yet: today `npm run collect` still discovers and fetches a chosen set. Wiring a "refresh only what is due" mode is the natural first step of Phase 4 (kept out of Phase 3 on purpose: it changes the Phase 2 collector, which needs measured evidence).
- Tier stability over time cannot be measured before several runs exist: **UNKNOWN**.
- `trackingVersion: phase3-v1`. Any change to rules or intervals should bump it so old decisions are not silently reinterpreted.

---

## Phase 4 changes (supersede parts of the sections above)

- **UNASSESSED replaces provisional tiers (section 4).** A repository with no measured growth is UNASSESSED: not HOT, WARM or DORMANT, due immediately, collected after HOT by default (`dueOrder`). The Phase 3 provisional HOT/WARM counts (121 / 3,292) were not measurements. Legacy provisional records are read as UNASSESSED and the first measurement is a transition (`first assessment: ...`).
- **Young repositories.** Stars/day now divides by the days that exist for repositories younger than 7 days, and a repository younger than `rules.dormant.minAgeDays` (30) cannot be DORMANT (it becomes WARM, reason `too-young-to-be-dormant`). Found on the first live due run: 25 of 45 repositories aged 4-5 days had been labelled DORMANT.
- **Measured distribution (Phase 4):** 3,413 tracked: HOT 69, WARM 341, DORMANT 0, UNASSESSED 3,003. DORMANT remains unmeasured on a real old, quiet repository. See DUE-COLLECTION.md and PHASE-4-VALIDATION.md.
- Category independence unchanged: no tier depends on category or classification score.
