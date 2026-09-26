import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCandidateDataset, type CandidateRecord } from '../src/collect/candidates';
import { Classifier } from '../src/classification/classifier';
import { loadTaxonomy, parseTaxonomy, TaxonomyError } from '../src/classification/config';
import { classifyCandidates, summarize, toClassificationInput, validateClassifiedDataset } from '../src/classification/datasets';
import { compileTerm, matchTerms, nameTokenSets, TextIndex, tokenize } from '../src/classification/text';
import type { ClassificationInput, ClassificationResult } from '../src/classification/types';

const taxonomy = loadTaxonomy();
const classifier = new Classifier(taxonomy);

const repo = (over: Partial<ClassificationInput> & { name: string }): ClassificationInput => ({
  id: '1',
  description: null,
  topics: [],
  language: null,
  ...over,
});
const slugs = (r: ClassificationResult) => r.categories.map((c) => c.slug);

describe('taxonomy configuration', () => {
  it('has the 33 product categories: 14 AI + 19 engineering', () => {
    expect(taxonomy.categories.filter((c) => c.domain === 'ai')).toHaveLength(14);
    expect(taxonomy.categories.filter((c) => c.domain === 'engineering')).toHaveLength(19);
    expect(taxonomy.classifierVersion).toBe('phase3-v1');
  });

  it('every category defines strong/weak topics and keywords plus exclusions', () => {
    for (const c of taxonomy.categories) {
      expect(c.strongTopics.length, c.slug).toBeGreaterThan(0);
      expect(c.strongKeywords.length, c.slug).toBeGreaterThan(0);
      expect(c.weakTopics.length + c.weakKeywords.length, c.slug).toBeGreaterThan(0);
      expect(Array.isArray(c.exclusionTopics) && Array.isArray(c.exclusionKeywords), c.slug).toBe(true);
    }
  });

  it('a term is never both strong and weak in the same category', () => {
    for (const c of taxonomy.categories) {
      expect(c.strongTopics.filter((t) => c.weakTopics.includes(t)), c.slug).toEqual([]);
      expect(c.strongKeywords.filter((t) => c.weakKeywords.includes(t)), c.slug).toEqual([]);
    }
  });

  it('rejects malformed configuration', () => {
    const ai = JSON.parse(readFileSync('config/categories/ai.json', 'utf8'));
    const eng = JSON.parse(readFileSync('config/categories/engineering.json', 'utf8'));
    const global = JSON.parse(readFileSync('config/classification.json', 'utf8'));
    const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
    expect(() => parseTaxonomy({ ...global, schemaVersion: 2 }, ai, eng)).toThrow(TaxonomyError);
    const noBlock = clone(ai);
    delete noBlock.categories[0].classification;
    expect(() => parseTaxonomy(global, noBlock, eng)).toThrow(/no classification block/);
    const dup = clone(eng);
    dup.categories[0].slug = ai.categories[0].slug;
    expect(() => parseTaxonomy(global, ai, dup)).toThrow(/duplicate category slug/);
    const badFactor = clone(global);
    badFactor.contextSignals[0].effect.topicEvidenceFactor = 3;
    expect(() => parseTaxonomy(badFactor, ai, eng)).toThrow(/0..1/);
    const badWeights = clone(global);
    badWeights.weights.strongTopic = [];
    expect(() => parseTaxonomy(badWeights, ai, eng)).toThrow(/strongTopic/);
    expect(() => loadTaxonomy({ global: 'config/nope.json' })).toThrow(TaxonomyError);
  });
});

describe('text matching', () => {
  it('tokenizes on any non-alphanumeric and lower-cases', () => {
    expect(tokenize('CI/CD & Llama.cpp — GPT-4')).toEqual(['ci', 'cd', 'llama', 'cpp', 'gpt', '4']);
  });

  it('reads camelCase names both ways ("JavaGuide" -> java + guide, "langchain" stays whole)', () => {
    expect(nameTokenSets('JavaGuide')).toEqual([['javaguide'], ['java', 'guide']]);
    expect(nameTokenSets('langchain')).toEqual([['langchain']]);
    expect(nameTokenSets('open-webui')).toEqual([['open', 'webui']]);
  });

  it('matches whole words and phrases, not substrings', () => {
    const idx = new TextIndex('A JavaScript toolkit for machine learning');
    expect(idx.has(compileTerm('java'))).toBe(false);
    expect(idx.has(compileTerm('machine learning'))).toBe(true);
    expect(idx.has(compileTerm('learn'))).toBe(false);
  });

  it('matches CJK terms as substrings', () => {
    expect(new TextIndex('Java 面试指南').has(compileTerm('面试'))).toBe(true);
  });

  it('a term inside a longer matched term is not counted twice', () => {
    const terms = ['mcp', 'mcp server', 'server'].map(compileTerm);
    expect(matchTerms(new TextIndex('An MCP server for files'), terms).map((t) => t.raw)).toEqual(['mcp server']);
  });
});

