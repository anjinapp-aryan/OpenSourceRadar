import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRadar } from '../../../../lib/radar';
import { aiRepositories, categoryName, fmtAge, fmtNum, fmtRate, fmtSigned } from '../../../../lib/query';
import { ErrorPanel, TrendBadge } from '../../../../components/parts';

export const dynamicParams = false;

export function generateStaticParams(): { owner: string; name: string }[] {
  const res = loadRadar();
  if (!res.ok) return [{ owner: '_', name: '_' }];
  return aiRepositories(res.data).map((r) => {
    const [owner, name] = r.fullName.split('/');
    return { owner: owner as string, name: name as string };
  });
}

function find(owner: string, name: string) {
  const res = loadRadar();
  if (!res.ok) return { res, repo: undefined };
  const full = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`.toLowerCase();
  return { res, repo: aiRepositories(res.data).find((r) => r.fullName.toLowerCase() === full) };
}

export async function generateMetadata({ params }: { params: Promise<{ owner: string; name: string }> }): Promise<Metadata> {
  const { owner, name } = await params;
  const { repo } = find(owner, name);
  if (!repo) return { title: 'Repository not found', robots: { index: false } };
  return {
    title: repo.fullName,
    description: repo.summary,
    alternates: { canonical: `/repo/${repo.fullName}/` },
  };
}

export default async function RepoPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const { res, repo } = find(owner, name);
  if (!res.ok) return <ErrorPanel message={res.error} />;
  if (!repo) notFound();
  const d = res.data;
  const cats = repo.classification?.categories ?? [];
  const rows: [string, string][] = [
    ['Total stars', fmtNum(repo.stars)],
    ['7d growth', fmtSigned(repo.growth7d)],
    ['30d growth', fmtSigned(repo.growth30d)],
    ['90d growth', fmtSigned(repo.growth90d)],
    ['Stars/day (7d)', fmtRate(repo.velocity7d)],
    ['Stars/day (30d)', fmtRate(repo.velocity30d)],
    ['Stars/day (90d)', fmtRate(repo.velocity90d)],
    ['Previous stars/day (4 weeks before)', fmtRate(repo.priorVelocity)],
    ['Acceleration (7d / previous)', repo.accelerationRatio === null ? 'n/a' : `${repo.accelerationRatio.toFixed(2)}x`],
    ['Momentum score', repo.score === null ? 'n/a' : repo.score.toFixed(1)],
    ['Repository age', fmtAge(repo.ageDays)],
    ['Tracking tier', repo.tier ?? 'n/a'],
  ];
  return (
    <main className="wrap">
      <p className="small">
        <Link href="/explore/">← Explore</Link>
      </p>
      <h1>{repo.fullName}</h1>
      <p>
        <TrendBadge trend={repo.trend} /> {repo.flags.sustained ? <span className="badge">Sustained</span> : null}{' '}
        {repo.flags.newEntrant ? <span className="badge">New entrant</span> : null}
      </p>
      {repo.description ? <p className="lead">{repo.description}</p> : null}
      <p>
        <a href={repo.url} rel="noopener noreferrer">
          View on GitHub ↗
        </a>
        {repo.language ? <span className="muted"> · {repo.language}</span> : null}
      </p>
      {cats.length > 0 ? (
        <p className="cats">
          {cats.map((c) => (
            <Link key={c} className="chip" href={`/explore/?category=${c}`}>
              {categoryName(d, c)}
            </Link>
          ))}
        </p>
      ) : null}

      <section aria-labelledby="why" className="section">
        <h2 id="why">Why it&apos;s here</h2>
        <p>{repo.summary}</p>
        <ul>
          {repo.explanation.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ev" className="section">
        <h2 id="ev">Evidence</h2>
        <dl className="evidence">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">
          No star-history chart: the public dataset carries summary growth windows, not the daily series. &quot;n/a&quot; means the window could not be measured
          (for example, the repository is younger than the window), which is different from zero growth.
        </p>
      </section>
    </main>
  );
}
