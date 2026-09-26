import type { ClassifiedDataset } from '../classification/datasets';
import type { Dataset as RepositoryDataset, RepositoryRecord } from '../collect/dataset';
import { evaluateRepository, growthAsOf, velocityOver } from './engine';
import type { MomentumConfig, MomentumRecord, TrendLabel } from './types';

export const MOMENTUM_SCHEMA_VERSION = 1 as const;

export interface MoverEntry {
  id: string;
  direction: 'UP' | 'DOWN';
  /** velocity7d - priorVelocity, stars/day. */
  velocityDelta: number;
  rankDelta: number | null;
}

export interface MomentumDataset {
  schemaVersion: typeof MOMENTUM_SCHEMA_VERSION;
  momentumVersion: string;
  generatedAt: string;
  source: { repositoriesGeneratedAt: string; repositories: number };
  /** The configuration the numbers were computed with, so a file explains itself. */
  config: MomentumConfig;
  summary: { evaluated: number; scored: number; byTrend: Record<TrendLabel, number>; rising: number; movers: number; sustained: number; newEntrants: number };
  /** `movers` is every mover ranked by |velocityDelta|; `moversUp` / `moversDown` are the same entries split by direction. */
  lists: { rising: string[]; movers: MoverEntry[]; moversUp: MoverEntry[]; moversDown: MoverEntry[]; sustained: string[]; newEntrants: string[] };
  repositories: MomentumRecord[];
}

const idCmp = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/**
 * Evaluate every repository that has star history. Momentum is a function of growth measurements only:
 * classification and tracking tiers are not inputs (the type of `evaluateRepository` has no such parameter).
 */
export function buildMomentumDataset(repos: RepositoryDataset, now: Date, cfg: MomentumConfig): MomentumDataset {
  const evals = repos.repositories.map((r) => ({ r, e: evaluateRepository(r, repos.generatedAt, now, cfg) }));

  // Rank movement: velocity rank 7 days ago vs now, among repositories measurable at both moments (cohort-relative).
  const cohort = evals
    .map(({ r, e }) => ({ id: r.id, now: e.signals.velocity7d, then: e.growth.ageDays >= 14 ? velocityOver(r, growthAsOf(r, repos.generatedAt), 7, 7) : null }))
    .filter((c): c is { id: string; now: number; then: number } => c.now !== null && c.then !== null);
  const rank = (key: 'now' | 'then') => new Map([...cohort].sort((a, b) => b[key] - a[key] || idCmp(a.id, b.id)).map((c, i) => [c.id, i + 1] as const));
  const rankNow = rank('now');
  const rankThen = rank('then');

  const records: MomentumRecord[] = evals.map(({ e }) => {
    const rn = rankNow.get(e.id);
    const rt = rankThen.get(e.id);
    const delta = e.signals.velocityDelta;
    const mover = !e.archived && delta !== null && Math.abs(delta) >= cfg.trends.movers.minVelocityDelta ? (delta > 0 ? ('UP' as const) : ('DOWN' as const)) : null;
    const { archived: _archived, ...rest } = e;
    void _archived;
    return {
      ...rest,
      flags: { rising: e.trend === 'RISING', sustained: !e.archived && e.signals.sustained, newEntrant: !e.archived && e.signals.newEntrant, mover },
      rankMovement: rn !== undefined && rt !== undefined ? { rankNow: rn, rankBefore: rt, delta: rt - rn } : null,
    };
  });
  records.sort((a, b) => idCmp(a.id, b.id));

  const score = (r: MomentumRecord) => r.momentum.score ?? -1;
  const rising = records.filter((r) => r.flags.rising).sort((a, b) => score(b) - score(a) || (b.signals.growth7d ?? 0) - (a.signals.growth7d ?? 0) || idCmp(a.id, b.id));
  const movers = records
    .filter((r) => r.flags.mover !== null)
    .sort((a, b) => Math.abs(b.signals.velocityDelta as number) - Math.abs(a.signals.velocityDelta as number) || Math.abs(b.rankMovement?.delta ?? 0) - Math.abs(a.rankMovement?.delta ?? 0) || idCmp(a.id, b.id));
  const moverEntries: MoverEntry[] = movers.map((r) => ({ id: r.id, direction: r.flags.mover as 'UP' | 'DOWN', velocityDelta: r.signals.velocityDelta as number, rankDelta: r.rankMovement?.delta ?? null }));
  const sustained = records.filter((r) => r.flags.sustained).sort((a, b) => (b.signals.velocity30d ?? 0) - (a.signals.velocity30d ?? 0) || idCmp(a.id, b.id));
  const newEntrants = records.filter((r) => r.flags.newEntrant).sort((a, b) => (b.signals.velocity7d ?? 0) - (a.signals.velocity7d ?? 0) || idCmp(a.id, b.id));

  const byTrend: Record<TrendLabel, number> = { RISING: 0, COOLING: 0, STEADY: 0, INSUFFICIENT_DATA: 0, EXCLUDED: 0 };
  for (const r of records) byTrend[r.trend] += 1;
  return {
    schemaVersion: MOMENTUM_SCHEMA_VERSION,
    momentumVersion: cfg.momentumVersion,
    generatedAt: now.toISOString(),
    source: { repositoriesGeneratedAt: repos.generatedAt, repositories: repos.repositories.length },
    config: cfg,
    summary: { evaluated: records.length, scored: records.filter((r) => r.momentum.score !== null).length, byTrend, rising: rising.length, movers: movers.length, sustained: sustained.length, newEntrants: newEntrants.length },
    lists: {
      rising: rising.map((r) => r.id),
      movers: moverEntries,
      moversUp: moverEntries.filter((m) => m.direction === 'UP'),
      moversDown: moverEntries.filter((m) => m.direction === 'DOWN'),
      sustained: sustained.map((r) => r.id),
      newEntrants: newEntrants.map((r) => r.id),
    },
    repositories: records,
  };
}