describe('classification: positive cases', () => {
  it('A. obvious AI agent repository -> AI / AI Agents', () => {
    const r = classifier.classify(repo({ name: 'example-agent', description: 'An autonomous AI agent framework for multi-agent workflows', topics: ['ai-agents', 'agentic-ai', 'python'], language: 'Python' }));
    expect(r.topLevelCategory).toBe('AI');
    expect(slugs(r)).toContain('ai-agents');
    expect(r.positiveSignals.join(' ')).toContain('strong topic "agentic-ai"');
  });

  it('B. LLM repository', () => {
    const r = classifier.classify(repo({ name: 'llm-toolkit', description: 'A toolkit for large language models', topics: ['llm', 'large-language-models'] }));
    expect(slugs(r)).toContain('llm');
    expect(r.topLevelCategory).toBe('AI');
  });

  it('C. RAG repository', () => {
    const r = classifier.classify(repo({ name: 'rag-engine', description: 'A production RAG pipeline with retrieval-augmented generation', topics: ['rag', 'retrieval-augmented-generation', 'embeddings'] }));
    expect(slugs(r)).toContain('rag');
  });

  it('D. genuine MCP repository -> MCP / AI', () => {
    const r = classifier.classify(repo({ name: 'files-mcp-server', description: 'An MCP server exposing local files to AI clients', topics: ['mcp', 'mcp-server'], language: 'TypeScript' }));
    expect(r.topLevelCategory).toBe('AI');
    expect(slugs(r)).toContain('mcp');
  });

  it('E. Java repository -> Java / ENGINEERING', () => {
    const r = classifier.classify(repo({ name: 'java-utils', description: 'Small utilities for Java developers', topics: ['java', 'jvm', 'library'], language: 'Java' }));
    expect(r.topLevelCategory).toBe('ENGINEERING');
    expect(slugs(r)).toContain('java');
  });

  it('F. Spring Boot repository -> Spring', () => {
    const r = classifier.classify(repo({ name: 'starter', description: 'A Spring Boot starter for metrics', topics: ['spring-boot', 'spring'], language: 'Java' }));
    expect(slugs(r)).toContain('spring-boot');
    expect(r.categories.find((c) => c.slug === 'spring-boot')?.name).toBe('Spring');
  });

  it('G. Kafka repository', () => {
    const r = classifier.classify(repo({ name: 'stream-tools', description: 'Tools for Kafka streaming applications', topics: ['kafka', 'apache-kafka'] }));
    expect(slugs(r)).toContain('kafka');
  });

  it('H. Kubernetes repository', () => {
    const r = classifier.classify(repo({ name: 'ops', description: 'A Kubernetes operator with a Helm chart', topics: ['kubernetes', 'helm'], language: 'Go' }));
    expect(slugs(r)).toContain('kubernetes');
    expect(r.topLevelCategory).toBe('ENGINEERING');
  });
});

