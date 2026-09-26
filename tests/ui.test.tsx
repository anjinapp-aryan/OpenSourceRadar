import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExplorerView } from '../app/explore/Explorer';
import { ErrorPanel, MoverTable, RepoCard } from '../components/parts';
import {
  ageHours,
  aiRepositories,
  categoryHue,
  categorySummaries,
  radarDots,
  filterRepositories,
  listRepos,
  movers,
  sortRepositories,
  STALE_AFTER_HOURS,
} from '../lib/query';
import { checkRadar, loadRadar, parseRadar, type PublicDataset, type PublicRepository } from '../lib/radar';

function repo(id: string, over: Partial<PublicRepository> = {}): PublicRepository {
  return {
    id,
    fullName: `o/r${id}`,
    url: `https://github.com/o/r${id}`,
    description: 'desc',
    language: 'Python',
    stars: 1000,
    classification: { topLevel: 'AI', categories: ['llm'] },
    growth7d: 10,
    growth30d: 40,
    velocity7d: 1.4,
    velocity30d: 1.3,
    score: 10,
    trend: 'STEADY',
    flags: { rising: false, sustained: false, newEntrant: false, mover: null },
    summary: 'Gained 10 stars in 7 days.',
    growth90d: 100,
    velocity90d: 1.1,
    growthPercent7d: 1,
    priorVelocity: 1,
    accelerationRatio: 1.4,
    velocityDelta: 0.4,
    ageDays: 400,
    explanation: ['+10 stars in 7 days'],
    ...over,
  };
}

const repos = [
  repo('1', { trend: 'RISING', score: 80, growth7d: 900, velocity7d: 128, stars: 5000, flags: { rising: true, sustained: true, newEntrant: false, mover: 'UP' } }),
  repo('2', { trend: 'COOLING', score: 30, growth7d: 300, stars: 90000 }),
  repo('3', { trend: 'STEADY', score: 5, growth7d: null, classification: { topLevel: 'BOTH', categories: ['rag', 'llm'] } }),
  repo('4', { flags: { rising: false, sustained: false, newEntrant: true, mover: null }, ageDays: 5, classification: { topLevel: 'AI', categories: ['rag'] } }),
  repo('5', { classification: { topLevel: 'ENGINEERING', categories: ['java'] }, trend: 'RISING', score: 99 }),
  repo('6', { classification: null }),
];

const data: PublicDataset = {
  schemaVersion: 1,
  momentumVersion: 'v1',
  generatedAt: '2026-09-26T02:52:15.614Z',
  lists: {
    rising: ['1', '5'],
    movers: [],
    moversUp: [{ id: '1', direction: 'UP', velocityDelta: 100, rankDelta: 3 }],
    moversDown: [{ id: '2', direction: 'DOWN', velocityDelta: -50, rankDelta: -3 }],
    sustained: ['1'],
    newEntrants: ['4'],
  },
  repositories: repos,
  categories: [
    { slug: 'llm', name: 'LLM', domain: 'ai' },
    { slug: 'rag', name: 'RAG', domain: 'ai' },
    { slug: 'java', name: 'Java', domain: 'engineering' },
  ],
};

describe('data loading', () => {
  it('parses a valid dataset', () => {
    expect(parseRadar(JSON.stringify(data)).ok).toBe(true);
  });
  it('reports malformed and invalid data instead of throwing', () => {
    expect(parseRadar('{not json')).toEqual({ ok: false, error: 'radar.json is not valid JSON' });
    expect(checkRadar({ ...data, schemaVersion: 2 })).toMatch(/schemaVersion/);
    expect(checkRadar({ ...data, repositories: null })).toMatch(/repositories/);
    expect(checkRadar(null)).toMatch(/object/);
    expect(checkRadar({ ...data, generatedAt: 'x' })).toMatch(/generatedAt/);
    expect(checkRadar({ ...data, lists: { rising: [] } })).toMatch(/lists\./);
  });
  it('reports a missing file', () => {
    const r = loadRadar('does-not-exist/none.json');
    expect(r.ok).toBe(false);
  });
  it('loads the real public dataset when present', () => {
    const r = loadRadar();
    if (r.ok) expect(r.data.repositories.length).toBeGreaterThan(0);
  });
});

