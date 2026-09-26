import type { Domain } from '../discovery/config';
import type { DiscoveredRepository, DiscoveryStats } from '../discovery/discoveryProvider';

export const CANDIDATES_SCHEMA_VERSION = 1 as const;

/**
 * A repository that GitHub Search returned. Metadata is what classification needs;
 * `discovery` is provenance only and MUST NOT be used as evidence of what the
 * repository is (a Java guide found by `topic:mcp` is still a Java guide).
 */
export interface CandidateRecord {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  license: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  isArchived: boolean | null;
  stars: number;
  forks: number;
  openIssues: number;
  metadataSource: 'graphql' | 'rest';
  collectedAt: string;
  discovery: {
    domains: Domain[];
    /** Discovery query categories (slugs) that returned it. Not a classification. */
    queryCategories: string[];
    hits: number;
  };
}

export interface CandidateDataset {
  schemaVersion: typeof CANDIDATES_SCHEMA_VERSION;
  generatedAt: string;
  source: { domains: Domain[]; queries: number; requests: number; failedQueries: number };
  stats: { candidates: number };
  candidates: CandidateRecord[];
}

export function toCandidateRecord(d: DiscoveredRepository): CandidateRecord {
  const s = d.snapshot;
  return {
    id: s.repositoryId,
    owner: s.owner,
    name: s.name,
    fullName: s.fullName,
    url: s.url,
    description: s.description,
    language: s.language,
    topics: [...s.topics],
    license: s.license,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pushedAt: s.pushedAt ?? null,
    isArchived: s.isArchived ?? null,
    stars: s.stars,
    forks: s.forks,
    openIssues: s.openIssues,
    metadataSource: s.source ?? 'rest',
    collectedAt: s.collectedAt,
    discovery: { domains: [...d.domains].sort() as Domain[], queryCategories: [...d.categories].sort(), hits: d.hits },
  };
}

/** Candidates sorted by numeric repository id (stable diffs). */
export function buildCandidateDataset(candidates: readonly DiscoveredRepository[], stats: readonly DiscoveryStats[], generatedAt: Date): CandidateDataset {
  const records = candidates.map(toCandidateRecord).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  return {
    schemaVersion: CANDIDATES_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    source: {
      domains: stats.map((s) => s.domain),
      queries: stats.reduce((n, s) => n + s.queries, 0),
      requests: stats.reduce((n, s) => n + s.requests, 0),
      failedQueries: stats.reduce((n, s) => n + s.failedQueries.length, 0),
    },
    stats: { candidates: records.length },
    candidates: records,
  };
}

export function validateCandidateDataset(ds: unknown): string[] {
  const problems: string[] = [];
  if (typeof ds !== 'object' || ds === null) return ['candidate dataset is not an object'];
  const d = ds as Partial<CandidateDataset>;
  if (d.schemaVersion !== CANDIDATES_SCHEMA_VERSION) problems.push(`schemaVersion must be ${CANDIDATES_SCHEMA_VERSION}`);
  if (!Array.isArray(d.candidates)) return [...problems, 'candidates must be an array'];
  const seen = new Set<string>();
  let previous: bigint | null = null;
  d.candidates.forEach((c, i) => {
    const where = `candidates[${i}]`;
    if (typeof c?.id !== 'string' || !/^\d+$/.test(c.id)) return void problems.push(`${where}.id must be a numeric string`);
    if (seen.has(c.id)) problems.push(`${where}.id ${c.id} is duplicated`);
    seen.add(c.id);
    const id = BigInt(c.id);
    if (previous !== null && id <= previous) problems.push(`${where} is not sorted by id`);
    previous = id;
    if (c.fullName !== `${c.owner}/${c.name}`) problems.push(`${where}.fullName does not equal owner/name`);
    if (!Array.isArray(c.topics)) problems.push(`${where}.topics must be an array`);
    if (!Number.isSafeInteger(c.stars) || c.stars < 0) problems.push(`${where}.stars must be a non-negative integer`);
  });
  if (d.stats && d.stats.candidates !== d.candidates.length) problems.push('stats.candidates does not match candidates.length');
  return problems;
}
