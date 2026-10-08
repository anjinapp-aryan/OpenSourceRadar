# STRATEGIC AUDIT (pre-Phase 7)

Date 2026-10-06. Auditor stance: critical, not promotional. Evidence labels: **FACT** (measured or read in this audit) · **OBSERVATION** · **INFERENCE** · **RECOMMENDATION**. Companion documents: COMPETITIVE-AUDIT.md, ENGINEERING-RADAR-STRATEGY.md, ENGINEERING-TAXONOMY.md, ROADMAP-NEXT-PHASES.md. No code, data, workflow or configuration was changed.

## Evidence base
- Repository at `7b7e36e`+12 bot data commits (HEAD of `origin/main` = `ea1aa69`, 2026-10-06), 7,470 lines of TypeScript in `src/ app/ lib/ components/ scripts/`, 18 test files, 38 documents (before this audit).
- Current public dataset (`radar.json`, generated 2026-10-06T11:24Z) and the pipeline **state asset** (`data-state` release, downloaded to a scratch folder), so internal datasets are current, not the stale snapshot in Git.
- GitHub Actions run history (14 runs), live competitor APIs and pages (see COMPETITIVE-AUDIT.md). Limits: the unauthenticated GitHub API was nearly exhausted; some competitors were not researched (listed there).

## Executive summary
1. **The machine works.** 12 of 12 scheduled daily runs since 2026-09-27 succeeded (2 to 11 minutes each), data refreshes automatically, production serves it, cost is $0. **FACT.**
2. **The product promise is only half delivered.** "What is rising" is delivered; "and why" is not: the explanation text for the top Rising repository reads "Gained 716 stars in 7 days and 5,297 in 30 days. Meets the Rising criteria." That restates inputs, it does not explain. **FACT / INFERENCE.**
3. **Engineering Radar cannot be a copy of AI Radar.** Engineering-only repositories have a 99th-percentile weekly growth of 285 stars against 1,928 for AI-only; the Rising rule yields 2 of 1,736 (0.1%) versus 31 of 1,482 (2.1%). A Java/Spring engineer opening the site today sees **zero** Rising repositories in `java` (0 of 330) or `spring-boot` (0 of 133). **FACT.**
4. **The dataset has quality holes that would be inherited by Engineering Radar:** 22.7% of candidates classified UNKNOWN (incl. `browser-use`, `puppeteer`, `uptime-kuma`, `storybook`, `opencv`); 486 public records (12%) are never refreshed and are 7 to 11 days stale; some Rising entries carry spike or manipulation signatures. **FACT.**
5. **The best unexploited asset is history.** Each repository already holds up to about 210 days of daily star gains in pipeline state (median 206), yet the site shows no trajectory at all, and the daily Git commits are a free snapshot archive. **FACT.**
6. **Architecture is sound until roughly 6,000 repositories**, then Git history growth and per-repository static pages become the constraint, long before a database is justified. **INFERENCE with measurements.**
7. **Single biggest external risk:** the product depends on one new GitHub endpoint (star history, introduced 2026-09-04) whose availability level and rate limits are not stated in its changelog, after GitHub restricted stargazer access (2026-06-30) and OSS Insight's event-based rankings went dark (2026-03-01). **FACT.**
8. **Recommended sequence:** harden and add history (6.1, 6.2), build the deterministic "why" Level 1, fix taxonomy and per-domain momentum, **then** build Engineering Radar as technology-first. Do not build chat, accounts, a database or an LLM narrative yet.

## 1. Current-state assessment
| Area | State | Evidence |
|---|---|---|
| Collection | GraphQL batches (50), star-history endpoint, search discovery weekly; typed errors, retry, batch splitting; due-based refresh (about 1,139 requests per day for 3,471 tracked) | state tracked summary, run history |
| Classification | Deterministic rules, 33 categories, classifier `phase3-v1`; UNKNOWN 22.7% | state classified summary |
| Tracking | HOT 241 / WARM 2,292 / DORMANT 938, 0 unassessed, 101 due now | state tracked summary |
| Momentum | v1 deterministic; today 39 Rising, 234 Cooling, 3,684 Steady across 3,957 records | public dataset |
| Public contract | `schemaVersion 1`, 4.06 MB (about 1.03 KB per repository), no history, no search index | file size, schema |
| UI | Home, Explore (URL state), repository, methodology; premium dark; no search, no compare, no trajectory, no digest, no feed | code |
| Automation | Daily + Monday-discovery cron, concurrency, quality gate, atomic publish, state in release asset, smoke test | workflow, 12/12 runs |
| Documentation | 38 docs, **no README at the repository root** | directory listing |

