import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import NavLinks from '../components/NavLinks';
import { BrandMark } from '../components/ui';

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
    <html lang="en" data-theme="dark">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="top">
          <div className="wrap bar">
            <Link href="/" className="brand" aria-label="OpenSource Radar, home">
              <BrandMark />
              <span className="brand-text">
                OpenSource
                <small>RADAR</small>
              </span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <div id="main" tabIndex={-1}>
          {children}
        </div>
        <footer className="foot">
          <div className="wrap">
            <p>OpenSource Radar. Momentum is descriptive, not predictive. Data: GitHub star history, scored by deterministic rules. No LLM, no tracking.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