describe('AI scope, lists and categories', () => {
  it('AI radar includes AI and BOTH only', () => {
    expect(aiRepositories(data).map((r) => r.id)).toEqual(['1', '2', '3', '4']);
  });
  it('list order is preserved and engineering repositories are dropped', () => {
    expect(listRepos(data, data.lists.rising).map((r) => r.id)).toEqual(['1']);
  });
  it('movers UP and DOWN are separate and AI only', () => {
    expect(movers(data, 'UP', 5).map((m) => m.repo.id)).toEqual(['1']);
    expect(movers(data, 'DOWN', 5).map((m) => m.repo.id)).toEqual(['2']);
  });
  it('category summaries count only AI categories and repositories', () => {
    const s = categorySummaries(data);
    expect(s.map((c) => c.slug)).toEqual(['llm', 'rag']);
    expect(s[0]).toMatchObject({ count: 3, rising: 1 });
    expect(s[1]).toMatchObject({ count: 2, rising: 0, top: [] });
  });
});

describe('filtering and sorting', () => {
  const ai = aiRepositories(data);
  it('filters by trend flag and category', () => {
    expect(filterRepositories(ai, { trend: 'rising' }).map((r) => r.id)).toEqual(['1']);
    expect(filterRepositories(ai, { trend: 'new' }).map((r) => r.id)).toEqual(['4']);
    expect(filterRepositories(ai, { trend: 'sustained' }).map((r) => r.id)).toEqual(['1']);
    expect(filterRepositories(ai, { trend: 'cooling' }).map((r) => r.id)).toEqual(['2']);
    expect(filterRepositories(ai, { category: 'rag' }).map((r) => r.id)).toEqual(['3', '4']);
    expect(filterRepositories(ai, { category: 'nope' })).toEqual([]);
  });
  it('sorts by momentum by default and keeps null growth last, not as zero', () => {
    expect(sortRepositories(ai, 'momentum').map((r) => r.id)[0]).toBe('1');
    expect(sortRepositories(ai, 'growth7d').map((r) => r.id).at(-1)).toBe('3');
    expect(sortRepositories(ai, 'stars').map((r) => r.id)[0]).toBe('2');
  });
  it('is deterministic on ties', () => {
    const a = sortRepositories([repo('9'), repo('8')], 'momentum').map((r) => r.id);
    expect(a).toEqual(['8', '9']);
  });
  it('does not mutate its input', () => {
    const copy = [...ai];
    sortRepositories(ai, 'stars');
    expect(ai).toEqual(copy);
  });
});

