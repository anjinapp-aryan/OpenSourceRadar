/**
 * EXPERIMENTAL classification rule (Phase 6.2). NOT used by the production pipeline (scripts/classify/index.ts does not
 * import it). Evaluated offline in docs/PHASE-6.2-CLASSIFICATION-EXPERIMENT.md.
 *
 * E1 "same-domain corroboration": the production classifier scores each category independently, so two independent
 * strong signals of the same domain that land in different categories never add up (example: browser-use has the strong
 * topic `ai-agents` -> AI Agents 5, and the strong topic `llm` -> LLM 4; both short of 6, result UNKNOWN).
 *
 * E1 only acts on a production result that is UNKNOWN, carries no context signal (educational/list content is left
 * alone), and has at least two near-miss categories of the SAME domain, each with its own strong-topic match on a
 * different topic term and a score >= minEach. It then accepts only the top-scoring of those categories. Cross-domain
 * pairs never fire. A repository the production classifier already classified is never changed.
 */
import type { ClassificationResult } from './types';

export const EXPERIMENT_E1 = { id: 'E1-same-domain-corroboration', minEach: 4, minCategories: 2, domains: ['ai', 'engineering'] as ReadonlyArray<'ai' | 'engineering'> } as const;
/**
 * Variant chosen on the TUNING sample (before the held-out sample was labelled): engineering repositories tag their
 * technology stack (docker, postgres, redis, kubernetes), and two stack tags do not corroborate what a project IS
 * (tuning: 12 of 24 engineering proposals had the wrong category). The AI domain only.
 */
export const EXPERIMENT_E1_AI = { ...EXPERIMENT_E1, id: 'E1-AI-same-domain-corroboration', domains: ['ai'] as ReadonlyArray<'ai' | 'engineering'> } as const;

export interface ExperimentalDecision {
  fired: boolean;
  /** Category slug accepted by the rule (only when fired). */
  slug?: string;
  domain?: 'ai' | 'engineering';
  topLevel?: 'AI' | 'ENGINEERING';
  evidence?: string[];
}

type NearMiss = ClassificationResult['signals']['nearMisses'][number];

const strongTerms = (m: NearMiss) => m.positive.filter((p) => p.kind === 'strong-topic').map((p) => p.term);

export function applyE1(result: ClassificationResult, rule: { minEach: number; minCategories: number; domains: ReadonlyArray<'ai' | 'engineering'> } = EXPERIMENT_E1): ExperimentalDecision {
  if (result.topLevelCategory !== 'UNKNOWN') return { fired: false };
  if (result.signals.context.length > 0) return { fired: false };
  const eligible = result.signals.nearMisses.filter((m) => m.score >= rule.minEach && strongTerms(m).length > 0);
  if (eligible.length < rule.minCategories) return { fired: false };
  const top = eligible[0] as NearMiss; // nearMisses are sorted by score desc, then slug
  if (!rule.domains.includes(top.domain)) return { fired: false };
  const sameDomain = eligible.filter((m) => m.domain === top.domain);
  if (sameDomain.length < rule.minCategories) return { fired: false };
  // the corroborating categories must rest on DIFFERENT strong topics (the same topic counted twice is not corroboration)
  const terms = new Set(sameDomain.flatMap(strongTerms));
  if (terms.size < rule.minCategories) return { fired: false };
  return {
    fired: true,
    slug: top.slug,
    domain: top.domain,
    topLevel: top.domain === 'ai' ? 'AI' : 'ENGINEERING',
    evidence: sameDomain.map((m) => `${m.slug} ${m.score} [${strongTerms(m).join(', ')}]`),
  };
}
