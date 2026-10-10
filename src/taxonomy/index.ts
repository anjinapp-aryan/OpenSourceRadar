/**
 * Taxonomy v2 (Phase 6.3): Domain -> Area -> Technology, plus facets. Deterministic and explainable: every detection names the
 * topics, name tokens and description phrases that caused it. Sits on top of the v1 category classifier, which is unchanged;
 * the matching primitives (tokenisation, camelCase names, phrase matching) are reused from `classification/text`.
 */
import { readFileSync } from 'node:fs';
import { compileTerm, matchTerms, normalizeTopics, TextIndex, type CompiledTerm } from '../classification/text';

export type AgeBand = 'emerging' | 'growing' | 'established' | 'mature';
export type ContentType = 'software' | 'learning';

export interface TechnologyDef {
  slug: string;
  name: string;
  area: string;
  topics: string[];
  names: string[];
  keywords: string[];
}

export interface AreaDef {
  slug: string;
  name: string;
}

export interface TaxonomyV2 {
  taxonomyVersion: number;
  acceptance: { weights: { topic: number; name: number; description: number }; minScore: number };
  ageBands: { slug: AgeBand; maxAgeDays: number | null }[];
  learningContextId: string;
  learning: { weights: { topic: number; name: number; description: number; descriptionMax: number }; minScore: number; topics: Set<string>; names: CompiledTerm[]; keywords: CompiledTerm[] };
  engineeringAreas: AreaDef[];
  /** v1 category -> area; null = the category is a concept or content type (for example system-design), not an area. */
  categoryToArea: Record<string, string | null>;
  technologies: TechnologyDef[];
}

export class TaxonomyV2Error extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown, where: string): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '')) throw new TaxonomyV2Error(`${where}: expected a list of non-empty strings`);
  return v.map((x) => (x as string).trim().toLowerCase());
};

