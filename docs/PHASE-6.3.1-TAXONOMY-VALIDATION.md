# PHASE 6.3.1 TAXONOMY VALIDATION

Date 2026-10-10. Pack: `results/phase6.3.1/labelling/` (blind `sheet.csv`, `sample-key.json`, `README.md` for labellers). Code: `src/taxonomy/evaluation.ts`, `scripts/taxonomy/build-sample.ts`, `scripts/taxonomy/score-labels.ts`. Tests: `tests/phase631.test.tsx`, `tests/phase631b.test.tsx`. Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**.

## 0. Status in one paragraph
**Human labels: 0 of the required 200. The human-labelled evaluation has NOT been done.** What exists is (a) a stratified, blind labelling pack of 237 repositories with a validated scorer, and (b) a **preliminary** set of 237 labels written by the assistant that built the tooling (blind to the predictions). Those labels are **not human and not independent** and every score file says so. They are used to test the scorer and to find problem cases. They are **not** the evidence required for Phase 7, and no number below may be quoted as "measured precision against human labels". Stop condition 6 ("cannot obtain 200 valid labels") applies to human labels: **PHASE 7 NOT READY**.

## 1. Sample (FACT)
- **Frame:** 8,817 repositories: the 4,490 production candidates plus the 4,327 novel repositories found by the 66-topic Top-300 shadow discovery (so false negatives can be found among UNKNOWN and AI-classified repositories, and the novel pool is represented).
- **Stratified, disjoint strata** (first match wins; seeded; round-robin over small/medium/large × new/mature cells): messaging (Kafka, RabbitMQ, NATS, Pulsar) 13 of 111; Terraform 7 of 113; microservices 7 of 141; Spring 7 of 128; AWS 7 of 102; Redis 7 of 81; PostgreSQL 7 of 151; Kubernetes 7 of 218; Docker 7 of 111; databases (v1 category) 7 of 70; cloud (v1 category) 7 of 24; observability 7 of 120; infrastructure 7 of 75; developer tools 7 of 262; Java 7 of 78; **borderline weak technology evidence** 13 of 13; **predicted Engineering with no technology** 19 of 119; **predicted BOTH** 13 of 17; **predicted UNKNOWN** 28 of 1,018; **predicted AI** 17 of 1,483; **learning-flagged** 8 of 8; **novel Top-300**: Engineering 13 of 2,076, UNKNOWN 9 of 1,089, AI 6 of 1,162. **237 repositories.**
- **Coverage of requested properties:** size and age cells all present (mature: small 37, medium 48, large 62; new, under a year: small 34, medium 31, large 25); borderline, UNKNOWN and mature repositories included; no stratum consists of obvious cases only.
- **Weights:** stratum size over sampled count; estimates are weighted back to the frame; intervals use the raw sample size and are therefore conservative.
- The sheet contains **no prediction**; a test asserts the header and that every label column is empty.

## 2. Labelling schema (what a human fills in)
`domainEngineering` YES/NO/UNCERTAIN · `areas` (zero or more of the 8) · `technologies` (zero or more of the 46) · `learning` YES/NO/UNCERTAIN · `type` library/framework/tool/infrastructure/application/educational/other · `notes`. **A technology is labelled only when it is the subject of the repository** (a web application that merely runs in Docker is not a Docker repository). `UNCERTAIN` rows are counted and excluded from the metrics; invalid rows (unknown slug, areas on a not-Engineering repository, missing type) are reported, never repaired. Two labellers allow Cohen's kappa. Full instructions: `labelling/README.md`.

## 3. Metrics implemented (FACT, tested on fixtures)
Precision and recall are always reported together, with raw counts (true positives, false positives, false negatives, ambiguous), a Wilson 95% interval from the raw counts, and a weighted point estimate: for **domain** (binary), **area** and **technology** (multi-label, micro-averaged), **learning content** (binary), the **UNKNOWN rate** (weighted) and the share of labelled-Engineering repositories predicted UNKNOWN. Two scopes: **engineering-only** (what an Engineering Radar would contain; BOTH repositories rank with AI) and **engineering-or-both** (everything the taxonomy is applied to). With no labels every metric is `null`.

