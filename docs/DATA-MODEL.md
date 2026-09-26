# DATA MODEL

Source: [src/model/repositorySnapshot.ts](../src/model/repositorySnapshot.ts). Normalizers: [src/github/normalize.ts](../src/github/normalize.ts).

## RepositorySnapshot

One repository's state at one collection moment. Timestamps are ISO-8601 UTC strings.

| Field | Type | Required | Source (GraphQL / REST) | Notes |
|---|---|---|---|---|
| repositoryId | string | yes | `databaseId` / `id` | Numeric id as string. Stable across renames/transfers; the join key for history. Same value from both APIs (unit-tested with synthetic data; live confirmation pending). |
| owner | string | yes | `owner.login` / `owner.login` | |
| name | string | yes | `name` | |
| fullName | string | yes | derived `owner/name` | Display key only; may change on rename. |
| url | string | yes | `url` / `html_url` | |
| description | string \| null | yes | `description` | |
| stars | number | yes | `stargazerCount` / `stargazers_count` | |
| forks | number | yes | `forkCount` / `forks_count` | |
| openIssues | number | yes | `issues(states:OPEN).totalCount` / `open_issues_count` | **Not the same metric.** GraphQL = open issues only. REST = open issues + open PRs. Use `source` before comparing. History must come from one source (GraphQL). |
| language | string \| null | yes | `primaryLanguage.name` / `language` | |
| topics | string[] | yes | `repositoryTopics(first:20)` / `topics` | GraphQL capped at 20 (GitHub allows up to 20 topics per repo). |
| license | string \| null | yes | `licenseInfo.spdxId` / `license.spdx_id` | May be `NOASSERTION`. |
| createdAt | string | yes | `createdAt` / `created_at` | |
| updatedAt | string | yes | `updatedAt` / `updated_at` | Any repo activity; noisy. |
| collectedAt | string | yes | set by collector | When we fetched it. Snapshot time axis. |
| source | `'graphql' \| 'rest'` | optional | set by normalizer | Says how `openIssues` was counted. |
| pushedAt | string \| null | optional | `pushedAt` / `pushed_at` | Useful "last code push" signal. |
| defaultBranch | string \| null | optional | `defaultBranchRef.name` / `default_branch` | |
| lastCommitAt | string \| null | optional | `defaultBranchRef.target.committedDate` | GraphQL only. |
| commitsInWindow | number \| null | optional | `history(since:).totalCount` | GraphQL only, only when `commitsSince` is passed. Extra cost unmeasured. |
| isArchived, isFork | boolean | optional | | Needed later to exclude archived/forks from rankings. |

Deliberately excluded (not over-modelling): README text, contributors, watchers, release info, per-language byte counts.

## Not persisted yet
Storage layout (daily day-files, compaction) is designed in ARCHITECTURE.md §4 and is Phase 2 work. Phase 1 defines only the in-memory model and providers.

## Related types
- `RepositoryRef { owner, name }` - input to batch fetches.
- `StarHistorySeries` - validated weekly buckets (`weeks[]` ascending), `complete`, `pages`, `requests`, `bytes`, `rolloverDuplicates`, `restarted`, `fetchedAt` (see STAR-HISTORY.md). Stored datasets keep only per-day gains (see DATA-FORMAT.md).
- `SearchResult` - `totalCount`, `incompleteResults`, `repositories: RepositorySnapshot[]`, `pages`, `requests`.
- `FetchRepositoriesResult` - `snapshots`, `notFound`, `requests`, summed `cost`, last `rateLimit`.

## Providers (interfaces in [src/github/providers.ts](../src/github/providers.ts))
| Interface | Implementation | Transport |
|---|---|---|
| GitHubGraphQLProvider | GraphQLRepositoryProvider | GraphQL, aliased batch |
| GitHubSearchProvider | RestSearchProvider | REST `/search/repositories`, throttled 2.1 s between calls |
| GitHubStarHistoryProvider | RestStarHistoryProvider (`CachingStarHistoryProvider` decorator) | REST `GET /repos/{o}/{r}/stargazers/history`, anonymous or token |
| DiscoveryProvider | SearchDiscoveryProvider | Search API, configuration-driven (DISCOVERY.md) |