// ------------------------------------------------------------------ public derivation

export interface PublicRepository {
  id: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  /** From classification, joined by id; null if the repository is not classified. Never used by momentum. */
  classification: { topLevel: string; categories: string[] } | null;
  growth7d: number | null;
  growth30d: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  score: number | null;
  trend: TrendLabel;
  flags: MomentumRecord['flags'];
  summary: string;
  // Additive in Phase 5 (schemaVersion stays 1): raw evidence so the UI can show "why".
  growth90d: number | null;
  velocity90d: number | null;
  growthPercent7d: number | null;
  priorVelocity: number | null;
  accelerationRatio: number | null;
  velocityDelta: number | null;
  ageDays: number;
  /** Deterministic explanation lines from the momentum engine. */
  explanation: string[];
  /** Refresh tier from the tracked dataset (HOT | WARM | DORMANT | UNASSESSED); absent when tracking was not supplied. */
  tier?: string;
}

export interface PublicCategory {
  slug: string;
  name: string;
  domain: string;
}

/** Counts of the tracking population, so the UI never presents "tracked" as "measured". Optional. */
export interface PublicStats {
  tracked: number;
  measured: number;
  unassessed: number;
}

export interface PublicDataset {
  schemaVersion: 1;
  momentumVersion: string;
  generatedAt: string;
  lists: MomentumDataset['lists'];
  repositories: PublicRepository[];
  /** Additive (Phase 5). Category catalogue from config/categories/*.json. */
  categories?: PublicCategory[];
  /** Additive (Phase 5). From the tracked dataset when supplied. */
  stats?: PublicStats;
}

export interface PublicExtras {
  categories?: PublicCategory[];
  stats?: PublicStats;
  /** repository id -> tier. */
  tiers?: Record<string, string>;
}

/**
 * Compact dataset for a frontend: identity, current metrics, momentum, trend and one-line explanation. Full evidence
 * (windows, components, per-signal detail, star history) stays in the internal datasets. Only repositories with a score
 * are published.
 */
