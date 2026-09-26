/**
 * Public base URL for canonical links, sitemap and robots.
 * Order: NEXT_PUBLIC_SITE_URL (explicit) > Vercel's production domain (set automatically at build time) > localhost.
 * No secret is involved; both variables are public by nature.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}
