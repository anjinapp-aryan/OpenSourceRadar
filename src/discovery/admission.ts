/**
 * Phase 6.3: bounded admission of newly discovered (Top-300) candidates. Pure and deterministic: the same candidates and configuration
 * always give the same admitted list, whatever the input order. Nothing here calls GitHub or changes tracking state; the production
 * pipeline does not import it yet (shadow form, see docs/PHASE-6.3-DISCOVERY-ROLLOUT.md).
 *
 * Admission order uses the "lifetime stars per day" ADMISSION PRIORITY PROXY (stars / age). It is a cheap, deterministic, metadata-only
 * ordering. It is NOT momentum: momentum is only ever measured from star history after admission.
 */
import { readFileSync } from 'node:fs';

export type TopLevel = 'AI' | 'ENGINEERING' | 'BOTH' | 'UNKNOWN';

export interface AdmissionConfig {
  policyVersion: string;
  /** off = nothing is admitted; shadow = the list is computed and reported only; on = the list feeds tracking (not enabled in Phase 6.3). */
  mode: 'off' | 'shadow' | 'on';
  relevance: { allowedTopLevel: TopLevel[]; excludeLearningContent: boolean };
  lifecycle: { excludeArchived: boolean; excludeForks: boolean; minStars: number };
  /** Minimum admission priority proxy (lifetime stars per day) to be considered at all. */
  minPriority: number;
  budget: {
    /** New admissions allowed per weekly discovery run. */
    maxNewPerWeek: number;
    /** Maximum number of admitted (not yet earned) repositories tracked at once. */
    maxAdmittedPool: number;
    /** Worst case: every admitted repository at the HOT refresh rate. */
    hotRefreshHours: number;
    /** Total daily history-request ceiling the worst case must stay under, current load included. */
    maxHistoryRequestsPerDay: number;
    currentHistoryRequestsPerDay: number;
  };
}

export class AdmissionConfigError extends Error {}

export interface AdmissionCandidate {
  id: string;
  fullName: string;
  stars: number;
  createdAt: string;
  topLevel: TopLevel;
  contentType: 'software' | 'learning';
  isArchived: boolean;
  isFork: boolean;
  /** Already in the production candidate set. */
  alreadyCandidate: boolean;
  /** Already admitted in an earlier week. */
  alreadyAdmitted: boolean;
}

export type RejectReason = 'not-classified' | 'learning-content' | 'archived' | 'fork' | 'below-min-stars' | 'already-candidate' | 'already-admitted' | 'below-priority' | 'weekly-cap' | 'pool-cap' | 'mode-off';

export interface AdmissionResult {
  admitted: (AdmissionCandidate & { priority: number })[];
  rejected: { id: string; reason: RejectReason }[];
  stats: { considered: number; admitted: number; byReason: Partial<Record<RejectReason, number>> };
}

export function lifetimeStarsPerDay(stars: number, createdAt: string, now: Date): number {
  const ageDays = Math.max(1, (now.getTime() - Date.parse(createdAt)) / 86_400_000);
  return stars / ageDays;
}