describe('classification: BOTH, UNKNOWN', () => {
  it('I. AI + Kubernetes serving -> BOTH with categories from both domains', () => {
    const r = classifier.classify(repo({ name: 'llm-k8s-serving', description: 'LLM serving engine on Kubernetes with autoscaling', topics: ['llm-serving', 'llm', 'kubernetes', 'k8s'], language: 'Go' }));
    expect(r.topLevelCategory).toBe('BOTH');
    expect(r.topLevel).toEqual(['AI', 'ENGINEERING']);
    expect(slugs(r)).toEqual(expect.arrayContaining(['kubernetes', 'ai-infrastructure']));
  });

  it('a weak second domain is suppressed instead of forcing BOTH', () => {
    // strong AI evidence; the only engineering evidence is a generic docker tag plus one mention
    const r = classifier.classify(repo({ name: 'agent-lab', description: 'Autonomous AI agents and multi-agent framework, ships with Docker', topics: ['ai-agents', 'agentic-ai', 'multi-agent', 'llm', 'docker'] }));
    expect(r.topLevelCategory).toBe('AI');
    expect(r.signals.suppressed.map((n) => n.slug)).toContain('docker');
    expect(r.negativeSignals.join(' ')).toContain('suppressed Docker');
  });

  it('J. insufficient metadata -> UNKNOWN, never a guess', () => {
    const r = classifier.classify(repo({ name: 'awesome-tools', description: null, topics: [] }));
    expect(r.topLevelCategory).toBe('UNKNOWN');
    expect(r.categories).toEqual([]);
    expect(r.confidence).toBe(0);
    expect(r.confidenceLabel).toBe('none');
    expect(r.classificationReason).toContain('No category evidence');
  });

  it('a single weak keyword is not enough (UNKNOWN)', () => {
    const r = classifier.classify(repo({ name: 'notes', description: 'my notes about ai', topics: [] }));
    expect(r.topLevelCategory).toBe('UNKNOWN');
  });

  it('one strong topic alone is not enough; the reason says what was missing', () => {
    const r = classifier.classify(repo({ name: 'app', description: 'A social network', topics: ['docker'] }));
    expect(r.topLevelCategory).toBe('UNKNOWN');
    expect(r.classificationReason).toContain('Insufficient evidence');
  });

  it('description-only mentions never classify without a strong topic or name (identity evidence)', () => {
    const r = classifier.classify(repo({ name: 'trend-monitor', description: 'News monitor with MCP server support and Model Context Protocol tools', topics: ['news', 'rss'] }));
    expect(r.topLevelCategory).toBe('UNKNOWN');
    expect(r.signals.nearMisses.map((n) => n.slug)).toContain('mcp');
  });
});

describe('classification: negative signals', () => {
  it('K. misleading keyword: a CI "agent" is not an AI agent', () => {
    const r = classifier.classify(repo({ name: 'jenkins-agent', description: 'A Jenkins build agent for CI', topics: ['jenkins', 'agent', 'ci-agent', 'devops'] }));
    expect(slugs(r)).not.toContain('ai-agents');
    expect(r.topLevelCategory).not.toBe('AI');
    const agents = r.signals.nearMisses.find((n) => n.slug === 'ai-agents');
    if (agents) expect(agents.negative.map((n) => n.term)).toEqual(expect.arrayContaining(['ci-agent']));
  });

  it('K. "MCP" also means Minecraft Coder Pack', () => {
    const r = classifier.classify(repo({ name: 'mcp-tools', description: 'Minecraft Coder Pack decompiler tools', topics: ['mcp', 'minecraft', 'modding'] }));
    expect(slugs(r)).not.toContain('mcp');
    expect(r.topLevelCategory).toBe('UNKNOWN');
  });

  it('exclusion keywords are reported as negative signals', () => {
    const r = classifier.classify(repo({ name: 'photo-tools', description: 'Docker image for image generation', topics: ['image-generation', 'text-to-image'] }));
    const image = [...r.signals.accepted, ...r.signals.nearMisses].find((e) => e.slug === 'ai-image');
    expect(image?.negative.some((n) => n.kind === 'exclusion-keyword')).toBe(true);
  });

  it('educational content discounts topic evidence and says so', () => {
    const plain = classifier.classify(repo({ name: 'x', description: 'Kafka streaming and Redis caching', topics: ['kafka', 'apache-kafka', 'redis'] }));
    const edu = classifier.classify(repo({ name: 'x', description: 'Kafka streaming and Redis caching', topics: ['kafka', 'apache-kafka', 'redis', 'tutorial'] }));
    const score = (r: ClassificationResult) => r.signals.accepted.find((e) => e.slug === 'kafka')?.score ?? 0;
    expect(score(edu)).toBeLessThan(score(plain));
    expect(edu.negativeSignals.join(' ')).toContain('educational-content');
    expect(edu.signals.context[0]?.matchedTopics).toEqual(['tutorial']);
  });
});

