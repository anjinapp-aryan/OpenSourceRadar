import type { PublicDataset, PublicRepository } from './radar';

export type TrendFilter = 'all' | 'rising' | 'cooling' | 'steady' | 'new' | 'sustained';
export type SortKey = 'momentum' | 'growth7d' | 'velocity7d' | 'growth30d' | 'stars';

export const TREND_FILTERS: { key: TrendFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'rising', label: 'Rising' },
  { key: 'cooling', label: 'Cooling' },
  { key: 'steady', label: 'Steady' },
  { key: 'new', label: 'New Entrants' },
  { key: 'sustained', label: 'Sustained' },
];

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'momentum', label: 'Momentum' },
  { key: 'growth7d', label: '7d growth' },
  { key: 'velocity7d', label: 'Stars/day' },
  { key: 'growth30d', label: '30d growth' },
  { key: 'stars', label: 'Total stars' },
];

export const TREND_TEXT: Record<string, { arrow: string; label: string }> = {
  RISING: { arrow: '↑', label: 'Rising' },
  COOLING: { arrow: '↓', label: 'Cooling' },
  STEADY: { arrow: '→', label: 'Steady' },
  INSUFFICIENT_DATA: { arrow: '?', label: 'Insufficient data' },
  EXCLUDED: { arrow: '–', label: 'Excluded' },
};

/** AI Radar scope: repositories classified AI, or BOTH (AI and engineering). */
export function isAi(r: PublicRepository): boolean {
  const t = r.classification?.topLevel;
  return t === 'AI' || t === 'BOTH';
}

export function aiRepositories(d: PublicDataset): PublicRepository[] {
  return d.repositories.filter(isAi);
}

export function isTrendFilter(v: unknown): v is TrendFilter {
  return TREND_FILTERS.some((f) => f.key === v);
}
export function isSortKey(v: unknown): v is SortKey {
  return SORTS.some((s) => s.key === v);
}

export function filterRepositories(
  repos: readonly PublicRepository[],
  opts: { category?: string | null; trend?: TrendFilter },
): PublicRepository[] {
  const trend = opts.trend ?? 'all';
  return repos.filter((r) => {
    if (opts.category && !(r.classification?.categories ?? []).includes(opts.category)) return false;
    switch (trend) {
      case 'rising':
        return r.trend === 'RISING';
      case 'cooling':
        return r.trend === 'COOLING';
      case 'steady':
        return r.trend === 'STEADY';
      case 'new':
        return r.flags.newEntrant;
      case 'sustained':
        return r.flags.sustained;
      default:
        return true;
    }
  });
}

const sortValue: Record<SortKey, (r: PublicRepository) => number> = {
  momentum: (r) => r.score ?? -1,
  growth7d: (r) => r.growth7d ?? -1,
  velocity7d: (r) => r.velocity7d ?? -1,
  growth30d: (r) => r.growth30d ?? -1,
  stars: (r) => r.stars,
};

/** Descending, ties broken by full name so the order is deterministic. Null growth sorts last, never as 0. */
export function sortRepositories(repos: readonly PublicRepository[], key: SortKey): PublicRepository[] {
  const f = sortValue[key];
  return [...repos].sort((a, b) => f(b) - f(a) || a.fullName.localeCompare(b.fullName));
}

export interface CategorySummary {
  slug: string;
  name: string;
  count: number;
  rising: number;
  top: PublicRepository[];
}

export function categorySummaries(d: PublicDataset, top = 3): CategorySummary[] {
  const ai = aiRepositories(d);
  return (d.categories ?? [])
    .filter((c) => c.domain === 'ai')
    .map((c) => {
      const inCat = ai.filter((r) => r.classification?.categories.includes(c.slug));
      const rising = sortRepositories(
        inCat.filter((r) => r.trend === 'RISING'),
        'momentum',
      );
      return { slug: c.slug, name: c.name, count: inCat.length, rising: rising.length, top: rising.slice(0, top) };
    });
}

export function byId(d: PublicDataset): Map<string, PublicRepository> {
  return new Map(d.repositories.map((r) => [r.id, r]));
}

/** Repositories for a list of ids (list order preserved), limited to the AI scope. */
export function listRepos(d: PublicDataset, ids: readonly string[], limit?: number): PublicRepository[] {
  const m = byId(d);
  const out = ids.map((i) => m.get(i)).filter((r): r is PublicRepository => r !== undefined && isAi(r));
  return limit === undefined ? out : out.slice(0, limit);
}

export interface MoverRow {
  repo: PublicRepository;
  velocityDelta: number;
}

export function movers(d: PublicDataset, direction: 'UP' | 'DOWN', limit: number): MoverRow[] {
  const m = byId(d);
  const src = direction === 'UP' ? d.lists.moversUp : d.lists.moversDown;
  const rows: MoverRow[] = [];
  for (const x of src) {
    const repo = m.get(x.id);
    if (repo && isAi(repo)) rows.push({ repo, velocityDelta: x.velocityDelta });
  }
  rows.sort(
    (a, b) =>
      (direction === 'UP' ? b.velocityDelta - a.velocityDelta : a.velocityDelta - b.velocityDelta) ||
      a.repo.fullName.localeCompare(b.repo.fullName),
  );
  return rows.slice(0, limit);
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  return Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1)}k` : Math.round(n).toLocaleString('en-US');
}
export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  return `${n > 0 ? '+' : ''}${fmtNum(n)}`;
}
export function fmtRate(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  return Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1);
}
export function fmtAge(days: number): string {
  if (days < 1) return 'today';
  if (days < 60) return `${Math.floor(days)}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Hours between the dataset time and `now`, for the freshness notice. */
export function ageHours(generatedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(generatedAt)) / 3_600_000;
}
export const STALE_AFTER_HOURS = 72;

export function fmtDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function repoPath(fullName: string): string {
  return `/repo/${fullName}/`;
}
export function categoryName(d: Pick<PublicDataset, 'categories'>, slug: string): string {
  return d.categories?.find((c) => c.slug === slug)?.name ?? slug;
}
