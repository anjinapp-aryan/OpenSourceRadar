# ENGINEERING RADAR STRATEGY

Date 2026-10-06. Evidence labels: **FACT** · **OBSERVATION** · **INFERENCE** · **RECOMMENDATION**. This is a decision document; no code was changed.

## 1. The central finding: AI Radar's model does not transfer
**FACT** (public dataset generated 2026-10-06T11:24Z, 3,957 repositories):

| Group | Repositories | 7-day growth p50 / p90 / p99 | Rising | Cooling |
|---|---:|---|---:|---:|
| AI only | 1,482 | 12 / 184 / 1,928 | 31 (2.1%) | 142 |
| Engineering only | 1,736 | 3 / 36 / 285 | **2 (0.1%)** | 32 |
| Both | 253 | 8 / 117 / 1,264 | 4 | 20 |

The Rising rule (7-day growth at least 700, stars per day at least 100, plus score and acceleration conditions) was written and tuned on the AI-heavy top-500 set. For Engineering-only repositories the **99th percentile of weekly growth is 285**, so almost nothing can qualify. The six "Engineering" Rising repositories are AI-adjacent (`FalkorDB`, `stablyai/orca`, `NVIDIA/SkillSpector`, `herdrdev/herdr`, `usestrix/strix`, `t8y2/dbx`). Only 15 Engineering-only repositories gained 300 or more stars in a week, 3 gained 700 or more.

**INFERENCE:** copying AI Radar and swapping the category list would produce an Engineering Radar whose "Rising" page is nearly empty or filled with AI crossovers. Stars measure hype; engineering adoption shows up elsewhere (releases, downloads, dependents, production use). That is why Engineering must be built differently.

## 2. What the Engineering Radar should answer (evaluated)
| Question | Answerable from GitHub alone? | Verdict |
|---|---|---|
| Which technologies (not just repositories) are rising? | Yes, by aggregating repository momentum per technology tag | **Core of the MVP**, the strongest differentiator |
| Which new tools should an architect evaluate? | Partly: young repositories with sustained growth, release cadence, maturity signals | **MVP** ("New to evaluate") |
| Which projects are becoming important / mainstream? | Weakly from stars; better with dependents and downloads | Phase after MVP |
| Which are fading? | Yes (Cooling, negative velocity change) | **MVP** |
| Which frameworks gain adoption? | Needs package downloads | Post-MVP, npm first (verified API) |
| Which architectural patterns gain interest? | Not reliably (pattern repositories are mostly tutorials, see taxonomy) | **Do not build** |
| Which database/cloud tech is moving? | Yes at technology level once tags exist | **MVP** (Data and storage, Cloud native) |

## 3. The product shape (RECOMMENDATION)
Engineering Radar is a **technology-first** radar:
1. **Technologies moving** (aggregate by tag: sum of 7-day growth now versus the 28 days before, number of repositories rising, top contributing repositories), the answer to "what is rising in engineering?"
2. **Projects to watch** (domain-normalized momentum, below).
3. **Maturity-aware cards**: age band, release cadence, optional CNCF stage; so an architect can distinguish "new and accelerating" from "established and steady".
4. **Cooling and fading** list, equally prominent.
5. **Area and technology pages** instead of a flat repository grid.

It must not be: a clone with a Java tab; a star leaderboard; a list sorted by total stars.

## 4. Momentum for Engineering
**Is the AI model sufficient?** Structurally yes (velocity, relative growth, acceleration, persistence, new entrant are domain-neutral), but the **thresholds and the score half-points are not** (they encode AI-scale growth, e.g. `velocityHalfPoint`). **RECOMMENDATION:**
- Make thresholds per-domain in `config/momentum.json` (no new algorithm), or normalize velocity by the domain's population (percentile within domain over tracked repositories).
- Add relative growth (growth as a share of stars) as a first-class criterion for large established projects, since a 1% weekly gain on 50k stars is meaningful for infrastructure and invisible in absolute terms.
- Backtest before adopting: the pipeline's star state holds up to about 210 days of daily gains per repository (**FACT**: median 206 days), so thresholds can be evaluated on reconstructed past dates instead of waiting. **INFERENCE:** the engine takes an `--now` argument, so re-running it as of past dates is plausible but untested.
- Acceptance (ASSUMED): between 0.5% and 2% of Engineering repositories Rising on a typical day, at least 70% day-over-day overlap of the Rising list, and no more than 30% AI-adjacent repositories in the Engineering Rising list.

