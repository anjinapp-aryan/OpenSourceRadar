# Labeling guide, labeler A

You are one of two people who label the same 237 repositories **independently**. Do not discuss the repositories, your answers or your doubts with the other labeler, and do not look anything up about how a tool classifies them. Judge each repository from the information in the sheet (name, description, topics, language, stars, age) and, where that is not enough, from its public page. Return **only your own completed `sheet.csv`**, with your name in the file name.

Spreadsheet or text editor; save as CSV (UTF-8). Do not add, remove, rename or reorder columns or rows. Leave a row's label cells empty if you cannot judge it; do not guess.

## Columns to fill
| Column | Allowed values |
|---|---|
| `domainEngineering` | `YES`, `NO`, `UNCERTAIN`. Is this software that an engineer would evaluate as an engineering technology, framework, infrastructure project or developer tool? AI models, AI agents, AI applications and consumer applications are `NO`. Lists, courses and notes **about** engineering subjects are `YES` here. |
| `areas` | zero or more of: `backend`, `data`, `messaging`, `cloud-native`, `infrastructure`, `observability`, `security`, `devtools` (separate with `;`). Empty if none fits or if `domainEngineering` is `NO`. |
| `technologies` | zero or more technology slugs (list below) for which the repository is **primarily about** that technology: it implements it, extends it, is a client or tool for it, or integrates it as its main purpose. Separate with `;`. |
| `technologiesUsed` | zero or more technology slugs the repository **touches or uses** in any significant way, including those in `technologies` and including technologies it merely runs on or depends on (for example a web application that is deployed with Docker and stores data in PostgreSQL). Separate with `;`. |
| `learning` | `YES` (tutorial, course, interview preparation, awesome list, notes, example collection), `NO`, `UNCERTAIN`. |
| `confidence` | `HIGH`, `MEDIUM`, `LOW`: how sure you are of this row overall. |
| `type` | `library`, `framework`, `tool`, `infrastructure`, `application`, `educational`, `other`. Required on every labeled row. |
| `notes` | optional free text. |

Do not label a technology only because its name appears in the repository name or a topic. Use `UNCERTAIN` honestly.

## Technology slugs
`spring`, `quarkus`, `micronaut`, `nodejs`, `python-web`, `dotnet`, `api`, `microservices`, `postgresql`, `mysql`, `sqlite`, `redis`, `mongodb`, `clickhouse`, `duckdb`, `elasticsearch`, `data-processing`, `kafka`, `rabbitmq`, `nats`, `pulsar`, `kubernetes`, `docker`, `service-mesh`, `serverless`, `webassembly`, `ebpf`, `terraform`, `iac-other`, `gitops`, `ci-cd`, `aws`, `azure-gcp`, `opentelemetry`, `prometheus`, `grafana`, `tracing-logging`, `observability-general`, `security-scanning`, `secrets-identity`, `supply-chain`, `testing`, `build-tools`, `cli-terminal`, `code-quality`, `docs-tooling`

## Rules
1. Work alone and blind. Disagreements between labelers are expected and are resolved later by a person, not by you.
2. Label at least 200 rows; label all 237 if you can.
3. A repository can have no technology at all. Leave both technology columns empty in that case.
4. Do not edit the first 8 columns.
