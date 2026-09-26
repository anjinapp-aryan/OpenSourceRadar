import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS_DIR } from './common';

// Order matters little; rate-limit first so its numbers are not polluted by other scripts.
const SCRIPTS = ['rate-limit', 'graphql', 'search', 'star-history'];

const summary: Record<string, { exitCode: number | null; status: string }> = {};
for (const name of SCRIPTS) {
  console.log(`\n=== smoke: ${name} ===`);
  const res = spawnSync(process.execPath, ['--import', 'tsx', join('scripts', 'smoke', `${name}.ts`)], {
    stdio: 'inherit',
    env: process.env,
  });
  const code = res.status;
  summary[name] = { exitCode: code, status: code === 0 ? 'PASS' : code === 2 ? 'NOT RUN (no token)' : 'FAIL' };
}
mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(join(RESULTS_DIR, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), summary }, null, 2));
console.log('\n' + JSON.stringify(summary, null, 2));
if (Object.values(summary).some((s) => s.exitCode !== 0)) process.exitCode = 1;