export function parseTaxonomyV2(raw: unknown): TaxonomyV2 {
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw new TaxonomyV2Error('taxonomy v2: unsupported schemaVersion');
  if (typeof raw.taxonomyVersion !== 'number' || raw.taxonomyVersion !== 2) throw new TaxonomyV2Error('taxonomy v2: taxonomyVersion must be 2');
  const acc = raw.acceptance;
  if (!isRecord(acc) || !isRecord(acc.weights)) throw new TaxonomyV2Error('taxonomy v2: acceptance.weights is required');
  const w = acc.weights;
  const num = (v: unknown, where: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TaxonomyV2Error(`${where}: expected a non-negative number`);
    return v;
  };
  const facets = raw.facets;
  if (!isRecord(facets) || !Array.isArray(facets.ageBands) || typeof facets.learningContextId !== 'string') throw new TaxonomyV2Error('taxonomy v2: facets are required');
  const L = facets.learning;
  if (!isRecord(L) || !isRecord(L.weights)) throw new TaxonomyV2Error('taxonomy v2: facets.learning is required');
  const learning = {
    weights: { topic: num(L.weights.topic, 'learning.weights.topic'), name: num(L.weights.name, 'learning.weights.name'), description: num(L.weights.description, 'learning.weights.description'), descriptionMax: num(L.weights.descriptionMax, 'learning.weights.descriptionMax') },
    minScore: num(L.minScore, 'learning.minScore'),
    topics: new Set(strings(L.topics, 'learning.topics')),
    names: strings(L.names, 'learning.names').map(compileTerm),
    keywords: strings(L.keywords, 'learning.keywords').map(compileTerm),
  };
  const areasRaw = raw.areas;
  if (!isRecord(areasRaw) || !Array.isArray(areasRaw.engineering)) throw new TaxonomyV2Error('taxonomy v2: areas.engineering is required');
  const engineeringAreas = areasRaw.engineering.map((a, i) => {
    if (!isRecord(a) || typeof a.slug !== 'string' || typeof a.name !== 'string') throw new TaxonomyV2Error(`areas.engineering[${i}]: slug and name are required`);
    return { slug: a.slug, name: a.name };
  });
  const areaSlugs = new Set(engineeringAreas.map((a) => a.slug));
  if (areaSlugs.size !== engineeringAreas.length) throw new TaxonomyV2Error('duplicate area slug');
  if (!isRecord(raw.categoryToArea)) throw new TaxonomyV2Error('taxonomy v2: categoryToArea is required');
  const categoryToArea: Record<string, string | null> = {};
  for (const [cat, area] of Object.entries(raw.categoryToArea)) {
    if (area === null) {
      categoryToArea[cat] = null;
      continue;
    }
    if (typeof area !== 'string' || !areaSlugs.has(area)) throw new TaxonomyV2Error(`categoryToArea.${cat}: unknown area ${String(area)}`);
    categoryToArea[cat] = area;
  }
  if (!Array.isArray(raw.technologies)) throw new TaxonomyV2Error('taxonomy v2: technologies is required');
  const seen = new Set<string>();
  const technologies = raw.technologies.map((t, i) => {
    const where = `technologies[${i}]`;
    if (!isRecord(t) || typeof t.slug !== 'string' || typeof t.name !== 'string' || typeof t.area !== 'string') throw new TaxonomyV2Error(`${where}: slug, name and area are required`);
    if (seen.has(t.slug)) throw new TaxonomyV2Error(`duplicate technology slug ${t.slug}`);
    seen.add(t.slug);
    if (!areaSlugs.has(t.area)) throw new TaxonomyV2Error(`${where}: unknown area ${t.area}`);
    const def: TechnologyDef = { slug: t.slug, name: t.name, area: t.area, topics: strings(t.topics, `${where}.topics`), names: strings(t.names, `${where}.names`), keywords: strings(t.keywords, `${where}.keywords`) };
    if (def.topics.length === 0 && def.names.length === 0) throw new TaxonomyV2Error(`${where}: needs at least one topic or name`);
    return def;
  });
  const ageBands = facets.ageBands.map((b, i) => {
    if (!isRecord(b) || typeof b.slug !== 'string' || !(b.maxAgeDays === null || typeof b.maxAgeDays === 'number')) throw new TaxonomyV2Error(`facets.ageBands[${i}] is invalid`);
    return { slug: b.slug as AgeBand, maxAgeDays: b.maxAgeDays as number | null };
  });
  return {
    taxonomyVersion: 2,
    acceptance: { weights: { topic: num(w.topic, 'weights.topic'), name: num(w.name, 'weights.name'), description: num(w.description, 'weights.description') }, minScore: num(acc.minScore, 'acceptance.minScore') },
    ageBands,
    learningContextId: facets.learningContextId,
    learning,
    engineeringAreas,
    categoryToArea,
    technologies,
  };
}