Observed operational facts worth correcting in the docs: scheduled runs configured for 04:17 UTC (03:47 Monday) actually started between **09:52 and 11:30 UTC**, i.e. 5.5 to 7 hours late (GitHub scheduling delay). On Mondays both crons fire, so two near-identical runs and two data commits happen (2026-09-28 and 2026-10-05). The rollback copy `state-prev.tar.gz` is overwritten on every run, so state rollback depth is **one day**.

## 2. Product audit
1. **What it is today:** a daily-refreshed, deterministic leaderboard of GitHub star momentum for AI repositories, with transparent rules. Engineering is a placeholder.
2. **Strongest capability:** growth *shape* (acceleration, persistence, new entrant, cooling), transparent and reproducible, with zero-cost automation. Trending cannot tell "accelerating" from "peaked".
3. **Weak:** the "why" (restated numbers); no history; AI-only; classification gaps; Movers is dominated by decline (20 up versus 103 down on 2026-09-26, a Phase 4 known imperfection); Rising favours young, viral repositories, which is the intended behaviour but includes spikes.
4. **Missing:** trajectory charts, "what changed since yesterday", search, comparison, shareable artifacts, technology-level view, release/adoption evidence, maturity context, README.
5. **Confusing:** the tiles "Tracked" versus "Measured" versus "AI repositories" (operational terms leaking into the product), "Cooling" listing famous large repositories without saying it is about growth rate, and the home page's Rising count differing from the dataset's (scope is AI only).
6. **Unnecessary (for users):** tracking tiers and hysteresis surfaced as "Tracking tier" on repository pages; the Phase 4 `tier` field in the public file; the animated radar (identity, but zero information).
7. **Impressive but low user value:** GraphQL batch splitting, hysteresis, the quality gate's regression table, the state-asset architecture. They are why the product is reliable, but no visitor sees them.
8. **Valuable but underdeveloped:** 210-day daily star gains per repository (unexposed), the 33-category taxonomy, the Movers concept.
9. **Architect, daily:** "technologies moving" and "what is new to evaluate, with maturity context", plus a diff since yesterday. Not available yet.
10. **AI engineer, daily:** new agent/MCP/inference/memory projects labelled by growth pattern (launch spike versus sustained climb), with early-stage filtering. Partly available (AI Radar), missing pattern labels and several AI categories.
11. **Java/Spring engineer, weekly:** Spring, Quarkus, JVM tooling and data/infra projects moving. **Not available**: 0 Rising in `java` and `spring-boot`.
12. **CTO / engineering leader:** monthly technology-level trends, lifecycle (emerging, mainstream, fading), maturity badges. Not available.
13. **What gets shared:** a repository trajectory or comparison image ("+6,300 stars in a week, accelerating 7x"). Not available.

## 3. AI Radar gap analysis (priority: P0 critical, P1 high, P2 useful, P3 nice)
| P | Gap | Evidence | Fix direction |
|---|---|---|---|
| **P0** | "Why" is a restatement | `summary` strings in public data | Deterministic growth-pattern label plus evidence (Level 1, see ENGINEERING-RADAR-STRATEGY.md section 6) |
| **P0** | Spike/manipulation signatures in Rising | `morluto/rea`: 6,308 of 6,727 lifetime stars gained in 7 days (94%); `DietrichGebert/ponytail`: 156,374 stars in 116 days, 3 open issues, forks-per-star 0.054 versus population p10 0.056 | Anomaly flags from existing fields (spike share, forks per star, issues per star), shown, not hidden |
| **P0** | Classification false negatives | 1,018 UNKNOWN; `browser-use` (AI agents) is UNKNOWN | Review UNKNOWN by stars and growth; add rules |
| **P0** | 486 untracked records in the public file with data 7 to 11 days old | state and public data comparison | Purge orphans (351 have no candidate record) and stop publishing untracked records, or track them |
| P1 | No trajectory | repository page has windows only; daily gains exist in state | Weekly sparkline in the public file |
| P1 | No "what changed" | none | Previous-snapshot diff page |
| P1 | AI categories lag the field | OSS Insight collection names (see taxonomy doc) | Tag-first additions: inference engines, vector databases, agent memory, evaluation/observability, fine-tuning |
| P1 | Educational content in categories | `machine-learning` 30% list/tutorial-like (heuristic) | `contentType` flag independent of category |
| P1 | No search | UI | Client-side search over the Explore payload (no API) |
| P1 | No root README | filesystem | Write one |
| P2 | Compare view, Atom feed/weekly digest, category-level trend, share images, duplicate/mirror detection | none | See roadmap |
| P2 | Duplicate scheduled runs on Mondays | run history | Skip daily job when discovery job ran |
| P3 | HN evidence, package downloads for AI libraries | verified APIs | After Level 1 |

