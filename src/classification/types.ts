export type Domain = 'ai' | 'engineering';
export type TopLevelCategory = 'AI' | 'ENGINEERING' | 'BOTH' | 'UNKNOWN';
export type ConfidenceLabel = 'high' | 'medium' | 'low' | 'none';

/**
 * Everything the classifier may look at. Deliberately no discovery provenance:
 * classification must not depend on which search query found the repository.
 */
export interface ClassificationInput {
  id: string;
  name: string;
  description: string | null;
  topics: readonly string[];
  language: string | null;
  /** Optional README text. Not collected by the pipeline today (see docs/CLASSIFICATION.md). */
  readme?: string | null;
}

export type SignalKind =
  | 'strong-topic'
  | 'weak-topic'
  | 'name-strong'
  | 'name-weak'
  | 'description-strong'
  | 'description-weak'
  | 'language'
  | 'readme-strong'
  | 'exclusion-topic'
  | 'exclusion-keyword'
  | 'context-discount';

export type EvidenceKind = 'topic' | 'name' | 'description' | 'language' | 'readme';

export interface Signal {
  kind: SignalKind;
  /** The matched topic/keyword/language, or the context id for a discount. */
  term: string;
  /** Points contributed (negative for exclusions and discounts). */
  weight: number;
  note?: string;
}

export interface CategoryEvidence {
  slug: string;
  name: string;
  domain: Domain;
  score: number;
  confidence: number;
  positive: Signal[];
  negative: Signal[];
  /** Distinct evidence kinds present among the positive signals. */
  evidenceKinds: EvidenceKind[];
}

export interface CategoryMatch {
  slug: string;
  name: string;
  domain: Domain;
  score: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

export interface ContextMatch {
  id: string;
  matchedTopics: string[];
  matchedKeywords: string[];
}

export interface ClassificationResult {
  classifierVersion: string;
  topLevelCategory: TopLevelCategory;
  /** The domains behind topLevelCategory, e.g. ["AI", "ENGINEERING"] for BOTH. */
  topLevel: Array<'AI' | 'ENGINEERING'>;
  /** Accepted categories, best score first. */
  categories: CategoryMatch[];
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  /** Human-readable summaries of the accepted evidence. */
  positiveSignals: string[];
  /** Human-readable summaries of exclusions, discounts and suppressions. */
  negativeSignals: string[];
  /** Full structured evidence for debugging (kept in the dataset, not for the UI). */
  signals: {
    accepted: CategoryEvidence[];
    /** Categories with some evidence that did not reach acceptance. */
    nearMisses: CategoryEvidence[];
    /** Accepted categories dropped because the other domain dominated (see acceptance.bothMinRatio). */
    suppressed: CategoryMatch[];
    context: ContextMatch[];
  };
  classificationReason: string;
}

// ------------------------------------------------------------------ configuration

export interface CategoryRules {
  slug: string;
  name: string;
  domain: Domain;
  strongTopics: string[];
  weakTopics: string[];
  strongKeywords: string[];
  weakKeywords: string[];
  exclusionTopics: string[];
  exclusionKeywords: string[];
  languages: Record<string, number>;
}

export interface ClassifierWeights {
  strongTopic: number[];
  weakTopic: number;
  weakTopicMax: number;
  nameStrong: number;
  nameWeak: number;
  descriptionStrong: number;
  descriptionStrongMax: number;
  descriptionWeak: number;
  descriptionWeakMax: number;
  readmeStrong: number;
  readmeStrongMax: number;
  exclusionTopic: number;
  exclusionKeyword: number;
  exclusionKeywordMax: number;
}

export interface ContextSignalRules {
  id: string;
  description: string;
  topics: string[];
  keywords: string[];
  effect: { topicEvidenceFactor: number; domains: Domain[] };
}

export interface Taxonomy {
  classifierVersion: string;
  weights: ClassifierWeights;
  acceptance: {
    minScore: number;
    minEvidenceKinds: number;
    requireIdentityEvidence: boolean;
    bothMinRatio: number;
    /** A lower score is accepted when independent evidence kinds (e.g. topic + description) agree. */
    corroboratedMinScore: number;
    corroboratedMinKinds: number;
  };
  confidence: { halfScore: number; high: number; medium: number };
  contextSignals: ContextSignalRules[];
  categories: CategoryRules[];
}
