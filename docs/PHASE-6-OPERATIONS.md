# PHASE 6 OPERATIONS

## Pipeline (workflow `.github/workflows/radar.yml`)
`preflight` (API capacity) -> [weekly discovery] -> `classify` -> `track` -> `collect --due` -> `track` -> `momentum` (writes the candidate `data/public/radar.next.json`) -> **quality gate** -> `npm test` -> `tsc` -> **atomic publish** (compact copy, replaces `radar.json` in the workspace only) -> `next build` -> build-output audit -> **commit radar.json to main** -> save state release -> production smoke test. A step that fails stops everything after it; the commit is the last step that changes production.

| Item | Value |
|---|---|
| Triggers | daily 04:17 UTC; Mondays 03:47 UTC (same run plus discovery); manual `workflow_dispatch` |
| Why daily | star growth needs no hourly refresh; the due schedule already refreshes HOT daily, WARM every 3 days, DORMANT weekly (about 1,100 requests/day); fewer API calls, Actions minutes and deployments |
| Concurrency | group `radar-pipeline`, `cancel-in-progress: false`: one run at a time, a newer run waits |
| Permissions | `contents: write` only (data commit, `data-state` release). No `pull_request` trigger, so pull requests cannot run or deploy it |
| Manual inputs | `dry_run` (default **true**: everything except commit/state/verify), `discover`, `limit` (top N by stars, for smoke tests) |
| Scheduled runs | always real runs (dry-run only applies to manual dispatch) |
| Timeout | 240 minutes |

## Deployment path (one)
Push to `main` -> **Vercel Git integration** builds and deploys (already connected). GitHub Actions never deploys directly and holds no Vercel credentials. The last step polls production until the new `generatedAt` shows on the home page and checks canonical, robots, sitemap and one repository page.

## Secrets and variables
| Name | Kind | Purpose |
|---|---|---|
| `RADAR_GITHUB_TOKEN` (optional secret) | fine-grained read-only token | 5,000 requests/hour. Without it the workflow token (1,000/hour per repository) is used; preflight then skips the run because it requires 1,500 core requests, so **add this secret before the first real scheduled run** |
| `SITE_URL` (optional variable) | public | production URL for canonical/sitemap/robots; defaults to https://opensourceradar-kappa.vercel.app |
Never in `NEXT_PUBLIC_*`, never in logs (the logger redacts), never in the built site (the build audit greps for token patterns).

## Quality gate (config/pipeline.json, unit-tested in tests/pipelineGate.test.ts)
FAIL (blocks publishing): invalid JSON, wrong `schemaVersion`, empty repositories, duplicate ids, malformed url, negative or non-integer stars, non-finite numbers, score outside 0-100, growth greater than total stars, invalid trend/classification/category, lists referencing unknown ids, `measured > tracked`, future `generatedAt`, fewer than 500 repositories or 100 AI repositories, dataset over 25 MB, repositories/tracked/measured/AI dropping 10% or more against the previous dataset, measured coverage share falling more than 10 points, Rising falling to 0 from 5 or more. WARNING: any of those metrics dropping 5% or more, Rising changing 70% or more, dataset over 8 MB. Everything else is OK; normal daily movement does not fail. Thresholds are relative (no hard-coded counts) and configurable.

## Commands (all local; the same ones the workflow runs)
`npm run classify`, `npm run track -- --growth data/repositories.json`, `npm run collect -- --due --domain all --concurrency 4 --cache .cache/sh-due.json --out data/repositories.json`, `npm run momentum -- --repositories data/repositories.json --classified data/classified/classified.json --public data/public/radar.next.json`, `npm run pipeline:validate`, `npm run pipeline:publish`, `npm test`, `npm run typecheck`, `npm run build`, `npm run pipeline:summary`, `npm run pipeline:verify`, `npm run pipeline:preflight` (needs `GITHUB_TOKEN`).

## Observability
Each run writes a step summary (run id, capacity, requests by type, cache hits/misses, duration, tier and trend counts, gate table with previous/current/delta). Failed runs keep `.pipeline/*.json` and the candidate dataset for 7 days. Failure notification is the GitHub Actions failure status (and GitHub's own email for failed scheduled runs); no extra service was added.

## Known operating notes
- A scheduled workflow is disabled by GitHub after 60 days without repository activity; data commits count as activity when they happen, and an unchanged dataset produces no commit.
- Weekly discovery rewrites the candidate list; a shrunken candidate set is caught downstream by the tracked/AI drop checks.
- If a GitHub push by the workflow does not trigger a Vercel build, the smoke test fails on the stale timestamp and the run is marked failed; production is unchanged.

---
**Update (Phase 6.1):** the schedule section above was corrected in [PHASE-6.1-OPERATIONS.md](PHASE-6.1-OPERATIONS.md): there is now a single daily cron (Monday adds discovery in the same run), real start times are roughly 10:00 to 11:30 UTC, and state backups are 14 dated copies instead of one previous copy.
