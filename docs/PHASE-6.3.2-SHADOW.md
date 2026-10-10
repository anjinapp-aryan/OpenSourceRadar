# PHASE 6.3.2 SHADOW (safety audit and 7-day plan)

Date 2026-10-10. Workflow `.github/workflows/shadow.yml` (untracked), code `scripts/shadow/`, `src/shadow/`. Tests `tests/phase632c.test.tsx` (static workflow checks, budget invariants), `tests/phase631b.test.tsx`. Evidence labels: **FACT · MEASURED · PROXY · INFERENCE · LIMITATION**.

## 0. Status ladder (never treat one step as another)
| Step | Status |
|---|---|
| LOCAL VALIDATED | **YES**: actionlint clean, 18 static and budget tests, one manual anonymous local run of discovery and one tracking day (6.3.1) |
| MERGED | **NO**: the file is untracked; nothing is committed |
| ENABLED | **NO**: `SHADOW_ENABLED` is not set; `RADAR_GITHUB_TOKEN` is not verified for this workflow |
| EXECUTED (on GitHub) | **NO** |
| OBSERVED | **NO**: 0 scheduled days |
| 7-DAYS COMPLETE | **NO**: 0 of 7 |
Verdict for this gate: **PENDING**. The 7-day shadow was not started by this phase and nothing in this document is a seven-day result.

## 1. Safety audit (D1 to D3), result: PASS for the workflow as written now
| Check | Finding | Evidence |
|---|---|---|
| actionlint | clean on `shadow.yml` and `radar.yml` (v1.7.12) | **FACT**, run 2026-10-10 |
| Inert by default | the job has `if: vars.SHADOW_ENABLED == 'true'`; no pull-request or push trigger | test |
| Permissions | `contents: write` only (needed to manage its own `shadow-state` release); no other scope | test |
| Write operations | `gh release upload shadow-state` and local files under `.shadow` / `.shadow-prod` only; no `git commit/push/add/checkout`, no `vercel`, no output path under `data/`, `public/`, `out/`, `.next/` | test + scripts refuse such paths (a test runs `track.ts` with `--shadow-dir data/...` and it exits non-zero) |
| Production state | only downloaded (`data-state`, into `.shadow-prod`), never uploaded, never over the checkout | test |
| Cannot modify `radar.json`, `history.json`, ranking, classification, tracking, taxonomy, UI | nothing in the workflow writes to those paths; the **Verify isolation** step fails the job if any tracked file changed or anything appeared under `data/` or `public/`; shadow code does not import production publication modules (test from 6.3.1) | **FACT (static)**; not exercised on GitHub (**LIMITATION**) |
| Checkout | `actions/checkout@v5`, default token handling; the job never pushes | test |
| Secrets in logs | no workflow-level `env`; `RADAR_GITHUB_TOKEN` is passed only to the two steps that run `discover.ts` and `track.ts`; `GH_TOKEN` (the job token) only to the three `gh` steps; nothing echoes a token, `printenv` or `set -x`; the scripts print no header or token (searched); GitHub masks secrets | test + code search |
| Secrets in artifacts and state | a **Secret scan of the evidence** step (credential-shaped text, `Authorization`, `Bearer`) runs before the state is saved and before the artifact is uploaded; the artifact holds only `.shadow/daily`, `discovery-*.json` and `cycle-summary.json` (no search cache, no pool snapshots, no production state) | test |
| Failure behaviour | no `continue-on-error`, no `always()`; state is saved only after tracking, isolation and the evidence scan all succeed, so a failed day leaves the last good state; 90-minute timeout | test |
| Concurrency | group `radar-shadow`, queued not cancelled: one shadow run at a time. It is a different group from production (`radar-pipeline`): they may overlap if production is delayed past 13:47 UTC; the budget below covers that | test |
| Third-party actions | only `actions/*` at a major version | test |

