/**
 * Measured quality of the stored star histories: `tsx scripts/pipeline/history-quality.ts <repositories.json> [public.json]`.
 * With a public dataset, only the records that are published are measured; otherwise every record is. Read-only.
 */
import { readFileSync } from 'node:fs';
import type { Dataset } from '../../src/collect/dataset';
import { historyQuality } from '../../src/history';

const [reposPath, pubPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!reposPath) {
  console.error('usage: history-quality.ts <repositories.json> [public radar.json]');
  process.exit(1);
}
const repos = JSON.parse(readFileSync(reposPath, 'utf8')) as Dataset;
const pub = pubPath ? (JSON.parse(readFileSync(pubPath, 'utf8')) as { repositories: { id: string; classification: { topLevel: string } | null }[] }) : null;
const ids = pub ? new Set(pub.repositories.map((r) => r.id)) : null;
const aiIds = pub ? new Set(pub.repositories.filter((r) => r.classification && ['AI', 'BOTH'].includes(r.classification.topLevel)).map((r) => r.id)) : null;
const day = 86_400_000;
const measure = (include: Set<string> | null) => {
  const recs = repos.repositories.filter((r) => (include ? include.has(r.id) : true));
  return historyQuality(
    recs,
    (r) => Math.max(0, (Date.parse(r.growthAsOf ?? repos.generatedAt) - Date.parse(r.createdAt)) / day),
    (r) => (r.growthAsOf ?? repos.generatedAt).slice(0, 10),
  );
};
console.log(JSON.stringify({ published: ids ? measure(ids) : null, aiScope: aiIds ? measure(aiIds) : null, all: measure(null) }, null, 1));
