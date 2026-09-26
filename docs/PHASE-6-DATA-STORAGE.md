# PHASE 6 DATA STORAGE — the 46 MB problem

Measured 2026-09-26: `data/` 46 MB, `results/` 23 MB, `.cache/` 12 MB, `.git` 24 MB (compressed history), `node_modules` 430 MB (never committed).

| File | Size | Class | Needed by | Future storage |
|---|---:|---|---|---|
| data/classified/classified.json | 14.1 MB | D internal working | tracking, momentum public join | **State asset** (release `data-state`); regenerated daily by `npm run classify` from candidates |
| data/momentum/momentum.json | 11.1 MB | D internal, fully derived | nothing downstream | **Not stored**: regenerated every run, discarded |
| data/repositories.json | 9.2 MB | E historical growth state (daily gains, `growthAsOf`) | due collection merges into it; momentum | **State asset** (only replaceable by re-collecting from GitHub) |
| data/candidates/candidates.json | 5.2 MB | D internal | classify, track | **State asset** |
| data/public/radar.json | 4.96 MB pretty, **3.6 MB compact, 0.64 MB gzip** | C public | the site | **Git** (compact form; the only committed data file) |
| data/tracked/tracked.json | 3.3 MB | D internal (tier history, hysteresis) | tracking reads the previous file | **State asset** |
| .cache/sh-due.json | 12 MB | F cache (TTL 6 h) | resume only | actions/cache, same-day key |
| results/* | 23 MB | G evidence of past phases | humans | stays in Git as a record; the pipeline adds nothing to it |
| config/, src/, app/, docs/ | small | A/B | | Git |

## Decision
- **Git holds:** code, configuration, docs and exactly one generated file, `data/public/radar.json` (compact: 3.6 MB raw, 0.64 MB compressed). A commit is made only when the file changed, and daily changes are small deltas, so growth is estimated at roughly 100-300 MB per year in the worst case (ASSUMED, not measured over time).
- **Release asset `data-state`** (tag `data-state`, overwritten each run, previous copy kept as `state-prev.tar.gz`): candidates, classified, tracked, repositories (about 31 MB raw, roughly 5 MB gzip). Free, no Git history growth, one file to roll back.
- **Actions cache:** star-history cache for same-day resume only.
- **Artifact only (failed runs, 7 days):** gate report, run JSON, candidate public dataset.
- **Regenerated / discarded:** momentum.json, radar.next.json, step logs.
- **Existing committed internal files are NOT deleted.** They remain as the bootstrap seed for the very first run. After the first scheduled run has saved the `data-state` release they can be removed from the tree (`git rm --cached` plus .gitignore) as a separate, reviewed change. That does not shrink history (24 MB compressed, acceptable); a history rewrite is not recommended.

## Retention
| Data | Retention |
|---|---|
| public radar.json | every change is a commit (kept, small) |
| state asset | latest + previous (2 copies) |
| Actions cache | GitHub evicts after 7 days unused |
| failure artifacts | 7 days |
| historical analysis | daily gains per repository are inside `repositories.json`; no separate history store is needed for Phase 6 |

## Cost and rollback
$0 (public repository: Actions minutes free; releases and cache within quota). Data rollback: `git revert` the data commit, or restore `state-prev.tar.gz` (PHASE-6-ROLLBACK.md).

## Risk
Release assets of a public repository are publicly downloadable. The state holds only data derived from public GitHub metadata (no tokens; logs redact them).
