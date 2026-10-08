# PHASE 6.2 CLASSIFICATION EXPERIMENT

Date 2026-10-08. Production classification is **unchanged**. Everything here is offline: [src/classification/experimental.ts](../src/classification/experimental.ts) is not imported by the production script (a test asserts it) and nothing reads its output. Reproduce: `npx tsx scripts/classify/experiment.ts evaluate <state data dir>` (deterministic; re-run on 2026-10-08 against the 2026-10-07 state it reproduced the stored result byte for byte). Evidence labels: **FACT** · **INFERENCE** · **LIMITATION**.

## 1. How much of UNKNOWN is real uncertainty? (FACT, 4,490 candidates)
The production classifier reproduces its stored result for 4,490 of 4,490 candidates, so the experiment starts from the real production behaviour. UNKNOWN = 1,018 (22.7%).

| UNKNOWN repositories (1,018) | Count | Share |
|---|---:|---:|
| With at least one near-miss category | 958 | 94.1% |
| of which the best near miss scores 5 to 5.99 (the acceptance score is 6) | 365 | 35.9% |
| of which the best near miss scores 4 to 4.99 | 559 | 54.9% |
| of which the best near miss scores 3 to 3.99 | 34 | 3.3% |
| With no near miss at all | 60 | 5.9% |
| Carrying an educational or list context signal | 111 | 10.9% |
| With 5,000 or more stars | about 372 | 36.5% |

**INFERENCE:** the large majority of UNKNOWN is not "no information": 94% have some category evidence and 36% sit one point below the line. The cause is the classifier's design (each category is scored on its own; acceptance needs 6 points plus identity evidence), not missing GitHub data. That also explains why lowering the threshold overshoots: Phase 3 already measured that a corroborated 5-point acceptance added 10 to 20% wrong repositories and disabled it (see CLASSIFICATION.md); a 4-point line would admit the 559 repositories at 4 to 4.99, which is lower still.

Obvious cases (stored result UNKNOWN today):
| Repository | Topics (abridged) | Best near misses | What the experiment rule does |
|---|---|---|---|
| browser-use/browser-use | ai-agents, llm, browser-automation, playwright | ai-agents 5, llm 4 | accepts `ai-agents` |
| harry0703/MoneyPrinterTurbo | ai-video-generator, llm, ffmpeg, short-video | llm 4, multimodal 4 | accepts `llm` (domain right, category not the best: it is a video tool) |
| puppeteer/puppeteer | developer-tools, testing, headless-chrome | developer-tools 5.5, testing 4 | accepts `developer-tools` |
| opencv/opencv | computer-vision, deep-learning, image-processing | machine-learning 5.5 | **does not fire** (one near-miss category only) |
| louislam/uptime-kuma | docker, monitoring, self-hosted | docker 4 | does not fire |
| storybookjs/storybook | components, design-systems, react | testing 5 | does not fire |
| deepseek-ai/deepseek-harness | ai-agents, dsh-plugin | ai-agents 4 | does not fire |
| f/prompts.chat | awesome-list, chatgpt-prompts | llm 5.25 | does not fire |

## 2. Sample of 60 UNKNOWN repositories, categorised
Seeded random draw (seed 99); each repository was given a type, a domain and whether an existing category should cover it (FACT for the counts, LIMITATION for the labels, see section 5):

| Type | Count | | Domain | Count |
|---|---:|---|---|---:|
| AI | 17 | | AI | 23 |
| developer tool | 11 | | ENGINEERING | 27 |
| educational | 12 | | IRRELEVANT | 10 |
| infrastructure | 6 | | | |
| irrelevant | 4 | | Should an existing category cover it? | 39 of 60 |
| missing taxonomy | 5 | | | |
| security | 3 | | | |
| database | 1 | | | |
| language / runtime | 1 | | | |

So about two thirds of UNKNOWN are repositories the current taxonomy is meant to cover but the rule misses; a fifth are educational or list resources that should stay unclassified; about one in twelve is a genuine taxonomy gap (the five "missing taxonomy" cases are the engineering and AI areas listed in ENGINEERING-TAXONOMY.md).

