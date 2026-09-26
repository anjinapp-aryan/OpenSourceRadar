// Writes the `classification` block of every category in config/categories/*.json and
// config/classification.json (global scoring). The JSON files are the source of truth
// afterwards; this script only keeps the ~1,000 terms reviewable in one place.
//
// Vocabulary provenance: topic aliases were adapted from GitHub's github/explore topic
// pages (CC BY 4.0, see THIRD_PARTY.md); ambiguity rules (exclusions) come from the
// measured 500-repository dataset (docs/CLASSIFICATION.md, "Evidence").
import { readFileSync, writeFileSync } from 'node:fs';

/** slug -> classification block. strong* = specific to the category; weak* = supportive only. */
const rules = {
  // ------------------------------------------------------------------ AI
  'ai-agents': {
    strongTopics: ['ai-agents', 'ai-agent', 'ai-autonomous-agent', 'agentic-ai', 'agentic', 'autonomous-agents', 'autonomous-agent', 'multi-agent', 'multi-agents', 'multi-agent-systems', 'agents-sdk', 'aiagentframework', 'agent-framework'],
    weakTopics: ['agent', 'agents', 'agentic-workflow', 'orchestration', 'workflow'],
    strongKeywords: ['ai agent', 'ai agents', 'agentic', 'autonomous agent', 'autonomous agents', 'multi-agent', 'multi agent', 'agent framework', 'llm agent', 'coding agent'],
    weakKeywords: ['agent', 'agents', 'orchestration', 'tool use'],
    exclusionTopics: ['build-agent', 'ci-agent', 'user-agent', 'ssh-agent', 'jenkins-agent', 'monitoring-agent', 'zabbix-agent', 'http-agent'],
    exclusionKeywords: ['build agent', 'user agent', 'ssh agent', 'jenkins agent', 'monitoring agent', 'ci agent', 'deployment agent', 'real estate agent', 'travel agent', 'insurance agent', 'agent based modeling', 'agent-based modeling'],
  },
  llm: {
    strongTopics: ['llm', 'llms', 'large-language-model', 'large-language-models', 'language-model', 'language-models', 'langchain', 'llamaindex', 'litellm'],
    weakTopics: ['openai', 'chatgpt', 'gpt', 'gpt-4', 'claude', 'anthropic', 'gemini', 'deepseek', 'qwen', 'llama', 'mistral', 'transformers', 'prompt-engineering', 'prompts', 'nlp', 'natural-language-processing', 'chatbot'],
    strongKeywords: ['llm', 'llms', 'large language model', 'large language models', 'language model'],
    weakKeywords: ['openai', 'chatgpt', 'gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'transformer', 'chatbot'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  rag: {
    strongTopics: ['rag', 'retrieval-augmented-generation', 'rag-pipeline', 'graphrag', 'agentic-rag'],
    weakTopics: ['embeddings', 'vector-database', 'vector-search', 'semantic-search', 'knowledge-base', 'vector-store'],
    strongKeywords: ['rag', 'retrieval augmented generation', 'retrieval-augmented', 'graphrag'],
    weakKeywords: ['vector search', 'embeddings', 'knowledge base', 'semantic search', 'vector database'],
    exclusionTopics: [],
    exclusionKeywords: ['rag doll', 'ragdoll', 'rag tag', 'ragnarok'],
  },
  mcp: {
    strongTopics: ['mcp', 'model-context-protocol', 'mcp-server', 'mcp-servers', 'mcp-client', 'mcp-tools'],
    weakTopics: ['mcp-host'],
    strongKeywords: ['mcp', 'model context protocol', 'mcp server', 'mcp servers', 'mcp client'],
    weakKeywords: [],
    // MCP is also "Minecraft Coder Pack" and "Microsoft Certified Professional".
    exclusionTopics: ['minecraft', 'minecraft-mod', 'forge', 'modding'],
    exclusionKeywords: ['minecraft', 'coder pack', 'certified professional'],
  },
  'ai-coding': {
    strongTopics: ['ai-coding', 'ai-coding-assistant', 'coding-assistant', 'coding-agent', 'code-generation', 'claude-code', 'github-copilot', 'vibe-coding', 'code-completion', 'ai-code-review', 'ai-pair-programming', 'aider', 'cline'],
    weakTopics: ['codex', 'cursor', 'copilot', 'agent-skills', 'skills', 'code-review', 'ai-tools'],
    strongKeywords: ['ai coding', 'coding assistant', 'coding agent', 'code generation', 'claude code', 'github copilot', 'vibe coding', 'ai pair programming', 'code completion', 'ai code review'],
    weakKeywords: ['copilot', 'cursor', 'codex', 'code review'],
    exclusionTopics: ['mouse-cursor', 'cursors', 'cursor-theme', 'xcursor', 'cursor-icons'],
    exclusionKeywords: ['mouse cursor', 'database cursor', 'cursor position', 'cursor theme'],
  },
  'local-ai': {
    strongTopics: ['local-llm', 'local-ai', 'localai', 'ollama', 'llama-cpp', 'llamacpp', 'on-device-ai', 'gguf', 'offline-ai', 'mlx', 'lm-studio'],
    weakTopics: ['self-hosted', 'privacy', 'offline', 'edge-ai'],
    strongKeywords: ['local llm', 'local ai', 'run llms locally', 'ollama', 'llama.cpp', 'on-device', 'gguf', 'offline ai'],
    weakKeywords: ['self-hosted', 'privacy', 'offline', 'locally'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  multimodal: {
    strongTopics: ['multimodal', 'multimodal-ai', 'multimodal-llm', 'vision-language-model', 'vlm', 'speech-to-text', 'text-to-speech', 'tts', 'asr', 'speech-recognition', 'whisper', 'ocr'],
    weakTopics: ['computer-vision', 'audio', 'image-recognition', 'speech', 'voice'],
    strongKeywords: ['multimodal', 'vision language', 'vision-language', 'speech recognition', 'text to speech', 'speech to text', 'ocr', 'voice cloning'],
    weakKeywords: ['vision', 'audio', 'speech', 'voice'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  'ai-infrastructure': {
    strongTopics: ['llm-inference', 'llm-serving', 'llm-inference-server', 'model-serving', 'inference-engine', 'inference-server', 'mlops', 'llmops', 'vllm', 'tensorrt', 'triton-inference-server', 'distributed-training', 'model-deployment', 'kv-cache', 'quantization'],
    weakTopics: ['gpu', 'cuda', 'inference', 'training', 'serving', 'deployment'],
    strongKeywords: ['inference engine', 'inference server', 'model serving', 'llm inference', 'llm serving', 'mlops', 'llmops', 'distributed training', 'gpu cluster', 'model deployment'],
    weakKeywords: ['inference', 'gpu', 'cuda', 'quantization', 'serving', 'throughput'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  'ai-developer-tools': {
    strongTopics: ['llm-evaluation', 'llm-observability', 'llm-gateway', 'llm-proxy', 'llm-router', 'llm-testing', 'prompt-management', 'ai-sdk', 'agent-observability', 'guardrails', 'evals'],
    weakTopics: ['prompt-engineering', 'prompts', 'sdk', 'evaluation', 'observability', 'tracing', 'gateway', 'playground'],
    strongKeywords: ['llm evaluation', 'llm observability', 'llm gateway', 'llm proxy', 'prompt management', 'ai sdk', 'llm sdk', 'agent observability', 'evals', 'guardrails'],
    weakKeywords: ['prompt', 'prompts', 'sdk', 'evaluation', 'tracing', 'gateway'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  'machine-learning': {
    strongTopics: ['machine-learning', 'machine-learning-algorithms', 'deep-learning', 'neural-network', 'neural-networks', 'pytorch', 'tensorflow', 'scikit-learn', 'reinforcement-learning', 'jax', 'keras', 'xgboost'],
    weakTopics: ['ai', 'artificial-intelligence', 'data-science', 'nlp', 'computer-vision', 'transformers', 'ml', 'research'],
    strongKeywords: ['machine learning', 'deep learning', 'neural network', 'neural networks', 'reinforcement learning', 'pytorch', 'tensorflow', 'scikit-learn'],
    weakKeywords: ['ml', 'model', 'models', 'training', 'dataset'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  'generative-ai': {
    strongTopics: ['generative-ai', 'genai', 'gen-ai', 'generative-model', 'generative-models', 'diffusion-models', 'text-generation'],
    weakTopics: ['ai', 'artificial-intelligence', 'chatgpt', 'gpt', 'prompt'],
    strongKeywords: ['generative ai', 'genai', 'gen ai', 'text generation', 'generative model'],
    weakKeywords: ['ai', 'artificial intelligence'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  'ai-image': {
    strongTopics: ['text-to-image', 'image-generation', 'stable-diffusion', 'comfyui', 'ai-art', 'flux', 'sdxl'],
    weakTopics: ['diffusion', 'generative-art', 'lora', 'image-editing'],
    strongKeywords: ['text to image', 'text-to-image', 'image generation', 'stable diffusion', 'comfyui', 'ai art', 'image generator'],
    weakKeywords: ['diffusion', 'flux', 'lora', 'image editing'],
    exclusionTopics: [],
    exclusionKeywords: ['docker image', 'container image', 'disk image', 'base image', 'image registry', 'iso image'],
  },
  'ai-video': {
    strongTopics: ['text-to-video', 'video-generation', 'ai-video', 'ai-video-generation', 'image-to-video', 'video-diffusion'],
    weakTopics: ['video-editing', 'video', 'animation', 'sora', 'veo'],
    strongKeywords: ['text to video', 'text-to-video', 'video generation', 'image to video', 'ai video', 'video generator'],
    weakKeywords: ['video editing', 'video', 'animation'],
    exclusionTopics: ['video-player', 'video-downloader', 'youtube-dl', 'video-streaming'],
    exclusionKeywords: ['video player', 'video downloader', 'video conferencing', 'video streaming', 'video game'],
  },
  'ai-music': {
    strongTopics: ['ai-music', 'music-generation', 'text-to-music', 'audio-generation', 'singing-voice-synthesis', 'music-ai', 'ai-audio'],
    weakTopics: ['music', 'audio', 'midi', 'sound'],
    strongKeywords: ['music generation', 'text-to-music', 'text to music', 'ai music', 'audio generation', 'singing voice', 'song generation'],
    weakKeywords: ['music', 'audio', 'midi'],
    exclusionTopics: ['music-player', 'spotify', 'music-streaming'],
    exclusionKeywords: ['music player', 'music streaming', 'spotify', 'music library', 'music bot', 'discord music', 'music downloader'],
  },
  // --------------------------------------------------------- Engineering
  java: {
    strongTopics: ['java', 'java-8', 'java8', 'java-11', 'java11', 'java-17', 'java-21', 'javase', 'java-se', 'jvm', 'jdk', 'openjdk', 'java-library', 'jakarta-ee'],
    weakTopics: ['kotlin', 'scala', 'maven', 'gradle', 'junit'],
    strongKeywords: ['java', 'jvm', 'jdk', 'openjdk', 'jakarta'],
    weakKeywords: ['kotlin', 'scala', 'maven', 'gradle'],
    exclusionTopics: [],
    exclusionKeywords: [],
    languages: { Java: 3, Kotlin: 1, Scala: 1 },
  },
  'spring-boot': {
    strongTopics: ['spring-boot', 'springboot', 'spring', 'spring-framework', 'spring-cloud', 'spring-security', 'spring-data', 'spring-mvc', 'spring-webflux', 'spring-batch'],
    weakTopics: ['springai', 'spring-ai', 'jpa', 'hibernate', 'mybatis'],
    strongKeywords: ['spring boot', 'springboot', 'spring framework', 'spring cloud', 'spring security', 'spring data'],
    weakKeywords: ['spring', 'jpa', 'hibernate', 'mybatis'],
    exclusionTopics: ['react-spring', 'spring-animation', 'animation'],
    exclusionKeywords: ['spring cleaning', 'spring break', 'spring animation', 'react spring', 'spring physics'],
    languages: { Java: 1, Kotlin: 1 },
  },
  microservices: {
    strongTopics: ['microservices', 'microservice', 'service-mesh', 'api-gateway', 'istio', 'envoy', 'dapr', 'service-discovery'],
    weakTopics: ['grpc', 'rest-api', 'api', 'consul', 'gateway', 'distributed'],
    strongKeywords: ['microservice', 'microservices', 'service mesh', 'api gateway', 'service discovery'],
    weakKeywords: ['grpc', 'gateway', 'rest api'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  kafka: {
    strongTopics: ['kafka', 'apache-kafka', 'kafka-streams', 'kafka-connect', 'kafka-consumer', 'kafka-producer', 'redpanda', 'ksqldb', 'event-streaming', 'schema-registry'],
    weakTopics: ['streaming', 'pubsub', 'message-queue', 'message-broker', 'event-driven', 'event-sourcing', 'rabbitmq', 'pulsar'],
    strongKeywords: ['kafka', 'redpanda', 'event streaming', 'kafka streams'],
    weakKeywords: ['message broker', 'message queue', 'event driven', 'pub/sub'],
    exclusionTopics: [],
    exclusionKeywords: ['franz kafka', 'kafka on the shore', 'kafkaesque'],
  },
  kubernetes: {
    strongTopics: ['kubernetes', 'k8s', 'helm', 'kubectl', 'kustomize', 'k3s', 'kubernetes-operator', 'kubebuilder', 'kubeadm', 'cni'],
    weakTopics: ['cloud-native', 'containers', 'container-orchestration', 'gitops', 'cncf', 'operator', 'service-mesh'],
    strongKeywords: ['kubernetes', 'k8s', 'helm', 'kubectl', 'kustomize', 'k3s'],
    weakKeywords: ['cloud native', 'container orchestration', 'operator', 'cncf'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  docker: {
    strongTopics: ['docker', 'docker-container', 'dockerfile', 'podman', 'container-runtime', 'containerd', 'buildkit', 'docker-image'],
    weakTopics: ['docker-compose', 'containers', 'containerization', 'docker-hub', 'oci'],
    strongKeywords: ['docker', 'dockerfile', 'docker compose', 'podman', 'containerd'],
    weakKeywords: ['container', 'containers', 'oci'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  aws: {
    strongTopics: ['aws', 'amazon-web-services', 'aws-lambda', 'aws-cdk', 'aws-sdk', 'aws-cli', 'cloudformation', 'dynamodb', 'ec2', 'eks', 'boto3'],
    weakTopics: ['serverless', 'cloud', 'amazon', 's3'],
    strongKeywords: ['aws', 'amazon web services', 'aws lambda', 'aws cdk', 'cloudformation', 'dynamodb'],
    weakKeywords: ['amazon', 'serverless', 's3'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  cloud: {
    strongTopics: ['cloud-native', 'cloud-computing', 'multi-cloud', 'gcp', 'google-cloud', 'azure', 'cloud-infrastructure', 'cloudflare'],
    weakTopics: ['cloud', 'serverless', 'paas', 'iaas', 'cloudflare-workers'],
    strongKeywords: ['cloud native', 'cloud computing', 'multi-cloud', 'multi cloud', 'google cloud', 'azure', 'gcp'],
    weakKeywords: ['cloud', 'serverless'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  postgresql: {
    strongTopics: ['postgresql', 'postgres', 'pgsql', 'psql', 'plpgsql', 'pgvector', 'timescaledb', 'postgres-extension', 'pgbouncer', 'citus'],
    weakTopics: ['sql', 'database', 'supabase'],
    strongKeywords: ['postgresql', 'postgres', 'pgvector', 'timescaledb', 'pgbouncer'],
    weakKeywords: ['sql', 'supabase'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  redis: {
    strongTopics: ['redis', 'redis-db', 'redisdb', 'valkey', 'redis-cluster', 'redis-client', 'keydb', 'dragonfly', 'redisson'],
    weakTopics: ['cache', 'caching', 'key-value', 'in-memory-database', 'kv-store', 'memcached'],
    strongKeywords: ['redis', 'valkey', 'keydb', 'dragonfly'],
    weakKeywords: ['cache', 'caching', 'key-value', 'in-memory'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  databases: {
    strongTopics: ['database', 'databases', 'sql', 'nosql', 'olap', 'oltp', 'sqlite', 'duckdb', 'mysql', 'mariadb', 'mongodb', 'clickhouse', 'distributed-database', 'time-series-database', 'key-value-store', 'newsql', 'dbms'],
    weakTopics: ['orm', 'data-engineering', 'analytics', 'etl', 'query-engine', 'vector-database'],
    strongKeywords: ['sql engine', 'olap', 'key-value store', 'dbms', 'sqlite', 'duckdb', 'mysql', 'mariadb', 'mongodb', 'clickhouse'],
    weakKeywords: ['database', 'databases', 'sql', 'orm', 'analytics'],
    exclusionTopics: [],
    exclusionKeywords: ['database of'],
  },
  devops: {
    strongTopics: ['devops', 'dev-ops', 'ci-cd', 'cicd', 'gitops', 'github-actions', 'argocd', 'jenkins', 'continuous-integration', 'continuous-delivery', 'continuous-deployment', 'gitlab-ci', 'tekton', 'release-automation'],
    weakTopics: ['automation', 'pipeline', 'deployment', 'sre', 'infrastructure', 'monitoring'],
    strongKeywords: ['devops', 'ci/cd', 'gitops', 'github actions', 'continuous integration', 'continuous delivery', 'argo cd', 'jenkins'],
    weakKeywords: ['automation', 'pipeline', 'deployment', 'sre'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  observability: {
    strongTopics: ['observability', 'opentelemetry', 'otel', 'tracing', 'distributed-tracing', 'prometheus', 'grafana', 'apm'],
    weakTopics: ['monitoring', 'metrics', 'logging', 'logs', 'alerting', 'telemetry', 'dashboards'],
    strongKeywords: ['observability', 'opentelemetry', 'distributed tracing', 'prometheus', 'grafana', 'apm'],
    weakKeywords: ['monitoring', 'metrics', 'logging', 'telemetry', 'alerting'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  security: {
    strongTopics: ['security', 'security-tools', 'cybersecurity', 'infosec', 'devsecops', 'vulnerability-scanner', 'pentesting', 'penetration-testing', 'sast', 'dast', 'malware', 'cve', 'exploit', 'red-team', 'blue-team', 'siem', 'owasp', 'appsec', 'supply-chain-security', 'secrets-detection'],
    weakTopics: ['privacy', 'encryption', 'cryptography', 'authentication', 'auth', 'oauth', 'vulnerability', 'hacking'],
    strongKeywords: ['security', 'cybersecurity', 'devsecops', 'pentest', 'penetration testing', 'vulnerability', 'sast', 'malware', 'exploit', 'owasp', 'red team'],
    weakKeywords: ['privacy', 'encryption', 'authentication', 'password'],
    exclusionTopics: [],
    exclusionKeywords: ['security camera', 'surveillance camera', 'home security'],
  },
  'distributed-systems': {
    strongTopics: ['distributed-systems', 'distributed-computing', 'consensus', 'raft', 'paxos', 'crdt', 'distributed-database', 'replication', 'sharding'],
    weakTopics: ['distributed', 'p2p', 'high-availability', 'scalability', 'fault-tolerance', 'cluster'],
    strongKeywords: ['distributed system', 'distributed systems', 'consensus', 'raft', 'paxos', 'crdt', 'replication', 'sharding', 'fault tolerance'],
    weakKeywords: ['distributed', 'cluster', 'high availability', 'scalability'],
    exclusionTopics: ['blockchain', 'cryptocurrency', 'web3', 'bitcoin', 'ethereum', 'smart-contracts'],
    exclusionKeywords: ['distributed ledger', 'blockchain'],
  },
  'system-design': {
    strongTopics: ['system-design', 'system-design-interview', 'software-architecture', 'design-patterns', 'domain-driven-design', 'ddd', 'clean-architecture', 'hexagonal-architecture', 'event-driven-architecture', 'cqrs', 'architecture'],
    weakTopics: ['patterns', 'software-design', 'best-practices'],
    strongKeywords: ['system design', 'software architecture', 'design patterns', 'domain driven design', 'ddd', 'clean architecture', 'hexagonal architecture', 'cqrs', '系统设计'],
    weakKeywords: ['architecture', 'patterns', 'best practices'],
    exclusionTopics: [],
    exclusionKeywords: ['cpu architecture', 'instruction set', 'computer architecture', 'x86 architecture', 'arm architecture'],
  },
  'developer-tools': {
    strongTopics: ['developer-tools', 'devtools', 'developer-productivity', 'developer-experience', 'dx', 'code-editor', 'ide', 'linter', 'formatter', 'debugger', 'static-analysis', 'code-quality'],
    weakTopics: ['cli', 'terminal', 'command-line', 'productivity', 'tools', 'utility', 'vscode-extension', 'automation'],
    strongKeywords: ['developer tools', 'developer tool', 'developer productivity', 'developer experience', 'devtools', 'code editor', 'ide', 'linter', 'formatter', 'debugger', 'static analysis'],
    weakKeywords: ['cli', 'terminal', 'command line', 'productivity', 'tool'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
  'infrastructure-as-code': {
    strongTopics: ['infrastructure-as-code', 'iac', 'terraform', 'hashicorp-terraform', 'terraform-module', 'terraform-modules', 'terraform-providers', 'opentofu', 'pulumi', 'ansible', 'crossplane', 'terragrunt', 'bicep', 'packer'],
    weakTopics: ['provisioning', 'configuration-management', 'infrastructure', 'hcl', 'cdk'],
    strongKeywords: ['infrastructure as code', 'iac', 'terraform', 'opentofu', 'pulumi', 'ansible', 'terragrunt', 'crossplane', 'cloudformation'],
    weakKeywords: ['provisioning', 'configuration management'],
    exclusionTopics: [],
    exclusionKeywords: [],
    languages: { HCL: 3 },
  },
  testing: {
    strongTopics: ['testing', 'testing-tools', 'testing-framework', 'test-automation', 'unit-testing', 'e2e-testing', 'end-to-end-testing', 'integration-testing', 'cypress', 'jest', 'pytest', 'junit', 'load-testing', 'fuzzing', 'mutation-testing', 'test-framework', 'mocking', 'tdd', 'bdd'],
    // playwright/selenium/puppeteer are as often used for browser automation as for testing
    weakTopics: ['test', 'tests', 'playwright', 'selenium', 'puppeteer', 'qa', 'quality', 'coverage', 'benchmark', 'assertions'],
    strongKeywords: ['testing framework', 'test automation', 'unit test', 'unit testing', 'e2e testing', 'end-to-end testing', 'integration testing', 'load testing', 'fuzzing', 'mutation testing', 'test runner', 'cypress', 'pytest', 'jest', 'junit'],
    weakKeywords: ['testing', 'test', 'tests', 'qa', 'mock', 'mocking', 'playwright', 'selenium'],
    exclusionTopics: [],
    exclusionKeywords: [],
  },
};

const NAMES = { 'spring-boot': 'Spring' };

for (const file of ['ai', 'engineering']) {
  const path = `config/categories/${file}.json`;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  for (const c of doc.categories) {
    const r = rules[c.slug];
    if (!r) throw new Error(`no classification rules for ${c.slug}`);
    const { languages, ...lists } = r;
    for (const [k, v] of Object.entries(lists)) lists[k] = [...new Set(v.map((x) => x.toLowerCase()))];
    c.classification = { ...lists, languages: languages ?? {} };
    if (NAMES[c.slug]) c.name = NAMES[c.slug];
  }
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${file}: ${doc.categories.length} categories`);
}

const global = {
  schemaVersion: 1,
  classifierVersion: 'phase3-v1',
  // CONFIGURED initial weights; see docs/CLASSIFICATION.md for how each was chosen and how it is tested.
  weights: {
    strongTopic: [4, 2, 1], // 1st, 2nd, 3rd+ distinct strong topic (diminishing: repeated tags do not explode the score)
    weakTopic: 1.5,
    weakTopicMax: 3,
    nameStrong: 3,
    nameWeak: 1,
    descriptionStrong: 3,
    descriptionStrongMax: 2,
    descriptionWeak: 1,
    descriptionWeakMax: 2,
    readmeStrong: 1,
    readmeStrongMax: 2,
    exclusionTopic: -6,
    exclusionKeyword: -4,
    exclusionKeywordMax: 2,
  },
  acceptance: { minScore: 6, minEvidenceKinds: 1, requireIdentityEvidence: true, bothMinRatio: 0.5, corroboratedMinScore: 6, corroboratedMinKinds: 2 },
  confidence: { halfScore: 8, high: 0.7, medium: 0.5 },
  contextSignals: [
    {
      id: 'educational-content',
      description: 'Interview prep, tutorials, courses, roadmaps and curated lists describe a subject without being an implementation of it; topics on such repositories are frequently broad tags, not the repository\'s subject.',
      topics: ['interview', 'interview-questions', 'interview-preparation', 'coding-interview', 'leetcode', 'interviews', 'tutorial', 'tutorials', 'course', 'courses', 'curriculum', 'cheatsheet', 'cheat-sheet', 'roadmap', 'awesome', 'awesome-list', 'awesome-lists', 'lessons', 'study-notes', 'learning-resources'],
      keywords: ['interview', 'interviews', 'tutorial', 'tutorials', 'course', 'courses', 'curriculum', 'cheatsheet', 'roadmap', 'lessons', 'study notes', 'awesome list', '面试', '教程', '指南', '学习笔记'],
      effect: { topicEvidenceFactor: 0.5, domains: ['ai', 'engineering'] },
    },
  ],
};
writeFileSync('config/classification.json', JSON.stringify(global, null, 2) + '\n');
console.log('config/classification.json written');