describe('components', () => {
  it('RepoCard shows the deterministic summary, metrics and trend as text', () => {
    const html = renderToStaticMarkup(<RepoCard repo={repos[0]!} data={data} />);
    expect(html).toContain('Rising');
    expect(html).toContain('+900');
    expect(html).toContain('80.0');
    expect(html).toContain('Gained 10 stars in 7 days.');
    expect(html).toContain('LLM');
    expect(html).toContain('/repo/o/r1');
  });
  it('RepoCard shows n/a, never 0, for an unmeasured window', () => {
    expect(renderToStaticMarkup(<RepoCard repo={repos[2]!} data={data} />)).toContain('n/a');
  });
  it('MoverTable renders rows and an empty state', () => {
    expect(renderToStaticMarkup(<MoverTable rows={movers(data, 'UP', 3)} direction="UP" />)).toContain('+100/day');
    expect(renderToStaticMarkup(<MoverTable rows={[]} direction="DOWN" />)).toContain('No repositories');
  });
  it('ErrorPanel is an alert with the message', () => {
    const html = renderToStaticMarkup(<ErrorPanel message="radar.json is missing" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('radar.json is missing');
  });
});

describe('explorer view (URL driven)', () => {
  const view = (q: string) => renderToStaticMarkup(<ExplorerView data={{ categories: data.categories, repositories: aiRepositories(data) }} params={new URLSearchParams(q)} />);
  it('defaults to all AI sorted by momentum', () => {
    const html = view('');
    expect(html).toContain('<b class="num">4</b> repositories');
    expect(html.indexOf('o/</span>r1')).toBeLessThan(html.indexOf('o/</span>r2'));
  });
  it('applies category and trend filters from the URL', () => {
    const html = view('category=rag&filter=new');
    expect(html).toContain('<b class="num">1</b> repositories');
    expect(html).toContain('r4');
  });
  it('shows an empty state for a combination with no matches', () => {
    expect(view('category=rag&filter=rising')).toContain('No repositories match');
  });
  it('falls back safely for unknown category, filter, sort and page size', () => {
    const html = view('category=zzz&filter=bogus&sort=bogus&n=-5');
    expect(html).toContain('Unknown category');
    expect(html).toContain('<b class="num">4</b> repositories');
  });
  it('marks the active options with aria-current, not colour alone', () => {
    expect(view('filter=rising&sort=stars')).toContain('aria-current="true"');
  });
  it('paginates with a Show more link that keeps the view', () => {
    const many = Array.from({ length: 40 }, (_, i) => repo(String(100 + i)));
    const html = renderToStaticMarkup(<ExplorerView data={{ categories: data.categories, repositories: many }} params={new URLSearchParams('filter=all')} />);
    expect(html).toContain('Show more (10 left)');
    expect(html).toContain('n=60');
  });
});

describe('freshness', () => {
  it('computes dataset age and flags staleness', () => {
    const h = ageHours('2026-09-26T00:00:00Z', new Date('2026-09-30T00:00:00Z'));
    expect(h).toBe(96);
    expect(h).toBeGreaterThan(STALE_AFTER_HOURS);
  });
});

describe('Phase 5.5 presentation', () => {
  it('sustained cards show the three real windows and mark unmeasurable ones', () => {
    const html = renderToStaticMarkup(<RepoCard repo={{ ...repos[0]!, velocity90d: null }} data={data} variant="sustained" />);
    expect(html).toContain('Sustained');
    expect(html).toContain('7d window');
    expect(html).toContain('not measurable');
  });
  it('new-entrant cards show age', () => {
    expect(renderToStaticMarkup(<RepoCard repo={repos[3]!} data={data} variant="new" />)).toContain('New · 5 days old');
  });
  it('feature cards show rank, previous-vs-now bars and acceleration only from real fields', () => {
    const html = renderToStaticMarkup(<RepoCard repo={repos[0]!} data={data} variant="feature" rank={1} />);
    expect(html).toContain('#01');
    expect(html).toContain('Previous 4 wks');
    expect(html).toContain('Accelerating 1.4');
    expect(renderToStaticMarkup(<RepoCard repo={{ ...repos[0]!, priorVelocity: null, accelerationRatio: null }} data={data} variant="feature" rank={1} />)).not.toContain('Previous 4 wks');
  });
  it('category summaries include sustained counts and hues are deterministic', () => {
    expect(categorySummaries(data)[0]).toMatchObject({ slug: 'llm', sustained: 1 });
    expect(categoryHue('llm')).toBe(categoryHue('llm'));
    expect(categoryHue('llm')).not.toBe(categoryHue('rag'));
  });
  it('radar dots are deterministic, bounded and derived from real repositories', () => {
    const a = radarDots(aiRepositories(data));
    expect(a).toEqual(radarDots(aiRepositories(data)));
    expect(a.every((d) => d.x >= 0 && d.x <= 100 && d.y >= 0 && d.y <= 100)).toBe(true);
    expect(a.find((d) => d.id === '1')?.hot).toBe(true);
  });
});
