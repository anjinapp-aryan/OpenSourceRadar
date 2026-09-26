import { readFileSync } from 'node:fs';
import type { CandidateDataset } from '../../src/collect/candidates';
import type { Dataset as RepositoryDataset } from '../../src/collect/dataset';
import type { ClassifiedDataset } from '../../src/classification/datasets';
import { createLogger } from '../../src/github/logger';
import { readJsonIfExists, writeJsonAtomic } from '../../src/io/atomicWrite';
import { loadTrackingPolicy } from '../../src/tracking/config';
import { buildTrackedDataset, validateTrackedDataset, type TrackedDataset } from '../../src/tracking/datasets';

const USAGE = `Usage: tsx scripts/track/index.ts [options]
  --classified <path>   default data/classified/classified.json
  --candidates <path>   default data/candidates/candidates.json
  --growth <path>       Phase 2 repository dataset with star history (optional; without it every tier is provisional)
  --previous <path>     previous tracked dataset (default: the --out file if it exists) so tier changes are damped
  --out <path>          default data/tracked/tracked.json
  --policy <path>       default config/tracking.json
  --now <iso>           evaluation time (default: now); makes runs reproducible
Local and deterministic: no network, no GitHub token.`;

function args(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}\n${USAGE}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  if (a.help) return void console.log(USAGE);
  const str = (k: string, d?: string) => (typeof a[k] === 'string' ? (a[k] as string) : d);
  const outPath = str('out', 'data/tracked/tracked.json') as string;
  const policy = loadTrackingPolicy(str('policy', 'config/tracking.json'));
  const classified = JSON.parse(readFileSync(str('classified', 'data/classified/classified.json') as string, 'utf8')) as ClassifiedDataset;
  const candidates = JSON.parse(readFileSync(str('candidates', 'data/candidates/candidates.json') as string, 'utf8')) as CandidateDataset;
  const growthPath = str('growth');
  const growth = growthPath ? (JSON.parse(readFileSync(growthPath, 'utf8')) as RepositoryDataset) : undefined;
  const previous = await readJsonIfExists<TrackedDataset>(str('previous', outPath) as string);
  const now = str('now') ? new Date(str('now') as string) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--now is not a valid date');

  const started = Date.now();
  const dataset = buildTrackedDataset({ classified, candidates, growth, previous, policy, now });
  const problems = validateTrackedDataset(dataset);
  if (problems.length > 0) throw new Error(`tracked dataset failed validation: ${problems.slice(0, 3).join('; ')}`);

  const logger = createLogger();
  for (const r of dataset.repositories.filter((x) => x.transition)) {
    logger.log({ operation: 'track.transition', repository: r.fullName, trackingVersion: dataset.trackingVersion, from: r.transition?.from, to: r.transition?.to, reason: r.reason });
  }
  await writeJsonAtomic(outPath, dataset);
  logger.log({ operation: 'track.done', repository: outPath, trackingVersion: dataset.trackingVersion, durationMs: Date.now() - started, ...dataset.summary.byTier });
  console.log(JSON.stringify({ out: outPath, trackingVersion: dataset.trackingVersion, durationMs: Date.now() - started, ...dataset.summary }, null, 2));
}

main().catch((e) => {
  console.error('track failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
