import { readFileSync } from 'node:fs';
import type { CategoryRules, ClassifierWeights, ContextSignalRules, Domain, Taxonomy } from './types';

export class TaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxonomyError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function strings(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '')) throw new TaxonomyError(`${where} must be an array of non-empty strings`);
  return (v as string[]).map((x) => x.toLowerCase());
}

function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TaxonomyError(`${where} must be a finite number`);
  return v;
}

function parseWeights(raw: unknown): ClassifierWeights {
  if (!isRecord(raw)) throw new TaxonomyError('weights must be an object');
  const st = raw.strongTopic;
  if (!Array.isArray(st) || st.length === 0 || !st.every((x) => typeof x === 'number' && x > 0)) throw new TaxonomyError('weights.strongTopic must be a non-empty array of positive numbers');
  const w = (k: string) => num(raw[k], `weights.${k}`);
  return {
    strongTopic: st as number[],
    weakTopic: w('weakTopic'),
    weakTopicMax: w('weakTopicMax'),
    nameStrong: w('nameStrong'),
    nameWeak: w('nameWeak'),
    descriptionStrong: w('descriptionStrong'),
    descriptionStrongMax: w('descriptionStrongMax'),
    descriptionWeak: w('descriptionWeak'),
    descriptionWeakMax: w('descriptionWeakMax'),
    readmeStrong: w('readmeStrong'),
    readmeStrongMax: w('readmeStrongMax'),
    exclusionTopic: w('exclusionTopic'),
    exclusionKeyword: w('exclusionKeyword'),
    exclusionKeywordMax: w('exclusionKeywordMax'),
  };
}

function parseContext(raw: unknown): ContextSignalRules[] {
  if (!Array.isArray(raw)) throw new TaxonomyError('contextSignals must be an array');
  return raw.map((c, i) => {
    const where = `contextSignals[${i}]`;
    if (!isRecord(c) || typeof c.id !== 'string' || !isRecord(c.effect)) throw new TaxonomyError(`${where} is malformed`);
    const factor = num(c.effect.topicEvidenceFactor, `${where}.effect.topicEvidenceFactor`);
    if (factor < 0 || factor > 1) throw new TaxonomyError(`${where}.effect.topicEvidenceFactor must be within 0..1`);
    const domains = strings(c.effect.domains, `${where}.effect.domains`) as Domain[];
    if (!domains.every((d) => d === 'ai' || d === 'engineering')) throw new TaxonomyError(`${where}.effect.domains must be ai/engineering`);
    return {
      id: c.id,
      description: typeof c.description === 'string' ? c.description : '',
      topics: strings(c.topics, `${where}.topics`),
      keywords: strings(c.keywords, `${where}.keywords`),
      effect: { topicEvidenceFactor: factor, domains },
    };
  });
}

function parseCategories(raw: unknown, domain: Domain, source: string): CategoryRules[] {
  if (!isRecord(raw) || raw.domain !== domain || !Array.isArray(raw.categories)) throw new TaxonomyError(`${source}: expected domain "${domain}" with categories`);
  return raw.categories.map((c, i) => {
    const where = `${source}.categories[${i}]`;
    if (!isRecord(c) || typeof c.slug !== 'string' || typeof c.name !== 'string') throw new TaxonomyError(`${where} needs slug and name`);
    const k = c.classification;
    if (!isRecord(k)) throw new TaxonomyError(`${where} (${c.slug}) has no classification block`);
    const languages: Record<string, number> = {};
    if (k.languages !== undefined) {
      if (!isRecord(k.languages)) throw new TaxonomyError(`${where}.classification.languages must be an object`);
      for (const [lang, w] of Object.entries(k.languages)) languages[lang] = num(w, `${where}.classification.languages.${lang}`);
    }
    return {
      slug: c.slug,
      name: c.name,
      domain,
      strongTopics: strings(k.strongTopics, `${where}.strongTopics`),
      weakTopics: strings(k.weakTopics, `${where}.weakTopics`),
      strongKeywords: strings(k.strongKeywords, `${where}.strongKeywords`),
      weakKeywords: strings(k.weakKeywords, `${where}.weakKeywords`),
      exclusionTopics: strings(k.exclusionTopics, `${where}.exclusionTopics`),
      exclusionKeywords: strings(k.exclusionKeywords, `${where}.exclusionKeywords`),
      languages,
    };
  });
}

/** Validate untrusted JSON (global scoring + both category files) into a Taxonomy. */
export function parseTaxonomy(global: unknown, ai: unknown, engineering: unknown): Taxonomy {
  if (!isRecord(global) || global.schemaVersion !== 1) throw new TaxonomyError('classification config: unsupported schemaVersion');
  if (typeof global.classifierVersion !== 'string' || !global.classifierVersion) throw new TaxonomyError('classification config: classifierVersion is required');
  if (!isRecord(global.acceptance) || !isRecord(global.confidence)) throw new TaxonomyError('classification config: acceptance and confidence are required');
  const categories = [...parseCategories(ai, 'ai', 'ai.json'), ...parseCategories(engineering, 'engineering', 'engineering.json')];
  const seen = new Set<string>();
  for (const c of categories) {
    if (seen.has(c.slug)) throw new TaxonomyError(`duplicate category slug ${c.slug}`);
    seen.add(c.slug);
  }
  const taxonomy: Taxonomy = {
    classifierVersion: global.classifierVersion,
    weights: parseWeights(global.weights),
    acceptance: {
      minScore: num(global.acceptance.minScore, 'acceptance.minScore'),
      minEvidenceKinds: num(global.acceptance.minEvidenceKinds, 'acceptance.minEvidenceKinds'),
      requireIdentityEvidence: global.acceptance.requireIdentityEvidence === true,
      corroboratedMinScore: num(global.acceptance.corroboratedMinScore, 'acceptance.corroboratedMinScore'),
      corroboratedMinKinds: num(global.acceptance.corroboratedMinKinds, 'acceptance.corroboratedMinKinds'),
      bothMinRatio: num(global.acceptance.bothMinRatio, 'acceptance.bothMinRatio'),
    },
    confidence: {
      halfScore: num(global.confidence.halfScore, 'confidence.halfScore'),
      high: num(global.confidence.high, 'confidence.high'),
      medium: num(global.confidence.medium, 'confidence.medium'),
    },
    contextSignals: parseContext(global.contextSignals),
    categories,
  };
  if (taxonomy.confidence.halfScore <= 0) throw new TaxonomyError('confidence.halfScore must be positive');
  return taxonomy;
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new TaxonomyError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

export function loadTaxonomy(paths: { global?: string; ai?: string; engineering?: string } = {}): Taxonomy {
  return parseTaxonomy(
    readJson(paths.global ?? 'config/classification.json'),
    readJson(paths.ai ?? 'config/categories/ai.json'),
    readJson(paths.engineering ?? 'config/categories/engineering.json'),
  );
}
