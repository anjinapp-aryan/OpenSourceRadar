# PHASE 6.1 OPERATIONS

Supersedes the schedule and backup parts of PHASE-6-OPERATIONS.md and PHASE-6-ROLLBACK.md. Legend: **FACT** · **INFERENCE** · **ASSUMED**.

## 1. Schedule: what is configured, what happens, what changed
**Configured (Phase 6):** `17 4 * * *` (daily) and `47 3 * * 1` (Mondays, intended as "daily run plus discovery").

**Observed** (GitHub run history, 12 scheduled runs, 2026-09-27 to 2026-10-06, FACT; UTC):
| Date | Start times | Lateness against the configured cron |
|---|---|---|
| 09-27 | 10:00 | 5 h 43 min |
| 09-28 (Mon) | 10:10 and 10:55 | 6 h 24 min (Monday cron), 6 h 39 min (daily cron) |
| 09-29 | 10:41 | 6 h 25 min |
| 09-30 | 10:30 | 6 h 13 min |
| 10-01 | 10:58 | 6 h 41 min |
| 10-02 | 10:31 | 6 h 14 min |
| 10-03 | 09:52 | 5 h 36 min |
| 10-04 | 10:35 | 6 h 18 min |
| 10-05 (Mon) | 10:52 and 11:30 | 7 h 05 min (Monday cron), 7 h 14 min (daily cron) |
| 10-06 | 11:17 | 7 h 00 min |

**1. Is it queue delay?** Consistent with GitHub's documented behaviour that scheduled runs can start late under load; a delay of 5.5 to 7 hours every day is far beyond what the documentation suggests as typical, and the cause cannot be determined from our side (INFERENCE). It is stable, not random: data therefore refreshes at roughly 10:00 to 11:30 UTC, not at 04:17. Runs take 2 to 11 minutes after starting.
**2. Are the Monday duplicates intentional?** No. They are a design flaw of Phase 6: both crons match Mondays, so two runs and two data commits happened on 09-28 (`7946f88`, `87a18ac`) and 10-05 (`0a1e70b`, `0107d36`). The first (with discovery) took about 9 to 10 minutes, the second about 2 minutes and produced its own data commit.
**3. Is the second commit needed?** No: the daily data is rebuilt from the same inputs a few minutes later.

**Change made (smallest correction):** one cron, `17 4 * * *`. The Prepare step turns discovery on when the run is scheduled and the UTC weekday is Monday (`date -u +%u`), or when requested by `workflow_dispatch`. Discovery still happens weekly, with one run and one commit per day. The start time was not changed: moving it would not fix a delay whose cause is unknown, and the time the site shows ("Updated ...") is the real data time. **To verify after the next Monday (not yet observed):** exactly one run and one data commit on a Monday, with discovery in the log.

## 2. Pipeline-state backups
**Before:** `state.tar.gz` plus `state-prev.tar.gz`, overwritten on every run: rollback depth one run.

**Now:** each run uploads `state-YYYY-MM-DD.tar.gz` (UTC date; if a day has two runs the later one replaces the earlier) in addition to the live `state.tar.gz`, then deletes older dated copies beyond the newest **14**. The decision is made by a pure function (`src/pipeline/state.ts`, unit-tested) fed with `gh release view data-state --json assets`:
- only `state-YYYY-MM-DD.tar.gz` names are ever pruned; `state.tar.gz` and unrelated assets are never touched;
- at least one dated copy is always kept;
- the legacy `state-prev.tar.gz` is deleted only once two dated copies exist, so the rollback depth never shrinks during the transition.

**Why 14:** a bad dataset reaches production only if the quality gate passes it; the realistic failure is something subtle noticed within days, so two weeks gives recovery points across a full discovery cycle (weekly) with margin. Cost: about 3.6 MB per copy, about 50 MB for 14, inside release storage with no billing. Retention is one explicit number (`state.keepDaily` in `config/pipeline.json`). Not implemented, by choice: longer retention, weekly or monthly thinning, copies outside GitHub.
**Restore:** download the wanted `state-YYYY-MM-DD.tar.gz` from the `data-state` release, upload it as `state.tar.gz` (`gh release upload data-state state-2026-10-01.tar.gz#state.tar.gz` style renaming, or rename locally and upload with `--clobber`), then run the workflow. Not exercised live yet (the first dated copy appears on the first run of the new workflow).

## 3. Lifecycle (what happens to records)
| State | Meaning | Published | Refreshed |
|---|---|---|---|
| ACTIVE | tracked, collected on schedule | yes | yes |
| STALE | tracked, collected longer ago than 2 refresh intervals + 24 h | yes, with a visible "overdue" note | yes |
| UNASSESSED | tracked, no history yet | no (nothing to rank) | yes |
| ORPHAN | has history but is not in the discovery candidate set | no | **no** |
| EXCLUDED | candidate, classification UNKNOWN, so not tracked | no | no |
| ARCHIVED | archived on GitHub | no | no |
Nothing is deleted from pipeline state; withholding is reversible (a record returns when it is rediscovered or classified). Missing or old data is never converted into DORMANT or zero growth. On 2026-10-06: ACTIVE 3,471, STALE 0, ORPHAN 351, EXCLUDED 135, withheld 486 (12.3% of the previous file).

**Why records become orphans (INFERENCE from the data):** weekly discovery replaces the candidate set with what the queries return that week. Repositories that no longer match any query (for example fall outside the recency or star windows) disappear from candidates while their history stays in state. They are real, active repositories: the 10 largest orphans include `swisskyrepo/PayloadsAllTheThings`, `ItzCrazyKns/Vane`, `mukul975/Anthropic-Cybersecurity-Skills`, `alirezarezvani/claude-skills`, `neondatabase/neon` and `winfunc/opcode`. They were never visible in the product (no classification), so withholding changes nothing users see, but it shows a **discovery coverage gap**. Carrying previously discovered candidates over for a retention period would fix it; that changes discovery semantics and is left for a later phase.

## 4. Quality gate additions
`repositories` is judged through `accounted` (published plus withheld), so a deliberate withholding is not mistaken for a collapse while a real loss still fails (tested). The gate also fails when a stored `pattern` differs from its recomputation, when `lifecycle` or `pattern` values are invalid, and when `history.json` is malformed, oversized, or disagrees with the growth windows. All earlier thresholds are unchanged.

## 5. Commands (actual)
`npm run momentum -- ... --public data/public/radar.next.json` (also writes `history.next.json` next to it), `npm run pipeline:validate`, `npm run pipeline:publish`, `npm run pipeline prune-state` (stdin JSON), `npm run pipeline state-name`, `npx tsx scripts/pipeline/patterns.ts`, `npx tsx scripts/pipeline/history-quality.ts`.

## 6. Not verified here
The updated workflow has **not run on GitHub yet**: YAML syntax was checked locally, the pruning logic is unit-tested and was exercised on sample input through the CLI, and every pipeline stage was run locally against the real pipeline state, but the `gh release` upload/delete steps and the single-cron Monday behaviour can only be confirmed by the next scheduled runs.
