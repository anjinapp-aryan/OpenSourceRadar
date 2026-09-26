'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { PublicDataset, PublicRepository } from '../../lib/radar';
import { filterRepositories, isSortKey, isTrendFilter, SORTS, sortRepositories, TREND_FILTERS } from '../../lib/query';
import { EmptyState, RepoCard } from '../../components/parts';

const PAGE = 30;

export type ExplorerData = Pick<PublicDataset, 'categories'> & { repositories: PublicRepository[] };

function href(p: { category: string | null; filter: string; sort: string; n?: number }): string {
  const q = new URLSearchParams();
  if (p.category) q.set('category', p.category);
  if (p.filter !== 'all') q.set('filter', p.filter);
  if (p.sort !== 'momentum') q.set('sort', p.sort);
  if (p.n && p.n > PAGE) q.set('n', String(p.n));
  const s = q.toString();
  return `/explore/${s ? `?${s}` : ''}`;
}

/** Everything is derived from the URL, so a view is shareable and survives a refresh. Unknown values fall back to defaults. */
export function ExplorerView({ data, params }: { data: ExplorerData; params: URLSearchParams }) {
  const aiCats = (data.categories ?? []).filter((c) => c.domain === 'ai');
  const catParam = params.get('category');
  const category = aiCats.some((c) => c.slug === catParam) ? catParam : null;
  const unknownCategory = catParam !== null && category === null;
  const f = params.get('filter');
  const filter = isTrendFilter(f) ? f : 'all';
  const s = params.get('sort');
  const sort = isSortKey(s) ? s : 'momentum';
  const nRaw = Number(params.get('n'));
  const n = Number.isFinite(nRaw) && nRaw >= PAGE ? Math.min(Math.floor(nRaw), 2000) : PAGE;

  const rows = sortRepositories(filterRepositories(data.repositories, { category, trend: filter }), sort);
  const shown = rows.slice(0, n);

  return (
    <>
      {unknownCategory ? (
        <p className="warn" role="status">
          Unknown category &quot;{catParam}&quot;. Showing all AI repositories.
        </p>
      ) : null}
      <nav aria-label="Filter by trend" className="filters">
        {TREND_FILTERS.map((t) => (
          <Link key={t.key} href={href({ category, filter: t.key, sort })} className="pill" aria-current={filter === t.key ? 'true' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter by category" className="filters">
        <Link href={href({ category: null, filter, sort })} className="pill" aria-current={category === null ? 'true' : undefined}>
          All AI
        </Link>
        {aiCats.map((c) => (
          <Link key={c.slug} href={href({ category: c.slug, filter, sort })} className="pill" aria-current={category === c.slug ? 'true' : undefined}>
            {c.name}
          </Link>
        ))}
      </nav>
      <nav aria-label="Sort" className="filters">
        <span className="muted small">Sort by</span>
        {SORTS.map((o) => (
          <Link key={o.key} href={href({ category, filter, sort: o.key })} className="pill" aria-current={sort === o.key ? 'true' : undefined}>
            {o.label}
          </Link>
        ))}
      </nav>
      <p className="muted" role="status">
        {rows.length.toLocaleString('en-US')} repositories
      </p>
      {shown.length === 0 ? (
        <EmptyState>No repositories match this combination.</EmptyState>
      ) : (
        <div className="grid">
          {shown.map((r) => (
            <RepoCard key={r.id} repo={r} data={data} showAge={filter === 'new'} />
          ))}
        </div>
      )}
      {rows.length > shown.length ? (
        <p>
          <Link className="pill" href={href({ category, filter, sort, n: n + PAGE })}>
            Show more ({rows.length - shown.length} left)
          </Link>
        </p>
      ) : null}
    </>
  );
}

function FromUrl({ data }: { data: ExplorerData }) {
  return <ExplorerView data={data} params={useSearchParams()} />;
}

export default function Explorer({ data }: { data: ExplorerData }) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <FromUrl data={data} />
    </Suspense>
  );
}
