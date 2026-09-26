import { AuthenticationError, NotFoundError, RateLimitError } from '../github/errors';
import { silentLogger, type Logger } from '../github/logger';
import type { GitHubGraphQLProvider, GitHubStarHistoryProvider } from '../github/providers';
import { checkStarHistory, hasErrors, type QualityIssue } from '../quality/checks';
import { mergeCandidates, type DiscoveredRepository, type DiscoveryProvider, type DiscoveryStats } from '../discovery/discoveryProvider';
import type { CategoryConfig } from '../discovery/config';
import { writeJsonAtomic, readJsonIfExists } from '../io/atomicWrite';
import { mapWithConcurrency } from '../util/concurrency';
import { buildCandidateDataset, validateCandidateDataset } from './candidates';
import { assertReplaceable, assertValidDataset, buildDataset, buildRecord, type Dataset, type RepositoryRecord } from './dataset';

export interface PipelineDeps {
  discovery: DiscoveryProvider;
  /** When absent, metadata from search results is kept (source "rest"). */
  graphql?: GitHubGraphQLProvider;
  starHistory: GitHubStarHistoryProvider;
  logger?: Logger;
  now?: () => Date;
}

export interface PipelineOptions {
  configs: readonly CategoryConfig[];
  outPath: string;
  /** Keep only the top N candidates (stars desc, id asc) after discovery. */
  limit?: number;
  concurrency?: number;
  /** Pages of star history per repository (30 weeks each). Default 1; 'all' walks the whole life. */
  historyPages?: number | 'all';
  /** Abort without writing when more than this fraction of repositories fail. Default 0.05. */
  maxFailureRatio?: number;
  force?: boolean;
  categories?: readonly string[];
  maxQueriesPerCategory?: number;
  /** Also write every discovered (deduplicated) repository here as a candidate dataset, before any selection. */
  candidatesOutPath?: string;
  /** Discover and report only; no history, no repository dataset. */
  dryRun?: boolean;
}

export type FailureStage = 'metadata' | 'history' | 'quality';

export interface Failure {
  repository: string;
  stage: FailureStage;
  reason: string;
}

export interface CollectionReport {
  written: boolean;
  outPath: string;
  dataset: Dataset | null;
  discovery: DiscoveryStats[];
  candidates: number;
  selected: number;
  failures: Failure[];
  abortedReason: string | null;
  durationMs: number;
}

