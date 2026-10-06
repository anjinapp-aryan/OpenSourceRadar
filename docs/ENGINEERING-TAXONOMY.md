# ENGINEERING TAXONOMY

Date 2026-10-06. Evidence labels: **FACT** · **OBSERVATION** · **INFERENCE** · **RECOMMENDATION**. Counts come from the current public dataset (3,957 records) and the pipeline state asset (4,490 classified candidates), downloaded 2026-10-06. Nothing here changes the classifier; this is a design proposal.

## 1. What the data says about the current categories
| Finding | Evidence |
|---|---|
| 19 engineering categories plus 14 AI categories; 1,736 ENGINEERING + 253 BOTH repositories | **FACT** (public dataset) |
| 22.7% of 4,490 classified candidates are UNKNOWN (1,018); high-star UNKNOWN includes `browser-use` (116k), `puppeteer`, `uptime-kuma`, `storybook`, `opencv` | **FACT** |
| 351 public records have no classification and are not in the candidate set (orphans from earlier phases), plus 135 UNKNOWN: 486 records (12%) are untracked, with growth data a median 7.0 days old (max 11.4) while tracked ones are 0-3 days old | **FACT** |
| Biggest overlaps: `ai-agents`+`ai-coding` 135, `java`+`spring-boot` 80, `databases`+`postgresql` 76 repositories | **FACT** |
| 450 repositories carry three or more categories; 486 carry none | **FACT** |
| `system-design` is 42% educational/list-like by a name/description heuristic (`awesome`, `interview`, `tutorial`, `course`, `roadmap`, `guide`, `book`...); `machine-learning` 30%; `security` 15% | **FACT** (heuristic regex, indicative only) |
| Repositories carry on average 12.2 GitHub topics, none with zero topics (state dataset) | **FACT** |
| `java` (330 repositories) is a **language**, not a topic; the dataset already has a `language` field | **INFERENCE** |

## 2. Critique of the current 19
| Category | Verdict | Reason |
|---|---|---|
| java | **Convert to a language facet** | Repository language is already a field; a category of "written in Java" mixes Elasticsearch, Stirling-PDF and Mindustry |
| spring-boot | Keep as a **technology tag** (Spring) | Real ecosystem, strong topic identity |
| microservices | **Tag, not category** | Architectural style; weak identity, overlaps everything |
| kafka | Technology tag under Messaging and streaming | Narrow as a top-level category (68 repositories) |
| kubernetes, docker | Technology tags under Cloud native | Overlap heavily (Kubernetes 247, Docker 149) |
| aws | **Merge** into Cloud platforms tag | Vendor, not a technology area |
| cloud | **Remove as a category** | Generic; 119 repositories with no identity |
| postgresql, redis | Technology tags under Data and storage | Fine as tags |
| databases | **Split** | Too broad (205); needs relational, key-value/cache, analytics/OLAP, search, document/wide-column, streaming |
| devops | **Merge** with IaC and CI/CD into Infrastructure and platform | Overlaps IaC |
| infrastructure-as-code | Tag set (Terraform, OpenTofu, Pulumi, Ansible) | |
| observability | Keep as an **area** | Clear identity (OpenTelemetry, Prometheus, Grafana) |
| security | Keep as an **area, add tags** | 200 repositories mixing scanners, identity, secrets and awesome lists |
| distributed-systems | **Concept tag, not category** | 64 repositories; classification cannot tell a database from a consensus library from a course |
| system-design | **Not a technology: content type** (learning resource) | 42% educational; should be flagged, not ranked as a technology |
| developer-tools | **Too broad**, split into editors/CLI, build, testing, documentation | 150 repositories, a grab-bag |
| testing | Tag under Developer tools and quality | 152 repositories; broad |

**Categories that cannot be reliably classified from GitHub data alone (INFERENCE):** system-design, microservices, distributed-systems, cloud (generic), and the broad forms of security and developer-tools. Identity there is a concept, not a product.

## 3. Missing areas (candidates, not decisions)
Data and analytics engineering (ClickHouse, DuckDB, dbt, Airflow, Spark), messaging beyond Kafka (RabbitMQ, NATS, Pulsar), API and integration (gRPC, GraphQL, API gateways), service mesh and networking (eBPF), runtimes (WebAssembly, serverless, edge), platform engineering (internal developer platforms, GitOps), supply-chain security. Frontend frameworks (React, Vue, Angular) and mobile are plausible but outside the audiences identified so far; defer.

