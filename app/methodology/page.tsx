import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '../../components/ui';

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'How OpenSource Radar computes deterministic momentum signals from GitHub star history.',
  alternates: { canonical: '/methodology/' },
};

const PIPELINE = [
  ['Discovery', 'GitHub Search finds candidate repositories from configured queries. Discovery only proposes candidates; it never decides what a repository is.'],
  ['Classification', 'Deterministic rules over GitHub topics, name and description assign categories (14 AI, 19 engineering). Categories can be wrong, and never influence the momentum score.'],
  ['Tracking', 'Each repository is assigned a refresh tier (HOT, WARM, DORMANT) from its measured growth, which decides how often it is re-collected. Tracking never depends on category.'],
  ['Star history', 'Weekly star buckets from GitHub are converted to daily gains and validated. Growth over 7, 30 and 90 days is computed. A window that cannot be measured is shown as n/a, never as zero.'],
  ['Momentum', 'Velocity, relative growth, acceleration and persistence are combined with fixed weights into a score. All inputs and thresholds are visible in the project configuration.'],
];

export default function Methodology() {
  return (
    <main className="wrap prose">
      <header className="page-head">
        <p className="eyebrow">Methodology</p>
        <h1>How the radar works</h1>
        <p className="lead">Every number on this site comes from measured GitHub star growth and fixed rules. No LLM, no hidden ranking.</p>
      </header>

      <p className="banner" role="note">
        <strong>Descriptive, not predictive.</strong> Momentum describes recent growth. It does not claim that a repository will succeed, become popular, or be more
        valuable, and it is not advice.
      </p>

      <h2>The pipeline</h2>
      <ol className="steps">
        {PIPELINE.map(([t, p]) => (
          <li key={t}>
            <div>
              <h3>{t}</h3>
              <p>{p}</p>
            </div>
          </li>
        ))}
      </ol>

      <h2 style={{ marginTop: 40 }}>Signals</h2>
      <div className="defs">
        <div className="panel">
          <h3>Velocity</h3>
          <p>Stars gained per day over the last 7, 30 and 90 days.</p>
        </div>
        <div className="panel">
          <h3>Relative growth</h3>
          <p>Growth as a share of the star count, counted only when absolute growth is meaningful, so tiny repositories do not dominate.</p>
        </div>
        <div className="panel">
          <h3>Acceleration</h3>
          <p>The last 7 days compared with the 28 days before them.</p>
        </div>
        <div className="panel">
          <h3>Persistence</h3>
          <p>Whether several windows each show meaningful growth.</p>
        </div>
      </div>

      <h2 style={{ marginTop: 40 }}>Labels</h2>
      <div className="defs">
        <div className="panel">
          <h3 style={{ color: 'var(--rising)' }}>↑ Rising</h3>
          <p>High momentum score, strong recent velocity and growth, and not fading against the previous weeks.</p>
        </div>
        <div className="panel">
          <h3 style={{ color: 'var(--cooling)' }}>↓ Cooling</h3>
          <p>Recent velocity has dropped clearly below the previous weeks.</p>
        </div>
        <div className="panel">
          <h3 style={{ color: 'var(--steady)' }}>→ Steady</h3>
          <p>Everything else.</p>
        </div>
        <div className="panel">
          <h3 style={{ color: 'var(--sustained)' }}>
            <Icon name="bolt" size={18} /> Sustained
          </h3>
          <p>Meaningful growth in every observed window, including the 30-day one.</p>
        </div>
        <div className="panel">
          <h3 style={{ color: 'var(--new)' }}>
            <Icon name="sparkle" size={18} /> New entrant
          </h3>
          <p>Recently created with meaningful growth. Newness alone is not momentum: a new repository can be Rising or Steady.</p>
        </div>
      </div>

      <h2 style={{ marginTop: 40 }}>Limits</h2>
      <ul className="panel" style={{ paddingLeft: '2.2em', display: 'grid', gap: 8, color: 'var(--text-2)' }}>
        <li>Stars can be inflated by promotion or non-organic activity; the score does not try to detect that.</li>
        <li>The score is a ranking aid, not a quality judgement. Lifetime stars are context only.</li>
        <li>Educational or list-style repositories can rank when they gain stars quickly.</li>
        <li>Daily history is published for AI repositories only, for the last 90 days. A repository younger than the window shows its whole life; where history is missing it says so instead of drawing zeros.</li>
        <li>Patterns such as &quot;Concentrated spike&quot; or &quot;Breakout&quot; describe the shape of recent growth. They are neutral labels, not judgements about how the stars were earned.</li>
      </ul>

      <p className="more">
        <Link className="linkbtn" href="/">
          Back to the radar <span aria-hidden="true">→</span>
        </Link>
      </p>
    </main>
  );
}
