# PHASE 6.3 TAXONOMY v2

Date 2026-10-09. Definition: [config/taxonomy.v2.json](../config/taxonomy.v2.json) (`taxonomyVersion: 2`). Code: [src/taxonomy/index.ts](../src/taxonomy/index.ts). Validation: [scripts/taxonomy/validate.ts](../scripts/taxonomy/validate.ts) → `results/phase6.3/taxonomy-validation.json`. Tests: `tests/phase63.test.tsx`. Evidence labels: **FACT** (measured) · **INFERENCE** · **LIMITATION**.

## 1. Objective and boundary
Give every classified repository a deterministic **Domain → Area → Technology** position plus a few **facets**, without changing the v1 classifier, AI category semantics, the ranking or the public data. Everything is a pure function of stored facts (name, description, topics, language, age, the v1 result), with the evidence that caused each detection. No LLM, no network, no new dependency.

## 2. Model
```
Domain        AI | ENGINEERING                         (ranking population; BOTH ranks with AI, as on the public site)
  Area        ENGINEERING: 8 areas                      AI: the v1 category slug (unchanged; no AI technologies in Phase 6.3)
    Technology  46 curated technologies, each with topics, name tokens and description phrases
Facets      language · ageBand · contentType (software | learning) · lifecycle (existing)
```
Engineering areas: **backend** (Spring, Quarkus, Micronaut, Node.js, Python web, .NET, APIs, Microservices) · **data** (PostgreSQL, MySQL, SQLite, Redis, MongoDB, ClickHouse, DuckDB, Elasticsearch, data processing) · **messaging** (Kafka, RabbitMQ, NATS, Pulsar) · **cloud-native** (Kubernetes, Docker, service mesh, serverless, WebAssembly, eBPF) · **infrastructure** (Terraform, Ansible/Pulumi/CDK, GitOps, CI/CD, AWS, Azure/GCP) · **observability** (OpenTelemetry, Prometheus, Grafana, tracing/logging, general) · **security** (scanning, secrets/identity, supply chain) · **devtools** (testing, build tools, CLI/terminal, code quality, documentation tooling).

Changes from the Phase 6.1 proposal (`ENGINEERING-TAXONOMY.md`): *Languages and runtimes* is **not** an area (language is a facet); `java` becomes the language facet plus Spring/Quarkus/Micronaut technologies; `system-design` maps to **no area** (a concept/content category: `categoryToArea` value `null`); generic topics that matched noise in the pool were pruned (`operator`, `lambda`, `docs`).

## 3. Detection rule (deterministic, explainable)
A technology is accepted when its score reaches 3: **topic match 3**, **name-token match 2**, **description-phrase match 1**. So a topic alone is accepted; a name alone (2) is not; name plus description (3) is; a description phrase alone never is. The reply always names the topics, name tokens and phrases that matched. Matching uses the existing `TextIndex` (tokens, camelCase names, phrase containment). The area of a repository comes from its technologies, then from the v1 categories (`categoryToArea`).

## 4. Facets (only those with a deterministic source)
| Facet | Source | Implemented |
|---|---|---|
| language | GitHub `language` (Linguist output) | yes |
| ageBand | `ageDays`: emerging < 365, growing < 1095, established < 2920, mature | yes. **Age only**; no quality claim |
| contentType | v1 `educational-content` context OR `facets.learning` rules (topics 2, name 2, description phrases 1 each, max 2, minimum 2) | yes |
| lifecycle / archived / fork | existing lifecycle and discovery filters | already present; not duplicated |
| framework / library / tool / application | no reliable source in the data | **not implemented** |
| infrastructure vs application | no reliable source | **not implemented** |
| ecosystem | needs curated groups of technologies | **deferred** (Phase 7) |
Maturity is **not** a quality score; the repository page would say "created 11 years ago", not "mature software".

## 5. Measured behaviour (FACT, candidates of the 2026-10-07 state)
| Measure | Result |
|---|---|
| Engineering or BOTH repositories | 1,989 |
| With at least one technology | 1,721 (86.5%) |
| With at least one area | 1,978 (99.4%) |
| Technologies with ≥ 25 repositories | 33 of 46; none never matched |
| Broadest technologies | Kubernetes 17.0%, Docker 14.8%, PostgreSQL 9.9% |
| Age bands | emerging 299 · growing 200 · established 699 · mature 791 |
| Learning/list content flagged | 82 (4.1%) |

### Held-out validation against independent labels
Labels: OSS Insight curated collections (Apache-2.0; 30 engineering-family collections mapped by us to an area). The labels were produced by a different organisation, not by this tooling. A collection lists members of a technology family, so this measures **recall**, not precision.
| Measure | Result |
|---|---|
| Collection members | 654; in our candidate pool 282 (43.1%) |
| Of those, v1 UNKNOWN | 33 (11.7%) |
| Classified Engineering/Both | 243 |
| **Area correct** | **207 of 243 = 85.2%** (73.4% of all pool members, counting UNKNOWN as misses) |
| Technology correct, where a technology was expected | 44 of 46 = 95.7% |
| Learning facet: false positives on software-collection members | 2 of 217 = 0.9% (`requestly/requestly`; `lissy93/personal-security-checklist`, arguably a list) |
| Learning facet recall | **UNKNOWN**: only 1 labelled course repository is in the pool (flagged) |

## 6. Limitations
- **Precision of technology assignment is unmeasured** against independent labels (collections give positives only). Spot checks on the real pool found one family of false positives from tutorial repositories that list stack topics (for example `30-Days-Of-Python` carried `mongodb` and Python web); the learning facet now flags it and the Engineering ranking excludes learning content, but technology tags on such repositories remain.
- The collection → area mapping is ours (recorded in `scripts/taxonomy/validate.ts`); 11.7% of members are UNKNOWN to the v1 classifier and so get no technology at all.
- A human gold set (200 + 200) is still required before claiming ≥ 90% precision; Phase 6.3 does not claim it.
- The 8 areas and 46 technologies were chosen from what the pool contains; coverage of technologies absent from discovery (for example RabbitMQ 16, NATS 9, Pulsar 1, Micronaut 2 repositories: 13 of 46 technologies are below the 25-repository page threshold) depends on discovery topics, which Phase 6.3 does not change.
- AI technologies are not defined; AI areas are the v1 categories.

## 7. Versioning and compatibility
`taxonomyVersion: 2` is a separate file; `config/categories/*.json` and `config/classification.json` are unchanged (their SHA-256 is pinned by `results/phase6.3/ai-regression.json` and a test). Adding or renaming technologies changes only v2 outputs.
