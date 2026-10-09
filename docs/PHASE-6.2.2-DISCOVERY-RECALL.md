# Phase 6.2.2 — Discovery Recall Expansion

Date 2026-10-09. Shadow experiment only: production discovery, tracking, classification, momentum, ranking, public data and UI are unchanged (verified in section 14). Evidence labels: **FACT** (measured in this experiment) · **INFERENCE** · **UNKNOWN**. Derived result files: `results/phase6.2.2/` (`table.json`, `comparison.json`, `probe.json`, `current.json`, `top300.json`, `recent-star-bands.json`, `multi-sort.json`, `hybrid.json`, `baseline.json`). Reproduce: `tsx scripts/discovery/shadow.ts fetch|sample|analyse <state data dir>`; the 11 MB raw caches are not committed. Reuse audit: see the strategic review (`POST-PHASE-6.2.1-STRATEGIC-REVIEW.md` section 5) and the search-partitioning note in section 3 below; no code was copied.

## 1. Objective

Answer one question: **does broader discovery uncover repositories that qualify as Rising (or nearly) when evaluated with real star history by the production momentum code, at an acceptable API cost and noise level?** There is no list of "all rising repositories on GitHub", so nothing here is true recall. The measured quantity is a **DISCOVERY RECALL PROXY**: the share and number of repositories, invisible to current discovery, that show actual recent growth.

## 2. Baseline

FACT (pipeline state of 2026-10-07, candidate set of the Monday 2026-10-05 discovery):
- 99 queries per week over 66 topics and 33 categories (66 established: `topic:X stars:>100 pushed:>30d`; 33 fresh: `created:>30d stars:>25`), sorted by stars descending, **page 1 only (top 100)**, forks and archived dropped, results matching no category topic or keyword dropped as irrelevant, deduplicated by repository id, then classified and tracked.
- 4,490 candidates (AI 1,842 · Engineering 2,435 · both 213); under 1,000 stars 1,753; under 5,000 2,992; under 10,000 3,485. 3,471 tracked (HOT 241, WARM 2,280, DORMANT 950). Classified UNKNOWN: 1,018 (22.7%).
- Real growth of the candidate pool, from stored history and the production rules: Rising 37 (0.8%), Near-Rising 80 (1.8%), other growers 471 (10.5%), quiet 3,902 (86.9%) — **588 growers (13.1%)**.
- Production steady-state cost: 99 searches per week, about 1,125 star-history requests per day.

## 3. Experimental Strategies

Fourteen topics, the largest by candidate count: `llm, ai-agents, mcp, docker, kubernetes, java, developer-tools, machine-learning, rag, security, devops, postgresql, database, generative-ai`. Per topic, nine search requests:

| Strategy | Queries per topic | Search requests per topic |
|---|---|---|
| A current | page 1 of the established query (no new requests: the production candidate set is the control) | 1 (already paid) |
| B top-300 | the established query, pages 1–3 | 3 |
| C recent + star bands | four bounded queries: `created ≤180d stars:50..500`, `created ≤180d stars:500..5000`, `stars:1000..5000`, `stars:5000..15000` (all `pushed ≤30d`) | 4 |
| D multi-sort | the established filter sorted by `updated` and by `forks` (the Search API has no "created" sort; recency is a query qualifier, used in C) | 2 |
| E hybrid | components chosen greedily by estimated useful candidates per search request within +300 searches per week (production scale); chosen: `C:young-500-5000, D:updated, C:mid-1000-5000, C:young-50-500` | 4 |

Deliberate choices: bands were chosen from the Phase 6.2.1 nine-topic data, where growers concentrated at 500–5,000 stars, rather than fixed in advance; E was **not** assumed to win. Technique reuse: partitioning a capped GitHub search by date or star range is the documented workaround for the 1,000-result limit (the MIT-licensed Nextflow Github-Crawler and the Sourcegraph API notes describe it); only the idea was used. Search spacing 7.5 s anonymous.

## 4. Experimental Method

