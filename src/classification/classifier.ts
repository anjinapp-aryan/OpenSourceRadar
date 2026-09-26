import { compileTerm, matchTerms, normalizeTopics, TextIndex, type CompiledTerm } from './text';
import type {
  CategoryEvidence,
  CategoryMatch,
  CategoryRules,
  ClassificationInput,
  ClassificationResult,
  ConfidenceLabel,
  ContextMatch,
  ContextSignalRules,
  Domain,
  EvidenceKind,
  Signal,
  Taxonomy,
  TopLevelCategory,
} from './types';

/** Categories scoring at least this (but below acceptance) are reported as near misses. */
const NEAR_MISS_MIN_SCORE = 3;

interface CompiledCategory {
  rules: CategoryRules;
  strongTopics: Set<string>;
  weakTopics: Set<string>;
  exclusionTopics: Set<string>;
  strongKeywords: CompiledTerm[];
  weakKeywords: CompiledTerm[];
  exclusionKeywords: CompiledTerm[];
}

interface CompiledContext {
  rules: ContextSignalRules;
  keywords: CompiledTerm[];
  topics: Set<string>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const EVIDENCE_KIND: Partial<Record<Signal['kind'], EvidenceKind>> = {
  'strong-topic': 'topic',
  'weak-topic': 'topic',
  'name-strong': 'name',
  'name-weak': 'name',
  'description-strong': 'description',
  'description-weak': 'description',
  language: 'language',
  'readme-strong': 'readme',
};

/**
 * Deterministic, explainable rules engine. Pure: the same input and taxonomy always
 * give the same output. No network, no clock, no randomness, no ML.
 *
 * Discovery is not an input. A repository is judged only by its own topics, name,
 * description, language (and README text when supplied).
 */
export class Classifier {
  private readonly categories: CompiledCategory[];
  private readonly contexts: CompiledContext[];

  constructor(readonly taxonomy: Taxonomy) {
    this.categories = taxonomy.categories.map((rules) => ({
      rules,
      strongTopics: new Set(rules.strongTopics),
      weakTopics: new Set(rules.weakTopics),
      exclusionTopics: new Set(rules.exclusionTopics),
      strongKeywords: rules.strongKeywords.map(compileTerm),
      weakKeywords: rules.weakKeywords.map(compileTerm),
      exclusionKeywords: rules.exclusionKeywords.map(compileTerm),
    }));
    this.contexts = taxonomy.contextSignals.map((rules) => ({ rules, keywords: rules.keywords.map(compileTerm), topics: new Set(rules.topics) }));
  }

