import type { PublicRepository } from '../lib/radar';
import { classifyPattern, type PatternConfig } from '../src/explain/pattern';
import { historyEvidence } from '../src/explain/historyEvidence';
import { renderWhy, whyHeading } from '../src/explain/render';
import { TrendBadge } from './parts';

/**
 * "Why this is rising": pattern, evidence and ranking status kept apart. The pattern is the one stored in the public
 * dataset; for older datasets without it, it is recomputed from the record's own fields by the same function.
 */
export default function WhyPanel({ repo, cfg, gains }: { repo: PublicRepository; cfg: PatternConfig; gains?: readonly number[] | null }) {
  const pattern = repo.pattern ?? classifyPattern(repo, cfg);
  const why = renderWhy(repo, pattern, cfg);
  // Evidence over time, only from the published daily history and only when the series supports it.
  const over = gains && gains.length > 0 ? historyEvidence(gains) : null;
  return (
    <section className="panel" aria-labelledby="why">
      <h2 id="why">{whyHeading(repo.trend)}</h2>
      <p className="why-head">
        <span className={`badge pat-${pattern.toLowerCase()}`}>{why.headline}</span> <TrendBadge trend={repo.trend} />
      </p>
      <ul className="why-lines">
        {why.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {over && over.lines.length > 0 ? (
        <>
          <h3 className="why-sub">Over time</h3>
          <ul className="why-lines">
            {over.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
      {why.note ? <p className="note">{why.note}</p> : null}
      {repo.lifecycle === 'STALE' ? (
        <p className="note warn" role="status">
          This repository&apos;s data is overdue for refresh; the figures may be out of date.
        </p>
      ) : null}
      <p className="note">Pattern and evidence are computed from measured star growth by fixed rules. No AI-written text, no outside facts.</p>
    </section>
  );
}