1. Run the 98 distinct queries (126 search requests) for the 14 topics, cached. Duration 15.6 minutes, anonymous, no rate-limit waits.
2. Normalise: dedupe by numeric repository id (a rename cannot create a duplicate), drop forks (0) and archived (19), reject malformed results (0).
3. **Novel** = not in the production candidate set: **2,751** repositories.
4. Draw a stratified random sample of **200** novel repositories (strata = which strategies found them, fixed seed 622, processed in a seeded order) and fetch real star history (30 weeks, one request each) for every one.
5. Evaluate each with the production code (`buildRecord`, `evaluateCurrent`): growth over 7/30/90 days, score, trend, pattern.
6. Value classes (mutually exclusive, best first): **RISING** = the production trend label; **NEAR_RISING** = not Rising but 7-day velocity ≥ 50 stars/day and growth ≥ 350 (50% of both numeric Rising gates); **GROWER** = 7-day velocity ≥ 8 stars/day and ≥ 56 stars in the week (the production WARM tracking floor, the project's own "worth tracking more often" line); **QUIET** otherwise. Thresholds come from existing production rules, not from tuning on this sample.
7. Estimate per strategy with stratum weights; intervals are Wilson 95% on the raw sample size (conservative for a stratified design).
8. Run a **probe** (sections 5–6) and compare with the control.

## 5. Final Sample

FACT: selected 200, **measured 200, failed 0**; no failure reasons. Star-history requests: 203 for the 200 (3 needed a retry). Duration: 2026-10-08 15:33 UTC to 2026-10-09 10:35 UTC wall time, of which almost all was waiting for the anonymous core quota (60 requests per hour); active fetching takes seconds per repository. Credentials: none; the environment had no token, and the sample was never reduced or filled with proxy values.

Estimated rates among the 2,751 novel repositories (random sample, 200):
| | Sampled hits | Rate |
|---|---|---|
| Rising | **0** | 0% (95% upper bound 1.9%) |
| Near-Rising | 1 | 0.5% |
| Other growers | 15 | 7.5% |
| Quiet | 184 | 92.0% |
Total growers (Near-Rising plus other growers) 16 of 200 (8.0%) against **13.1%** in the current pool. **Typical new candidates are less likely to be growing than the repositories we already track.**

## 6. Probe Method

Question: "can the strongest-looking repositories hidden from current discovery contain Rising ones?" Selection: the 40 novel repositories with the highest **LIFETIME STAR/DAY DISCOVERY PROXY** (stars ÷ age in days). The proxy is used only to choose whom to measure; it is not momentum and is never used as a result. All 40 were measured with real star history (one of them was also in the random sample; it is reported in both and excluded from neither). The probe is a **deliberately biased** sample and supports statements of existence, not of rates.

## 7. Actual Star-History Results

Probe, measured 40 of 40 with the production momentum code (`probe.json` has every repository, with stars, age, 7/30/90-day growth, score, trend, pattern, classification and which queries found it):

| Class | Count |
|---|---:|
| **RISING (production label)** | **8** |
| Near-Rising | 8 |
| Other growers | 14 |
| Quiet | 6 |
| Unmeasured (repository 3–9 days old, too short for the growth windows) | 4 |

The eight Rising: `lexmount/moli` (13.6k stars, age 59 d, 7-day growth 10,730), `DuarteSantos8/openGym` (7.7k, 82 d, 6,604), `coreyhaines31/marketingskills` (53.7k, 266 d, 1,680), `monid-ai/monid` (2.9k, 43 d, 1,776), `Ryze-AI-Adgent/open-seo-mcp-skills` (4.6k, 40 d, 1,639), `pacifio/atlas` (9.4k, 147 d, 886), `superdesigndev/treg` (4.8k, 85 d, 836), `miqdadbadjuber/anti-slop` (5.0k, 62 d, 751). Their stars are 2,870 to 53,699, ages 40 to 266 days; **no Rising probe repository is under 2,500 stars**. Two (`openGym`, `moli`) have the SPIKE pattern: their Rising label rests on one burst, so the durable count is six.

## 8. Discovery Recall Proxy

DISCOVERY RECALL PROXY (not ground-truth recall): among repositories discovered by the broader strategies, those showing meaningful recent growth that the current strategy cannot see.
- **Existence (FACT):** at least **8 Rising, 8 Near-Rising and 14 other growers** are invisible to current discovery in these 14 topics alone. The current pool has 37 Rising across all 66 topics, so the 8 are at least +22% of today's Rising list from a fifth of the topics.
- **Bound on the rest (FACT):** beyond the top-40 proxy, the random sample found 0 Rising in 200 (≤ 1.9% of the remaining 2,711, i.e. up to about 50 more are statistically possible; the point estimate is none).
- **Where they live:** every Rising probe repository has a lifetime proxy ≥ 50 stars/day (38 repositories in the novel pool; 8 Rising = 21%). The 275 novel repositories at 10–50 stars/day: 0 Rising in 24 sampled, 29% growers. The 2,438 below 10 stars/day: 0 Rising and 1 Near-Rising in 175 sampled, 4.6% growers.
- **Depth or filter?** Of the 8 Rising: **6 are deeper than page 1** of any topic (a true depth gap) and **2** (`marketingskills`, `moli`) are on page 1 of today's query yet absent from the 2026-10-05 pool (timing or the relevance filter; **UNKNOWN** which). 1 (`open-seo-mcp-skills`) is already in pipeline state as an orphan: retention would also have recovered it. The same split in the whole novel pool: only 12 of 1,518 novel B candidates are on page 1; 99.2% are deeper.
- **Classification limits what users would see:** 3 of the 8 Rising are classified UNKNOWN today (`openGym`, `monid`, `treg`) and would be withheld from the public data until the taxonomy improves.

## 9. Rising Candidates

| Strategy | Probe Rising found (of 8) | Random sample Rising | New Rising, estimated |
|---|---:|---:|---|
| B top-300 | **8** | 0 of 110 | ≥ 8 (probe lower bound) |
| C recent + star bands | 7 | 0 of 130 | ≥ 7 |
| D multi-sort | 3 | 0 of 56 | ≥ 3 |
| E hybrid (greedy-chosen components) | 5 | 0 of 150 | ≥ 5 |
B finds every probe Rising repository. C misses `marketingskills` (53.7k stars, outside every C band). D finds fewer than half. E, chosen by random-sample yield, drops the B component and the 5,000–15,000 band and misses three: a rule that optimises for the typical candidate loses the rare risers.

## 10. Near-Rising Candidates

Probe: 8 Near-Rising (`shadcn-ui/ui` at 125k stars, `cactus-compute/needle`, `miuuyy/codex-chatgpt-web`, `CopilotKit/OpenBot`, `MeteorNOX/DeepSeek-Balance-Whale-Widget`, `ZJU-REAL/Easel`, `shy3130/tick-stock-panel`, `tigerless-labs/agent-memory`). Found by B 8/8, C 6/8, E 4/8, D 1/8. Random sample: 1 Near-Rising (in a C component, `C:young-500-5000`). Six of the eight are classified UNKNOWN.

## 11. Small/Mid-Size Repository Coverage

New candidates by size (14 topics), versus the whole current pool (4,490): current under 1k 1,753 · under 5k 2,992 · under 10k 3,485.
| | New | <1k | <5k | <10k | Estimated growers <1k | Estimated growers <5k |
|---|---:|---:|---:|---:|---:|---:|
| B | 1,518 | 274 | 1,135 | 1,473 | 42 | 98 |
| C | 1,803 | 757 | 1,510 | 1,767 | 97 | 167 |
| D | 764 | 457 | 664 | 755 | 28 | 56 |
| E | 2,008 | 1,128 | 1,968 | 2,005 | 111 | 181 |
All strategies add small and mid-size repositories, C and E mostly sub-1,000. **Real growth exists there:** in the random sample, 8 of 105 sampled repositories under 1,000 stars (7.6%) and 13 of 179 under 5,000 (7.3%) were growers by the 7-day rule (a quick re-count of the stored series; the table above uses the full evaluation). **But growth is not Rising:** no Rising or Near-Rising repository in either sample is under 2,500 stars, and under the current Rising rule (≥ 700 stars in 7 days) small repositories cannot qualify however well they are discovered. Small-repository representation is therefore improved by every strategy (B +274 under 1k, C +757, E +1,128), but surfacing them as risers is a Phase 6.3 normalisation question, not a discovery one.

## 12. Grower Comparison

Actual growers (7-day velocity ≥ 8 stars/day and ≥ 56 stars). Current pool: 588 of 4,490 (13.1%) measured; strategies are random-sample estimates with Wilson 95% intervals.
| | Sampled | Grower rate | 95% interval | Estimated new growers |
|---|---:|---:|---|---:|
| Current pool | 4,490 (all) | 13.1% | n/a | 588 |
| B | 110 | 8.3% | 4.5–15.0% | 126 |
| C | 130 | 10.1% | 6.0–16.5% | 196 |
| D | 56 | 11.1% | 5.2–21.9% | 85 |
| E | 150 | 9.5% | 5.7–15.2% | 209 |
Component with the highest yield: `C:young-500-5000` (15 sampled, 6 growers or better: 40%, interval 20–64%) — but only 226 new repositories (about 30 to 80 growers).

## 13. Classification / Noise

New candidates by production classifier (14 topics):
| | AI | Engineering | Both | UNKNOWN (noise) | UNKNOWN share |
|---|---:|---:|---:|---:|---:|
| Current pool | n/a | n/a | n/a | 1,018 of 4,490 | 22.7% |
| B | 435 | 557 | 66 | 460 | 30.3% |
| C | 629 | 506 | 125 | 543 | 30.1% |
| D | 210 | 295 | 47 | 212 | 27.7% |
| E | 668 | 613 | 150 | 577 | 28.7% |
"Noise" here means UNKNOWN classification (not publishable today); there is **no human ground truth for classification correctness**, so correctness is **UNKNOWN**; quiet repositories (about 90% of new candidates) are a separate cost, not an error. In the probe, 21 of 40 are UNKNOWN, including 3 of the 8 Rising and 6 of the 8 Near-Rising.

## 14. API Budget

FACT (measured in this experiment): 126 search requests (15.6 minutes anonymous, 7.5 s apart, 0 rate-limit waits); 242 star-history requests for 240 repositories (200 random + 40 probe, one overlap, 3 retries); no GraphQL. Anonymous history is limited to 60 requests per hour, so the 240 repositories took about 19 hours of wall time; authenticated, the same work would take minutes.

Production estimate: searches scale from the 14 topics to the 66 topics (×4.7; an **upper bound**, because the other 52 topics are smaller and 10.8% of new B candidates already repeat across topics); history uses the current mix of 0.324 requests per tracked repository per day (3,471 tracked, 1,125 requests per day); every new candidate is assumed to be tracked.

| | Additional searches / week | Total searches / week | Additional history requests / day (upper bound) | Total history / day | Weekly search minutes (authenticated, 30/min) |
|---|---:|---:|---:|---:|---:|
| Current | 0 | 99 | 0 | 1,125 | 3.3 |
| B | +132 | 231 | ≤ +2,319 | ≤ 3,444 | 7.7 |
| C | +264 | 363 | ≤ +2,755 | ≤ 3,880 | 12.1 |
| D | +132 | 231 | ≤ +1,167 | ≤ 2,292 | 7.7 |
| E | +264 | 363 | ≤ +3,068 | ≤ 4,193 | 12.1 |
Capacity: the core API allows 5,000 requests per hour (120,000 per day); the highest case (E) uses 3.5% of one day's capacity. Runtime grows with request count (2–11 minutes at 1,125 requests per day today), inside the Actions limit even at 3.7×.

Useful candidates (grower or better, classifiable) and cost, 14-topic scale:
| | Estimated useful new | Per search request | One-time requests per useful candidate (searches + one history fetch per new candidate, ×4.7 scale) |
|---|---:|---:|---:|
| B | 98 | 2.3 | 74.7 |
| C | 168 | 3.0 | 52.2 |
| D | 85 | 3.0 | 44.2 |
| E | 181 | 3.2 | 53.6 |
Useful per request ranks D/E/C above B, **but this metric is dominated by growers, not by Rising**: B's cost per found Rising repository is the lowest (8 found for +132 searches per week, and no other strategy finds all 8). **Bounded admission** is therefore the lever for history cost: tracking every newly discovered repository is not justified by these results (92% of random new candidates were quiet). The lifetime-proxy bands in `comparison.json` (`proxyBands`) show where the measured risers sit (all eight Rising probe repositories have a proxy ≥ 50 stars/day; 0 Rising in the 199 randomly sampled repositories below that), but **this report does not set an admission threshold**; that belongs to the implementation design of the next phase.

## 15. Strategy Comparison

| Strategy | New Repos | Actual Growers | Near-Rising | Rising | <1k | <5k | Noise | Requests | Useful/Request |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current | 4,490 (pool) | 588 (13.1%) | 80 | 37 | 1,753 | 2,992 | 1,018 | 99 searches / 1,125 history per day | N/A |
| B top-300 | 1,518 | 126 est. | 0 sampled (probe 8/8) | 0 sampled (**probe 8/8**) | 274 | 1,135 | 460 | +132 searches/wk, ≤ +2,319/day | 2.3 |
| C recent + bands | 1,803 | 196 est. | 14 est. (probe 6/8) | 0 sampled (probe 7/8) | 757 | 1,510 | 543 | +264, ≤ +2,755 | 3.0 |
| D multi-sort | 764 | 85 est. | 0 sampled (probe 1/8) | 0 sampled (probe 3/8) | 457 | 664 | 212 | +132, ≤ +1,167 | 3.0 |
| E hybrid | 2,008 | 209 est. | 14 est. (probe 4/8) | 0 sampled (probe 5/8) | 1,128 | 1,968 | 577 | +264, ≤ +3,068 | 3.2 |
Counts for the strategies are for the 14 experiment topics; "Rising" and "Near-Rising" for strategies combine the random-sample result (an estimate with a wide interval) with the probe (existence). Growers and Useful are stratified estimates.

## 16. Limitations

- **Anonymous rate limit:** all history was fetched at 60 requests per hour; the experiment took about 19 hours of wall time. This limits sample size, not method.
- **Sample size:** 200 random plus 40 probe. A 0 in 200 Rising allows up to about 1.9% (95%); per-strategy intervals are wide (for example D, 56 sampled).
- **No ground-truth recall.** The proxy establishes existence and an order of magnitude, not a percentage of all rising repositories.
- **Lifetime stars per day is only a discovery proxy.** It was used to pick the probe and to describe bands; it is never used as momentum.
- **Probe selection bias:** the probe is the top of the proxy, by construction rich in risers. It proves they exist and which queries find them; it says nothing about rates.
- **Only measured repositories have real star-history evidence;** the other 2,511 novel repositories are represented by the random sample.
- Fourteen of 66 topics; scaling to 66 is an upper bound; one snapshot day; the 30-week history cannot give 90-day growth for repositories younger than 90 days (7 of 8 probe Rising have no 90-day value but are still Rising on the 7/30-day rules).
- **Rising is a point-in-time label** with a median episode of 8 days (Phase 6.2); two of the eight are bursts (SPIKE).
- The candidate pool is from 2026-10-05 and the searches from 2026-10-08; some "novel" repositories may have entered since (explains at most part of the two page-1 cases).
- **Classification:** 3 of the 8 Rising are UNKNOWN today; correctness of classification is unmeasured.
- **Phase 6.2.1 documentation gap (recorded, not closed here):** `docs/PHASE-6.2.1-VALIDATION.md`, `docs/PHASE-6.2.1-DISCOVERY-AUDIT.md` and `docs/PHASE-6.2.1-SCALE-AUDIT.md` still do not exist. The 6.2.1 commit has code, tests and experiments only.
- **Oct 9 due-grace validation:** observed, see below (it passes).

### Oct 9 due-grace validation (FACT: observed)
The scheduled run of 2026-10-09 (run 37923095319) started at **11:20:16 UTC**, 3 to 5 minutes before most HOT repositories were due: they had been collected on 2026-10-08 between 11:23 and 11:27 UTC, so their `nextRefreshAt` fell between about 11:23 and 11:26 UTC on 2026-10-09. This is exactly the condition that starved HOT repositories on 2026-10-07. Measured with `scripts/pipeline/collection-evidence.ts` on the dated state backups of 2026-10-08 (before) and 2026-10-09 (after), grace 3 hours:

| Tier | Tracked | Due without grace | Due with grace | Collected | Due, not collected |
|---|---:|---:|---:|---:|---:|
| HOT | 227 | **2** | 227 | **225 (99.1%)** | 2 |
| WARM | 2,285 | 358 | 1,579 | 1,570 (99.4%) | 9 |
| DORMANT | 959 | 0 | 0 | 0 | 0 |
Without the grace this run would have collected 2 of 227 HOT repositories (0.9%) and left the rest for a further day; with it, 225. **The 3-hour due grace prevents HOT starvation in a real scheduled run.** Not explained: the 2 HOT and 9 WARM repositories that were due and not collected (a failure share of 0.9% and 0.6%; the run passed its gate); no cause was investigated.

### Production safety (FACT)
Verified after the experiment: `data/`, `config/`, `src/momentum`, `src/tracking`, `src/classification`, `app/`, `lib/`, `components/` and `.github/` have no changes; `radar.json` and `history.json` are untouched; a production build gives 1,740 pages, 8,715 files and 139,831,643 bytes (byte-identical to the build before the experiment); 539 tests pass (535 before, 4 new artefact-consistency tests; 19 in `phase622`), typecheck clean; token patterns, internal dataset names, local paths and `_synthetic` in the build and public data: 0.

## 17. Recommendation

**ADOPT B — TOP 300.**

Why B and not the others, from evidence:
1. **B is the only strategy that found all eight Rising probe repositories** (C 7, E 5, D 3), at the lowest search cost of the strategies that find them (+132 searches a week, 7.7 minutes authenticated).
2. The gap is genuinely about depth: six of the eight Rising and almost every novel candidate (99.2% of B's) sit beyond page 1 of their topic.
3. B is a **configuration change** to the existing discovery (`maxPagesPerQuery` 1 → 3 for the established queries), with no new query shapes to maintain. C and E add four query shapes per topic for a lower Rising yield; D is not justified by any measurement.

What this evidence does **not** support:
- That broader discovery improves the *typical* candidate: it does not (grower rate 8% against 13%).
- That adoption without a cost bound is wise: tracking every new candidate triples history requests.
- Any claim about Engineering: the experiment's Rising and Near-Rising finds are overwhelmingly AI.
Precisely stated: *broader discovery increases the candidate pool's coverage of repositories that currently qualify as Rising (at least eight in fourteen topics, none visible to current discovery), but the typical added candidate is quiet, so tracking must be bounded.*

Statements that bound the recommendation:
- **Top-300 discovery is recommended for adoption, but bounded admission is required before full tracking.** The results do **not** justify tracking every newly discovered repository.
- This is a **discovery recall PROXY**. There is no ground-truth set of all rising repositories, so true recall was not and cannot be measured here.
- **Lifetime stars/day was only a discovery-selection proxy** (to choose the probe and to describe bands); no result in this report uses it as momentum.
- **The targeted probe is selection-biased** by construction. The random sample and the probe answer different questions: the random sample estimates how the *typical* newly discovered repository behaves (quiet, 8.0% growers, 0 Rising in 200); the probe shows that *rare strong risers exist* behind the cut-off and which queries find them (8 Rising in 40). Neither alone supports a population rate of Rising repositories, and the probe cannot be read as a yield.

**Confidence: MEDIUM.** Existence of Rising repositories behind the cut-off is firm (8 measured with production rules). The size of the effect at 66 topics, its stability over weeks, and the cost-bounded admission rule are not measured.

## 18. Safe Rollout Plan

Intended production flow (not implemented in this phase):
```
Current discovery (top 100)
+
Top-300 discovery (established queries, pages 1-3)
        ↓
deduplicate (by repository id)
        ↓
classification (unchanged rules)
        ↓
quality filters
        ↓
bounded admission  (rule and numbers to be designed in the next phase)
        ↓
star history
        ↓
momentum (unchanged)
        ↓
Radar
```
**Top-300 discovery is recommended for adoption, but bounded admission is required before full tracking.** The admission rule and its numeric limits are deliberately **not** decided here.
1. **Shadow first (no effect on published data):** run the wider discovery on the weekly discovery day, write the extra candidates to a separate artefact, and do not feed them to classification or tracking. Record new candidates per week and how many are on page 1 versus deeper.
2. **Bounded admission pilot:** design the admission rule and its limits in the implementation design of the next phase, using the measured distributions in `comparison.json` as input; admit only what passes it into classification, tracking and star history.
3. **Success criteria are set before the pilot** (in the implementation design): new Rising and Near-Rising repositories reaching the public data, the quiet share of admitted candidates, a cap on added history requests, and a byte-identical regression on the existing repositories.
4. **Keep retention disabled;** revisit after the pilot (one probe Rising repository is an existing orphan).
5. **Do not widen the Rising definition and do not relax the classifier;** small repositories and Engineering belong to Phase 6.3 normalisation.
6. **Rollback:** set `maxPagesPerQuery` back to 1; the candidate set is rebuilt weekly, so nothing persists.
7. Re-run `shadow.ts analyse` after the pilot with a token from the environment to extend the sample cheaply.

### Phase 6.3 investigation item (classification)
The probe found 3 of the 8 Rising repositories (`openGym`, `monid`, `treg`) classified UNKNOWN, and 21 of the 40 probe repositories are UNKNOWN. **Phase 6.3 should evaluate whether valuable newly discovered repositories are systematically lost to UNKNOWN classification.** This report does **not** generalise 3 of 8 into a population-wide classification failure (the probe is selection-biased, n is small, and classification correctness was not measured against human labels), and no classification rule was changed or relaxed.

### Unresolved before rollout
Why `marketingskills` and `moli` (on page 1 of today's query, large) were absent from the 2026-10-05 pool (timing or the relevance filter), and the 30% UNKNOWN share of new candidates (taxonomy work).

## 19. Decision Record

DECISION: adopt **B (top-300 on established queries)** as the discovery depth, introduced in shadow first, with **bounded admission required before full tracking** (rule to be designed in the next phase).
CONTEXT: Rising repositories exist behind the top-100 cut-off (8 measured), the typical new candidate is quiet (0 Rising in 200 sampled, 8.0% growers vs 13.1% current), and tracking everything would roughly triple history requests.
ALTERNATIVES REJECTED: KEEP CURRENT (misses repositories that meet today's Rising rules); C and E (more queries, lower Rising yield: 7 and 5 of 8); D (3 of 8, no measured advantage).
CONSEQUENCES: +132 searches a week; history load governed by a bounded-admission rule (to be designed); one extra shadow artefact; classification gaps will still withhold some finds until the taxonomy improves; Engineering remains a separate normalisation problem.
REVIEW TRIGGER: after the three-week pilot, or if the shadow week shows page-1 misses dominate over depth misses.

PHASE: 6.2.2
STATUS: PASS (sample 200/200, probe 40/40; the decision is MEDIUM-confidence; the Oct 9 due-grace check passed)
