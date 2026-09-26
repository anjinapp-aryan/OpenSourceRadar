# DISCOVERY

Implementation: [src/discovery/](../src/discovery/) · configuration: [config/categories/ai.json](../config/categories/ai.json), [config/categories/engineering.json](../config/categories/engineering.json) · generator: [scripts/gen-category-config.mjs](../scripts/gen-category-config.mjs)

Legend: **MEASURED** / **ESTIMATED** / **UNKNOWN** as in STAR-HISTORY.md.

## 1. What discovery is (and is not)

Discovery finds *candidate* repositories with the GitHub Search API. It does **not** rank them and does **not** classify them finally. Search ranking is not trusted: every result is normalized, deduplicated, filtered and checked for relevance to at least one category of its domain. Momentum scoring and the final classifier are later phases.

## 2. Configuration-driven

No query text lives in code. Each domain file has:

```jsonc
{
  "schemaVersion": 1,
  "domain": "ai",                       // or "engineering"
  "discovery": {
    "minStars": 100, "freshMinStars": 25,
    "pushedWithinDays": 30, "createdWithinDays": 30,
    "perPage": 100, "maxPagesPerQuery": 1,
    "excludeForks": true, "excludeArchived": true
  },
  "categories": [{
    "slug": "ai-agents", "name": "AI Agents", "description": "…",
    "searchQueries": ["topic:ai-agents stars:>{minStars} pushed:>{pushedSince}", "…"],
    "keywords": ["ai agent", "agentic", "…"],   // matched against name + description
    "topics":   ["ai-agents", "agentic-ai", …]  // matched exactly against repository topics
  }]
}
```

Placeholders `{minStars} {freshMinStars} {pushedSince} {createdSince}` are expanded from `discovery` and a supplied clock (`expandQuery`); an unknown placeholder is a `ConfigError`. `parseCategoryConfig` validates everything (schema version, kebab-case unique slugs, non-empty queries, `perPage <= 100`, known placeholders) and reports the offending path. The shipped files are generated once by `npm run gen:categories` and are meant to be edited directly afterwards.

**Categories** (14 AI, 19 engineering — exactly the lists requested; a test pins them):

- AI: AI Agents, LLM, RAG, MCP, AI Coding, Local AI, Multimodal, AI Infrastructure, AI Developer Tools, Machine Learning, Generative AI, AI Music, AI Image, AI Video.
- Engineering: Java, Spring Boot, Microservices, Kafka, Kubernetes, Docker, AWS, Cloud, PostgreSQL, Redis, Databases, DevOps, Observability, Security, Distributed Systems, System Design, Developer Tools, Infrastructure as Code, Testing.

**Queries per category** (3 each, 99 total: 42 AI + 57 engineering): the first two GitHub topics as *established* queries (`stars:>100 pushed within 30 days`) and one *fresh* query (`created within 30 days, stars:>25`) so new repositories are not crowded out by old giants.

**Prior art:** category names, keyword and topic ideas were informed by the 15-category seed in GitHub-Trending-Intelligence (`infra/schema.sql`, MIT). No code was copied; the lists here are our own, extended to the requested 14 + 19 categories. Whether the topic strings we chose are the ones GitHub users actually apply is **UNKNOWN** for the rarer topics (`ai-music`, `singing-voice-synthesis`, …); the dry run below shows result counts per query.

## 3. Pipeline

`SearchDiscoveryProvider.discover(config, { now, categories, maxQueriesPerCategory })`

1. Expand and run each query (`sort=stars`, `per_page` 100, `maxPagesPerQuery` pages) through `RestSearchProvider` (min spacing 2.1 s with a token, 6.5 s anonymous). Transient errors are retried; a failed query is recorded in `stats.failedQueries` and the run continues. **A rate-limit or authentication error aborts the whole discovery** (later queries would fail too).
2. **Deduplicate by repository id**, never by `owner/name` (renames and transfers change the name; two ids may share a name over time). Tested.
3. Drop: below `min(minStars, freshMinStars)`, forks, archived — each counted in `stats.rejected`.
4. **Relevance check**: `matchingCategories` keeps a repository only if it matches at least one category of the domain by topic (exact) or keyword (substring of name + description). Repositories that match nothing are counted as `irrelevant`. These matches are stored as **provisional tags** (`categories`), *not* a final classification.
5. Deterministic order: stars descending, then id ascending.
6. `mergeCandidates` merges AI and Engineering results by id: domains and categories are unioned, hit counts summed, the newest snapshot wins.

## 4. Known limitations (MEASURED where noted)

- **Tangential topics leak in.** In the live run `Snailclimb/JavaGuide` (a Java interview guide) entered the AI domain through the `mcp` topic. Relevance here means "carries a category's topic or keyword", not "is about AI". The final classifier must decide.
- Search returns at most 1,000 results per query and `sort=stars` favours large old repositories; `maxPagesPerQuery: 1` (100 results) is a deliberate cost limit.
- Search results carry REST metadata (`source: "rest"`): `openIssues` includes pull requests. With a token the collector replaces metadata with GraphQL (`source: "graphql"`); anonymous runs keep the search metadata.
- Anonymous search is 10 requests/minute; a full 99-query run takes about 11 minutes anonymously (MEASURED: see PHASE-2-VALIDATION.md). With a token the limit is 30/minute (DOCUMENTED, not measured).
