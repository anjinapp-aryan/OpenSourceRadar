# PHASE 6.2 COVERAGE RECOVERY

Date 2026-10-08. Code: [src/coverage/index.ts](../src/coverage/index.ts), [scripts/coverage/orphans.ts](../scripts/coverage/orphans.ts); result: `results/phase6.2/orphans.json`. Reproduce: `npx tsx scripts/coverage/orphans.ts <state data dir> --live --sample 30` (HEAD request to `github.com/<owner>/<name>` for every orphan, no token; a REST sample limited by the unauthenticated 60-per-hour quota). Evidence labels: **FACT** · **INFERENCE** · **RECOMMENDATION**. Nothing in production discovery, classification or tracking was changed by this document.

## 1. The question
351 repositories have star history in pipeline state but are not in the current candidate set ("orphans", PHASE-6.1-OPERATIONS.md). They are withheld from the public data. Why did they disappear, are they real, and is the cause systemic?

## 2. How discovery works (FACT, from the configuration)
99 search queries (66 "established", 33 "fresh") run once a week (Mondays) and **replace** the candidate set. Each query is `topic:X` plus either `stars:>100 pushed:>(30 days)` or `created:>(30 days) stars:>25`, sorted by stars, **first page only: the top 100 results**. Forks and archived repositories are excluded. Nothing carries over from the previous week.

## 3. What the orphans are (FACT, 351 orphans, 2026-10-08)
| Check | Result |
|---|---|
| Reachable on github.com (HEAD, all 351) | 343 reachable (HTTP 200), **8 not found (404)**, 2 of the reachable were renamed or transferred |
| Current classifier | AI 193, ENGINEERING 126, BOTH 28, UNKNOWN 4: **98.9% are relevant**, not junk |
| Stars | p10 35, median 322, p90 4,980, maximum 81,179 (`swisskyrepo/PayloadsAllTheThings`) |
| Dropped when | 336 of 351 were in the 2026-09-25 candidate set; the other 15 were never in it (INFERENCE: they date from the earliest 500-repository dataset) |
| Archived / fork (30-repository REST sample, 14 completed before the quota ran out) | 0 / 0 |

**Why each is missing, judged against the discovery rules and this week's results:**
| Reason | Count | Share | Meaning |
|---|---:|---:|---|
| `PUSH_WINDOW` | 234 | 66.7% | no push in the 30 days before discovery and too old for the new-repository queries |
| `RANK_CUTOFF` | 65 | 18.5% | matches a query but ranks beyond 100 by stars (median 103, p90 347, maximum 624) in a topic whose top 100 are all bigger |
| `SEARCH_MISS` | 47 | 13.4% | matches a query and would rank inside the top 100, yet was not returned (cause not visible in stored data) |
| `BELOW_STAR_FLOOR` | 3 | 0.9% | stars at or below the floor |
| `TOPIC_MISMATCH` | 2 | 0.6% | none of its topics is a discovery topic any more |
| `ARCHIVED` | 0 | | |

**Outcome classes** (reason plus live facts): **DISCOVERY_GAP 300** (reachable, relevant, and the current rules would not return it), **RECOVERABLE 39** (reachable, relevant, and the rules would return it: it should come back on its own), **NOT_FOUND 8** (`tonhowtf/omniget` 14,348 stars, `yukitorido/short-video-generator-AI`, `Qiuner/QCode` and five small ones), **RECLASSIFY 4** (reachable, but the current classifier gives UNKNOWN: `ItzCrazyKns/Vane`, `glanceapp/glance`, `air-verse/air`, `xuzhougeng/wisp-science`), ARCHIVED 0, FORK 0. A re-diagnosis with live stars, topics and push dates for the 14 sampled repositories changed none of their reasons.

## 4. Are the orphans valuable? (FACT from the sample, INFERENCE beyond it)
Among the 14 sampled repositories, star growth since their last collection was: -1, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 5, 7, 45, 338. **Most orphans are quiet.** Two grew: `cbrock84/headcount` gained 338 stars (1,669 to 2,007) and is a `RANK_CUTOFF` case, and `Leonxlnx/unlazy` gained 45 (last push 2026-09-03, a `PUSH_WINDOW` case).

