import * as versionStorage from './versionStorage';
import type { BoardVersion } from './versionStorage';

// ─────────────────────────────────────────────────────────────────────────
// VERSION TIMELINE — the read side of version history: pagination and
// retention policy. Deliberately separate from VersionHistoryService
// (which decides WHEN a version gets created) and VersionStorage (which
// knows HOW to read/write rows) — this module answers "how much history do
// we show, and how much do we keep," nothing else.
// ─────────────────────────────────────────────────────────────────────────

// One board's version history is a real product feature (Figma/Canva-style
// timeline, per the spec), not a debug log — 100 is generous enough that a
// board would need months of active, checkpoint-triggering use to approach
// it, while still bounding worst-case storage for a single board's history
// (each row holds a full snapshot; unbounded growth for one very old, very
// active board is the actual risk this guards against). Pruned opportunistically
// right after each new version is created (see VersionHistoryService), not
// on a schedule — there's no in-process cron in this codebase (see
// routes/internal.ts's own comment on why: the host can spin the process
// down when idle), and retention only ever needs to run exactly when a
// new row might push a board over the cap.
export const MAX_VERSIONS_PER_BOARD = 100;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface VersionPage {
  versions: BoardVersion[];
  hasMore: boolean;
}

// Cursor-based (created_at of the last item), not offset-based — offset
// pagination on a table that's being actively pruned/appended to (this one
// is, by design) can skip or duplicate rows across pages; a timestamp
// cursor doesn't have that failure mode. `before` is exclusive: pass the
// last page's oldest `createdAt` to get the next page.
export async function getPage(boardId: string, opts: { limit?: number; before?: string } = {}): Promise<VersionPage> {
  const limit = Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  // Fetch one extra row to know whether there's a next page without a
  // separate COUNT query.
  const rows = await versionStorage.listVersions(boardId, { limit: limit + 1, before: opts.before });
  const hasMore = rows.length > limit;
  return { versions: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

// Called after every new version is written — deletes anything past the
// MAX_VERSIONS_PER_BOARD most recent for that board. Cheap (a single
// indexed DELETE, see the board_versions_board_id_created_at_idx index)
// and safe to call unconditionally rather than checking countVersions
// first: the WHERE ... NOT IN (...LIMIT keep) subquery is naturally a
// no-op when the board is under the cap.
export async function enforceRetention(boardId: string): Promise<void> {
  const deleted = await versionStorage.deleteVersionsOlderThanNth(boardId, MAX_VERSIONS_PER_BOARD);
  if (deleted > 0) {
    console.log(`Version history: pruned ${deleted} version(s) for board ${boardId} (retention cap ${MAX_VERSIONS_PER_BOARD})`);
  }
}
