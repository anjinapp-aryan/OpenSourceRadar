import { InvalidResponseError } from './errors';
import type { RepositorySnapshot } from '../model/repositorySnapshot';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reqString(o: Obj, key: string, ctx: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new InvalidResponseError(`${ctx}: field "${key}" missing or not a string`);
  return v;
}

function reqNumber(o: Obj, key: string, ctx: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InvalidResponseError(`${ctx}: field "${key}" missing or not a number`);
  return v;
}

function optString(o: Obj, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

/** GraphQL `Repository` node (see GraphQLRepositoryProvider fragment) -> snapshot. */
export function normalizeGraphQLRepository(node: unknown, collectedAt: string): RepositorySnapshot {
  const ctx = 'graphql repository';
  if (!isObj(node)) throw new InvalidResponseError(`${ctx}: node is not an object`);
  const owner = isObj(node.owner) ? reqString(node.owner, 'login', `${ctx}.owner`) : null;
  if (!owner) throw new InvalidResponseError(`${ctx}: owner.login missing`);
  const name = reqString(node, 'name', ctx);
  const issues = isObj(node.issues) ? reqNumber(node.issues, 'totalCount', `${ctx}.issues`) : null;
  if (issues === null) throw new InvalidResponseError(`${ctx}: issues.totalCount missing`);

  const topicNodes = isObj(node.repositoryTopics) && Array.isArray(node.repositoryTopics.nodes) ? node.repositoryTopics.nodes : [];
  const topics: string[] = [];
  for (const t of topicNodes) {
    if (isObj(t) && isObj(t.topic) && typeof t.topic.name === 'string') topics.push(t.topic.name);
  }

  const branch = isObj(node.defaultBranchRef) ? node.defaultBranchRef : null;
  const target = branch && isObj(branch.target) ? branch.target : null;
  const history = target && isObj(target.history) ? target.history : null;

  const snapshot: RepositorySnapshot = {
    repositoryId: String(reqNumber(node, 'databaseId', ctx)),
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: reqString(node, 'url', ctx),
    description: optString(node, 'description'),
    stars: reqNumber(node, 'stargazerCount', ctx),
    forks: reqNumber(node, 'forkCount', ctx),
    openIssues: issues,
    language: isObj(node.primaryLanguage) ? optString(node.primaryLanguage, 'name') : null,
    topics,
    license: isObj(node.licenseInfo) ? optString(node.licenseInfo, 'spdxId') : null,
    createdAt: reqString(node, 'createdAt', ctx),
    updatedAt: reqString(node, 'updatedAt', ctx),
    collectedAt,
    source: 'graphql',
    pushedAt: optString(node, 'pushedAt'),
    defaultBranch: branch ? optString(branch, 'name') : null,
    lastCommitAt: target ? optString(target, 'committedDate') : null,
    isArchived: typeof node.isArchived === 'boolean' ? node.isArchived : undefined,
    isFork: typeof node.isFork === 'boolean' ? node.isFork : undefined,
  };
  if (history && typeof history.totalCount === 'number') snapshot.commitsInWindow = history.totalCount;
  return snapshot;
}

/** REST repository object (from /repos or /search/repositories) -> snapshot. */
export function normalizeRestRepository(item: unknown, collectedAt: string): RepositorySnapshot {
  const ctx = 'rest repository';
  if (!isObj(item)) throw new InvalidResponseError(`${ctx}: item is not an object`);
  const owner = isObj(item.owner) ? reqString(item.owner, 'login', `${ctx}.owner`) : null;
  if (!owner) throw new InvalidResponseError(`${ctx}: owner.login missing`);
  const name = reqString(item, 'name', ctx);
  const license = isObj(item.license) ? optString(item.license, 'spdx_id') : null;
  const topics = Array.isArray(item.topics) ? item.topics.filter((t): t is string => typeof t === 'string') : [];

  return {
    repositoryId: String(reqNumber(item, 'id', ctx)),
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: reqString(item, 'html_url', ctx),
    description: optString(item, 'description'),
    stars: reqNumber(item, 'stargazers_count', ctx),
    forks: reqNumber(item, 'forks_count', ctx),
    openIssues: reqNumber(item, 'open_issues_count', ctx),
    language: optString(item, 'language'),
    topics,
    license,
    createdAt: reqString(item, 'created_at', ctx),
    updatedAt: reqString(item, 'updated_at', ctx),
    collectedAt,
    source: 'rest',
    pushedAt: optString(item, 'pushed_at'),
    defaultBranch: optString(item, 'default_branch'),
    isArchived: typeof item.archived === 'boolean' ? item.archived : undefined,
    isFork: typeof item.fork === 'boolean' ? item.fork : undefined,
  };
}
