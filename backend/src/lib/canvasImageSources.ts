// Image sources referenced by a saved tldraw canvas, for the read-time `image_thumbnails`
// map on GET /api/boards/:id/canvas. Pure: it only reads the stored JSON and never changes it.
//
// Handles both stored shapes — the editor snapshot ({ document: { store: {...} } }) and the
// realtime room snapshot ({ documents: [{ state }] }) — by walking the JSON for image asset
// records instead of depending on either layout. Bounded, so a huge or hostile canvas cannot
// make this expensive.

const MAX_NODES = 200_000;
export const MAX_CANVAS_SOURCES = 300;

export function collectCanvasImageSources(canvasData: string | null | undefined, cap = MAX_CANVAS_SOURCES): string[] {
  if (!canvasData) return [];
  let root: unknown;
  try { root = JSON.parse(canvasData); } catch { return []; }
  const out = new Set<string>();
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0 && out.size < cap && visited < MAX_NODES) {
    const node = stack.pop();
    visited++;
    if (Array.isArray(node)) { for (const v of node) stack.push(v); continue; }
    if (node === null || typeof node !== 'object') continue;
    const rec = node as Record<string, unknown>;
    if (rec.typeName === 'asset' && rec.type === 'image') {
      const src = (rec.props as { src?: unknown } | undefined)?.src;
      if (typeof src === 'string' && /^https?:\/\//i.test(src)) out.add(src);
      continue;
    }
    for (const v of Object.values(rec)) if (v !== null && typeof v === 'object') stack.push(v);
  }
  return [...out];
}
