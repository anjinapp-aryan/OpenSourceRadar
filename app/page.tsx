import Link from 'next/link';
import { loadRadar } from '../lib/radar';
import { ageHours, aiRepositories, categorySummaries, fmtDate, fmtNum, listRepos, movers, repoPath, STALE_AFTER_HOURS } from '../lib/query';
import { EmptyState, ErrorPanel, MoverTable, RepoCard, Section } from '../components/parts';

export default function Home() {
  const res = loadRadar();
  if (!res.ok) return <ErrorPanel message={res.error} />;
  const d = res.data;
  const ai = aiRepositories(d);
  const rising = listRepos(d, d.lists.rising, 9);
  const risingCount = ai.filter((r) => r.trend === 'RISING').length;
  const sustained = listRepos(d, d.lists.sustained, 6);
  const fresh = listRepos(d, d.lists.newEntrants, 6);
  const newCount = ai.filter((r) => r.flags.newEntrant).length;
  const cats = categorySummaries(d);
  const stale = ageHours(d.generatedAt, new Date()) > STALE_AFTER_HOURS;

  return (
    <main className="wrap">
      <section className="hero" aria-labelledby="h">
        <p className="eyebrow">AI Radar</p>
        <h1 id="h">What&apos;s rising in open source?</h1>
        <p className="lead">Track meaningful momentum across AI repositories using transparent, deterministic signals.</p>
        <p className="muted small">
          Updated {fmtDate(d.generatedAt)}
          {stale ? <strong className="warn"> · Data is more than {STALE_AFTER_HOURS} hours old</strong> : null}
        </p>
      </section>

      <section aria-label="Summary" className="metrics">
        {d.stats ? (
          <>
            <div>
              <span className="k">Tracked</span>
              <span className="v">{fmtNum(d.stats.tracked)}</span>
            </div>
            <div>
              <span className="k">Measured</span>
              <span className="v">{fmtNum(d.stats.measured)}</span>
            </div>
          </>
        ) : null}
        <div>
          <span className="k">AI repositories</span>
          <span className="v">{fmtNum(ai.length)}</span>
        </div>
        <div>
          <span className="k">Rising</span>
          <span className="v">{fmtNum(risingCount)}</span>
        </div>
        <div>
          <span className="k">New entrants</span>
          <span className="v">{fmtNum(newCount)}</span>
        </div>
        <div>
          <span className="k">Categories</span>
          <span className="v">{cats.length}</span>
        </div>
      </section>

      <Section id="rising" title="Rising now" intro="Repositories with strong, current and not-fading growth. Ranked by momentum score, not by total stars.">
        {rising.length === 0 ? (
          <EmptyState>No AI repository currently meets the Rising criteria.</EmptyState>
        ) : (
          <div className="grid">
            {rising.map((r) => (
              <RepoCard key={r.id} repo={r} data={d} />
            ))}
          </div>
        )}
        <p>
          <Link href="/explore/?filter=rising">All {risingCount} rising AI repositories →</Link>
        </p>
      </Section>

      <Section id="movers" title="Biggest movers" intro="Change in stars per day (last 7 days) compared with the previous four weeks. This is change in velocity, not most stars.">
        <div className="two">
          <div>
            <h3>Speeding up ↑</h3>
            <MoverTable rows={movers(d, 'UP', 8)} direction="UP" />
          </div>
          <div>
            <h3>Slowing down ↓</h3>
            <MoverTable rows={movers(d, 'DOWN', 8)} direction="DOWN" />
          </div>
        </div>
      </Section>

      <Section id="sustained" title="Sustained momentum" intro="Repositories maintaining meaningful growth across multiple observed windows. Persistence so far, not a forecast.">
        {sustained.length === 0 ? (
          <EmptyState>No AI repository currently qualifies.</EmptyState>
        ) : (
          <div className="grid">
            {sustained.map((r) => (
              <RepoCard key={r.id} repo={r} data={d} />
            ))}
          </div>
        )}
        <p>
          <Link href="/explore/?filter=sustained">All sustained AI repositories →</Link>
        </p>
      </Section>

      <Section id="new" title="New entrants" intro="Recently created repositories with meaningful activity. New is not the same as rising: each one below is Rising or Steady by the same rules as everything else.">
        {fresh.length === 0 ? (
          <EmptyState>No new entrants.</EmptyState>
        ) : (
          <div className="grid">
            {fresh.map((r) => (
              <RepoCard key={r.id} repo={r} data={d} showAge />
            ))}
          </div>
        )}
        <p>
          <Link href="/explore/?filter=new">All new AI entrants →</Link>
        </p>
      </Section>

      <Section id="categories" title="AI categories">
        <ul className="catgrid">
          {cats.map((c) => (
            <li key={c.slug} className="catcard">
              <h3>
                <Link href={`/explore/?category=${c.slug}`}>{c.name}</Link>
              </h3>
              <p className="muted small">
                {fmtNum(c.count)} repositories · {c.rising} rising
              </p>
              {c.top.length > 0 ? (
                <ol className="small">
                  {c.top.map((r) => (
                    <li key={r.id}>
                      <Link href={repoPath(r.fullName)}>{r.fullName}</Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted small">None rising now.</p>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="how" title="How to read this">
        <p>
          OpenSource Radar measures recent GitHub star growth and combines velocity, relative growth, acceleration and persistence into deterministic momentum
          signals. Momentum is descriptive, not predictive. It does not claim that a repository will succeed, become popular, or be more valuable.{' '}
          <Link href="/methodology/">Read the methodology</Link>.
        </p>
      </Section>
    </main>
  );
}
