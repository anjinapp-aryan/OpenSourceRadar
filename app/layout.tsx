import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "OpenSource Radar — What's Rising in Open Source?", template: '%s · OpenSource Radar' },
  description: 'Track meaningful momentum across AI repositories using transparent, deterministic GitHub star-growth signals.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'OpenSource Radar',
    title: "OpenSource Radar — What's Rising in Open Source?",
    description: 'Transparent, deterministic momentum signals for AI repositories on GitHub.',
    url: '/',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="top">
          <div className="wrap bar">
            <Link href="/" className="brand">
              OpenSource Radar
            </Link>
            <nav aria-label="Main">
              <Link href="/explore/">Explore</Link>
              <Link href="/methodology/">Methodology</Link>
            </nav>
          </div>
        </header>
        <div id="main">{children}</div>
        <footer className="foot">
          <div className="wrap">
            <p>Momentum is descriptive, not predictive. Data: GitHub star history, computed by deterministic rules. No LLM, no tracking.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
