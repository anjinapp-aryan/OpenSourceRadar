/**
 * Phase 6.3: evaluate bounded-admission policies for the Top-300 discovery on the Phase 6.2.2 measurements (200 random + 40 probe
 * repositories with real star history), reusing the production classifier, momentum code and tracking engine. Offline, read-only.
 *
 *   tsx scripts/discovery/admission-sim.ts <state data dir> [--cache results/phase6.2.2/cache] [--out results/phase6.3/admission-simulation.json]
 *
 * For each policy it reports how many candidates are admitted, what the measured outcomes of the admitted group are (stratum-weighted
 * for the random sample; the probe is reported separately because it is selection-biased) and the history-request cost, where the refresh
 * rate of each measured repository is the one the REAL tracking engine would assign it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Classifier } from '../../src/classification/classifier';
import { loadTaxonomy } from '../../src/classification/config';
import { evaluateCurrent } from '../../src/backtest';
import { buildRecord } from '../../src/collect/dataset';
import { admit, loadAdmissionConfig, worstCaseHistoryRequestsPerDay, lifetimeStarsPerDay, type AdmissionCandidate, type AdmissionConfig } from '../../src/discovery/admission';
import { normalizeHits, valueClass, weightedRate, type ValueClass } from '../../src/discovery/shadow';
import { parsePatternConfig } from '../../src/explain/pattern';
import { loadMomentumConfig } from '../../src/momentum/config';
import { decideTracking } from '../../src/tracking/engine';
import { loadTrackingPolicy } from '../../src/tracking/config';
import { metricsFor } from '../../src/tracking/datasets';
import type { RepositorySnapshot } from '../../src/model/repositorySnapshot';
import type { StarHistorySeries } from '../../src/model/starHistory';

const argv = process.argv.slice(2);
const dir = argv[0] ?? '.pipeline/state-2026-10-06/data';
const cacheDir = argv.includes('--cache') ? (argv[argv.indexOf('--cache') + 1] as string) : 'results/phase6.2.2/cache';
const outPath = argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : 'results/phase6.3/admission-simulation.json';

const search = JSON.parse(readFileSync(join(cacheDir, 'raw-search.json'), 'utf8')) as { meta: { now: string; topics: string[] }; entries: Record<string, { repositories: RepositorySnapshot[] }> };
const hist = JSON.parse(readFileSync(join(cacheDir, 'history-sample.json'), 'utf8')) as Record<string, { id: string; stratum: string; stratumSize: number; series: StarHistorySeries | null; fetchedAt: string }>;
const cand = JSON.parse(readFileSync(join(dir, 'candidates/candidates.json'), 'utf8')) as { candidates: { id: string }[] };
const inCandidates = new Set(cand.candidates.map((c) => c.id));
const now = new Date(search.meta.now);
const classifier = new Classifier(loadTaxonomy());
const mcfg = loadMomentumConfig();
const pcfg = parsePatternConfig(JSON.parse(readFileSync('config/pattern.json', 'utf8')));
const tpolicy = loadTrackingPolicy();
const thresholds = { grower: { minVelocity7d: 8, minGrowth7d: 56 }, nearFraction: 0.5, rising: { minVelocity7d: mcfg.trends.rising.minVelocity7d, minGrowth7d: mcfg.trends.rising.minGrowth7d } };

// ---- the novel pool: everything the Top-300 search returned that production discovery did not
const all = normalizeHits(Object.values(search.entries).flatMap((e) => e.repositories));
const found = new Map<string, { snap: RepositorySnapshot; comps: Set<string> }>();
for (const [key, e] of Object.entries(search.entries)) for (const s of normalizeHits(e.repositories).repositories) {
  const f = found.get(s.repositoryId) ?? { snap: s, comps: new Set<string>() };
  f.comps.add((key.split('|')[1] as string).split(':')[0] as string);
  found.set(s.repositoryId, f);
}
void all;
const novel = [...found.values()].filter((f) => !inCandidates.has(f.snap.repositoryId));

const cls = (s: RepositorySnapshot) => classifier.classify({ id: s.repositoryId, name: s.name, description: s.description, topics: s.topics, language: s.language });
const info = new Map(novel.map((f) => {
  const r = cls(f.snap);
  return [f.snap.repositoryId, { topLevel: r.topLevelCategory, learning: r.signals.context.some((c) => c.id === 'educational-content') }] as const;
}));
const toCandidate = (f: { snap: RepositorySnapshot }): AdmissionCandidate => ({
  id: f.snap.repositoryId, fullName: f.snap.fullName, stars: f.snap.stars, createdAt: f.snap.createdAt,
  topLevel: info.get(f.snap.repositoryId)!.topLevel, contentType: info.get(f.snap.repositoryId)!.learning ? 'learning' : 'software',
  isArchived: f.snap.isArchived === true, isFork: f.snap.isFork === true, alreadyCandidate: false, alreadyAdmitted: false,
});

// ---- measured outcomes
interface Measured { cls: ValueClass; refreshPerDay: number; tier: string; rising: boolean }
const signature = (comps: Set<string>) => [...comps].sort().join('+');
const strataSize = new Map<string, number>();
for (const f of novel) strataSize.set(signature(f.comps), (strataSize.get(signature(f.comps)) ?? 0) + 1);
const measureOf = (snap: RepositorySnapshot, series: StarHistorySeries): Measured => {
  const asOf = new Date(series.fetchedAt);
  const rec = buildRecord(snap, { domains: ['ai'], categories: [] }, series, [], asOf);
  const e = evaluateCurrent(rec, rec.growthAsOf ?? series.fetchedAt, asOf, mcfg, pcfg);
  const { metrics, lastRefreshedAt } = metricsFor({ stars: snap.stars, createdAt: snap.createdAt, pushedAt: snap.pushedAt ?? null, isArchived: snap.isArchived ?? null }, rec);
  const d = decideTracking({ id: snap.repositoryId, topLevelCategory: 'AI', metrics, lastRefreshedAt }, tpolicy, asOf);
  const c = valueClass({ growth7d: e.growth7d, growth30d: e.growth30d, growth90d: e.growth90d, velocity7d: e.velocity7d, velocity30d: e.velocity30d, trend: e.trend, score: e.score }, thresholds);
  return { cls: c, refreshPerDay: 24 / d.refreshIntervalHours, tier: d.tier, rising: e.trend === 'RISING' };
};
const random = new Map<string, Measured>();
const probe = new Map<string, Measured>();
for (const h of Object.values(hist)) {
  const f = found.get(h.id);
  if (!f || !h.series) continue;
  (h.stratum === 'PROBE' ? probe : random).set(h.id, measureOf(f.snap, h.series));
}
const sampledPerStratum = new Map<string, number>();
for (const id of random.keys()) {
  const f = found.get(id);
  if (f) sampledPerStratum.set(signature(f.comps), (sampledPerStratum.get(signature(f.comps)) ?? 0) + 1);
}
const weight = (id: string) => {
  const f = found.get(id)!;
  return (strataSize.get(signature(f.comps)) ?? 0) / Math.max(1, sampledPerStratum.get(signature(f.comps)) ?? 1);
};

// ---- policies
const base: AdmissionConfig = {
  policyVersion: 'sim', mode: 'shadow',
  relevance: { allowedTopLevel: ['AI', 'ENGINEERING', 'BOTH'], excludeLearningContent: true },
  lifecycle: { excludeArchived: true, excludeForks: true, minStars: 100 },
  minPriority: 0,
  budget: { maxNewPerWeek: 1e9, maxAdmittedPool: 1e9, hotRefreshHours: 24, maxHistoryRequestsPerDay: 1e12, currentHistoryRequestsPerDay: 1125 },
};
const SCALE = 66 / search.meta.topics.length; // upper bound: the 14 experiment topics -> 66 production topics
const rows = [0, 5, 10, 20, 50].map((tau) => {
  const cfg = { ...base, minPriority: tau };
  const res = admit(novel.map(toCandidate), cfg, now);
  const ids = new Set(res.admitted.map((a) => a.id));
  const rs = [...random.keys()].filter((id) => ids.has(id));
  const rate = (pred: (m: Measured) => boolean) => weightedRate(rs.map((id) => ({ weight: weight(id), hit: pred(random.get(id)!) })));
  const growers = rate((m) => m.cls === 'GROWER' || m.cls === 'NEAR_RISING' || m.cls === 'RISING');
  const refresh = weightedRate([]); void refresh;
  const meanRefresh = rs.length ? rs.reduce((a, id) => a + random.get(id)!.refreshPerDay * weight(id), 0) / rs.reduce((a, id) => a + weight(id), 0) : null;
  const probeIds = [...probe.keys()].filter((id) => ids.has(id));
  return {
    minPriority: tau,
    admittedIn14Topics: ids.size,
    admittedShareOfNovel: +(ids.size / novel.length).toFixed(3),
    admittedAtProductionScaleUpperBound: Math.round(ids.size * SCALE),
    randomSampleAdmitted: rs.length,
    estimatedGrowersAdmitted: growers ? Math.round(growers.estimatedHits) : null,
    growerRateAmongAdmitted: growers ? +growers.rate.toFixed(3) : null,
    randomSampleRising: rs.filter((id) => random.get(id)!.rising).length,
    randomSampleNearRising: rs.filter((id) => random.get(id)!.cls === 'NEAR_RISING').length,
    probeRisingCaptured: probeIds.filter((id) => probe.get(id)!.rising).length,
    probeNearRisingCaptured: probeIds.filter((id) => probe.get(id)!.cls === 'NEAR_RISING').length,
    meanHistoryRequestsPerDayPerAdmittedRepo: meanRefresh === null ? null : +meanRefresh.toFixed(3),
    expectedAddedHistoryRequestsPerDay14Topics: meanRefresh === null ? null : Math.round(meanRefresh * ids.size),
    expectedAddedHistoryRequestsPerDayProductionUpperBound: meanRefresh === null ? null : Math.round(meanRefresh * ids.size * SCALE),
    worstCaseAddedPerDayProductionUpperBound: Math.round(ids.size * SCALE * (24 / base.budget.hotRefreshHours)),
    rejectedBy: res.stats.byReason,
  };
});
const probeTotals = { measured: probe.size, rising: [...probe.values()].filter((m) => m.rising).length, nearRising: [...probe.values()].filter((m) => m.cls === 'NEAR_RISING').length };
const probeUnknown = [...probe.keys()].filter((id) => info.get(id)?.topLevel === 'UNKNOWN');
const tierMix: Record<string, number> = {};
for (const m of random.values()) tierMix[m.tier] = (tierMix[m.tier] ?? 0) + 1;
const out = {
  note: 'ADMISSION PRIORITY PROXY = lifetime stars per day (stars / age). Metadata-only ordering, not momentum. The random sample is stratum-weighted; the probe is selection-biased and reported only as existence.',
  novelPool14Topics: novel.length,
  classifiedAllowed: novel.filter((f) => ['AI', 'ENGINEERING', 'BOTH'].includes(info.get(f.snap.repositoryId)!.topLevel)).length,
  classifiedUnknown: novel.filter((f) => info.get(f.snap.repositoryId)!.topLevel === 'UNKNOWN').length,
  learningContent: novel.filter((f) => info.get(f.snap.repositoryId)!.learning).length,
  scaleTo66TopicsUpperBound: +SCALE.toFixed(2),
  randomSampleTrackingTierMix: tierMix,
  probe: { ...probeTotals, unknownClassified: probeUnknown.length, risingUnknownClassified: probeUnknown.filter((id) => probe.get(id)!.rising).length },
  policies: rows,
  priorityBands: ['<10', '10-50', '>=50'].map((b) => {
    const inBand = (f: { snap: RepositorySnapshot }) => { const v = lifetimeStarsPerDay(f.snap.stars, f.snap.createdAt, now); return b === '<10' ? v < 10 : b === '10-50' ? v >= 10 && v < 50 : v >= 50; };
    const pool = novel.filter(inBand);
    return { band: b, pool: pool.length, classifiedAllowed: pool.filter((f) => ['AI', 'ENGINEERING', 'BOTH'].includes(info.get(f.snap.repositoryId)!.topLevel)).length };
  }),
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
// The configured policy (config/admission.json) applied to the same pool: the shadow admission list.
const finalCfg = loadAdmissionConfig();
const finalRes = admit(novel.map(toCandidate), finalCfg, now, 0);
const rank = finalRes.admitted.map((a) => ({ id: a.id, fullName: a.fullName, stars: a.stars, priority: +a.priority.toFixed(1), topLevel: a.topLevel, probeRising: probe.get(a.id)?.rising ?? null, measuredClass: random.get(a.id)?.cls ?? probe.get(a.id)?.cls ?? null }));
writeFileSync(
  join(outPath, '..', 'admission-shadow.json'),
  JSON.stringify(
    {
      config: finalCfg,
      worstCaseHistoryRequestsPerDay: worstCaseHistoryRequestsPerDay(finalCfg),
      currentHistoryRequestsPerDay: finalCfg.budget.currentHistoryRequestsPerDay,
      stats: finalRes.stats,
      admittedCount: finalRes.admitted.length,
      probeRisingAdmitted: rank.filter((r) => r.probeRising === true).length,
      note: 'experiment topics only (14 of 66); the weekly cap and the pool cap apply to the whole 66-topic result',
      admitted: rank,
    },
    null,
    1,
  ) + '\n',
);
console.log(JSON.stringify(out, null, 1));
