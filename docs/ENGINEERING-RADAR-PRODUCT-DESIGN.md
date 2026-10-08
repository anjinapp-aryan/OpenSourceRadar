# ENGINEERING RADAR: PRODUCT, DATA AND ARCHITECTURE GAP AUDIT

Date 2026-10-08. Design only: no code, config, taxonomy, ranking, discovery, workflow, dependency or UI was changed, and nothing was committed by this audit. Evidence labels: **FACT** (measured or read today) · **INFERENCE** · **ASSUMED** · **UNKNOWN**. It builds on, and where noted corrects, `ENGINEERING-RADAR-STRATEGY.md` and `ENGINEERING-TAXONOMY.md` (both 2026-10-06). New measurements here: a 29-day replay of five normalisation rules on the 1,736 Engineering-only repositories (scratch script, state of 2026-10-07; numbers in section 8), the Engineering views of today's public data, and a fresh reuse audit.

## 1. Executive Summary

**Engineering Radar readiness: NOT READY.** The common engine (star history, tracking, patterns, lifecycle, explanations, static publishing) is reusable almost unchanged. Three things are missing, and all three are design or data problems, not UI problems:

1. **The Rising rule cannot see Engineering.** FACT: production Rising marks on average 5.1 of 1,736 Engineering repositories a day (0.29%); 14 distinct repositories in 29 days; today 2 of the 37 Rising are Engineering-only. Weekly growth p50/p99 is 3/332 for Engineering (AI: 11/2,122).
2. **There is no technology layer.** The taxonomy is 19 flat categories; `java`, `cloud` and `system-design` are not technologies, and 82 of 1,736 Engineering names look like learning resources. "Which technologies are rising" (the product's differentiator) cannot be answered.
3. **There are no release or maturity signals.** No release data is collected anywhere (the only "release" in the code is the state backup). Engineers cannot tell "new and accelerating" from "old and steady", and the New-entrant list is dominated by tiny repositories (median 67 stars; 47 of 53 under 200).

Recommended normalisation: **a hybrid of domain percentile and size-band peer percentile, each with an absolute floor, the existing acceleration test and a single-day-spike guard**. Measured on real history: 28–32 Engineering repositories a day (1.6–1.9%), 79–85% day-to-day overlap, no spike-driven members, and (for the size-band variant) the broadest category spread and a median of 7,297 stars instead of 34,000. Nothing in the AI path changes.

Order: finish 6.2.2 → **Phase 6.3 (common-engine domain normalisation + taxonomy v2 tags + release field)** → Engineering Radar MVP → ecosystem intelligence → external adoption signals. Confidence: MEDIUM-HIGH on the gap and ordering, MEDIUM on the exact thresholds (they must come out of a Phase 6.3 back-test).

## 2. Current AI Radar Capabilities We Can Reuse

### Current capability matrix

| Capability | Existing | Reusable | Needs Engineering-specific logic |
|---|---|---|---|
| Discovery (GitHub Search, topic queries) | Yes: 66 topics, 99 queries/week, 19 Engineering categories (57 queries) | Engine yes | Topic list: missing RabbitMQ, NATS, Pulsar, ClickHouse, DuckDB, MongoDB, gRPC, GraphQL, WebAssembly, eBPF, GitOps/Argo, Prometheus/Grafana, OpenTofu/Pulumi/Ansible, Helm, service mesh, serverless, Rust/Go tooling |
| Classification | Yes: deterministic scorer, 22.7% UNKNOWN | Engine yes | Taxonomy v2 tags, content-type flag, language as a facet |
| Tracking tiers (HOT/WARM/DORMANT) | Yes, thresholds in `config/tracking.json` | Mostly | WARM/HOT floors (8 and 80 stars/day) are AI-scale: Engineering repositories are tracked less often than their relative growth deserves |
| Lifecycle (ACTIVE/ORPHAN/EXCLUDED/withheld) | Yes | Yes | None |
| Star history (stargazer history, 210 days) | Yes | Yes | None |
| Momentum score and Rising/Cooling/Steady | Yes | Structure yes | Thresholds and score half-points are AI-calibrated |
| Patterns (NEW_LAUNCH, SPIKE, BREAKOUT, ACCELERATING, SUSTAINED_GROWTH, COOLING, FLAT, NORMAL_GROWTH) | Yes (Phase 6.1) | Yes | Percentile floors (100 stars/week) hide most Engineering ratio patterns: Engineering today has 1 BREAKOUT, 6 SPIKE, 11 ACCELERATING, 8 SUSTAINED of 1,736 |
| Sustained, New entrants, Biggest movers | Yes | Logic yes | Engineering movers list: 0 of 121; new entrants: 53 of 342, median 67 stars, 47 of 53 under 200 (noisy) |
| Deterministic explanations ("Why") | Yes | Yes | Add release/maturity/technology sentences |
| History, back-test, trajectory | Yes (6.2) | Yes | Enables the normalisation replay below |
| Public JSON + gate (allow-listed keys, secret scan) | Yes | Yes | New allow-listed fields only |
| Next.js static UI (home, explore, repo page, methodology) | Yes, AI-only (`isAi`, `aiRepositories`, AI category chips) | Components yes | Domain parameter on queries, new pages, technology chips; nav shows "Engineering: Coming soon" |
| Static route budget | 1,740 pages built; 4,040 deployed OK on Vercel | Yes | Engineering pages would add ~1,740 repository pages (3,480 total): inside the proven range |
| Methodology page | Yes | Yes | Domain-specific definitions |
| Releases / latest release | **No** | n/a | New |
| Technology tags / ecosystems | **No** | n/a | New |
| Maturity facet | **No** | n/a | New |

## 3. Engineering Radar User Jobs

User value first, implementation second.

| # | Question | User value | Answerable today from our data? | Needs |
|---|---|---|---|---|
| 1 | What engineering projects are trending now? | High | Not meaningfully (Rising ≈ empty) | Domain-normalised "Trending" |
| 2 | What is rising fastest? | High | Same | Normalisation |
| 3 | What is accelerating? | Medium | Partly: ACCELERATING needs ≥100 stars/week | Lower floor per domain |
| 4 | What is breaking out of its own baseline? | High (finds mature projects waking up) | Partly (1 BREAKOUT today) | Relative baseline with floors |
| 5 | What is cooling? | Medium | Misleading: `kubernetes/kubernetes` is "Cooling" at 35 stars/day | Don't label huge steady repositories as Cooling |
| 6 | What is new to Radar? | Medium | Yes, but noisy (median 67 stars) | Age + minimum evidence, learning-resource flag |
| 7 | What important repositories were recently discovered? | Medium | No: discovery date not published | `firstSeenAt` (derivable from state, see section 12) |
| 8 | Which technologies are gaining momentum? | **Highest** | No | Technology tags + aggregation |
| 9 | What changed in Java / Spring / Kafka / Kubernetes / AWS / Postgres? | High | Per category, not per technology | Tags + ecosystem view |
| 10 | Which projects had meaningful releases? | High | No | Release field |
| 11 | Which technologies/ecosystems are strengthening? | High | No | Aggregation over tags |
| 12 | Which projects deserve evaluation? | High | No (not a ranking we can defend) | Maturity + release cadence as context, not a score |
| 13 | Why is this on Radar? | High | Yes (explanations exist) | Engineering-aware sentences |
| 14 | New or established? | Medium | Age exists | Maturity band |
| 15 | Is momentum unusual for similar size/domain? | High | No | Peer percentile (section 8) |

## 4. Missing Functionality

Ranked by user value × blocking power:
1. **Domain-normalised momentum / "Trending"** (jobs 1, 2, 3, 4, 15).
2. **Technology tags and technology-level aggregation** (jobs 8, 9, 11).
3. **Release signal: latest release date, prerelease flag** (job 10; context for 12).
4. **Maturity facet and learning-resource flag** (jobs 6, 12, 14; removes 82 likely tutorials and lists from rankings).
5. **Engineering-specific discovery topics** (the pool must contain the technologies in job 9).
6. Smaller: Cooling semantics for large steady repositories, New-entrant minimum-evidence floor, `firstSeenAt`.

## 5. Engineering Radar Information Architecture

Improved from the proposal, based on evidence: lead with technologies (the differentiator), keep repositories second, and put Latest after because its definition is the weakest.

```
ENGINEERING RADAR  (/engineering/)
 1. TECHNOLOGIES MOVING       aggregate per technology tag: repos tracked, repos trending, 7d / 28d-prior change, top 3 repos
 2. TRENDING NOW              repositories in the top peer percentile this week (with "top 2% of Engineering" / "top 3% of its size band")
 3. RISING  |  ACCELERATING  |  BREAKOUT  |  SUSTAINED     one section with a segmented control, not four pages
 4. NEW TO EVALUATE           age <= 12 months, minimum evidence, learning resources excluded
 5. COOLING                   only repositories whose recent growth fell materially below their own baseline
 6. LATEST                    see section 9: new discoveries, meaningful releases, recently accelerating
 AREA pages    /engineering/<area>/            9 areas
 TECHNOLOGY    /engineering/t/<tag>/           only tags with >= 25 repositories
 ECOSYSTEMS    Phase 2 of the product (section 11)
 METHODOLOGY   Engineering definitions + limits
```
Dropped from the proposed list: a separate "Biggest Movers" section (0 of 121 movers are Engineering; velocity change on tiny numbers is noise: fold it into Accelerating) and a separate "Sustained" top-level block (16 sustained Engineering repositories today, mostly very large; show as a pattern filter).

## 6. Engineering Taxonomy

Keep the model already proposed in `ENGINEERING-TAXONOMY.md`: **Domain → Area (9) → Technology tag**, plus facets (language, content type, maturity, age band). Audit changes from that document, based on today's data:

| Item | Today (FACT) | Position |
|---|---|---|
| `java`: 306 repos (language, not technology) | Largest category, median 1 star/week of growth | Language facet + `jvm` tag, as proposed |
| `spring-boot` 127, `kafka` 68, `microservices` 97 | Tiny growth (p99 54, 44, 88) | Tags; Kafka stays a tag under Messaging |
| `databases` 187, `postgresql` 138, `redis` 72 | p99 690 / 299 / **1,432** (Redis includes AI-adjacent vector/AI-cache projects) | Tags under Data and storage; verify Redis outliers for AI crossover |
| `system-design` 42 | 42% learning-like | Content-type flag, not a technology |
| `cloud` 104, `distributed-systems` 60 | Generic | Concept tags, not pages |
| Areas | 9 proposed | Make Languages and runtimes **not** an area: use the facet (avoids double navigation) |

Add the discovery topics listed in section 2, but only where a technology tag will exist for them (otherwise they feed the UNKNOWN pool). Acceptance for taxonomy v2 stays as written there (UNKNOWN ≤ 10%, precision ≥ 90% on a hand-labelled sample; the labels must come from a human, not from this tooling).

## 7. Trending vs Rising vs Breakout vs Accelerating vs Cooling

The trouble with six overlapping labels is that they answer different questions. Proposal: **one measure, one label per question, nested not parallel.**

| Term | Question it answers | Definition (deterministic) | Kind |
|---|---|---|---|
| **TRENDING** | "Unusually fast compared with its peers?" | Percentile rank of 7-day growth within the domain and within the repository's size band; Trending = top 2% of the domain **or** top 3% of its size band, and passes the shared guards below | A rank, shown as "top 2% of Engineering this week" |
| **RISING** | "Is this a strong, non-fading riser?" | Trending **and** the existing durability tests (acceleration ratio ≥ 0.6, 30-day velocity floor) | The headline label; RISING ⊂ TRENDING |
| **ACCELERATING** | "Is growth increasing?" | Existing pattern: 7-day velocity vs the prior 28-day velocity, with a floor | Pattern |
| **BREAKOUT** | "Far above its own history?" | Existing pattern (ratio against own baseline) with a floor; must hold 2 consecutive days to display (Phase 6.2 finding: median run is 1 day) | Pattern |
| **SUSTAINED** | "Does it persist?" | Existing: growth in at least 2 comparable windows | Pattern/flag |
| **COOLING** | "Has it clearly slowed relative to itself?" | Existing acceleration test **plus** a guard: not shown for repositories whose 30-day velocity is under the domain's Trending floor (so `kubernetes` at 35 stars/day is Steady, not Cooling) | Trend |

Shared guards: absolute floor (below, so a 3-star week cannot be top 2%), single-day-spike guard (not Trending if more than 60% of the week came from one day), minimum history, and no labels on learning resources.

```
                         Tracked repositories (domain population)
                                   │
                    weekly growth percentile (domain / size band)
                                   │
               ┌───────────────────┴──────────────────┐
         not top 2% / 3%                          TRENDING
         (STEADY or COOLING                           │
          by its own baseline)           durability: acceleration ≥ 0.6,
                                         30-day floor, not a one-day spike
                                                      │
                                   ┌──────────────────┴─────────────┐
                                 fails                           RISING
                          (TRENDING only,                           │
                           shown as "spike" / "fading")     patterns annotate RISING:
                                                          NEW_LAUNCH · ACCELERATING ·
                                                          BREAKOUT · SUSTAINED_GROWTH
```
AI keeps its current absolute definition (Rising stays byte-identical for AI): the percentile logic is a domain parameter, so the AI configuration continues to select the same repositories.

## 8. Engineering Momentum Normalization

### Measured (FACT). 29-day replay, 1,736 Engineering-only repositories, production growth code, 2026-09-05 to 2026-10-03
Method limits: classification and star counts are today's, the 210-day history is the window; labels are replayed, not published.

| Rule | Mean set / day (% of domain) | Day-to-day overlap | Distinct repos in 29 days | Median members' stars | Share under 5k stars | Spike-dominated | Top category share |
|---|---:|---:|---:|---:|---:|---:|---:|
| P production (AI thresholds) | 5.1 (0.29%) | 0.80 | 14 | 33,365 | 10.9% | 1.4% | databases 20% |
| A domain percentile (top 2%, floor 50 stars, accel ≥ 0.6) | 28.1 (1.62%) | 0.85 | 67 | 34,765 | 11.2% | 2.3% | security 22% |
| B domain thresholds (AI gates × 0.148) | 54.8 (3.15%) | 0.88 | 107 | 33,894 | 10.2% | 1.9% | security 22% |
| D relative (≥ 3% in 7 days, floor 50) | 23.4 (1.35%) | 0.80 | 75 | 1,507 | 78.3% | 8.6% | security 23% |
| G size-band percentile (top 3% of band, floor 30, spike ≤ 60%) | 28.7 (1.65%) | 0.79 | 83 | 7,297 | 34.5% | 0% | databases 13% |
| F hybrid (A or D, accel ≥ 0.6, spike ≤ 60%) | 32.4 (1.87%) | 0.84 | 84 | 31,686 | 24.1% | 0% | security 21% |

The acceptance range in the strategy document (0.5–2% of the domain Rising, ≥ 70% day-to-day overlap) is met by A, D, G and F; P fails on size, B fails on size (3.15%).

### Comparison of the alternatives
| | Advantages | Disadvantages | Explainability | Stability | Sensitivity | Complexity | False-positive risk | Risk of hiding real momentum |
|---|---|---|---|---|---|---|---|---|
| A percentile (domain) | Simple, self-calibrating, "top 2% of Engineering" | Still favours already-large repositories (median 34,765) | High | 0.85 | Moves with the population | Low | Low | Hides small risers |
| B domain thresholds | Reuses config, no new concept | A frozen scale ratio (0.148) ages as the population drifts; 3.15% of the domain is too many | High | 0.88 | Low | Lowest | Medium (set too large) | Hides small risers |
| C category thresholds | Fine-grained | Categories are small (median ~130 repos): p99 of 100 repositories is one repository, so unstable; and categories are being replaced by tags | Medium | Poor (not simulated; sample-size argument) | High | Medium | High | Medium |
| D size-relative growth | Surfaces small repositories (78% under 5k) | 8.6% spike-driven, lowest episode length (5 days); tiny denominators | High | 0.80 | High | Low | **Highest** | Low |
| E maturity-adjusted | Fair across life stages | Needs a maturity model we do not have; not simulated | Medium | UNKNOWN | UNKNOWN | High | Medium | Medium |
| G size-band percentile | Answers "unusual for similar projects"; broadest category spread (top 13%); median 7,297 stars | Lowest overlap (0.79) and episode length 4 days: band boundaries create churn | High if phrased as peers | 0.79 | Medium | Low-medium | Low (no spike members) | Low |
| **F hybrid** | Combines coverage of both ends; no spike-driven members | More moving parts to explain | Medium-high ("top 2% of Engineering, or top 3% of its size band") | 0.84 for A∪D; G alone 0.79 | Medium | Medium | Low | Lowest |

### Recommendation: ONE approach: **F, hybrid of domain percentile and size-band peer percentile, with absolute floors, the existing acceleration test and the single-day-spike guard.**
Choose the final composition (A ∪ G with D as a diagnostic, not a gate) by a **Phase 6.3 back-test against the acceptance criteria in section 18**: A ∪ G itself was not simulated here (UNKNOWN). Reasons: A alone selects the same large repositories as production; D alone is where noise lives; G adds the small and mid-size repositories the product claims to serve; the guards reuse the production acceleration condition and a spike test already validated in 6.1/6.2. Implementation is a **domain adapter on the common engine**: AI keeps its absolute thresholds (zero change to AI output, testable byte for byte); Engineering supplies percentile parameters. Do not implement it before the discovery pool is final (6.2.2): percentiles over a pool biased to large repositories inherit the bias.

## 9. Latest / Releases / Activity

**"Latest" must not mean "latest GitHub updates."** Definition: *a repository qualifies for Latest when something meaningful and verifiable has changed that an engineer would act on*, and each entry states which:
| Entry type | Qualifies when | Source |
|---|---|---|
| New to Radar | first seen on Radar within 14 days, passes minimum evidence (age ≤ 12 months, ≥ 100 stars or Trending), not a learning resource | `firstSeenAt` (derived from state) |
| Meaningful release | non-prerelease published within 30 days **and** repository is Trending/Rising, or has > 5,000 stars and is in a tracked technology | GraphQL `latestRelease` |
| Newly accelerating | pattern changed to ACCELERATING/BREAKOUT within 7 days (2 consecutive days) | existing history |
| Emerging technology | a technology tag newly crosses the page threshold (25 repos) or its repos-trending count at least doubles in 28 days | tag aggregation |
Excluded from Latest: pushes, commits, issue activity (they say a repository is busy, not important).

### Signals
| Signal | Class | Note |
|---|---|---|
| Star growth (7/30/90 d, acceleration) | **CORE MVP, primary momentum** | unchanged rule: stars are the only momentum input |
| Latest release date, prerelease flag | **CORE MVP (context only)** | one nested GraphQL object on the existing batch query; added cost UNKNOWN, expected small (no new connection) |
| Releases in 90 days | OPTIONAL | needs `releases(first:N)`; measure the cost before adopting |
| Last push (have) | CORE MVP (already in data) | activity flag |
| Commits in window | OPTIONAL | provider already supports `commitsInWindow`; bots inflate; no ranking use |
| Repository language (have) | CORE MVP (facet) | |
| Repository age (have) | CORE MVP (maturity) | |
| Contributors | FUTURE | per-repository REST pagination is expensive |
| Issues / PRs (open issues have) | OPTIONAL as anomaly check; merged-PR velocity FUTURE | Search API limits |
| Forks (have) | OPTIONAL | anomaly check on star spikes |
Rule kept: none of these enter the momentum score initially; release and activity appear as labelled context, never as a number blended into rank. Reconsider only if a back-test shows a context signal improves agreement with an independent source.

## 10. Maturity

**Useful, but only as an honest age band, not a quality score.** FACT (1,736 Engineering repositories): Emerging (< 1 year) 163 · Growing (1–3 years) 135 · Established (3–8 years) 662 · Mature (> 8 years) 776. Age is the one input that is always available, objective and explainable ("created 11 years ago"). Proposal:
- **Band = age only**, named `ageBand`: Emerging / Growing / Established / Mature.
- **Context lines beside it, not inside it:** history length ("measured over 210 days"), last release date (when available), last push.
- **Rejected inputs for the band:** star count (popularity, not maturity), contributor count (not collected), a combined "quality" number (cannot be justified).
- Maturity must carry a limit note: "age is not stability".
Use: filters (Emerging + Trending = "New to evaluate"), and to decide whether Cooling is shown (Cooling is suppressed for Mature repositories below the domain Trending floor).

## 11. Ecosystem Intelligence

Support later (Phase 2 of the product), after tags exist. An ecosystem is a **named set of technology tags** (Kafka = kafka, strimzi, ksqldb; Spring = spring, spring-boot, spring-cloud; Kubernetes = kubernetes, helm, operators). Per ecosystem, from the same data: repositories tracked, count Trending/Rising/Accelerating/Sustained/Cooling, 7-day and 28-day-prior aggregate growth (sum of per-repository gains, never an average of scores), top 5 repositories, and the share contributed by the top repository (so one outlier cannot masquerade as an ecosystem). Definition lists are curated config (aliases reuse GitHub `explore` topics and the CNCF landscape). Not for the MVP: without tags the aggregation is not honest, and ecosystem membership is a curation burden.

## 12. Data Model

The existing records suffice for the MVP except for the following **genuinely missing** fields; nothing else is justified.
| Field | Where | Why | Kind |
|---|---|---|---|
| `latestRelease.publishedAt`, `.tag`, `.isPrerelease` | snapshot (GraphQL) and public record | Latest; context | Measured |
| `technologies: string[]` | classification output and public record | Tech layer | Derived (curated tags) |
| `area: string[]` | derived from technologies | Navigation | Derived |
| `contentType: 'software' \| 'learning' \| 'list'` | classification | Removes 82+ tutorials/lists from rankings | Derived |
| `ageBand` | public record | Maturity | Derived from `ageDays` |
| `percentile` per domain and size band (7-day growth) | momentum output | Trending explanation | Derived |
| `firstSeenAt` | lifecycle/state | New to Radar | Measured by us |
| `cncfStage` (optional, static join) | public record | cloud-native maturity | Measured elsewhere |
Not added: contributors, downloads, dependents, stargazer quality, release count (until its cost is measured). Public JSON size: about +80–120 bytes per record for the tag/band fields (INFERENCE), fine against the 8 MB warning line (radar.json is 3.7 MB today).
Measured / derived / interpretation separation on the repository page: measured (stars, growth, release date, age), derived (percentile, pattern, tags, ageBand), interpretation (one deterministic sentence, e.g. "top 3% of repositories with 1,000–10,000 stars this week; first seen 6 days ago").

## 13. Pipeline Architecture

```
GitHub ─► Discovery (domain config: topics per domain)
       ─► Classification (taxonomy v2: tags, area, contentType)
       ─► Tracking (tier thresholds per domain)
       ─► Star history (unchanged)
       ─► Domain normalisation (adapter: percentiles per domain and size band; AI = identity)
       ─► Momentum + patterns (common engine, unchanged algorithm)
       ─► Public JSON (adds fields; domain lists)
       ─► Next.js static pages (/engineering/…)
       ─► Vercel (Git integration)
```
**Common engine + domain adapter.** The adapter holds only parameters and the percentile step; no duplicated pipeline. Everything after "Star history" already runs for both domains. The same daily workflow and the same dated state backups apply. Budget (INFERENCE): about 1,125 history requests a day today; Engineering is already in the 3,471 tracked, so the MVP adds only the release field (no extra requests if it rides on the existing batch query) and the new discovery topics (+ ~100–250 searches/week).

## 14. Reuse Audit

Searched 2026-10-08. Activity could not be confirmed for every row (anonymous API quota was exhausted by the discovery experiment); stars are from repository pages.

| Project | URL | License | Stars | Activity | Capability | Verdict | Reason |
|---|---|---|---:|---|---|---|---|
| zalando/tech-radar | https://github.com/zalando/tech-radar | MIT | 1.9k | not verified | d3 technology-radar visualisation (quadrants, rings) | REFERENCE | A ring/quadrant radar is a hand-curated "adopt/trial/hold", not data-driven momentum; use only for visual vocabulary |
| thoughtworks/build-your-own-radar | https://github.com/thoughtworks/build-your-own-radar | AGPL-3.0 | 2.6k | not verified | Radar generator from a sheet | REJECT | AGPL, and a manual-curation model |
| AOEpeople/aoe_technology_radar | https://github.com/AOEpeople/aoe_technology_radar | MIT | 414 | not verified | Static-site tech radar with item history | REFERENCE | Static, MIT, but editorial |
| cncf/landscape2 | https://github.com/cncf/landscape2 | Apache-2.0 | 365 | not verified | Generates landscape sites from `landscape.yml` | COMPOSE (data), REFERENCE (site) | Take the landscape **data** (maturity stage, categories) as a static join; do not adopt the site generator |
| cncf/landscape (data) | https://github.com/cncf/landscape | Apache-2.0 (per ENGINEERING-TAXONOMY.md) | n/a | active (CNCF-run) | Curated cloud-native project list with stages | ADAPT (as seeds) | Already selected as a seed for the cloud-native area |
| pingcap/ossinsight | https://github.com/pingcap/ossinsight | Apache-2.0 | 2,505 | pushed 2026-09-08 (API) | Trends, collections, per-repository analytics on GH Archive | REFERENCE | Closest product; needs TiDB plus an LLM feature; use its collection names as a cross-check only |
| ossf/scorecard | https://github.com/ossf/scorecard | Apache-2.0 | 5,742 | pushed 2026-10-06 (API) | Repository security/health checks | REFERENCE (Phase 2 context) | Trust context, not momentum |
| github/explore | https://github.com/github/explore | CC-BY-4.0 (per ENGINEERING-TAXONOMY.md) | n/a | active | Topic aliases and descriptions | REUSE (already used) | Seeds for tag aliases |
| deps.dev API | https://deps.dev | data CC-BY 4.0 (per ENGINEERING-RADAR-STRATEGY.md, response verified there) | n/a | Google-run | Dependents, versions, Scorecard | Phase 2 | Best single adoption source across ecosystems |
| ecosyste.ms | https://ecosyste.ms | repos service is AGPL-3.0 (API); data licence unverified | 75 (repos) | active | Packages, dependents | REFERENCE / spike | Check data licence before any use |
| GrimoireLab / Augur / Libraries.io | (see 6.2.1 review) | GPL-3.0 / archived / AGPL | n/a | n/a | Community analytics | REJECT | Copyleft or archived |
| OSS Insight collections | https://ossinsight.io | n/a | n/a | active | Curated technology collections | REFERENCE | Names for tag candidates |
| Existing in repo: charts, filters, cards, search | `components/`, `lib/query.ts` | own | n/a | n/a | Trajectory chart, Explorer filters | REUSE | Parameterise by domain; no new library |
**Verdict:** nothing replaces the pipeline or the technology radar's data; the cloud-native data and topic aliases are reusable as static inputs. No new dependency is needed for the MVP.

## 15. MVP Scope

Smallest useful Engineering Radar. It must answer: trending, rising, new, accelerating, cooling, technologies involved, why it is on Radar.

**MUST HAVE**
- Domain normalisation adapter (F) with floors and guards; AI byte-identical (regression test).
- Taxonomy v2 **tags** for roughly 40 technologies (≥ 25 repositories each) + `contentType` flag (learning resources excluded from lists by default) + `ageBand`.
- Release field (latest release date, prerelease flag).
- Engineering discovery topics added (shadow-measured first, as in 6.2.2).
- `/engineering/` page: Technologies moving, Trending now, Rising/Accelerating/Breakout segmented, New to evaluate, Cooling (with the Cooling guard).
- Repository page with measured/derived/interpretation separation and Engineering-aware "why".
- Methodology section for the Engineering definitions and limits.

**SHOULD HAVE**
- Area pages; technology pages for tags with ≥ 25 repositories; Latest section (new discoveries, meaningful releases).
- CNCF stage join for the cloud-native area.
- `firstSeenAt`.

**LATER**
- Ecosystem pages (section 11); technology comparison; release count in 90 days; commits; adoption signals; Scorecard.

**DO NOT BUILD**
- A numeric "quality" or "adoption" score; blended release/activity scoring; per-category thresholds; pattern/architecture-topic pages (tutorial-dominated); LLM narratives; contributor graphs; a separate Engineering pipeline.

## 16. Future Scope

External adoption (section 17 table), ecosystem intelligence, comparisons, Scorecard trust context, GH Archive as an independent recall check, user-defined watchlists.

### External adoption signals
| Signal | Decision | Reason |
|---|---|---|
| npm downloads | **Phase 2** | Bulk API verified (strategy doc), needs repository-to-package mapping |
| PyPI downloads | Future | 180-day retention, rate limits |
| Maven Central | Future | Search-only, no download counts |
| Docker pulls | Phase 2 (selected infrastructure images) | Cumulative only; needs our own daily snapshots |
| Dependents (deps.dev / ecosyste.ms) | Phase 2 spike | Highest value across ecosystems; check licence and terms |
| CNCF stage | **MVP/Should** (static join) | Curated, cheap |
| Hacker News / Reddit | Future | Sparse, rate limits, anecdotal |
| GitHub Archive | Future (recall check) | Needs BigQuery |
| Reject | Social follower counts, scraped trending pages | Terms and quality |

## 17. Explicitly Rejected Features

Copying AI Radar with a different category list (empty Rising page); a separate pipeline per domain; per-category thresholds (sample size); a combined quality/adoption score; pushes/commits as "Latest"; labelling large steady repositories "Cooling"; star count as maturity; LLM categorisation or narratives; scraping GitHub Trending; adopting AGPL or GPL radar tooling.

## 18. Engineering Radar Success Criteria (measurable, derived from section 8 and the existing acceptance ranges)

- Between 0.5% and 2% of Engineering repositories carry the Rising/Trending label on a typical day; ≥ 70% day-to-day overlap; ≤ 5% of members spike-driven.
- Median members' stars shown for transparency; ≥ 25% of Trending members under 5,000 stars (G/F achieve 24–35% today).
- AI Radar output identical to the committed output for the same input (byte-identical test).
- UNKNOWN ≤ 10% of candidates (taxonomy v2) and ≥ 90% precision on a human-labelled sample of 200 Engineering repositories (the labeller must not be the build tooling).
- ≥ 40 technology tags each with ≥ 25 repositories; ≤ 15% of repositories with 3+ areas.
- Learning-resource flag recall ≥ 90% on 50 known tutorials/lists.
- Public data size ≤ +1 MB; pages ≤ 3,500; build ≤ 2 minutes; history requests ≤ 2,500/day.
- Release field present for ≥ 80% of tracked repositories that have releases, with no additional rate-limit failures.

## 19. Implementation Roadmap

1. **Phase 6.2.2** (finish): decide the discovery strategy with real-history evidence; add Engineering topics to the shadow run.
2. **Phase 6.3**: common-engine domain adapter + back-test (compose A ∪ G, tune floors against section 18); taxonomy v2 tags + contentType + ageBand; release field spike (measure GraphQL cost); a human gold set (200 + 200).
3. **Engineering Radar MVP**: section 15 MUST/SHOULD.
4. **Engineering ecosystem intelligence**: section 11.
5. **External adoption signals**: npm, Docker, dependents (deps.dev) after a licence/terms check.
Each step ships behind the existing gate and leaves AI output unchanged.

## 20. Architecture Decision Record

**What we missed in the roadmap (audit):** Latest/Releases (no collection at all), activity as context, technology and ecosystem views, engineering normalisation (identified in 6.1 but still unbuilt), maturity (age band), technology comparisons, engineering-specific explanations, small/mid-size discovery (6.2.2), domain-specific thresholds, and **Engineering-specific discovery queries** (19 categories only; at least a dozen important technologies have no topic).

**Decision:** Engineering Radar is a technology-first radar built on the common engine with a domain adapter; momentum stays star-growth-only with percentile-based, floor-guarded normalisation; releases and age are context; external adoption comes later.

**Consequences:** AI stays unchanged; Engineering depends on the discovery pool (6.2.2), on tags (6.3) and on a human gold set; thresholds are tuned by back-test, not asserted.

**Limits of this audit:** the replay uses today's classification and star counts; A ∪ G was not simulated; the release cost is unmeasured; activity of several external projects was not verified (API quota); the Phase 6.2.2 star-history sample was still running when this was written.
