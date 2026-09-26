import { AuthenticationError, NotFoundError, RateLimitError } from '../github/errors';
import { silentLogger, type Logger } from '../github/logger';
import type { GitHubGraphQLProvider, GitHubStarHistoryProvider } from '../github/providers';
import { checkStarHistory, hasErrors } from '../quality/checks';
import type { RepositorySnapshot } from '../model/repositorySnapshot';
import { writeJsonAtomic } from '../io/atomicWrite';
import { mapWithConcurrency } from '../util/concurrency';
import { selectDue } from '../tracking/engine';
import type { TrackedDataset, TrackedRecord } from '../tracking/datasets';
import type { TrackingPolicy } from '../tracking/types';
import type { CandidateDataset, CandidateRecord } from './candidates';
import { assertValidDataset, buildDataset, buildRecord, validateDataset, type Dataset, type RepositoryRecord } from './dataset';

/** Production GraphQL batch size: 50 passed authenticated validation, 100 failed with 504 / resource limits. */
export const GRAPHQL_BATCH_SIZE = 50;

export type DueDomain = 'ai' | 'engineering' | 'all';

export interface DueDeps {
  /** When absent, metadata from the candidate dataset is used (anonymous runs). */
  graphql?: GitHubGraphQLProvider;
  starHistory: GitHubStarHistoryProvider;
  logger?: Logger;
  now?: () => Date;
}

export interface DueOptions {
  tracked: TrackedDataset;
  candidates: CandidateDataset;
  /** Phase 2 repository dataset to merge into (records for repositories that are not collected are preserved). */
  existing?: Dataset;
  policy: TrackingPolicy;
  outPath: string;
  /** Collection scope only. It filters which due repositories are collected; it never influences a tier. */
  domain?: DueDomain;
  limit?: number;
  concurrency?: number;
  /** Star-history pages per repository (30 weeks each). Default 1. */
  historyPages?: number | 'all';
  /** Repositories processed between atomic checkpoint writes. Default 100. */
  chunkSize?: number;
}

export type DueFailureStage = 'metadata' | 'history' | 'quality';

export interface DueFailure {
  repository: string;
  stage: DueFailureStage;
  reason: string;
}

