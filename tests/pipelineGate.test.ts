import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkProductionPage, formatReportMarkdown, metricsOf, runGate, structuralProblems, type GateConfig } from '../src/pipeline/gate';

const cfg = (JSON.parse(readFileSync('config/pipeline.json', 'utf8')) as { gate: GateConfig }).gate;
const NOW = new Date('2026-09-26T12:00:00Z');

function repo(i: number, over: Record<string, unknown> = {}) {
  return {
    id: String(i),
    fullName: `o/r${i}`,
    url: `https://github.com/o/r${i}`,
    description: 'd',
    language: 'Go',
    stars: 1000 + i,
    classification: { topLevel: i % 2 === 0 ? 'AI' : 'ENGINEERING', categories: ['llm'] },
    growth7d: 10,
    growth30d: 40,
    growth90d: 90,
    velocity7d: 1,
    velocity30d: 1,
    velocity90d: 1,
    priorVelocity: 1,
    growthPercent7d: 1,
    accelerationRatio: 1,
    velocityDelta: 0,
    score: 10,
    trend: i % 10 === 0 ? 'RISING' : 'STEADY',
    flags: { rising: false, sustained: false, newEntrant: false, mover: null },
    summary: 's',
    explanation: [],
    ageDays: 100,
    ...over,
  };
}
function dataset(n: number, over: Record<string, unknown> = {}, tracked?: [number, number]) {
  const repositories = Array.from({ length: n }, (_, i) => repo(i + 1));
  const ids = repositories.map((r) => r.id);
  return {
    schemaVersion: 1,
    momentumVersion: 'v1',
    generatedAt: '2026-09-26T06:00:00Z',
    lists: {
      rising: repositories.filter((r) => r.trend === 'RISING').map((r) => r.id),
      movers: [],
      moversUp: [],
      moversDown: [],
      sustained: ids.slice(0, 3),
      newEntrants: ids.slice(0, 2),
    },
    repositories,
    categories: [{ slug: 'llm', name: 'LLM', domain: 'ai' }],
    stats: { tracked: tracked?.[0] ?? n, measured: tracked?.[1] ?? n, unassessed: 0 },
    ...over,
  };
}
const small: GateConfig = { ...cfg, minRepositories: 10, minAiRepositories: 3 };
const run = (c: unknown, p: unknown = null, bytes = 1000) => runGate(c, p, small, { now: NOW, bytes });

describe('gate: scenario 1, valid data', () => {
  it('passes a valid dataset with and without a previous one', () => {
    expect(run(dataset(100)).level).toBe('OK');
    expect(run(dataset(100), dataset(100)).level).toBe('OK');
  });
  it('normal daily change is OK, not a failure', () => {
    expect(run(dataset(103), dataset(100)).level).toBe('OK');
  });
});

describe('gate: scenario 2, malformed data', () => {
  it('rejects non-objects, wrong schema, empty and missing arrays', () => {
    expect(run(null).level).toBe('FAIL');
    expect(run('x').level).toBe('FAIL');
    expect(run(dataset(100, { schemaVersion: 2 })).level).toBe('FAIL');
    expect(run(dataset(100, { repositories: [] })).level).toBe('FAIL');
    expect(run({ ...dataset(100), repositories: null }).level).toBe('FAIL');
    expect(run(dataset(100, { generatedAt: 'nope' })).level).toBe('FAIL');
    expect(run(dataset(100, { generatedAt: '2030-01-01T00:00:00Z' })).structuralProblems.join()).toMatch(/future/);
  });
  it('rejects duplicate ids, bad urls, negative stars, non-numeric values, bad trend and unknown category', () => {
    const d = dataset(100) as any;
    d.repositories[1].id = d.repositories[0].id;
    d.repositories[2].url = 'http://evil.example/x';
    d.repositories[3].stars = -5;
    d.repositories[4].velocity7d = 'NaN';
    d.repositories[5].trend = 'SOARING';
    d.repositories[6].classification = { topLevel: 'AI', categories: ['nope'] };
    d.repositories[7].score = 140;
    d.repositories[8].growth7d = 99_999_999;
    const p = structuralProblems(d, small, NOW).join('\n');
    for (const m of ['duplicate id', 'malformed url', 'stars must be', 'velocity7d', 'invalid trend', 'unknown category', 'score outside', 'exceeds total stars']) expect(p).toContain(m);
  });
  it('rejects lists that reference unknown ids and insane stats', () => {
    const d = dataset(100) as any;
    d.lists.rising = ['does-not-exist'];
    d.stats = { tracked: 10, measured: 50, unassessed: 0 };
    const p = structuralProblems(d, small, NOW).join('\n');
    expect(p).toContain('unknown id');
    expect(p).toContain('stats');
  });
});

