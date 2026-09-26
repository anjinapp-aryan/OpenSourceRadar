import { readFileSync } from 'node:fs';
import type { ClassifiedDataset } from '../../src/classification/datasets';
import type { Dataset as RepositoryDataset } from '../../src/collect/dataset';
import { createLogger } from '../../src/github/logger';
import { readJsonIfExists, writeJsonAtomic } from '../../src/io/atomicWrite';
import { loadMomentumConfig } from '../../src/momentum/config';
import { buildMomentumDataset, derivePublic, validateMomentumDataset } from '../../src/momentum/dataset';

const USAGE = `Usage: tsx scripts/momentum/index.ts [options]
  --repositories <path>  Phase 2 repository dataset with star history (default data/repositories.json)
  --classified <path>    classified dataset, joined into the PUBLIC file only (optional; never used by momentum)
  --tracked <path>       tracked dataset, only for the public stats block (optional)
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
  const trackedDs = await readJsonIfExists<{ summary: { tracked: number; unassessed: number }; records?: { id: string; tier: string }[]; repositories?: { id: string; tier: string }[] }>(tracked);
  const categories = ['ai', 'engineering'].flatMap((d) => {
    const cfgFile = JSON.parse(readFileSync(`config/categories/${d}.json`, 'utf8')) as { domain: string; categories: { slug: string; name: string }[] };
    return cfgFile.categories.map((x) => ({ slug: x.slug, name: x.name, domain: cfgFile.domain }));
  });
  const stats = trackedDs ? { tracked: trackedDs.summary.tracked, unassessed: trackedDs.summary.unassessed, measured: trackedDs.summary.tracked - trackedDs.summary.unassessed } : undefined;
  const tiers = Object.fromEntries((trackedDs?.repositories ?? trackedDs?.records ?? []).map((r) => [r.id, r.tier]));
  const pub = derivePublic(momentum, repos, classified, { categories, ...(stats ? { stats } : {}), tiers });

  const outPath = str('out', 'data/momentum/momentum.json') as string;
  const pubPath = str('public', 'data/public/radar.json') as string;
  await writeJsonAtomic(outPath, momentum);
  await writeJsonAtomic(pubPath, pub);
  const logger = createLogger();
  logger.log({ operation: 'momentum.done', repository: outPath, momentumVersion: momentum.momentumVersion, durationMs: Date.now() - started, ...momentum.summary.byTrend });
  console.log(JSON.stringify({ out: outPath, public: pubPath, momentumVersion: momentum.momentumVersion, durationMs: Date.now() - started, summary: momentum.summary, publicRepositories: pub.repositories.length }, null, 2));
}

main().catch((e) => {
  console.error('momentum failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
