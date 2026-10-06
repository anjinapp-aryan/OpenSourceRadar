# PHASE 5 DATA CONTRACT — `data/public/radar.json`

Inspected from the real generated file (generated 2026-09-26T02:52Z, 3,546 repositories). `schemaVersion` stays **1**; Phase 5 made only **additive** changes (below). Producer: `derivePublic()` in [src/momentum/dataset.ts](../src/momentum/dataset.ts), written by `npm run momentum`. Consumer: [lib/radar.ts](../lib/radar.ts) (build time, server side only). The frontend reads no other dataset.

## Top level
| Field | Type | Notes |
|---|---|---|
| schemaVersion | `1` | Loader rejects anything else with a visible error |
| momentumVersion | string (`v1`) | |
| generatedAt | ISO string | Shown as "Updated"; staleness computed against build time (72 h) |
| lists.rising / sustained / newEntrants | id[] | Ordered by the Phase 4 engine |
| lists.movers / moversUp / moversDown | `{id, direction, velocityDelta, rankDelta}[]` | velocityDelta = stars/day now minus previous 28 days |
| repositories | PublicRepository[] | Scored repositories only |
| categories *(added)* | `{slug, name, domain}[]` | 33 entries from `config/categories/*.json`; the UI uses the 14 with domain `ai` |
| stats *(added)* | `{tracked, measured, unassessed}` | From tracked dataset: 3,413 / 3,411 / 2. Optional; UI hides the tiles if absent |

## PublicRepository
Existing (Phase 4): `id, fullName, url, description (<=140 chars), language, stars, classification {topLevel: AI|ENGINEERING|BOTH|UNKNOWN, categories: slug[]} | null, growth7d, growth30d, velocity7d, velocity30d, score, trend (RISING|COOLING|STEADY|INSUFFICIENT_DATA|EXCLUDED), flags {rising, sustained, newEntrant, mover: UP|DOWN|null}, summary`.

Added in Phase 5 (all derived from internal momentum records, nothing recomputed): `growth90d, velocity90d, growthPercent7d, priorVelocity, accelerationRatio, velocityDelta, ageDays, explanation: string[]`, and optional `tier` (HOT|WARM|DORMANT|UNASSESSED, from tracked dataset). Growth values are `null` when not measurable, which the UI prints as "n/a" and never as 0.

## Gaps found and how they were handled
| UI need | In the Phase 4 file? | Resolution |
|---|---|---|
| 90d growth, acceleration, previous velocity, age | no | additive fields (above) |
| Explanation lines | only one-line `summary` | additive `explanation[]` (Phase 4 engine text, verbatim) |
| Tracked vs measured counts | no | additive `stats` |
| Category display names | slugs only | additive `categories` |
| Tracking tier | no | additive optional `tier` |
| Daily star series for a chart | no | **not added**: detail page shows the windows; no chart (spec: do not widen Phase 4 for a chart) |
| Age of a new entrant | no | `ageDays` |

## AI scope
AI Radar shows repositories with `classification.topLevel` of `AI` or `BOTH` (1,442 + 243 = 1,685 of 3,546). `ENGINEERING`, `UNKNOWN` and unclassified are excluded from every AI list (for example awesome-selfhosted is Rising in the data but not in AI Radar). Scope is a UI filter only; the dataset and Phase 4 lists are unchanged.

## Size
File is 4.9 MB pretty-printed and is only read at build time; the browser never downloads it. Shipped payloads are in PHASE-5-VALIDATION.md.

---

## Phase 6.1 additions (additive; `schemaVersion` stays 1)

**`radar.json`**
| Field | Where | Meaning |
|---|---|---|
| `pattern` | each repository | One of `INSUFFICIENT_HISTORY, NEW_LAUNCH, FLAT, SPIKE, COOLING, BREAKOUT, ACCELERATING, SUSTAINED_GROWTH, NORMAL_GROWTH`. Recomputable from the record's own fields with `config/pattern.json` (the gate verifies it). See PHASE-6.1-ANOMALY-MODEL.md |
| `lifecycle` | a repository, only when `"STALE"` | The record is published but overdue for refresh. Absent means ACTIVE |
| `patternVersion` | top level | Version of the pattern model (`p1`) |
| `lifecycle` | top level | `{ counts: {ACTIVE, STALE, UNASSESSED, ORPHAN, EXCLUDED, ARCHIVED}, withheld }`: records that were scored but deliberately not published (ORPHAN, EXCLUDED, ARCHIVED, UNASSESSED) are counted here, not lost |
Consumers that ignore these fields keep working. **Migration note:** published `repositories` dropped from 3,957 to 3,471 on 2026-10-06 because 486 never-refreshed records are now withheld (351 orphans, 135 UNKNOWN-classified); none of them was in the AI scope. The quality gate judges `repositories` through `published + withheld`.

**`history.json`** (new public file, optional for consumers): `{ schemaVersion: 1, generatedAt, days: 90, repositories: { "<id>": { e: "<UTC date of last value>", g: [daily star gains, oldest first, at most 90] } } }`. AI-scope published repositories only. See PHASE-6.1-HISTORY.md.
