# PHASE 6.3 MOMENTUM VALIDATION

Date 2026-10-09. Code: [src/momentum/normalize.ts](../src/momentum/normalize.ts), [src/momentum/rows.ts](../src/momentum/rows.ts), [src/domain/index.ts](../src/domain/index.ts), [config/domains.json](../config/domains.json). Experiments: `scripts/momentum/{replay-rows,normalization-eval,engineering-validation,leakage-audit,ai-regression}.ts` → `results/phase6.3/`. Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**. The production momentum engine, its thresholds and every published label are unchanged (section 9).

## 1. Objective
Production Rising needs 7-day velocity ≥ 100 stars/day and ≥ 700 stars in 7 days, calibrated on AI. Engineering weekly growth is an order of magnitude smaller (p99 about 290 against 2,100). Question: **can a deterministic, explainable, domain-aware rule surface meaningful Engineering momentum without damaging AI ranking, using only data available at the evaluation date?**

## 2. Baseline (FACT)
Replay window 2026-09-05 to 2026-10-03 (29 days), pipeline state of 2026-10-07, up to 210 days of daily star gains per repository. Populations: **1,736 Engineering-only** and **1,735 AI-or-BOTH** repositories (classification as of today).
| | Production Rising |
|---|---|
| Engineering: share of domain flagged per day | **0.29%** (mean 5.1 repositories; 14 distinct in 29 days) |
| Engineering: members with ≥ 50,000 stars | 42% |
| Engineering: members under 5,000 stars | 10.9% |
| AI: share of domain flagged per day | 2.82% (mean 49) |
On the last replay day Engineering has **3** production-Rising repositories of 1,736 (0.17%).

## 3. Algorithms evaluated
All share the production durability test (acceleration ratio ≥ 0.6), a single-day-spike guard (no more than 60% of the week in one day) and a 14-day history minimum; floors 50/30 stars (Engineering) and 100/50 (AI) so a percentile on tiny numbers cannot flag a quiet repository.
| Id | Algorithm | Free parameters swept |
|---|---|---|
| P | Production Rising label (reference) | none |
| A | **Raw**: the production absolute gates, no population information | none |
| B | **Domain percentile**: rank metric within the domain | percentile 0.95 / 0.98 / 0.99 × metric |
| C | **Size-band percentile**: rank within the size band | percentile 0.95 / 0.97 / 0.99 × band scheme × metric |
| D | **Hybrid**: B (0.98) or C (0.97) | band scheme × metric |
Rank metrics: 7-day growth (`g7`), 30-day growth (`g30`), and a blend (mean of the 7-day growth and the weekly equivalent of the 30-day growth). Band schemes: fixed 1,000/10,000 stars; **frozen empirical** 1,200/6,000 (rounded terciles of the Engineering star distribution, which stayed within 1,133–1,275 and 5,713–6,007 across the window); dynamic terciles; dynamic quartiles. 59 configurations per domain.

