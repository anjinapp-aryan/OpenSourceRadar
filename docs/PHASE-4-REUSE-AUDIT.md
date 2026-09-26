# PHASE 4 REUSE AUDIT — due collection and momentum

Audit date 2026-09-25. Rule: REUSE > ADAPT > COMPOSE > BUILD. Method: web searches, clones, LICENSE files opened. Anything not verified is marked **UNVERIFIED**.

## Capabilities audited
1. **Due-based collection** (read a refresh schedule, fetch only what is due).
2. **Growth metrics** (7/30/90-day growth, percent, stars/day, null when unknown).
3. **Momentum**: explainable signals, a composite score, rising / movers / sustained / new entrants.

## Findings

| Project / source | License | Relevant capability | Decision |
|---|---|---|---|
| **Existing Phase 2 code** (`RestStarHistoryProvider`, `computeWindowsFromGains`, `mapWithConcurrency`, `CachingStarHistoryProvider`, `RateGuard`, `buildRecord`, `writeJsonAtomic`, Phase 3 `selectDue`) | ours | star history, 7/30/90-day windows with `null` semantics, caching, guard, atomic write, due ordering | **REUSE** — the due collector is composition of these; no new star-history client |
| **FayezBast/repometeor** (Go, Postgres) | Apache-2.0 (Phase 1.5) | `momentum-v1`: log1p features, percentile-rank normalisation across a cohort, weights 0.32 star velocity / 0.23 relative growth (20-star floor) / 0.17 acceleration between half-windows / 0.10 fork velocity / 0.13 activity / 0.05 freshness, confidence multiplier, eligibility rules, collections (Rising, Hidden Gems, New Entrants, Established Movers) | **ADAPT (concepts only, nothing ported)**: use velocity as the dominant signal, relative growth with a small-base floor, acceleration between the recent and the preceding period, freshness/activity as context, separate New Entrants collection, eligibility. **Changed:** absolute (cohort-independent) log scaling instead of percentile ranks so a score does not change when other repositories change; no forks (not collected); no snapshot-density confidence (history comes complete from GitHub). Attribution in THIRD_PARTY.md |
| **HalcyonVector/GitHub-Trending-Intelligence-** | MIT | 0-100 momentum from star/fork/contributor/commit/issue velocity, each `log1p(x)/log1p(p95)` capped at 1, weights 0.45/0.20/0.20/0.10/0.05, recency bonus 1.2x under 30 days | **REFERENCE**: confirms log-scaling of velocity. **Rejected:** fixed p95 constants (arbitrary), score clipped at 100 (saturation), recency multiplier (would reward newness by itself, which the product rules forbid) |
| **ErcinDedeoglu/oss-pulse** (data + docs repo, new discovery) | **no LICENSE file in the repository root** (unresolved) | 0-100 momentum from velocity + relative growth + acceleration + consistency, "size x momentum" quadrants; published table shows **dozens of repositories tied at 100** | **REFERENCE only, copy nothing** (license unresolved). Useful negative lesson: a clipped 0-100 score saturates and stops discriminating (at least 55 of the first 55 rows tie at 100 in its published table) -> we use a soft, strictly monotonic scale and always expose raw signals |
| **Trending Repos** (trending-repos.com), **RepoFOMO**, **GitStar**, **GitExplorer**, Apify actors | hosted / not open source; not inspected in code | EMA-smoothed velocity, 7/30/60-day growth, "FomoRank", daily/weekly/monthly windows | **REFERENCE (ideas only)**: multiple-window velocity is standard; EMA smoothing is a possible later refinement |
| **HN / Reddit / Lemmy hot-ranking** (`clux/decay`, HN `(P-1)/(T+2)^G`) | various (decay: MIT, **UNVERIFIED**) | time-decayed vote ranking | **REJECT**: designed for one-shot items whose score decays with age; we have explicit measured windows and want repository momentum, not freshness decay |
| **star-history/star-history, daily-stars-explorer** (Phase 1.5) | MIT | history charts, week-rollover handling | already used as reference in Phase 2; no additional capability needed |
| Statistics libraries (simple-statistics etc.) | MIT | percentiles, regression | **REJECT**: needed maths (percentiles for reporting, log, ratios) is a few lines of standard TypeScript |
| GitHub Search/GraphQL/star-history API | GitHub terms | data | unchanged from Phase 2; GraphQL batch stays **50** (100 failed with 504 in the authenticated test) |

## Conclusions
1. **No project offers a due-based refresh collector or explainable momentum on top of GitHub's star-history endpoint.** The due collector is a composition of existing Phase 2/3 parts (REUSE).
2. **The momentum idea set is well established** (velocity first, relative growth with a floor, acceleration, consistency, separate new-entrant handling). We ADAPT the *concepts* from RepoMeteor (Apache-2.0) and reference Trending-Intelligence; we copy no code, no text, and no constants.
3. Two pitfalls seen in other projects are designed out: **saturation at 100** (oss-pulse) and **newness bonuses** (Trending-Intelligence).
4. Dependencies added: **none**.

## Adapted concepts (attribution)
- RepoMeteor (Apache-2.0): velocity-dominant weighting; relative growth with a minimum-base floor; acceleration between recent and preceding period; separate New Entrants collection. Changes listed above. No code or documentation text was copied, so the Apache-2.0 NOTICE/modification obligations are not triggered; credited in THIRD_PARTY.md as design influence.
