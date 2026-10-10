# PHASE 6.3.2 HUMAN TAXONOMY VALIDATION

Status: **PENDING. 0 real human labels exist.** This document was written on 2026-10-10 **before any human label was received**. The methodology and every threshold below are frozen: they are not changed after results are seen, and the taxonomy is not modified to improve a metric. Evidence labels: **FACT · MEASURED · PROXY · INFERENCE · LIMITATION**.

## 1. What counts as evidence
- **FACT.** Only the completed CSVs of **two different people**, each labeling the same blind sheet alone, count. The assistant's preliminary labels (`labels.assistant-preliminary.json`), one person labeling twice, and any label produced by a model do not count and are never scored as human ground truth.
- **FACT.** The scorer (`scripts/taxonomy/score-human.ts`) refuses to write a real result unless: the two rater names differ and do not look like a model; the two files are not identical; each rater has at least **200 valid rows**. Otherwise it exits non-zero and the status stays PENDING.
- **FACT.** Synthetic labels are used only inside unit tests (`tests/phase632b.test.tsx`) and every such case is marked `SYNTHETIC - NOT REAL EVIDENCE`. The scorer script never accepts them and writes nothing for them.

## 2. Packages (FACT)
`results/phase6.3.2/labeler-packages/LABELER_A/` and `LABELER_B/`, each holding exactly `sheet.csv` (237 rows, ids and text identical to the blind sheet, label columns empty) and `LABELING-GUIDE.md`. They contain no prediction, stratum, weight, key, score or assistant label (a test asserts this). Label columns: `domainEngineering` (YES/NO/UNCERTAIN), `areas`, `technologies` (primarily about), `technologiesUsed` (touches or uses), `learning` (YES/NO/UNCERTAIN), `confidence` (HIGH/MEDIUM/LOW), `type`, `notes`. Handing over `sample-key.json`, any `scores-*.json` or the 6.3.1 labelling README to a labeler invalidates blindness.

## 3. Metrics (declared)
Scope: **engineering-only** (repositories the system classes ENGINEERING; BOTH ranks with AI) is the primary scope; engineering-or-both is reported beside it.
| Level | Positive means | Precision | Recall |
|---|---|---|---|
| Domain | system says Engineering | of system Engineering, share labeled YES | of labeled YES, share the system says Engineering |
| Area | (repository, area) pair | of predicted pairs, share labeled | of labeled pairs, share predicted |
| Technology | (repository, technology) pair | same, against the chosen label definition | same |
| Learning | system flags learning content | share labeled YES | share of labeled YES flagged |
F1 = 2PR/(P+R). Rows labeled `UNCERTAIN` are counted and excluded from the numerator and denominator of that level, never guessed. **Weighted** estimates (stratum weights from the sampling design) are the primary figure; the **raw** rate with a Wilson 95% interval is reported beside them. **UNKNOWN rate** = weighted share of the sampled frame the classifier leaves UNKNOWN, and its share among rows labeled Engineering YES (missed because unclassified). **Coverage** = rows both raters labeled / 237. **Disagreement rate** = share of rows where the two raters differ on domain, learning, areas or technologies.

## 4. Inter-labeler agreement (declared)
- **Cohen's kappa** for the single-valued fields: domain, learning, type. For the multi-valued fields (areas, technologies, technologiesUsed) the **pooled binary kappa** over every (row, slug) decision, with the slug universe fixed to the taxonomy, plus the exact-set match rate. The TypeScript implementation is cross-checked against scikit-learn `cohen_kappa_score` and NLTK offline (reference only; no dependency).
- **Reading of kappa (declared):** at least 0.61 = labels reliable; 0.41 to 0.60 = moderate: metrics are reported but every conclusion drawn from that field is marked LIMITED and all disagreements are adjudicated; below 0.41 = labels not reliable: the field's metrics are reported as **INCONCLUSIVE** and no pass is claimed for it.
- Raters who disagree are **not averaged**. A row enters the **consensus** only if the raters agree on domain, learning, areas, technologies and technologiesUsed, or if a person (a third rater or both in discussion, named in the file) supplies an adjudicated label. The assistant never adjudicates. Unresolved rows are listed and excluded.

## 5. Pass criteria (declared, applied to the **consensus** with the point estimate of the weighted rate)
| Level | Precision at least | Recall at least |
|---|---:|---:|
| Domain | 0.85 | 0.75 |
| Area | 0.75 | 0.70 |
| Technology (definition chosen in PHASE-6.3.2-TECHNOLOGY-SEMANTICS) | 0.80 | 0.70 |
| Learning | 0.80 | 0.70 |
Also required: each rater at least 200 valid rows; kappa for domain and learning at least 0.61 (otherwise that level is INCONCLUSIVE); the unresolved share of rows at most 10%. **The UNKNOWN rate is reported and not tuned**; there is no pass threshold on it, and a rate above 30% among rows labeled Engineering YES is recorded as a limitation. A level that misses its threshold is reported as missed; thresholds are not lowered, and the classifier and taxonomy are not adjusted to pass (any change would be a later, separate, re-measured decision).
Technology rows also get a per-technology verdict by the Phase 6.3.1 rule (fewer than 5 supporting rows: insufficient evidence; precision below 0.6: too broad; recall below 0.5 with at least 3 labeled: too narrow; precision at least 0.8 and recall at least 0.7: useful; otherwise ambiguous).

## 6. How to run when the files arrive
```
npx tsx scripts/taxonomy/score-human.ts --a <A.csv> --rater-a "<name A>" --b <B.csv> --rater-b "<name B>" [--adjudicated <csv>] --scope engineering-only
npx tsx scripts/taxonomy/score-human.ts ... --scope engineering-or-both --out results/phase6.3.2/human/scores-human-engineering-or-both.json
```
Output: `results/phase6.3.2/human/scores-human*.json`, stamped `REAL HUMAN EVIDENCE`, with agreement, consensus, and system-versus-rater-A, rater-B and consensus scores, including both technology definitions.

## 7. Result
**PENDING.** No real result exists. Nothing in this document is a measured taxonomy accuracy. The 6.3.1 assistant-label figures (technology precision 0.475 raw) remain PRELIMINARY and are not evidence of the taxonomy's accuracy.

## 8. Limitations
237 rows is a stratified sample, not a random one (weights correct for this; strata with few rows have wide intervals). The sheet's `technologies` definition was changed from the 6.3.1 sheet's single column to two (primary and used) to enable the semantics comparison; ids and text are unchanged. Two labelers can share a systematic misreading; kappa measures agreement, not truth.
