import type { Metadata } from 'next';
import { loadRadar } from '../../lib/radar';
import { aiRepositories } from '../../lib/query';
import { ErrorPanel } from '../../components/parts';
import Explorer from './Explorer';

export const metadata: Metadata = {
  title: 'Explore AI repositories',
  description: 'Filter AI repositories by category and momentum trend, sorted by momentum, growth or stars per day.',
  alternates: { canonical: '/explore/' },
};

export default function ExplorePage() {
  const res = loadRadar();
  if (!res.ok) return <ErrorPanel message={res.error} />;
  const d = res.data;
  // Only what the cards need: no explanation lines, shorter descriptions, to keep the page payload small.
  const repositories = aiRepositories(d).map((r) => ({
    ...r,
    explanation: [],
    description: r.description && r.description.length > 100 ? `${r.description.slice(0, 97)}...` : r.description,
  }));
  return (
    <main className="wrap">
      <header className="page-head">
        <p className="eyebrow">Explore</p>
        <h1>Explore open source</h1>
        <p className="lead">Choose a momentum state, a category and a sort order. The address bar always reflects the current view, so you can share it.</p>
      </header>
      <Explorer data={{ categories: d.categories, repositories }} />
    </main>
  );
}