describe('classification: JavaGuide regression (Phase 2 finding)', () => {
  // Real metadata from the authenticated 500-repository run. Discovery tagged it AI + engineering
  // because of its `mcp` topic. It is a Java/backend interview guide.
  const javaGuide: ClassificationInput = {
    id: '132464395',
    name: 'JavaGuide',
    description: 'Java 面试 & 后端通用面试指南，覆盖计算机基础、数据库、分布式、高并发、系统设计与 AI 应用开发',
    topics: ['java', 'interview', 'redis', 'mysql', 'system-design', 'redisson', 'agent', 'context-engineering', 'mcp', 'skills', 'springai', 'ai', 'deepseek'],
    language: 'JavaScript',
  };

  it('is ENGINEERING / Java and NOT AI, despite the mcp, ai, agent and deepseek topics', () => {
    const r = classifier.classify(javaGuide);
    expect(r.topLevelCategory).toBe('ENGINEERING');
    expect(slugs(r)).toContain('java');
    expect(r.categories.some((c) => c.domain === 'ai')).toBe(false);
    expect(r.topLevel).toEqual(['ENGINEERING']);
  });

  it('explains itself: educational context and the discounted AI topic evidence', () => {
    const r = classifier.classify(javaGuide);
    expect(r.signals.context.map((c) => c.id)).toEqual(['educational-content']);
    expect(r.negativeSignals.join(' ')).toContain('educational-content');
    // the MCP category still has evidence, it is just not enough: it is a reported near miss or below
    const mcp = [...r.signals.accepted, ...r.signals.nearMisses].find((e) => e.slug === 'mcp');
    if (mcp) expect(mcp.score).toBeLessThan(taxonomy.acceptance.minScore);
  });

  it('the mcp topic alone never makes a repository AI', () => {
    const r = classifier.classify(repo({ name: 'JavaGuide', description: 'Java interview guide', topics: ['java', 'interview', 'mcp'] }));
    expect(r.topLevelCategory).toBe('ENGINEERING');
  });

  it('even without the educational signal, a lone mcp topic on a Java repository stays ENGINEERING', () => {
    const r = classifier.classify(repo({ name: 'billing-service', description: 'Java billing microservice', topics: ['java', 'spring-boot', 'microservices', 'mcp'], language: 'Java' }));
    expect(r.topLevel).not.toContain('AI');
  });

  it('the result does not depend on how discovery found it', () => {
    const asCandidate = (domains: Array<'ai' | 'engineering'>, categories: string[]): CandidateRecord => ({
      id: javaGuide.id, owner: 'Snailclimb', name: javaGuide.name, fullName: 'Snailclimb/JavaGuide', url: 'u', description: javaGuide.description, language: javaGuide.language,
      topics: [...javaGuide.topics], license: null, createdAt: '2018-05-07T13:27:00Z', updatedAt: '2026-09-25T00:00:00Z', pushedAt: null, isArchived: false,
      stars: 1, forks: 1, openIssues: 0, metadataSource: 'graphql', collectedAt: '2026-09-25T00:00:00Z', discovery: { domains, queryCategories: categories, hits: 3 },
    });
    const a = classifier.classify(toClassificationInput(asCandidate(['ai'], ['mcp'])));
    const b = classifier.classify(toClassificationInput(asCandidate(['engineering'], ['java', 'redis'])));
    expect(a).toEqual(b);
    expect(Object.keys(toClassificationInput(asCandidate(['ai'], ['mcp'])))).toEqual(['id', 'name', 'description', 'topics', 'language']);
  });
});

