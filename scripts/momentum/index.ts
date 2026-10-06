import { readFileSync } from 'node:fs';
import type { ClassifiedDataset } from '../../src/classification/datasets';
import type { Dataset as RepositoryDataset } from '../../src/collect/dataset';
import { createLogger } from '../../src/github/logger';
import { readJsonIfExists, writeJsonAtomic } from '../../src/io/atomicWrite';
import { loadMomentumConfig } from '../../src/momentum/config';
import { buildMomentumDataset, derivePublic, validateMomentumDataset } from '../../src/momentum/dataset';
import { parsePatternConfig } from '../../src/explain/pattern';
import { buildHistory } from '../../src/history';
import { parseLifecycleConfig } from '../../src/lifecycle';
import type { CandidateDataset } from '../../src/collect/candidates';

const USAGE = `Usage: tsx scripts/momentum/index.ts [options]
  --repositories <path>  Phase 2 repository dataset with star history (default data/repositories.json)
  --classified <path>    classified dataset, joined into the PUBLIC file only (optional; never used by momentum)
  --tracked <path>       tracked dataset, only for the public stats block (optional)
  --candidates <path>    candidate dataset, for the lifecycle states (default data/candidates/candidates.json)
  --history <path>       public 90-day history file (default: next to --public, history.json / history.next.json)
  --pipeline-config <p>  default config/pipeline.json (lifecycle and history settings)
  --pattern-config <p>   default config/pattern.json
  --out <path>           internal momentum dataset (default data/momentum/momentum.json)
  --public <path>        compact public dataset (default data/public/radar.json)
  --config <path>        default config/momentum.json
  --now <iso>            evaluation time (default: now)
Local and deterministic: no network, no token.`;

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

interface TrackedLite {
  id: string;
  tier: string;
  lastCollectedAt?: string | null;
  refreshIntervalHours?: number;
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  if (a.help) return void console.log(USAGE);
  const str = (k: string, d?: string) => (typeof a[k] === 'string' ? (a[k] as string) : d);
  const now = str('now') ? new Date(str('now') as string) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--now is not a valid date');
  const repos = JSON.parse(readFileSync(str('repositories', 'data/repositories.json') as string, 'utf8')) as RepositoryDataset;
  const classified = str('classified') ? await readJsonIfExists<ClassifiedDataset>(str('classified') as string) : undefined;
  const cfg = loadMomentumConfig(str('config', 'config/momentum.json'));

  const started = Date.now();
  const momentum = buildMomentumDataset(repos, now, cfg);
  const problems = validateMomentumDataset(momentum);
  if (problems.length > 0) throw new Error(`momentum dataset failed validation: ${problems.slice(0, 3).join('; ')}`);
  const tracked = str('tracked', 'data/tracked/tracked.json') as string;
  const trackedDs = await readJsonIfExists<{ summary: { tracked: number; unassessed: number }; records?: TrackedLite[]; repositories?: TrackedLite[] }>(tracked);
  const categories = ['ai', 'engineering'].flatMap((d) => {
    const cfgFile = JSON.parse(readFileSync(`config/categories/${d}.json`, 'utf8')) as { domain: string; categories: { slug: string; name: string }[] };
    return cfgFile.categories.map((x) => ({ slug: x.slug, name: x.name, domain: cfgFile.domain }));
  });
  const stats = trackedDs ? { tracked: trackedDs.summary.tracked, unassessed: trackedDs.summary.unassessed, measured: trackedDs.summary.tracked - trackedDs.summary.unassessed } : undefined;
  const tiers = Object.fromEntries((trackedDs?.repositories ?? trackedDs?.records ?? []).map((r) => [r.id, r.tier]));
  const pipelineCfg = JSON.parse(readFileSync(str('pipeline-config', 'config/pipeline.json') as string, 'utf8')) as { lifecycle: unknown; history: { days: number; topLevels: string[] } };
  const pattern = parsePatternConfig(JSON.parse(readFileSync(str('pattern-config', 'config/pattern.json') as string, 'utf8')));
  const candidates = await readJsonIfExists<CandidateDataset>(str('candidates', 'data/candidates/candidates.json') as string);
  const trackedRecords = trackedDs?.repositories ?? trackedDs?.records ?? [];
  // Lifecycle needs both the candidate set and the tracked set; without them every record would look orphaned, so it is skipped.
  const lifecycle =
    candidates && trackedDs
      ? {
          config: parseLifecycleConfig(pipelineCfg.lifecycle),
          candidateIds: new Set(candidates.candidates.map((c) => c.id)),
          tracking: new Map(trackedRecords.map((t) => [t.id, { tier: t.tier, lastCollectedAt: t.lastCollectedAt ?? null, refreshIntervalHours: t.refreshIntervalHours ?? 168 }] as const)),
          now,
        }
      : undefined;
  if (!lifecycle) console.error('momentum: candidate or tracked dataset missing; lifecycle states skipped (all scored records are published)');
  const pub = derivePublic(momentum, repos, classified, { categories, ...(stats ? { stats } : {}), tiers, pattern, ...(lifecycle ? { lifecycle } : {}) });

  const outPath = str('out', 'data/momentum/momentum.json') as string;
  const pubPath = str('public', 'data/public/radar.json') as string;
  await writeJsonAtomic(outPath, momentum);
  await writeJsonAtomic(pubPath, pub);
  const include = new Set(pub.repositories.filter((r) => r.classification !== null && pipelineCfg.history.topLevels.includes(r.classification.topLevel)).map((r) => r.id));
  const historyPath = str('history', pubPath.replace(/radar(\.next)?\.json$/, 'history$1.json')) as string;
  const history = buildHistory(repos.repositories, include, pipelineCfg.history.days, now.toISOString());
  await writeJsonAtomic(historyPath, history);
  const logger = createLogger();
  logger.log({ operation: 'momentum.done', repository: outPath, momentumVersion: momentum.momentumVersion, durationMs: Date.now() - started, ...momentum.summary.byTrend });
  console.log(JSON.stringify({ out: outPath, public: pubPath, history: historyPath, historyRepositories: Object.keys(history.repositories).length, lifecycle: pub.lifecycle ?? null, momentumVersion: momentum.momentumVersion, durationMs: Date.now() - started, summary: momentum.summary, publicRepositories: pub.repositories.length }, null, 2));
}

main().catch((e) => {
  console.error('momentum failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