  classify(input: ClassificationInput): ClassificationResult {
    const tax = this.taxonomy;
    const topics = normalizeTopics(input.topics);
    const nameIndex = new TextIndex(input.name, { camelCase: true });
    const descIndex = new TextIndex(input.description);
    const readmeIndex = input.readme ? new TextIndex(input.readme) : null;

    const context = this.detectContext(topics, nameIndex, descIndex);

    const evidence = this.categories.map((c) => this.scoreCategory(c, input, topics, nameIndex, descIndex, readmeIndex, context));
    const accepted = evidence.filter((e) => this.isAccepted(e));
    const acceptedSlugs = new Set(accepted.map((e) => e.slug));
    const nearMisses = evidence.filter((e) => !acceptedSlugs.has(e.slug) && e.score >= NEAR_MISS_MIN_SCORE);

    // BOTH must be genuine: the weaker domain has to carry a meaningful share of the stronger one's evidence.
    const best = (d: Domain) => Math.max(0, ...accepted.filter((e) => e.domain === d).map((e) => e.score));
    const bestAi = best('ai');
    const bestEng = best('engineering');
    let dropped: Domain | null = null;
    if (bestAi > 0 && bestEng > 0) {
      const ratio = Math.min(bestAi, bestEng) / Math.max(bestAi, bestEng);
      if (ratio < tax.acceptance.bothMinRatio) dropped = bestAi < bestEng ? 'ai' : 'engineering';
    }
    const kept = accepted.filter((e) => e.domain !== dropped);
    const suppressed = accepted.filter((e) => e.domain === dropped).map(toMatch(tax));

    const sorted = [...kept].sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
    const domains = new Set(sorted.map((e) => e.domain));
    const topLevelCategory: TopLevelCategory = domains.size === 0 ? 'UNKNOWN' : domains.size === 2 ? 'BOTH' : domains.has('ai') ? 'AI' : 'ENGINEERING';
    const topLevel = ([...domains].sort() as Domain[]).map((d) => (d === 'ai' ? 'AI' : 'ENGINEERING')) as Array<'AI' | 'ENGINEERING'>;

    const categories = sorted.map(toMatch(tax));
    const domainConfidences = [...domains].map((d) => Math.max(...sorted.filter((e) => e.domain === d).map((e) => e.confidence)));
    const confidence = domainConfidences.length === 0 ? 0 : Math.min(...domainConfidences);

    const positiveSignals = sorted.flatMap((e) => e.positive.map((s) => `${e.name}: ${describe(s)}`));
    const negativeSignals = [
      ...sorted.flatMap((e) => e.negative.map((s) => `${e.name}: ${describe(s)}`)),
      ...context.map((c) => `context ${c.id}: topics [${c.matchedTopics.join(', ')}] keywords [${c.matchedKeywords.join(', ')}]`),
      ...suppressed.map((s) => `suppressed ${s.name} (score ${s.score}): ${dropped === 'ai' ? 'AI' : 'engineering'} evidence below ${tax.acceptance.bothMinRatio} of the other domain`),
    ];

    return {
      classifierVersion: tax.classifierVersion,
      topLevelCategory,
      topLevel,
      categories,
      confidence: round2(confidence),
      confidenceLabel: label(confidence, tax, topLevelCategory),
      positiveSignals,
      negativeSignals,
      signals: { accepted: sorted, nearMisses: nearMisses.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug)), suppressed, context },
      classificationReason: this.reason(topLevelCategory, sorted, nearMisses, context),
    };
  }

  private isAccepted(e: CategoryEvidence): boolean {
    const a = this.taxonomy.acceptance;
    if (a.requireIdentityEvidence && !hasIdentityEvidence(e)) return false;
    if (e.evidenceKinds.length < a.minEvidenceKinds) return false;
    if (e.score >= a.minScore) return true;
    // slightly lower score is enough when independent kinds of evidence agree (topic + description/name/language)
    return e.score >= a.corroboratedMinScore && e.evidenceKinds.length >= a.corroboratedMinKinds;
  }

  private detectContext(topics: string[], nameIndex: TextIndex, descIndex: TextIndex): ContextMatch[] {
    const out: ContextMatch[] = [];
    for (const c of this.contexts) {
      const matchedTopics = topics.filter((t) => c.topics.has(t));
      const matchedKeywords = [...matchTerms(nameIndex, c.keywords), ...matchTerms(descIndex, c.keywords)].map((t) => t.raw);
      if (matchedTopics.length > 0 || matchedKeywords.length > 0) out.push({ id: c.rules.id, matchedTopics, matchedKeywords: [...new Set(matchedKeywords)].sort() });
    }
    return out;
  }

  private scoreCategory(
    c: CompiledCategory,
    input: ClassificationInput,
    topics: string[],
    nameIndex: TextIndex,
    descIndex: TextIndex,
    readmeIndex: TextIndex | null,
    context: ContextMatch[],
  ): CategoryEvidence {
    const w = this.taxonomy.weights;
    const positive: Signal[] = [];
    const negative: Signal[] = [];

    // topics: strong (diminishing), then weak (capped)
    let topicPoints = 0;
    const strong = topics.filter((t) => c.strongTopics.has(t));
    strong.slice(0, w.strongTopic.length).forEach((t, i) => {
      const weight = w.strongTopic[i] as number;
      positive.push({ kind: 'strong-topic', term: t, weight });
      topicPoints += weight;
    });
    const weakTopics = topics.filter((t) => c.weakTopics.has(t) && !c.strongTopics.has(t)).slice(0, w.weakTopicMax);
    for (const t of weakTopics) {
      positive.push({ kind: 'weak-topic', term: t, weight: w.weakTopic });
      topicPoints += w.weakTopic;
    }

    // name
    const nameStrong = matchTerms(nameIndex, c.strongKeywords)[0];
    const nameWeak = matchTerms(nameIndex, c.weakKeywords)[0];
    if (nameStrong) positive.push({ kind: 'name-strong', term: nameStrong.raw, weight: w.nameStrong });
    else if (nameWeak) positive.push({ kind: 'name-weak', term: nameWeak.raw, weight: w.nameWeak });

    // description: distinct terms only, capped
    for (const t of matchTerms(descIndex, c.strongKeywords).slice(0, w.descriptionStrongMax)) {
      positive.push({ kind: 'description-strong', term: t.raw, weight: w.descriptionStrong });
    }
    for (const t of matchTerms(descIndex, c.weakKeywords).slice(0, w.descriptionWeakMax)) {
      positive.push({ kind: 'description-weak', term: t.raw, weight: w.descriptionWeak });
    }

    // language
    const langWeight = input.language ? c.rules.languages[input.language] : undefined;
    if (langWeight) positive.push({ kind: 'language', term: input.language as string, weight: langWeight });

    // README (optional, lightly weighted)
    if (readmeIndex) {
      for (const t of matchTerms(readmeIndex, c.strongKeywords).slice(0, w.readmeStrongMax)) positive.push({ kind: 'readme-strong', term: t.raw, weight: w.readmeStrong });
    }

    // exclusions
    for (const t of topics.filter((t) => c.exclusionTopics.has(t))) negative.push({ kind: 'exclusion-topic', term: t, weight: w.exclusionTopic });
    const excl = [...matchTerms(nameIndex, c.exclusionKeywords), ...matchTerms(descIndex, c.exclusionKeywords)];
    for (const t of [...new Map(excl.map((x) => [x.raw, x])).values()].slice(0, w.exclusionKeywordMax)) {
      negative.push({ kind: 'exclusion-keyword', term: t.raw, weight: w.exclusionKeyword });
    }

    // context discount on topic evidence (e.g. interview guides, tutorials, curated lists)
    for (const m of context) {
      const rule = this.taxonomy.contextSignals.find((s) => s.id === m.id);
      if (!rule || !rule.effect.domains.includes(c.rules.domain) || topicPoints === 0) continue;
      const discount = -round2(topicPoints * (1 - rule.effect.topicEvidenceFactor));
      if (discount !== 0) {
        negative.push({ kind: 'context-discount', term: m.id, weight: discount, note: `topic evidence x${rule.effect.topicEvidenceFactor}` });
        topicPoints += discount;
      }
    }

    const total = positive.reduce((s, x) => s + x.weight, 0) + negative.reduce((s, x) => s + x.weight, 0);
    const score = round2(Math.max(0, total));
    const kinds = [...new Set(positive.map((s) => EVIDENCE_KIND[s.kind]).filter((k): k is EvidenceKind => k !== undefined))].sort();
    return {
      slug: c.rules.slug,
      name: c.rules.name,
      domain: c.rules.domain,
      score,
      confidence: round2(score / (score + this.taxonomy.confidence.halfScore)),
      positive,
      negative,
      evidenceKinds: kinds,
    };
  }

  private reason(top: TopLevelCategory, accepted: CategoryEvidence[], nearMisses: CategoryEvidence[], context: ContextMatch[]): string {
    if (top === 'UNKNOWN') {
      const near = nearMisses[0];
      const ctx = context.length ? ` Context: ${context.map((c) => c.id).join(', ')}.` : '';
      return near
        ? `Insufficient evidence: best candidate ${near.name} scored ${near.score} (needs ${this.taxonomy.acceptance.minScore} (or ${this.taxonomy.acceptance.corroboratedMinScore} with ${this.taxonomy.acceptance.corroboratedMinKinds}+ evidence kinds)${this.taxonomy.acceptance.requireIdentityEvidence ? ' plus a strong topic or name match' : ''}; had ${near.evidenceKinds.join('+') || 'none'}).${ctx}`
        : `No category evidence found.${ctx}`;
    }
    const parts = accepted.slice(0, 3).map((e) => `${e.name} (score ${e.score}; ${e.positive.slice(0, 3).map(describe).join(', ')})`);
    return `${top}: ${parts.join('; ')}${accepted.length > 3 ? `; +${accepted.length - 3} more` : ''}.`;
  }
}

