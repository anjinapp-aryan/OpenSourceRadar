# POST-PHASE-6.2.1 STRATEGIC REVIEW

Date 2026-10-08. Review only: no production code, ranking, discovery, taxonomy, workflow, dependency or UI was changed and nothing was committed by this review. Evidence labels: **FACT** (measured today) · **INFERENCE** · **UNKNOWN**. Re-run today from HEAD `6ced2dc`: typecheck, 520 tests, production build, public-data greps, momentum re-run (that one on 2026-10-08 before this review, against the 2026-10-07 state).

## 1. Executive Summary

**Recommendation: A, improve discovery, but as a bounded, measured step, and only the part that can change what users see. Confidence: MEDIUM.**

1. **The Rising list cannot contain small repositories by construction.** Rising needs 7-day velocity ≥ 100 stars/day and ≥ 700 stars in 7 days (`config/momentum.json`). Today's 37 Rising repositories have a median of 25,179 stars; 2 are under 1,000 stars. So "find more small repositories" (strategy D) adds almost nothing to Rising. What discovery *can* fix is missing mid-size fast risers hidden behind the top-100-by-stars cut-off.
2. **That hidden group is real.** In 9 crowded topics, going from the top 100 to the top 300 per topic found 940 repositories absent from the candidate set, 92 of them with a lifetime average of ≥ 20 stars/day (30 with ≥ 50/day). The same proxy puts 11.8% of the current candidates above 20/day, so the missed repositories are about as fast-growing as the ones we already track (9.8%).
3. **Engineering Radar is blocked by normalisation, not by discovery.** Engineering has 1,736 published records and 2 are Rising. Weekly growth p99 is 287 for Engineering against 2,122 for AI, and the Rising floor is 700 a week. No amount of discovery changes that.
4. **Phase 6.2.1 is not fully documented.** The brief says it was "validated"; the commit has the code, tests and experiment tooling, but `docs/PHASE-6.2.1-VALIDATION.md`, the discovery audit and the scale audit do not exist, and the discovery experiment covers 9 of 14 planned topics. Findings below stand on re-measured evidence, not on those documents.
5. **Retention (B) is low value on its own.** Of 14 live-checked orphans, 12 gained ≤ 7 stars. It stays disabled.

Order proposed: discovery recall first (Phase 6.2.2), then Phase 6.3 with domain-normalised momentum and taxonomy v2. Section 12 and 14 have the criteria.

## 2. Current System State

| Item | Value |
|---|---|
| Branch / HEAD | `main` / `6ced2dc` (Phase 6.2.1), on top of bot commit `d7b60a6` (2026-10-08 run) |
| Working tree | clean (before this document) |
| Tests / typecheck | 520 passed in 19 files / clean |
| Production build | 1,740 HTML pages, 8,715 files, 139,831,643 bytes (133 MiB) |
| `radar.json` generated | 2026-10-08T11:26:46Z, 3,471 records |
| Tracked / measured / unassessed | 3,471 / 3,471 / 0 |
| Scope | AI 1,482 · BOTH 253 · ENGINEERING 1,736. AI-scope pages (AI+BOTH) 1,735 |
| Lists | Rising 37 (AI 31, BOTH 4, Engineering 2) · movers 121 · sustained 126 · new entrants 342 |
| Trends | Steady 3,239 · Cooling 195 · Rising 37 |
| Tiers | HOT 227 · WARM 2,285 · DORMANT 959 |
| Lifecycle | ACTIVE 3,470 · STALE 1 · ORPHAN 351 · EXCLUDED 135 · withheld 486 |
| `history.json` | 1,735 entries (every AI-scope repository) |
| Workflow | one cron `17 4 * * *`, observed starting 10:35–11:30 UTC; Monday discovery |
| Tracking | HOT 24 h / WARM 72 h / DORMANT 168 h, `dueGraceHours` 3 |
| Discovery | 99 queries, top 100 by stars, established (stars>100, pushed ≤ 30 d) and fresh (created ≤ 30 d, stars>25); replaces the set weekly |
| Momentum | v1, weights velocity .55 / relative growth .15 / acceleration .15 / persistence .15; unchanged since Phase 4 (no diff in `src/momentum`, `config/momentum.json` across 6.2 and 6.2.1) |

