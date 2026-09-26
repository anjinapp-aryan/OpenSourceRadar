# PHASE 6 VALIDATION

Date 2026-09-26. Legend: **MEASURED** (observed) · **NOT DONE** (could not be performed here) · **ASSUMED**.

## Status: READY WITH LIMITATIONS
Implemented and locally validated: reuse audit, storage and cache strategy, rollback model, workflow, quality gate, atomic publish, production smoke test, run summary. **Not validated end to end**: no GitHub Actions run has executed yet, and production still serves the pre-fix build. Reasons and required actions are in section 6.

## 1. Starting state (MEASURED)
Git clean, `main` = `origin/main` = f22fd9d. Vercel: commit f22fd9d has **no deployment**; GitHub reports its Vercel status as `pending` for over an hour and the live site still shows `http://localhost:3000` in canonical, robots and sitemap (pages return 200). The Phase 5.5.1 fix is therefore **not live**. Phase 6 started with Vercel deployment verification pending, as anticipated; deployment logic was not rewritten.

## 2. What was built
| Piece | Location |
|---|---|
| Workflow (daily + weekly discovery + manual, concurrency, least privilege, dry run) | `.github/workflows/radar.yml` |
| Quality gate, coverage-regression protection, production page checks (pure, tested) | `src/pipeline/gate.ts`, thresholds in `config/pipeline.json` |
| CLI: preflight, validate, publish (atomic), summary, verify | `scripts/pipeline/index.ts`, `npm run pipeline:*` |
| Tests | `tests/pipelineGate.test.ts` (14) |
| Docs | PHASE-6-REUSE-AUDIT, -DATA-STORAGE, -CACHE-STRATEGY, -ROLLBACK, -OPERATIONS, this file |
No dependency added; no algorithm, classification, collector or UI code changed.

## 3. Real-data local pipeline run (MEASURED, real token in the process environment only)
preflight 0 (core 5000/5000) -> classify -> track (26 due) -> collect due (22 collected, 4 failures = not resolvable by GraphQL, 22 REST + 1 GraphQL request, 6 s) -> track -> momentum -> candidate `radar.next.json` -> gate **OK** in 13 s total. Compared with the committed dataset: repositories 3,546 = 3,546; tracked 3,413; measured 3,411; AI 1,685; Rising 35 -> 38 (the 7-day window moved forward in time; explained, not a defect); Cooling 195; Steady 3,316 -> 3,313; new entrants 293; sustained 164; movers 123. Public dataset 4.96 MB pretty, 3.62 MB compact, 0.64 MB gzip. Evidence: `results/phase6/`. The token did not appear in any output file. Working data files were then restored to the committed versions; the run's `radar.json` was not published.

## 4. Failure scenarios
| # | Scenario | Result |
|---|---|---|
| 1 | Valid collection | MEASURED: gate OK; `publish` wrote a compact copy atomically (3,617,992 bytes) |
| 2 | Malformed radar.json | MEASURED: `publish` exit 1, output file not created, known-good untouched (also 9 unit tests on structural rules) |
| 3 | Large coverage drop | MEASURED: a 900-repository candidate failed on repositories, tracked, measured and AI (-74.6%, -73.6%, -73.6%, -95.5% against a 10% limit), exit 1, no output (`results/phase6/gate-coverage-drop.json`) |
| 4 | GitHub API failure | MEASURED for auth: no token -> exit 1; invalid token -> "rejected (401)" exit 1; insufficient capacity -> exit 10 -> workflow skips (logic only, not triggered live) |
| 5 | GraphQL 504 | Existing behaviour, unit-tested in Phase 4.x (retry then split); no live 504 occurred in this run |
| 6 | Star-history partial failure | Unit-tested gate rule (measured share collapse fails); collector exit 3 path preserved; not reproduced live |
| 7 | Build failure | By construction: the commit step follows the build step. **NOT DONE** as a live test |
| 8 | Vercel deployment failure | By design (Vercel keeps the previous deployment). **NOT DONE**; and observed side note: the f22fd9d deployment did not complete |
| 9 | Concurrent runs | Configured (`concurrency` group, no cancel). **NOT DONE** live |
| 10 | Cache miss | The local run above started with no cache hits (0 hits, 22 misses) and worked; Actions cache miss not tested |

## 5. Checks (MEASURED)
`npm test`: 387 tests in 16 files pass. `tsc --noEmit`: clean. Workflow YAML parses (24 steps, triggers schedule + workflow_dispatch). Security: workflow permissions `contents: write` only, no pull_request trigger, token only via `secrets`/`github.token` environment, build-output audit step greps for token patterns, internal dataset names and localhost.

## 6. Not done and why (needs the owner)
1. **No Actions run.** `gh workflow run` returned 403: the available personal token has no Actions permission (it also cannot list secrets). Steps 19-24 (dispatch, observe, verify generated dataset, verify Vercel, verify production, enable schedule) are **NOT DONE**. The workflow is registered and active (`radar`, id 367612457).
2. **Add the repository secret `RADAR_GITHUB_TOKEN`** (fine-grained, public-read only). I did not copy your personal token into GitHub. Without it the workflow token (1,000 requests/hour) fails the preflight (needs 1,500), so scheduled runs will **skip safely** until the secret exists.
3. **First run:** Actions tab -> radar -> Run workflow, keep `dry_run` true, check the summary and gate table; then run once with `dry_run` false; the smoke test then confirms the production timestamp.
4. **Vercel is not deploying new commits** (f22fd9d, and now this one). Check the Vercel dashboard (build log, paused deployments, ignored-build-step, Git connection). Until a deployment succeeds, canonical/robots/sitemap on production still show localhost, and the workflow's smoke test will fail on them.
5. Optional variable `SITE_URL` (defaults to the production URL).

## 7. Production check (MEASURED, before this phase's push deployed)
Home, Explore, Methodology and a repository page return 200. Canonical, robots and sitemap use `http://localhost:3000` (fix pending deployment). Not re-verified after any new deployment.

## 8. Known limitations
- Weekly discovery replaces the candidate list; safeguarded only indirectly (tracked/AI drop checks).
- Data commit growth (about 100-300 MB/year worst case) is an estimate.
- Favicon `/favicon.ico` still 404 (icon served at `/icon.svg`); not addressed.
- `bojieli/ai-infra-book` still Rising: known domain-policy consideration; momentum engine unchanged.
- Cost estimate $0/month (public repository Actions, Releases, Vercel Hobby); not verified against billing.
