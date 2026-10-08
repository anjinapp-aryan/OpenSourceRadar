# OpenSource Radar

**What is rising in open source, and why?** OpenSource Radar tracks GitHub repositories whose star growth is accelerating, shows the evidence behind each ranking, and refreshes once a day. Live: https://opensourceradar-kappa.vercel.app/

## The problem
Total star counts say what is popular, not what is moving. A repository with 100,000 stars gaining 100 a week is not the same news as one with 10,000 stars gaining 2,500. Sorting by stars hides the second one.

## How it differs from GitHub Trending
GitHub Trending lists stars gained today, this week or this month. OpenSource Radar looks at the **shape** of growth over 7, 30 and 90 days: how fast, whether it is accelerating or fading against the previous four weeks, whether it is sustained across windows, and whether it is a new repository. Every ranking comes with its numbers, so you can see why a repository is listed. It is a smaller product (AI repositories only so far), not a replacement for Trending.

## Current scope
- **AI Radar** (live): about 1,700 AI-related repositories in 14 categories (agents, LLM, RAG, MCP, coding, local AI, and others). Rising, biggest movers, sustained momentum, new entrants, category pages, an explorable list and a page per repository with a 90-day daily trajectory.
- **Engineering Radar**: **not built yet** (marked "coming soon"). A strategic audit (see `docs/STRATEGIC-AUDIT.md`) found that the AI scoring thresholds do not transfer to engineering repositories, so it needs its own design first.

## Principles
- **Deterministic ranking.** Scores come from fixed rules over measured star growth. No machine learning and no LLM decide what is ranked or why.
- **"Why is this rising?" is evidence, not narrative.** Each repository page shows a growth pattern (for example *Sustained climb*, *Concentrated spike*, *New launch*), the measured numbers behind it, and the ranking status, each kept separate. Patterns are neutral descriptions of shape; they never claim how stars were earned. See `docs/PHASE-6.1-ANOMALY-MODEL.md`.
- **Missing data stays missing.** A window that cannot be measured is shown as unavailable, never as zero. A repository that is not being refreshed is withheld rather than shown with stale numbers.
- **Descriptive, not predictive.** Momentum describes recent growth. It does not forecast success.
- **Not real-time.** The pipeline runs once a day; GitHub starts scheduled runs late (observed roughly 10:00 to 11:30 UTC).

## Architecture
```
GitHub (Search, GraphQL, star-history endpoint)
  -> discovery (weekly) -> classification -> tracking tiers -> due collection
  -> momentum + growth patterns + lifecycle -> public dataset (radar.json, history.json)
  -> quality gate -> build -> commit to main -> Vercel deploys the static Next.js site
```
GitHub Actions runs the pipeline (`.github/workflows/radar.yml`). Working data lives in a release asset of this repository (`data-state`), not in Git history; only `data/public/radar.json` and `data/public/history.json` are committed by the pipeline. The site is a static export that reads only the public files at build time. There is no database, no backend API, no browser-side GitHub call and no secret in the site.

## Data sources
GitHub only: the Search API (discovery), the GraphQL API (repository metadata, batches of at most 50) and GitHub's star-history endpoint (weekly buckets with daily gains). Topic aliases adapted from github/explore (CC BY 4.0, see `THIRD_PARTY.md`).

## Cost
No paid service is used: GitHub Actions and Releases on a public repository, Vercel's free tier, GitHub's free APIs. (Billing was not audited; this describes the design.)

## Local development
Node 24 and npm (the versions CI uses).
```
npm ci
npm test                 # unit and component tests
npm run typecheck
npm run dev              # local site (needs data/public/radar.json, included)
npm run build            # static export to out/
```
Pipeline stages (need `GITHUB_TOKEN` in the environment for the collectors; never commit it):
```
npm run classify
npm run track -- --growth data/repositories.json
npm run collect -- --due --domain all --concurrency 4 --cache .cache/sh-due.json --out data/repositories.json
npm run momentum -- --repositories data/repositories.json --classified data/classified/classified.json --public data/public/radar.next.json
npm run pipeline:validate     # quality gate on radar.next.json (and history.next.json)
npm run pipeline:publish      # gate again, then atomic replace of radar.json and history.json
```
`node scripts/browser-validate.mjs` drives an installed Chrome against `out/` for overflow, console, accessibility (axe) and interaction checks.

Offline analysis tools (read pipeline state, write nothing to the product; see the Phase 6.2 docs):
```
npx tsx scripts/backtest/run.ts <state data dir> data/public/radar.json   # point-in-time back-test of the production rules, future-leakage audit
npx tsx scripts/coverage/orphans.ts <state data dir> [--live --sample 30]  # why repositories fell out of discovery
npx tsx scripts/classify/experiment.ts evaluate <state data dir>           # experimental classification rule, never used in production
npm run pipeline:size                                                      # public data and static export sizes
```
The pipeline state (`data-state` release asset, `state.tar.gz` or a dated `state-YYYY-MM-DD.tar.gz`) is public; extract it to get the `data/` directory the tools expect.

## Deployment
Vercel's Git integration deploys every push to `main`. The scheduled workflow commits the refreshed public data, which triggers the deployment, then runs a production smoke test. Details and rollback: `docs/PHASE-6-OPERATIONS.md`, `docs/PHASE-6.1-OPERATIONS.md`, `docs/PHASE-6-ROLLBACK.md`. Set `NEXT_PUBLIC_SITE_URL` (public, not a secret) for a custom domain; otherwise Vercel's production domain is used.

## Limitations
- AI repositories only; classification is rule based and leaves about 23% of discovered repositories UNKNOWN (so they are not tracked or shown).
- Stars can be inflated by promotion or bots; the pattern labels highlight unusual shapes but do not detect manipulation.
- Educational and list-style repositories can rank when they gain stars quickly.
- One data source (GitHub star history). History is capped at about 210 days per repository; the site shows 90.
- Repositories that fall out of weekly discovery stop being refreshed and are withheld (351 today). The cause is the discovery rules (a 30-day push window and a top-100-by-stars cut per topic), analysed in `docs/PHASE-6.2-COVERAGE-RECOVERY.md`; a bounded retention design exists but is not enabled.

## Roadmap
Documented in `docs/ROADMAP-NEXT-PHASES.md`: historical "what changed" views, taxonomy v2 and per-domain momentum, then an Engineering Radar designed technology-first. Phase 6.2 added the back-testing and coverage analysis these decisions rest on (`docs/PHASE-6.2-VALIDATION.md`).

## Documentation
`docs/` holds the audits, data contracts and validation reports for every phase (start with `docs/ARCHITECTURE.md`, `docs/MOMENTUM.md`, `docs/PHASE-5-DATA-CONTRACT.md`, `docs/STRATEGIC-AUDIT.md`).