export function derivePublic(momentum: MomentumDataset, repos: RepositoryDataset, classified?: ClassifiedDataset, extras: PublicExtras = {}): PublicDataset {
  const meta = new Map<string, RepositoryRecord>(repos.repositories.map((r) => [r.id, r]));
  const cls = new Map((classified?.repositories ?? []).map((c) => [c.id, c.result]));
  const out: PublicRepository[] = [];
  for (const m of momentum.repositories) {
    if (m.momentum.score === null) continue;
    const r = meta.get(m.id);
    if (!r) continue;
    const c = cls.get(m.id);
    out.push({
      id: m.id,
      fullName: m.fullName,
      url: r.url,
      description: r.description ? (r.description.length > 140 ? `${r.description.slice(0, 137)}...` : r.description) : null,
      language: r.language,
      stars: r.stars,
      classification: c ? { topLevel: c.topLevelCategory, categories: c.categories.map((x) => x.slug) } : null,
      growth7d: m.signals.growth7d,
      growth30d: m.signals.growth30d,
      velocity7d: m.signals.velocity7d,
      velocity30d: m.signals.velocity30d,
      score: m.momentum.score,
      trend: m.trend,
      flags: m.flags,
      summary: m.summary,
      growth90d: m.signals.growth90d,
      velocity90d: m.signals.velocity90d,
      growthPercent7d: m.signals.growthPercent7d,
      priorVelocity: m.signals.priorVelocity,
      accelerationRatio: m.signals.accelerationRatio,
      velocityDelta: m.signals.velocityDelta,
      ageDays: m.signals.ageDays,
      explanation: m.explanation,
      ...(extras.tiers?.[m.id] ? { tier: extras.tiers[m.id] } : {}),
    });
  }
  const keep = new Set(out.map((o) => o.id));
  return {
    schemaVersion: 1,
    momentumVersion: momentum.momentumVersion,
    generatedAt: momentum.generatedAt,
    lists: {
      rising: momentum.lists.rising.filter((i) => keep.has(i)),
      movers: momentum.lists.movers.filter((m) => keep.has(m.id)),
      moversUp: momentum.lists.moversUp.filter((m) => keep.has(m.id)),
      moversDown: momentum.lists.moversDown.filter((m) => keep.has(m.id)),
      sustained: momentum.lists.sustained.filter((i) => keep.has(i)),
      newEntrants: momentum.lists.newEntrants.filter((i) => keep.has(i)),
    },
    repositories: out,
    ...(extras.categories ? { categories: extras.categories } : {}),
    ...(extras.stats ? { stats: extras.stats } : {}),
  };
}

export function validateMomentumDataset(ds: unknown): string[] {
  const problems: string[] = [];
  if (typeof ds !== 'object' || ds === null) return ['momentum dataset is not an object'];
  const d = ds as Partial<MomentumDataset>;
  if (d.schemaVersion !== MOMENTUM_SCHEMA_VERSION) problems.push(`schemaVersion must be ${MOMENTUM_SCHEMA_VERSION}`);
  if (!Array.isArray(d.repositories)) return [...problems, 'repositories must be an array'];
  const ids = new Set<string>();
  for (const r of d.repositories) {
    if (ids.has(r.id)) problems.push(`duplicate id ${r.id}`);
    ids.add(r.id);
    if (r.momentum.score !== null && (r.momentum.score < 0 || r.momentum.score >= 100)) problems.push(`${r.fullName}: score out of range`);
    if (r.momentum.score === null && r.trend !== 'INSUFFICIENT_DATA' && r.trend !== 'EXCLUDED') problems.push(`${r.fullName}: trend ${r.trend} without a score`);
    for (const k of ['growth7d', 'growth30d', 'growth90d'] as const) {
      const v = r.signals[k];
      if (v !== null && !Number.isFinite(v)) problems.push(`${r.fullName}: ${k} is not finite`);
    }
  }
  for (const list of [d.lists?.rising, d.lists?.sustained, d.lists?.newEntrants]) for (const id of list ?? []) if (!ids.has(id)) problems.push(`list references unknown id ${id}`);
  for (const m of [...(d.lists?.movers ?? []), ...(d.lists?.moversUp ?? []), ...(d.lists?.moversDown ?? [])]) if (!ids.has(m.id)) problems.push(`movers references unknown id ${m.id}`);
  return problems;
}
