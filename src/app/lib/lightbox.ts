// Pure helpers for the moodboard image lightbox (kept free of tldraw/React so they unit-test cheaply).

export interface LightboxImage { id: string; src: string; label?: string }

/** Wrap-around index step: next from the last is the first, previous from the first is the last. */
export function stepIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}

export interface BoardImageShape { id: string; x: number; y: number; w: number; h: number; src: string | null | undefined; label?: string }

/**
 * Images in natural reading order: top-to-bottom in rows, left-to-right within a row. Two
 * images belong to one row when their vertical centres are within half the smaller height.
 * Shapes without a usable source (deleted/placeholder assets) are dropped, never shown broken.
 */
export function readingOrder(shapes: readonly BoardImageShape[]): LightboxImage[] {
  const usable = shapes.filter(s => typeof s.src === 'string' && s.src.trim() !== '');
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: BoardImageShape[][] = [];
  for (const s of sorted) {
    const cy = s.y + s.h / 2;
    const row = rows.find(r => { const ref = r[0]; return Math.abs(ref.y + ref.h / 2 - cy) <= Math.min(ref.h, s.h) / 2; });
    if (row) row.push(s); else rows.push([s]);
  }
  rows.sort((a, b) => a[0].y - b[0].y);
  return rows.flatMap(r => r.sort((a, b) => a.x - b.x)).map(s => ({ id: s.id, src: s.src as string, label: s.label }));
}

/** Where to open: the first selected image if any is selected, else the first image. */
export function startIndexFor(items: readonly LightboxImage[], selectedIds: readonly string[]): number {
  const i = items.findIndex(it => selectedIds.includes(it.id));
  return i === -1 ? 0 : i;
}

/** Swipe → direction: +1 next, −1 previous, 0 when too short or mostly vertical. */
export function swipeDirection(dx: number, dy: number, threshold = 50): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  return dx < 0 ? 1 : -1;
}
