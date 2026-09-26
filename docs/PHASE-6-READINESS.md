# PHASE 6 READINESS (checked 2026-09-26, after Phase 5.5.1)

Verdict: **READY WITH LIMITATIONS**. Nothing from Phase 6 (scheduled collection, publishing, rollback, monitoring) is implemented yet.

| # | Question | Finding (evidence) |
|---|---|---|
| 1 | Valid Git repository | Yes. Branch `main`, in sync with `origin/main` |
| 2 | GitHub remote | `origin` = https://github.com/anjinapp-aryan/OpenSourceRadar.git |
| 3 | Branch known | `main` |
| 4 | Vercel connected | **Yes.** GitHub reports a Production deployment for commit dcc51e9 with combined status `success`; https://opensourceradar-kappa.vercel.app/ serves the Phase 5.5 build. No `vercel.json` or `.vercel` folder in the repo, so it was connected through the Vercel dashboard (its build settings were not inspected) |
| 5 | `NEXT_PUBLIC_SITE_URL` | **Was not set on Vercel**: production canonical links, sitemap and robots pointed to `http://localhost:3000`. Fixed in code in Phase 5.5.1: `lib/site.ts` falls back to Vercel's automatic `VERCEL_PROJECT_PRODUCTION_URL`. Setting `NEXT_PUBLIC_SITE_URL` explicitly (needed for a custom domain) is still a dashboard action |
| 6 | `GITHUB_TOKEN` only server/Actions side | Yes. It is read only in `src/github/config.ts` (collectors, scripts). Nothing under `app/`, `lib/` or `components/` references it, and the built `out/` contains no token pattern |
| 7 | `data/public/radar.json` present | Yes, committed |
| 8 | Build without secrets | Yes. `npm run build` ran with no `GITHUB_TOKEN` in the environment |
| 9 | Build from committed data | Yes. The site reads only `data/public/radar.json` at build time |
| 10 | Internal datasets excluded from browser output | Yes. `out/` contains no reference to candidates, classified, tracked or momentum files; internal files are committed in `data/` but never imported by the app |
| 11 | Compatible with GitHub Actions | Yes in principle: a workflow can run collect, track, momentum with the token as a secret, commit `data/`, and the push triggers the existing Vercel deployment |

## Limitations to handle in Phase 6
- **Repository size:** internal datasets are committed (data about 46 MB, results 14 MB). Scheduled commits of these files will grow history quickly; decide what stays in Git (only `radar.json` and `repositories.json`?) before automating.
- **`data/repositories.json`** is the state the due-collector merges into, so an Actions run must commit it back or use a cache/artifact.
- Star-history cache (`.cache/`, git-ignored) is lost between Actions runs unless cached.
- Rate limit: one full first-run cost about 200 fresh history requests plus 58 GraphQL requests; the 5,000/hour core budget is ample, but Actions should stop cleanly on a rate-limit error (the collector already exits 3 with progress saved).
- Vercel build settings and environment variables were not inspected (no access from this session).
- No monitoring, staleness alert or rollback exists; the site only shows a stale-data warning after 72 hours (computed at build time).
- Prefetch behaviour: verified on Vercel, no production issue (see PHASE-5.5-VALIDATION.md addendum).

---
Update after Phase 6 implementation: the automation is implemented (see PHASE-6-OPERATIONS.md and PHASE-6-VALIDATION.md). Open items: add the `RADAR_GITHUB_TOKEN` secret, run the workflow once manually, and fix the Vercel deployment that has not completed since f22fd9d.
