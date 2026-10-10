/**
 * Phase 6.3.1: aggregate the daily shadow records into the weekly cycle result. Read-only; writes the summary only.
 *
 *   tsx scripts/shadow/cycle.ts <shadow dir> [--out <path>]
 *
 * The cycle is reported COMPLETE only when seven consecutive UTC days, one of them with a discovery run, are present. Fewer days are reported as
 * an incomplete cycle (never filled in or extrapolated). Exit code 0 always; the verdict is in the output.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAdmissionConfig } from '../../src/discovery/admission';
import { dailyEvidenceRow, summarizeCycle, type DailyRecord } from '../../src/shadow/report';

const argv = process.argv.slice(2);
const shadowDir = argv[0] as string;
const out = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : join(shadowDir, 'cycle-summary.json');
const dailyDir = join(shadowDir, 'daily');
const days: DailyRecord[] = existsSync(dailyDir) ? readdirSync(dailyDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(dailyDir, f), 'utf8')) as DailyRecord) : [];
const cfg = loadAdmissionConfig();
const summary = summarizeCycle(days, cfg.budget.maxHistoryRequestsPerDay);
const verdict = days.length === 0 ? 'NOT YET OBSERVED: no shadow day has been recorded' : summary.complete ? (summary.stopCondition ? 'COMPLETE, BUT STOP CONDITION HIT' : 'COMPLETE') : `INCOMPLETE: ${summary.days} of 7 days observed`;
writeFileSync(out, JSON.stringify({ verdict, summary }, null, 1) + '\n');
console.log(JSON.stringify({ verdict, summary }, null, 1));
