'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'AI Radar', match: (p: string) => p === '/' },
  { href: '/explore/', label: 'Explore', match: (p: string) => p.startsWith('/explore') || p.startsWith('/repo') },
  { href: '/methodology/', label: 'Methodology', match: (p: string) => p.startsWith('/methodology') },
];

/** The only client piece of the shell: marks the current section. Everything else is server-rendered. */
export default function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.slice(0, 1).map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
      <span className="soon" aria-disabled="true">
        Engineering <span className="tag">Coming soon</span>
      </span>
      {LINKS.slice(1).map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
