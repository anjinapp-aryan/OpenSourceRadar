import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS_DIR } from './smoke/common';

/**
 * Turns measured smoke-test output into the budget tables of docs/API-BUDGET.md.
 * Every number is tagged MEASURED (read from results), ESTIMATED (arithmetic on
 * measured numbers, assumptions stated) or UNKNOWN (no measurement available).
 */
interface Report {
  checks: { name: string; ok: boolean }[];
  measurements: Record<string, any>;
}

function load(name: string): Report | null {
  const p = join(RESULTS_DIR, `${name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Report) : null;
}

const POINTS_PER_HOUR_DOCUMENTED = 5000; // DOCUMENTED (GitHub docs), not measured here
const SIZES = [100, 500, 1000];
const CADENCES: { label: string; runsPerMonth: number }[] = [
  { label: 'daily snapshot', runsPerMonth: 30 },
  { label: 'weekly collection', runsPerMonth: 4 },
  { label: 'monthly collection', runsPerMonth: 1 },
];

const lines: string[] = [];
const out = (s = '') => lines.push(s);

const gql = load('graphql');
const star = load('star-history');

out('# Generated API budget');
out();
out(`Generated ${new Date().toISOString()} from scripts/smoke/results/*.json`);
out();

const batches: any[] = gql?.measurements.batches ?? [];
const best = [...batches].sort((a, b) => b.batchSize - a.batchSize)[0];

if (!best) {
  out('**UNKNOWN** - no graphql smoke results found. Run `npm run smoke` with GITHUB_TOKEN set, then `npm run budget`.');
} else {
  const costPerRepo = best.cost / best.batchSize;
  out('## MEASURED: repository snapshot via GraphQL');
  out();
  out('| batch size | requests | cost (points) | cost/repo | duration ms |');
  out('|---:|---:|---:|---:|---:|');
  for (const b of batches) out(`| ${b.batchSize} | ${b.requests} | ${b.cost} | ${(b.cost / b.batchSize).toFixed(4)} | ${b.durationMs} |`);
  out();
  out(`## ESTIMATED: snapshot collection (batch ${best.batchSize}, cost/repo ${costPerRepo.toFixed(4)} points, both MEASURED)`);
  out();
  out(`Assumption: cost scales linearly with repository count; ${POINTS_PER_HOUR_DOCUMENTED} points/hour is the DOCUMENTED PAT limit.`);
  out();
  out('| repos | requests/run | points/run | % of hourly budget | ' + CADENCES.map((c) => `points/month (${c.label}, ${c.runsPerMonth} runs)`).join(' | ') + ' |');
  out('|---:|---:|---:|---:|' + CADENCES.map(() => '---:').join('|') + '|');
  for (const n of SIZES) {
    const requests = Math.ceil(n / best.batchSize);
    const points = Math.ceil(n * costPerRepo);
    out(`| ${n} | ${requests} | ${points} | ${((points / POINTS_PER_HOUR_DOCUMENTED) * 100).toFixed(2)}% | ` + CADENCES.map((c) => points * c.runsPerMonth).join(' | ') + ' |');
  }
  const commit: any[] = gql?.measurements.commitActivity ?? [];
  if (commit.length) {
    out();
    out('## MEASURED: extra cost of commit-count field');
    out();
    for (const c of commit) out(`- batch ${c.batchSize}: cost ${c.cost} (vs ${batches.find((b) => b.batchSize === c.batchSize)?.cost ?? 'UNKNOWN'} without)`);
  }
}

out();
const samples: any[] = star?.measurements.samples ?? [];
if (samples.length === 0) {
  out('## UNKNOWN: star-history cost (no star-history smoke results)');
} else {
  out('## MEASURED: GET /repos/{owner}/{repo}/stargazers/history (first page = 30 weeks)');
  out();
  out('| repo | HTTP | page-1 bytes | page-1 ms | pages to full history | oldest week |');
  out('|---|---:|---:|---:|---:|---|');
  for (const r of samples) {
    out(`| ${r.repo} | ${r.httpStatus} | ${r.page1Bytes} | ${r.page1DurationMs} | ${r.lastPageFromLink} | ${r.lastPageFetched?.oldestWeek ?? r.oldestFetchedWeek} |`);
  }
  const avgBytes = samples.reduce((a, r) => a + r.page1Bytes, 0) / samples.length;
  const avgMs = samples.reduce((a, r) => a + r.page1DurationMs, 0) / samples.length;
  out();
  out(`Average page-1 response: ${avgBytes.toFixed(0)} bytes, ${avgMs.toFixed(0)} ms (MEASURED over ${samples.length} repositories, sequential, one network location).`);
  out();
  out('## ESTIMATED: one 30-week refresh per repository (1 request each)');
  out();
  out('| repos | requests | download | sequential time at measured latency | vs 60/h anonymous | vs 1,000/h Actions token | vs 5,000/h PAT |');
  out('|---:|---:|---:|---:|---|---|---|');
  for (const n of SIZES) {
    out(`| ${n} | ${n} | ${((n * avgBytes) / 1024).toFixed(0)} KiB | ${((n * avgMs) / 1000).toFixed(0)} s | ${n <= 55 ? 'fits' : 'does not fit'} | ${n <= 995 ? 'fits' : 'does not fit'} | fits |`);
  }
  out();
  out('Limits 1,000/h and 5,000/h are DOCUMENTED, not measured; 60/h anonymous is MEASURED. A full-history fetch costs "pages to full history" requests per repository (MEASURED for the sampled repositories only).');
}

const md = lines.join('\n');
writeFileSync(join(RESULTS_DIR, 'budget.md'), md);
console.log(md);