## 4. PRELIMINARY results (assistant-labelled, blind; NOT human, NOT independent)
Labels: Engineering YES 135 · NO 79 · UNCERTAIN 23; learning YES 39 · NO 195 · UNCERTAIN 3; types: tool 96, application 33, educational 38, infrastructure 23, library 20, framework 18, other 9. All 237 labels valid.
### Scope: engineering-only (the Engineering Radar population)
| Level | TP | FP | FN | Ambiguous | Precision: raw sample (weighted) [95% interval on raw] | Recall: raw sample (weighted) [95% interval on raw] |
|---|---:|---:|---:|---:|---|---|
| Domain | 115 | 11 | 20 | 23 | 0.913 (0.963) [0.850, 0.951] | 0.852 (0.774) [0.782, 0.902] |
| Area | 121 | 95 | 33 | 23 | 0.560 (0.658) [0.494, 0.625] | 0.786 (0.721) [0.714, 0.843] |
| Technology | 123 | 136 | 18 | 23 | **0.475** (0.583) [0.415, 0.536] | 0.872 (0.803) [0.807, 0.918] |
| Learning content | 25 | 3 | 14 | 3 | 0.893 (0.950) [0.728, 0.963] | 0.641 (0.844) [0.484, 0.773] |
UNKNOWN: **24.0%** of the weighted frame; among repositories labelled Engineering YES, **9.6%** (0.057–0.158) are predicted UNKNOWN.
### Scope: engineering-or-both (taxonomy applied to Engineering and BOTH)
Domain precision falls to 0.758 raw (0.829 weighted) because 28 of the 39 false positives are BOTH repositories that are AI agent tools; area precision 0.476 raw; technology precision 0.420 raw, recall 0.908 raw. (Under the Phase 6.3 adapter BOTH repositories rank with AI, so the engineering-only scope is the relevant one.)
### Reading (INFERENCE)
- **Domain** is fair: 91% precision on the Radar population; recall is held back by the UNKNOWN stratum (of the 20 domain false negatives, 13 were predicted UNKNOWN and 7 are BOTH repositories, which rank with AI).
- **Technology precision is poor under a subject-level definition (0.475 raw).** The cause is structural: the rule accepts a technology from a GitHub topic alone, and topics are mostly stack tags. A repository tagged `docker`, `postgresql` or `github-actions` gets the technology although it is an application that uses it. Recall is high (0.87) for the same reason.
- **Area precision (0.56)** inherits the same problem (areas come from technologies and from v1 categories): `cloud-native` is the worst (0.32), `observability` 0.37.
- The learning facet is precise but misses a third of learning content (recall 0.64 raw); its misses are example/practice repositories (`kafka-docker-playground`, `terraform-on-aws-ec2`, `SpringBootUnity`).

