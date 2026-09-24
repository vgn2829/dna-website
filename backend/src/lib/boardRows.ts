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
// that haven't been materialized onto the canvas yet — a placed item is
// already one of the canvas shapes (`shape:<board_items.id>`), so it's
// excluded rather than double-counted. Requires `b` = boards and
// `bi` = LEFT JOIN board_items, grouped by b.id.
export const BOARD_ITEM_COUNT_SQL = `(
  COALESCE(b.canvas_item_count, 0)
  + COUNT(DISTINCT bi.id) FILTER (WHERE NOT (('shape:' || bi.id) = ANY(b.canvas_placed_item_ids)))
)::int as item_count`;
