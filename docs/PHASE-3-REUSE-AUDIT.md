# PHASE 3 REUSE AUDIT — classification and tracking

Audit date 2026-09-25. Rule: REUSE > ADAPT > COMPOSE > BUILD. Method: web searches (GitHub, Hugging Face, research literature), clones of the relevant repositories, LICENSE files opened. Anything not verified is marked **UNVERIFIED**.

## Requirements being audited
1. A **deterministic, explainable, LLM-free** classifier for 33 categories (14 AI, 19 engineering) with strong/weak/exclusion signals.
2. A taxonomy/vocabulary source for topic aliases and related terms.
3. Tracking tiers (HOT/WARM/DORMANT) from measurable signals.

## Repositories and sources searched

| Source | URL | Stars / activity | License (file checked) | Relevant capability | Decision |
|---|---|---|---|---|---|
| **github/explore** | https://github.com/github/explore | GitHub's official topic pages; last commit 2026-09-04 | **CC BY 4.0** (`LICENSE.txt` read) | per-topic `aliases`, `related`, `short_description` (76 of our 231 candidate topics have a page; e.g. `mcp` aliases `model-context-protocol`, `llm` aliases `large-language-model, llms`, `kubernetes` alias `k8s`, `postgresql` aliases `postgres, psql`, `awesome` aliases `awesome-lists`) | **ADAPT (data)**: use aliases to build the strong/weak topic lists; attribute GitHub under CC BY 4.0 in THIRD_PARTY notice. No code |
| **ecosyste-ms/oss-taxonomy** | https://github.com/ecosyste-ms/oss-taxonomy | 42 stars; last commit 2026-09-07 | **CC0 1.0** (read) | faceted vocabulary (domain, role, technology, audience, layer, function); ships terms only, **no classifier code**; has `education` domain and `educator/student` audience | **REFERENCE**: too coarse for our 33 categories (one `machine-learning` domain, no agents/RAG/MCP); its `education`/`documentation` vocabulary informed the "educational content" negative signal |
| ecosyste-ms scripts / collectors | same repo | | CC0 | PyPI classifier collectors | REJECT (not relevant) |
| **HiGitClass** (Zhang et al., ICDM 2019) | https://ieeexplore.ieee.org/document/8970799/ | research paper | code license **UNVERIFIED** | keyword-driven hierarchical classification of GitHub repos using a neural model over README/topics/metadata | **REFERENCE (idea)**: confirms keyword-seeded classification and multi-signal (topics + text) input. **REJECT** the model (ML, non-deterministic training; forbidden) |
| **GitRanking** (Sas et al., 2023) | https://arxiv.org/pdf/2205.09379 | research paper | **UNVERIFIED** | ground-up taxonomy of software domains from GitHub topics, active sampling | **REFERENCE** (topics are a noisy but usable signal; supports treating topics as evidence, not truth) |
| GitHub Docs: classifying repos with topics | https://docs.github.com/articles/classifying-your-repository-with-topics | docs | n/a | topics are owner-chosen (up to 20) and GitHub also suggests topics; many repos have none | **REFERENCE**: topics can be wrong or promotional -> never sole evidence |
| GitHub-Trending-Intelligence (Phase 1.5) | https://github.com/HalcyonVector/GitHub-Trending-Intelligence- | | MIT (read) | keyword ∩ topics classifier, ~30 lines, 15 categories | **REFERENCE**: our classifier replaces "any keyword hit = category" (the exact failure mode of the JavaGuide case) |
| RepoMeteor (Phase 1.5) | https://github.com/FayezBast/repometeor | | Apache-2.0 | no classification; eligibility filters only | REFERENCE (eligibility ideas: description present, not fork/archived) |
| Hugging Face zero-shot models / datasets | https://huggingface.co/tasks/zero-shot-classification (e.g. `facebook/bart-large-mnli`) | | model licenses vary | zero-shot text classification | **REJECT**: neural models violate the deterministic/no-ML rule, need inference infrastructure |
| npm NLP libraries (natural, wink-nlp, compromise) | not evaluated in depth | | | tokenizing/stemming | **REJECT**: unnecessary; a token-sequence matcher is ~40 lines of standard TypeScript |
| GitHub Linguist | https://github.com/github-linguist/linguist | | MIT | language detection | REJECT: `primaryLanguage` already comes from the API |

## Findings
1. **No project provides a deterministic, explainable, multi-signal classifier for AI vs engineering.** Every rule-based prior art is "keyword or topic hit = category"; ML alternatives are excluded by rule.
2. **Vocabulary is reusable, the engine is not.** github/explore aliases are worth adapting (CC BY 4.0, attribution required). oss-taxonomy is a reference only.
3. **Therefore BUILD only the engine**: a small rules engine (tokenizer + weighted evidence + negative signals + acceptance rules), no new dependency.
4. Tracking tiers: no candidate implements refresh scheduling from growth signals (RepoMeteor/Trending-Intelligence use always-on workers). BUILD, ~150 lines, configuration-driven.

## Decisions

| Capability | Decision | Source / note |
|---|---|---|
| Topic aliases / related terms | ADAPT (data) | github/explore, CC BY 4.0, attribution in `THIRD_PARTY.md` |
| Education/documentation vocabulary | REFERENCE | oss-taxonomy (CC0) |
| Classification engine | BUILD | no suitable prior art (see 1-3) |
| Classification evidence weighting | BUILD, derived from measured data | 500-repository dataset profile; documented in CLASSIFICATION.md |
| Tracking tier engine | BUILD | none |
| Dependencies | none added | standard TypeScript/Node only |

## License obligations created by this phase
- github/explore alias data: **CC BY 4.0** — credit "GitHub, github/explore topics (CC BY 4.0)", link the license, indicate that lists were adapted. Recorded in [THIRD_PARTY.md](../THIRD_PARTY.md).