## 5. The 46 technologies (preliminary evidence; declared thresholds)
Verdict rule, declared before use: **insufficient evidence** if predicted + labelled < 5; **too broad** if precision < 0.6; **too narrow** if recall < 0.5 with at least 3 labelled; **useful** if precision ≥ 0.8 and recall ≥ 0.7; otherwise **ambiguous**. Counts are tiny per technology (the sample is stratified by group, not by technology), so every verdict is provisional.
| Technology | Predicted | TP | FP | Labelled | FN | Precision | Recall | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| spring | 9 | 5 | 4 | 6 | 1 | 0.56 | 0.83 | too broad |
| quarkus | 1 | 1 | 0 | 1 | 0 | 1.00 | 1.00 | insufficient evidence |
| micronaut | 1 | 1 | 0 | 1 | 0 | 1.00 | 1.00 | insufficient evidence |
| nodejs | 5 | 1 | 4 | 1 | 0 | 0.20 | 1.00 | too broad |
| python-web | 0 | 0 | 0 | 0 | 0 | n/a | n/a | insufficient evidence |
| dotnet | 4 | 3 | 1 | 3 | 0 | 0.75 | 1.00 | ambiguous |
| api | 8 | 3 | 5 | 3 | 0 | 0.38 | 1.00 | too broad |
| microservices | 10 | 5 | 5 | 6 | 1 | 0.50 | 0.83 | too broad |
| postgresql | 11 | 5 | 6 | 5 | 0 | 0.45 | 1.00 | too broad |
| mysql | 9 | 3 | 6 | 4 | 1 | 0.33 | 0.75 | too broad |
| sqlite | 7 | 4 | 3 | 4 | 0 | 0.57 | 1.00 | too broad |
| redis | 12 | 6 | 6 | 6 | 0 | 0.50 | 1.00 | too broad |
| mongodb | 5 | 2 | 3 | 2 | 0 | 0.40 | 1.00 | too broad |
| clickhouse | 2 | 2 | 0 | 2 | 0 | 1.00 | 1.00 | insufficient evidence |
| duckdb | 3 | 3 | 0 | 3 | 0 | 1.00 | 1.00 | **useful** |
| elasticsearch | 2 | 2 | 0 | 2 | 0 | 1.00 | 1.00 | insufficient evidence |
| data-processing | 1 | 0 | 1 | 0 | 0 | 0.00 | n/a | insufficient evidence |
| kafka | 11 | 8 | 3 | 9 | 1 | 0.73 | 0.89 | ambiguous |
| rabbitmq | 1 | 0 | 1 | 1 | 1 | 0.00 | 0.00 | insufficient evidence |
| nats | 1 | 1 | 0 | 1 | 0 | 1.00 | 1.00 | insufficient evidence |
| pulsar | 0 | 0 | 0 | 0 | 0 | n/a | n/a | insufficient evidence |
| kubernetes | 16 | 8 | 8 | 8 | 0 | 0.50 | 1.00 | too broad |
| docker | 20 | 10 | 10 | 11 | 1 | 0.50 | 0.91 | too broad |
| service-mesh | 0 | 0 | 0 | 0 | 0 | n/a | n/a | insufficient evidence |
| serverless | 5 | 1 | 4 | 1 | 0 | 0.20 | 1.00 | too broad |
| webassembly | 0 | 0 | 0 | 0 | 0 | n/a | n/a | insufficient evidence |
| ebpf | 1 | 1 | 0 | 1 | 0 | 1.00 | 1.00 | insufficient evidence |
| terraform | 8 | 4 | 4 | 4 | 0 | 0.50 | 1.00 | too broad |
| iac-other | 3 | 3 | 0 | 3 | 0 | 1.00 | 1.00 | **useful** |
| gitops | 4 | 2 | 2 | 2 | 0 | 0.50 | 1.00 | too broad |
| ci-cd | 11 | 1 | 10 | 2 | 1 | 0.09 | 0.50 | too broad |
| aws | 8 | 6 | 2 | 7 | 1 | 0.75 | 0.86 | ambiguous |
| azure-gcp | 7 | 3 | 4 | 3 | 0 | 0.43 | 1.00 | too broad |
| opentelemetry | 9 | 3 | 6 | 3 | 0 | 0.33 | 1.00 | too broad |
| prometheus | 5 | 2 | 3 | 2 | 0 | 0.40 | 1.00 | too broad |
| grafana | 4 | 2 | 2 | 2 | 0 | 0.50 | 1.00 | too broad |
| tracing-logging | 4 | 2 | 2 | 4 | 2 | 0.50 | 0.50 | too broad |
| observability-general | 10 | 1 | 9 | 1 | 0 | 0.10 | 1.00 | too broad |
| security-scanning | 13 | 3 | 10 | 3 | 0 | 0.23 | 1.00 | too broad |
| secrets-identity | 3 | 0 | 3 | 3 | 3 | 0.00 | 0.00 | too broad |
| supply-chain | 1 | 1 | 0 | 1 | 0 | 1.00 | 1.00 | insufficient evidence |
| testing | 7 | 4 | 3 | 7 | 3 | 0.57 | 0.57 | too broad |
| build-tools | 0 | 0 | 0 | 0 | 0 | n/a | n/a | insufficient evidence |
| cli-terminal | 11 | 6 | 5 | 8 | 2 | 0.55 | 0.75 | too broad |
| code-quality | 6 | 5 | 1 | 5 | 0 | 0.83 | 1.00 | **useful** |
| docs-tooling | 0 | 0 | 0 | 0 | 0 | n/a | n/a | insufficient evidence |
**Counts of verdicts:** useful 3 · ambiguous 3 · too broad 25 · insufficient evidence 15. **No technology is deleted and none is added on this evidence**: 15 have too little evidence, and "too broad" mostly reflects one cause (stack tags), not 25 independent defects.

