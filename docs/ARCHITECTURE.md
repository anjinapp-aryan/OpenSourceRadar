# ARCHITECTURE — OpenSource Radar

Status: design only (Phase 1). No application code exists yet. Basis: REUSE-AUDIT.md, DATA-SOURCE-AUDIT.md, LICENSE-AUDIT.md.

## 1. Principles
1. REUSE > ADAPT > COMPOSE > BUILD. The audit found nothing to REUSE wholesale; we ADAPT two MIT parsers/collectors and BUILD the scoring.
2. No database, no server. Git is the store; JSON is the format; Actions is the scheduler; Vercel serves static output.
3. Own snapshots are the source of truth. Scrapes and third-party APIs are optional accelerators.
4. One dataset, two dashboards (AI Radar, SWE/Architecture Radar) split by classifier tags.

## 2. System overview

```
GitHub Actions (cron, guarded)                 Git repo (data branch)              Vercel (static)
┌───────────────────────────────┐              ┌─────────────────────┐            ┌──────────────────┐
│ discover  (Search API)        │──candidates─▶│ data/registry.json  │            │ Next.js (SSG)    │
│ snapshot  (GraphQL, 100/req)  │──stars/day──▶│ data/daily/*.json   │──build────▶│ reads JSON at    │
│ trending  (HTML scrape, opt.) │──gh lists───▶│ data/trending/*.json│  (deploy   │ build time       │
│ backfill  (stargazer ts)      │──day-0 hist─▶│ data/history/*.json │   hook)    │ client charts    │
│ score+classify (TS scripts)   │──derived────▶│ data/derived/*.json │            │ /ai  /swe        │
└───────────────────────────────┘              └─────────────────────┘            └──────────────────┘
```

## 3. Repository layout (planned)

```
/app                 Next.js App Router (static export or SSG)
  /ai  /swe          two dashboards, shared components
  /repo/[owner]/[name]
  /category/[slug]
/lib                 scoring, types, loaders (BUILD)
/scripts             collectors run in Actions (ADAPT from repotide parser, rising-repos-tracker)
/data                committed JSON (see §4)
/config              categories.json, seeds, thresholds
/.github/workflows   collect.yml (guarded), discover.yml, deploy hook
/docs                audit + architecture
THIRD_PARTY.md       adapted files, source commit SHA, license
```

## 4. Data model (JSON snapshots)

- `data/registry.json` — tracked repos: `{id, full_name, created_at, first_seen, tags:{domain:"ai|swe|both", categories:[]}, topics:[], language, archived}`. ~200 B/repo.
- `data/daily/YYYY-MM-DD.json` — `{ "<repo_id>": [stars, forks, open_issues] }`. One file per day, ~12–15 B/repo. 5,000 repos ≈ 25 MB/yr.
- `data/history/{shard}.json` — monthly compaction; beyond 90 days downsample to weekly. Keeps repo size bounded.
- `data/trending/{daily|weekly|monthly}[-{lang}].json` — GitHub's own list with parsed "stars gained" (numbers, not strings).
- `data/derived/{ai|swe}/{weekly|monthly}.json` — precomputed rankings: rising, movers, new entrants, category aggregates. The site only renders these; no heavy client compute.
- `data/backfill/{repo_id}.json` — star curve reconstructed from stargazer timestamps for newly tracked repos.

Rule: never one file per repo per day (rising-repos-tracker does this per repo; it scales poorly).

## 5. Scoring (BUILD — no candidate implements it)

