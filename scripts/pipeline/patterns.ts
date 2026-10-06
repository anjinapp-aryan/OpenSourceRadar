/**
 * Backtest report for the growth-pattern model: `tsx scripts/pipeline/patterns.ts [public.json] [--list N]`.
 * Reads a public dataset, recomputes every pattern with config/pattern.json, and prints how the patterns distribute over
 * all records, the AI scope and the Rising list. Pure measurement: nothing is written and no ranking is changed.
 */
import { readFileSync } from 'node:fs';
import { classifyPattern, evidenceOf, parsePatternConfig, PATTERNS, type Pattern, type PatternInput } from '../../src/explain/pattern';

const path = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && a.endsWith('.json')) ?? 'data/public/radar.json';
const listIdx = process.argv.indexOf('--list');
const listN = listIdx > 0 ? Number(process.argv[listIdx + 1]) : 0;
const cfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const ds = JSON.parse(readFileSync(path, 'utf8')) as { repositories: (PatternInput & { fullName: string; classification: { topLevel: string } | null; pattern?: Pattern })[] };

const tally = (rows: typeof ds.repositories) => {
  const t = Object.fromEntries(PATTERNS.map((p) => [p, 0])) as Record<Pattern, number>;
  for (const r of rows) t[classifyPattern(r, cfg)] += 1;
  return t;
};
const ai = ds.repositories.filter((r) => r.classification?.topLevel === 'AI' || r.classification?.topLevel === 'BOTH');
const rising = ds.repositories.filter((r) => r.trend === 'RISING');
const risingAi = rising.filter((r) => ai.includes(r));
const mismatches = ds.repositories.filter((r) => r.pattern !== undefined && r.pattern !== classifyPattern(r, cfg)).length;

console.log(JSON.stringify({ file: path, patternVersion: cfg.patternVersion, records: ds.repositories.length, storedPatternMismatches: mismatches, all: tally(ds.repositories), aiScope: { records: ai.length, patterns: tally(ai) }, rising: { records: rising.length, patterns: tally(rising) }, risingAiScope: { records: risingAi.length, patterns: tally(risingAi) } }, null, 1));

if (listN > 0) {
  for (const r of risingAi.slice(0, listN)) {
    const e = evidenceOf(r);
    console.log(`${classifyPattern(r, cfg).padEnd(18)} ${r.fullName.padEnd(44)} g7=${e.growth7d} g30=${e.growth30d} acc=${e.accelerationRatio} share30=${e.spikeShare30} life7=${e.lifetimeShare7d} age=${Math.round(e.ageDays)}d`);
  }
}
