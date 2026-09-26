import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCandidateDataset } from '../src/collect/candidates';
import { Classifier } from '../src/classification/classifier';
import { loadTaxonomy } from '../src/classification/config';
import { classifyCandidates } from '../src/classification/datasets';
import { loadTrackingPolicy, parseTrackingPolicy, TrackingConfigError } from '../src/tracking/config';
import { buildTrackedDataset, metricsFor, validateTrackedDataset } from '../src/tracking/datasets';
import { decideTracking, estimateDailyRefreshes, isEligible, selectDue } from '../src/tracking/engine';
import type { TrackingInput, TrackingMetrics, TrackingState } from '../src/tracking/types';
import type { Dataset as RepositoryDataset, RepositoryRecord } from '../src/collect/dataset';
import type { StarWindows } from '../src/analysis/windows';
import type { DiscoveredRepository } from '../src/discovery/discoveryProvider';

const policy = loadTrackingPolicy();
const NOW = new Date('2026-09-25T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const metrics = (over: Partial<TrackingMetrics> = {}): TrackingMetrics => ({
  stars: 20_000,
  createdAt: daysAgo(900),
  pushedAt: daysAgo(2),
  isArchived: false,
  starsPerDay7d: 1,
  starsPerDay30d: 1,
  growth7d: 7,
  growthPercent7d: 0.03,
  ...over,
});
const input = (over: Partial<TrackingMetrics> = {}, top: TrackingInput['topLevelCategory'] = 'AI'): TrackingInput => ({
  id: '1',
  topLevelCategory: top,
  metrics: metrics(over),
  lastRefreshedAt: daysAgo(0),
});

describe('tracking policy (configuration)', () => {
  it('loads the shipped policy: intervals and thresholds live in config/tracking.json', () => {
    expect(policy.trackingVersion).toBe('phase3-v1');
    expect(policy.tiers.hot.refreshHours).toBe(24);
    expect(policy.tiers.warm.refreshHours).toBe(72);
    expect(policy.tiers.dormant.refreshHours).toBe(168);
  });

  it('rejects malformed policies', () => {
    const base = JSON.parse(readFileSync('config/tracking.json', 'utf8'));
    const mut = (f: (c: any) => void) => () => {
      const c = JSON.parse(JSON.stringify(base));
      f(c);
      return parseTrackingPolicy(c);
    };
    expect(mut((c) => (c.schemaVersion = 2))).toThrow(TrackingConfigError);
    expect(mut((c) => (c.tiers.hot.refreshHours = 200))).toThrow(/hot <= warm <= dormant/);
    expect(mut((c) => (c.hysteresis.demoteFactor = 0))).toThrow(/demoteFactor/);
    expect(mut((c) => delete c.rules.hot.minStarsPerDay7d)).toThrow(/minStarsPerDay7d/);
    expect(mut((c) => (c.dueOrder = ['HOT', 'WARM']))).toThrow(/dueOrder/);
    expect(mut((c) => (c.unassessed.refreshHours = 0))).toThrow(/refreshHours/);
    expect(() => loadTrackingPolicy('config/nope.json')).toThrow(TrackingConfigError);
  });
});

