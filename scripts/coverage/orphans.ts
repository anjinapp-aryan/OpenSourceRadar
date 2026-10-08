/**
 * Phase 6.2 orphan experiment (offline diagnosis + optional unauthenticated live checks). Writes results/phase6.2/orphans.json.
 *
 *   npx tsx scripts/coverage/orphans.ts <state data dir> [--live] [--sample N] [--old-candidates path]
 *
 * --live      HEAD https://github.com/<owner>/<name> for every orphan (reachable / renamed / not found). No token used.
 * --sample N  unauthenticated REST /repos/<owner>/<name> for a seeded random sample of N orphans (archived, fork, stars,
 *             pushed). The unauthenticated REST limit is 60 requests per hour, so N must stay below that.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import type { Dataset as RepositoryDataset } from '../../src/collect/dataset';
import { discoveryQueries, orphanOutcome, orphanReason, ORPHAN_OUTCOMES, ORPHAN_REASONS, type LiveFacts, type RepoFacts } from '../../src/coverage';
import { loadCategoryConfig } from '../../src/discovery/config';

const a = process.argv.slice(2);
const dir = a[0] ?? '.pipeline/state-2026-10-06/data';
const live = a.includes('--live');
const sampleN = a.includes('--sample') ? Number(a[a.indexOf('--sample') + 1]) : 0;
const oldPath = a.includes('--old-candidates') ? a[a.indexOf('--old-candidates') + 1] : 'data/candidates/candidates.json';

const repos = JSON.parse(readFileSync(join(dir, 'repositories.json'), 'utf8')) as RepositoryDataset;
const cand = JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { generatedAt: string; candidates: (RepoFacts & { fullName: string })[] };
const oldCand = JSON.parse(readFileSync(oldPath as string, 'utf8')) as { generatedAt: string; candidates: { id: string; fullName: string }[] };
const discovery = new Date(cand.generatedAt);
const queries = discoveryQueries([loadCategoryConfig('config/categories/ai.json'), loadCategoryConfig('config/categories/engineering.json')]);
const classifier = new Classifier(loadTaxonomy());
const inCand = new Set(cand.candidates.map((c) => c.id));
const inOld = new Set(oldCand.candidates.map((c) => c.id));

// Orphans exactly as the lifecycle defines them: has history, not in the candidate set, not archived.
const orphans = repos.repositories.filter((r) => !inCand.has(r.id) && r.isArchived !== true && r.starHistory.dailyGains.length > 0);
const archivedNotCandidates = repos.repositories.filter((r) => !inCand.has(r.id) && r.isArchived === true).length;

// churn between the two available discovery snapshots
const churn = {
  oldGeneratedAt: oldCand.generatedAt,
  newGeneratedAt: cand.generatedAt,
  old: inOld.size,
  new: inCand.size,
  kept: [...inCand].filter((i) => inOld.has(i)).length,
  dropped: [...inOld].filter((i) => !inCand.has(i)).length,
  added: [...inCand].filter((i) => !inOld.has(i)).length,
  orphansInOldSnapshot: orphans.filter((o) => inOld.has(o.id)).length,
};

function shuffleSeeded<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

async function head(fullName: string): Promise<LiveFacts> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`https://github.com/${fullName}`, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'OpenSourceRadar-phase6.2-coverage-audit' } });
      const final = new URL(res.url).pathname.replace(/^\//, '').split('/').slice(0, 2).join('/');
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      return { status: res.status, renamedTo: final && final.toLowerCase() !== fullName.toLowerCase() ? final : null };
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { status: null, renamedTo: null };
}

async function restDetails(fullName: string): Promise<{ status: number; isArchived?: boolean; isFork?: boolean; stars?: number; pushedAt?: string; fullName?: string; topics?: string[]; remaining?: string | null }> {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers: { 'User-Agent': 'OpenSourceRadar-phase6.2-coverage-audit', Accept: 'application/vnd.github+json' } });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) return { status: res.status, remaining };
  const j = (await res.json()) as any;
  return { status: res.status, isArchived: j.archived, isFork: j.fork, stars: j.stargazers_count, pushedAt: j.pushed_at, fullName: j.full_name, topics: j.topics, remaining };
}

async function main() {
  const liveFacts = new Map<string, LiveFacts>();
  if (live) {
    for (const o of orphans) {
      liveFacts.set(o.id, await head(o.fullName));
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  const sample = shuffleSeeded(orphans, 20261006).slice(0, sampleN);
  const sampleDetails: Record<string, Awaited<ReturnType<typeof restDetails>>> = {};
  for (const o of sample) {
    const d = await restDetails(o.fullName);
    sampleDetails[o.id] = d;
    const lf = liveFacts.get(o.id) ?? { status: d.status, renamedTo: null };
    liveFacts.set(o.id, { ...lf, isArchived: d.isArchived ?? null, isFork: d.isFork ?? null });
    if (d.remaining === '0') break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const rows = orphans.map((o) => {
    const facts: RepoFacts = { id: o.id, stars: o.stars, topics: o.topics, createdAt: o.createdAt, pushedAt: o.pushedAt, isArchived: o.isArchived };
    const diag = orphanReason(facts, cand.candidates, queries, discovery);
    const cls = classifier.classify({ id: o.id, name: o.name, description: o.description, topics: o.topics, language: o.language });
    const relevant = cls.topLevelCategory !== 'UNKNOWN';
    const lf = live ? liveFacts.get(o.id) ?? null : null;
    // A sampled repository is re-diagnosed with its CURRENT stars/pushed/topics (stored metadata can be weeks old).
    const sd = sampleDetails[o.id];
    const diagNow = sd?.stars !== undefined ? orphanReason({ ...facts, stars: sd.stars, pushedAt: sd.pushedAt ?? facts.pushedAt, topics: sd.topics ?? facts.topics, isArchived: sd.isArchived ?? facts.isArchived, isFork: sd.isFork ?? null }, cand.candidates, queries, discovery) : null;
    return {
      id: o.id,
      fullName: o.fullName,
      stars: o.stars,
      lastCollected: o.collectedAt.slice(0, 10),
      inOldSnapshot: inOld.has(o.id),
      reason: diag.reason,
      bestRank: diag.bestRank,
      detail: diag.detail,
      classification: cls.topLevelCategory,
      outcome: orphanOutcome(diagNow ?? diag, relevant, lf),
      live: lf,
      sampled: sd ? { status: sd.status, archived: sd.isArchived, fork: sd.isFork, starsNow: sd.stars, pushedNow: sd.pushedAt, currentName: sd.fullName, reasonNow: diagNow?.reason } : null,
    };
  });

  const count = <K extends string>(keys: readonly K[], f: (r: (typeof rows)[number]) => K) => Object.fromEntries(keys.map((k) => [k, rows.filter((r) => f(r) === k).length]));
  const sampledRows = rows.filter((r) => r.sampled);
  const out = {
    generatedAt: new Date().toISOString(),
    discoveryGeneratedAt: cand.generatedAt,
    queries: { total: queries.length, pushed: queries.filter((q) => q.kind === 'pushed').length, fresh: queries.filter((q) => q.kind === 'fresh').length, limitPerQuery: queries[0]?.limit },
    orphans: orphans.length,
    archivedOutsideCandidates: archivedNotCandidates,
    churnBetweenSnapshots: churn,
    reasons: count(ORPHAN_REASONS, (r) => r.reason),
    outcomes: count(ORPHAN_OUTCOMES, (r) => r.outcome),
    classificationOfOrphans: rows.reduce<Record<string, number>>((m, r) => ((m[r.classification] = (m[r.classification] ?? 0) + 1), m), {}),
    live: live
      ? {
          checked: rows.filter((r) => r.live).length,
          status: rows.reduce<Record<string, number>>((m, r) => ((m[String(r.live?.status)] = (m[String(r.live?.status)] ?? 0) + 1), m), {}),
          renamed: rows.filter((r) => r.live?.renamedTo).map((r) => `${r.fullName} -> ${r.live?.renamedTo}`),
        }
      : null,
    sample: {
      requested: sampleN,
      completed: sampledRows.filter((r) => r.sampled?.status === 200).length,
      archived: sampledRows.filter((r) => r.sampled?.archived).length,
      forks: sampledRows.filter((r) => r.sampled?.fork).length,
      notFound: sampledRows.filter((r) => r.sampled?.status === 404).length,
      reasonChangedWithCurrentData: sampledRows.filter((r) => r.sampled?.reasonNow && r.sampled.reasonNow !== r.reason).length,
      reasonsNow: sampledRows.reduce<Record<string, number>>((m, r) => ((m[r.sampled?.reasonNow ?? 'n/a'] = (m[r.sampled?.reasonNow ?? 'n/a'] ?? 0) + 1), m), {}),
      starGrowthSinceLastCollection: sampledRows.filter((r) => r.sampled?.starsNow !== undefined).map((r) => (r.sampled?.starsNow ?? 0) - r.stars).sort((x, y) => x - y),
    },
    topByStars: [...rows].sort((x, y) => y.stars - x.stars).slice(0, 25).map((r) => ({ fullName: r.fullName, stars: r.stars, reason: r.reason, bestRank: r.bestRank, classification: r.classification, outcome: r.outcome })),
    rows,
  };
  writeFileSync('results/phase6.2/orphans.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ orphans: out.orphans, archivedOutsideCandidates: out.archivedOutsideCandidates, churn, reasons: out.reasons, outcomes: out.outcomes, classification: out.classificationOfOrphans, live: out.live && { checked: out.live.checked, status: out.live.status, renamed: out.live.renamed.length }, sample: { ...out.sample, starGrowthSinceLastCollection: undefined } }, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