## 4. Recommended model: Domain → Area → Technology tag, plus facets
```
Domain (AI | Engineering)
  Area (about 9 per domain; derived from tags, never assigned directly)
    Technology tag (curated list with aliases, 40-100 total; a repository may have several)
Facets (independent of taxonomy): language, content type (software | learning resource | list), maturity, age band
```
Why: areas give stable navigation, tags give precise technology-level aggregation ("Is PostgreSQL rising as a technology?"), facets keep non-topical things (language, tutorial-ness) out of the category list. A repository belongs to the areas implied by its tags, so 450 "three-category" repositories stop being noise.

### Proposed Engineering areas (9)
1. **Backend and frameworks**: Spring, Quarkus, Micronaut, Node, Django/FastAPI, Go web, API (REST, GraphQL, gRPC, gateways); style tags: microservices, event-driven
2. **Data and storage**: PostgreSQL, MySQL, SQLite, Redis, MongoDB, Cassandra, ClickHouse, DuckDB, Elasticsearch/OpenSearch, data pipelines
3. **Messaging and streaming**: Kafka, RabbitMQ, NATS, Pulsar, stream processing
4. **Cloud native and containers**: Kubernetes, Docker/containers, Helm, service mesh, serverless, WebAssembly runtimes, eBPF; seeded from the CNCF landscape
5. **Infrastructure and platform**: Terraform, OpenTofu, Pulumi, Ansible, GitOps (Argo CD, Flux), CI/CD, platform engineering, cloud providers (AWS, GCP, Azure tooling), FinOps
6. **Observability and reliability**: OpenTelemetry, Prometheus, Grafana, tracing, logging, SRE, chaos
7. **Security and identity**: AppSec scanners, supply-chain security, secrets management, identity (OAuth/OIDC), DevSecOps
8. **Developer tools and quality**: editors/CLIs, build tools, testing, code quality, documentation generators, developer productivity
9. **Languages and runtimes** *(optional, only if a facet proves insufficient)*: JVM, Go, Rust, Python tooling, TypeScript/Node runtimes, .NET

Distributed systems, system design, microservices and "architecture" become **tags or content flags**, shown as filters, not as top-level pages.

### Proposed AI additions to evaluate (tag-first)
The AI list shows signs of lagging the field. OSS Insight's collection names (FACT, verified via API on 2026-10-06) include: LLM Inference Engines, LLM Fine-Tuning Tools, Vector Databases, AI Agent Memory, AI Evaluation and Testing, AI Observability, AI Browser Agents, Coding Agents, Agent Skills and AGENTS.md, Agent Harness, A2A Protocol, Agent Sandboxing, AI Gateways. **INFERENCE:** `ai-developer-tools` (52 repositories) is an under-defined bucket and `generative-ai` overlaps `ai-image`, `ai-video`, `ai-music` and `multimodal`. **RECOMMENDATION:** introduce these as tags first, measure how many repositories each captures, and promote only tags with at least 25 repositories.

## 5. Mapping from the current 19 to the proposal
| Current | Becomes |
|---|---|
| java | language facet + tag `jvm` |
| spring-boot | tag `spring` (Backend and frameworks) |
| microservices | tag (style) |
| kafka | tag (Messaging and streaming) |
| kubernetes, docker | tags (Cloud native and containers) |
| aws, cloud | tag `aws` + provider tags (Infrastructure and platform) |
| postgresql, redis | tags (Data and storage) |
| databases | split into Data and storage tags |
| devops, infrastructure-as-code | Infrastructure and platform |
| observability | area |
| security | area with tags |
| distributed-systems | concept tag |
| system-design | content type "learning resource" |
| developer-tools, testing | Developer tools and quality with tags |

## 6. Classification method (reuse first)
- **Seeds:** GitHub topics (every repository has them), github/explore aliases (CC-BY-4.0, already used), CNCF landscape names and categories (Apache-2.0) for cloud native, OSS Insight collection names as a cross-check only.
- **Rule engine:** keep the existing deterministic engine, with identity evidence required (as in Phase 3), but add `contentType` detection (awesome lists, tutorials, courses) as an independent flag rather than a discount only.
- **Do not use an LLM** to assign categories; use an LLM later, if ever, only to propose new tag candidates for human review.
- **Fix the false negatives first:** sample the 1,018 UNKNOWN repositories sorted by stars and by growth; many high-star ones are obviously classifiable.

## 7. Measurable acceptance for a taxonomy v2 (RECOMMENDATION, thresholds ASSUMED)
UNKNOWN share at most 10% of candidates and at most 3% of the top 500 by stars; precision at least 90% on a hand-labelled sample of 200 repositories per domain (stratified by area), recall at least 80% on a sample of 100 known-good repositories per area; at most 15% of repositories with 3+ areas; learning-resource flag recall at least 90% on 50 known awesome lists/tutorials.