describe('tier rules', () => {
  it('HOT: high star velocity', () => {
    const d = decideTracking(input({ starsPerDay7d: 150, growth7d: 1050 }), policy, NOW);
    expect(d.tier).toBe('HOT');
    expect(d.signals.rulesFired[0]).toContain('hot:starsPerDay7d>=80');
    expect(d.refreshIntervalHours).toBe(24);
    expect(d.reason).toContain('HOT because');
  });

  it('HOT: high percentage growth needs a minimum absolute growth too', () => {
    expect(decideTracking(input({ starsPerDay7d: 20, growth7d: 140, growthPercent7d: 2 }), policy, NOW).tier).toBe('HOT');
    expect(decideTracking(input({ starsPerDay7d: 2, growth7d: 14, growthPercent7d: 40 }), policy, NOW).tier).not.toBe('HOT');
  });

  it('HOT: new entrant with real growth', () => {
    const d = decideTracking(input({ createdAt: daysAgo(12), stars: 900, starsPerDay7d: 25, growth7d: 175, growthPercent7d: 0.5 }), policy, NOW);
    expect(d.tier).toBe('HOT');
    expect(d.signals.newEntrant).toBe(true);
    expect(d.signals.rulesFired[0]).toContain('newEntrant');
  });

  it('a new repository without growth is not HOT just for being new', () => {
    const d = decideTracking(input({ createdAt: daysAgo(12), stars: 40, starsPerDay7d: 1, growth7d: 7, growthPercent7d: 20 }), policy, NOW);
    expect(d.tier).not.toBe('HOT');
  });

  it('WARM: moderate growth', () => {
    const d = decideTracking(input({ starsPerDay7d: 12, starsPerDay30d: 5, growth7d: 84 }), policy, NOW);
    expect(d.tier).toBe('WARM');
    expect(d.refreshIntervalHours).toBe(72);
  });

  it('WARM: large and recently active even with slow growth', () => {
    const d = decideTracking(input({ starsPerDay7d: 1, starsPerDay30d: 1, stars: 5000, pushedAt: daysAgo(10) }), policy, NOW);
    expect(d.tier).toBe('WARM');
    expect(d.signals.rulesFired[0]).toContain('warm:pushedWithin30d');
  });

  it('DORMANT: low growth, stale, small', () => {
    const d = decideTracking(input({ starsPerDay7d: 0.2, starsPerDay30d: 0.3, growth7d: 1, growthPercent7d: 0.01, stars: 400, pushedAt: daysAgo(200) }), policy, NOW);
    expect(d.tier).toBe('DORMANT');
    expect(d.refreshIntervalHours).toBe(168);
    expect(d.signals.rulesFired).toEqual(['dormant:no hot or warm rule passed']);
  });

  it('missing growth signals never satisfy a rule (null is not zero and not infinity)', () => {
    const d = decideTracking(input({ starsPerDay7d: null, starsPerDay30d: 3, growth7d: null, growthPercent7d: null, stars: 300, pushedAt: daysAgo(400) }), policy, NOW);
    expect(d.assessed).toBe(true);
    expect(d.tier).toBe('DORMANT');
  });

  it('tier depends on measured signals, not on category', () => {
    const same = (top: TrackingInput['topLevelCategory']) => decideTracking(input({ starsPerDay7d: 150, growth7d: 1050 }, top), policy, NOW);
    for (const top of ['AI', 'ENGINEERING', 'BOTH'] as const) {
      const d = same(top);
      expect(d.tier).toBe('HOT');
      expect(d.reason).toBe(same('AI').reason);
    }
    expect(decideTracking(input({ starsPerDay7d: 0.1, starsPerDay30d: 0.1, stars: 100, pushedAt: daysAgo(300) }, 'AI'), policy, NOW).tier).toBe('DORMANT');
  });

  it('refresh intervals come from configuration', () => {
    const custom = parseTrackingPolicy({ ...JSON.parse(readFileSync('config/tracking.json', 'utf8')), tiers: { hot: { refreshHours: 6 }, warm: { refreshHours: 12 }, dormant: { refreshHours: 24 } } });
    const d = decideTracking(input({ starsPerDay7d: 150, growth7d: 1050 }), custom, NOW);
    expect(d.refreshIntervalHours).toBe(6);
    expect(Date.parse(d.nextRefreshAt) - NOW.getTime()).toBe(6 * 3_600_000);
  });

  it('nextRefreshAt = last refresh + interval', () => {
    const d = decideTracking({ ...input({ starsPerDay7d: 150, growth7d: 1050 }), lastRefreshedAt: daysAgo(0.5) }, policy, NOW);
    expect(Date.parse(d.nextRefreshAt)).toBe(Date.parse(daysAgo(0.5)) + 24 * 3_600_000);
  });

  it('is deterministic', () => {
    const i = input({ starsPerDay7d: 33, growth7d: 231 });
    expect(decideTracking(i, policy, NOW)).toEqual(decideTracking(i, policy, NOW));
  });
});