/** Identity evidence = the repository's own tags or name say it is about the category (not just a description mention). */
function hasIdentityEvidence(e: CategoryEvidence): boolean {
  return e.positive.some((s) => s.kind === 'strong-topic' || s.kind === 'name-strong');
}

function toMatch(tax: Taxonomy): (e: CategoryEvidence) => CategoryMatch {
  return (e) => ({ slug: e.slug, name: e.name, domain: e.domain, score: e.score, confidence: e.confidence, confidenceLabel: label(e.confidence, tax, 'AI') });
}

function label(confidence: number, tax: Taxonomy, top: TopLevelCategory): ConfidenceLabel {
  if (top === 'UNKNOWN') return 'none';
  return confidence >= tax.confidence.high ? 'high' : confidence >= tax.confidence.medium ? 'medium' : 'low';
}

function describe(s: Signal): string {
  switch (s.kind) {
    case 'strong-topic':
      return `strong topic "${s.term}" (+${s.weight})`;
    case 'weak-topic':
      return `weak topic "${s.term}" (+${s.weight})`;
    case 'name-strong':
      return `name contains "${s.term}" (+${s.weight})`;
    case 'name-weak':
      return `name weakly matches "${s.term}" (+${s.weight})`;
    case 'description-strong':
      return `description mentions "${s.term}" (+${s.weight})`;
    case 'description-weak':
      return `description weakly mentions "${s.term}" (+${s.weight})`;
    case 'language':
      return `language ${s.term} (+${s.weight})`;
    case 'readme-strong':
      return `README mentions "${s.term}" (+${s.weight})`;
    case 'exclusion-topic':
      return `exclusion topic "${s.term}" (${s.weight})`;
    case 'exclusion-keyword':
      return `exclusion keyword "${s.term}" (${s.weight})`;
    case 'context-discount':
      return `${s.term}: ${s.note} (${s.weight})`;
  }
}
