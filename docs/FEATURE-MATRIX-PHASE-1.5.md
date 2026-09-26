# FEATURE MATRIX — PHASE 1.5

Legend: ✅ verified in code/data · ◐ partial · ✗ absent · ? not verified. Audit date 2026-09-24.

## 1. Candidate × capability

| Capability | rising-repos-tracker | daily-stars-explorer | star-history | trending-repo | bonfy | Marcos66236 | RepoMeteor | Trending-Intelligence |
|---|---|---|---|---|---|---|---|---|
| Language / stack | JS + HTML | Go + React | TS (Next 14, d3) | Python + HTML | Python | Python | Go + Next + Postgres | Python + Next + Postgres |
| Uses new `stargazers/history` | ✗ | ✅ | ✗ (checkout still old REST) | ✗ | ✗ | ✅ | ✗ | ✗ |
| Exact daily star history | ✗ (own daily snapshots) | ✅ | ◐ sampled (old path) | ✗ | ✗ | ✅ | ✗ (own snapshots) | ◐ own daily |
| Weekly trends | ◐ derivable | ✅ aggregates | ✗ | ◐ trending page | ✗ | ✅ | ✅ 7d window | ✅ |
| Monthly trends | ◐ derivable | ✅ | ✗ | ◐ trending page | ✗ | ◐ | ✗ (6h/24h/7d only) | ◐ |
| Rising repos | ◐ lifetime avg | ✗ (single repo) | ✗ | ✗ | ✗ | ✗ | ✅ momentum-v1 | ✅ |
| Biggest movers | ✗ | ✗ | ✗ | ◐ entered/left | ✗ | ✗ | ◐ Established Movers | ✅ |
| New entrants | ✅ discover.js | ✗ | ✗ | ◐ entered list | ✗ | ✗ | ✅ | ✅ |
| Categories | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ topic filter | ✅ 15 seeded |
| Repo detail / history chart | ◐ | ✅ | ✅ | ✗ | ✗ | ◐ CLI | ✅ | ✅ |
| Compare repos | ✗ | ✅ | ✅ | ✗ | ✗ | ✅ | ✅ | ✅ |
| Scoring algorithm | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ documented, versioned | ✅ fixed p95 log |
| Confidence / eligibility rules | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ |
| Storage | git JSON | in-memory cache | none/CDN | git JSON | git md | none | PostgreSQL | PostgreSQL |
| Needs DB / backend | no | yes (server) | yes (server) | Flask optional | no | no | **Postgres + Go worker** | **Postgres + Celery + FastAPI** |
| GitHub Actions | ✅ 4 | ✅ chart action | ✗ | ✅ 3 | ✅ 1 | ✗ | ✗ (Compose) | ✅ 4 |
| Vercel-compatible as-is | ✅ static | ✗ | ◐ frontend only | ✅ static | ✅ | ✗ | ✗ | ◐ frontend only |
| License | MIT | MIT | MIT | MIT | MIT | MIT | Apache-2.0 | MIT |

## 2. Product requirement -> decision

| Requirement | Best existing source | Decision | Custom code needed |
|---|---|---|---|
| Daily star history / backfill | GitHub `stargazers/history` (via daily-stars-explorer design) | COMPOSE + ADAPT (port client) | ~100 lines TS |
| Weekly star growth | same endpoint, sum last 7 days | COMPOSE | few lines |
| Monthly star growth | same endpoint, sum last 30 days (1 page = 210 days) | COMPOSE | few lines |
| Repository metadata & snapshots | GitHub GraphQL (Phase 1 provider) | KEEP | done |
| Discovery / new entrants | GitHub Search (Phase 1 provider) | KEEP | query config |
| Rising | RepoMeteor momentum-v1 design | ADAPT design | TS scorer |
| Biggest movers | – (rank delta over two windows from history) | BUILD | small |
| New entrants | RepoMeteor collection definition | ADAPT design | small |
| Hidden gems / established movers (bonus) | RepoMeteor | ADAPT design | small |
| Historical persistence | derived from weekly buckets (weeks with growth) | BUILD | small |
| Categories: AI (13) / Engineering (19) | Trending-Intelligence seed data + GitHub topics + OSS Insight collections | ADAPT data + BUILD classifier | ~50 lines + config |
| Charts | chart library | COMPOSE | glue |
| Dashboards | none reusable | BUILD | Next.js UI |
| Trending-page scrape | repotide parser | OPTIONAL / DROP | none if dropped |

## 3. Momentum signals: what can be collected reliably today

Status: **V** = verified live in this session · **D** = documented, not verified · **P** = implemented in Phase 1 code but live cost/behaviour unmeasured (no token) · **U** = unknown.

| Signal | Source | Status | Notes |
|---|---|---|---|
| Star growth (daily/weekly/monthly) | `stargazers/history` | **V** | exact; sums matched `stargazers_count` on 3 repos; 1 request per 30 weeks; no token needed |
| Acceleration (this week vs prior weeks) | same | **V** (derivable) | needs >= 2–4 weeks of buckets: 1 page has 30 |
| Historical persistence (weeks of sustained growth) | same | **V** (derivable) | |
| Recency (age, last push) | GraphQL `createdAt`/`pushedAt` | P | REST equivalents are simple and known |
| Fork growth | own snapshots (`forkCount`) | P | no history endpoint for forks; accrues after day 0 |
| Activity: commits in window | GraphQL `history(since:).totalCount` | P | cost with/without unmeasured |
| Issues/PR activity | open-issue count snapshot; opened-in-window via search count | P / U | opened-in-window cost unknown |
| Contributors / new contributors | REST `/contributors` or GraphQL | **U** | not tested; not in changelog restrictions; may be expensive |
| Watchers | `/subscribers` | **Restricted (D)** | changelog 2026-06-30; do not plan on it |
| Individual stargazers / hourly stars | `/stargazers` | **Restricted (V: 401 unauth; D: admin/collab only)** | do not plan on it |

Recommended Phase 2 signal set v0 (weights NOT decided here): windowed star growth (7/30/90d), relative growth with floor, acceleration, persistence, recency, fork growth (from own snapshots, cold-start neutral), commits-in-30d (once cost measured). Defer contributors and issue-opened.
