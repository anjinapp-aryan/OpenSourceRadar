import { readFileSync } from 'node:fs';
import { CandidateDataset, validateCandidateDataset } from '../../src/collect/candidates';
import { classifyCandidates, toClassificationInput, validateClassifiedDataset } from '../../src/classification/datasets';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { createLogger } from '../../src/github/logger';
import { writeJsonAtomic } from '../../src/io/atomicWrite';

const USAGE = `Usage: tsx scripts/classify/index.ts [options]
  --candidates <path>   default data/candidates/candidates.json
  --out <path>          default data/classified/classified.json
  --log-decisions       log one line per repository (classifier version, top level, categories, signals)
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
  const inPath = (a.candidates as string | undefined) ?? 'data/candidates/candidates.json';
  const outPath = (a.out as string | undefined) ?? 'data/classified/classified.json';

  const candidates = JSON.parse(readFileSync(inPath, 'utf8')) as CandidateDataset;
  const problems = validateCandidateDataset(candidates);
  if (problems.length > 0) throw new Error(`invalid candidate dataset ${inPath}: ${problems.slice(0, 3).join('; ')}`);

  const started = Date.now();
  const classifier = new Classifier(loadTaxonomy());
  const generatedAt = new Date();
  const dataset = classifyCandidates(candidates, classifier, generatedAt);
  const bad = validateClassifiedDataset(dataset);
  if (bad.length > 0) throw new Error(`classified dataset failed validation: ${bad.slice(0, 3).join('; ')}`);

  const logger = createLogger();
  if (a['log-decisions'] === true) {
    const byId = new Map(candidates.candidates.map((c) => [c.id, c]));
    for (const r of dataset.repositories) {
      const c = byId.get(r.id);
      logger.log({
        operation: 'classify.decision',
        repository: r.fullName,
        classifierVersion: r.result.classifierVersion,
        topLevel: r.result.topLevelCategory,
        categories: r.result.categories.map((x) => `${x.slug}:${x.score}`),
        signals: r.result.positiveSignals.slice(0, 4),
        negative: r.result.negativeSignals.slice(0, 2),
        input: c ? Object.keys(toClassificationInput(c)) : undefined,
      });
    }
  }
  await writeJsonAtomic(outPath, dataset);
  logger.log({ operation: 'classify.done', repository: outPath, classifierVersion: dataset.classifierVersion, durationMs: Date.now() - started, ...dataset.summary.byTopLevel });
  console.log(JSON.stringify({ out: outPath, classifierVersion: dataset.classifierVersion, durationMs: Date.now() - started, ...dataset.summary }, null, 2));
}

main().catch((e) => {
  console.error('classify failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
