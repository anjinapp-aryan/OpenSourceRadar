import type { CandidateDataset, CandidateRecord } from '../collect/candidates';
import type { Classifier } from './classifier';
import type { ClassificationInput, ClassificationResult, TopLevelCategory } from './types';

export const CLASSIFIED_SCHEMA_VERSION = 1 as const;

/**
 * Classified repositories reference candidates by GitHub repository id only. Metadata
 * (description, topics, stars ...) stays in the candidate dataset: no duplication.
 * `fullName` is kept for readability and reflects the name at classification time.
 */
export interface ClassifiedRecord {
  id: string;
  fullName: string;
  result: ClassificationResult;
}

export interface ClassifiedSummary {
  total: number;
  byTopLevel: Record<TopLevelCategory, number>;
  byCategory: Record<string, number>;
}

export interface ClassifiedDataset {
  schemaVersion: typeof CLASSIFIED_SCHEMA_VERSION;
  classifierVersion: string;
  generatedAt: string;
  source: { candidatesGeneratedAt: string; candidates: number };
  summary: ClassifiedSummary;
  repositories: ClassifiedRecord[];
}

/**
 * The ONLY fields the classifier sees. Discovery provenance (which query found the
 * repository) is deliberately dropped here, so classification cannot depend on it.
 */
export function toClassificationInput(c: CandidateRecord): ClassificationInput {
  return { id: c.id, name: c.name, description: c.description, topics: c.topics, language: c.language };
}

export function summarize(records: readonly ClassifiedRecord[]): ClassifiedSummary {
  const byTopLevel: Record<TopLevelCategory, number> = { AI: 0, ENGINEERING: 0, BOTH: 0, UNKNOWN: 0 };
  const byCategory: Record<string, number> = {};
  for (const r of records) {
    byTopLevel[r.result.topLevelCategory] += 1;
    for (const c of r.result.categories) byCategory[c.slug] = (byCategory[c.slug] ?? 0) + 1;
  }
  return { total: records.length, byTopLevel, byCategory: Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b))) };
}

export function classifyCandidates(dataset: CandidateDataset, classifier: Classifier, generatedAt: Date): ClassifiedDataset {
  const repositories = dataset.candidates.map((c) => ({ id: c.id, fullName: c.fullName, result: classifier.classify(toClassificationInput(c)) }));
  return {
    schemaVersion: CLASSIFIED_SCHEMA_VERSION,
    classifierVersion: classifier.taxonomy.classifierVersion,
    generatedAt: generatedAt.toISOString(),
    source: { candidatesGeneratedAt: dataset.generatedAt, candidates: dataset.candidates.length },
    summary: summarize(repositories),
    repositories,
  };
}

export function validateClassifiedDataset(ds: unknown): string[] {
  const problems: string[] = [];
  if (typeof ds !== 'object' || ds === null) return ['classified dataset is not an object'];
  const d = ds as Partial<ClassifiedDataset>;
  if (d.schemaVersion !== CLASSIFIED_SCHEMA_VERSION) problems.push(`schemaVersion must be ${CLASSIFIED_SCHEMA_VERSION}`);
  if (typeof d.classifierVersion !== 'string') problems.push('classifierVersion is required');
  if (!Array.isArray(d.repositories)) return [...problems, 'repositories must be an array'];
  const seen = new Set<string>();
  d.repositories.forEach((r, i) => {
    const where = `repositories[${i}]`;
    if (typeof r?.id !== 'string' || !/^\d+$/.test(r.id)) return void problems.push(`${where}.id must be a numeric string`);
    if (seen.has(r.id)) problems.push(`${where}.id ${r.id} is duplicated`);
    seen.add(r.id);
    const res = r.result;
    if (!res || res.classifierVersion !== d.classifierVersion) problems.push(`${where}.result.classifierVersion does not match the dataset`);
    else {
      const domains = new Set(res.categories.map((c) => c.domain));
      const expected: TopLevelCategory = domains.size === 0 ? 'UNKNOWN' : domains.size === 2 ? 'BOTH' : domains.has('ai') ? 'AI' : 'ENGINEERING';
      if (res.topLevelCategory !== expected) problems.push(`${where}: topLevelCategory ${res.topLevelCategory} contradicts its categories (${expected})`);
      if (res.topLevelCategory === 'UNKNOWN' && res.categories.length > 0) problems.push(`${where}: UNKNOWN with categories`);
    }
  });
  if (d.summary && d.summary.total !== d.repositories.length) problems.push('summary.total does not match repositories.length');
  return problems;
}
