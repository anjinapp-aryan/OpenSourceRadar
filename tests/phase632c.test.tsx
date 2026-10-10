import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OBSERVED_PRODUCTION_PEAK, shadowHistoryBudget } from '../src/shadow/budget';
import { dailyEvidenceRow, type DailyRecord } from '../src/shadow/report';

const wf = readFileSync('.github/workflows/shadow.yml', 'utf8');
const prod = readFileSync('.github/workflows/radar.yml', 'utf8');
const body = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

describe('Phase 6.3.2 shadow workflow safety (static; the workflow has not run on GitHub)', () => {
  it('is inert unless the repository variable is true, and has no pull-request or push triggers', () => {
    expect(wf).toContain("if: ${{ vars.SHADOW_ENABLED == 'true' }}");
    expect(body).not.toMatch(/pull_request|pull_request_target|\n  push:/);
  });
  it('has the narrowest permission it needs (contents: write for its own release only) and no other', () => {
    const perms = wf.match(/permissions:\n((?: {2}.+\n)+)/)![1]!;
    expect(perms.trim()).toBe('contents: write');
  });
  it('never commits, pushes, stages, deploys or writes under data/ public/ out/', () => {
    expect(body).not.toMatch(/git (commit|push|add|checkout|reset|rm|mv|stash|tag|config)|vercel/);
    expect(body).not.toMatch(/(--out|--out-dir|--shadow-dir|--cache)\s+(\.\/)?(data|public|out|\.next)\b/);
    expect(body).not.toMatch(/>>?\s*(\.\/)?(data|public|out|\.next)\//);
  });
  it('writes only to .shadow, .shadow-prod and its own release', () => {
    const writes = [...body.matchAll(/--out-dir (\S+)|--shadow-dir (\S+)|--cache (\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w).toMatch(/^\.shadow(\/|$)/);
    expect(body).toContain('gh release upload shadow-state');
    expect(body).not.toMatch(/gh release (upload|edit|delete) (?!shadow-state)/);
    expect(body).not.toContain('gh release delete');
  });
  it('production state is only downloaded, into its own directory', () => {
    expect(body).toContain('gh release download data-state --pattern state.tar.gz --dir .shadow-prod');
    expect(body).not.toMatch(/gh release (upload|create|edit) data-state/);
  });
  it('secrets: no workflow-level env, a token only on the two steps that call GitHub search/history, never echoed, evidence scanned before saving or uploading', () => {
    expect(wf).not.toMatch(/^env:/m);
    expect(body).not.toMatch(/echo[^\n]*(TOKEN|secrets\.)|printenv|set -x/);
    const blocks = wf.split(/\n {6}- /);
    const withSecret = blocks.filter((b) => b.includes('secrets.RADAR_GITHUB_TOKEN'));
    expect(withSecret).toHaveLength(2);
    for (const b of withSecret) expect(b).toMatch(/scripts\/shadow\/(discover|track)\.ts/);
    const scan = wf.indexOf('Secret scan of the evidence');
    expect(scan).toBeGreaterThan(0);
    expect(scan).toBeLessThan(wf.indexOf('Save shadow state'));
    expect(scan).toBeLessThan(wf.indexOf('upload-artifact'));
  });
  it('uploads only evidence files, never the search cache, the pool of repository snapshots or production state', () => {
    const up = wf.slice(wf.indexOf('upload-artifact'));
    expect(up).toMatch(/\.shadow\/daily/);
    expect(up).not.toMatch(/cache|pool|\.shadow-prod|data\//);
  });
  it('failure is safe: state is saved only after the isolation check and the evidence scan (default success condition); no blind retry', () => {
    expect(wf.indexOf('Verify isolation')).toBeLessThan(wf.indexOf('Save shadow state'));
    expect(body).not.toMatch(/if: always\(\)|if: failure\(\)|continue-on-error/);
    expect(wf).toMatch(/timeout-minutes: 90/);
  });
  it('concurrency: one shadow at a time, queued not cancelled, in a group different from production; scheduled after the production window', () => {
    expect(wf).toMatch(/group: radar-shadow\n\s+cancel-in-progress: false/);
    expect(prod).toMatch(/group: radar-pipeline/);
    expect(wf).toContain("cron: '47 13 * * *'");
  });
  it('uses only first-party actions at a major version', () => {
    const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^actions\/[a-z-]+@v\d+$/);
  });
  it('bounded requests: the tracker has the shared budget guard', () => {
    const t = readFileSync('scripts/shadow/track.ts', 'utf8');
    expect(t).toContain('shadowHistoryBudget');
    expect(t).toMatch(/pageRequests >= budgetForShadow/);
  });
});

describe('Phase 6.3.2 shared API budget (production + shadow never above the ceiling)', () => {
  const base = { ceiling: 2000, baseline: 1125, observedPeak: OBSERVED_PRODUCTION_PEAK };
  it('production recorded: reserve the larger of today and the average baseline', () => {
    expect(shadowHistoryBudget({ ...base, productionRecordedToday: 821 })).toEqual({ budget: 875, reserved: 1125, basis: 'recorded' });
    expect(shadowHistoryBudget({ ...base, productionRecordedToday: 1795 })).toEqual({ budget: 205, reserved: 1795, basis: 'recorded' });
  });
  it('production not recorded (late, failed or still running): reserve its observed peak, not its average', () => {
    expect(shadowHistoryBudget({ ...base, productionRecordedToday: 0 })).toEqual({ budget: 205, reserved: 1795, basis: 'worst-case' });
    expect(shadowHistoryBudget({ ...base, productionRecordedToday: Number.NaN }).basis).toBe('worst-case');
  });
  it('invariant: for every production load up to the observed peak, production + shadow budget <= ceiling, and the budget is never negative', () => {
    for (let p = 0; p <= OBSERVED_PRODUCTION_PEAK; p += 5) {
      for (const recorded of [0, p]) {
        const b = shadowHistoryBudget({ ...base, productionRecordedToday: recorded });
        expect(p + b.budget).toBeLessThanOrEqual(2000);
        expect(b.budget).toBeGreaterThanOrEqual(0);
      }
    }
    expect(shadowHistoryBudget({ ...base, productionRecordedToday: 5000 }).budget).toBe(0);
  });
  it('the shadow own search pages and rate-limit check are subtracted too (Monday discovery: 148 search requests plus one check)', () => {
    const b = shadowHistoryBudget({ ...base, productionRecordedToday: 821, shadowOtherRequests: 149 });
    expect(b.budget).toBe(726);
    expect(b.reserved + 149 + b.budget).toBe(2000);
    expect(shadowHistoryBudget({ ...base, productionRecordedToday: 1795, shadowOtherRequests: 149 }).budget).toBe(56);
  });
  it('the ceiling is configuration (2,000) and no code raises it', () => {
    expect(JSON.parse(readFileSync('config/admission.json', 'utf8')).budget.maxHistoryRequestsPerDay).toBe(2000);
    expect(readFileSync('scripts/shadow/track.ts', 'utf8')).not.toMatch(/maxHistoryRequestsPerDay\s*[+*]/);
  });
});

describe('Phase 6.3.2 daily evidence row (SYNTHETIC record - NOT REAL EVIDENCE)', () => {
  const d: DailyRecord = { date: '2026-01-01', historyRequests: 10, historyFailures: 1, productionHistoryRequests: 800, searchRequests: 0, poolSize: 5, newAdmissions: 0, runtimeSeconds: 3, rateLimit: { remainingAtEnd: 4000, hitLimit: false } };
  it('values that were not recorded are null, never filled in', () => {
    const r = dailyEvidenceRow(d);
    expect([r.unknown, r.capHits, r.tiers, r.restRequests, r.startedAfterProduction]).toEqual([null, null, null, null, null]);
    expect(r.combinedHistoryRequests).toBe(810);
  });
});

describe('Phase 6.3.2 shadow scripts refuse production output paths', () => {
  it('track.ts refuses a shadow directory under data/ (before any network call)', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/shadow/track.ts', 'data', '--shadow-dir', 'data/shadow-x'], { encoding: 'utf8', shell: true });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/refus|data\//i);
  }, 60_000);
});
