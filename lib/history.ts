import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePatternConfig, type PatternConfig } from '../src/explain/pattern';
import type { HistoryDataset, HistoryEntry } from '../src/history';

export type { HistoryDataset, HistoryEntry };

let historyCache: HistoryDataset | null | undefined;

/**
 * Build-time loader for the public history file. Optional: a missing or malformed file means "no trajectories", never a
 * build failure and never invented data.
 */
export function loadHistory(path?: string): HistoryDataset | null {
  if (!path && historyCache !== undefined) return historyCache;
  let result: HistoryDataset | null = null;
  try {
    const raw = JSON.parse(readFileSync(path ?? join(process.cwd(), 'data', 'public', 'history.json'), 'utf8')) as Partial<HistoryDataset>;
    if (raw.schemaVersion === 1 && typeof raw.repositories === 'object' && raw.repositories !== null) result = raw as HistoryDataset;
  } catch {
    result = null;
  }
  if (!path) historyCache = result;
  return result;
}

let patternCache: PatternConfig | undefined;

/** The pattern configuration (config/pattern.json), read once at build time. */
export function loadPatternConfig(): PatternConfig {
  patternCache ??= parsePatternConfig(JSON.parse(readFileSync(join(process.cwd(), 'config', 'pattern.json'), 'utf8')));
  return patternCache;
}