**INFERENCE (systemic):**
1. **`PUSH_WINDOW` (two thirds) mostly removes quiet projects, which a momentum product loses little by missing.** Its real effect is to make weekly discovery forget everything that stops being pushed, including repositories that still attract stars (documentation, lists, models).
2. **`RANK_CUTOFF` is the important defect.** Discovery asks for the top 100 by stars per topic. In a crowded topic (`llm`, `ai-agents`) a repository with 1,000 to 5,000 stars and fast growth ranks 100 to 600 and is never returned; only the 30-day "fresh" queries reach small new repositories. This is the opposite of the product's claim: a discovery rule biased to the largest repositories under-samples exactly the "small and rising" repositories the product exists to find. 65 are visible here because they were once found (through another topic or an earlier shape of the query); the number never found cannot be measured from stored data (**UNKNOWN**).
3. **`SEARCH_MISS` (47 plus 39 recoverable) shows the weekly search is not a complete census.** Some repositories that should be returned are not, for reasons outside our data (search index timing, topic edits).
4. **Deleted and renamed repositories exist** (8 and 2) and are handled today only by silence: a deleted repository is left in state and eventually withheld.

## 5. Candidate retention design (not enabled)
**Requirement:** a repository discovered once must not vanish from internal awareness because one weekly search missed it, without the registry growing forever.

**Lifecycle:** `ACTIVE` (returned by this week's discovery) → `RETAINED` (missed, still carried over and refreshed on its tier schedule) → `ACTIVE` again if rediscovered, or → `RETIRED` (dropped from the working set; remembered for a number of weeks, then forgotten). The pure implementation is in `src/coverage/index.ts` (`updateRegistry`, `activeIds`), unit-tested, deterministic, and **not wired into the pipeline**.

| Decision | Proposal | Reason (evidence) |
|---|---|---|
| Retention period | up to **4 missed weekly discoveries** | covers search misses and short quiet spells; `RECOVERABLE` repositories (39) come back within a discovery or two |
| Capacity | at most **1,000** retained, highest priority first (priority = last measured 30-day growth, then stars) | focuses the budget on repositories that still move; 66% of orphans are quiet |
| Retirement | exceeding the misses, or capacity | bounds growth |
| Deleted (404) | retire immediately with reason `not found` (after the check, not on a transient error) | 8 observed |
| Archived | retire immediately (`archived`) | discovery already excludes them |
| Renamed or transferred | handled by **repository id**, which survives renames and transfers; the stored name is refreshed | 2 observed; verify that GraphQL lookup by the old name still resolves before relying on it (**UNKNOWN**) |
| Fork | not carried (discovery excludes forks; a retained repository that becomes a fork is retired) | no forks observed |
| Unclassified under the current classifier | retire (`no category`) | 4 RECLASSIFY today; avoids refreshing what is never shown |
| Forget retired | after 8 weeks | keeps the file bounded |

**Estimated size (INFERENCE):** weekly drop rate is at least 170 and at most 340 repositories (460 dropped between two snapshots ten days apart, of which 336 are orphans today). With 4 weeks of retention that is 700 to 1,350 retained; the capacity of 1,000 caps it. That is about +22% candidates (4,490 to about 5,490) and, since 98.9% are relevant, about +29% tracked repositories: **about +330 star-history requests per day** (1,139 to about 1,470), well inside the 5,000 per hour core budget, and about +0.8 MB of registry file. Runtime grows roughly in proportion (a few minutes).

**What retention does not fix:** the `RANK_CUTOFF` bias (repositories never found) and the quiet-repository drop; it only prevents forgetting what was found.

## 6. Recommendation (Phase 6.3 decisions, not made here)
1. **Enable the bounded registry** (a discovery-pipeline change: the Monday step would merge `activeIds` into candidates before classification). It is the smallest change that stops the orphan accumulation and is already built and tested.
2. **Fix the discovery bias with evidence first:** raise the established queries from 1 to 3 or 4 pages (rank cut-off p90 is 347) at the cost of about 200 to 300 extra search requests per week (the Search API allows 30 per minute authenticated), or add queries that do not favour old giants (`created:>(180 days)`). Measure how many new repositories enter the rising set before keeping either.
3. **Classify the 4 RECLASSIFY and the UNKNOWN population** through taxonomy work (PHASE-6.2-CLASSIFICATION-EXPERIMENT.md), otherwise `Vane` and `glance` stay invisible even when retained.
4. Re-run the orphan analysis weekly (it is read-only) for two or three discoveries to measure the real weekly drop and recovery rates that this design only estimates.

## 7. Limits
Unauthenticated REST allowed only 14 of the 30 sampled checks (60 per hour, shared with other use); HEAD checks reach github.com, not the API, so archived and fork status is known only for the sample. Orphan reasons use the stored metadata at last collection (up to 5 days old for these records), re-checked on 14 repositories. The number of repositories discovery has **never** found cannot be measured from this data.