The Phase 1 stargazer providers were removed in Phase 2 (list endpoint restricted by GitHub since 2026-06-30; replaced by the star-history endpoint).

## Typed errors ([src/github/errors.ts](../src/github/errors.ts))
AuthenticationError, RateLimitError (resetAt, retryAfterSeconds, resource), NetworkError, InvalidResponseError, PaginationError (page), GitHubApiError (status, graphqlErrors). Nothing is swallowed: rate limits are surfaced, not retried silently. GraphQL partial errors are tolerated only when `type == NOT_FOUND` on a single alias.

## Logging ([src/github/logger.ts](../src/github/logger.ts))
JSON lines to stderr: `operation, repository, requests, durationMs, rateLimit, status, error`. Every line is passed through `redact()` (explicit secrets plus `ghp_/gho_/ghs_/github_pat_/Bearer` shapes).

---

# Phase 3 additions: candidate -> classified -> tracked

Identity is always the GitHub repository **id** (string). Each dataset stores only what it adds; joins are by id. Code: [src/collect/candidates.ts](../src/collect/candidates.ts), [src/classification/](../src/classification/), [src/tracking/](../src/tracking/).

| Dataset | Path | Contents | Written by |
|---|---|---|---|
| Candidates | `data/candidates/candidates.json` | `CandidateRecord`: id, owner, name, fullName, url, description, language, topics, license, dates, stars/forks/openIssues, `metadataSource`, and `discovery{domains, queryCategories, hits}` (provenance only) | `npm run collect -- --candidates-out ...` |
| Classified | `data/classified/classified.json` | `{id, fullName, result: ClassificationResult}` + summary + `classifierVersion` | `npm run classify` |
| Tracked | `data/tracked/tracked.json` | `TrackedRecord`: id, fullName, classification summary, tier, refreshIntervalHours, reason, signals, assessed, tierSince, lastEvaluatedAt, nextRefreshAt, transition + summary + `trackingVersion` | `npm run track` |
| Repository dataset (Phase 2) | `data/repositories.json` | star history + growth for repositories that were actually fetched | `npm run collect` |

`ClassificationResult` (see CLASSIFICATION.md): `classifierVersion, topLevelCategory (AI|ENGINEERING|BOTH|UNKNOWN), topLevel, categories[{slug,name,domain,score,confidence,confidenceLabel}], confidence, confidenceLabel, positiveSignals[], negativeSignals[], signals{accepted, nearMisses, suppressed, context}, classificationReason`.

The classifier's input type has **no discovery fields** by construction (`ClassificationInput`: id, name, description, topics, language, optional readme).

---

# Phase 4 additions: due collection and momentum

- **Tracking state:** `TrackedRecord.tier` is `HOT | WARM | DORMANT | UNASSESSED`. UNASSESSED = no star history measured yet (not a tier, never DORMANT). New field `lastCollectedAt` (when history was last collected; null for UNASSESSED). `summary.byTier` has four counts.
- **Repository dataset record:** new optional `growthAsOf` (instant the windows are anchored to) so one file can hold records collected on different days; older records use the dataset's `generatedAt`.
- **Momentum (internal)** `data/momentum/momentum.json`: `MomentumRecord` = growth windows (`w7/w30/w90`: growth, growthPercent, velocity, observedDays, full, status; null = not measurable, 0 = measured no growth) -> `MomentumSignals` (raw evidence) -> `MomentumScore` (score, components, multipliers, completeness) -> `trend` (RISING | COOLING | STEADY | INSUFFICIENT_DATA | EXCLUDED), `flags`, `rankMovement`, `explanation[]`, `summary`. Dataset also holds the configuration used and the lists `rising`, `movers`, `moversUp`, `moversDown`, `sustained`, `newEntrants`.
- **Public** `data/public/radar.json`: compact frontend contract (identity, url, trimmed description, language, stars, classification summary joined by id, growth7d/30d, velocity7d/30d, score, trend, flags, one-line summary; scored repositories only). Full evidence, star history, classified (14 MB) and tracked stay internal. See MOMENTUM.md section 6.
