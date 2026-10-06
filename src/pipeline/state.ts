/**
 * Pipeline-state backups (Phase 6.1). The state asset (`state.tar.gz`) lives in the `data-state` release. Each run also
 * uploads a dated copy `state-YYYY-MM-DD.tar.gz`; this module decides which old copies to delete. Pure and testable.
 */
export interface ReleaseAsset {
  name: string;
}

const DATED = /^state-(\d{4}-\d{2}-\d{2})\.tar\.gz$/;
/** Superseded by the dated copies; deleted once so there is a single backup mechanism. */
const LEGACY = new Set(['state-prev.tar.gz']);

export function datedStateName(date: Date): string {
  return `state-${date.toISOString().slice(0, 10)}.tar.gz`;
}

/**
 * Names to delete: the legacy backup (once two dated copies exist), and dated copies beyond the newest `keep`. `state.tar.gz` (the live state) and any
 * unrelated asset are never selected.
 */
export function assetsToDelete(assets: readonly ReleaseAsset[], keep: number): string[] {
  const dated = assets
    .map((a) => ({ name: a.name, m: DATED.exec(a.name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => (a.m[1] as string).localeCompare(b.m[1] as string));
  const excess = dated.slice(0, Math.max(0, dated.length - Math.max(1, keep))).map((d) => d.name);
  // The old single-copy backup is removed only once there are at least two dated copies, so rollback depth never shrinks.
  const legacy = dated.length >= 2 ? assets.filter((a) => LEGACY.has(a.name)).map((a) => a.name) : [];
  return [...legacy, ...excess];
}
