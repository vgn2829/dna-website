// Pure mask-editing for manual refinement. No React, no DOM state — mutates the
// mask in place and reports the affected region so callers recomposite only that
// rectangle (keeps brushing smooth on large images).

export type BrushMode = 'restore' | 'erase';

export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Stamp a circular brush onto the mask at (cx, cy). Restore pushes alpha toward
 * 255, erase toward 0, weighted by a radial falloff: hardness 1 = a hard disk,
 * lower = a softer edge. Returns the affected bounding box, clamped to the image.
 */
export function stampBrush(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  mode: BrushMode,
): DirtyRect {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  const r = Math.max(0.5, radius);
  const inner = r * hardness;
  const denom = r - inner || 1;
  const target = mode === 'restore' ? 255 : 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      const strength = d <= inner ? 1 : Math.max(0, 1 - (d - inner) / denom);
      const i = y * w + x;
      mask[i] = Math.round(mask[i] + (target - mask[i]) * strength);
    }
  }
  return { x0, y0, x1, y1 };
}

/** Bounding box that covers both rects (union of a stroke's stamps). */
export function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Repaint a canvas region from the original RGB (imageData) plus the edited mask
 * alpha. Only the dirty rectangle is touched, via putImageData.
 */
export function recompositeRegion(
  canvas: HTMLCanvasElement,
  imageData: ImageData,
  mask: Uint8ClampedArray,
  r: DirtyRect,
): void {
  const w = imageData.width;
  const rw = r.x1 - r.x0 + 1;
  const rh = r.y1 - r.y0 + 1;
  if (rw <= 0 || rh <= 0) return;
  const out = new Uint8ClampedArray(rw * rh * 4);
  const src = imageData.data;
  for (let y = 0; y < rh; y++) {
    const sy = r.y0 + y;
    for (let x = 0; x < rw; x++) {
      const sx = r.x0 + x;
      const si = (sy * w + sx) * 4;
      const di = (y * rw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = mask[sy * w + sx];
    }
  }
  canvas.getContext('2d')!.putImageData(new ImageData(out, rw, rh), r.x0, r.y0);
}
