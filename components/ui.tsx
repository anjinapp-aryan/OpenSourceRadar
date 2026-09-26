import type { ReactNode } from 'react';

export type IconName = 'flame' | 'bolt' | 'sparkle' | 'radar' | 'layers' | 'trend' | 'check' | 'grid' | 'clock' | 'arrowUp' | 'arrowDown';

const PATHS: Record<IconName, ReactNode> = {
  flame: <path d="M12 2s5 4.5 5 9.5a5 5 0 0 1-10 0c0-1.7.7-3 1.6-4 .3 1.2 1 2 1.9 2C10.2 6.8 10.6 4.4 12 2Zm0 20a3 3 0 0 1-3-3c0-1.6 1.2-2.5 3-4.5 1.8 2 3 2.9 3 4.5a3 3 0 0 1-3 3Z" />,
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />,
  sparkle: <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Zm7 12 .9 3.1L23 18l-3.1.9L19 22l-.9-3.1L15 18l3.1-.9L19 14Z" />,
  radar: <path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2Zm0 5a5 5 0 1 0 5 5h-2a3 3 0 1 1-3-3V7Zm1 4.3 7.5-7.5 1.4 1.4-7.5 7.5A2 2 0 1 1 13 11.3Z" />,
  layers: <path d="m12 2 10 5-10 5L2 7l10-5Zm0 12.5L4.6 10.8 2 12l10 5 10-5-2.6-1.2L12 14.5Zm0 5L4.6 15.8 2 17l10 5 10-5-2.6-1.2L12 19.5Z" />,
  trend: <path d="m3 17 6-6 4 4 8-8v4h2V4h-7v2h4l-7 7-4-4-7.5 7.5L3 17Z" />,
  check: <path d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5L9 16.2Z" />,
  grid: <path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" />,
  clock: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z" />,
  arrowUp: <path d="M12 4 4 13h5v7h6v-7h5L12 4Z" />,
  arrowDown: <path d="m12 20 8-9h-5V4H9v7H4l8 9Z" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Section header: kicker (with icon), title and one-line explanation. */
export function SectionHeader({ id, kicker, icon, color, title, intro }: { id: string; kicker: string; icon: IconName; color: string; title: string; intro?: string }) {
  return (
    <div className="sh">
      <span className="kicker" style={{ ['--kc' as string]: color }}>
        <Icon name={icon} size={16} /> {kicker}
      </span>
      <h2 id={id}>{title}</h2>
      {intro ? <p>{intro}</p> : null}
    </div>
  );
}

/** Horizontal bar. `value` is a fraction 0..1 of the track and is always derived from a real field. */
export function Bar({ value, color = 'var(--steady)' }: { value: number; color?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="track" aria-hidden="true">
      <div className="fill" style={{ ['--w' as string]: `${w.toFixed(1)}%`, ['--fc' as string]: color }} />
    </div>
  );
}

export function MetricCard({ label, value, icon, color, note }: { label: string; value: string; icon: IconName; color: string; note?: string }) {
  return (
    <div className="metric reveal">
      <span className="k" style={{ ['--mc' as string]: color }}>
        <Icon name={icon} size={16} /> {label}
      </span>
      <span className="v num">{value}</span>
      {note ? <span className="n">{note}</span> : null}
    </div>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
      <circle cx="17" cy="17" r="15" fill="none" stroke="#334155" strokeWidth="1.5" />
      <circle cx="17" cy="17" r="9" fill="none" stroke="#334155" strokeWidth="1.5" />
      <path d="M17 17 28 8" stroke="#34f5a0" strokeWidth="2" strokeLinecap="round" />
      <circle cx="17" cy="17" r="2.6" fill="#34f5a0" />
      <circle cx="24.5" cy="21" r="2" fill="#a78bfa" />
    </svg>
  );
}
