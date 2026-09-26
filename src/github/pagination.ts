export interface LinkRels {
  next?: number;
  prev?: number;
  first?: number;
  last?: number;
}

/**
 * Parse an RFC 5988 Link header into page numbers per rel.
 * Ignores entries that carry no `page` query parameter.
 */
export function parseLinkHeader(header: string | null): LinkRels {
  const rels: LinkRels = {};
  if (!header) return rels;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="(\w+)"/);
    if (!match) continue;
    const [, url, rel] = match;
    if (!url || !rel) continue;
    let page: number | null = null;
    try {
      const value = new URL(url).searchParams.get('page');
      page = value === null ? null : Number(value);
    } catch {
      page = null;
    }
    if (page === null || !Number.isInteger(page) || page < 1) continue;
    if (rel === 'next' || rel === 'prev' || rel === 'first' || rel === 'last') rels[rel] = page;
  }
  return rels;
}
