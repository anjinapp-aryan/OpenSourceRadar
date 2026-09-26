import type { RateLimitInfo } from './rateLimit';

export interface LogEntry {
  operation: string;
  repository?: string;
  requests?: number;
  durationMs?: number;
  rateLimit?: RateLimitInfo | null;
  error?: string;
  [extra: string]: unknown;
}

export interface Logger {
  log(entry: LogEntry): void;
}

const TOKEN_PATTERNS: RegExp[] = [
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

/** Remove known secrets and anything shaped like a GitHub token from text. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('[REDACTED]');
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

/** JSON-lines logger. All output passes through redact(). */
export function createLogger(
  options: { secrets?: readonly string[]; sink?: (line: string) => void } = {},
): Logger {
  const sink = options.sink ?? ((line: string) => process.stderr.write(line + '\n'));
  return {
    log(entry) {
      sink(redact(JSON.stringify({ ts: new Date().toISOString(), ...entry }), options.secrets ?? []));
    },
  };
}

export const silentLogger: Logger = { log() {} };