Hardening made in this phase (the file is shadow, not production): the token was previously workflow-wide (so `npm ci` and the isolation checks saw it); it is now step-scoped; the evidence scan step was added.

## 2. API budget (D4)
- **FACT.** Ceiling 2,000 requests a day, configured in `config/admission.json`, enforced at load (a configuration whose worst case exceeds it is refused) and never raised by code. Production average about 1,125 history requests a day; highest observed production day 1,795 (2026-10-09).
- **Defect found and fixed in review.** The 6.3.1 guard reserved `max(production recorded today, 1,125)` for production. If production had not recorded the day yet (late, failed, or still running when the shadow starts at 13:47 UTC), the guard assumed 1,125 and let the shadow spend 875, so a later 1,795-request production day would reach 2,670. The guard now reserves the **observed peak (1,795)** whenever production has recorded nothing for the day: shadow budget 205. When production has recorded the day, it reserves `max(recorded, 1,125)`. The shadow's own discovery search pages and rate-limit check are subtracted as well.
- **MEASURED (property test).** For every production load from 0 to 1,795 and both bases, production + shadow budget is at most 2,000 and never negative; a 1,795 day leaves 205 (56 on a Monday with 148 search pages); an 821 day leaves 875 (726 on a Monday).
- **Consequence (INFERENCE).** At the measured mix (0.506 history requests per repository per day, 150 admitted) the shadow needs about 76 requests a day in steady state and a first-fetch burst of 150 once, so it fits the worst-case 205. A pool of 600 would need about 304 a day: on a heavy production day it would defer part of its refresh (undone work stays due); this is expected and logged as `budgetStopped`.
- **LIMITATIONS.** (1) The guarantee holds while production stays at or below its observed peak; a new production peak is not predicted, only detected (the cycle summary raises a STOP when the observed maximum total reaches 90% of the ceiling, 1,800). (2) Production's own non-history requests (search about 99 a week, metadata) are not part of the 1,795 figure and are not counted. (3) Production's daily request count is estimated from the number of repositories whose `lastCollectedAt` is today (one history page each, `historyPagesPerRepository` is 1). (4) Actual scheduled usage has not been measured.

## 3. The 7-day plan (what happens after merge)
Human and calendar actions, in order: (1) commit and merge `shadow.yml` (and the code it runs) to `main`; (2) check that the `RADAR_GITHUB_TOKEN` secret exists and can read public repositories; (3) set the repository variable `SHADOW_ENABLED=true`; (4) run it once with `workflow_dispatch` and `discover=true` and read the job summary; (5) leave the schedule on for seven consecutive UTC days, which must include a Monday (the weekly discovery). Do not backfill or edit a day. The cycle is complete only with seven consecutive daily records and a discovery run (`scripts/shadow/cycle.ts`).

## 4. Daily evidence the run records (FACT: implemented and tested with synthetic records; no real day exists)
Per day, in `.shadow/daily/<date>.json` and `perDay` of `cycle-summary.json`: date; discovery strategy; search requests; unique repositories; new candidates; UNKNOWN; proposed, accepted and rejected admissions; cap hits (weekly, pool); HOT, WARM, DORMANT (and unassessed) counts; history requests; REST requests; GraphQL requests (0: the shadow uses REST only); total shadow API requests; production history requests that day; runtime; failures; retries; pool size; start time; whether the shadow started after production's last collection of the day (null when production recorded nothing); the budget the guard allowed and its basis. A value that was not recorded is null.
**Reading rules for the future report:** OBSERVED = counted by the run. PROXY = lifetime stars per day (a discovery and admission priority; it is **not momentum**), the admission precision review. INFERENCE = anything about whether the strategy improves discovery. The admission-quality review must be repeated on that week's admissions, by a person other than the author of the policy, to count as independent.

## 5. What is not known
Whether the workflow runs cleanly on GitHub (never executed there), actual API use over seven days, rate-limit behaviour with a real token, production-concurrent behaviour, history failures over time, admissions after the first week.