describe('young repositories (measured problem: 25 of 45 repositories aged 4-5 days were DORMANT)', () => {
  it('a young repository with modest growth is WARM, never DORMANT: too young to judge stability', () => {
    const d = decideTracking(input({ createdAt: daysAgo(5), stars: 30, starsPerDay7d: 6, starsPerDay30d: 6, growth7d: 30, growthPercent7d: null, pushedAt: daysAgo(1) }), policy, NOW);
    expect(d.tier).toBe('WARM');
    expect(d.signals.rulesFired).toEqual(['warm:too-young-to-be-dormant(age<30d)']);
    expect(d.assessed).toBe(true);
  });

  it('an old, quiet repository is still DORMANT (the rule only protects young ones)', () => {
    expect(decideTracking(input({ createdAt: daysAgo(400), stars: 300, starsPerDay7d: 0.1, starsPerDay30d: 0.1, growth7d: 1, growthPercent7d: 0.01, pushedAt: daysAgo(300) }), policy, NOW).tier).toBe('DORMANT');
  });

  it('metricsFor divides by the days that exist, not by 7, for a repository younger than a week', () => {
    const w = (days: number, growth: number) => ({ days, status: 'ok' as const, starsAgo: 0, growth, growthPercent: null, starsPerDay: Math.round((growth / days) * 1e4) / 1e4 });
    const record = {
      id: '1', createdAt: daysAgo(5), pushedAt: daysAgo(1), isArchived: false, stars: 35, growthAsOf: NOW.toISOString(),
      starHistory: { fetchedAt: NOW.toISOString() }, growth: { '7d': w(7, 35), '30d': w(30, 35), '90d': w(90, 35) },
    } as unknown as RepositoryRecord;
    const { metrics } = metricsFor({ stars: 35, createdAt: daysAgo(5), pushedAt: daysAgo(1), isArchived: false }, record);
    expect(metrics.starsPerDay7d).toBe(7); // 35 stars over 5 days, not 5 stars/day
    const old = metricsFor({ stars: 35, createdAt: daysAgo(500), pushedAt: null, isArchived: false }, { ...record, createdAt: daysAgo(500) } as RepositoryRecord);
    expect(old.metrics.starsPerDay7d).toBe(5);
  });

  it('the policy requires rules.dormant.minAgeDays', () => {
    const base = JSON.parse(readFileSync('config/tracking.json', 'utf8'));
    delete base.rules.dormant.minAgeDays;
    expect(() => parseTrackingPolicy(base)).toThrow(/minAgeDays/);
  });
});

describe('eligibility', () => {
  it('UNKNOWN classification and archived repositories are not tracked', () => {
    expect(isEligible(input({}, 'UNKNOWN'), policy)).toEqual({ eligible: false, reason: 'not tracked: classification UNKNOWN' });
    expect(isEligible(input({ isArchived: true }, 'AI'), policy).reason).toBe('not tracked: archived');
    expect(isEligible(input({}, 'BOTH'), policy).eligible).toBe(true);
  });
});