## 5. Signals: smallest high-value set
| Signal | Availability and cost | Reliability / manipulation risk | Value | Complexity | MVP? |
|---|---|---|---|---|---|
| Star velocity, acceleration (have) | Done | Moderate; stars can be bought | High | None | Yes |
| Forks, open issues (have) | Done | Low | Medium (anomaly checks) | None | Yes (anomaly use) |
| Repository age, last push (have) | Done | Low | Medium | None | Yes |
| **Latest release date and 90-day release count** | GraphQL `releases` on the existing batch query; extra cost per batch **unmeasured** | Low (hard to fake at scale) | High for engineering adoption | Low | **Yes** |
| Commits in window | Already supported in the GraphQL provider (`commitsInWindow`), cost **unmeasured** | Medium (bots) | Medium | Low | Optional |
| Contributors count/growth | REST pagination per repository, expensive | Medium | Medium | High | **No** |
| Merged PR velocity | Search API, tight limits | Low | Medium | High | **No** |
| npm weekly downloads | **Verified live**: bulk up to 128 packages per call, up to 18 months | Medium (CI, mirrors) | High for JS/TS tools | Medium (needs repository-to-package mapping) | After MVP |
| PyPI downloads | 180-day retention, IP rate limit | Medium | Medium | Medium | After MVP, only if needed |
| Docker Hub pulls | **Verified live**, cumulative count | Medium | Medium for infra images | Medium (deltas require our own daily snapshots) | After MVP |
| GitHub dependents / ecosyste.ms dependents | Not in GitHub API; ecosyste.ms API open but data licence unverified | Low | High | Medium | Spike only |
| CNCF maturity stage | `landscape.yml` fetched (1.15 MB); schema not yet inspected | Low (curated) | High for cloud native | Low | **Yes** (static join) |
| OpenSSF Scorecard | Through deps.dev (verified response) | Low | Medium (trust, not momentum) | Medium | After MVP |

## 6. "Why is it rising?": four levels
| Level | Content | Cost | Phase |
|---|---|---|---|
| **1. GitHub-derived pattern and evidence** | Classify the growth shape deterministically: *launch spike* (most lifetime stars gained in 7 days; e.g. `morluto/rea` gained 6,308 of its 6,727 stars in the last 7 days), *sustained climb* (all windows high), *breakout of an older project* (old age, sudden acceleration), *steady grower*, plus release in the last 30 days, age and rank context | None: existing fields plus the release field | **Next phase** (the current explanation lines only restate numbers) |
| 2. Package ecosystem | npm/PyPI/Docker download growth | API calls per mapped package | Engineering Radar phase 2 |
| 3. External signals | Hacker News story by repository URL (**verified live** for `vectorize-io/hindsight`), Reddit, blogs | Free but sparse; rate limit unverified | After Level 2 |
| 4. LLM narrative | Free-text explanation over the evidence above | Paid or local model, hallucination risk | Last; never used for ranking |

Level 1 is the largest quality gain per unit of effort and is the honest version of the product promise today.

## 7. Engineering Radar MVP specification
**Scope:** 8 areas from ENGINEERING-TAXONOMY.md (Backend and frameworks, Data and storage, Messaging and streaming, Cloud native and containers, Infrastructure and platform, Observability and reliability, Security and identity, Developer tools and quality) with roughly 40 launch technology tags; only tags with at least 25 repositories get a page. `java` becomes a language filter.

**Data:** existing pipeline only, plus two additive fields: latest release date and 90-day release count (GraphQL), and a CNCF maturity join from `landscape.yml` refreshed weekly. No new service.

**Ranking:** domain-normalized momentum (section 4); labels Rising, Cooling, Steady plus *New to evaluate* (age at most 12 months, sustained or accelerating). Technology-level momentum is the aggregate described in section 3, never an average of scores.

**Pages:** `/engineering/` (technologies moving, projects to watch, new to evaluate, cooling), `/engineering/{area}/`, technology tag pages as filtered views, repository detail reusing the existing page with: pattern label, release cadence, maturity badge, area/tags, signals panel.

**Filters:** area, technology tag, language, age band, maturity, learning-resource toggle (off by default).

**Cards:** name and description, area and tags, 7d and 30d growth in absolute and percent terms, release cadence ("released 9 days ago, 14 in 90 days"), age, maturity badge, one-line Level 1 explanation.

**Refresh:** same daily workflow (tiers unchanged), weekly discovery for the new queries.

**Estimated size and budget (INFERENCE, extrapolated, not measured):** about 2,000 Engineering-relevant repositories already tracked, growing to roughly 3,000 with new queries; public data about 1.0 KB per repository gives roughly +3 MB; refresh requests scale with tracked count (about 0.33 star-history requests per repository per day today, 1,139 per day for 3,471 tracked), so about 1,600 per day at 5,000 tracked, well inside the 5,000 per hour core limit; the daily run takes 2 to 11 minutes today, so expect 3 to 15; storage unchanged in structure.

**Hard prerequisite:** taxonomy v2 and per-domain momentum thresholds (see ROADMAP-NEXT-PHASES.md); building the pages before them reproduces the empty Rising list.
