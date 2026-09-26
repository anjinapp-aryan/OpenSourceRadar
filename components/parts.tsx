import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PublicDataset, PublicRepository } from '../lib/radar';
import {
  categoryHue,
  categoryName,
  fmtAge,
  fmtNum,
  fmtRate,
  fmtSigned,
  repoPath,
  TREND_TEXT,
  type CategorySummary,
  type MoverRow,
} from '../lib/query';
import { Bar, Icon } from './ui';

/** Trend is always an arrow plus a word, never colour alone. */
export function TrendBadge({ trend }: { trend: string }) {
  const t = TREND_TEXT[trend] ?? { arrow: '', label: trend };
  return (
    <span className={`badge trend-${trend.toLowerCase()}`}>
      <span aria-hidden="true">{t.arrow}</span> {t.label}
    </span>
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
        <p className="note">The site is generated from a static dataset. Regenerate it and rebuild.</p>
      </div>
    </main>
  );
}

export type CardVariant = 'default' | 'feature' | 'sustained' | 'new';
type Cats = Pick<PublicDataset, 'categories'>;

export function CategoryChips({ repo, data, limit = 3 }: { repo: PublicRepository; data: Cats; limit?: number }) {
  const cats = (repo.classification?.categories ?? []).slice(0, limit);
  if (cats.length === 0) return null;
  return (
    <p className="cats">
      {cats.map((c) => (
        <Link key={c} className="chip" style={{ ['--h' as string]: categoryHue(c) }} href={`/explore/?category=${c}`}>
          {categoryName(data, c)}
        </Link>
      ))}
    </p>
  );
}

function kClass(repo: PublicRepository, variant: CardVariant): string {
  if (variant === 'sustained') return 'k-sustained';
  if (variant === 'new') return 'k-new';
  return `k-${repo.trend.toLowerCase()}`;
}

function ageLabel(days: number): string {
  if (days < 1) return 'today';
  const d = Math.floor(days);
  return `${d} day${d === 1 ? '' : 's'} old`;
}

