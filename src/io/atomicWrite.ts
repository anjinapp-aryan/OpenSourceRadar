import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Pretty JSON (2 spaces) except arrays made only of numbers, which stay on one line:
 * a daily-gains array would otherwise take one line per number (about 4x the size).
 * Uses a per-call random marker so string content can never be altered.
 */
export function stringifyCompact(data: unknown): string {
  const nonce = randomBytes(8).toString('hex');
  const marker = new RegExp(`"@@${nonce}:([^"]*)@@"`, 'g');
  const text = JSON.stringify(
    data,
    (_key, value: unknown) =>
      Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? `@@${nonce}:${value.join(',')}@@`
        : value,
    2,
  );
  return text.replace(marker, (_m, nums: string) => `[${nums.split(',').join(', ')}]`);
}

/**
 * Write JSON so readers see either the complete old file or the complete new one:
 * write a sibling temp file, fsync it, then rename over the target. On any error
 * the temp file is removed and the existing target is untouched.
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const text = stringifyCompact(data) + '\n';
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/** Read and parse JSON; returns undefined when the file does not exist. Other errors propagate. */
export async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(text) as T;
}