Inputs from snapshots: stars S(t), forks F(t), age A.
- **Δ7, Δ30** = S(t) − S(t−7d/30d).
- **Growth rate** = Δ / S(t−window) (relative), used with a floor (S ≥ 100) to avoid tiny-base noise.
- **Rising score** = `0.5·z(log(1+Δw)) + 0.3·z(rel_growth) + 0.2·z(accel)` where accel = Δ7 − (Δ30 − Δ7)/3.3 (this week vs. previous weeks' pace); age-normalised so a 10-day-old repo is not penalised. Weights are tunable in `config/scoring.json`.
- **Biggest movers** = rank(t) − rank(t−window) on Δw ranking, and Δ(velocity).
- **New entrants** = repos not present in the previous window's top-N, or `created_at` within window and stars ≥ threshold.
- **Cold start** (< 30 d of history): use stargazer-timestamp backfill; otherwise GitHub weekly/monthly trending "stars gained".
- Anti-gaming: cap on stars/fork ratio anomalies, min-fork/issue sanity, archived/forks excluded. Marked as tuning work; thresholds unverified.

## 6. Classification (BUILD)
Rules over topics, language, name and description; two config-driven keyword sets (`ai`: llm, agent, mcp, rag, diffusion, transformer, inference…; `swe`: architecture, microservices, ddd, observability, devops, database, framework, testing…). Seed with OSS Insight collection membership and encoreshao/dailyRepo topic lists (REFERENCE). A repo may be `both`. Category trends = sum Δw per category. No LLM (cost).

## 7. Frontend
Next.js App Router, TypeScript, static generation from `data/derived`. Chart library (e.g. Recharts or visx; license checked at install). Pages: `/ai`, `/swe` (tabs: Weekly, Monthly, Rising, Movers, New, Categories), `/repo/[owner]/[name]` (sparkline + history), `/category/[slug]`. Client-side only for filtering/sorting. Design and UI kit chosen in Phase 2; no candidate UI reused.

## 8. Workflows
- `collect.yml`: cron at an off-peak minute (e.g. `23 5 * * *`), plus a fallback cron 1 h+ later guarded by a "already ran today?" step (pattern from oss-radar-ai, which documents `:00` events being dropped). `concurrency` group to prevent overlap. Commits data with `git diff --cached --quiet ||` (rising-repos-tracker idiom).
- `discover.yml`: weekly Search-API sweep for new entrants.
- Deploy: Vercel Git integration builds on push to `main`. Keep data commits to ~1–4/day to stay far under Vercel Hobby deploy limits (limit value unverified). Optionally keep data on a `data` branch and use a Vercel deploy hook once daily.

## 9. Zero-cost deployment
| Concern | Service | Cost |
|---|---|---|
| Scheduler + compute | GitHub Actions (public repo: free minutes) | $0 |
| Storage | Git repo | $0 |
| Hosting | Vercel Hobby (static/SSG) | $0 (non-commercial use per Vercel terms — check if monetised) |
| Data APIs | GitHub `GITHUB_TOKEN`; no keys | $0 |
| Domain | `*.vercel.app` | $0 |
| Database, LLM, servers | none | — |
Fallback host if Vercel terms bite: GitHub Pages / Cloudflare Pages (same static output).

## 10. Risks
1. **Trending HTML scraping** breaks or is blocked → optional input; fixture-tested parser; isboyjc fallback; own snapshots primary.
2. **Cold start**: no history on day 1 → stargazer backfill + GitHub trending; weekly ranking honest at day 7, monthly at day 30.
3. **Repo growth** in git → compact day files, monthly compaction, downsampling; move history to a `data` branch or release assets if > ~500 MB.
4. **Search API cap** (1,000 results/query) → date-windowed, topic-sliced queries; discovery is not exhaustive.
5. **Token limits**: 1,000 req/h for `GITHUB_TOKEN` → GraphQL batching; a PAT secret (5,000/h) as escape hatch.
6. **Classifier accuracy** — keyword rules mislabel; expose tags, allow manual overrides in `config/`.
7. **Scoring bias/gaming** (star-farming) — sanity filters; scores are heuristics, not truth.
8. **Actions schedule drift/disable** — GitHub disables schedules on repos inactive 60 days; data commits keep it active; guard cron.
9. **Young upstream repos** (0 stars, one maintainer) — we copy code only, pin SHA, no runtime dependency.
10. **Vercel Hobby terms/limits** — see §9.
11. **Unverified**: GraphQL batching cost, stargazer-page cost, robots/ToS stance on trending scraping — verify in Phase 2 smoke tests.

## 11. Final recommendations

**Recommended reusable projects:** rising-repos-tracker (MIT), repotide (MIT). Optional data fallback: isboyjc feed (verify LICENSE). Non-critical enrichment: OSS Insight collections/history.

**Exact functionality to reuse (verbatim, with MIT notice):** repotide `lib/parser.ts` selectors + number parsing + allow-lists; `lib/types.ts` shape.

**Functionality to adapt:** rising-repos-tracker `collect.js` → GraphQL batched, single-day-file writer; `discover.js` query set → configurable per-domain queries; workflow commit idiom; oss-radar-ai guard/fallback cron; repotide trending URL builder → Action-side scraper.

**Functionality to compose:** GitHub GraphQL + Search + stargazer timestamps; OSS Insight collection membership + history; jsDelivr fallback feed; Next.js + chart library.

**Must be built:** velocity/acceleration/mover/new-entrant scoring; AI vs SWE classifier and category aggregation; window deltas from own history; compaction/downsampling; both dashboards' UI; derived-data generator.

**License concerns:** vitalets has no license (copy nothing); isboyjc LICENSE unconfirmed; MIT attribution via `THIRD_PARTY.md`; trending scraping is a ToS/stability risk, not a license one; OSS Insight has no stated data license.

**Next step (Phase 2, not started):** authenticated smoke tests for GraphQL batching + stargazer paging + trending fetch from an Actions runner; then scaffold.
