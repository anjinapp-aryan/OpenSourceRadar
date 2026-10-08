/**
 * Discovery coverage (Phase 6.2). Pure and deterministic.
 *
 * 1. Why a previously discovered repository is missing from this week's discovery (`orphanReason`), derived from the
 *    actual discovery rules: every query is `topic:X` plus either `stars:>{minStars} pushed:>{pushedSince}` or
 *    `created:>{createdSince} stars:>{freshMinStars}`, sorted by stars, first page only (top `perPage`).
 * 2. What should happen to it (`orphanOutcome`), given live facts when available.
 * 3. A bounded candidate-retention registry (`updateRegistry`) so a repository does not vanish from internal
 *    awareness after one missed weekly search (designed in Phase 6.2, NOT enabled in production; see
 *    docs/PHASE-6.2-COVERAGE-RECOVERY.md).
 */
import type { CategoryConfig } from '../discovery/config';

export interface DiscoveryQuery {
  topic: string;
  kind: 'pushed' | 'fresh';
  /** Strict lower bound on stars (`stars:>N`). */
  minStarsExclusive: number;
  /** Days for `pushed:>` (kind pushed) or `created:>` (kind fresh). */
  windowDays: number;
  /** Results kept per query (perPage x maxPagesPerQuery). */
  limit: number;
}

