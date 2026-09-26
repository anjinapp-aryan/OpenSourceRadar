import type { MetadataRoute } from 'next';
import { loadRadar } from '../lib/radar';
import { siteUrl } from '../lib/site';
import { aiRepositories } from '../lib/query';

export const dynamic = 'force-static';

const SITE = siteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  const res = loadRadar();
  const lastModified = res.ok ? new Date(res.data.generatedAt) : undefined;
  const pages = ['/', '/explore/', '/methodology/'].map((p) => ({ url: `${SITE}${p}`, lastModified }));
  const repos = res.ok ? aiRepositories(res.data).map((r) => ({ url: `${SITE}/repo/${r.fullName}/`, lastModified })) : [];
  return [...pages, ...repos];
}
