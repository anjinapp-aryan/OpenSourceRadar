'use client';

import { useState } from 'react';
import { trajectoryFor, type HistoryEntry, type WindowDays } from '../src/history';

const WINDOWS: WindowDays[] = [7, 30, 90];
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Daily stars gained, drawn from the public history file. It answers one question: is growth speeding up or fading?
 * Honest states: no entry, a series shorter than a repository's age, and a repository younger than the window are each
 * stated in words; missing days are never drawn as zero. Plain SVG, no chart library.
 */
export default function Trajectory({ entry, ageDays, name }: { entry: HistoryEntry | null; ageDays: number; name: string }) {
  const [win, setWin] = useState<WindowDays>(90);
  const t = trajectoryFor(entry ?? undefined, ageDays, win);

  let body;
  if (t.kind === 'missing') {
    body = <p className="note">No daily history is available for this repository.</p>;
  } else if (t.kind === 'insufficient') {
    body = (
      <p className="note" role="status">
        Insufficient history: {t.have} of {t.need} days available. No trajectory is drawn rather than guessing the missing days.
      </p>
    );
  } else {
    const { gains, end } = t;
    const total = gains.reduce((a, b) => a + b, 0);
    const max = Math.max(...gains, 1);
    const peakIndex = gains.indexOf(Math.max(...gains));
    const peakDate = addDays(end, -(gains.length - 1 - peakIndex));
    const W = 300;
    const H = 84;
    const slot = W / gains.length;
    const bw = Math.max(1, slot - (gains.length > 45 ? 0.8 : 1.6));
    body = (
      <>
        <svg viewBox={`0 0 ${W} ${H}`} className="traj-svg" role="img" aria-label={`Stars gained per day for ${name}, last ${gains.length} days: total ${fmt(total)}, average ${fmt(total / gains.length)} per day, peak ${fmt(max)} on ${peakDate}`} preserveAspectRatio="none">
          <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} className="traj-base" />
          {gains.map((g, i) => {
            const h = g === 0 ? 0 : Math.max(1.5, (g / max) * (H - 4));
            const last = i === gains.length - 1;
            return <rect key={i} x={i * slot + (slot - bw) / 2} y={H - h} width={bw} height={h} className={last ? 'traj-bar traj-today' : 'traj-bar'} />;
          })}
        </svg>
        <p className="traj-sum num">
          <b>+{fmt(total)}</b> stars · {fmt(total / gains.length)}/day average · peak {fmt(max)} on {peakDate}
        </p>
        <p className="note">
          Last bar is {end} (a partial day).{t.young ? ` Repository is ${Math.floor(ageDays)} days old: all ${gains.length} days of its life are shown.` : ''}
        </p>
      </>
    );
  }

  return (
    <div className="traj">
      <div className="seg" role="group" aria-label="Trajectory window">
        {WINDOWS.map((w) => (
          <button key={w} type="button" className="pill" aria-pressed={win === w} onClick={() => setWin(w)}>
            {w} days
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}