export interface DueReport {
  tracked: number;
  due: number;
  notDue: number;
  outOfScope: number;
  selected: number;
  collected: number;
  failures: DueFailure[];
  /** Set when a rate-limit or authentication error stopped the run early (collected work up to then is saved). */
  stoppedBy: string | null;
  written: boolean;
  datasetRepositories: number;
  durationMs: number;
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export function inDomain(top: string, domain: DueDomain): boolean {
  if (domain === 'all') return true;
  return domain === 'ai' ? top === 'AI' || top === 'BOTH' : top === 'ENGINEERING' || top === 'BOTH';
}

export function candidateToSnapshot(c: CandidateRecord): RepositorySnapshot {
  return {
    repositoryId: c.id,
    owner: c.owner,
    name: c.name,
    fullName: c.fullName,
    url: c.url,
    description: c.description,
    stars: c.stars,
    forks: c.forks,
    openIssues: c.openIssues,
    language: c.language,
    topics: [...c.topics],
    license: c.license,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    collectedAt: c.collectedAt,
    source: c.metadataSource,
    pushedAt: c.pushedAt,
    isArchived: c.isArchived ?? undefined,
  };
}

/** Older Phase 2 datasets anchor every record to the dataset's `generatedAt`; make that explicit before mixing dates. */
export function withGrowthAsOf(existing: Dataset | undefined): RepositoryRecord[] {
  return (existing?.repositories ?? []).map((r) => (r.growthAsOf ? r : { ...r, growthAsOf: existing?.generatedAt }));
}

/**
 * Collect star history only for repositories the tracking schedule says are due, and merge the results into
 * the repository dataset.
 *
 * Safety properties:
 *  - repositories that are not due cause no GitHub call;
 *  - a failure for one repository is recorded and leaves that repository's existing record untouched;
 *  - work is checkpointed atomically every `chunkSize` repositories, so an interrupted or rate-limited run keeps
 *    what it collected and a re-run continues (collected repositories are no longer due);
 *  - the merged dataset is validated before every write; a failing validation writes nothing.
 */
export async function runDueCollection(deps: DueDeps, o: DueOptions): Promise<DueReport> {
  const logger = deps.logger ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const startTime = now();
  const domain = o.domain ?? 'all';
  const historyPages = o.historyPages ?? 1;

  const all = o.tracked.repositories;
  // Same tier and same due time (e.g. every UNASSESSED repository): younger repositories first, so a budget that
  // runs out early has measured the most time-sensitive ones. (Repository ids are creation-ordered, so id order
  // would do the opposite.)
  const dueAll = selectDue(all, startTime, o.policy.dueOrder, (a, b) => a.signals.ageDays - b.signals.ageDays || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const inScope = dueAll.filter((r) => inDomain(r.classification.topLevelCategory, domain));
  const selected: TrackedRecord[] = o.limit !== undefined ? inScope.slice(0, o.limit) : inScope;
  const report: DueReport = {
    tracked: all.length,
    due: dueAll.length,
    notDue: all.length - dueAll.length,
    outOfScope: dueAll.length - inScope.length,
    selected: selected.length,
    collected: 0,
    failures: [],
    stoppedBy: null,
    written: false,
    datasetRepositories: o.existing?.repositories.length ?? 0,
    durationMs: 0,
  };
  logger.log({ operation: 'due.selected', tracked: report.tracked, due: report.due, notDue: report.notDue, selected: report.selected, domain });
  if (selected.length === 0) {
    report.durationMs = Date.now() - started;
    return report;
  }

  const candidatesById = new Map(o.candidates.candidates.map((c) => [c.id, c]));
  const merged = new Map<string, RepositoryRecord>(withGrowthAsOf(o.existing).map((r) => [r.id, r]));
  const chunkSize = Math.max(1, o.chunkSize ?? 100);
  let fatal: unknown = null;

  for (let start = 0; start < selected.length && fatal === null; start += chunkSize) {
    const chunk = selected.slice(start, start + chunkSize);
    const asOf = now();

    // metadata: GraphQL in batches of 50 when available, otherwise the candidate record
    const snapshots = new Map<string, RepositorySnapshot>();
    const usable: TrackedRecord[] = [];
    for (const t of chunk) {
      const c = candidatesById.get(t.id);
      if (!c) report.failures.push({ repository: t.fullName, stage: 'metadata', reason: 'no candidate metadata for this tracked repository' });
      else usable.push(t);
    }
    if (deps.graphql && usable.length > 0) {
      try {
        const meta = await deps.graphql.fetchRepositories(
          usable.map((t) => ({ owner: (candidatesById.get(t.id) as CandidateRecord).owner, name: (candidatesById.get(t.id) as CandidateRecord).name })),
          { batchSize: GRAPHQL_BATCH_SIZE, now: asOf },
        );
        for (const s of meta.snapshots) snapshots.set(s.repositoryId, s);
      } catch (e) {
        if (e instanceof RateLimitError || e instanceof AuthenticationError) {
          fatal = e;
          break;
        }
        for (const t of usable) report.failures.push({ repository: t.fullName, stage: 'metadata', reason: errText(e) });
        continue;
      }
    } else {
      for (const t of usable) snapshots.set(t.id, candidateToSnapshot(candidatesById.get(t.id) as CandidateRecord));
    }

    const work = usable.filter((t) => {
      if (snapshots.has(t.id)) return true;
      report.failures.push({ repository: t.fullName, stage: 'metadata', reason: 'not found by GraphQL' });
      return false;
    });

    const state: { fatal: unknown } = { fatal: null };
    const settled = await mapWithConcurrency(
      work,
      o.concurrency ?? 4,
      async (t): Promise<RepositoryRecord> => {
        const snap = snapshots.get(t.id) as RepositorySnapshot;
        let series;
        try {
          series = await deps.starHistory.fetchStarHistory({ owner: snap.owner, name: snap.name }, { maxPages: historyPages === 'all' ? undefined : historyPages });
        } catch (e) {
          if (e instanceof RateLimitError || e instanceof AuthenticationError) state.fatal = state.fatal ?? e;
          throw e;
        }
        // Metadata can be hours old (anonymous runs reuse candidate metadata). A COMPLETE history sums to the star count
        // at fetch time (measured: exact on 5 of 6 repositories), so when it exceeds the older metadata it is the better
        // number: use it and say so. A partial history cannot correct anything and is judged against the metadata.
        const total = series.weeks.reduce((s, w) => s + w.total, 0);
        const adjusted = series.complete && total > snap.stars;
        const effective = adjusted ? { ...snap, stars: total } : snap;
        const issues = checkStarHistory(series, effective.stars, asOf);
        if (adjusted) issues.push({ code: 'STARS_FROM_HISTORY', severity: 'warning', message: `metadata had ${snap.stars} stars; the complete star history sums to ${total}, which is newer` });
        if (hasErrors(issues)) throw new Error(`data-quality errors: ${issues.filter((i) => i.severity === 'error').map((i) => i.code).join(',')}`);
        const c = candidatesById.get(t.id) as CandidateRecord;
        const record = buildRecord(effective, { domains: c.discovery.domains, categories: c.discovery.queryCategories }, series, issues, asOf);
        // One bad record must not sink the batch: validate it alone before it can reach the merged dataset.
        const problems = validateDataset(buildDataset([record], asOf, historyPages));
        if (problems.length > 0) throw new Error(`data-quality errors: record failed validation: ${problems[0]}`);
        return record;
      },
      { shouldStop: () => state.fatal !== null, stopError: () => state.fatal },
    );

    let added = 0;
    settled.forEach((res, i) => {
      const name = (work[i] as TrackedRecord).fullName;
      if (res.ok) {
        merged.set(res.value.id, res.value);
        added += 1;
        return;
      }
      const e = res.error;
      if (e === state.fatal) return; // skipped after the fatal error: not a per-repository failure
      const stage: DueFailureStage = e instanceof Error && e.message.startsWith('data-quality') ? 'quality' : 'history';
      report.failures.push({ repository: name, stage: e instanceof NotFoundError ? 'history' : stage, reason: errText(e) });
    });
    report.collected += added;
    if (state.fatal !== null) fatal = state.fatal;

    if (added > 0) {
      const dataset = buildDataset([...merged.values()], asOf, historyPages);
      assertValidDataset(dataset); // throws before writing: the existing file stays untouched
      await writeJsonAtomic(o.outPath, dataset);
      report.written = true;
      report.datasetRepositories = dataset.repositories.length;
      logger.log({ operation: 'due.checkpoint', repository: o.outPath, collected: report.collected, failures: report.failures.length, datasetRepositories: dataset.repositories.length });
    }
  }

  report.stoppedBy = fatal === null ? null : errText(fatal);
  report.durationMs = Date.now() - started;
  logger.log({ operation: 'due.done', collected: report.collected, failures: report.failures.length, stoppedBy: report.stoppedBy, durationMs: report.durationMs });
  return report;
}
