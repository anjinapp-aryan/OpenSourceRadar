import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('Phase 6.3.1 AI safety regression (hard gate)', () => {
  const before = read('results/phase6.3.1/ai-regression-before.json');
  const after = read('results/phase6.3.1/ai-regression-after.json');
  it('the production pipeline gives zero AI differences before and after all Phase 6.3.1 work', () => {
    for (const r of [before, after]) {
      expect(r.verdict).toBe('AI UNCHANGED');
      expect(r.aiAndBothRecords).toBeGreaterThan(1500);
      expect([r.added, r.removed, r.reordered, r.scoreChanges, r.trendChanges, r.patternChanges, r.recordsWithAnyFieldChange]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(r.wholeRepositoriesArrayIdentical).toBe(true);
      expect(r.historyIdentical).toBe(true);
      expect(Object.values(r.listsIdentical).every(Boolean)).toBe(true);
    }
  });
  it('before and after are identical, including the pinned hashes of the production ranking sources', () => {
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    const phase63 = read('results/phase6.3/ai-regression.json');
    expect(after.protectedSourceSha256).toEqual(phase63.protectedSourceSha256);
  });
});

describe('Phase 6.3.1 changes nothing that production reads or publishes', () => {
  it('no tracked or untracked file under the production data, ranking, classification, tracking, UI or production workflow changed', () => {
    const status = execSync('git status --porcelain -- data config/momentum.json config/pattern.json config/tracking.json config/classification.json config/categories config/pipeline.json src/momentum/engine.ts src/momentum/config.ts src/momentum/dataset.ts src/momentum/types.ts src/classification src/tracking src/lifecycle/index.ts src/pipeline/gate.ts src/pipeline/state.ts src/pipeline/size.ts src/collect app lib components .github/workflows/radar.yml package.json package-lock.json', { encoding: 'utf8' });
    expect(status.trim()).toBe('');
  });
  it('the committed public data still passes the unchanged production gate', async () => {
    const { publicSchemaProblems, secretShapeProblems } = await import('../src/pipeline/gate');
    const radar = read('data/public/radar.json');
    expect(publicSchemaProblems(radar, read('data/public/history.json'))).toEqual([]);
    expect(secretShapeProblems(JSON.stringify(radar), 'radar.json')).toEqual([]);
  });
  it('Engineering remains Coming soon and no Engineering page or navigation exists', () => {
    expect(readFileSync('components/NavLinks.tsx', 'utf8')).toContain('Coming soon');
    const appDirs = execSync('git ls-files app', { encoding: 'utf8' });
    expect(appDirs).not.toMatch(/engineering/i);
  });
  it('no production module imports a Phase 6.3 or 6.3.1 module', () => {
    let out = '';
    try {
      out = execSync(`git grep --untracked -l -E "src/shadow|src/lifecycle/engineering|pipeline/gateV2|/taxonomy'|momentum/normalize|discovery/admission|/domain'" -- app lib components scripts/collect scripts/track scripts/pipeline scripts/momentum/index.ts src/momentum/engine.ts src/momentum/dataset.ts src/pipeline/gate.ts src/pipeline/state.ts src/collect src/tracking`, { encoding: 'utf8' }).trim();
    } catch {
      out = '';
    }
    expect(out).toBe('');
  });
});
