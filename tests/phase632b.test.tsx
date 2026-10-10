import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cohensKappa, evaluateTaxonomy, type Prediction } from '../src/taxonomy/evaluation';
import { agreement, consensus, f1, independenceProblems, kappaBand, pooledSetKappa, projectTechnologies, type RaterLabel } from '../src/taxonomy/humanValidation';

// Every label in this file is SYNTHETIC - NOT REAL EVIDENCE. Nothing here is written to results/ and none of it is a measurement of the taxonomy.
const L = (id: string, o: Partial<RaterLabel> = {}): RaterLabel => ({ id, domainEngineering: 'YES', areas: [], technologies: [], technologiesUsed: [], learning: 'NO', type: 'tool', confidence: 'HIGH', ...o });
const areas = ['backend', 'data', 'messaging'];
const techs = ['kafka', 'docker', 'postgresql'];

describe('SYNTHETIC - NOT REAL EVIDENCE: Cohen kappa against known values', () => {
  it('perfect agreement is 1, complete disagreement is below 0, chance-level is about 0', () => {
    expect(cohensKappa(['a', 'b', 'a', 'b'], ['a', 'b', 'a', 'b'])).toBe(1);
    expect(cohensKappa(['a', 'b', 'a', 'b'], ['b', 'a', 'b', 'a'])).toBe(-1);
    expect(cohensKappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b'])).toBe(0);
  });
  it('matches the textbook value 0.4 (Wikipedia example: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no gives 0.4)', () => {
    const a = [...Array(20).fill('y'), ...Array(5).fill('y'), ...Array(10).fill('n'), ...Array(15).fill('n')];
    const b = [...Array(20).fill('y'), ...Array(5).fill('n'), ...Array(10).fill('y'), ...Array(15).fill('n')];
    expect(cohensKappa(a, b)).toBe(0.4);
  });
  it('kappa bands follow the declared thresholds', () => {
    expect([kappaBand(0.9), kappaBand(0.61), kappaBand(0.5), kappaBand(0.41), kappaBand(0.4), kappaBand(null)]).toEqual(['substantial-or-better', 'substantial-or-better', 'moderate', 'moderate', 'low', 'undefined']);
  });
  it('pooled set kappa: identical sets give 1, disjoint sets are not above 0', () => {
    expect(pooledSetKappa([['kafka'], ['docker']], [['kafka'], ['docker']], techs)).toBe(1);
    expect(pooledSetKappa([['kafka'], ['docker']], [['docker'], ['kafka']], techs)!).toBeLessThanOrEqual(0);
    expect(pooledSetKappa([], [], techs)).toBeNull();
  });
});

describe('SYNTHETIC - NOT REAL EVIDENCE: agreement and consensus', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
  it('perfect agreement: no disagreement, everything in the consensus', () => {
    const a = ids.map((id, i) => L(id, { technologies: i % 2 ? ['kafka'] : [], technologiesUsed: i % 2 ? ['kafka'] : [], areas: ['messaging'] }));
    const ag = agreement(a, a.map((l) => ({ ...l })), areas, techs);
    expect(ag.disagreementRate).toBe(0);
    expect(ag.domain.exactMatch).toBe(1);
    expect(ag.technologies.kappa).toBe(1);
    const c = consensus(a, a);
    expect([c.agreedRows, c.adjudicatedRows, c.unresolvedIds.length]).toEqual([10, 0, 0]);
  });
  it('partial agreement: disagreements are listed, not averaged, and drop out of the consensus', () => {
    const a = ids.map((id) => L(id));
    const b = ids.map((id, i) => L(id, i < 3 ? { domainEngineering: 'NO' } : {}));
    const ag = agreement(a, b, areas, techs);
    expect(ag.disagreementRate).toBe(0.3);
    expect(ag.disagreementIds).toEqual(['r0', 'r1', 'r2']);
    const c = consensus(a, b);
    expect([c.agreedRows, c.unresolvedIds]).toEqual([7, ['r0', 'r1', 'r2']]);
  });
  it('a person-supplied adjudicated label resolves a disagreement', () => {
    const a = [L('r0'), L('r1')];
    const b = [L('r0', { domainEngineering: 'NO' }), L('r1')];
    const c = consensus(a, b, [L('r0', { domainEngineering: 'YES' })]);
    expect([c.agreedRows, c.adjudicatedRows, c.unresolvedIds.length]).toEqual([1, 1, 0]);
  });
  it('complete disagreement: every row differs', () => {
    const a = ids.map((id) => L(id, { domainEngineering: 'YES' }));
    const b = ids.map((id) => L(id, { domainEngineering: 'NO' }));
    expect(agreement(a, b, areas, techs).disagreementRate).toBe(1);
    expect(consensus(a, b).labels).toHaveLength(0);
  });
  it('missing labels: only rows both raters labeled are compared; UNKNOWN-like UNCERTAIN is counted', () => {
    const a = [L('r0'), L('r1', { domainEngineering: 'UNCERTAIN' }), L('r2')];
    const b = [L('r0'), L('r1')];
    const ag = agreement(a, b, areas, techs);
    expect(ag.rowsBoth).toBe(2);
    expect(ag.uncertainDomain).toEqual({ a: 0.5, b: 0, either: 0.5 });
  });
});