export function RepoCard({
  repo,
  data,
  variant = 'default',
  rank,
  index = 0,
  showAge = false,
}: {
  repo: PublicRepository;
  data: Cats;
  variant?: CardVariant;
  rank?: number;
  index?: number;
  showAge?: boolean;
}) {
  const [owner, name] = repo.fullName.split('/');
  const feature = variant === 'feature';
  const score = repo.score ?? 0;
  const windows = [
    { k: '7d', v: repo.velocity7d },
    { k: '30d', v: repo.velocity30d },
    { k: '90d', v: repo.velocity90d },
  ];
  const wMax = Math.max(...windows.map((w) => w.v ?? 0), 0.0001);
  const pMax = Math.max(repo.velocity7d ?? 0, repo.priorVelocity ?? 0, 0.0001);

  return (
    <article className={`card reveal ${kClass(repo, variant)}${feature ? ' feature' : ''}`} style={{ ['--i' as string]: `${Math.min(index, 8) * 0.05}s` }}>
      <div className="card-top">
        {feature && rank !== undefined ? (
          <span className="rank">
            <Icon name="flame" size={16} /> #{String(rank).padStart(2, '0')}
          </span>
        ) : variant === 'sustained' ? (
          <span className="badge b-sustained">
            <Icon name="bolt" size={14} /> Sustained
          </span>
        ) : variant === 'new' ? (
          <span className="badge b-new">
            <Icon name="sparkle" size={14} /> New · {ageLabel(repo.ageDays)}
          </span>
        ) : (
          <span className="rank">{showAge ? `${fmtAge(repo.ageDays)} old` : (repo.language ?? '')}</span>
        )}
        <TrendBadge trend={repo.trend} />
      </div>

      <h3>
        <Link href={repoPath(repo.fullName)}>
          <span className="owner">{owner}/</span>
          {name}
        </Link>
      </h3>
      {repo.description ? <p className="desc">{repo.description}</p> : null}

      <dl className="figs">
        <div className="fig">
          <dt className="fl">stars in 7 days</dt>
          <dd className={`fv num${(repo.growth7d ?? 0) > 0 ? ' pos' : ''}`}>{fmtSigned(repo.growth7d)}</dd>
        </div>
        <div className="fig">
          <dt className="fl">stars / day</dt>
          <dd className="fv num">{fmtRate(repo.velocity7d)}</dd>
        </div>
        <div className="fig">
          <dt className="fl">total stars</dt>
          <dd className="fv num">{fmtNum(repo.stars)}</dd>
        </div>
        <div className="fig">
          <dt className="fl">momentum</dt>
          <dd className="fv num">{repo.score === null ? 'n/a' : repo.score.toFixed(1)}</dd>
        </div>
      </dl>

      <div className="bar-row">
        <div className="bar-head">
          <span>Momentum</span>
          <b className="num">{repo.score === null ? 'n/a' : `${repo.score.toFixed(1)} / 100`}</b>
        </div>
        <Bar value={score / 100} color={variant === 'sustained' ? 'var(--sustained)' : variant === 'new' ? 'var(--new)' : repo.trend === 'COOLING' ? 'var(--cooling)' : repo.trend === 'RISING' ? 'var(--rising)' : 'var(--steady)'} />
      </div>

      {feature && repo.priorVelocity !== null ? (
        <div className="cmp" role="group" aria-label="Stars per day, previous four weeks versus last 7 days">
          <div className="cmp-row">
            <span>Previous 4 wks</span>
            <Bar value={repo.priorVelocity / pMax} color="var(--text-3)" />
            <span className="v num">{fmtRate(repo.priorVelocity)}/d</span>
          </div>
          <div className="cmp-row">
            <span>Last 7 days</span>
            <Bar value={(repo.velocity7d ?? 0) / pMax} color="var(--rising)" />
            <span className="v num">{fmtRate(repo.velocity7d)}/d</span>
          </div>
        </div>
      ) : null}

      {variant === 'sustained' ? (
        <div className="cmp" role="group" aria-label="Stars per day in each window">
          {windows.map((w) => (
            <div className="cmp-row" key={w.k}>
              <span>{w.k} window</span>
              {w.v === null ? <span className="note">not measurable</span> : <Bar value={w.v / wMax} color="var(--sustained)" />}
              <span className="v num">{w.v === null ? 'n/a' : `${fmtRate(w.v)}/d`}</span>
            </div>
          ))}
        </div>
      ) : null}

      <CategoryChips repo={repo} data={data} />

      <p className="why">
        {repo.accelerationRatio !== null && repo.trend === 'RISING' ? (
          <>
            <b>Accelerating {repo.accelerationRatio.toFixed(1)}×</b> vs previous weeks.{' '}
          </>
        ) : null}
        {repo.summary}
      </p>
    </article>
  );
}

/** Ranked list of velocity changes, one direction only. */
export function MoverList({ rows, direction }: { rows: MoverRow[]; direction: 'UP' | 'DOWN' }) {
  if (rows.length === 0) return <EmptyState>No repositories in this list.</EmptyState>;
  return (
    <ol aria-label={direction === 'UP' ? 'Accelerating repositories' : 'Cooling repositories'}>
      {rows.map(({ repo, velocityDelta }) => (
        <li key={repo.id}>
          <Link href={repoPath(repo.fullName)}>
            <span className="arrow" aria-hidden="true">
              {direction === 'UP' ? '↑' : '↓'}
            </span>
            <span className="nm">
              {repo.fullName}
              <small className="num">
                {fmtRate(repo.velocity7d)} stars/day now · {fmtSigned(repo.growth7d)} in 7d
              </small>
            </span>
            <span className="delta num">
              {fmtSigned(Math.round(velocityDelta))}/day
              <small>vs previous weeks</small>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
export { MoverList as MoverTable };

export function CategoryCard({ c, index = 0 }: { c: CategorySummary; index?: number }) {
  return (
    <li className="catcard reveal" style={{ ['--h' as string]: categoryHue(c.slug), ['--i' as string]: `${Math.min(index, 10) * 0.04}s` }}>
      <h3>
        <Link href={`/explore/?category=${c.slug}`}>{c.name}</Link>
      </h3>
      <p className="big num">
        {fmtNum(c.count)} <span className="muted-sm">repositories</span>
      </p>
      <p className="subs num">
        <span>
          <b>{c.rising}</b> rising
        </span>
        <span>
          <b>{c.sustained}</b> sustained
        </span>
      </p>
    </li>
  );
}