## 3. Phase 6.2.1 Validation Review

**A. Due-grace fix. Working as designed, not yet proven in production.**
- **FACT:** 17 deterministic tests plus a seeded 14-day simulation (5 seeds, jittered start 0–150 min): without grace the HOT tier is skipped on some days; with the 3 h grace every HOT repository is collected every run, the HOT gap stays ≤ 29.5 h, WARM ≤ 96 h and DORMANT ≤ 192 h.
- **FACT, the real run of 2026-10-08 (started 11:22:57 UTC, run 37769662200):** HOT 238 of 241 due collected, WARM 583 of 585, DORMANT 0 due. Before the run, HOT repositories had last been collected on 10-05 or 10-06, because the 10-07 run skipped them (the defect).
- **Important:** that run does not test the fix. All 241 HOT repositories were already overdue by two days, so they were due with or without grace (`dueWithoutGrace` 241 = `dueWithGrace` 241). The discriminating observation is the **2026-10-09** run: HOT repositories were collected about 11:23–11:27 on 10-08, so a start earlier than that on 10-09 would skip them without grace. Status: **NOT YET OBSERVED.**
- **UNKNOWN:** why 3 HOT and 2 WARM due repositories were not collected on 10-08 (not investigated; the failure ratio is small and the gate passed).

**B. Route-scale risk. Not a blocker.**
- **FACT:** real routes: 1,740 pages. Synthetic experiment: 2,300 extra pages, 4,040 pages, 20,215 files, 321,311,226 bytes, local build 21 s. A throwaway branch with `RADAR_SYNTHETIC_PAGES=2300` was built by Vercel and its GitHub status reported "Deployment has completed". The 2,048-routes limit therefore does not appear to count pre-rendered static pages. The branch was deleted.
- **Limit of the evidence:** I could not open the preview URL (branch URL did not resolve; the Vercel inspector needs a login), so "served correctly" is not verified, only "the build and deployment succeeded".
- **Headroom:** real pages could grow about 2.3× before reaching what was proven. The earlier user-facing constraint, the explore page payload (247 KB gzip, budget 500 KB), binds at about 3,500 AI repositories, before any Vercel limit.
- The synthetic mode is fenced: env-gated, capped at 20,000, and the workflow audit fails on `out/repo/_synthetic` or any `RADAR_SYNTHETIC_PAGES`. A production build today has 0 synthetic paths.

**C. Ranking regression. None.** Re-running the unchanged momentum code on the 2026-10-07 state with the committed run time reproduced `radar.json` (3,471 records, all six lists) and `history.json` byte for byte. No file under `src/` or `config/` changed in Phase 6.2.1 except the page-level synthetic hook.

**D. Public-data gate. Clean.** Greps over `out/` and `data/public/`: token patterns 0, internal dataset names 0, Windows or workspace paths 0, `.pipeline` 0, `_synthetic` 0. Public records contain only allow-listed keys (`id … pattern, lifecycle`). `localhost` appears in 14 files: repository descriptions of third-party projects and one bundled framework chunk; `localhost:3000` appears 0 times. Test fixtures contain fake token-shaped strings in two test files (unchanged).

**E. Discovery experiment.** Reviewed in sections 4 and 6. Its gap: nine of fourteen topics, anonymous Search API (10/min), growth measured by a lifetime star-rate proxy, not by real recent growth.

**Housekeeping:** `coverage/` (2.67 MB, 108 files) was removed from Git and ignored.

## 4. Discovery Audit

