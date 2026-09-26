import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap">
      <h1>Not found</h1>
      <p>That page or repository is not in the AI Radar dataset.</p>
      <p>
        <Link href="/">Back to the radar</Link> · <Link href="/explore/">Explore</Link>
      </p>
    </main>
  );
}
