import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'How OpenSource Radar computes deterministic momentum signals from GitHub star history.',
  alternates: { canonical: '/methodology/' },
};

export default function Methodology() {
  return (
    <main className="wrap prose">
      <h1>Methodology</h1>
      <p>
        OpenSource Radar measures recent GitHub star growth and combines velocity, relative growth, acceleration and persistence into deterministic momentum
        signals. Momentum is descriptive, not predictive. It does not claim that a repository will succeed, become popular, or be more valuable.
      </p>
      <h2>Signals</h2>
      <ul>
        <li>
          <strong>Growth</strong> over 7, 30 and 90 days, and stars per day (velocity). &quot;n/a&quot; means not measurable, never zero.
        </li>
        <li>
          <strong>Relative growth</strong>: growth as a share of the star count, counted only when absolute growth is meaningful.
        </li>
        <li>
          <strong>Acceleration</strong>: last 7 days compared with the 28 days before.
        </li>
        <li>
          <strong>Persistence</strong>: whether several windows each show meaningful growth (Sustained).
        </li>
      </ul>
      <h2>Labels</h2>
      <ul>
        <li>
          <strong>↑ Rising</strong>: high score, high recent velocity and growth, and not fading.
        </li>
        <li>
          <strong>↓ Cooling</strong>: recent velocity has dropped clearly below the previous weeks.
        </li>
        <li>
          <strong>→ Steady</strong>: everything else.
        </li>
        <li>
          <strong>New entrant</strong>: recently created with meaningful growth. Newness alone is not momentum.
        </li>
      </ul>
      <h2>Limits</h2>
      <ul>
        <li>Stars can be inflated by promotion or non-organic activity; the score does not try to detect that.</li>
        <li>The score is a ranking aid, not a quality judgement. Lifetime stars are context only.</li>
        <li>Categories come from rules over GitHub topics, names and descriptions, and can be wrong.</li>
        <li>No LLM is involved in scoring, classification or explanations.</li>
      </ul>
      <p>
        Full details are in the project documentation (MOMENTUM.md, CLASSIFICATION.md, TRACKING.md). <Link href="/">Back to the radar</Link>.
      </p>
    </main>
  );
}