describe('gate: scenario 3 and 6, coverage collapse and partial collection', () => {
  it('fails when repositories, tracked, measured or AI drop sharply', () => {
    expect(run(dataset(50), dataset(100)).level).toBe('FAIL');
    expect(run(dataset(100, {}, [100, 40]), dataset(100)).level).toBe('FAIL');
    const r = run(dataset(100, {}, [30, 30]), dataset(100));
    expect(r.structuralProblems.join()).toMatch(/tracked dropped/);
  });
  it('fails when measured coverage share collapses even if counts look fine', () => {
    const r = run(dataset(100, {}, [100, 85]), dataset(100, {}, [100, 100]));
    expect(r.level).toBe('FAIL');
  });
  it('warns on a moderate drop', () => {
    expect(run(dataset(94), dataset(100)).level).toBe('WARNING');
  });
  it('fails when Rising disappears, unless the previous run had almost none', () => {
    const none = dataset(100) as any;
    none.repositories.forEach((x: any) => (x.trend = 'STEADY'));
    none.lists.rising = [];
    expect(run(none, dataset(100)).structuralProblems.join()).toMatch(/Rising fell/);
    const prevFew = dataset(100) as any;
    prevFew.repositories.forEach((x: any, i: number) => (x.trend = i < 2 ? 'RISING' : 'STEADY'));
    expect(run(none, prevFew).structuralProblems.join()).not.toMatch(/Rising fell/);
  });
  it('enforces absolute floors and the size limit', () => {
    expect(run(dataset(5)).level).toBe('FAIL');
    expect(run(dataset(100), null, cfg.maxPublicBytes + 1).level).toBe('FAIL');
    expect(run(dataset(100), null, cfg.warnPublicBytes + 1).level).toBe('WARNING');
  });
});

describe('gate: report and metrics', () => {
  it('reports metrics, deltas and a readable table', () => {
    const r = run(dataset(100), dataset(90));
    expect(metricsOf(dataset(100)).repositories).toBe(100);
    expect(r.deltas.find((d) => d.name === 'repositories')).toMatchObject({ previous: 90, current: 100, delta: 10 });
    expect(formatReportMarkdown(r)).toContain('| repositories | 90 | 100 | 10 |');
  });
  it('the shipped public dataset passes the real thresholds against itself', () => {
    const real = JSON.parse(readFileSync('data/public/radar.json', 'utf8'));
    expect(runGate(real, real, cfg, { now: new Date() }).level).toBe('OK');
  });
});

describe('production smoke checks', () => {
  const base = 'https://x.example';
  const page = (extra = '') => `<link rel="canonical" href="${base}/explore/"/><h1>T</h1>${extra}`;
  it('accepts a correct page and rejects localhost, tokens and wrong canonicals', () => {
    expect(checkProductionPage('explore', page(), base)).toEqual([]);
    expect(checkProductionPage('explore', page('http://localhost:3000/'), base).join()).toMatch(/localhost/);
    expect(checkProductionPage('explore', page('ghp_' + 'A'.repeat(30)), base).join()).toMatch(/token/);
    expect(checkProductionPage('home', '<link rel="canonical" href="http://localhost:3000/"/><h1>', base).length).toBeGreaterThan(0);
  });
  it('checks robots, sitemap and repo content', () => {
    expect(checkProductionPage('robots', `Sitemap: ${base}/sitemap.xml`, base)).toEqual([]);
    expect(checkProductionPage('robots', 'Sitemap: http://localhost:3000/sitemap.xml', base).length).toBeGreaterThan(0);
    expect(checkProductionPage('sitemap', `<loc>${base}/</loc>`, base)).toEqual([]);
    expect(checkProductionPage('repo', page('vectorize-io/hindsight'), base, { repo: 'vectorize-io/hindsight' })).toEqual([]);
    expect(checkProductionPage('repo', page(), base, { repo: 'a/b' }).join()).toMatch(/does not mention/);
  });
});