describe('UNASSESSED (no growth measured yet) is not a tier', () => {
  const none = { starsPerDay7d: null, starsPerDay30d: null, growth7d: null, growthPercent7d: null };

  it('is its own state, due immediately, and says it tells nothing about activity', () => {
    const d = decideTracking(input(none), policy, NOW);
    expect(d.assessed).toBe(false);
    expect(d.tier).toBe('UNASSESSED');
    expect(d.tier).not.toBe('DORMANT');
    expect(d.refreshIntervalHours).toBe(24);
    expect(d.nextRefreshAt).toBe(NOW.toISOString());
    expect(d.reason).toContain('says nothing about activity');
  });

  it('a brand-new, already-starred repository is NOT provisionally HOT: newness needs measured growth', () => {
    const d = decideTracking(input({ createdAt: daysAgo(5), stars: 900, ...none }), policy, NOW);
    expect(d.tier).toBe('UNASSESSED');
    expect(d.signals.newEntrant).toBe(true);
  });

  it('a measured, quiet repository is DORMANT, clearly different from UNASSESSED', () => {
    const measured = decideTracking(input({ starsPerDay7d: 0, starsPerDay30d: 0, growth7d: 0, growthPercent7d: 0, stars: 300, pushedAt: daysAgo(400) }), policy, NOW);
    expect(measured.tier).toBe('DORMANT');
    expect(measured.assessed).toBe(true);
    expect(measured.tier).not.toBe(decideTracking(input(none), policy, NOW).tier);
  });

  it('the first measurement is a transition out of UNASSESSED, for any resulting tier', () => {
    const first = (m: Partial<TrackingMetrics>) => decideTracking(input(m), policy, NOW, { tier: 'UNASSESSED', tierSince: daysAgo(3) });
    const hot = first({ starsPerDay7d: 150, growth7d: 1050 });
    expect(hot.transition).toEqual({ from: 'UNASSESSED', to: 'HOT' });
    expect(hot.reason).toContain('first assessment');
    expect(first({ starsPerDay7d: 12, starsPerDay30d: 12, growth7d: 84 }).transition?.to).toBe('WARM');
    expect(first({ starsPerDay7d: 0, starsPerDay30d: 0, growth7d: 0, growthPercent7d: 0, stars: 300, pushedAt: daysAgo(400) }).transition?.to).toBe('DORMANT');
    expect(hot.tierSince).toBe(NOW.toISOString());
  });

  it('still-unassessed repositories keep waiting without a transition', () => {
    const d = decideTracking(input(none), policy, NOW, { tier: 'UNASSESSED', tierSince: daysAgo(3) });
    expect(d.tier).toBe('UNASSESSED');
    expect(d.transition).toBeNull();
    expect(d.tierSince).toBe(daysAgo(3));
  });

  it('UNASSESSED is collected before WARM and DORMANT and after HOT (configurable order)', () => {
    const recs = [
      { id: 'w', tier: 'WARM' as const, nextRefreshAt: daysAgo(3) },
      { id: 'u', tier: 'UNASSESSED' as const, nextRefreshAt: daysAgo(1) },
      { id: 'h', tier: 'HOT' as const, nextRefreshAt: daysAgo(0.1) },
      { id: 'd', tier: 'DORMANT' as const, nextRefreshAt: daysAgo(5) },
    ];
    expect(selectDue(recs, NOW, policy.dueOrder).map((r) => r.id)).toEqual(['h', 'u', 'w', 'd']);
    expect(selectDue(recs, NOW, ['DORMANT', 'WARM', 'UNASSESSED', 'HOT']).map((r) => r.id)).toEqual(['d', 'w', 'u', 'h']);
  });
});

