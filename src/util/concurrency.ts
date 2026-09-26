export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep input order
 * (deterministic output) and one item's failure never cancels the others.
 * `shouldStop` is checked before each item starts; skipped items are reported
 * as rejected with `stopError`.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
  options: { shouldStop?: () => boolean; stopError?: () => unknown } = {},
): Promise<Settled<O>[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`concurrency limit must be a positive integer, got ${limit}`);
  const results: Settled<O>[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      if (options.shouldStop?.()) {
        results[index] = { ok: false, error: options.stopError?.() ?? new Error('stopped before start') };
        continue;
      }
      try {
        results[index] = { ok: true, value: await fn(items[index] as I, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