## 4. Metrics (FACT, computed by `normalization-eval.ts`)
Set size and share of domain · day-to-day overlap (Jaccard) · median episode length · median stars and shares under 5,000 / over 50,000 stars · spike-dominated share · overlap with production Rising · **persistence** (share of flagged repository-days whose next-7-day growth is at least half of the flagged week) · **collapse** (next-7-day growth under a quarter: the false-breakout proxy) · **lift** (probability that a flagged repository is in the top 5% of next-week growth, divided by the base rate), both domain-wide and **band-neutral** (top 5% within the repository's own size band). The next-week outcome is used only to score; it is never an input.
**Addition made after the first run, disclosed:** the domain-wide lift favours algorithms that choose large absolute growers by construction, so the band-neutral lift was added to avoid penalising band-relative algorithms unfairly.

## 5. Pre-declared selection rule
Written before comparing results and implemented in `normalization-eval.ts`: *eligible* = set size 1.0–2.5% of the domain, day-to-day overlap ≥ 0.80, persistence ≥ 0.75, collapse ≤ 0.08, spike-dominated ≤ 0.05; rank eligible configurations by share of members under 5,000 stars, then persistence, then overlap. 18 of 58 Engineering candidates are eligible.

## 6. Results (FACT)
### Engineering (1,736 repositories)
| Configuration | Set / day (% of domain) | Overlap | Median stars | <5k | >50k | Persistence | Collapse | Lift | Lift (band) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P production Rising | 5.1 (0.29%) | 0.80 | 33,365 | 10.9% | 42.2% | 0.677 | 0.060 | 19.7 | 22.9 |
| A raw absolute gates | 5.0 (0.29%) | 0.78 | 33,474 | 4.1% | 42.8% | 0.637 | 0.126 | 19.0 | 21.8 |
| B domain 0.98, g7 | 27.5 (1.58%) | 0.85 | 34,886 | 10.7% | 29.7% | 0.795 | 0.064 | 18.4 | 17.6 |
| B domain 0.98, g30 | 25.2 (1.45%) | 0.91 | 37,197 | 8.9% | 30.7% | 0.860 | 0.038 | 19.1 | 19.1 |
| C band 0.95, frozen bands, g30 | 39.9 (2.30%) | 0.87 | 16,778 | 38.5% | 19.2% | 0.781 | 0.069 | 12.8 | 18.0 |
| C band 0.97, frozen bands, g30 | 26.1 (1.50%) | 0.85 | 5,882 | 46.2% | 25.5% | 0.731 | 0.084 | 12.6 | 19.8 |
| **D hybrid 0.98/0.97, frozen bands, g30 (chosen)** | **36.2 (2.08%)** | **0.874** | **21,923** | **33.3%** | **21.4%** | **0.784** | **0.066** | **14.3** | **18.3** |
| D hybrid, terciles (dynamic), g30 | 35.6 (2.05%) | 0.875 | 22,373 | 33.3% | 21.7% | 0.785 | 0.065 | 14.4 | 18.4 |
| D hybrid, fixed 1k/10k, g30 | 37.2 (2.14%) | 0.883 | 19,807 | 25.0% | 20.8% | 0.798 | 0.061 | 15.0 | 17.2 |
| D hybrid, frozen bands, g7 | 38.7 (2.23%) | 0.823 | 23,703 | 32.0% | 21.1% | 0.740 | 0.081 | 14.0 | 16.9 |
| C band 0.95, dynamic terciles, blend (**rule winner**) | 42.4 (2.44%) | 0.854 | 17,532 | 38.9% | 18.1% | 0.765 | 0.076 | 12.6 | 16.9 |
Every configuration is in `results/phase6.3/normalization-replay.json`.

### AI (what would happen if the same algorithms were applied to AI)
| Configuration | Set / day (% of domain) | Median stars | <5k | Persistence | Collapse | Jaccard with production Rising |
|---|---:|---:|---:|---:|---:|---:|
| P production Rising | 49.0 (2.82%) | 43,452 | 15.8% | 0.776 | 0.077 | 1.00 |
| B domain 0.98, g30 | 24.6 (1.42%) | 72,360 | 1.0% | 0.890 | 0.008 | 0.50 |
| D hybrid 0.98/0.97, frozen, g30 | 38.9 (2.24%) | 34,003 | 36.3% | 0.843 | 0.036 | 0.45 |
**Reading:** applied to AI, any percentile algorithm halves or reshuffles the Rising set (overlap with production 0.45–0.50). AI already works under the absolute gates (production persistence 0.78). Therefore **AI stays in `absolute` mode**; the normalisation is an Engineering adapter.

## 7. Decision: Engineering uses the hybrid D (domain 0.98 + band 0.97, `g30`, frozen bands 1,200/6,000)
The pre-declared ranking put a **band-only** configuration (C, percentile 0.95) first. The hybrid is chosen instead, and this is a deliberate departure, with the numbers:
1. The band-only winner is eligible only at the loosest percentile tested (set 2.3–2.4% against a 2.5% ceiling); at 0.97 it fails persistence (0.731 < 0.75).
2. Against that winner the hybrid has higher persistence (0.784 vs 0.765), lower collapse (0.066 vs 0.076), higher overlap (0.874 vs 0.854), higher domain-wide lift (14.3 vs 12.6) and higher band-neutral lift (18.3 vs 16.9). It loses only on the share of members under 5,000 stars (33% vs 39%).
3. Against production the hybrid keeps persistence above production (0.784 vs 0.677), raises the under-5,000-star share 3.1× (10.9% → 33.3%) and halves the share of members over 50,000 stars (42% → 21%).
4. `g30` beats `g7` in every family on stability and persistence (for the hybrid: overlap 0.874 vs 0.823, persistence 0.784 vs 0.740).
5. Frozen bands equal dynamic terciles within noise (36.2 vs 35.6 flagged; persistence 0.784 vs 0.785) and avoid daily boundary movement, so they are used.
**Not claimed:** the hybrid is not the most predictive configuration in absolute terms (B domain-only has higher persistence and lift), and the replay is not proof that flagged repositories are "truly rising"; it shows stability, durability and breadth.

## 8. Engineering ranking validation (FACT, last replay day 2026-10-03)
| | Production | Hybrid |
|---|---:|---:|
| Engineering repositories / measured | 1,736 / 1,736 | 1,736 / 1,736 |
| Rising or Trending | 3 (0.17%) | **31 (1.79%)** after excluding learning content (via domain gate 10, band gate 8, both 13) |
| Accelerating (pattern) | 11 (0.63%) | unchanged |
| Breakout | 1 (0.06%) | unchanged |
| Sustained growth | 11 (0.63%) | unchanged |
| New launch | 75 (4.32%) | unchanged |
| Cooling (pattern) | 22 (1.27%) | unchanged |
Pattern labels (Phase 6.1) are not recomputed; only the Rising/Trending decision differs. Learning/list content is excluded from Trending (182 flag-days over the window removed, for example `30-Days-Of-Python`).
Technologies are not forced into the result. Flagged repositories by technology, last day and distinct over 29 days (production in brackets): Docker 8 / 12 (1 / 4) · PostgreSQL 4 / 11 (1 / 2) · Developer tools 11 / 24 (3 / 6) · Security 6 / 15 (1 / 4) · Observability 3 / 9 (0 / 0) · Kubernetes 1 / 7 (0 / 1) · Terraform 2 / 3 (0 / 0) · AWS 3 / 3 (0 / 1) · Redis 2 / 3 (1 / 1) · Microservices 1 / 2 (0 / 0) · Spring 0 / 2 (0 / 0) · **Kafka 0 / 0 (0 / 0)** · Java (language) 3 / 6 (3 / 3). **Result:** Kafka and Spring produce essentially nothing, and that is reported as measured: these ecosystems have small weekly growth even relative to Engineering peers.
**Noise visible in the flagged set (LIMITATION):** some flagged repositories are tools the v1 classifier places in Engineering that a reader may not consider "engineering technology" (for example an Android TV client, an OSINT tool). This is the v1 classification, unchanged.

## 9. Leakage audit (FACT)
24 random dates between 2026-06-01 and 2026-10-03 × 2 domains × 500 random repositories = **24,000 repository-date pairs**. For each date, all daily gains after T of every sampled repository were rewritten (zeros, random bursts up to 5,000, or ×50), keeping present-day star counts consistent; the observable row, percentiles, size band and flags at T were recomputed. **Differences: 0 in rows, flags, percentiles and bands.** Positive control: a quantity that reads T+1…T+7 differs on 18,889 of 21,431 pairs, so the audit can see leakage. Classification takes only name, description, topics and language (a test asserts its input has no growth field); admission uses the discovery snapshot only (a test asserts it never reads star history); explanations render stored numbers. Verdict: **no leakage**.

## 10. AI regression (FACT, hard gate)
The production momentum pipeline was re-run on the 2026-10-09 state with the committed dataset's own evaluation time and compared with the committed `radar.json`: 1,735 AI/BOTH records, **0 added, 0 removed, 0 reordered, 0 score, 0 trend, 0 pattern changes, 0 records with any field change; all six lists and `history.json` identical.** The SHA-256 of the ranking sources (`engine.ts`, `config.ts`, `dataset.ts`, `momentum.json`, `pattern.json`, `tracking.json`, `classification.json`, `classifier.ts`) is stored and checked by a test, so a later change cannot pass unnoticed.

## 11. Limitations
- Classification and star counts are today's, applied to history ("hindsight"); star history reflects stars still held.
- Persistence/collapse/lift are **proxies** for durability, not labels of truth; there is no ground-truth list of rising repositories.
- 29 days, one pipeline state; the Engineering population is 1,736.
- The pre-declared rule's winner was not chosen (section 7); the added band-neutral lift is post hoc.
- The size-band bounds are frozen from this window; they should be re-derived if the Engineering star distribution shifts materially (the tests do not detect this).
- The hybrid was not validated on AI because AI keeps the absolute rules.
- Not published: the normalised result exists as shadow output (`config/domains.json`, `results/phase6.3`), not in `radar.json` (see `PHASE-6.3-VALIDATION.md`).

## 12. Rejected algorithms
Raw (A): same breadth as production, lowest small-repository share (4.1%), highest collapse (0.126). Domain-only (B): the most stable and persistent, but the same large-repository dominance as production (small share 8.9%, 30.7% over 50,000 stars): the problem the work is meant to address. Band-only (C): the most small-repository representation, but lowest domain-wide lift and either a looser percentile or failing persistence. Dynamic bands: no gain over frozen bands. Metric `g7`: less stable.
