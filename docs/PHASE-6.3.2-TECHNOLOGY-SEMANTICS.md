# PHASE 6.3.2 TECHNOLOGY SEMANTICS

Status: **PENDING. No decision is made.** The harness is built and tested on synthetic data only. No independent human label exists, so no winner is declared. The classifier and taxonomy are **not modified**. Evidence labels: **FACT · MEASURED · PROXY · INFERENCE · LIMITATION**.

## 1. The question
What does a technology tag on a repository mean?
- **Option A, "touches/uses":** the repository uses, integrates or depends on the technology in a significant way (a web application deployed with Docker and storing data in PostgreSQL touches both).
- **Option B, "primarily about":** the technology is the subject of the repository: it implements it, extends it, is a client or tool for it, or integrates it as its main purpose.

Product question: **"What engineering technology or ecosystem is this repository actually worth evaluating?"**

## 2. What is known now (FACT, from 6.3.1; PRELIMINARY, assistant labels, not independent)
The current rule accepts a technology from a topic alone (topics 3 points, name 2, description 1, minimum 3), so it implements "touches". Scored against the assistant's subject-level ("about") labels it reaches precision 0.475 raw and recall 0.872 (engineering-only scope). **PROXY / INFERENCE only:** those numbers describe a mismatch between the rule and a strict definition written by the same party; they do not show which definition is right.

## 3. Harness (FACT, built and tested on synthetic data)
The two labeler packages ask for two columns: `technologies` (primarily about, Option B) and `technologiesUsed` (touches or uses, Option A; includes the primary ones). `scripts/taxonomy/score-human.ts` scores the **same system tags** against both definitions, for each rater and for the consensus, and writes for each: precision, recall, F1 (weighted and raw, Wilson intervals), false positives, false negatives with examples (`tech-fp`, `tech-fn` problem cases with repository ids), and a per-technology verdict for each definition. Synthetic tests (`tests/phase632b.test.tsx`) show a Docker-only application counted correct under "touches" and as a false positive under "primarily about".

| Definition | Precision | Recall | F1 |
|---|---|---|---|
| Touches (Option A) | TBD (no human labels) | TBD | TBD |
| Primarily about (Option B) | TBD (no human labels) | TBD | TBD |

## 4. Decision rule (declared before any label exists; not changed afterwards)
The decision weighs measured evidence **and** product purpose; neither alone decides.
1. **Labels must be reliable.** Pooled kappa of `technologies` and of `technologiesUsed` between the two raters. A definition whose kappa is below 0.41 cannot be adopted (humans cannot apply it consistently, so a rule cannot match it). If both are below 0.41, the decision is **NOT MADE** and the tag definition is rewritten and re-labeled.
2. **Accuracy of the current tags against each definition** (consensus, weighted F1 and the declared technology thresholds, precision at least 0.80 and recall at least 0.70). This shows which definition the existing rule already satisfies and how far it is from the other. It does not by itself choose, because the rule can be changed later; the gap shows the cost of switching.
3. **Product fit (read from the labels, not from taste).** Compute the share of touches-only tags (in `technologiesUsed` but not in `technologies`) among all touches tags on consensus Engineering rows. If that share is at least 50%, "touches" tags are mostly generic stack facts (a repository using Docker or PostgreSQL), which do not answer "what is this repository worth evaluating for"; this supports Option B for the **primary technology tag shown and filtered on**. If it is below 25%, the two definitions barely differ and the cheaper, higher-recall Option A is acceptable. In between, Option B is used for the displayed tag and Option A may be kept as a secondary "also uses" facet.
4. **Decision outcomes:** adopt B (primary tags) / adopt A / adopt B primary with an A secondary facet / not made. Whichever is chosen, the next step is a separate, re-measured change; this phase changes no classifier rule.
5. **Provisional INFERENCE, to be tested not assumed:** the product question points to Option B for the displayed tag, because a tag a reader uses to decide what to evaluate must name what the repository is, and the 6.3.1 data show topic-derived tags are dominated by stack tags. This is a hypothesis for the human labels to confirm or reject.

## 5. Result
**PENDING.** Requires the two independent labelers. After they return `A.csv` and `B.csv`, run the command in PHASE-6.3.2-HUMAN-TAXONOMY §6 and fill §3 from `systemVsConsensus.technologySemantics` in the result file.

## 6. Limitations
The two definitions are asked of the same two people on the same rows, so a labeler may drift between the columns; the instructions define both but the consistency is measured only by the kappa values. Per-technology counts are small in a 237-row stratified sample. The system has one set of tags, so it cannot show what a purpose-built Option B rule would score; that needs a separate, re-measured experiment after the decision.