/** Parse the configured query templates into structured rules. Throws on a template this model does not understand. */
export function discoveryQueries(configs: readonly CategoryConfig[]): DiscoveryQuery[] {
  const out: DiscoveryQuery[] = [];
  const seen = new Set<string>();
  for (const c of configs) {
    const s = c.discovery;
    for (const cat of c.categories) {
      for (const t of cat.searchQueries) {
        const topic = /topic:([a-z0-9-]+)/.exec(t)?.[1];
        let q: DiscoveryQuery | null = null;
        if (topic && /stars:>\{minStars\}/.test(t) && /pushed:>\{pushedSince\}/.test(t)) {
          q = { topic, kind: 'pushed', minStarsExclusive: s.minStars, windowDays: s.pushedWithinDays, limit: s.perPage * s.maxPagesPerQuery };
        } else if (topic && /created:>\{createdSince\}/.test(t) && /stars:>\{freshMinStars\}/.test(t)) {
          q = { topic, kind: 'fresh', minStarsExclusive: s.freshMinStars, windowDays: s.createdWithinDays, limit: s.perPage * s.maxPagesPerQuery };
        }
        if (q === null) throw new Error(`coverage: unsupported discovery query template "${t}"`);
        const key = `${q.topic}|${q.kind}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(q);
        }
      }
    }
  }
  return out;
}

export interface RepoFacts {
  id: string;
  stars: number;
  topics: readonly string[];
  createdAt: string;
  pushedAt: string | null;
  isArchived: boolean | null;
  isFork?: boolean | null;
}

const DAY_MS = 86_400_000;
const within = (iso: string | null, discovery: Date, days: number) => iso !== null && Date.parse(iso) > discovery.getTime() - days * DAY_MS;

/** Would `q` match `r` (before the top-N cut)? */
export function matches(q: DiscoveryQuery, r: RepoFacts, discovery: Date): boolean {
  if (!r.topics.includes(q.topic) || r.stars <= q.minStarsExclusive || r.isArchived === true || r.isFork === true) return false;
  return q.kind === 'pushed' ? within(r.pushedAt, discovery, q.windowDays) : within(r.createdAt, discovery, q.windowDays);
}

export const ORPHAN_REASONS = ['ARCHIVED', 'TOPIC_MISMATCH', 'BELOW_STAR_FLOOR', 'PUSH_WINDOW', 'RANK_CUTOFF', 'SEARCH_MISS'] as const;
export type OrphanReason = (typeof ORPHAN_REASONS)[number];

export interface OrphanDiagnosis {
  reason: OrphanReason;
  /** Queries whose filters the repository satisfies. */
  matchingQueries: number;
  /** Best (smallest) star rank among the queries it matches (1 = most stars); null when it matches none. */
  bestRank: number | null;
  detail: string;
}

/**
 * Why `r` is not in this week's candidate set, judged against the discovery rules and the competitors that WERE
 * returned (`pool`: the current candidate set, which contains every query's top N). First applicable reason wins.
 */
export function orphanReason(r: RepoFacts, pool: readonly RepoFacts[], queries: readonly DiscoveryQuery[], discovery: Date): OrphanDiagnosis {
  if (r.isArchived === true) return { reason: 'ARCHIVED', matchingQueries: 0, bestRank: null, detail: 'archived (discovery excludes archived repositories)' };
  const topical = queries.filter((q) => r.topics.includes(q.topic));
  if (topical.length === 0) return { reason: 'TOPIC_MISMATCH', matchingQueries: 0, bestRank: null, detail: 'none of its topics is a discovery topic' };
  const starOk = topical.filter((q) => r.stars > q.minStarsExclusive);
  if (starOk.length === 0) return { reason: 'BELOW_STAR_FLOOR', matchingQueries: 0, bestRank: null, detail: `stars ${r.stars} at or below every matching query floor` };
  const m = topical.filter((q) => matches(q, r, discovery));
  if (m.length === 0) {
    const fresh = within(r.createdAt, discovery, Math.max(...topical.map((q) => q.windowDays)));
    return { reason: 'PUSH_WINDOW', matchingQueries: 0, bestRank: null, detail: fresh ? 'outside every query window' : `no push within ${topical[0]?.windowDays ?? 30} days and too old for the new-repository queries` };
  }
  let bestRank = Infinity;
  for (const q of m) {
    const ahead = pool.filter((p) => p.id !== r.id && matches(q, p, discovery) && (p.stars > r.stars || (p.stars === r.stars && BigInt(p.id) < BigInt(r.id)))).length;
    bestRank = Math.min(bestRank, ahead + 1);
  }
  const limit = Math.max(...m.map((q) => q.limit));
  if (bestRank > limit) return { reason: 'RANK_CUTOFF', matchingQueries: m.length, bestRank, detail: `matches ${m.length} query(ies) but ranks ${bestRank} by stars in the best one (only the top ${limit} are returned)` };
  return { reason: 'SEARCH_MISS', matchingQueries: m.length, bestRank, detail: `would rank ${bestRank} (inside the top ${limit}); missing for a reason not visible in stored data (search index, metadata change after collection)` };
}

export const ORPHAN_OUTCOMES = ['RECOVERABLE', 'DISCOVERY_GAP', 'RECLASSIFY', 'ARCHIVED', 'FORK', 'NOT_FOUND', 'UNKNOWN'] as const;
export type OrphanOutcome = (typeof ORPHAN_OUTCOMES)[number];

export interface LiveFacts {
  /** HTTP status of github.com/<owner>/<name> (200, 404, ...) or null when not checked. */
  status: number | null;
  /** Final owner/name after redirects when it differs (a rename or transfer). */
  renamedTo: string | null;
  isArchived?: boolean | null;
  isFork?: boolean | null;
}

/**
 * RECOVERABLE   reachable, relevant (current classifier assigns a category), and the CURRENT discovery rules would return
 *               it (SEARCH_MISS): it comes back on its own; retention only bridges the gap.
 * DISCOVERY_GAP reachable and relevant, but the current rules would not return it (rank cutoff, push window, star floor,
 *               topic change): only a retention mechanism (or wider discovery) keeps it.
 * RECLASSIFY    reachable, but the current classifier no longer assigns any category: relevance must be re-established.
 * ARCHIVED / FORK / NOT_FOUND from live facts (or stored archive flag); UNKNOWN when reachability was not checked.
 */
export function orphanOutcome(d: OrphanDiagnosis, relevant: boolean, live: LiveFacts | null): OrphanOutcome {
  if (live?.status === 404 || live?.status === 410 || live?.status === 451) return 'NOT_FOUND';
  if (live?.isArchived === true || d.reason === 'ARCHIVED') return 'ARCHIVED';
  if (live?.isFork === true) return 'FORK';
  if (live === null || live.status === null || live.status >= 500) return 'UNKNOWN';
  if (!relevant) return 'RECLASSIFY';
  return d.reason === 'SEARCH_MISS' ? 'RECOVERABLE' : 'DISCOVERY_GAP';
}

// ------------------------------------------------------------------ candidate retention registry (designed, not enabled)

export interface RegistryConfig {
  /** Weekly discoveries a repository may miss and still be carried over. */
  maxMissedDiscoveries: number;
  /** Upper bound on carried-over (not freshly discovered) repositories. */
  maxRetained: number;
  /** Weeks a retired entry is remembered before it is dropped from the registry file. */
  forgetRetiredAfterWeeks: number;
}

export type RegistryStatus = 'ACTIVE' | 'RETAINED' | 'RETIRED';

export interface RegistryEntry {
  id: string;
  fullName: string;
  firstSeen: string;
  lastDiscovered: string;
  missedDiscoveries: number;
  status: RegistryStatus;
  /** Why it was retired (exceeded misses, archived, not found, capacity, unclassified). */
  retiredReason?: string;
  retiredAt?: string;
}

export interface Registry {
  schemaVersion: 1;
  updatedAt: string;
  entries: Record<string, RegistryEntry>;
}

export interface RegistryUpdateInput {
  /** This week's discovery result (id -> fullName). */
  discovered: ReadonlyMap<string, string>;
  /** Facts known for previously registered repositories (from collection): archived, not found, unclassified, priority. */
  facts: ReadonlyMap<string, { archived?: boolean; notFound?: boolean; unclassified?: boolean; priority: number; fullName?: string }>;
  date: string;
}

/**
 * One weekly step. Deterministic: ties broken by id. Discovered repositories are always ACTIVE; previously known ones are
 * RETAINED while they miss at most `maxMissedDiscoveries` runs, are not archived/not found/unclassified, and fit inside
 * `maxRetained` (highest priority first). Everything else is RETIRED; retired entries are forgotten after
 * `forgetRetiredAfterWeeks`. Renames are handled by id (GitHub repository ids survive renames and transfers).
 */
export function updateRegistry(prev: Registry | null, input: RegistryUpdateInput, cfg: RegistryConfig): Registry {
  const entries: Record<string, RegistryEntry> = {};
  const prevEntries = prev?.entries ?? {};
  for (const [id, fullName] of input.discovered) {
    const p = prevEntries[id];
    entries[id] = { id, fullName, firstSeen: p?.firstSeen ?? input.date, lastDiscovered: input.date, missedDiscoveries: 0, status: 'ACTIVE' };
  }
  const contenders: RegistryEntry[] = [];
  for (const p of Object.values(prevEntries)) {
    if (input.discovered.has(p.id)) continue;
    const f = input.facts.get(p.id);
    const fullName = f?.fullName ?? p.fullName;
    if (p.status === 'RETIRED') {
      const weeks = (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${p.retiredAt ?? input.date}T00:00:00Z`)) / (7 * DAY_MS);
      if (weeks < cfg.forgetRetiredAfterWeeks) entries[p.id] = { ...p, fullName };
      continue;
    }
    const missed = p.missedDiscoveries + 1;
    const retire = (reason: string) => (entries[p.id] = { ...p, fullName, missedDiscoveries: missed, status: 'RETIRED', retiredReason: reason, retiredAt: input.date });
    if (f?.notFound) retire('not found');
    else if (f?.archived) retire('archived');
    else if (f?.unclassified) retire('no category under the current classifier');
    else if (missed > cfg.maxMissedDiscoveries) retire(`missed ${missed} discoveries`);
    else contenders.push({ ...p, fullName, missedDiscoveries: missed, status: 'RETAINED' });
  }
  const prio = (e: RegistryEntry) => input.facts.get(e.id)?.priority ?? 0;
  contenders.sort((a, b) => prio(b) - prio(a) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  contenders.forEach((e, i) => {
    entries[e.id] = i < cfg.maxRetained ? e : { ...e, status: 'RETIRED', retiredReason: 'retention capacity', retiredAt: input.date };
  });
  return { schemaVersion: 1, updatedAt: input.date, entries };
}

/** Ids that discovery should hand to classification and tracking: discovered plus retained. */
export function activeIds(reg: Registry): string[] {
  return Object.values(reg.entries)
    .filter((e) => e.status !== 'RETIRED')
    .map((e) => e.id)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
}
