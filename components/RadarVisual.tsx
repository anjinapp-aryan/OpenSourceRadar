import type { RadarDot } from '../lib/query';

/**
 * Decorative radar. Blips are real repositories (angle from a hash of the id, distance from the momentum score),
 * so it is data-shaped, but it carries no readable information and is hidden from assistive technology.
 * Pure SVG + CSS animation; the sweep stops under prefers-reduced-motion.
 */
export default function RadarVisual({ dots }: { dots: RadarDot[] }) {
  return (
    <div className="radar" aria-hidden="true">
      <svg viewBox="0 0 100 100" focusable="false">
        <defs>
          <linearGradient id="sweepg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#34f5a0" stopOpacity="0" />
            <stop offset="1" stopColor="#34f5a0" stopOpacity="0.38" />
          </linearGradient>
        </defs>
        {[46, 34.5, 23, 11.5].map((r) => (
          <circle key={r} className="ring" cx="50" cy="50" r={r} />
        ))}
        <line className="axis" x1="4" y1="50" x2="96" y2="50" />
        <line className="axis" x1="50" y1="4" x2="50" y2="96" />
        <g className="sweep">
          <path d="M50 50 L96 50 A46 46 0 0 0 89.7 26.9 Z" fill="url(#sweepg)" transform="rotate(-30 50 50)" />
          <line x1="50" y1="50" x2="96" y2="50" stroke="#34f5a0" strokeWidth="0.6" opacity="0.8" />
        </g>
        {dots.map((d, i) => (
          <circle key={d.id} className={d.hot ? 'dot' : 'dot dim'} cx={d.x} cy={d.y} r={d.hot ? 1.5 : 1.0} style={{ ['--d' as string]: `${(i % 9) * 0.5}s` }} />
        ))}
        <circle cx="50" cy="50" r="1.6" fill="#f3f4f6" />
      </svg>
    </div>
  );
}
