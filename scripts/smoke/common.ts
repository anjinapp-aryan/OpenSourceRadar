import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthenticationError, GitHubError } from '../../src/github/errors';
import { GitHubHttpClient } from '../../src/github/http';
import { loadToken } from '../../src/github/config';
import { createLogger } from '../../src/github/logger';

export const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results');

export interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export interface SmokeReport {
  script: string;
  startedAt: string;
  durationMs: number;
  /** REST + GraphQL requests issued through the client by this script. */
  requests: { rest: number; graphql: number };
  checks: Check[];
  measurements: Record<string, unknown>;
}

/**
 * Build a client from the environment. Exits with code 2 (NOT RUN) if no token,
 * unless `allowAnonymous` (public endpoints only; 60 core requests/hour).
 */
export function makeClient(options: { allowAnonymous?: boolean } = {}): { client: GitHubHttpClient; token: string | null } {
  let token: string | null;
  try {
    token = loadToken();
  } catch (e) {
    if (e instanceof AuthenticationError) {
      if (!options.allowAnonymous) {
        console.error(`NOT RUN: ${e.message}`);
        process.exit(2);
      }
      token = null;
    } else {
      throw e;
    }
  }
  const logger = createLogger({ secrets: token ? [token] : [] });
  return { client: new GitHubHttpClient({ token, logger }), token };
}

export class Recorder {
  readonly checks: Check[] = [];
  readonly measurements: Record<string, unknown> = {};
  private readonly started = Date.now();
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly script: string, private readonly client: GitHubHttpClient) {}

  async check<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const detail = await fn();
      this.checks.push({ name, ok: true, detail });
      console.log(`PASS ${name}`);
      return detail;
    } catch (e) {
      const error = e instanceof GitHubError ? `${e.name}: ${e.message}` : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.checks.push({ name, ok: false, error });
      console.log(`FAIL ${name} -> ${error}`);
      return undefined;
    }
  }

  finish(): SmokeReport {
    const report: SmokeReport = {
      script: this.script,
      startedAt: this.startedAt,
      durationMs: Date.now() - this.started,
      requests: { ...this.client.stats },
      checks: this.checks,
      measurements: this.measurements,
    };
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, `${this.script}.json`), JSON.stringify(report, null, 2));
    const failed = this.checks.filter((c) => !c.ok).length;
    console.log(`\n${this.script}: ${this.checks.length - failed}/${this.checks.length} checks passed; requests rest=${report.requests.rest} graphql=${report.requests.graphql}`);
    if (failed > 0) process.exitCode = 1;
    return report;
  }
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
