# CLASSIFICATION

Implementation: [src/classification/](../src/classification/) · rules: [config/categories/ai.json](../config/categories/ai.json), [config/categories/engineering.json](../config/categories/engineering.json) (per-category `classification` blocks) · scoring: [config/classification.json](../config/classification.json) · CLI: `npm run classify` · tests: [tests/classification.test.ts](../tests/classification.test.ts)

Legend: **CONFIGURED** (a value in config, changeable without code) · **MEASURED** (observed on real data) · **ASSUMED** (a design choice not proven by measurement) · **UNKNOWN**.

## 1. Principle: discovery is not classification

GitHub Search finds *candidates*. It says nothing about what a repository is. The classifier never sees which query found a repository: its input type (`ClassificationInput`) has only `id, name, description, topics, language` and an optional `readme`. A test proves that two records that differ only in discovery provenance classify identically, and that a Kafka repository found by an AI query is ENGINEERING.

The classifier is a small deterministic rules engine: no LLM, no embeddings, no network, no clock, no randomness. Same input and same taxonomy give byte-identical output (tested, including topic-order independence). `classifierVersion` is `phase3-v1`; any rule or weight change must bump it.

## 2. Output

`ClassificationResult`: `classifierVersion`, `topLevelCategory` (`AI | ENGINEERING | BOTH | UNKNOWN`), `topLevel` (the domains behind it), `categories[]` (slug, name, domain, score, confidence, label), `confidence`, `positiveSignals[]`, `negativeSignals[]`, `classificationReason`, and `signals` = `{accepted, nearMisses, suppressed, context}` with the full structured evidence. The UI only needs `topLevelCategory` and `categories`; the rest is kept in `data/classified/classified.json` for debugging.

Example (real metadata, JavaGuide):

```json
{
  "classifierVersion": "phase3-v1",
  "topLevelCategory": "ENGINEERING",
  "topLevel": ["ENGINEERING"],
  "categories": [{ "slug": "java", "name": "Java", "domain": "engineering", "score": 8, "confidence": 0.5, "confidenceLabel": "medium" }],
  "positiveSignals": ["Java: strong topic \"java\" (+4)", "Java: name contains \"java\" (+3)", "Java: description mentions \"java\" (+3)"],
  "negativeSignals": ["Java: educational-content: topic evidence x0.5 (-2)",
                      "context educational-content: topics [interview] keywords [指南, 面试]"],
  "classificationReason": "ENGINEERING: Java (score 8; strong topic \"java\" (+4), name contains \"java\" (+3), description mentions \"java\" (+3))."
}
```

## 3. Taxonomy: 33 categories (unchanged from the product definition)

14 AI: AI Agents, LLM, RAG, MCP, AI Coding, Local AI, Multimodal, AI Infrastructure, AI Developer Tools, Machine Learning, Generative AI, AI Music, AI Image, AI Video.
19 Engineering: Java, Spring (slug `spring-boot`; display name changed from "Spring Boot" to match the product list), Microservices, Kafka, Kubernetes, Docker, AWS, Cloud, PostgreSQL, Redis, Databases, DevOps, Observability, Security, Distributed Systems, System Design, Developer Tools, Infrastructure as Code, Testing.

No category was added. Categories the data suggests might be missing (e.g. data engineering / workflow orchestration such as Airflow, web frameworks, blockchain) were **not** added; they simply classify as UNKNOWN or as their nearest category.

Every category has, in its `classification` block: `strongTopics`, `weakTopics`, `strongKeywords`, `weakKeywords`, `exclusionTopics`, `exclusionKeywords` (+ optional `languages` weights). The rules are ~1,000 terms total; the file `scripts/gen-classification-config.mjs` keeps them reviewable in one place, the JSON is the source of truth. Topic aliases were adapted from GitHub's github/explore topic pages (CC BY 4.0; see THIRD_PARTY.md). Terms were kept high-signal: specific tags (`llm-serving`, `apache-kafka`) are strong, generic ones (`ai`, `cloud`, `automation`, `docker-compose`) are weak or absent.

## 4. Signals and weights (CONFIGURED in `config/classification.json`)

For each category, points are summed over distinct evidence:

