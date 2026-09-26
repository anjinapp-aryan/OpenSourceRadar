// One-off generator kept in the repo so the category JSON stays reproducible and consistent.
// Usage: node scripts/gen-category-config.mjs   (writes config/categories/*.json)
// The JSON files are the source of truth afterwards; edit them directly if you prefer.
import { mkdirSync, writeFileSync } from 'node:fs';

/** [slug, name, description, topics (first two drive queries), keywords] */
const ai = [
  ['ai-agents', 'AI Agents', 'Autonomous and multi-agent frameworks and agent applications', ['ai-agents', 'agentic-ai', 'agents', 'autonomous-agents', 'multi-agent', 'ai-agent'], ['ai agent', 'agentic', 'autonomous agent', 'multi-agent', 'tool use']],
  ['llm', 'LLM', 'Large language models, LLM frameworks and applications', ['llm', 'large-language-models', 'llms', 'langchain', 'llama', 'openai'], ['llm', 'large language model', 'langchain', 'llamaindex']],
  ['rag', 'RAG', 'Retrieval-augmented generation, embeddings and semantic search', ['rag', 'retrieval-augmented-generation', 'embeddings', 'semantic-search', 'vector-database'], ['rag', 'retrieval augmented', 'vector search', 'embeddings', 'knowledge base']],
  ['mcp', 'MCP', 'Model Context Protocol servers, clients and tooling', ['mcp', 'model-context-protocol', 'mcp-server', 'mcp-client'], ['mcp', 'model context protocol']],
  ['ai-coding', 'AI Coding', 'AI coding assistants, code generation and code agents', ['ai-coding', 'code-generation', 'coding-assistant', 'copilot', 'claude-code', 'vibe-coding', 'code-completion'], ['coding assistant', 'code generation', 'copilot', 'ai pair programming', 'claude code']],
  ['local-ai', 'Local AI', 'Running models locally and on-device', ['local-llm', 'ollama', 'llama-cpp', 'on-device-ai', 'gguf', 'self-hosted'], ['local llm', 'ollama', 'llama.cpp', 'on-device', 'offline llm']],
  ['multimodal', 'Multimodal', 'Vision-language, speech and other multimodal models', ['multimodal', 'vision-language-model', 'vlm', 'speech-recognition', 'text-to-speech', 'ocr'], ['multimodal', 'vision language', 'vlm', 'speech recognition', 'text to speech']],
  ['ai-infrastructure', 'AI Infrastructure', 'Inference, serving, training infrastructure and LLMOps', ['llm-inference', 'model-serving', 'mlops', 'llmops', 'vllm', 'inference-engine', 'llm-serving'], ['inference engine', 'model serving', 'llmops', 'mlops', 'gpu cluster']],
  ['ai-developer-tools', 'AI Developer Tools', 'SDKs, evaluation, prompt tooling and gateways for building with AI', ['llm-evaluation', 'prompt-engineering', 'llm-observability', 'llm-gateway', 'ai-sdk'], ['llm sdk', 'prompt management', 'llm evaluation', 'llm gateway', 'ai sdk']],
  ['machine-learning', 'Machine Learning', 'Classical and deep machine learning libraries and research code', ['machine-learning', 'deep-learning', 'pytorch', 'tensorflow', 'scikit-learn', 'reinforcement-learning'], ['machine learning', 'deep learning', 'neural network', 'pytorch', 'tensorflow']],
  ['generative-ai', 'Generative AI', 'Generative models and applications not covered by a narrower category', ['generative-ai', 'genai', 'generative-model', 'diffusion-models', 'text-generation'], ['generative ai', 'genai', 'text generation']],
  ['ai-music', 'AI Music', 'Music and audio generation', ['ai-music', 'music-generation', 'text-to-music', 'audio-generation', 'singing-voice-synthesis'], ['music generation', 'text-to-music', 'ai music', 'audio generation']],
  ['ai-image', 'AI Image', 'Image generation and editing models and tools', ['text-to-image', 'image-generation', 'stable-diffusion', 'comfyui', 'ai-art', 'flux'], ['image generation', 'text-to-image', 'stable diffusion', 'comfyui']],
  ['ai-video', 'AI Video', 'Video generation and editing models and tools', ['text-to-video', 'video-generation', 'ai-video', 'image-to-video', 'video-diffusion'], ['video generation', 'text-to-video', 'image-to-video', 'ai video']],
];