## 6. Problem cases (FACT from the preliminary labels; 327 recorded for the engineering-only scope)
Technology false positives 136 (177 with BOTH) and false negatives 18 · area false positives 95 and false negatives 33 · domain false positives 11 · domain false negatives 20 (13 UNKNOWN, 7 BOTH; the UNKNOWN ones include `cfengine/core`, `octodns/octodns`, `pingcap/tiflow`, `salesforce/policy_sentry`, `umijs/qiankun`, `dotnet/ef6`, `cowrie/cowrie`, `mfaisalkhatri/selenium4poc` …) · learning false negatives 14 (11 listed as problem cases; three are on rows labelled UNCERTAIN for the domain) · learning false positives 3 (`Athena-OS/athena`, an operating system whose description says "learn"). Dominant patterns: (1) **stack tag treated as the subject** (`security-scanning` 13 predicted, 3 correct: it fires on `security`, `vulnerability` topics of AI agent tools; `ci-cd` 11 predicted, 1 correct: `github-actions` and `cicd` topics on unrelated tools; `observability-general` 10 predicted, 1 correct: `observability` topic on AI/LLM observability tools); (2) **AI tools inside BOTH** carrying Engineering technologies; (3) **concept without a product** (`secrets-identity`: JWT, OIDC lists and libraries were all missed or mislabelled); (4) **taxonomy gaps**: micro-frontends, DNS/network proxies, IDS/honeypots, ORM and database-migration tools have no technology (and sometimes no area).

## 7. Exploratory comparison (NOT a validated change; same assistant labels, split-half)
Two stricter acceptance rules were scored on the same preliminary labels, with an odd/even-id split to expose instability. **Because the labels come from the same party and the rules were looked at after the labels, this shows a trade-off, not an improvement to adopt.**
| Rule | Precision (raw) | Recall (raw) | Odd half (P / R) | Even half (P / R) |
|---|---:|---:|---|---|
| A current: a topic alone is enough | 0.420 | 0.908 | 0.441 / 0.865 | 0.400 / 0.955 |
| B: a topic AND a name or description match | 0.733 | 0.468 | 0.704 / 0.514 | 0.778 / 0.418 |
| C: stack-like technologies need the extra match, others unchanged | 0.672 | 0.610 | 0.672 / 0.608 | 0.672 / 0.612 |
(Technology level, repositories the v1 classifier calls Engineering or BOTH.) Corroboration roughly doubles precision and halves recall; there is no free gain. Which side of the trade-off the product needs ("technologies *about* X" or "repositories *touching* X") is a **product decision that needs human labels**.

## 8. Recommended changes (NONE APPLIED; taxonomy, classifier and thresholds are unchanged)
1. **Decide what a technology tag means** (subject vs stack) and write it into the taxonomy definition; the evidence says the current rule implements "touches", while the Engineering Radar needs "is about".
2. If "is about": require corroboration for stack-like technologies (rule C is the candidate), and re-measure with human labels. Do not adopt before.
3. Review the four concept tags with precision under 0.25 on this evidence (`ci-cd`, `observability-general`, `security-scanning`, `serverless`/`nodejs`): merge, narrow or drop only after human labels confirm.
4. Add technologies for the gaps found (database migration, micro-frontends, DNS/network tooling) **only if** human labels show enough repositories; do not expand to raise apparent recall.
5. Improve the learning facet's recall with an "examples/practice repository" rule; test on labels first.
6. Restrict technology and area assignment to repositories classified ENGINEERING (not BOTH) for the Engineering Radar, which is already the adapter's rule.

## 9. Decision
**PHASE 7 NOT READY on taxonomy evidence.** Required before the decision can change: (a) at least 200 valid **human** labels on this blind sheet (two labellers preferred), (b) the scorer run with `--kind human` for both scopes, (c) a decision on the meaning of a technology tag and, if changed, a held-out re-measurement. Even the preliminary, conservative reading (technology precision 0.475 raw) shows the taxonomy is not yet precise enough to publish technology-level claims.

## 10. Limitations
The preliminary labels are the assistant's; the definition of "subject of the repository" is strict and may differ from a human's; per-technology counts are small; the sample is stratified by technology group, so per-technology rates are noisy; labels were written from name, description and topics only (no README); the weighted estimates use conservative raw-count intervals and can fall outside them.