**Method (FACT).** Nine topics, anonymous, queried 2026-10-08: `llm`, `ai-agents`, `mcp`, `machine-learning`, `rag` (AI-leaning) and `docker`, `kubernetes`, `java`, `developer-tools` (Engineering-leaning). Per topic: A = top 100 of `stars:>100 pushed:>30d` (current); C = pages 1–3 of the same; D = A plus `created:>180d` plus `stars:100..1000`. Forks and archived removed. "Novel" = not in the 2026-10-07 candidate set (4,490).

| | A (current) | C (top 300) | D (diversified) |
|---|---:|---:|---:|
| Search requests per topic (weekly at 99 queries) | 1 (99) | 3 (297) | 3 (297) |
| Unique repositories (9 topics) | 696 | 2,139 | 1,881 |
| Novel (not in candidate set) | 3 | 940 | 906 |
| Novel with < 1,000 stars | 0 | 74 | 761 |
| Median stars of novel | 12,129 | 3,908 | 810 |
| Novel with lifetime ≥ 8 stars/day (WARM entry scale) | 3 | 243 | 169 |
| Novel with lifetime ≥ 20 stars/day | 1 | 92 | 77 |
| Novel with lifetime ≥ 50 stars/day | 1 | 30 | 27 |
| Novel, < 1,000 stars **and** ≥ 8 stars/day | 0 | 2 | 33 |
| Classifier-relevant share (5-topic subset) | 79% | 78% | 75% |

Reference: the same proxy over the 4,490 current candidates: 24.1% ≥ 8/day, 11.8% ≥ 20/day, 4.8% ≥ 50/day.

**FACT: where the cut-off bites.** The last rank of the top 100 has 13,423 stars in `ai-agents`, 14,904 in `mcp`, 22,915 in `llm`, 12,129 in `docker`; the last rank of the top 300 has 2,313–5,457 (AI topics) and 2,605–2,973 (docker, kubernetes). A repository with 2,000–12,000 stars in a crowded topic is invisible to the current rules unless another topic ranks it higher or it is under 30 days old.

