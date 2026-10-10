import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAdmissionConfig } from '../src/discovery/admission';
import { loadLifecycleConfig } from '../src/lifecycle/engineering';
import { csvRecords } from '../src/taxonomy/csv';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const lc = loadLifecycleConfig();

describe('Phase 6.3.1 shadow workflow is inert, isolated and read-only with respect to production', () => {
  const wf = readFileSync('.github/workflows/shadow.yml', 'utf8');
  it('only runs when SHADOW_ENABLED is true, so merging it starts nothing', () => {
    expect(wf).toContain("vars.SHADOW_ENABLED == 'true'");
    expect(wf).toContain('schedule:');
    expect(wf).toContain('workflow_dispatch:');
  });
  it('never commits, pushes, deploys or writes to data/ or public/', () => {
    expect(wf).not.toMatch(/git\s+(commit|push|add)\b/);
    expect(wf).not.toMatch(/vercel/i);
    expect(wf).not.toMatch(/--out(-dir)?\s+(data|public)\//);
    expect(wf).not.toMatch(/>\s*data\//);
    expect(wf).toContain('Verify isolation');
    expect(wf).toContain('--untracked-files=no');
  });
  it('restores production state read-only into its own directory and keeps its own state release', () => {
    expect(wf).toContain('-C .shadow-prod');
    expect(wf).toContain('shadow-state');
    expect(wf).not.toMatch(/gh release upload data-state/);
  });
  it('declares the least privilege and one concurrent run', () => {
    expect(wf).toMatch(/permissions:\s*\r?\n\s*contents: write/);
    expect(wf).toContain('group: radar-shadow');
    expect(wf).toContain('cancel-in-progress: false');
  });
  it('calls only the shadow scripts, and the production workflow does not mention the shadow', () => {
    const called = [...wf.matchAll(/scripts\/[a-z]+\/[a-z-]+\.ts/g)].map((m) => m[0]);
    expect(called.length).toBeGreaterThan(0);
    expect(called.every((s) => s.startsWith('scripts/shadow/'))).toBe(true);
    expect(readFileSync('.github/workflows/radar.yml', 'utf8')).not.toContain('shadow');
  });
});

describe('Phase 6.3.1 recorded shadow discovery (manual local run, not a scheduled cycle)', () => {
  const d = read('results/phase6.3.1/shadow/discovery-2026-10-10.json');
  it('records every required figure and is internally consistent', () => {
    const s = d.stats;
    expect(d.mode).toBe('shadow');
    expect(s.queries).toBe(66);
    expect(s.uniqueRepositories + s.duplicateResults).toBe(s.rawResults);
    expect(s.usable).toBe(s.uniqueRepositories - s.archived - s.forks - s.malformed);
    expect(s.newAdmissions + s.rejectedTotal).toBe(s.usable);
    expect(s.proposedAdmissions).toBe(s.newAdmissions + s.capHits.weekly + s.capHits.pool);
    expect(s.classified.AI + s.classified.ENGINEERING + s.classified.BOTH + s.classified.UNKNOWN).toBe(s.usable - s.alreadyCandidate);
    expect(s.unknownRate).toBeCloseTo(s.classified.UNKNOWN / (s.usable - s.alreadyCandidate), 3);
  });
  it('respects the configured caps and the budget ceiling', () => {
    const cfg = loadAdmissionConfig();
    expect(d.stats.newAdmissions).toBeLessThanOrEqual(cfg.budget.maxNewPerWeek);
    expect(d.budget.worstCaseHistoryRequestsPerDay).toBeLessThanOrEqual(cfg.budget.maxHistoryRequestsPerDay);
    expect(d.admitted.every((a: { topLevel: string }) => a.topLevel !== 'UNKNOWN')).toBe(true);
  });
  it('the single recorded day is reported as an incomplete cycle, never as a completed week', () => {
    const c = read('results/phase6.3.1/shadow/cycle-summary-local-smoke.json');
    expect(c.verdict).toContain('INCOMPLETE');
    expect(c.summary.complete).toBe(false);
    expect(c.summary.days).toBe(1);
    expect(c.summary.withinCeiling).toBe(true);
  });
  it('the admission review covers at least 50 admitted repositories and its counts add up', () => {
    const r = read('results/phase6.3.1/review/admission-review.json');
    const a = r.admittedSample;
    expect(a.n).toBeGreaterThanOrEqual(50);
    expect(a.clearlyRelevant + a.probablyRelevant + a.questionable + a.irrelevant).toBe(a.n);
    expect(a.precisionProxyClearlyOrProbably).toBeCloseTo((a.clearlyRelevant + a.probablyRelevant) / a.n, 3);
    expect(r.reviewer).toContain('NOT independent');
  });
});

describe('Phase 6.3.1 labelling pack and preliminary scores', () => {
  const key = read('results/phase6.3.1/labelling/sample-key.json');
  const sheet = readFileSync('results/phase6.3.1/labelling/sheet.csv', 'utf8');
  it('the blind sheet carries no prediction and has at least 200 rows', () => {
    const rows = csvRecords(sheet);
    expect(rows.length).toBeGreaterThanOrEqual(200);
    expect(Object.keys(rows[0]!)).toEqual(['id', 'fullName', 'url', 'description', 'topics', 'language', 'stars', 'ageDays', 'domainEngineering', 'areas', 'technologies', 'learning', 'type', 'notes']);
    expect(rows.every((r) => r.domainEngineering === '' && r.areas === '' && r.technologies === '' && r.learning === '' && r.type === '')).toBe(true);
    expect(Object.keys(rows[0]!).join(',')).not.toMatch(/prediction|topLevel|predicted|technology_pred|area_pred/i);
  });
  it('sampling weights reproduce the frame sizes per stratum', () => {
    for (const s of key.strata as { name: string; frame: number; sampled: number }[]) {
      const items = (key.items as { stratum: string; weight: number }[]).filter((i) => i.stratum === s.name);
      expect(items.length).toBe(s.sampled);
      if (s.sampled > 0) expect(items.reduce((a, i) => a + i.weight, 0)).toBeCloseTo(s.frame, 1);
    }
    expect(key.items.length).toBeGreaterThanOrEqual(200);
  });
  it('covers every required technology group', () => {
    const names = (key.strata as { name: string; sampled: number }[]).filter((s) => s.sampled > 0).map((s) => s.name).join(' ');
    for (const g of ['messaging', 'terraform', 'microservices', 'spring', 'aws', 'redis', 'postgresql', 'kubernetes', 'docker', 'databases', 'cloud', 'observability', 'infrastructure', 'devtools', 'java', 'borderline', 'unknown']) expect(names).toContain(g);
  });
  it('assistant scores are stamped as NOT human, and no file claims to be human', () => {
    for (const scope of ['engineering-only', 'engineering-or-both']) {
      const s = read(`results/phase6.3.1/labelling/scores-assistant-${scope}.json`);
      expect(s.kind).toBe('assistant');
      expect(s.independence).toContain('NOT independent');
      expect(s.independence).toContain('NOT human');
    }
    for (const f of readdirSync('results/phase6.3.1/labelling').filter((x) => x.startsWith('scores-human'))) expect(read(`results/phase6.3.1/labelling/${f}`).kind).toBe('human');
  });
  it('metrics are reported together at every level with raw counts', () => {
    const e = read('results/phase6.3.1/labelling/scores-assistant-engineering-only.json').evaluation;
    for (const level of ['domain', 'area', 'technology', 'learning']) {
      expect(e[level].counts).toHaveProperty('tp');
      expect(e[level].counts).toHaveProperty('fp');
      expect(e[level].counts).toHaveProperty('fn');
      expect(e[level].precision).not.toBeNull();
      expect(e[level].recall).not.toBeNull();
    }
    expect(e.validLabels).toBeGreaterThanOrEqual(200);
    expect(e.unknownRate).not.toBeNull();
  });
});

describe('Phase 6.3.1 lifecycle replay and New to Radar evidence', () => {
  const r = read('results/phase6.3.1/lifecycle-replay.json');
  it('the configuration equals the replay selection', () => {
    expect(r.selection.rising).toBe(`rising:${lc.rising.persistence}`);
    expect(r.selection.cooling).toBe(`cooling:${lc.cooling.kind}`);
    expect(r.engineeringRepositories).toBeGreaterThan(1500);
  });
  it('Cooling and Trending are mutually exclusive in the replay', () => {
    expect(r.overlaps.coolingFromHighAlsoTrending).toBe(0);
    expect(r.overlaps.coolingFromHighMemberDays).toBeGreaterThan(100);
  });
  it('every state is scored, and Breakout is reported as unreliable', () => {
    for (const k of ['rising', 'accelerating', 'breakout', 'cooling', 'sustained']) expect(r[k].length).toBeGreaterThan(0);
    expect(r.breakout[0].shortLivedEpisodeShare).toBe(1);
    expect(r.breakout[0].collapseNext7UnderQuarterOfWeek).toBeGreaterThan(0.15);
  });
  it('first publication arrives in weekly batches that are mostly not new repositories', () => {
    const n = read('results/phase6.3.1/new-to-radar.json');
    expect(n.batchDays.length).toBeLessThanOrEqual(3);
    expect(n.engineeringOnly.genuinelyNewShare).toBeLessThan(0.5);
    expect(n.ifDefinedByAdmission.admittedInOneWeeklyRun).toBe(150);
  });
});