describe('classification: normalization, duplicates, determinism', () => {
  it('M. MCP / mcp / Model Context Protocol are the same evidence', () => {
    const viaTopic = classifier.classify(repo({ name: 'x-mcp', topics: ['MCP', 'Mcp-Server'], description: 'server' }));
    const viaName = classifier.classify(repo({ name: 'x-MCP', topics: ['mcp'], description: 'server' }));
    const viaPhrase = classifier.classify(repo({ name: 'x', topics: ['model-context-protocol'], description: 'A MODEL CONTEXT PROTOCOL server' }));
    for (const r of [viaTopic, viaName, viaPhrase]) expect(slugs(r)).toContain('mcp');
  });

  it('N. repeating a keyword does not inflate the score', () => {
    const once = classifier.classify(repo({ name: 'a', description: 'llm framework', topics: ['llm'] }));
    const many = classifier.classify(repo({ name: 'a', description: 'llm llm llm llm llm framework llm', topics: ['llm', 'LLM', 'llm'] }));
    const score = (r: ClassificationResult) => r.categories.find((c) => c.slug === 'llm')?.score;
    expect(score(many)).toBe(score(once));
  });

  it('strong topics have diminishing returns and a hard ceiling', () => {
    const three = classifier.classify(repo({ name: 'a', topics: ['llm', 'llms', 'langchain'], description: 'llm library' }));
    const six = classifier.classify(repo({ name: 'a', topics: ['llm', 'llms', 'langchain', 'llamaindex', 'litellm', 'language-model'], description: 'llm library' }));
    const topicPoints = (r: ClassificationResult) => r.signals.accepted.find((e) => e.slug === 'llm')!.positive.filter((s) => s.kind === 'strong-topic').reduce((n, s) => n + s.weight, 0);
    expect(topicPoints(three)).toBe(7);
    expect(topicPoints(six)).toBe(7);
  });

  it('P. same input -> identical output, independent of topic order and repeated calls', () => {
    const input = repo({ name: 'llm-k8s-serving', description: 'Serve LLM models on Kubernetes', topics: ['llm-serving', 'llm', 'kubernetes', 'k8s'] });
    const a = classifier.classify(input);
    const b = classifier.classify({ ...input, topics: [...input.topics].reverse() });
    const c = new Classifier(loadTaxonomy()).classify(input);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(JSON.stringify(classifier.classify(input))).toBe(JSON.stringify(a));
  });

  it('carries the classifier version in every result', () => {
    expect(classifier.classify(repo({ name: 'x' })).classifierVersion).toBe('phase3-v1');
  });

  it('README evidence is supported, lightly weighted, and never sufficient alone', () => {
    const base = repo({ name: 'notes', description: 'my project', topics: [] });
    const readme = 'This is an MCP server. Model Context Protocol clients can call it.';
    expect(classifier.classify({ ...base, readme }).topLevelCategory).toBe('UNKNOWN'); // README alone: no identity evidence
    const topicOnly = classifier.classify({ ...base, topics: ['mcp'] });
    const topicPlusReadme = classifier.classify({ ...base, topics: ['mcp'], readme });
    expect(topicOnly.topLevelCategory).toBe('UNKNOWN'); // 4 points
    expect(topicPlusReadme.topLevelCategory).toBe('AI'); // 4 + 2 README points
    expect(topicPlusReadme.signals.accepted[0]!.positive.filter((p) => p.kind === 'readme-strong')).toHaveLength(2);
  });

  it('configuration drives behaviour: a stricter threshold turns a match into UNKNOWN', () => {
    const strict = loadTaxonomy();
    strict.acceptance.minScore = 100;
    strict.acceptance.corroboratedMinScore = 100;
    const r = new Classifier(strict).classify(repo({ name: 'example-agent', description: 'An autonomous AI agent', topics: ['ai-agents', 'agentic-ai'] }));
    expect(r.topLevelCategory).toBe('UNKNOWN');
  });
});

describe('real-repository fixtures (expectations written from metadata before running the classifier)', () => {
  interface Fixture {
    input: ClassificationInput;
    fullName: string;
    discovery: { domains: string[]; categories: string[] };
    expect: { top: string[]; includes: string[]; excludesDomains: string[] };
    rationale: string;
  }
  const fixtures = JSON.parse(readFileSync('tests/fixtures/real-repos.json', 'utf8')).repositories as Fixture[];

  it('covers every required kind of repository', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    expect(fixtures.map((f) => f.fullName)).toContain('Snailclimb/JavaGuide');
  });

  it.each(fixtures.map((f) => [f.fullName, f] as const))('%s', (_name, f) => {
    const r = classifier.classify(f.input);
    expect(f.expect.top, `${f.fullName}: ${f.rationale}\n${r.classificationReason}`).toContain(r.topLevelCategory);
    for (const slug of f.expect.includes) expect(slugs(r), `${f.fullName} should include ${slug}: ${r.classificationReason}`).toContain(slug);
    for (const d of f.expect.excludesDomains) expect(r.categories.some((c) => c.domain === d), `${f.fullName} must not have ${d} categories: ${r.classificationReason}`).toBe(false);
  });
});