## 3. The experiment: E1, same-domain corroboration
**Rule.** Applied only to a repository the production classifier left UNKNOWN, with no educational or list context, that has at least two near-miss categories of the SAME domain, each scoring at least 4 and resting on a different strong topic. It accepts the top-scoring category. Cross-domain pairs never fire, an already classified repository is never touched, and the same topic counted twice is not corroboration. Two variants: **E1** (both domains) and **E1-AI** (AI domain only; chosen on the tuning sample because engineering repositories tag their technology stack, and two stack tags do not say what a project is).

**Samples.** Tuning (40, drawn from the repositories E1 would change, seeded) and held-out (80, disjoint). The held-out sheet was written without the proposed category, and its domain label was assigned before the proposal was revealed.

| Result | E1 (both domains) | E1-AI |
|---|---:|---:|
| Fires on UNKNOWN repositories | 260 | 127 |
| Held-out sample size / fired | 80 / 80 | 80 / 39 |
| **Held-out precision** (correct domain and category) | **53.8%** (95% interval 42.9 to 64.3) | **66.7%** (51.0 to 79.4) |
| Held-out domain precision (domain right) | 86.3% (77.0 to 92.1) | 94.9% (83.1 to 98.6) |
| Wrong-domain proposals (held-out) | 11 | 2 |
| Tuning-sample precision (optimistic by construction) | 52.5% | 56.3% |
| Recall proxy on the UNKNOWN sample (of the 39 that should be covered, recovered with the right domain) | 28.2% (11 of 39; 16.5 to 43.8) | 15.4% (6 of 39; 7.2 to 29.7) |
| UNKNOWN rate if enabled | 22.7% to 16.9% | 22.7% to 19.8% |
| Expected correct / incorrect among the changed repositories (held-out precision applied) | 140 / 120 | 85 / 42 |

## 4. Reading the result
- The rule moves UNKNOWN by 3 to 6 points but does so with a category error rate of roughly one third to one half: a repository proposed for `ai-agents` that really belongs to `llm` is a classification error that now appears in a category page. **Domain** is mostly right (86% and 95%); **category** is the weak part.
- Recall is low (15 to 28%): most of the repositories that should be covered are not recovered, because most have a single near miss (opencv, deepseek-harness, storybook).
- Comparison with the "lower the threshold" alternative, qualitatively: that change admits every repository at 4 to 4.99 (559) indiscriminately; E1 admits a subset (127 or 260) that has two independent signals. It is better targeted, and still not good enough to ship.
- Domain-level assignment would be reliable enough to **route** a repository (AI versus engineering) for Phase 6.3 baselines, which is a smaller claim than choosing a category.

**Recommendation (not applied):** do not enable E1 in production. If a gain is wanted before taxonomy v2, enable only the AI variant for domain-level labelling ("AI, category unknown"), shown with the category left empty, so a repository such as `browser-use` is visible in AI Radar without claiming a category it may not belong to. That is a product decision with a visible effect on rankings' scope and is left for Phase 6.3. Taxonomy v2 (tags first, ENGINEERING-TAXONOMY.md) addresses the real cause.

## 5. Limitations (read these before relying on the numbers)
1. **The labels are not independent ground truth.** They were assigned inside this repository's tooling by the assistant that produced the experiment, from the repository name, description and topics; no human reviewed them. The held-out domain labels were assigned blind to the proposal, but the labeller is the same party as the experimenter. I reproduced the evaluation but did not re-label.
2. Sample sizes are small (80 held-out, 39 fired for the AI variant, 39 in the recall denominator); the intervals above are wide.
3. Category correctness was judged after the proposal was revealed.
4. The UNKNOWN sample was labelled at domain level only, so recall is a domain-level proxy.
5. False negatives of the production classifier among repositories it classified (not UNKNOWN) were not measured.
6. Classification here uses name, description, topics and language only (no README), as in production.