export function loadTaxonomyV2(path = 'config/taxonomy.v2.json'): TaxonomyV2 {
  try {
    return parseTaxonomyV2(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    if (e instanceof TaxonomyV2Error) throw e;
    throw new TaxonomyV2Error(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface TechnologyInput {
  name: string;
  description: string | null;
  topics: readonly string[];
}

export interface TechnologyMatch {
  slug: string;
  name: string;
  area: string;
  score: number;
  /** What caused the match: nothing here is inferred. */
  evidence: { topics: string[]; names: string[]; keywords: string[] };
}

interface Compiled {
  def: TechnologyDef;
  topics: Set<string>;
  names: CompiledTerm[];
  keywords: CompiledTerm[];
}

const cache = new WeakMap<TaxonomyV2, Compiled[]>();
function compiled(t: TaxonomyV2): Compiled[] {
  let c = cache.get(t);
  if (!c) {
    c = t.technologies.map((def) => ({ def, topics: new Set(def.topics), names: def.names.map(compileTerm), keywords: def.keywords.map(compileTerm) }));
    cache.set(t, c);
  }
  return c;
}

/** Technologies detected for one repository, best score first (ties by slug). */
export function detectTechnologies(taxonomy: TaxonomyV2, input: TechnologyInput): TechnologyMatch[] {
  const topics = normalizeTopics(input.topics);
  const nameIndex = new TextIndex(input.name, { camelCase: true });
  const descIndex = new TextIndex(input.description);
  const { weights, minScore } = taxonomy.acceptance;
  const out: TechnologyMatch[] = [];
  for (const c of compiled(taxonomy)) {
    const topicHits = topics.filter((t) => c.topics.has(t));
    const nameHits = matchTerms(nameIndex, c.names).map((t) => t.raw);
    const keywordHits = matchTerms(descIndex, c.keywords).map((t) => t.raw);
    const score = (topicHits.length > 0 ? weights.topic : 0) + (nameHits.length > 0 ? weights.name : 0) + (keywordHits.length > 0 ? weights.description : 0);
    if (score >= minScore) out.push({ slug: c.def.slug, name: c.def.name, area: c.def.area, score, evidence: { topics: topicHits, names: nameHits, keywords: keywordHits } });
  }
  return out.sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : 1));
}

export function ageBandOf(taxonomy: TaxonomyV2, ageDays: number): AgeBand {
  for (const b of taxonomy.ageBands) if (b.maxAgeDays === null || ageDays < b.maxAgeDays) return b.slug;
  return 'mature';
}

/** Learning/list content (tutorials, courses, awesome lists, interview prep): evidence is shown, never inferred. */
export function detectLearning(taxonomy: TaxonomyV2, input: TechnologyInput): { learning: boolean; score: number; evidence: { topics: string[]; names: string[]; keywords: string[] } } {
  const L = taxonomy.learning;
  const topics = normalizeTopics(input.topics).filter((t) => L.topics.has(t));
  const names = matchTerms(new TextIndex(input.name, { camelCase: true }), L.names).map((t) => t.raw);
  const keywords = matchTerms(new TextIndex(input.description), L.keywords).map((t) => t.raw);
  const score = (topics.length > 0 ? L.weights.topic : 0) + (names.length > 0 ? L.weights.name : 0) + Math.min(L.weights.descriptionMax, keywords.length * L.weights.description);
  return { learning: score >= L.minScore, score, evidence: { topics, names, keywords } };
}

export interface RecordTaxonomy {
  taxonomyVersion: 2;
  /** Engineering areas: from detected technologies first, then from the v1 categories. Empty for AI-only repositories. */
  areas: string[];
  technologies: string[];
  facets: { language: string | null; ageBand: AgeBand; contentType: ContentType };
}

export interface RecordTaxonomyInput extends TechnologyInput {
  language: string | null;
  ageDays: number;
  /** v1 category slugs and top-level result from the existing classifier. */
  categories: readonly string[];
  topLevel: 'AI' | 'ENGINEERING' | 'BOTH' | 'UNKNOWN';
  /** ids of the v1 context signals that matched (for example `educational-content`). */
  contextIds: readonly string[];
}

/** The v2 view of one repository. Pure function of stored facts. */
export function taxonomyOf(taxonomy: TaxonomyV2, r: RecordTaxonomyInput): RecordTaxonomy {
  const engineering = r.topLevel === 'ENGINEERING' || r.topLevel === 'BOTH';
  const techs = engineering ? detectTechnologies(taxonomy, r) : [];
  const areas: string[] = [];
  for (const t of techs) if (!areas.includes(t.area)) areas.push(t.area);
  if (engineering) {
    for (const c of r.categories) {
      const a = taxonomy.categoryToArea[c];
      if (a && !areas.includes(a)) areas.push(a);
    }
  }
  return {
    taxonomyVersion: 2,
    areas,
    technologies: techs.map((t) => t.slug),
    facets: { language: r.language, ageBand: ageBandOf(taxonomy, r.ageDays), contentType: r.contextIds.includes(taxonomy.learningContextId) || detectLearning(taxonomy, r).learning ? 'learning' : 'software' },
  };
}