const engineering = [
  ['java', 'Java', 'Java and JVM libraries, tools and frameworks', ['java', 'jvm', 'java-library', 'openjdk'], ['java', 'jvm']],
  ['spring-boot', 'Spring Boot', 'Spring Boot, Spring Framework and Spring Cloud ecosystem', ['spring-boot', 'spring', 'spring-framework', 'spring-cloud', 'spring-security'], ['spring boot', 'spring framework', 'spring cloud']],
  ['microservices', 'Microservices', 'Microservice frameworks, service mesh and API gateways', ['microservices', 'microservice', 'service-mesh', 'api-gateway', 'grpc'], ['microservice', 'service mesh', 'api gateway']],
  ['kafka', 'Kafka', 'Apache Kafka, streaming platforms and clients', ['kafka', 'apache-kafka', 'kafka-streams', 'kafka-connect', 'event-streaming', 'redpanda'], ['kafka', 'event streaming', 'message broker']],
  ['kubernetes', 'Kubernetes', 'Kubernetes distributions, operators and tooling', ['kubernetes', 'k8s', 'helm', 'kubernetes-operator', 'kustomize', 'k3s'], ['kubernetes', 'k8s', 'helm', 'operator']],
  ['docker', 'Docker', 'Containers and container tooling', ['docker', 'docker-compose', 'containers', 'dockerfile', 'podman'], ['docker', 'container', 'dockerfile', 'podman']],
  ['aws', 'AWS', 'Amazon Web Services SDKs, tooling and serverless', ['aws', 'amazon-web-services', 'aws-lambda', 'aws-cdk', 'serverless'], ['aws', 'amazon web services', 'lambda', 'cdk']],
  ['cloud', 'Cloud', 'Cloud-native platforms and multi-cloud tooling', ['cloud-native', 'cloud', 'cloud-computing', 'multi-cloud', 'gcp', 'azure'], ['cloud native', 'multi-cloud', 'gcp', 'azure']],
  ['postgresql', 'PostgreSQL', 'PostgreSQL, extensions and tooling', ['postgresql', 'postgres', 'pgvector', 'timescaledb', 'postgres-extension'], ['postgresql', 'postgres', 'pgvector']],
  ['redis', 'Redis', 'Redis, Valkey and compatible stores and clients', ['redis', 'valkey', 'redis-cluster', 'redis-client', 'keydb'], ['redis', 'valkey', 'in-memory cache']],
  ['databases', 'Databases', 'Database engines and data storage', ['database', 'sql', 'nosql', 'olap', 'sqlite', 'duckdb', 'distributed-database', 'time-series-database'], ['database', 'sql engine', 'olap', 'key-value store']],
  ['devops', 'DevOps', 'CI/CD, GitOps and delivery automation', ['devops', 'ci-cd', 'gitops', 'github-actions', 'argocd', 'jenkins', 'automation'], ['devops', 'ci/cd', 'gitops', 'pipeline']],
  ['observability', 'Observability', 'Monitoring, tracing, logging and alerting', ['observability', 'opentelemetry', 'monitoring', 'tracing', 'prometheus', 'grafana', 'apm'], ['observability', 'opentelemetry', 'tracing', 'metrics', 'monitoring']],
  ['security', 'Security', 'Application, infrastructure and supply-chain security', ['security', 'cybersecurity', 'devsecops', 'vulnerability-scanner', 'pentesting', 'sast', 'supply-chain-security'], ['vulnerability', 'devsecops', 'pentest', 'sast', 'secret scanning']],
  ['distributed-systems', 'Distributed Systems', 'Consensus, replication and distributed computing', ['distributed-systems', 'raft', 'consensus', 'distributed-computing', 'crdt', 'paxos'], ['distributed system', 'consensus', 'raft', 'crdt', 'replication']],
  ['system-design', 'System Design', 'Software architecture, design patterns and system design resources', ['system-design', 'software-architecture', 'design-patterns', 'domain-driven-design', 'clean-architecture', 'architecture'], ['system design', 'software architecture', 'design patterns', 'ddd']],
  ['developer-tools', 'Developer Tools', 'CLIs, editors and developer productivity tools', ['developer-tools', 'devtools', 'cli', 'developer-productivity', 'terminal', 'command-line'], ['developer tools', 'cli', 'developer productivity', 'terminal']],
  ['infrastructure-as-code', 'Infrastructure as Code', 'Terraform, Pulumi, Ansible and other IaC tooling', ['infrastructure-as-code', 'terraform', 'iac', 'opentofu', 'pulumi', 'ansible', 'crossplane'], ['infrastructure as code', 'terraform', 'iac', 'pulumi', 'ansible']],
  ['testing', 'Testing', 'Test frameworks, automation and quality tooling', ['testing', 'test-automation', 'unit-testing', 'e2e-testing', 'playwright', 'load-testing', 'fuzzing'], ['testing', 'test automation', 'e2e', 'unit test', 'load testing']],
];

function category([slug, name, description, topics, keywords]) {
  const established = (t) => `topic:${t} stars:>{minStars} pushed:>{pushedSince}`;
  const searchQueries = [established(topics[0])];
  if (topics[1]) searchQueries.push(established(topics[1]));
  searchQueries.push(`topic:${topics[0]} created:>{createdSince} stars:>{freshMinStars}`);
  return { slug, name, description, searchQueries, keywords, topics };
}

function write(domain, items) {
  const doc = {
    schemaVersion: 1,
    domain,
    discovery: {
      minStars: 100,
      freshMinStars: 25,
      pushedWithinDays: 30,
      createdWithinDays: 30,
      perPage: 100,
      maxPagesPerQuery: 1,
      excludeForks: true,
      excludeArchived: true,
    },
    categories: items.map(category),
  };
  writeFileSync(`config/categories/${domain}.json`, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${domain}: ${items.length} categories, ${doc.categories.reduce((n, c) => n + c.searchQueries.length, 0)} queries`);
}

mkdirSync('config/categories', { recursive: true });
write('ai', ai);
write('engineering', engineering);
