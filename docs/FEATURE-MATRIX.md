# FEATURE MATRIX

Legend: ✅ verified in code/data · ◐ partial · ✗ absent · ? not verified. Audit date 2026-09-24.

## 1. Candidate × capability

| Capability | rising-repos-tracker | repotide | isboyjc-api | encoreshao | oss-radar-ai | dailyRepo | Github-Ranking | github-trending-radar | ossinsight API |
|---|---|---|---|---|---|---|---|---|---|
| Weekly trending | ◐ derivable | ✅ (scrape) | ✅ (scrape) | ◐ (new repos by stars) | ✅ (new repos/wk) | ? | ✗ | ✗ | ✗ broken |
| Monthly trending | ◐ derivable | ✅ (scrape) | ✅ (scrape) | ◐ | ✗ | ? | ✗ | ✗ | ✗ broken |
| Rising repos | ✅ stars/day | ◐ | ✗ | ✗ | ✗ | ? | ✗ | ✅ lifetime velocity | ✗ broken |
| Biggest movers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ snapshot diff | ✗ |
| New entrants | ✅ discover.js | ✗ | ✗ | ◐ | ✅ | ✗ | ✗ | ✅ | ✗ |
| Category trends | ✗ | ◐ language | ◐ language | ◐ 25 topics | ✅ LLM categories | ◐ 6 categories | ◐ language | ◐ 4 tracks | ✅ collections (membership only) |
| Repo details | ◐ | ◐ | ◐ | ◐ | ✅ LLM page | ◐ | ✗ | ✗ | ✅ |
| Historical trends | ✅ daily JSON | ✗ | ✗ | ✗ | ◐ weekly archive | ✅ Mongo | ✅ CSV daily since 2018 | ◐ last snapshot | ✅ stargazer history |
| Data source | REST API | trending HTML | trending HTML | Search API | Search API + LLM | Search API | REST API | Search API | GH Archive (degraded) |
| Storage | git JSON | none | git JSON | git JSON/CSV | git MD | MongoDB | git CSV | local JSON | TiDB |
| Runs on GitHub Actions | ✅ | ✗ | ✅ | ✗ | ✅ | ✅ (+Atlas) | ✗ (cron) | ✗ | n/a |
| Vercel-compatible | ✅ static | ✅ | ✅ static | ✅ static | ✗ (MkDocs) | ✗ | ✅ static | ✗ | n/a |
| Needs DB | no | no | no | no | no | **yes** | no | no | yes (theirs) |
| Needs paid key | no | no | no | no | **LLM** | no | no | no | no |
| License | MIT | MIT | MIT* | MIT | MIT | MIT | MIT | MIT | Apache-2.0 |

*isboyjc LICENSE file not confirmed locally.

## 2. Required feature → decision

| # | Product feature (both dashboards) | Class | Implementation source |
|---|---|---|---|
| 1 | Weekly trending | ADAPT + BUILD | Scrape trending `since=weekly` (repotide parser) for GitHub's own list; **own ranking** = Δstars over 7 d from snapshots, cold-started via stargazer timestamps |
| 2 | Monthly trending | ADAPT + BUILD | Same with 30 d window |
| 3 | Rising repos | BUILD | Age-normalised velocity + acceleration (see ARCHITECTURE §5). Lifetime avg (rising-repos-tracker, radar) is only an input |
| 4 | Biggest movers | BUILD | Rank change vs previous period + Δvelocity; needs two ranked snapshots |
| 5 | New entrants | ADAPT | Search API `created:>date stars:>N` (discover.js pattern) + "first appears in top-N" from own history |
| 6 | Category trends | COMPOSE + BUILD | Seed lists from GitHub topics + OSS Insight collection membership; own rule-based classifier; aggregate Δstars per category |
| 7 | Repository details | COMPOSE | GitHub REST repo + topics + languages; README excerpt optional; no LLM (cost) |
| 8 | Historical trends | ADAPT + COMPOSE | Own daily snapshots (rising-repos-tracker idea, sharded); backfill with stargazer timestamps or OSS Insight history |
| 9 | AI vs SWE split | BUILD | Two dashboards over one dataset, classifier tags |
| 10 | Scheduling | ADAPT | oss-radar-ai guard + fallback cron |
| 11 | Feeds (RSS/JSON) | REFERENCE | Trivial once JSON exists; generate ourselves |
| 12 | UI | REUSE libs | Next.js + chart library; no candidate UI is reusable (antd/single-file HTML/Mongo-bound) |

## 3. What each candidate contributes (final)

| Project | Contribution | Class |
|---|---|---|
| repotide | `parser.ts`, `types.ts`, trending URL builder, ISR period cadence idea | ADAPT |
| rising-repos-tracker | snapshot collector, discover queries, commit idiom, README stats generator idea | ADAPT |
| oss-radar-ai | guard job, fallback cron, RSS/JSON API surface | REFERENCE |
| isboyjc-api | fallback JSON feed via jsDelivr | COMPOSE (optional) |
| OSS Insight API | collection membership, stargazer history curve | COMPOSE (non-critical) |
| encoreshao | topic list | REFERENCE |
| dailyRepo | category names | REFERENCE |
| Github-Ranking | baseline CSV concept | REFERENCE |
| star-history | timestamp sampling technique | REFERENCE |
| vitalets, huchenme, GitHubTrendingRSS, ai-martin-lau | nothing copied | REFERENCE / REJECT |
