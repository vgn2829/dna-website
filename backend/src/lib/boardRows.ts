// Shared by every route that returns board rows (boards.ts, projects.ts,
// templates.ts). Board queries select `b.*`, which includes canvas_data —
// the full tldraw document (can be MBs for legacy boards). Board lists and
// detail responses must never ship it (the canvas is loaded separately via
// GET /api/boards/:id/canvas), so it's stripped here, along with the
// internal summary bookkeeping columns. canvas_preview (lib/canvasSummary.ts)
// is returned parsed, for the Moodboards card preview.
export function toPublicBoard(row: Record<string, unknown>): Record<string, unknown> {
  const {
    canvas_data: _canvasData,
    canvas_item_count: _canvasItemCount,
    canvas_placed_item_ids: _placedIds,
    canvas_preview: rawPreview,
    ...rest
  } = row;
  let canvasPreview: unknown = null;
  if (typeof rawPreview === 'string') {
    try { canvasPreview = JSON.parse(rawPreview); } catch { canvasPreview = null; }
  }
  return { ...rest, canvas_preview: canvasPreview };
}

// Card item count: visible canvas shapes (canvas_item_count, kept in sync
// on every canvas write) plus legacy board_items ("Save to Moodboard")
// that have never been placed on the canvas (placed_at IS NULL — see
// MARK_PLACED_BOARD_ITEMS_SQL). A placed item is either one of the canvas
// shapes already or was deliberately deleted by the user; neither is
// pending. The canvas_placed_item_ids check stays as a guard against
// double-counting a shape whose placement hasn't been recorded yet.
// Requires `b` = boards and `bi` = LEFT JOIN board_items, grouped by b.id.
export const BOARD_ITEM_COUNT_SQL = `(
  COALESCE(b.canvas_item_count, 0)
  + COUNT(DISTINCT bi.id) FILTER (
      WHERE bi.placed_at IS NULL
        AND NOT (('shape:' || bi.id) = ANY(b.canvas_placed_item_ids))
    )
)::int as item_count`;

// Gallery item lifecycle: board_items.placed_at goes NULL → timestamp the
// first time a saved canvas contains the item's shape (`shape:<id>`, see
// injectPendingBoardItems), and is never cleared. Deleting the shape later
// is then the user's decision, not a "not yet placed" item to re-inject.
// Placement is read from the SAVED canvas (canvas_placed_item_ids covers
// every page), never from what a client happened to fetch or display.
// Requires a preceding CTE named `saved` yielding (id, canvas_placed_item_ids)
// — the boards row(s) just written — so every canvas write marks placement
// in the same statement as the write itself.
export const MARK_PLACED_BOARD_ITEMS_SQL = `
  UPDATE board_items bi
  SET placed_at = now()
  FROM saved
  WHERE bi.board_id = saved.id
    AND bi.placed_at IS NULL
    AND ('shape:' || bi.id) = ANY(saved.canvas_placed_item_ids)`;