describe('SYNTHETIC - NOT REAL EVIDENCE: F1', () => {
  const iv = (rate: number) => ({ rate, rawRate: rate, low: 0, high: 1, n: 10 });
  it('F1 is the harmonic mean; null when a side is undefined; 0 when both are 0', () => {
    expect(f1({ precision: iv(0.8), recall: iv(0.5) })).toEqual({ weighted: 0.6154, raw: 0.6154 });
    expect(f1({ precision: null, recall: iv(0.5) })).toBeNull();
    expect(f1({ precision: iv(0), recall: iv(0) })).toEqual({ weighted: 0, raw: 0 });
  });
});

describe('SYNTHETIC - NOT REAL EVIDENCE: independence guard', () => {
  const rows = Array.from({ length: 30 }, (_, i) => L(`r${i}`, { notes: `n${i}` }));
  it('rejects the same name, model-like names, unnamed raters and identical files', () => {
    expect(independenceProblems('Sam', 'sam', rows, rows.map((l) => ({ ...l, notes: 'x' }))).join()).toMatch(/same name/);
    expect(independenceProblems('Sam', 'Claude assistant', rows, []).join()).toMatch(/model or assistant/);
    expect(independenceProblems('', 'Lee', rows, []).join()).toMatch(/named/);
    expect(independenceProblems('Sam', 'Lee', rows, rows.map((l) => ({ ...l }))).join()).toMatch(/identical/);
  });
  it('accepts two different people with different answers', () => {
    const b = rows.map((l, i) => (i === 0 ? { ...l, notes: 'other' } : { ...l }));
    expect(independenceProblems('Sam', 'Lee', rows, b)).toEqual([]);
  });
});

describe('SYNTHETIC - NOT REAL EVIDENCE: technology definitions are scored separately', () => {
  const preds: Prediction[] = [
    { id: 'r0', domainEngineering: true, predictedUnknown: false, areas: [], technologies: ['docker'], learning: false, weight: 1, stratum: 's' },
    { id: 'r1', domainEngineering: true, predictedUnknown: false, areas: [], technologies: ['kafka'], learning: false, weight: 1, stratum: 's' },
  ];
  // r0 only RUNS in Docker (touches, not about); r1 is about Kafka
  const labels = [L('r0', { technologies: [], technologiesUsed: ['docker'] }), L('r1', { technologies: ['kafka'], technologiesUsed: ['kafka'] })];
  it('"touches" counts the Docker tag as correct, "primarily about" counts it as a false positive', () => {
    const touches = evaluateTaxonomy(projectTechnologies(labels, 'touches'), preds, { labelled: 2, invalid: 0 });
    const primary = evaluateTaxonomy(projectTechnologies(labels, 'primary'), preds, { labelled: 2, invalid: 0 });
    expect(touches.technology.precision?.rawRate).toBe(1);
    expect(primary.technology.precision?.rawRate).toBe(0.5);
    expect(primary.problemCases.filter((p) => p.kind === 'tech-fp').map((p) => p.id)).toEqual(['r0']);
    expect(touches.problemCases.filter((p) => p.kind === 'tech-fp')).toEqual([]);
  });
  it('the touches projection includes the primary technologies', () => {
    expect(projectTechnologies([L('r', { technologies: ['kafka'], technologiesUsed: ['docker'] })], 'touches')[0]!.technologies.sort()).toEqual(['docker', 'kafka']);
  });
});

