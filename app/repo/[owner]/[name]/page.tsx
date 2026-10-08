import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRadar } from '../../../../lib/radar';
import { aiRepositories, fmtAge, fmtNum, fmtRate, fmtSigned } from '../../../../lib/query';
import { CategoryChips, ErrorPanel, TrendBadge } from '../../../../components/parts';
import { Bar, Icon } from '../../../../components/ui';
import Trajectory from '../../../../components/Trajectory';
import WhyPanel from '../../../../components/WhyPanel';
import { loadHistory, loadPatternConfig } from '../../../../lib/history';

export const dynamicParams = false;

/**
 * Scale experiment only (docs/PHASE-6.2.1-SCALE-AUDIT.md): RADAR_SYNTHETIC_PAGES=N adds N extra pages under /repo/_synthetic/
 * that render a copy of the first real repository. Never set in production; the build-output audit in radar.yml fails on any
 * `_synthetic` path, so a leak cannot ship.
 */
const SYNTHETIC_OWNER = '_synthetic';
function syntheticCount(): number {
  const n = Number(process.env.RADAR_SYNTHETIC_PAGES ?? 0);
  return Number.isInteger(n) && n > 0 && n <= 20_000 ? n : 0;
}

export function generateStaticParams(): { owner: string; name: string }[] {
  const res = loadRadar();
  if (!res.ok) return [{ owner: '_', name: '_' }];
  const real = aiRepositories(res.data).map((r) => {
    const [owner, name] = r.fullName.split('/');
    return { owner: owner as string, name: name as string };
  });
  const extra = Array.from({ length: syntheticCount() }, (_, i) => ({ owner: SYNTHETIC_OWNER, name: `page-${i + 1}` }));
  return [...real, ...extra];
}

function find(owner: string, name: string) {
  const res = loadRadar();
  if (!res.ok) return { res, repo: undefined };
  if (owner === SYNTHETIC_OWNER && syntheticCount() > 0) return { res, repo: aiRepositories(res.data)[0] };
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
  const [ownerName, repoName] = repo.fullName.split('/');
  const kpis: [string, string, string][] = [
    ['Total stars', fmtNum(repo.stars), ''],
    ['7d growth', fmtSigned(repo.growth7d), 'var(--rising)'],
    ['30d growth', fmtSigned(repo.growth30d), ''],
    ['90d growth', fmtSigned(repo.growth90d), ''],
    ['Stars / day (7d)', fmtRate(repo.velocity7d), ''],
    ['Momentum', repo.score === null ? 'n/a' : repo.score.toFixed(1), 'var(--rising)'],
  ];
  const pMax = Math.max(repo.velocity7d ?? 0, repo.priorVelocity ?? 0, 0.0001);
  const wins = [
    ['7 days', repo.velocity7d],
    ['30 days', repo.velocity30d],
    ['90 days', repo.velocity90d],
  ] as const;
  const wMax = Math.max(...wins.map((w) => w[1] ?? 0), 0.0001);
  return (
    <main className="wrap">
      <header className="repo-hero">
        <p className="crumb">
          <Link href="/explore/">Explore</Link> / {ownerName}
        </p>
        <h1>
          <span className="owner">{ownerName}/</span>
          {repoName}
        </h1>
        <div className="row">
          <TrendBadge trend={repo.trend} />
          {repo.flags.sustained ? (
            <span className="badge b-sustained">
              <Icon name="bolt" size={14} /> Sustained
            </span>
          ) : null}
          {repo.flags.newEntrant ? (
            <span className="badge b-new">
              <Icon name="sparkle" size={14} /> New entrant
            </span>
          ) : null}
          {repo.language ? <span className="tag">{repo.language}</span> : null}
        </div>
        {repo.description ? <p className="lead">{repo.description}</p> : null}
        <CategoryChips repo={repo} data={d} limit={6} />
        <p className="more">
          <a className="linkbtn" href={repo.url} rel="noopener noreferrer">
            View on GitHub <span aria-hidden="true">↗</span>
          </a>
        </p>
      </header>

      <section aria-label="Key numbers" className="kpis">
        {kpis.map(([k, v, c]) => (
          <div className="metric reveal" key={k}>
            <span className="k">{k}</span>
            <span className="v num" style={c ? { color: c } : undefined}>
              {v}
            </span>
          </div>
        ))}
      </section>

      <section className="section panel" aria-labelledby="traj">
        <h2 id="traj">Daily stars: is growth speeding up?</h2>
        <Trajectory entry={loadHistory()?.repositories[repo.id] ?? null} ageDays={repo.ageDays} name={repo.fullName} />
      </section>

      <div className="section two-col">
        <WhyPanel repo={repo} cfg={loadPatternConfig()} gains={loadHistory()?.repositories[repo.id]?.g ?? null} />

        <section className="panel" aria-labelledby="sig">
          <h2 id="sig">Signals</h2>
          <div className="cmp" role="group" aria-label="Stars per day by window">
            {wins.map(([k, v]) => (
              <div className="cmp-row" key={k}>
                <span>{k}</span>
                {v === null ? <span className="note">not measurable</span> : <Bar value={v / wMax} color="var(--sustained)" />}
                <span className="v num">{v === null ? 'n/a' : `${fmtRate(v)}/d`}</span>
              </div>
            ))}
          </div>
          {repo.priorVelocity !== null ? (
            <div className="cmp" style={{ marginTop: 16 }} role="group" aria-label="Previous four weeks versus last 7 days">
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
          <div className="sig" style={{ marginTop: 16 }}>
            <div className="row2">
              <span>Acceleration (7d vs previous)</span>
              <b className="num">{repo.accelerationRatio === null ? 'n/a' : `${repo.accelerationRatio.toFixed(2)}×`}</b>
            </div>
            <div className="row2">
              <span>Persistence</span>
              <b>{repo.flags.sustained ? 'Sustained' : 'Not sustained'}</b>
            </div>
            <div className="row2">
              <span>Repository age</span>
              <b className="num">{fmtAge(repo.ageDays)}</b>
            </div>
            <div className="row2">
              <span>Tracking tier</span>
              <b>{repo.tier ?? 'n/a'}</b>
            </div>
          </div>
        </section>
      </div>

      <p className="note">
        &quot;n/a&quot; means the window could not be measured (for example the repository is younger than the window), which is different from zero growth. The
        daily bars come from the public 90-day history file; days that were not measured are never drawn as zero. <Link href="/methodology/">How momentum is computed</Link>.
      </p>
    </main>
  );
}
