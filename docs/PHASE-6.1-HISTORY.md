# PHASE 6.1 HISTORY (90-day trajectory)

Implementation: [src/history/index.ts](../src/history/index.ts), [components/Trajectory.tsx](../components/Trajectory.tsx), [lib/history.ts](../lib/history.ts) · public file `data/public/history.json` · quality tool: `npx tsx scripts/pipeline/history-quality.ts <repositories.json> [radar.json]`.

## 1. Where the history already existed (FACT)
Pipeline state file `data/repositories.json` (in the `data-state` release asset, not in Git). Each repository record holds `starHistory { source: github-star-history, fetchedAt, complete, firstDate, dailyGains[] }`: contiguous daily star gains starting at `firstDate`, built from GitHub's weekly buckets (30 weeks per page; the collector fetches one page, so at most about 210 days). `complete` is true only when the series reaches the repository's creation. The growth windows in `radar.json` are computed from exactly this series, so nothing was re-collected for Phase 6.1.

## 2. Measured quality (state of 2026-10-06, published records)
| Measure | Published (3,471) | AI scope (1,735) | All state records (3,958) |
|---|---:|---:|---:|
| History length p10 / p25 / p50 / p75 / p90 / max (days) | 31 / 205 / 206 / 206 / 210 / 210 | 23 / 105 / 205 / 206 / 210 / 210 | 31 / 205 / 206 / 209 / 210 / 210 |
| With at least 90 days | 2,979 (85.8%) | 1,325 (76.4%) | 3,314 (83.7%) |
| Younger than 90 days (short history is legitimate) | 501 | 417 | 653 |
| Insufficient (series shorter than min(90, age) minus 1 day) | 0 | 0 | 0 |
| Trailing gap (last value older than the collection date by more than 1 day) | 0 | 0 | 0 |
| Negative or non-integer values | 0 | 0 | 0 |
| `complete` (reaches creation) | 776 | 659 | 955 |
Gaps inside a series cannot occur: the series is a contiguous run from `firstDate`. The quality functions still detect the other cases and are unit-tested, because the collector could change.

## 3. Public format
`data/public/history.json` (compact JSON, committed by the pipeline, validated by the gate):
```
{ "schemaVersion": 1, "generatedAt": "...", "days": 90,
  "repositories": { "<repository id>": { "e": "2026-10-06", "g": [3,5,...] } } }
```
`g` is the last up to 90 daily gains, `e` the UTC date of the last value (the current day, which is a partial day). Only repositories in the AI scope (`AI` or `BOTH`) that are published get an entry (1,735 today); the scope is the `history.topLevels` setting in `config/pipeline.json`. No value is filled in: a series shorter than 90 stays shorter, and a repository without history has no entry.

## 4. Size
`history.json` is 366 KB compact (211 bytes per repository) against `radar.json` 3.65 MB. Home and Explore pages do not load it; a repository page embeds only its own entry (+about 2 KB gzip). The gate rejects a history file above 3 MB.

## 5. Traceability (gate)
For every entry the gate checks that `growth7d`, `growth30d` and `growth90d` in `radar.json` equal the sum of the last 7, 30 and 90 published daily values whenever the entry covers the window. On the real 2026-10-06 data all 1,735 entries agree. A mismatch fails the publish.

## 6. UI (minimal)
Repository page only: "Daily stars: is growth speeding up?" with 7 / 30 / 90 day buttons (native buttons, `aria-pressed`), inline SVG bars (no chart library), one summary line (total, average per day, peak day), and an accessible label for the chart. States stated in words, never as zeros: no entry ("No daily history is available"), series shorter than the repository's age ("Insufficient history: N of M days available"), repository younger than the window ("all N days of its life are shown"). The last bar is drawn lighter and labelled as a partial day.

## 7. Limits
Daily resolution in UTC; star history reflects stars currently held (un-starred users disappear from the past); only AI-scope repositories have trajectories; at most 90 days are published although about 210 are stored.
