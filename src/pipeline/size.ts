/**
 * Size accounting for the static site and its public data (Phase 6.2). Pure; file reading lives in the CLI.
 */
export interface SizePoint {
  records: number;
  bytes: number;
}

/**
 * Linear projection from one measured point: bytes scale with records. Used for the public JSON files and for the static
 * export, both of which are per-record. It is an estimate, labelled as such wherever it is reported.
 */
export function project(measured: SizePoint, targets: readonly number[]): SizePoint[] {
  const perRecord = measured.records > 0 ? measured.bytes / measured.records : 0;
  return targets.map((records) => ({ records, bytes: Math.round(perRecord * records) }));
}

export interface TreeStats {
  files: number;
  bytes: number;
  byExtension: Record<string, { files: number; bytes: number }>;
}

/** Aggregate a list of (path, size) pairs. Deterministic: extensions are sorted by size, then name. */
export function treeStats(entries: ReadonlyArray<{ path: string; size: number }>): TreeStats {
  const byExt: Record<string, { files: number; bytes: number }> = {};
  let bytes = 0;
  for (const e of entries) {
    const dot = e.path.lastIndexOf('.');
    const slash = Math.max(e.path.lastIndexOf('/'), e.path.lastIndexOf(String.fromCharCode(92)));
    const ext = dot > slash ? e.path.slice(dot).toLowerCase() : '(none)';
    const cur = (byExt[ext] ??= { files: 0, bytes: 0 });
    cur.files += 1;
    cur.bytes += e.size;
    bytes += e.size;
  }
  const sorted = Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes || a[0].localeCompare(b[0]));
  return { files: entries.length, bytes, byExtension: Object.fromEntries(sorted) };
}