describe('tier transitions', () => {
  const state = (tier: TrackingState['tier'], daysIn: number): TrackingState => ({ tier, tierSince: daysAgo(daysIn) });
  const hotMetrics = { starsPerDay7d: 150, growth7d: 1050 };
  const warmMetrics = { starsPerDay7d: 12, starsPerDay30d: 12, growth7d: 84, growthPercent7d: 0.05 };
  const dormantMetrics = { starsPerDay7d: 0.2, starsPerDay30d: 0.2, growth7d: 1, growthPercent7d: 0.01, stars: 300, pushedAt: daysAgo(300) };

  it('DORMANT -> WARM (immediate promotion)', () => {
    const d = decideTracking(input(warmMetrics), policy, NOW, state('DORMANT', 0.2));
    expect(d.tier).toBe('WARM');
    expect(d.transition).toEqual({ from: 'DORMANT', to: 'WARM' });
    expect(d.tierSince).toBe(NOW.toISOString());
    expect(d.reason).toContain('promoted DORMANT -> WARM');
  });

  it('WARM -> HOT (immediate promotion)', () => {
    const d = decideTracking(input(hotMetrics), policy, NOW, state('WARM', 1));
    expect(d.tier).toBe('HOT');
    expect(d.transition).toEqual({ from: 'WARM', to: 'HOT' });
  });

  it('HOT -> WARM (after the minimum stay, once metrics are below 70% of the HOT thresholds)', () => {
    const d = decideTracking(input(warmMetrics), policy, NOW, state('HOT', 10));
    expect(d.tier).toBe('WARM');
    expect(d.transition).toEqual({ from: 'HOT', to: 'WARM' });
    expect(d.reason).toContain('demoted HOT -> WARM');
  });

  it('WARM -> DORMANT (after the minimum stay)', () => {
    const d = decideTracking(input(dormantMetrics), policy, NOW, state('WARM', 30));
    expect(d.tier).toBe('DORMANT');
    expect(d.transition).toEqual({ from: 'WARM', to: 'DORMANT' });
    expect(d.tierSince).toBe(NOW.toISOString());
  });

  it('demotion is damped: too soon after entering the tier -> kept, with a reason', () => {
    const d = decideTracking(input(warmMetrics), policy, NOW, state('HOT', 1));
    expect(d.tier).toBe('HOT');
    expect(d.transition).toBeNull();
    expect(d.reason).toContain('minimum days in tier');
    expect(d.tierSince).toBe(daysAgo(1));
  });

  it('demotion is damped: metrics slightly below the threshold (within 70%) keep the tier', () => {
    // HOT needs 80 stars/day; 60 is below it but above 0.7 * 80 = 56
    const d = decideTracking(input({ starsPerDay7d: 60, growth7d: 420, growthPercent7d: 0.4 }), policy, NOW, state('HOT', 20));
    expect(d.tier).toBe('HOT');
    expect(d.reason).toContain('within 70%');
    // 40 stars/day is below 56 -> demote
    expect(decideTracking(input({ starsPerDay7d: 40, growth7d: 280, growthPercent7d: 0.4 }), policy, NOW, state('HOT', 20)).tier).toBe('WARM');
  });

  it('demotion moves one level at a time (HOT never jumps to DORMANT)', () => {
    const d = decideTracking(input(dormantMetrics), policy, NOW, state('HOT', 30));
    expect(d.tier).toBe('WARM');
    expect(d.transition).toEqual({ from: 'HOT', to: 'WARM' });
  });

  it('staying in a tier keeps tierSince and reports no transition', () => {
    const d = decideTracking(input(hotMetrics), policy, NOW, state('HOT', 5));
    expect(d.transition).toBeNull();
    expect(d.tierSince).toBe(daysAgo(5));
  });

  it('a provisional (no-data) evaluation never demotes a tier earned from data', () => {
    const d = decideTracking(input({ starsPerDay7d: null, starsPerDay30d: null, growth7d: null, growthPercent7d: null }), policy, NOW, state('HOT', 30));
    expect(d.tier).toBe('HOT');
    expect(d.transition).toBeNull();
  });
});

