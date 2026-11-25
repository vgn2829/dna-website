// ─────────────────────────────────────────────────────────────────────────
// Pure geometry for the Moodboard organization + export tools (Milestone B).
// No tldraw import: these take plain rectangles and return plain numbers, so
// they are unit-testable in Node. tldrawBoardTools.ts is the thin adapter that
// feeds them real shape bounds and applies the result with editor APIs.
// ─────────────────────────────────────────────────────────────────────────

export interface LayoutBox { id: string; x: number; y: number; w: number; h: number }
export interface Placement { id: string; x: number; y: number }

/**
 * "Tidy into grid": re-flows boxes into left-to-right rows, in reading order
 * (top-to-bottom, then left-to-right), keeping every box's own size — nothing
 * is resized or distorted. Rows wrap at a width chosen so the result is
 * roughly landscape (about 1.6:1) rather than one long strip. The block stays
 * anchored at the original top-left corner. Returns the new top-left of each
 * box's bounds.
 */
export function planTidyGrid(boxes: readonly LayoutBox[], gap = 32): Placement[] {
  if (boxes.length === 0) return [];
  const anchorX = Math.min(...boxes.map(b => b.x));
  const anchorY = Math.min(...boxes.map(b => b.y));

  // Reading order. Boxes whose tops are within half a typical height of each
  // other count as one visual row, so a slightly ragged row stays left→right.
  const avgH = boxes.reduce((n, b) => n + b.h, 0) / boxes.length;
  const tol = Math.max(8, avgH / 2);
  const ordered = [...boxes].sort((a, b) => (Math.abs(a.y - b.y) <= tol ? a.x - b.x : a.y - b.y));

  const totalArea = boxes.reduce((n, b) => n + (b.w + gap) * (b.h + gap), 0);
  const widest = Math.max(...boxes.map(b => b.w));
  const targetRowWidth = Math.max(widest, Math.sqrt(totalArea * 1.6));

  const out: Placement[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  for (const b of ordered) {
    if (cursorX > 0 && cursorX + b.w > targetRowWidth) {
      cursorX = 0;
      cursorY += rowH + gap;
      rowH = 0;
    }
    out.push({ id: b.id, x: Math.round(anchorX + cursorX), y: Math.round(anchorY + cursorY) });
    cursorX += b.w + gap;
    rowH = Math.max(rowH, b.h);
  }
  return out;
}

// ── Export sizing ────────────────────────────────────────────────────────
// Browsers silently fail (blank or missing image) when a canvas is too big:
// the practical cross-browser ceiling is ~16.7M pixels (iOS Safari) and
// 8192px on a side. Rather than let a large board produce a broken file, the
// requested scale is reduced until the bitmap fits, and the UI says so.

export const EXPORT_MAX_SIDE = 8192;
export const EXPORT_MAX_PIXELS = 16_000_000;
export const EXPORT_SCALES = [1, 2, 3] as const;
export type ExportScale = typeof EXPORT_SCALES[number];

export interface ExportPlan {
  /** Scale that will actually be used (≤ requested). */
  scale: number;
  /** Final bitmap size in pixels, padding included. */
  width: number;
  height: number;
  /** True when the requested scale had to be reduced to fit. */
  reduced: boolean;
  /** False when even scale-down cannot produce a ≥1px image (degenerate bounds). */
  ok: boolean;
}

/** Scale that fits content (plus padding on every side) inside `maxEdge` px on its longest side; never upscales. */
export function previewScale(contentWidth: number, contentHeight: number, padding: number, maxEdge = 420): number {
  const longest = Math.max(contentWidth, contentHeight) + padding * 2;
  if (!Number.isFinite(longest) || longest <= 0 || !Number.isFinite(maxEdge) || maxEdge <= 0) return 1;
  return Math.min(1, maxEdge / longest);
}

export function planExport(
  contentWidth: number,
  contentHeight: number,
  requestedScale: number,
  padding = 32,
): ExportPlan {
  const w = contentWidth + padding * 2;
  const h = contentHeight + padding * 2;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { scale: 1, width: 0, height: 0, reduced: false, ok: false };
  }
  const want = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
  const bySide = EXPORT_MAX_SIDE / Math.max(w, h);
  const byArea = Math.sqrt(EXPORT_MAX_PIXELS / (w * h));
  const scale = Math.min(want, bySide, byArea);
  const width = Math.max(1, Math.floor(w * scale));
  const height = Math.max(1, Math.floor(h * scale));
  return { scale, width, height, reduced: scale < want - 1e-9, ok: true };
}

/** Filesystem-safe base name for a downloaded export. */
export function exportFileName(boardName: string, ext: string): string {
  const base = boardName
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return `${base || 'moodboard'}.${ext}`;
}

// ── Asset insertion sizing ───────────────────────────────────────────────
const INSERT_MAX_SIDE = 400;
const INSERT_MIN_SIDE = 32;

/**
 * Display size for an image dropped on the board: aspect ratio preserved,
 * longest side capped at INSERT_MAX_SIDE (never upscaled), and never
 * collapsed below INSERT_MIN_SIDE. Unknown/zero dimensions (e.g. an SVG with
 * no intrinsic size) fall back to a square.
 */
export function fitInsertSize(w: number, h: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return { w: 300, h: 300 };
  const scale = Math.min(1, INSERT_MAX_SIDE / Math.max(w, h));
  return {
    w: Math.max(INSERT_MIN_SIDE, Math.round(w * scale)),
    h: Math.max(INSERT_MIN_SIDE, Math.round(h * scale)),
  };
}
