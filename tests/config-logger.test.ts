import { describe, expect, it } from 'vitest';
import { loadToken } from '../src/github/config';
import { AuthenticationError } from '../src/github/errors';
import { createLogger, redact } from '../src/github/logger';

describe('authentication configuration', () => {
  it('throws AuthenticationError when no token is set', () => {
    expect(() => loadToken({})).toThrow(AuthenticationError);
    expect(() => loadToken({ GITHUB_TOKEN: '   ' })).toThrow(AuthenticationError);
  });
  it('reads GITHUB_TOKEN, falls back to GH_TOKEN, trims', () => {
    expect(loadToken({ GITHUB_TOKEN: ' abc ' })).toBe('abc');
    expect(loadToken({ GH_TOKEN: 'xyz' })).toBe('xyz');
    expect(loadToken({ GITHUB_TOKEN: 'a', GH_TOKEN: 'b' })).toBe('a');
  });
});

describe('logger redaction', () => {
  it('redacts known secrets and token-shaped strings', () => {
    const lines: string[] = [];
    const log = createLogger({ secrets: ['supersecretvalue'], sink: (l) => lines.push(l) });
    log.log({ operation: 'x', error: 'boom supersecretvalue Bearer abc.def ghp_' + 'A'.repeat(36) });
    expect(lines[0]).not.toContain('supersecretvalue');
    expect(lines[0]).not.toContain('ghp_AAAA');
    expect(lines[0]).not.toContain('abc.def');
    expect(lines[0]).toContain('[REDACTED]');
    expect(JSON.parse(lines[0]!).operation).toBe('x');
  });
  it('redact() handles fine-grained PAT shape', () => {
    expect(redact('github_pat_' + 'B'.repeat(30))).toBe('[REDACTED]');
  });
});
