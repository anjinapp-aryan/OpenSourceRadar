import type { MetadataRoute } from 'next';
import { loadRadar } from '../lib/radar';
import { aiRepositories } from '../lib/query';

export const dynamic = 'force-static';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const res = loadRadar();
  const lastModified = res.ok ? new Date(res.data.generatedAt) : undefined;
  const pages = ['/', '/explore/', '/methodology/'].map((p) => ({ url: `${SITE}${p}`, lastModified }));
  const repos = res.ok ? aiRepositories(res.data).map((r) => ({ url: `${SITE}/repo/${r.fullName}/`, lastModified })) : [];
  return [...pages, ...repos];
}