describe('classified dataset', () => {
  const cand = (id: string, name: string, topics: string[], description: string, discoveryDomain: 'ai' | 'engineering'): CandidateRecord => ({
    id, owner: 'o', name, fullName: `o/${name}`, url: 'u', description, language: null, topics, license: null, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', pushedAt: null, isArchived: false, stars: 10, forks: 0, openIssues: 0, metadataSource: 'rest',
    collectedAt: '2026-09-25T00:00:00Z', discovery: { domains: [discoveryDomain], queryCategories: [], hits: 1 },
  });
  const source = buildCandidateDataset(
    [
      { snapshot: { repositoryId: '2', owner: 'o', name: 'kafka-tools', fullName: 'o/kafka-tools', url: 'u', description: 'Kafka tooling', stars: 9, forks: 0, openIssues: 0, language: null, topics: ['kafka', 'apache-kafka'], license: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', collectedAt: '2026-09-25T00:00:00Z' }, domains: ['ai'], categories: ['llm'], hits: 1 },
    ],
    [],
    new Date('2026-09-25T00:00:00Z'),
  );

  it('classifies by id, stays valid, and is not influenced by the discovery domain (a Kafka repo found by an AI query is ENGINEERING)', () => {
    const ds = classifyCandidates(source, classifier, new Date('2026-09-25T01:00:00Z'));
    expect(ds.repositories).toHaveLength(1);
    expect(ds.repositories[0]!.id).toBe('2');
    expect(ds.repositories[0]!.result.topLevelCategory).toBe('ENGINEERING');
    expect(source.candidates[0]!.discovery.domains).toEqual(['ai']);
    expect(validateClassifiedDataset(ds)).toEqual([]);
    expect(ds.summary.byTopLevel).toEqual({ AI: 0, ENGINEERING: 1, BOTH: 0, UNKNOWN: 0 });
    expect(ds.summary.byCategory).toEqual({ kafka: 1 });
  });

  it('validation catches contradictions', () => {
    const ds = classifyCandidates(source, classifier, new Date());
    const bad = JSON.parse(JSON.stringify(ds));
    bad.repositories[0].result.topLevelCategory = 'AI';
    expect(validateClassifiedDataset(bad).join(' ')).toContain('contradicts its categories');
    bad.repositories.push(bad.repositories[0]);
    expect(validateClassifiedDataset(bad).join(' ')).toContain('duplicated');
    expect(validateClassifiedDataset(null)).toEqual(['classified dataset is not an object']);
  });

  it('summary counts every top-level class', () => {
    const results = [cand('1', 'a', [], 'nothing', 'ai'), cand('3', 'k', ['kafka', 'apache-kafka'], 'kafka', 'ai')].map((c) => ({ id: c.id, fullName: c.fullName, result: classifier.classify(toClassificationInput(c)) }));
    expect(summarize(results).byTopLevel).toEqual({ AI: 0, ENGINEERING: 1, BOTH: 0, UNKNOWN: 1 });
  });
});

describe('acceptance: corroborated lower threshold (supported, disabled by default)', () => {
  // couchdb-like: one strong topic (4) + one weak description mention (1) = 5, two evidence kinds
  const input = { id: '1', name: 'pouch', description: 'A pocket-sized database', topics: ['database', 'javascript'], language: null };

  it('is off by default: precision is preferred (measured: it recovered 201 repositories but roughly 1 in 10 was wrong)', () => {
    expect(taxonomy.acceptance.corroboratedMinScore).toBe(taxonomy.acceptance.minScore);
    expect(classifier.classify(input).topLevelCategory).toBe('UNKNOWN');
  });

  it('when enabled in configuration, topic + description agreement is enough at the lower score', () => {
    const loose = loadTaxonomy();
    loose.acceptance.corroboratedMinScore = 5;
    const r = new Classifier(loose).classify(input);
    expect(r.topLevelCategory).toBe('ENGINEERING');
    expect(slugs(r)).toContain('databases');
    // a lone strong topic (one evidence kind) still is not enough
    expect(new Classifier(loose).classify({ ...input, description: null }).topLevelCategory).toBe('UNKNOWN');
  });
});
