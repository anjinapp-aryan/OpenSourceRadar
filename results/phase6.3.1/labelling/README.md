# Engineering taxonomy labelling pack (Phase 6.3.1)

**Purpose.** Measure the precision and recall of the Engineering taxonomy (taxonomy v2) with HUMAN labels. This is the evidence the Phase 7 decision needs.

**Files**
- `sheet.csv`: 237 repositories, stratified (technology groups, small/medium/large, new/mature, borderline, UNKNOWN, AI-classified, learning-flagged, novel Top-300). **It contains no prediction of the classifier or the taxonomy.** Do not look at `sample-key.json` or any `scores-*.json` before labelling: they contain the predictions.
- `sample-key.json`: strata, sampling weights and the predictions (for the scorer only).
- `labels.assistant-preliminary.json`: labels written by the assistant that built the tooling, blind to the predictions. **They are not human labels and not independent**; they exist to test the scorer and to find problem cases.

**What to fill in** (columns after `ageDays`, in `sheet.csv`; spreadsheet or text editor, save as CSV)
| Column | Allowed values |
|---|---|
| `domainEngineering` | `YES`, `NO`, `UNCERTAIN`. Is this software an engineer would evaluate as an engineering technology, framework, infrastructure project or developer tool? AI models, AI agents, AI applications and consumer applications are `NO`. Mixed or unclear cases are `UNCERTAIN` (they are counted, not guessed). Lists, courses and notes **about** engineering subjects are `YES` here and `YES` in `learning` |
| `areas` | zero or more of: `backend`, `data`, `messaging`, `cloud-native`, `infrastructure`, `observability`, `security`, `devtools` (separate with `;`). Leave empty if none fits. Must be empty when `domainEngineering` is `NO` |
| `technologies` | zero or more of the 46 slugs below (separate with `;`) |
| `learning` | `YES` (tutorial, course, interview prep, awesome list, notes, example collection), `NO`, `UNCERTAIN` |
| `type` | `library`, `framework`, `tool`, `infrastructure`, `application`, `educational`, `other` (required) |
| `notes` | free text, optional |

**Definition of `technologies` (the most important rule).** A technology is a label only when it is **the subject of the repository**: what it implements, extends, integrates as its main purpose, or is a client/tool for. A technology that is merely part of the stack (a web app that happens to run in Docker or use PostgreSQL) is **not** labelled. A tool for several databases may carry several technologies. Do not label a technology only because its name appears in a topic or the name.

Technology slugs: `spring`, `quarkus`, `micronaut`, `nodejs`, `python-web`, `dotnet`, `api`, `microservices`, `postgresql`, `mysql`, `sqlite`, `redis`, `mongodb`, `clickhouse`, `duckdb`, `elasticsearch`, `data-processing`, `kafka`, `rabbitmq`, `nats`, `pulsar`, `kubernetes`, `docker`, `service-mesh`, `serverless`, `webassembly`, `ebpf`, `terraform`, `iac-other`, `gitops`, `ci-cd`, `aws`, `azure-gcp`, `opentelemetry`, `prometheus`, `grafana`, `tracing-logging`, `observability-general`, `security-scanning`, `secrets-identity`, `supply-chain`, `testing`, `build-tools`, `cli-terminal`, `code-quality`, `docs-tooling`.

**Rules for labellers**
1. Label blind: do not look at the key, the scores or any classifier output.
2. At least **200 valid rows** are required; label all 237 if possible. Leave a row blank rather than guessing; blank rows are skipped and counted.
3. Use `UNCERTAIN` honestly; do not force a repository into a technology because its name contains a keyword.
4. Two independent labellers on the same sheet allow agreement to be measured (Cohen's kappa); disagreements should be adjudicated, not averaged.

**Score** (nothing is inferred; invalid rows are reported, not repaired):
```
npx tsx scripts/taxonomy/score-labels.ts <your-labels.csv> --kind human --rater "<name>" --scope engineering-only
npx tsx scripts/taxonomy/score-labels.ts <your-labels.csv> --kind human --rater "<name>" --scope engineering-or-both
```
`--scope engineering-only` is the Engineering Radar population (repositories classified ENGINEERING; BOTH repositories rank with AI). Both scopes are reported in `docs/PHASE-6.3.1-TAXONOMY-VALIDATION.md` once human labels exist.
