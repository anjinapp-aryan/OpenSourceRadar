import { readFileSync } from 'node:fs';

export type Domain = 'ai' | 'engineering';

export interface CategoryDefinition {
  slug: string;
  name: string;
  description: string;
  /** GitHub Search queries with {minStars} {freshMinStars} {pushedSince} {createdSince} placeholders. */
  searchQueries: string[];
  /** Lower-case phrases matched against repository name + description. */
  keywords: string[];
  /** GitHub topics (lower-case, hyphenated). */
  topics: string[];
}

export interface DiscoverySettings {
  minStars: number;
  freshMinStars: number;
  pushedWithinDays: number;
  createdWithinDays: number;
  perPage: number;
  maxPagesPerQuery: number;
  excludeForks: boolean;
  excludeArchived: boolean;
}

export interface CategoryConfig {
  schemaVersion: 1;
  domain: Domain;
  discovery: DiscoverySettings;
  categories: CategoryDefinition[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const PLACEHOLDERS = new Set(['minStars', 'freshMinStars', 'pushedSince', 'createdSince']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown, where: string, options: { nonEmpty: boolean }): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '')) {
    throw new ConfigError(`${where} must be an array of non-empty strings`);
  }
  if (options.nonEmpty && v.length === 0) throw new ConfigError(`${where} must not be empty`);
  return v as string[];
}

function positiveInt(v: unknown, where: string, min = 0): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new ConfigError(`${where} must be an integer >= ${min}`);
  return v;
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') throw new ConfigError(`${where} must be a boolean`);
  return v;
}

/** Validate untrusted JSON into a CategoryConfig. Throws ConfigError with the offending path. */
export function parseCategoryConfig(raw: unknown, source = 'config'): CategoryConfig {
  if (!isRecord(raw)) throw new ConfigError(`${source}: must be an object`);
  if (raw.schemaVersion !== 1) throw new ConfigError(`${source}: unsupported schemaVersion ${String(raw.schemaVersion)}`);
  if (raw.domain !== 'ai' && raw.domain !== 'engineering') throw new ConfigError(`${source}: domain must be "ai" or "engineering"`);
  if (!isRecord(raw.discovery)) throw new ConfigError(`${source}: discovery must be an object`);
  const d = raw.discovery;
  const discovery: DiscoverySettings = {
    minStars: positiveInt(d.minStars, `${source}.discovery.minStars`),
    freshMinStars: positiveInt(d.freshMinStars, `${source}.discovery.freshMinStars`),
    pushedWithinDays: positiveInt(d.pushedWithinDays, `${source}.discovery.pushedWithinDays`, 1),
    createdWithinDays: positiveInt(d.createdWithinDays, `${source}.discovery.createdWithinDays`, 1),
    perPage: positiveInt(d.perPage, `${source}.discovery.perPage`, 1),
    maxPagesPerQuery: positiveInt(d.maxPagesPerQuery, `${source}.discovery.maxPagesPerQuery`, 1),
    excludeForks: bool(d.excludeForks, `${source}.discovery.excludeForks`),
    excludeArchived: bool(d.excludeArchived, `${source}.discovery.excludeArchived`),
  };
  if (discovery.perPage > 100) throw new ConfigError(`${source}.discovery.perPage must be <= 100`);
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) throw new ConfigError(`${source}: categories must be a non-empty array`);

  const seen = new Set<string>();
  const categories = raw.categories.map((c, i): CategoryDefinition => {
    const where = `${source}.categories[${i}]`;
    if (!isRecord(c)) throw new ConfigError(`${where} must be an object`);
    if (typeof c.slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)) throw new ConfigError(`${where}.slug must be kebab-case`);
    if (seen.has(c.slug)) throw new ConfigError(`${where}.slug "${c.slug}" is duplicated`);
    seen.add(c.slug);
    if (typeof c.name !== 'string' || !c.name) throw new ConfigError(`${where}.name is required`);
    if (typeof c.description !== 'string') throw new ConfigError(`${where}.description is required`);
    const searchQueries = stringArray(c.searchQueries, `${where}.searchQueries`, { nonEmpty: true });
    for (const q of searchQueries) assertPlaceholdersKnown(q, `${where}.searchQueries`);
    return {
      slug: c.slug,
      name: c.name,
      description: c.description,
      searchQueries,
      keywords: stringArray(c.keywords, `${where}.keywords`, { nonEmpty: false }).map((k) => k.toLowerCase()),
      topics: stringArray(c.topics, `${where}.topics`, { nonEmpty: false }).map((t) => t.toLowerCase()),
    };
  });
  return { schemaVersion: 1, domain: raw.domain, discovery, categories };
}

function assertPlaceholdersKnown(query: string, where: string): void {
  for (const m of query.matchAll(/\{(\w+)\}/g)) {
    if (!PLACEHOLDERS.has(m[1] as string)) throw new ConfigError(`${where}: unknown placeholder {${m[1]}} in "${query}"`);
  }
}

export function loadCategoryConfig(path: string): CategoryConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseCategoryConfig(json, path);
}

export function defaultConfigPath(domain: Domain): string {
  return `config/categories/${domain}.json`;
}

/** Fill a query template. Every placeholder must be resolvable. */
export function expandQuery(template: string, settings: DiscoverySettings, now: Date): string {
  const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
  const values: Record<string, string> = {
    minStars: String(settings.minStars),
    freshMinStars: String(settings.freshMinStars),
    pushedSince: day(settings.pushedWithinDays),
    createdSince: day(settings.createdWithinDays),
  };
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = values[key];
    if (v === undefined) throw new ConfigError(`unknown placeholder {${key}} in "${template}"`);
    return v;
  });
}