## 4. Data architecture scaling (INFERENCE from measurements)
Measured: public file 4,060,747 bytes for 3,957 records (about 1,026 bytes per record); `.git` grew from 24 MB (2026-09-26) to 34 MB (2026-10-06) over 12 data commits, about **0.83 MB per daily commit**; static export 94 MB for 1,692 pages (about 56 KB per repository page) at the last measurement; Explore page 238 KB gzip at 1,685 AI repositories; run time 2 to 11 minutes; core refresh load about 0.33 requests per tracked repository per day.

| Records | Public file | Git growth per year (1 commit/day) | Static page output if every record had a page (today only the 1,735 AI repositories do, about 97 MB) | Daily star-history requests | Verdict |
|---|---|---|---|---|---|
| 3,957 (now) | 4 MB | about 300 MB | about 220 MB | about 1,100-1,300 | fine |
| 10,000 | 10 MB (above the 8 MB warning level) | about 760 MB | about 560 MB | about 3,300 | Git history and page output need action |
| 50,000 | 51 MB (above the 25 MB fail limit, reached near 24,000 records) | about 3.8 GB | about 2.8 GB | about 16,500 | needs a different data path, sharding and top-N pages |
| 100,000 | 103 MB | about 7.6 GB | about 5.6 GB | about 33,000 (several hours of one token's hourly budget, run time near the 6-hour job limit, **UNKNOWN**) | warehouse territory |

Also: discovery uses the Search API with a 1,000-result cap per query, so reaching tens of thousands of repositories needs new discovery strategies, not just more compute. Vercel deployment size and file-count limits for 10,000+ static pages were **not verified**; check before crossing 5,000 pages.

**Evolution triggers (RECOMMENDATION):**
1. At about **6,000 records or `.git` above 400 MB**: stop committing the full public JSON daily. Keep the pipeline state in release assets (already so), publish the public dataset as a release asset or object-store file read at build time, and use a small committed marker (or a deploy hook) to trigger Vercel.
2. At about **5,000 repository pages**: render detail pages for the top N by momentum/stars only (for example 3,000), serve the rest from sharded JSON on demand, or drop static pages for low-signal repositories.
3. **DuckDB** (MIT, active) in the Actions job, not at runtime, when per-repository history queries (category trends over 90+ days) outgrow plain JSON.
4. **A server database (PostgreSQL etc.) only if** user-generated state appears (accounts, saved views) or you need multi-writer updates. Neither is on the roadmap; the current JSON + Git + Vercel model is the right choice for years of this product's likely size.

## 5. Historical intelligence (minimum viable model)
- **Already available:** `dailyGains` up to 210 days per repository (FACT; `complete` is false for 76% only because the endpoint window is capped at 30 weeks), daily commits of `radar.json` (12 snapshots so far).
- **Add:** (a) `sparkline90` (13 weekly sums, about 220 KB for all records) in the public file; (b) a **compact daily snapshot** per run (`id, stars, score, trend, growth7d, tier`, about 180 KB raw, about 50 KB gzip per day, about 18 MB per year) appended to a release asset, which enables "what changed", Rising entry/exit, rank change, momentum score history and category trends; (c) **backfill** past dates by re-running the momentum engine with `--now` on stored daily gains (**INFERENCE**, untested; verify before relying on it).
- **Do not store** raw GitHub responses, per-run copies of full internal datasets, or Git-committed history files.
- Outputs: trajectory chart, "what changed since yesterday/last week", weekly digest page and static Atom feed, category momentum history, technology lifecycle (emerging, mainstream, cooling) after 90 days of snapshots.

## 6. Personas
| Persona | Wants | Landing | Return hook |
|---|---|---|---|
| Senior engineer | Credible tools to try this month | Rising with pattern labels | Weekly "what changed" |
| Architect | Technologies moving, maturity, risk | Engineering technologies moving (future) | New to evaluate + maturity badge |
| AI engineer | Emerging agent/inference/memory tools | AI Radar category pages | Daily diff, launch-spike versus sustained label |
| Platform / DevOps engineer | Infra tooling momentum | Cloud native, Infrastructure areas (future) | Release cadence and cooling alerts via feed |
| Engineering manager | Whether a tool is safe to adopt | Repository page with maturity, anomaly flags | Digest |
| CTO | Technology lifecycle | Monthly technology report | Monthly digest |
| Developer advocate | Where attention is moving, shareable proof | Trajectory and comparison images | Share artifacts |
| Interviewer / candidate | Credible current knowledge | Methodology + weekly digest | Digest |

## 7. Daily / weekly / monthly experience (design target)
Daily: a "Since yesterday" strip (entered Rising, left Rising, biggest accelerations, new entrants). Weekly: a digest (top movers, one new technology to evaluate, one cooling technology) as a page and an Atom feed. Monthly: technology momentum table by area with change versus last month. Architect view: "New to evaluate" with age, release cadence and maturity. Java view: Spring/JVM ecosystem filter (needs per-domain thresholds, otherwise empty). DevOps view: Cloud native and Infrastructure areas, ranked by release and growth.

## 8. Security, abuse and data quality
| Risk | State | Deterministic defence |
|---|---|---|
| Star manipulation / viral spikes | Present in Rising (examples above) | Show flags: spike share (growth 7d over lifetime stars), forks per star, issues per star; require persistence for "Rising" labels in strict mode |
| Educational/list repositories | 354 name/description matches of 3,957 (heuristic) | `contentType` flag, separate shelf |
| Forks, mirrors, archived, spam, SEO/generated | Archived excluded in tracking (1 archived); `isFork` captured by collector, not shown | Exclude forks and archived from public lists; description-duplicate detection |
| Classification poisoning (topics gamed) | Identity evidence rule exists (Phase 3) | Keep identity-evidence requirement; add owner/name evidence; sample audit each month |
| Token | Secret `RADAR_GITHUB_TOKEN`, redacted logs, build-output audit; workflow permission `contents: write` only | Pin third-party actions by SHA (first-party ones are on major tags): P2 |
| Public state asset | Release assets of a public repository are public | Contains only public GitHub metadata; keep it that way |
| Upstream dependency | Single endpoint | Monitor failure rate; keep the last good dataset (already so) |

## 9. Quality model (thresholds ASSUMED; calibrate after two weeks of snapshots)
| Metric | Target |
|---|---|
| Classification precision / recall (hand-labelled 200 per domain) | at least 90% / at least 80% |
| UNKNOWN share of candidates | at most 10% (currently 22.7%) |
| Untracked records in the public file | 0 |
| Ranking stability (Rising list overlap day over day) | at least 70% |
| Momentum stability (median absolute score change for non-Rising repositories per day) | at most 5 points |
| Data freshness (age of newest `growthAsOf` among tracked, 95th percentile) | at most 3 days (currently max 3.1) |
| API success rate / pipeline failure rate | at least 99% / at most 1 failed scheduled run per 30 |
| Collection completeness (measured over tracked) | at least 99% (currently 100%) |
| Public payload | at most 8 MB (the gate's warning level), Explore at most 500 KB gzip |
| Scheduled start lateness | informational (currently 5.5 to 7 hours) |

## 10. What NOT to build yet
| Idea | Why it waits |
|---|---|
| AI chatbot / natural-language Data Explorer | OSS Insight already does it and its core ranking is down; a chat layer over weak "why" data amplifies weakness. Needs Level 1 and history first |
| Vector database / recommendations / personalization | No users, no accounts, no events to learn from |
| User accounts, notifications | Static site is a strength; an Atom feed serves the same need |
| Complex ML ranking | Breaks the transparency that is the differentiator |
| Real-time streaming | Stars do not change meaning hourly; GitHub budget and complexity cost |
| Full dependency graph | Heavy, AGPL-licensed sources, not needed for momentum |
| Enterprise analytics, paid APIs | No evidence of demand |
| Contributor-growth and PR-velocity pipelines | Expensive per repository, modest marginal value |
| A database | Not needed below the triggers in section 4 |

## 11. Prioritization (scores 1-10; Priority = (2 x Value + Differentiation) / (Complexity + Cost), higher is better; scores are my judgement, ASSUMED)
| Feature | Value | Differ. | Complexity | Cost | Priority |
|---|---:|---:|---:|---:|---:|
| 90-day trajectory sparkline (from existing daily gains) | 8 | 6 | 2 | 1 | 7.3 |
| Anomaly/spike flags | 7 | 6 | 2 | 1 | 6.7 |
| Weekly digest page + Atom feed | 7 | 5 | 2 | 1 | 6.3 |
| "What changed since yesterday" (daily snapshots) | 9 | 8 | 3 | 1 | 6.5 |
| Per-domain momentum thresholds (config) | 8 | 7 | 3 | 1 | 5.8 |
| README and docs index | 5 | 1 | 1 | 1 | 5.5 |
| Technology-level aggregation | 9 | 9 | 4 | 1 | 5.4 |
| Release-cadence signal (GraphQL) | 7 | 6 | 3 | 1 | 5.0 |
| Client-side search | 6 | 2 | 2 | 1 | 4.7 |
| HN "why now" evidence | 7 | 8 | 4 | 1 | 4.4 |
| Classification coverage (UNKNOWN reduction) | 8 | 3 | 4 | 1 | 3.8 |
| Backfilled historical momentum | 7 | 7 | 5 | 1 | 3.5 |
| Orphan/untracked cleanup | 4 | 1 | 2 | 1 | 3.0 |
| Compare repositories | 6 | 4 | 4 | 1 | 3.2 |
| Engineering Radar MVP | 9 | 8 | 7 | 2 | 2.9 |
| npm/Docker adoption signals | 7 | 7 | 6 | 2 | 2.6 |
| Data path off Git (later) | 5 | 0 | 5 | 1 | 1.7 |
| LLM narrative | 5 | 5 | 6 | 5 | 1.4 |
| Full dependency graph | 5 | 6 | 9 | 5 | 1.1 |
| User accounts / personalization | 4 | 2 | 8 | 4 | 0.8 |
| Vector DB / chatbot | 3 | 3 | 8 | 6 | 0.6 |
| Database migration | 2 | 1 | 8 | 5 | 0.4 |

Note: the Engineering MVP scores low on the ratio because it is large, but it is **gated** by two higher-ranked items (taxonomy v2, per-domain thresholds), so it is sequenced after them rather than abandoned.

**Top 5 to build next:** (1) trajectory sparkline and "what changed" built on existing data; (2) anomaly flags plus Level 1 growth-pattern explanation; (3) taxonomy v2 and UNKNOWN reduction; (4) per-domain momentum with a backtest; (5) Engineering Radar MVP (technology-first).
**Top 5 not to build:** chatbot, recommendation engine, accounts, database migration, full dependency graph.
**Top 5 architectural risks:** (1) single upstream star-history endpoint of unstated status; (2) Git history growth near 6,000 records; (3) per-repository static pages (about 56 KB each) versus platform limits; (4) one-day state rollback depth; (5) GitHub scheduled-run lateness and silent skips (a scheduled workflow can also be disabled after 60 days of inactivity, per GitHub documentation, not re-verified here).
**Top 5 product risks:** (1) reads as a Trending clone without a visible "why"; (2) Engineering shows an empty Rising page if built naively; (3) trust loss from spike or purchased-star entries; (4) no reason to return daily (no history, no diff, no feed); (5) stars-only worldview misses adoption for infrastructure.
**Top 5 competitive advantages:** deterministic and auditable scoring; growth-shape labels (acceleration, persistence, cooling); working on the new star-history endpoint when incumbents are degraded; zero-infrastructure daily automation; ability to add technology-level aggregation on data already collected.

## 12. Target architecture (12 to 18 months)
Current: `GitHub -> collectors -> classify -> track -> due collection -> momentum -> public JSON in Git -> Next.js -> Vercel`, state in a release asset.

Target (changes marked +):
```
GitHub (Search, GraphQL, star-history)  [+ CNCF landscape file, later npm/Docker/deps.dev]
  -> Collectors (unchanged, + release fields)
  -> Normalizer (+ forks/mirrors/orphans removed, contentType)
  -> Classifier (+ taxonomy v2: area, tags, facets)
  -> Tracking (unchanged)
  -> Momentum (+ per-domain thresholds, normalized variants)
  -> Historical intelligence (+ compact daily snapshots, backfill, category/technology aggregates)
  -> Explanation (+ Level 1 pattern + evidence, later Level 2/3)
  -> Public data (+ per-domain shards, sparklines, digest.json; moved off daily Git commits at the trigger)
  -> Next.js static (+ engineering routes, technology pages, search, feed)
  -> Vercel (unchanged; deployment path stays Git push)
```
Nothing else is added: no database, no backend, no queue, no LLM in the ranking path.

## 13. Executive verdict (blunt)
1. **Differentiated?** Modestly today, genuinely only if the "why" and history land. Growth *shape* is a real edge over Trending; the headline claim "and why" is **not yet defensible**. Defensible claim now: "Momentum, not popularity: see what is accelerating, with the evidence." Top five differentiators: growth shape; technology-level aggregation; auditable explanations; maturity-aware engineering view; automatic history and diffs.
2. **Is AI Radar worth continuing?** Yes, it is the proof of the engine and the part with traffic potential, but stop polishing the UI and fix trust and coverage first.
3. **Is Engineering Radar worth building?** Yes, because that is where the unserved audience (architects, Java, platform) is and OSS Insight's rankings are down. Only as a technology-first product with domain-normalized momentum.
4. **What should it be?** A technology and maturity radar: technologies moving, projects to watch, new to evaluate, cooling, with release cadence and maturity.
5. **What should it not be?** A relabelled AI Radar, a star leaderboard, or a tutorial/awesome-list showcase.
6. **Single biggest missing feature:** history, meaning trajectory, "what changed" and a digest. It is both the return-visit reason and the base for "why". The data is already collected.
7. **Biggest technical risk:** dependence on a single, newly introduced upstream endpoint with unstated limits.
8. **Biggest product risk:** looking like a Trending clone with a numbers-only explanation.
9. **What could make it valuable:** trusted, explained, historical momentum at technology level for engineers who must decide what to evaluate.
10. **What could make it fail:** an empty Engineering page, spiked or bought stars in Rising, upstream API changes, and no reason to come back.
11. **If I had 30 days:** week 1 hardening, flags and sparklines; week 2 snapshots, "what changed", digest and feed; week 3 taxonomy v2, UNKNOWN reduction and per-domain thresholds with backtest; week 4 Engineering Radar MVP behind a route.
12. **If I had 7 days:** README, orphan cleanup, anomaly flags with the Level 1 pattern label, 90-day sparkline, dated state backups, correct the schedule documentation.
13. **If I had to delete half the roadmap:** remove the LLM narrative, chat/Data Explorer, external signals beyond Hacker News, the dependency graph, contributor and PR pipelines, personalization, notifications, and any database work.

## 14. 7-day plan
Day 1: README and docs index; correct schedule documentation (actual 10:00-11:30 UTC); weekly dated state backup (small workflow edit, to be done in Phase 6.1, not now). Day 2: purge the 351 orphan records and stop publishing untracked records; decide UNKNOWN policy. Days 3-4: anomaly flags and Level 1 pattern label (additive public fields). Days 5-6: `sparkline90` and a trajectory on the repository page (uPlot or CSS bars; decide by bundle size). Day 7: re-run the quality gate with the new fields, update validation docs.

## 15. 30-day plan
See ROADMAP-NEXT-PHASES.md (phases 6.1 to 7).

## 16. Final recommendation
Do not start Engineering Radar yet. First (about two to three weeks) close the trust and history gaps, rebuild the taxonomy, and prove per-domain momentum on reconstructed history. Then build Engineering Radar as a technology-first product. Keep the architecture; add only snapshots, tags and shards.

---
**Correction (2026-10-08, Phase 6.2):** section 4's Git-growth figures (about 0.83 MB per daily commit, about 300 MB a year, "move data out of Git at about 6,000 records") were derived from loose-object `.git` sizes and overstate real growth. Packed, the 14 bot commits added 2.4 MB in total (mean 171 KB per commit, about 60 MB a year at the current size). See [PHASE-6.2-SIZE-AUDIT.md](PHASE-6.2-SIZE-AUDIT.md) section 4. The static-export size quoted there (148 MB) was a block-rounded `du` figure; the logical size is 140 MB.