| Signal | Points | Notes |
|---|---:|---|
| Strong topic (repository tag in the category's strong list) | 4, then 2, then 1 | 1st, 2nd, 3rd distinct strong topic; further ones add nothing (repeated tags cannot explode a score) |
| Weak topic | 1.5 each, max 3 | supportive only |
| Repository **name** contains a strong keyword | 3 (once) | camelCase read both ways: "JavaGuide" -> `java`; "langchain" stays whole |
| Name contains a weak keyword | 1 | only if no strong name match |
| Description mentions a strong keyword | 3 each, max 2 | distinct terms only; "mcp" inside "mcp server" counts once |
| Description mentions a weak keyword | 1 each, max 2 | |
| Language relevance | per category (`languages`, e.g. Java 3, HCL 3) | never counts as identity evidence |
| README mentions a strong keyword | 1 each, max 2 | supported by the engine, **not collected by the pipeline** (see limitations) |
| Exclusion topic | −6 | |
| Exclusion keyword (name/description) | −4 each, max 2 | |
| Context discount | see §5 | |

Matching is on whole tokens/phrases (so `java` does not match "javascript", `learn` does not match "learning"), lower-cased; CJK terms match as substrings.

**Acceptance (CONFIGURED `acceptance`)** — a category is accepted only if **all** hold:
1. score >= **6**;
2. **identity evidence**: at least one strong topic or a strong name match (a description mention alone is never enough);
3. (optional, off by default) a lower score of 5 is accepted when two kinds of evidence agree — see §8.

**Confidence** = `score / (score + 8)` (score 8 -> 0.50; 16 -> 0.67; 24 -> 0.75), labels high >= 0.70, medium >= 0.50, else low. For BOTH it is the lower of the two domains' best confidences. UNKNOWN has confidence 0 / label `none`.

**Top level:** AI if only AI categories were accepted, ENGINEERING if only engineering ones, BOTH if both domains, UNKNOWN if none. **BOTH must be genuine:** if the weaker domain's best score is below **0.5x** the stronger's, its categories are *suppressed* (reported under `signals.suppressed` and as a negative signal) instead of forcing BOTH.

### Where the numbers came from (honest account)
The weights are **ASSUMED** starting values shaped by evidence, not fitted parameters:
- The 4/2/1 topic curve and the 6-point threshold came from inspecting classifier output on the authenticated 500-repository dataset (top-starred repositories, with real topics and descriptions) at thresholds 5, 5.5, 6, 6.5, 7. MEASURED counts (AI/ENGINEERING/BOTH/UNKNOWN): 203/186/28/83 at 5 (with identity rule, ratio 0.5), 194/181/25/100 at 5.5, **177/167/21/135 at 6**, 166/159/20/155 at 6.5, 161/149/18/172 at 7. Reading the marginal accepts at 5 (e.g. chatwoot -> Docker, a Python tutorial -> Databases, a job-search app -> AI Coding) showed weak-only and single-tag accepts, which motivated the identity rule and the 6 threshold.
- Playwright/Selenium/Puppeteer were moved from strong to weak Testing topics after Skyvern (browser automation) came out as Testing.
- The exclusion lists exist because of measured ambiguity: "MCP" = Minecraft Coder Pack, "agent" in `ci-agent`/`build-agent`/`user-agent`, "cursor" = mouse cursor, "video" in players/downloaders, "distributed" in blockchain.

**Contamination warning:** the rules were tuned while reading the same 500 repositories that supply most fixtures. Fixture results are therefore optimistic; the independent evidence is the sample review in §7.

## 5. Negative signals

Two mechanisms, both visible in the result:

1. **Exclusions** per category (topics/keywords above), e.g. "MCP" with `minecraft`, `agent` with `ci-agent`.
2. **Context signals** (global, `contextSignals`). Currently one: **educational-content** (topics `interview`, `tutorial`, `awesome`, `roadmap`, `course`... or keywords such as `interview`, `tutorial`, `roadmap`, `面试`, `教程`, `指南`). Interview guides, tutorials and curated lists *describe* subjects; their tags are often broad. When detected, **topic evidence is multiplied by 0.5** for all categories; name and description evidence are untouched, so a repository that genuinely is about the subject (its name/description say so) still classifies.

### The JavaGuide regression (why it exists)
In Phase 2, discovery tagged `Snailclimb/JavaGuide` as AI **and** engineering because it carries the `mcp`, `ai`, `agent`, `deepseek` and `springai` topics. It is a Java/backend interview guide with an AI-application chapter. A rule "keyword hit = category" would call it AI. Here: MCP has one strong topic (4 points, halved by the educational context to 2) and no name evidence, so it never reaches acceptance; Java has topic + name + description evidence. Result: **ENGINEERING / Java** (score 8). Tests (`JavaGuide regression`): not AI; explains itself with the educational-context signal; the `mcp` topic alone never makes a repository AI; result independent of discovery provenance.

## 6. Examples

| Repository (real metadata) | Result | Why |
|---|---|---|
| google/adk-python | AI: AI Agents | strong topics `ai-agents`, `agentic-ai`, description "building ... AI agents" |
| microsoft/playwright-mcp | AI: MCP (not Testing) | topic `mcp`, name `mcp`; `playwright` is only a weak Testing topic |
| vllm-project/vllm | AI: AI Infrastructure | topics `model-serving`, `llm-serving`; description "inference and serving engine for LLMs" |
| Snailclimb/JavaGuide | ENGINEERING: Java | see §5 |
| langfuse/langfuse | BOTH: AI Developer Tools + Observability | "agent evals & observability"; ratio 0.59 >= 0.5 |
| mastodon/mastodon | UNKNOWN | only technical tag is `docker` (one strong topic, 4 points) |
| opendataloader-pdf | UNKNOWN (expected AI) | `rag` (4) and `ocr` (4) are strong topics of two different categories; neither reaches 6 — a documented miss |

## 7. Measured quality (MEASURED; read the caveats)

### 7a. Curated fixture (25 real repositories, hand-labelled *before* running the classifier) — reproduce with `npx tsx scripts/classify/evaluate.ts`
Exact-outcome matches 24/25; all 25 within the acceptable outcomes. AI predicted 8 (precision 8/8), engineering predicted 14 (precision 14/14), false AI 0, false engineering 0, false negatives 1 (opendataloader-pdf), UNKNOWN rate 4/25 = 16%, BOTH rate 1/25 = 4%. **This is a fixture result on a set overlapping the tuning data; it is not production accuracy.**

### 7b. Independent-ish sample review on the full candidate set (4,397 candidates from a fresh discovery run)
Reviewer: the author, one person, judgments not ground truth; deterministic stride sample, restricted to repositories outside the 500 used for tuning.
- **Classified sample, n = 44** (AI/ENGINEERING/BOTH): clear false positives 2 (an Android launcher classified Java because of the `java` topic and Java language; a cancer knowledge-graph project classified MCP from an `mcp` topic plus description mention); borderline 2 (distrobox -> Docker, JRuby -> Java). Judged domain precision about **95%** (42/44 not clearly wrong).
- **UNKNOWN sample, n = 30:** about **12-13 of 30** were repositories a human would classify (e.g. couchdb -> Databases, kedro -> Machine Learning, grafana/beyla -> Observability); so a large share of UNKNOWN is abstention on real repositories: **recall is the weak side**. 984 of 4,397 candidates (22.4%) are UNKNOWN; if 40% of them were classifiable the missed share would be about 9% of all candidates (ESTIMATE from n = 30; wide uncertainty).
- These are opinions on small samples; they show direction, not accuracy.

### 7c. Experiment: corroborated lower threshold
Accepting score >= 5 when two evidence kinds agree recovered **201** more repositories (UNKNOWN->ENGINEERING 85, UNKNOWN->AI 86, AI->BOTH 20, ENGINEERING->BOTH 10). In a 40-item review of those additions, about 4 were clearly wrong (MaterialDrawer Android library -> Java, git-bug -> Distributed Systems, a User-Agent list -> Databases, an Obsidian plugin -> Databases) and about 4 borderline: roughly 10-20% wrong vs about 5% for the base rule. Because precision matters more than coverage, the rule is **implemented but disabled** (`corroboratedMinScore` = 6, equal to `minScore`); enabling it is a config change (tested).

## 8. Known limitations

- **README evidence is not collected**, so the README signal is untested on real data. Repositories with no topics and a short description are UNKNOWN. Adding README fetching would cost extra GitHub requests and is not justified by measurement yet.
- **Topics are owner-chosen and often promotional or wrong**; the design treats them as evidence, never truth. Repos that tag many providers/frameworks (LibreChat lists `aws`, `azure`, `mcp`) can get engineering categories from provider tags; the 0.5 BOTH ratio limits but does not remove this.
- **Application vs. tooling** is not separable by keywords: an Android app written in Java gets Java; a product that merely mentions "database" or "docker" may be tagged. The identity rule and exclusions reduce, not remove, this.
- **AI coding tools that are also developer tools become BOTH** (Claude Code utilities carry `developer-tools`). This matches the product definition of BOTH ("AI developer platform") but inflates BOTH: **243 of 4,397 (5.5%)** overall; 21 of 500 (4.2%) in the 500-set.
- **Language coverage:** English terms plus a handful of CJK terms (education signals, 系统设计). Non-English descriptions otherwise match only through topics.
- **Recall:** see §7b. UNKNOWN is a valid answer; it is not a failure of the pipeline, but 22% is high and partly wrong.
- The 3.2 KB/repository classified dataset (14.1 MB for 4,397) keeps full evidence for debugging; trimming is a Phase 4 candidate.
- Weights and thresholds are **ASSUMED**; the only calibration is the qualitative review above. Do not read `confidence` as a probability.
