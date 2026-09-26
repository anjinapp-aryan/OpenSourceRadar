/**
 * Allowed difference between the star count from repository metadata and the sum
 * of star-history buckets. They are fetched at different moments (and GitHub's
 * aggregate may differ by a star or two for deleted/suspended accounts), so a
 * strict equality would reject real data.
 *
 * ASSUMPTION (not a GitHub guarantee): max(2, 0.1% of stars). Evidence so far:
 * 5 of 6 live repositories matched exactly; 1 differed by +1 (145,406 vs 145,405)
 * with metadata fetched about a minute before the history. Revisit once a
 * 500-1,000 repository run gives a real distribution.
 */
export function starDriftTolerance(stars: number): number {
  return Math.max(2, Math.ceil(stars * 0.001));
}
