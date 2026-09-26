import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicDataset, PublicRepository } from '../src/momentum/dataset';

export type { PublicDataset, PublicRepository };

export type LoadResult = { ok: true; data: PublicDataset } | { ok: false; error: string };

/** Structural check of the public contract; returns a problem description or null. */
export function checkRadar(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'radar.json is not an object';
  const d = raw as Partial<PublicDataset>;
  if (d.schemaVersion !== 1) return `unsupported schemaVersion ${String(d.schemaVersion)} (expected 1)`;
  if (typeof d.generatedAt !== 'string' || Number.isNaN(Date.parse(d.generatedAt))) return 'generatedAt missing or invalid';
  if (!Array.isArray(d.repositories)) return 'repositories must be an array';
  if (typeof d.lists !== 'object' || d.lists === null) return 'lists missing';
  for (const k of ['rising', 'moversUp', 'moversDown', 'sustained', 'newEntrants'] as const) {
    if (!Array.isArray(d.lists[k])) return `lists.${k} must be an array`;
  }
  return null;
}

export function parseRadar(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'radar.json is not valid JSON' };
  }
  const problem = checkRadar(raw);
  return problem ? { ok: false, error: problem } : { ok: true, data: raw as PublicDataset };
}

let cached: LoadResult | null = null;

/** Build-time loader: the ONLY data source of the frontend is the public dataset. */
export function loadRadar(path?: string): LoadResult {
  if (!path && cached) return cached;
  let result: LoadResult;
  try {
    result = parseRadar(readFileSync(path ?? join(process.cwd(), 'data', 'public', 'radar.json'), 'utf8'));
  } catch {
    result = { ok: false, error: 'data/public/radar.json is missing. Run npm run momentum.' };
  }
  if (!path) cached = result;
  return result;
}