export class CollectionAbortedError extends Error {
  constructor(message: string, readonly report: CollectionReport) {
    super(message);
    this.name = 'CollectionAbortedError';
  }
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/**
 * discover -> deduplicate -> metadata -> star history -> normalize -> validate -> atomic write.
 * Nothing is written unless every gate passes; an existing valid dataset is never
 * replaced by partial output.
 */
export async function runCollection(deps: PipelineDeps, options: PipelineOptions): Promise<CollectionReport> {
  const logger = deps.logger ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const generatedAt = now();
  const historyPages = options.historyPages ?? 1;
  const report: CollectionReport = {
    written: false,
    outPath: options.outPath,
    dataset: null,
    discovery: [],
    candidates: 0,
    selected: 0,
    failures: [],
    abortedReason: null,
    durationMs: 0,
  };
  const abort = (reason: string): never => {
    report.abortedReason = reason;
    report.durationMs = Date.now() - started;
    throw new CollectionAbortedError(reason, report);
  };

  // 1-2. discover + deduplicate by repository id
  const perDomain: DiscoveredRepository[][] = [];
  for (const config of options.configs) {
    const result = await deps.discovery.discover(config, {
      now: generatedAt,
      categories: options.categories,
      maxQueriesPerCategory: options.maxQueriesPerCategory,
    });
    report.discovery.push(result.stats);
    perDomain.push(result.candidates);
  }
  const merged = mergeCandidates(perDomain);
  report.candidates = merged.length;
  if (options.candidatesOutPath) {
    const candidateDataset = buildCandidateDataset(merged, report.discovery, generatedAt);
    const problems = validateCandidateDataset(candidateDataset);
    if (problems.length > 0) abort(`candidate dataset failed validation: ${problems.slice(0, 3).join('; ')}`);
    await writeJsonAtomic(options.candidatesOutPath, candidateDataset);
  }
  const selected = options.limit !== undefined ? merged.slice(0, options.limit) : merged;
  report.selected = selected.length;
  logger.log({ operation: 'collect.discovered', candidates: merged.length, selected: selected.length });
  if (options.dryRun) {
    report.durationMs = Date.now() - started;
    return report;
  }
  if (selected.length === 0) abort('discovery returned no repositories');

  // 3. metadata (GraphQL when available; otherwise keep the search snapshot)
  const working = new Map<string, DiscoveredRepository>(selected.map((c) => [c.snapshot.repositoryId, c]));
  if (deps.graphql) {
    const refs = selected.map((c) => ({ owner: c.snapshot.owner, name: c.snapshot.name }));
    const meta = await deps.graphql.fetchRepositories(refs, { now: generatedAt });
    const fresh = new Map(meta.snapshots.map((s) => [s.repositoryId, s]));
    for (const [id, cand] of [...working]) {
      const snap = fresh.get(id);
      if (snap) cand.snapshot = snap;
      else {
        working.delete(id);
        report.failures.push({ repository: cand.snapshot.fullName, stage: 'metadata', reason: 'not found by GraphQL' });
      }
    }
  }

  // 4-6. star history + normalize + validate, with bounded concurrency
  const todo = [...working.values()];
  const state: { fatal: unknown } = { fatal: null };
  const settled = await mapWithConcurrency(
    todo,
    options.concurrency ?? 4,
    async (cand): Promise<RepositoryRecord> => {
      const snap = cand.snapshot;
      let series;
      try {
        series = await deps.starHistory.fetchStarHistory(
          { owner: snap.owner, name: snap.name },
          { maxPages: historyPages === 'all' ? undefined : historyPages },
        );
      } catch (e) {
        // Out of budget / bad credentials: stop starting new work immediately, not after the batch.
        if (e instanceof RateLimitError || e instanceof AuthenticationError) state.fatal = state.fatal ?? e;
        throw e;
      }
      const issues: QualityIssue[] = checkStarHistory(series, snap.stars, generatedAt);
      if (hasErrors(issues)) throw new Error(`data-quality errors: ${issues.filter((i) => i.severity === 'error').map((i) => i.code).join(',')}`);
      return buildRecord(snap, { domains: cand.domains, categories: cand.categories }, series, issues, generatedAt);
    },
    {
      shouldStop: () => state.fatal !== null,
      stopError: () => state.fatal,
    },
  );

  const records: RepositoryRecord[] = [];
  settled.forEach((res, i) => {
    const name = (todo[i] as DiscoveredRepository).snapshot.fullName;
    if (res.ok) {
      records.push(res.value);
      return;
    }
    const e = res.error;
    if (e instanceof RateLimitError || e instanceof AuthenticationError) state.fatal = state.fatal ?? e;
    const stage: FailureStage = e instanceof NotFoundError ? 'history' : e instanceof Error && e.message.startsWith('data-quality') ? 'quality' : 'history';
    report.failures.push({ repository: name, stage, reason: errText(e) });
  });
  if (state.fatal !== null) abort(`stopped by ${errText(state.fatal)}; nothing written`);

  // 7. gates
  const total = selected.length;
  const ratio = report.failures.length / Math.max(1, total);
  if (ratio > (options.maxFailureRatio ?? 0.05)) {
    abort(`${report.failures.length}/${total} repositories failed (${(ratio * 100).toFixed(1)}%), above the allowed ratio; nothing written`);
  }
  if (records.length === 0) abort('no repository survived; nothing written');

  const dataset = buildDataset(records, generatedAt, historyPages);
  assertValidDataset(dataset); // throws DatasetValidationError; existing file untouched
  const existing = await readJsonIfExists<Dataset>(options.outPath).catch(() => undefined);
  assertReplaceable(dataset, existing, { force: options.force });

  // 8. atomic write
  await writeJsonAtomic(options.outPath, dataset);
  report.dataset = dataset;
  report.written = true;
  report.durationMs = Date.now() - started;
  logger.log({ operation: 'collect.written', repository: options.outPath, repositories: records.length, failures: report.failures.length, durationMs: report.durationMs });
  return report;
}