**Three things must be kept apart.**
- **Discovery recall:** C and D both find ~900 novel repositories in 9 topics. Overlap across the other 90 topics will reduce the per-topic yield: **UNKNOWN** total, plausibly +20–60% candidates.
- **Momentum quality:** the proxy is a lifetime average, which flatters young repositories and understates old ones that surged recently. It says the novel group is not junk (≈ 10% of C's novel hits are ≥ 20 stars/day, against 11.8% of current candidates), not that they are Rising. Real 7-day growth is **UNKNOWN** until they are tracked.
- **User value:** only repositories able to reach the Rising floor (700 stars/week) change the headline list. D's 761 novel sub-1,000-star repositories contribute 33 with a meaningful rate and, at current thresholds, none could be Rising. They would populate only "new entrants" (30-day growth ≥ 30) and the Explore page.

## 5. Fresh Open-Source Reuse Audit

Searched 2026-10-08 (web search plus GitHub REST metadata for the licence, stars and last push shown). Nothing was copied. No project replaces the pipeline, because none combines deterministic point-in-time momentum, classification and static publication; the useful ones are data sources or references.

| Project | URL | License | Stars | Activity | Relevant capability | Verdict | Why |
|---|---|---|---:|---|---|---|---|
| pingcap/ossinsight | https://github.com/pingcap/ossinsight | Apache-2.0 | 2,505 | pushed 2026-09-08 | Trends, rankings and a public API built on GH Archive in TiDB; "trending" and collections | REFERENCE | Compatible licence and the closest product. Needs a hosted database and an LLM feature; a runtime dependency on their API breaks "no external dependency"; use it as a methodology cross-check |
| star-history/star-history | https://github.com/star-history/star-history | MIT | 9,571 | pushed 2026-09-12 | Star-history charts from the stargazer API | REFERENCE (already the data model) | Our star history already comes from the stargazer pages; nothing to add |
| OpenGithubs/github-weekly-rank | https://github.com/OpenGithubs/github-weekly-rank | none stated | 2,639 | pushed 2026-10-05 | Weekly star-growth ranking, top 20 | REFERENCE | No licence file means all rights reserved; ranking is a plain weekly delta, no persistence or acceleration |
| github/innovationgraph | https://github.com/github/innovationgraph | CC0-1.0 | 576 | pushed 2026-10-06 | Aggregate GitHub activity by economy and language | REFERENCE | Country-level aggregates, not repository-level |
| ossf/scorecard | https://github.com/ossf/scorecard | Apache-2.0 | 5,742 | pushed 2026-10-06 | Repository security and health checks | REFERENCE | Health scoring is out of scope for momentum; may inform a later maturity facet |
| chaoss/grimoirelab | https://github.com/chaoss/grimoirelab | GPL-3.0 | 629 | pushed 2026-10-06 | Open-source community analytics platform | REJECT | Copyleft, heavy infrastructure (Elasticsearch) |
| chaoss/augur | https://github.com/chaoss/augur | none | 0 (archived) | archived 2026-07 | Community health metrics | REJECT | Archived |
| ecosyste-ms/repos | https://github.com/ecosyste-ms/repos | AGPL-3.0 | 75 | pushed 2026-10-06 | Repository metadata service | REJECT | AGPL |
| vitalets/github-trending-repos | https://github.com/vitalets/github-trending-repos | none | 3,016 | pushed 2025-11-23 | Scrapes GitHub Trending | REJECT | No licence; scrapes a page with no API |
| huchenme/github-trending-api | https://github.com/huchenme/github-trending-api | MIT | 836 | last push 2023-01 | Trending scraper API | REJECT | Abandoned, scraping |
| GH Archive / BigQuery | https://www.gharchive.org | data set, BigQuery free tier | n/a | hourly | `WatchEvent` counts for every repository: a recall-complete source of star velocity | REFERENCE (candidate for a later phase) | Would remove the top-N search bias entirely, but needs a BigQuery account and SQL outside the current stack; not zero-setup; evaluate after discovery is measured |

Hosted "star-velocity" services found by search (GitGem, RepoInsider, Repo Scout, Apify actors) are closed or commercial: **REJECT** for reuse, **REFERENCE** only to confirm that velocity-first ranking is a recognised approach. **Verdict:** keep building on the existing GitHub Search + stargazer path; the only candidate that could replace it later is GH Archive.

## 6. Discovery Strategy Comparison

| Strategy | Recall | Cost | Complexity | Small Repo Coverage | Risk | Recommendation |
|---|---|---|---|---|---|---|
| A1 top-100 per topic (current) | Misses 2k–13k-star risers in crowded topics | 99 searches/week | none | Poor | Silent bias to the largest | Baseline |
| A2 top-300 per topic | 940 novel in 9 topics; 92 at ≥ 20 stars/day | 297 searches/week (about 10 min authenticated) | Low: `maxPagesPerQuery` 1→3, config only | Mid-size (median novel 3,908 stars) | More tracked repos (+requests, +pages) | **Adopt first, in measured form** |
| A3 recently created (≤ 180 d) | Included in D1; 55% of D's novel are < 180 d old | +1 search/topic | Low | Good for new launches | Noisy, many with rate < 8/day | Adopt a bounded version (stars floor raised) |
| A4 star-range buckets (100–1,000) | 761 novel < 1,000 stars, only 33 with ≥ 8/day | +1 search/topic | Low | Best | Mostly noise; cannot reach Rising today | Defer until normalised momentum exists |
| A5 language-aware | Not measured | +N searches | Medium | Unknown | Query explosion | Defer (UNKNOWN) |
| A6 topic + keyword combinations | Not measured | +N searches | Medium | Unknown | Maintenance of query lists | Reject for now |
| A7 multiple sorts (`updated`) | Not measured; `updated` surfaces active, not growing | +1/topic | Low | Unknown | Activity ≠ momentum | Reject |
| A8 rotating cohorts | Spreads cost, but `stars` sort is unaffected by rotation | Lowest per week | Medium; state needed | Unknown | Weekly coverage differs run to run | Reject: breaks reproducibility |
| B retention (registry, 4 misses, cap 1,000) | Recovers what was found once; does not find new | +~330 history requests/day | Low (built, tested, off) | None | Stale data if unchecked | Keep off |

## 7. Orphan / Retention Analysis

- **FACT:** 351 ORPHAN repositories (history exists, not in the candidate set); 343 reachable, 8 deleted (404), 2 renamed; classifier: AI 193, Engineering 126, Both 28, Unknown 4. Reasons: `PUSH_WINDOW` 234 (67%), `RANK_CUTOFF` 65 (18.5%), `SEARCH_MISS` 47 (13%).
- **FACT (14-repository live sample):** stars gained since last collection: −1, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 5, 7, 45, 338. 12 of 14 grew by ≤ 7 stars; the large mover was a `RANK_CUTOFF` case.
- **Reading:** most orphans are alive but quiet; retention would spend about 330 more requests a day mostly refreshing quiet repositories. The `RANK_CUTOFF` group (65) is the same defect as section 4, and strategy C addresses it at the source. A registry is still cheap insurance against `SEARCH_MISS` (47) but is not the first fix.
- **Cost and determinism:** about +0.8 MB registry file, still Git-based and deterministic. The risk is stale data: retained repositories with no fresh history must be withheld, which the lifecycle already does.
- **Decision:** do not enable. Re-evaluate once the weekly orphan count is observed after discovery changes. The 351 orphans stay withheld (lifecycle `withheld` 486 = 351 + 135 excluded).

## 8. Ranking & Momentum Trust Analysis

**Trustworthy now (FACT).** Scores reproduce exactly (3,471/3,471 in the back-test); no future data enters a historical evaluation (2,939 random pairs, 0 differences); the public data gate is allow-list based; the Rising list is stable day to day (mean overlap 0.883, 3.7 enter and 3.9 leave per day over 91 days); the same code produced the same output after two phases of changes.

**Misleading or incomplete.**
- **Rising is short-lived.** Closed episodes: median 8 days, 35.7% last ≤ 6 days; 29% are Cooling the next day; 67% show a Cooling day within 14 days. Copy should keep saying "strong recent growth", not "durable".
- **BREAKOUT is a one-day label** (median run 1 day) and SPIKE lasts about 6 days: flicker near ratio cut-offs.
- **Rising is a big-repository list.** Median 25k stars; the thresholds are absolute.
- **Cooling and Steady are domain-blind:** 94 of 121 movers are "down" movers.

**Could create false Rising signals.** Star spikes from a single viral post or bot activity (no stargazer quality check); star history reflects stars still held today; a recently created repository with a short history; classification errors placing a repository in a wrong category (UNKNOWN 22.7%, E1 held-out precision 54–67%).

**Could hide genuinely rising repositories.** Top-100 discovery cut-off (section 4); the absolute 700-stars/week floor for anything small or Engineering; the 100-star weekly floor for pattern ratios; orphans dropped silently (351); repositories with a deleted/renamed repo; UNKNOWN classification (22.7% never published in a category).

**Data gaps.** No stargazer quality or fork/watch signal; history is capped at 210 days; no human-labelled gold set (the 6.2 labels were produced by the same party as the experiment); the real due-grace effect and the 3 failed HOT collections are unobserved; no measurement of recall against an external source such as GH Archive.

**What to tell users.** Rising means ≥ 100 stars/day and ≥ 700 stars in 7 days over a candidate pool chosen by topic search; small and Engineering repositories are rarely eligible; history comes from currently-held stars; the pool is sampled, not a census.

## 9. Engineering Radar Readiness

**Not ready.** FACT (published records, 7-day growth): AI p50 11 / p90 178 / p99 2,122; Both p50 8 / p90 92 / p99 1,412; Engineering p50 3 / p90 34 / p99 287. The Rising floor of 700 stars/week is above the Engineering p99. Result today: 2 of 1,736 Engineering records are Rising.

**Recommended architecture (not implemented).** A combination, in this order:
1. **Domain-normalised velocity.** Rank velocity by percentile within domain (AI, Engineering, Both) over a trailing window, so "top 1% of Engineering this week" is expressible. Percentiles are deterministic and need no new data.
2. **Size-adjusted relative growth** (growth ÷ stars, with the existing 100-star absolute floor) so a 1,500-star repository gaining 150 in a week is visible.
3. **Absolute floor retained** as a minimum evidence guard (for example ≥ 100 stars in 7 days) so a percentile on tiny numbers does not create noise.
4. **Category-level thresholds only if** domain percentiles prove too coarse; category sample sizes are small (many under 100 records), so they would be unstable.
5. **Maturity** (age, history length) stays a facet, as pattern already uses it.
Reject a single global threshold, and reject per-repository machine-learned thresholds (non-deterministic, no labels).
**Dependency:** percentile baselines are computed over the candidate pool, which is biased to large repositories by discovery. The pool should be widened first (section 12), otherwise "top 1% of Engineering" means the top 1% of the largest 1,736.

## 10. Taxonomy v2 Readiness

Not ready to be the next phase. UNKNOWN is 22.7% of candidates (1,018 of 4,490); the 6.2 experiment E1 reached 54–67% held-out precision on labels not independent of its author, so it is not shippable. A human gold set does not exist (plan in `PHASE-6.2-CLASSIFICATION-EXPERIMENT.md`). Domain-level routing (AI vs Engineering) is reliable enough (86–95% domain precision) for percentile baselines; category-level taxonomy v2 should follow the gold set, not precede it.

## 11. Architecture Risks

| Risk | Level | Evidence | Mitigation |
|---|---|---|---|
| Discovery bias to large repositories | High | Section 4 | Phase 6.2.2 |
| Absolute thresholds exclude Engineering and small repos | High | Section 9 | Phase 6.3 normalisation |
| Due-grace unproven in production | Medium | Section 3A | Observe the 10-09 run with `collection-evidence.ts` |
| Pool growth raises requests, pages and payload | Low | ~1,125 history requests/day now; +60% is still well inside 5,000/h; pages proven to 4,040 | Check numbers after each discovery change |
| Explore payload (247 KB gzip) | Medium at ~3,500 AI repos | Phase 6.2 size audit | Paginate or shard before then |
| Git growth | Low | ~171 KB per data commit packed | Monitor |
| Single data path (GitHub Search + stargazer API) | Medium | No independent recall check | Consider GH Archive later |
| Missing Phase 6.2.1 documents | Medium for governance | Section 1 | Write them (see section 12) |

## 12. Recommended Next Phase

**Phase 6.2.2: Discovery Recall Expansion (bounded and measured).** Scope, to be approved before any code:
1. Raise the established queries from 1 to 3 pages (strategy A2) and add a bounded recent-creation query (A3) with a higher star floor than the current fresh query; leave retention, classification, momentum and thresholds untouched.
2. Run it **in shadow first**: weekly discovery produces the wider candidate set to an artefact, the normal pipeline continues on the old set, and a read-only script reports for each novel repository its real 7/30-day growth once tracked. Promote only if the success criteria hold.
3. Finish the missing evidence first: write `PHASE-6.2.1-VALIDATION.md`, the discovery audit and the scale audit; finish the five remaining topics of the experiment; observe the 2026-10-09 scheduled run.
4. Re-run discovery bias measurement weekly for three weeks.
Phase 6.3 (normalised momentum + taxonomy v2) follows, with domain percentile baselines computed on the widened pool.

## 13. Explicitly Rejected Alternatives

- **Collect more repositories without measuring recall:** rejected; 761 of D's novel hits are sub-1,000-star repositories that cannot be Rising and add pages and requests.
- **Enable retention now:** rejected; recovers quiet repositories, not new risers.
- **Start Phase 6.3 now:** rejected; normalisation on a size-biased pool would hard-code the bias.
- **Lower the Rising thresholds globally:** rejected; changes the meaning of the headline list and would flood it with Engineering noise.
- **Scrape GitHub Trending or reuse scraper projects:** rejected (licence, terms, abandonment).
- **Reuse GPL or AGPL analytics platforms:** rejected.
- **LLM or learned scoring:** rejected by project principle.
- **Rotating cohorts and `updated` sorting:** rejected (reproducibility; activity is not momentum).
- **Adopt GH Archive now:** deferred; strongest long-term recall source, but outside the current stack.

## 14. Decision Record

RECOMMENDATION: **A** (improve discovery, then B stays off, then C)
CONFIDENCE: **MEDIUM**

TOP 3 REASONS:
1. The current Rising rules need ≥ 700 stars a week, and the discovery cut-off (13–23k stars at rank 100 in the busiest topics) hides mid-size fast risers: 92 novel repositories with ≥ 20 stars/day lifetime in nine topics, about the same rate as the current pool.
2. The alternatives are weaker: retention recovers quiet repositories (12 of 14 gained ≤ 7 stars), and Phase 6.3 normalisation would compute percentiles over a size-biased pool.
3. The change is cheap, configuration-sized (about 200 extra searches per week), deterministic and measurable in shadow mode; headroom exists (1,740 pages built, 4,040 deployed on Vercel, about 1,125 history requests a day).

NEXT IMPLEMENTATION PHASE: **Phase 6.2.2: Discovery Recall Expansion (shadow-measured)**

NEXT:
Phase 6.2.2, the Discovery Recall Expansion.

WHY:
Section 4 and the Rising-size evidence in section 1: the headline list cannot see risers that rank below 100 by stars in a topic, and discovery cost to fix it is small.

DO NOT DO YET:
- enable the retention registry
- change classification rules, the momentum formula, thresholds or Rising/Cooling/Sustained definitions
- implement domain-normalised momentum or taxonomy v2 (Phase 6.3)
- start Engineering Radar
- add a database, an LLM or a new external service (including GH Archive)
- add fork/star-quality signals

SUCCESS CRITERIA:
- 2026-10-09 scheduled run observed: ≥ 95% of HOT repositories collected whatever the start time (needs the evidence script on the dated state)
- shadow discovery for 3 consecutive weeks with ≥ 90% of search requests succeeding
- among newly discovered repositories that are tracked, ≥ 5% reach WARM or HOT within two weeks and at least 10 enter the Rising or movers lists (otherwise discovery recall is not the bottleneck and the recommendation is revisited)
- no change in the published ranking of any repository already tracked (momentum regression byte-identical on the old set)
- total candidates grow by ≤ 60%; history requests ≤ 2,500/day; pages ≤ 3,000; explore payload ≤ 400 KB gzip; build ≤ 2 minutes
- public-data gate and all 520+ tests still pass; token/internal/path greps return 0

## 15. Limits of this review

Nine of the 14 planned discovery topics were fetched (anonymous Search API rate limits ended the run); the raw responses and the growth-proxy script are in a session scratch directory, not in the repository, so these numbers are reproducible with `scripts/discovery/experiment.ts fetch` but the cached file is not committed. The proxy is a lifetime average. The orphan live sample is 14 repositories. I could not open the Vercel preview. One scheduled run (2026-10-08) is observed; the discriminating one (2026-10-09) is not. Labels in the 6.2 classification experiment have no independent reviewer.
