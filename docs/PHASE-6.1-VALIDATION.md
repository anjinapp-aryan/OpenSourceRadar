# PHASE 6.1 VALIDATION REPORT: trust, data hygiene, explanation

Date 2026-10-06. Legend: **MEASURED** (observed in this run) · **ASSUMED** · **NOT DONE / UNKNOWN**. Status: **READY WITH LIMITATIONS** (see section 15; the updated GitHub workflow has not run on GitHub yet).

## 1. Baseline (before any change)
- Git: `main` = `origin/main` = `ea1aa69` (after pulling the bot's daily data commits); working tree held only the five uncommitted audit documents.
- Tests 387 passing in 16 files (7.4 s); `tsc --noEmit` clean; build passes in 23 s (127 MB static export, 1,692+ pages); `radar.json` 4,060,747 bytes pretty-printed, 3,957 records; tracked 3,471, measured 3,471; public records classified UNKNOWN 135, with no classification 351; Rising 39.
- Pipeline state (release asset, downloaded to a scratch folder): repositories 10.1 MB, classified 14.4 MB, candidates 5.3 MB, tracked 3.4 MB; state archive 3.63 MB.

## 2. Reuse audit
[PHASE-6.1-REUSE-AUDIT.md](PHASE-6.1-REUSE-AUDIT.md). Inline SVG, existing pipeline state and GitHub release assets reused; uPlot, Recharts and simple-statistics rejected for now with reasons; Scorecard and standard-readme reference only. **No dependency added.**

## 3. Data hygiene (lifecycle)
Explicit states ACTIVE, STALE, UNASSESSED, ORPHAN, EXCLUDED, ARCHIVED (`src/lifecycle/index.ts`, configuration in `config/pipeline.json`). Real data, 2026-10-06 (MEASURED): ACTIVE 3,471; STALE 0; UNASSESSED 0; ORPHAN 351; EXCLUDED 135; ARCHIVED 0 (one archived record in state is unscored and never published).
- **Why records went stale or orphaned:** the 135 EXCLUDED are candidates classified UNKNOWN, which tracking excludes by design, so they are never refreshed (growth data 7 to 11 days old at the time of the audit). The 351 ORPHANs are in pipeline state but not in the candidate set: weekly discovery replaces candidates and these repositories no longer match any query. They are real and active (for example `alirezarezvani/claude-skills`, `ItzCrazyKns/Vane`, `winfunc/opcode`, `neondatabase/neon`), so this is a **discovery-coverage gap**, not bad data.
- **Decisions:** ORPHAN, EXCLUDED, ARCHIVED and UNASSESSED are withheld from the public file (counted in `lifecycle.withheld`, never deleted from state, reversible); STALE would be published with a visible overdue note; none was retried or removed. None of the 486 withheld records was visible in the product (none was in the AI scope).
- **Missing data is never DORMANT:** DORMANT is a tracking tier, not a lifecycle state; a test asserts it. Missing windows stay `null`/"not available".
- Published records fell from 3,957 to 3,471 (-12.3%); the gate accounts for this (section 7).

## 4. Anomaly (growth-pattern) model
[PHASE-6.1-ANOMALY-MODEL.md](PHASE-6.1-ANOMALY-MODEL.md). Nine neutral patterns, deterministic order, thresholds from existing engine constants plus one explicit 100-star weekly floor added after the manual review found `jestjs/jest` (+48 in 7 days) and `dotnet/orleans` (+25) labelled Breakout. No repository is called fake, bought or fraudulent anywhere (a test scans the vocabulary).

## 5. "Why this is rising"
Pattern, evidence and status are separate and machine-readable (`pattern` in `radar.json`, `evidenceOf`, the engine's `trend`); `renderWhy` produces the lines from the record only. Tests: exact numbers, determinism, ordering, evidence-only property test (180 combinations), no contradictions, unavailable windows stated. Rendered live on every repository page, for example `vectorize-io/hindsight`: "Sustained climb", "+3,188 stars in 7 days (455/day)", "455/day over the last 7 days against 754/day over the previous 28 days (0.6×, slowing)", "sustained: ...", "context: 46,140 lifetime stars (not used in the score)".

## 6. Historical intelligence
[PHASE-6.1-HISTORY.md](PHASE-6.1-HISTORY.md). Measured quality: history length p10/p25/p50/p75/p90/max = 31/205/206/206/210/210 days (published); 85.8% of published and 76.4% of AI-scope records have at least 90 days; 0 insufficient, 0 trailing gaps, 0 invalid values. New public file `history.json` (366 KB, 1,735 AI-scope entries); 7/30/90-day trajectory on repository pages; for all 1,735 entries the published daily values sum exactly to the published `growth7d/30d/90d` (checked by the gate).

## 7. State backup and rollback
14 dated recovery points (`state-YYYY-MM-DD.tar.gz`) instead of one previous copy; pure pruning function unit-tested (5 tests) and exercised through the CLI on sample asset lists. Legacy `state-prev.tar.gz` is deleted only after two dated copies exist. Rationale and restore steps: [PHASE-6.1-OPERATIONS.md](PHASE-6.1-OPERATIONS.md). **NOT VERIFIED on GitHub:** the upload/delete steps have not run (no Actions access from this session).

## 8. Operations
[PHASE-6.1-OPERATIONS.md](PHASE-6.1-OPERATIONS.md). Findings (FACT from run history): scheduled runs start 5 h 36 min to 7 h 14 min after the configured time (09:52 to 11:30 UTC); Monday runs are **duplicated by design error** (two crons match Mondays: two runs, two data commits on 09-28 and 10-05). Fix: a single cron, discovery on Mondays inside the same run. The cause of the constant delay is **UNKNOWN**; the start time was left unchanged. The single-run Monday behaviour is **NOT YET OBSERVED**.

## 9. UI changes (minimal)
Repository page: "Why this is rising/cooling/steady" panel (pattern badge, status badge, evidence lines, neutral note), "Daily stars: is growth speeding up?" with 7/30/90-day buttons and an SVG bar chart; two outdated sentences corrected (the page said there was no history chart; the methodology page said the same). Cards show the pattern label instead of the acceleration prefix when a pattern exists (old datasets keep the previous text). No new cards or sections elsewhere; visual language unchanged.

## 10. Tests (MEASURED)
**441 tests pass in 17 files** (387 before, +54 in `tests/phase61.test.tsx`: patterns, explanation, lifecycle, history, public derivation, gate, state backups, UI). `tsc --noEmit` clean. No existing test was modified or removed; the one that checks the acceleration text on a card without a pattern passes unchanged because that text remains the fallback. Production build passes (13.5 s). Browser validation (`VALIDATE_OUT=results/phase6.1 node scripts/browser-validate.mjs`, normal and reduced motion): **60 page loads at 1440, 1280, 1024, 768, 390 and 375 px with 0 problems** (no horizontal overflow, clipped cards, console errors, external requests, text under 12 px, targets under 44 px). axe-core (wcag2a, wcag2aa, wcag21aa, best-practice): **0 violations** on 5 pages at 1440 and 390 px. Trajectory interaction: clicking "7 days" switches the chart label from "last 90 days: total 28,392" to "last 7 days: total 3,188" and sets `aria-pressed`. Screen reader not tested.

## 11. Real-data backtest (published 3,471 records, 2026-10-06)
| | All | AI scope | Rising (37) |
|---|---:|---:|---:|
| NORMAL_GROWTH | 2,229 | 1,037 | 0 |
| FLAT | 543 | 128 | 0 |
| NEW_LAUNCH | 384 | 310 | 9 |
| COOLING | 194 | 162 | 0 |
| ACCELERATING | 42 | 32 | 8 |
| SUSTAINED_GROWTH | 59 | 51 | 16 |
| SPIKE | 19 | 14 | 4 |
| BREAKOUT | 1 | 1 | 0 |
| INSUFFICIENT_HISTORY | 0 | 0 | 0 |
Rising repositories with a SPIKE flag: 4 of 37; removed if SPIKE were filtered: 4 (NEW_LAUNCH too: 13). **Rising eligibility was not changed** (decision C: Rising plus transparent flag). **Ranking invariants (MEASURED):** for all 3,471 retained records, score, trend and 7/30/90-day growth are identical to the previous production file; Rising went 39 to 37 only because two never-refreshed orphans (`alirezarezvani/claude-skills`, `tigerless-labs/agent-memory`) are now withheld.

## 12. Manual review (single reviewer, directional)
Details in PHASE-6.1-ANOMALY-MODEL.md section 6 and below. Top 20 Rising: agent and coding-agent tooling, nothing obviously spam; 4 spikes. Breakouts: now one (`HelpCode-ai/anythingmcp`). Oldest high-star: all NORMAL_GROWTH except tensorflow (COOLING). Youngest: all NEW_LAUNCH, two list-style (`xop01/ai_goodpractice`, `VoltAgent/official-mcp-servers`). Stale: none exist. Orphans (largest): PayloadsAllTheThings, glance, Vane, Anthropic-Cybersecurity-Skills, claude-skills, air, neon, opcode, react-testing-library, guiadevbrasil: all active, several AI-relevant, none archived. UNKNOWN (largest): awesome-selfhosted, deepseek-harness, prompts.chat, MoneyPrinterTurbo, **browser-use** (an AI agent project, clear classification false negative), puppeteer, uptime-kuma, storybook, opencv, cs-video-courses. Observed classification mistakes: `TheAlgorithms/C-Plus-Plus`, `learnopencv` (teaching collections in `machine-learning`), `pingcap/tidb` (`ai-agents`). Educational/list-style: 104 of 1,735 AI-scope records by heuristic, 1 of 35 Rising (`awesome-claude-skills`). Forks and mirrors: **UNKNOWN** (not stored in candidates). These are findings for taxonomy v2 and discovery work, not fixed here.

## 13. Security (MEASURED)
Built output and public data searched: token patterns 0; "Authorization"/"Bearer" 0; internal dataset or state names 0; `localhost:3000` 0 (when built with the production site URL; a plain local build uses localhost by design); `GITHUB_TOKEN` referenced in `app/`, `lib/`, `components/`: 0; no request to `api.github.com` in the output; the history file contains only dates and integers. No new external call and no new secret.

## 14. Performance (MEASURED)
| Item | Before | After |
|---|---|---|
| `radar.json` (compact, as committed) | 4.06 MB | **3.65 MB** (486 withheld records outweigh the `pattern` field) |
| `history.json` | n/a | 366 KB (1,735 entries, 211 B each) |
| Home page HTML | 163 KB / 19.7 KB gzip | unchanged |
| Explore page | 245 KB gzip | 247 KB gzip |
| Repository page | 23.6 KB / 4.9 KB gzip | 35.3 KB / 6.9 KB gzip |
| Static export | 127 MB | 148 MB |
| Build | 23 s | 13.5 s (measured on a warm machine; not a controlled comparison) |
| Test run | 7.4 s (387 tests) | 12.4 s (441 tests) |
Static export size grows about 12 KB per repository page; the Vercel limits for deployments of this size were **not verified** (also noted in STRATEGIC-AUDIT.md).

## 15. Known limitations
- Workflow changes untested on GitHub (see sections 7 and 8).
- 351 real repositories stopped being refreshed because discovery drops them; they are withheld, not recovered.
- Classification gaps unchanged (UNKNOWN 22.7% of candidates).
- Pattern labels use growth windows only (no forks, issues or single-day concentration); the 100-star floor and the 0.5 spike share are judgements, not calibrated against labelled data.
- History: AI scope only, 90 of about 210 stored days, daily resolution in UTC, current partial day included.
- Forks and mirrors cannot be detected from stored data.

## 16. Remaining risks
Discovery coverage (above); single upstream star-history endpoint; Git growth (`radar.json` plus `history.json` change daily, about 1 MB per commit combined, ASSUMED from the earlier 0.83 MB per commit); the first run of the new workflow may fail on a `gh release` detail that cannot be tested locally.

## 17. Exact changes
New: `README.md`, `config/pattern.json`, `src/explain/{pattern,render}.ts`, `src/lifecycle/index.ts`, `src/history/index.ts`, `src/pipeline/state.ts`, `lib/history.ts`, `components/{WhyPanel,Trajectory}.tsx`, `scripts/pipeline/{patterns,history-quality}.ts`, `tests/phase61.test.tsx`, `data/public/history.json`, five Phase 6.1 docs plus the five audit documents. Modified: `src/momentum/dataset.ts` (additive public fields and lifecycle filter; the engine and scoring files are untouched), `src/pipeline/gate.ts`, `scripts/momentum/index.ts`, `scripts/pipeline/index.ts`, `config/pipeline.json`, `.github/workflows/radar.yml`, `app/repo/[owner]/[name]/page.tsx`, `app/methodology/page.tsx`, `components/parts.tsx`, `app/globals.css`, `.gitignore`, `scripts/browser-validate.mjs`, `data/public/radar.json`, three older docs (additive notes). **Not touched:** `src/momentum/engine.ts`, `config/momentum.json`, classification, tracking, collection, discovery and provider code.

## 18. Git diff summary
44 files, +3,237 / -42 lines (including docs, tests and the regenerated public data). Nothing has been committed or pushed by this task.

## 19. Recommendation
**READY WITH LIMITATIONS.** The trust, history and explanation goals are met and verified locally and in a real browser; ranking is unchanged. Before calling the phase closed: commit and push, watch the next scheduled run (single Monday run, a dated state copy appears, pruning works), and decide the orphan/discovery-carry-over question (Phase 6.2 or 6.3).