describe('due selection and volume', () => {
  it('selectDue returns due repositories, hottest first, then oldest due', () => {
    const recs = [
      { id: 'a', tier: 'WARM' as const, nextRefreshAt: daysAgo(2) },
      { id: 'b', tier: 'HOT' as const, nextRefreshAt: daysAgo(0.1) },
      { id: 'c', tier: 'HOT' as const, nextRefreshAt: daysAgo(1) },
      { id: 'd', tier: 'DORMANT' as const, nextRefreshAt: new Date(NOW.getTime() + 3_600_000).toISOString() },
    ];
    expect(selectDue(recs, NOW).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('estimateDailyRefreshes = sum(count / (hours/24))', () => {
    expect(estimateDailyRefreshes({ HOT: 10, WARM: 30, DORMANT: 70 }, policy)).toBe(10 + 30 / 3 + 70 / 7);
  });
});

describe('tracked dataset (candidates -> classified -> tracked)', () => {
  const taxonomy = new Classifier(loadTaxonomy());
  const snapshot = (id: string, name: string, topics: string[], description: string, stars: number, over: Record<string, unknown> = {}): DiscoveredRepository => ({
    snapshot: { repositoryId: id, owner: 'o', name, fullName: `o/${name}`, url: 'u', description, stars, forks: 0, openIssues: 0, language: null, topics, license: null, createdAt: daysAgo(500), updatedAt: daysAgo(1), pushedAt: daysAgo(2), collectedAt: NOW.toISOString(), source: 'graphql', ...over },
    domains: ['ai'],
    categories: ['whatever discovery said'],
    hits: 1,
  });
  const growthRecord = (id: string, name: string, spd7: number, spd30 = spd7): RepositoryRecord => {
    const w = (days: number, spd: number) => ({ days, status: 'ok' as const, starsAgo: 1000, growth: Math.round(spd * days), growthPercent: 1, starsPerDay: spd });
    const growth: StarWindows = { '7d': w(7, spd7), '30d': w(30, spd30), '90d': w(90, spd30) };
    return { id, owner: 'o', name, fullName: `o/${name}`, url: 'u', description: 'd', language: null, topics: [], license: null, createdAt: daysAgo(500), updatedAt: daysAgo(1), pushedAt: daysAgo(2), isArchived: false, stars: 5000, forks: 0, openIssues: 0, metadataSource: 'graphql', collectedAt: NOW.toISOString(), domains: ['ai'], categories: [], starHistory: { source: 'github-star-history', fetchedAt: daysAgo(0.25), complete: false, firstDate: '2026-01-01', dailyGains: [1] }, growth, quality: [] };
  };
  const growthDataset = (records: RepositoryRecord[]): RepositoryDataset => ({ schemaVersion: 1, generatedAt: NOW.toISOString(), asOfDate: '2026-09-25', historyPagesPerRepository: 1, stats: { repositories: records.length, byDomain: {} }, repositories: records });

  const list = [
    snapshot('10', 'agent-hot', ['ai-agents', 'agentic-ai'], 'An autonomous AI agent framework', 5000),
    snapshot('20', 'kafka-warm', ['kafka', 'apache-kafka'], 'Kafka streaming tools', 5000),
    snapshot('30', 'nothing', [], 'nothing to see', 5000),
    snapshot('40', 'archived-kafka', ['kafka', 'apache-kafka'], 'Kafka archive', 5000, { isArchived: true }),
  ];
  const cands = buildCandidateDataset(list, [], NOW);
  const classified = classifyCandidates(cands, taxonomy, NOW);

  it('tracks only classified, eligible repositories; UNKNOWN and archived are counted, not tracked', () => {
    const t = buildTrackedDataset({ classified, candidates: cands, policy, now: NOW });
    expect(t.repositories.map((r) => r.id)).toEqual(['10', '20']);
    expect(t.summary.excluded).toEqual({ unclassified: 1, archived: 1, other: 0 });
    expect(validateTrackedDataset(t)).toEqual([]);
    expect(t.summary.unassessed).toBe(2);
    expect(t.repositories.every((r) => r.tier === 'UNASSESSED' && r.lastCollectedAt === null)).toBe(true);
    expect(t.summary.byTier).toEqual({ HOT: 0, WARM: 0, DORMANT: 0, UNASSESSED: 2 });
    expect(t.summary.estimatedDailyRefreshes).toBe(0); // unassessed is a one-time cost, not a steady-state refresh
    expect(t.trackingVersion).toBe('phase3-v1');
  });

  it('uses Phase 2 growth when available; the discovery category never matters', () => {
    const t = buildTrackedDataset({ classified, candidates: cands, growth: growthDataset([growthRecord('10', 'agent-hot', 200), growthRecord('20', 'kafka-warm', 12)]), policy, now: NOW });
    const by = Object.fromEntries(t.repositories.map((r) => [r.id, r]));
    expect(by['10']!.tier).toBe('HOT');
    expect(by['20']!.tier).toBe('WARM');
    expect(by['10']!.assessed).toBe(true);
    expect(by['10']!.classification).toEqual({ topLevelCategory: 'AI', categories: ['ai-agents'] });
    expect(t.summary.byTier).toEqual({ HOT: 1, WARM: 1, DORMANT: 0, UNASSESSED: 0 });
    expect(t.summary.estimatedDailyRefreshes).toBe(1.3); // 1 + 1/3, rounded to one decimal
  });

  it('a renamed repository (same id) keeps its tier history and records the old name', () => {
    const first = buildTrackedDataset({ classified, candidates: cands, growth: growthDataset([growthRecord('10', 'agent-hot', 200)]), policy, now: NOW });
    const renamed = buildCandidateDataset([snapshot('10', 'agent-renamed', ['ai-agents', 'agentic-ai'], 'An autonomous AI agent framework', 5000)], [], NOW);
    const later = new Date(NOW.getTime() + 86_400_000);
    const second = buildTrackedDataset({
      classified: classifyCandidates(renamed, taxonomy, later),
      candidates: renamed,
      growth: growthDataset([{ ...growthRecord('10', 'agent-renamed', 200), fullName: 'o/agent-renamed' }]),
      previous: first,
      policy,
      now: later,
    });
    const r = second.repositories[0]!;
    expect(r.id).toBe('10');
    expect(r.fullName).toBe('o/agent-renamed');
    expect(r.previousFullName).toBe('o/agent-hot');
    expect(r.tierSince).toBe(first.repositories[0]!.tierSince); // unchanged tier: history continues
    expect(second.repositories).toHaveLength(1);
  });

  it('a previous provisional (never measured) tier is treated as UNASSESSED, so the first measurement is a first assessment', () => {
    const provisional = buildTrackedDataset({ classified, candidates: cands, policy, now: NOW });
    const legacy = JSON.parse(JSON.stringify(provisional));
    for (const r of legacy.repositories) Object.assign(r, { tier: 'WARM', assessed: false }); // what Phase 3 wrote
    const measured = buildTrackedDataset({ classified, candidates: cands, growth: growthDataset([growthRecord('10', 'agent-hot', 200), growthRecord('20', 'kafka-warm', 12)]), previous: legacy, policy, now: NOW });
    const by = Object.fromEntries(measured.repositories.map((r) => [r.id, r]));
    expect(by['10']!.transition).toEqual({ from: 'UNASSESSED', to: 'HOT' });
    expect(by['20']!.transition).toEqual({ from: 'UNASSESSED', to: 'WARM' });
    expect(by['10']!.reason).toContain('first assessment');
  });

  it('is deterministic for identical inputs', () => {
    const a = buildTrackedDataset({ classified, candidates: cands, policy, now: NOW });
    const b = buildTrackedDataset({ classified, candidates: cands, policy, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('validation rejects UNKNOWN or duplicate entries', () => {
    const t = buildTrackedDataset({ classified, candidates: cands, policy, now: NOW });
    const bad = JSON.parse(JSON.stringify(t));
    bad.repositories[0].classification.topLevelCategory = 'UNKNOWN';
    bad.repositories.push(bad.repositories[1]);
    const problems = validateTrackedDataset(bad).join(' ');
    expect(problems).toContain('UNKNOWN repositories must not be tracked');
    expect(problems).toContain('duplicated');
    expect(validateTrackedDataset(null)).toEqual(['tracked dataset is not an object']);
  });
});
