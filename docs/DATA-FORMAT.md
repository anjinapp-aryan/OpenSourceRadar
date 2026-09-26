# DATA FORMAT

Produced by `npm run collect` ([scripts/collect/index.ts](../scripts/collect/index.ts) -> [src/collect/pipeline.ts](../src/collect/pipeline.ts)). Types and validator: [src/collect/dataset.ts](../src/collect/dataset.ts). Default output `data/repositories.json`. `schemaVersion: 1`.

## Design rules

1. **No duplication.** Repository metadata is stored once (built from the existing `RepositorySnapshot` model). Star history is stored as **per-day gains only**; cumulative counts are derivable (`stars at end of day d = repository.stars - gains after d`) and are computed on demand by `buildStarHistoryPoints`.
2. **Derived values are stored but verified.** `growth` (7/30/90 d) is convenient for later phases; the validator recomputes it from the stored gains and rejects any mismatch.
3. **Null means unknown.** A window without enough history has `status: "insufficient-history"` and null numbers, never 0.
4. **Deterministic.** Repositories are sorted by numeric `id`; identical inputs and clock give byte-identical files (tested). Arrays of numbers are written on one line to keep the file small.
5. **Never partial.** The file is written atomically (temp file + fsync + rename) and only after every gate passes (see below).

## Shape

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-24T16:18:44.865Z",   // clock used for all windows
  "asOfDate": "2026-09-24",                    // UTC date windows end on (today included, partial)
  "historyPagesPerRepository": 1,              // 1 page = 30 weeks; or "all"
  "stats": { "repositories": 12, "byDomain": { "ai": 12 } },
  "repositories": [
    {
      "id": "132464395",                       // GitHub numeric id (string); the dedupe key
      "owner": "Snailclimb", "name": "JavaGuide", "fullName": "Snailclimb/JavaGuide",
      "url": "https://github.com/Snailclimb/JavaGuide",
      "description": "…", "language": "JavaScript",
      "topics": ["agent", "…"], "license": "Apache-2.0",
      "createdAt": "2018-05-07T13:27:00Z", "updatedAt": "…", "pushedAt": "…", "isArchived": false,
      "stars": 158852, "forks": 46141, "openIssues": 20,
      "metadataSource": "rest",                // "graphql" | "rest" — how openIssues was counted
      "collectedAt": "2026-09-24T16:18:44.865Z",
      "domains": ["ai"],                       // discovery provenance, not final classification
      "categories": ["mcp"],                   // provisional discovery tags
      "starHistory": {
        "source": "github-star-history",
        "fetchedAt": "2026-09-24T16:17:46.000Z",
        "complete": false,                     // true when the whole repository life is covered
        "firstDate": "2026-03-01",             // UTC date of dailyGains[0]
        "dailyGains": [12, 9, 15, …]           // contiguous days, last = asOfDate
      },
      "growth": {
        "7d":  { "days": 7,  "status": "ok", "starsAgo": 158617, "growth": 235,  "growthPercent": 0.1482, "starsPerDay": 33.5714 },
        "30d": { "days": 30, "status": "ok", "starsAgo": 157841, "growth": 1011, "growthPercent": 0.6405, "starsPerDay": 33.7 },
        "90d": { "…": "…" }
      },
      "quality": []                            // warnings/errors only (info findings are not stored)
    }
  ]
}
```

(The example values are from the live run `results/live-collect-small.json`, MEASURED.)

### Window status

| status | meaning | growth / starsAgo / percent / perDay |
|---|---|---|
| `ok` | fully covered | all numbers |
| `zero-base` | 0 stars at window start (young repo or drift clamp) | growth, starsAgo (0), perDay numbers; percent **null** |
| `insufficient-history` | history does not cover the window (or no history) | all **null** |
| `inconsistent` | history implies negative past stars | all **null** |

## Fields deliberately not stored

Raw weekly buckets (`week`, `total`), cumulative points, contributors, README text, per-day history beyond the fetched pages, watchers (endpoint restricted by GitHub).

## Validation (`validateDataset`)

Checked before every write and on demand: schema version; ISO timestamps/dates; unique, numeric, **sorted** ids; `fullName == owner/name`; non-negative integer stars/forks/openIssues; `topics` strings; non-empty `domains`; `dailyGains` non-negative integers; history sum not above `stars` beyond the drift tolerance; **growth equals recomputation from `dailyGains`**; `stats.repositories == repositories.length`.

## Write gates (pipeline)

The dataset is written only if all of these hold; otherwise the existing file is untouched and the run exits non-zero (`CollectionAbortedError`, exit 3):

1. Discovery returned at least one repository.
2. No rate-limit or authentication error occurred (remaining work is skipped immediately, not after the batch).
3. Failures (`not found`, network, data-quality error) are at most `--max-failure-ratio` (default 5%) of selected repositories.
4. `validateDataset` passes.
5. The new file is not below 80% of the existing repository count (`--force` overrides).
6. Atomic replacement succeeds; on any error the temp file is removed.

## Size

MEASURED on the live 12-repository file (208 daily gains each): 56,978 bytes with one number per line, **34,488 bytes (2,874 B/repository) with number arrays on one line**. ESTIMATED by linear scaling: about 0.29 MB per 100, 1.4 MB per 500 and 2.9 MB per 1,000 repositories (descriptions and topics vary, so re-measure on a large run).

## Versioning

Any breaking change bumps `schemaVersion`. Consumers must reject versions they do not know.
