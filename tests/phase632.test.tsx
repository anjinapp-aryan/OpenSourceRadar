import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainDomainMomentum } from '../src/explain/domainExplain';
import { firstPublishedMap, loadLifecycleConfig, newToRadar } from '../src/lifecycle/engineering';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('Phase 6.3.2 lifecycle leakage evidence (recorded run; the audit itself is an integration script, not a unit test)', () => {
  const path = 'results/phase6.3.2/lifecycle-leakage-audit.json';
  it.skipIf(!existsSync(path))('negative control: zero differences on or before the cut; positive control: the rewritten future changes the flags', () => {
    const a = read(path);
    expect(a.summary.differencesUpToCut).toBe(0);
    expect(a.summary.flagSetsComparedUpToCut).toBeGreaterThan(500);
    expect(a.summary.positiveControl.differingAfterCut).toBeGreaterThan(0);
    expect(a.summary.verdict).toMatch(/^NO LEAKAGE/);
    expect(a.summary.explanations.differencesUpToCut).toBe(0);
    expect(a.summary.explanations.comparedUpToCut).toBeGreaterThan(1000);
    expect(a.summary.explanations.positiveControl.differingAfterCut).toBeGreaterThan(0);
    for (const r of a.results) {
      expect(r.differencesUpToCut).toBe(0);
      expect(r.positiveControl.differingAfterCut).toBeGreaterThan(0);
    }
  });
});

describe('Phase 6.3.2 explanation determinism (no clock, no randomness, no input but the facts)', () => {
  const facts = { domain: 'ENGINEERING' as const, via: 'domain' as const, domainPercentile: 0.99, bandPercentile: 0.97, bandLabel: 'medium', bandPeers: 120, growth7d: 400, growth30d: 900, accelerationRatio: 1.2, domainGate: 0.98, bandGate: 0.97, stars: 5000, ageDays: 400 };
  it('same facts, same text', () => {
    expect(explainDomainMomentum(facts)).toEqual(explainDomainMomentum({ ...facts }));
  });
  it('the module reads neither the clock nor a random source nor the file system', () => {
    const src = readFileSync('src/explain/domainExplain.ts', 'utf8');
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|node:fs|process\.env|fetch\(/);
  });
});

describe('Phase 6.3.2 lifecycle module is pure', () => {
  it('src/lifecycle/engineering.ts takes no clock or random input and reads only its config file', () => {
    const src = readFileSync('src/lifecycle/engineering.ts', 'utf8');
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|process\.env|fetch\(/);
  });
});

describe('Phase 6.3.2 New to Radar is T-bounded', () => {
  const nr = loadLifecycleConfig().newToRadar;
  const f = { createdAt: '2026-01-01T00:00:00Z' };
  it('a first publication after the evaluation date is neither new nor reported (no negative day count)', () => {
    expect(newToRadar({ ...f, firstPublishedAt: '2026-10-14' }, '2026-10-10', nr)).toEqual({ newToRadar: false, daysSinceFirstPublished: null, genuinelyNew: false });
  });
  it('firstPublishedMap: the earliest snapshot wins and later snapshots never change an earlier first date', () => {
    const snaps = [{ date: '2026-10-01', ids: ['a'] }, { date: '2026-10-03', ids: ['a', 'b'] }];
    const base = firstPublishedMap(snaps);
    const more = firstPublishedMap([...snaps, { date: '2026-10-05', ids: ['a', 'b', 'c'] }]);
    expect(base.get('a')).toBe('2026-10-01');
    expect(more.get('a')).toBe('2026-10-01');
    expect(more.get('b')).toBe('2026-10-03');
    expect(firstPublishedMap([...snaps].reverse()).get('a')).toBe('2026-10-01');
  });
  const path = 'results/phase6.3.2/historical-inputs-audit.json';
  it.skipIf(!existsSync(path))('recorded bounded test: 0 differences up to the cut, valid positive control, no future first publication reported', () => {
    const h = read(path);
    expect(h.newToRadar.differencesUpToCut).toBe(0);
    expect(h.newToRadar.positiveControl.differingAfterCut).toBeGreaterThan(0);
    expect(h.newToRadar.futureFirstPublicationsReported).toBe(0);
    expect(h.newToRadar.verdict).toBe('NO LEAKAGE');
    expect(h.pointInTimePopulation.datesTested.length).toBeLessThan(29);
  });
});

describe('Phase 6.3.2 final AI regression (hard gate, recorded run)', () => {
  const path = 'results/phase6.3.2/ai-regression-final.json';
  it.skipIf(!existsSync(path))('zero AI/BOTH, list, history, score, trend and pattern differences, and identical to the 6.3.1 result', () => {
    const r = read(path);
    expect(r.verdict).toBe('AI UNCHANGED');
    expect(r.aiAndBothRecords).toBeGreaterThan(1500);
    expect([r.added, r.removed, r.reordered, r.scoreChanges, r.trendChanges, r.patternChanges, r.recordsWithAnyFieldChange]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(r.historyIdentical).toBe(true);
    expect(r.wholeRepositoriesArrayIdentical).toBe(true);
    expect(Object.values(r.listsIdentical).every(Boolean)).toBe(true);
    const before = read('results/phase6.3.1/ai-regression-after.json');
    const { evaluatedAt: _a, ...x } = r;
    const { evaluatedAt: _b, ...y } = before;
    expect(x).toEqual(y);
  });
});