export function parseAdmissionConfig(raw: unknown): AdmissionConfig {
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRec(raw) || raw.schemaVersion !== 1) throw new AdmissionConfigError('admission config: unsupported schemaVersion');
  const num = (o: Record<string, unknown>, k: string, min = 0): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new AdmissionConfigError(`admission config: ${k} must be a number >= ${min}`);
    return v;
  };
  if (!isRec(raw.relevance) || !isRec(raw.lifecycle) || !isRec(raw.budget)) throw new AdmissionConfigError('admission config: relevance, lifecycle and budget are required');
  const mode = raw.mode;
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'on') throw new AdmissionConfigError('admission config: mode must be off, shadow or on');
  const allowed = raw.relevance.allowedTopLevel;
  if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every((x) => x === 'AI' || x === 'ENGINEERING' || x === 'BOTH')) throw new AdmissionConfigError('admission config: allowedTopLevel must list AI, ENGINEERING or BOTH');
  const cfg: AdmissionConfig = {
    policyVersion: typeof raw.policyVersion === 'string' ? raw.policyVersion : 'unversioned',
    mode,
    relevance: { allowedTopLevel: allowed as TopLevel[], excludeLearningContent: raw.relevance.excludeLearningContent === true },
    lifecycle: { excludeArchived: raw.lifecycle.excludeArchived !== false, excludeForks: raw.lifecycle.excludeForks !== false, minStars: num(raw.lifecycle, 'minStars') },
    minPriority: num(raw, 'minPriority'),
    budget: {
      maxNewPerWeek: num(raw.budget, 'maxNewPerWeek'),
      maxAdmittedPool: num(raw.budget, 'maxAdmittedPool'),
      hotRefreshHours: num(raw.budget, 'hotRefreshHours', 1),
      maxHistoryRequestsPerDay: num(raw.budget, 'maxHistoryRequestsPerDay'),
      currentHistoryRequestsPerDay: num(raw.budget, 'currentHistoryRequestsPerDay'),
    },
  };
  const w = worstCaseHistoryRequestsPerDay(cfg);
  if (w > cfg.budget.maxHistoryRequestsPerDay) throw new AdmissionConfigError(`admission config: worst case ${Math.round(w)} requests per day exceeds the ceiling ${cfg.budget.maxHistoryRequestsPerDay}`);
  return cfg;
}

export function loadAdmissionConfig(path = 'config/admission.json'): AdmissionConfig {
  try {
    return parseAdmissionConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    if (e instanceof AdmissionConfigError) throw e;
    throw new AdmissionConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Current load plus the whole admitted pool refreshed at the HOT rate (24 / hotRefreshHours per day each). */
export function worstCaseHistoryRequestsPerDay(cfg: AdmissionConfig): number {
  return cfg.budget.currentHistoryRequestsPerDay + cfg.budget.maxAdmittedPool * (24 / cfg.budget.hotRefreshHours);
}

/** Apply the policy. Deterministic: candidates are ordered by priority (descending), then stars, then id. */
export function admit(candidates: readonly AdmissionCandidate[], cfg: AdmissionConfig, now: Date, currentPoolSize = 0): AdmissionResult {
  const rejected: AdmissionResult['rejected'] = [];
  const byReason: AdmissionResult['stats']['byReason'] = {};
  const reject = (id: string, reason: RejectReason) => {
    rejected.push({ id, reason });
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  };
  const eligible: (AdmissionCandidate & { priority: number })[] = [];
  for (const c of candidates) {
    if (cfg.mode === 'off') reject(c.id, 'mode-off');
    else if (c.alreadyCandidate) reject(c.id, 'already-candidate');
    else if (c.alreadyAdmitted) reject(c.id, 'already-admitted');
    else if (c.isArchived && cfg.lifecycle.excludeArchived) reject(c.id, 'archived');
    else if (c.isFork && cfg.lifecycle.excludeForks) reject(c.id, 'fork');
    else if (!cfg.relevance.allowedTopLevel.includes(c.topLevel)) reject(c.id, 'not-classified');
    else if (cfg.relevance.excludeLearningContent && c.contentType === 'learning') reject(c.id, 'learning-content');
    else if (c.stars < cfg.lifecycle.minStars) reject(c.id, 'below-min-stars');
    else {
      const priority = lifetimeStarsPerDay(c.stars, c.createdAt, now);
      if (priority < cfg.minPriority) reject(c.id, 'below-priority');
      else eligible.push({ ...c, priority });
    }
  }
  eligible.sort((a, b) => b.priority - a.priority || b.stars - a.stars || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const room = Math.max(0, cfg.budget.maxAdmittedPool - currentPoolSize);
  const limit = Math.min(cfg.budget.maxNewPerWeek, room);
  const admitted = eligible.slice(0, limit);
  for (const c of eligible.slice(limit)) reject(c.id, room <= cfg.budget.maxNewPerWeek ? 'pool-cap' : 'weekly-cap');
  rejected.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  return { admitted, rejected, stats: { considered: candidates.length, admitted: admitted.length, byReason } };
}
