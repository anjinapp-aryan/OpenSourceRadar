import { describe, expect, it } from 'vitest';
import { InvalidResponseError } from '../src/github/errors';
import { parseGraphQLRateLimit, parseRestRateLimit } from '../src/github/rateLimit';

describe('rate-limit parsing', () => {
  it('parses REST headers', () => {
    const rl = parseRestRateLimit(
      new Headers({
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4990',
        'x-ratelimit-used': '10',
        'x-ratelimit-reset': '1790000000',
        'x-ratelimit-resource': 'core',
      }),
    );
    expect(rl).toEqual({ limit: 5000, remaining: 4990, used: 10, resetAt: new Date(1790000000 * 1000), resource: 'core' });
  });
  it('returns null when headers absent', () => {
    expect(parseRestRateLimit(new Headers())).toBeNull();
  });
  it('tolerates non-numeric header values as null', () => {
    const rl = parseRestRateLimit(new Headers({ 'x-ratelimit-limit': 'abc', 'x-ratelimit-remaining': '3' }));
    expect(rl?.limit).toBeNull();
    expect(rl?.remaining).toBe(3);
  });
  it('parses GraphQL rateLimit', () => {
    const c = parseGraphQLRateLimit({ cost: 2, limit: 5000, remaining: 4998, resetAt: '2026-09-24T12:00:00Z', nodeCount: 100 });
    expect(c.cost).toBe(2);
    expect(c.resetAt.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });
  it('rejects invalid GraphQL rateLimit', () => {
    expect(() => parseGraphQLRateLimit(null)).toThrow(InvalidResponseError);
    expect(() => parseGraphQLRateLimit({ cost: 'x', limit: 1, remaining: 1, resetAt: 'z' })).toThrow(InvalidResponseError);
    expect(() => parseGraphQLRateLimit({ cost: 1, limit: 1, remaining: 1, resetAt: 'not-a-date' })).toThrow(InvalidResponseError);
  });
});
