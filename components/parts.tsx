import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PublicDataset, PublicRepository } from '../lib/radar';
import { categoryName, fmtAge, fmtNum, fmtRate, fmtSigned, repoPath, TREND_TEXT, type MoverRow } from '../lib/query';

/** Trend is always text plus an arrow, never colour alone. */
export function TrendBadge({ trend }: { trend: string }) {
  const t = TREND_TEXT[trend] ?? { arrow: '', label: trend };
  return (
    <span className={`badge trend-${trend.toLowerCase()}`}>
      <span aria-hidden="true">{t.arrow}</span> {t.label}
    </span>
  );
}

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="section">
      <h2 id={id}>{title}</h2>
      {intro ? <p className="muted">{intro}</p> : null}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="empty" role="status">
      {children}
    </p>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <main className="wrap">
      <div className="error" role="alert">
        <h1>Data unavailable</h1>
        <p>{message}</p>
        <p className="muted">The site is generated from a static dataset. Regenerate it and rebuild.</p>
      </div>
    </main>
  );
}

export function RepoCard({ repo, data, showAge = false }: { repo: PublicRepository; data: Pick<PublicDataset, 'categories'>; showAge?: boolean }) {
  const cats = repo.classification?.categories ?? [];
  const [owner, name] = repo.fullName.split('/');
  return (
    <article className="card">
      <header>
        <h3>
          <Link href={repoPath(repo.fullName)}>
            <span className="owner">{owner}/</span>
            {name}
          </Link>
        </h3>
        <TrendBadge trend={repo.trend} />
      </header>
      {repo.description ? <p className="desc">{repo.description}</p> : null}
      <dl className="stats">
        <div>
          <dt>Stars</dt>
          <dd>{fmtNum(repo.stars)}</dd>
        </div>
        <div>
          <dt>7d growth</dt>
          <dd>{fmtSigned(repo.growth7d)}</dd>
        </div>
        <div>
          <dt>Stars/day</dt>
          <dd>{fmtRate(repo.velocity7d)}</dd>
        </div>
        <div>
          <dt>Momentum</dt>
          <dd>{repo.score === null ? 'n/a' : repo.score.toFixed(1)}</dd>
        </div>
        {showAge ? (
          <div>
            <dt>Age</dt>
            <dd>{fmtAge(repo.ageDays)}</dd>
          </div>
        ) : null}
      </dl>
      {cats.length > 0 ? (
        <p className="cats">
          {cats.map((c) => (
            <Link key={c} className="chip" href={`/explore/?category=${c}`}>
              {categoryName(data, c)}
            </Link>
          ))}
        </p>
      ) : null}
      <p className="why">{repo.summary}</p>
    </article>
  );
}

export function MoverTable({ rows, direction }: { rows: MoverRow[]; direction: 'UP' | 'DOWN' }) {
  if (rows.length === 0) return <EmptyState>No repositories in this list.</EmptyState>;
  return (
    <div className="tablewrap">
      <table>
        <caption className="sr">{direction === 'UP' ? 'Velocity increased' : 'Velocity decreased'} versus the previous four weeks</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col" className="num">
              Stars/day (7d)
            </th>
            <th scope="col" className="num">
              Change vs previous
            </th>
            <th scope="col" className="num">
              7d growth
            </th>
            <th scope="col">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ repo, velocityDelta }) => (
            <tr key={repo.id}>
              <th scope="row">
                <Link href={repoPath(repo.fullName)}>{repo.fullName}</Link>
              </th>
              <td className="num">{fmtRate(repo.velocity7d)}</td>
              <td className="num">
                {direction === 'UP' ? '↑' : '↓'} {fmtSigned(Math.round(velocityDelta))}/day
              </td>
              <td className="num">{fmtSigned(repo.growth7d)}</td>
              <td>
                <TrendBadge trend={repo.trend} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