describe('labeler packages and the real-evidence gate', () => {
  const pkg = 'results/phase6.3.2/labeler-packages';
  it('each package holds exactly a sheet and a guide', () => {
    for (const who of ['A', 'B']) expect(readdirSync(join(pkg, `LABELER_${who}`)).sort()).toEqual(['LABELING-GUIDE.md', 'sheet.csv']);
  });
  it('no package file names the key, predictions, scores, assistant labels, strata or weights', () => {
    for (const who of ['A', 'B']) for (const f of ['LABELING-GUIDE.md', 'sheet.csv']) {
      const t = readFileSync(join(pkg, `LABELER_${who}`, f), 'utf8');
      const guide = f.endsWith('.md');
      if (guide) expect(t).not.toMatch(/sample-key|scores?-|assistant|prediction|predicted|stratum|strata|weight|expected label/i);
      else expect(t.split('\n')[0]).not.toMatch(/stratum|weight|predict|score/i);
    }
  });
  it('the sheet is blind and complete: 237 rows, same ids as the blind sheet, every label cell empty', async () => {
    const { parseCsv } = await import('../src/taxonomy/csv');
    const rows = parseCsv(readFileSync(join(pkg, 'LABELER_A', 'sheet.csv'), 'utf8')).filter((r) => r.length > 1);
    const orig = parseCsv(readFileSync('results/phase6.3.1/labelling/sheet.csv', 'utf8')).filter((r) => r.length > 1);
    expect(rows).toHaveLength(238);
    expect(rows.slice(1).map((r) => r[0])).toEqual(orig.slice(1).map((r) => r[0]));
    expect(rows.slice(1).every((r) => r.slice(8).every((c) => c === ''))).toBe(true);
    expect(readFileSync(join(pkg, 'LABELER_A', 'sheet.csv'), 'utf8')).toBe(readFileSync(join(pkg, 'LABELER_B', 'sheet.csv'), 'utf8'));
  });
  it('the scorer refuses to produce a result from empty or too-small files (exit non-zero, nothing written)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osr-score-'));
    const sheet = readFileSync(join(pkg, 'LABELER_A', 'sheet.csv'), 'utf8');
    writeFileSync(join(dir, 'a.csv'), sheet);
    writeFileSync(join(dir, 'b.csv'), sheet);
    const out = join(dir, 'out.json');
    const r = spawnSync('npx', ['tsx', 'scripts/taxonomy/score-human.ts', '--a', join(dir, 'a.csv'), '--rater-a', 'PersonOne', '--b', join(dir, 'b.csv'), '--rater-b', 'PersonTwo', '--out', out], { encoding: 'utf8', shell: true });
    expect(r.status).toBe(3);
    expect(readdirSync(dir).includes('out.json')).toBe(false);
    const same = spawnSync('npx', ['tsx', 'scripts/taxonomy/score-human.ts', '--a', join(dir, 'a.csv'), '--rater-a', 'Same', '--b', join(dir, 'b.csv'), '--rater-b', 'same', '--out', out], { encoding: 'utf8', shell: true });
    expect(same.status).toBe(2);
  }, 60_000);
  it('no real human score file exists yet (the gate is PENDING)', () => {
    expect(() => readFileSync('results/phase6.3.2/human/scores-human.json', 'utf8')).toThrow();
  });
});
