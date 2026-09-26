import Link from 'next/link';
import { loadRadar } from '../lib/radar';
import { ageHours, aiRepositories, categorySummaries, fmtDate, fmtNum, listRepos, movers, radarDots, STALE_AFTER_HOURS } from '../lib/query';
import { CategoryCard, EmptyState, ErrorPanel, MoverList, RepoCard } from '../components/parts';
import { Icon, MetricCard, SectionHeader } from '../components/ui';
import RadarVisual from '../components/RadarVisual';

export default function Home() {
  const res = loadRadar();
  if (!res.ok) return <ErrorPanel message={res.error} />;
  const d = res.data;
  const ai = aiRepositories(d);
  const rising = listRepos(d, d.lists.rising, 6);
  const risingCount = ai.filter((r) => r.trend === 'RISING').length;
  const sustained = listRepos(d, d.lists.sustained, 6);
  const fresh = listRepos(d, d.lists.newEntrants, 6);
  const newCount = ai.filter((r) => r.flags.newEntrant).length;
  const cats = categorySummaries(d);
  const stale = ageHours(d.generatedAt, new Date()) > STALE_AFTER_HOURS;

  return (
    <main className="wrap">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow">AI Radar · live signals</p>
          <h1 id="hero-title">
            What&apos;s rising
            <br />
            <span>in open source?</span>
          </h1>
          <p className="lead">Track meaningful momentum across open-source repositories using transparent, deterministic signals.</p>
          <p className="fresh">
            Updated {fmtDate(d.generatedAt)}
            {stale ? <strong className="warn"> · data is more than {STALE_AFTER_HOURS} hours old</strong> : null}
          </p>
        </div>
        <RadarVisual dots={radarDots(ai)} />
      </section>

      <section aria-label="Summary" className="metrics">
        {d.stats ? (
          <>
            <MetricCard label="Tracked" value={fmtNum(d.stats.tracked)} icon="layers" color="var(--text-3)" />
            <MetricCard label="Measured" value={fmtNum(d.stats.measured)} icon="check" color="var(--steady)" note={d.stats.unassessed > 0 ? `${d.stats.unassessed} not yet assessed` : undefined} />
          </>
        ) : null}
        <MetricCard label="AI repositories" value={fmtNum(ai.length)} icon="grid" color="var(--ai)" />
        <MetricCard label="Rising" value={fmtNum(risingCount)} icon="flame" color="var(--rising)" />
        <MetricCard label="New entrants" value={fmtNum(newCount)} icon="sparkle" color="var(--new)" />
        <MetricCard label="Categories" value={String(cats.length)} icon="radar" color="var(--ai)" />
      </section>

      <section aria-labelledby="rising" className="section">
        <SectionHeader id="rising" kicker="Rising now" icon="flame" color="var(--rising)" title="Repositories showing strong, non-fading growth" intro="Ranked by momentum score, not by total stars. Each card shows the evidence behind its place." />
        {rising.length === 0 ? (
          <EmptyState>No AI repository currently meets the Rising criteria.</EmptyState>
        ) : (
          <div className="grid">
            {rising.map((r, i) => (
              <RepoCard key={r.id} repo={r} data={d} variant="feature" rank={i + 1} index={i} />
            ))}
          </div>
        )}
        <p className="more">
          <Link className="linkbtn" href="/explore/?filter=rising">
            All {risingCount} rising AI repositories <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <section aria-labelledby="movers" className="section">
        <SectionHeader id="movers" kicker="Biggest movers" icon="trend" color="var(--steady)" title="Who is speeding up, and who is cooling" intro="Change in stars per day over the last 7 days compared with the previous four weeks. This measures change in velocity, not most stars." />
        <div className="grid two">
          <div className="mv up">
            <h3>
              <Icon name="arrowUp" size={20} /> Accelerating
            </h3>
            <MoverList rows={movers(d, 'UP', 6)} direction="UP" />
          </div>
          <div className="mv down">
            <h3>
              <Icon name="arrowDown" size={20} /> Cooling
            </h3>
            <MoverList rows={movers(d, 'DOWN', 6)} direction="DOWN" />
          </div>
        </div>
      </section>

      <section aria-labelledby="sustained" className="section">
        <SectionHeader id="sustained" kicker="Sustained momentum" icon="bolt" color="var(--sustained)" title="Growth that persists across windows" intro="Repositories maintaining meaningful growth across multiple observed windows. Persistence so far, not a forecast." />
        {sustained.length === 0 ? (
          <EmptyState>No AI repository currently qualifies.</EmptyState>
        ) : (
          <div className="grid">
            {sustained.map((r, i) => (
              <RepoCard key={r.id} repo={r} data={d} variant="sustained" index={i} />
            ))}
          </div>
        )}
        <p className="more">
          <Link className="linkbtn" href="/explore/?filter=sustained">
            All sustained AI repositories <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <section aria-labelledby="new" className="section">
        <SectionHeader id="new" kicker="New entrants" icon="sparkle" color="var(--new)" title="Fresh repositories worth a look" intro="Recently created repositories with meaningful activity. New is not the same as rising: each is Rising or Steady by the same rules as everything else." />
        {fresh.length === 0 ? (
          <EmptyState>No new entrants.</EmptyState>
        ) : (
          <div className="grid">
            {fresh.map((r, i) => (
              <RepoCard key={r.id} repo={r} data={d} variant="new" index={i} />
            ))}
          </div>
        )}
        <p className="more">
          <Link className="linkbtn" href="/explore/?filter=new">
            All new AI entrants <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <section aria-labelledby="categories" className="section">
        <SectionHeader id="categories" kicker="Categories" icon="grid" color="var(--ai)" title="Where AI momentum is" intro="Repository counts are for the whole category; a repository can belong to more than one." />
        <ul className="catgrid">
          {cats.map((c, i) => (
            <CategoryCard key={c.slug} c={c} index={i} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="section">
        <SectionHeader id="how" kicker="Transparency" icon="check" color="var(--rising)" title="How to read this" />
        <div className="panel">
          <p>
            OpenSource Radar measures recent GitHub star growth and combines velocity, relative growth, acceleration and persistence into deterministic momentum
            signals. <strong>Momentum is descriptive, not predictive.</strong> It does not claim that a repository will succeed, become popular, or be more valuable.
          </p>
          <p className="more">
            <Link className="linkbtn" href="/methodology/">
              Read the methodology <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
