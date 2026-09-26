/**
 * Normalized repository state at one moment. See docs/DATA-MODEL.md.
 * All timestamps are ISO-8601 UTC strings.
 */
export interface RepositorySnapshot {
  /** GitHub numeric database id as a string. Stable across renames. Same value from REST `id` and GraphQL `databaseId`. */
  repositoryId: string;
  owner: string;
  name: string;
  /** `owner/name` at collection time. */
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  /** GraphQL source: open issues only. REST source: open issues + open PRs (GitHub's `open_issues_count`). See `source`. */
  openIssues: number;
  language: string | null;
  topics: string[];
  /** SPDX id, e.g. "MIT". null when none. May be "NOASSERTION". */
  license: string | null;
  createdAt: string;
  updatedAt: string;
  collectedAt: string;

  /** Where this snapshot came from; decides how `openIssues` is counted. */
  source?: 'graphql' | 'rest';
  pushedAt?: string | null;
  defaultBranch?: string | null;
  /** Committed date of the default-branch head commit (GraphQL only). */
  lastCommitAt?: string | null;
  /** Commits on the default branch in the requested window (GraphQL, only when requested). */
  commitsInWindow?: number | null;
  isArchived?: boolean;
  isFork?: boolean;
}

export interface RepositoryRef {
  owner: string;
  name: string;
}

export function refToString(ref: RepositoryRef): string {
  return `${ref.owner}/${ref.name}`;
}
