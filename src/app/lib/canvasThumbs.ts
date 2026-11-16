// Which file the board canvas should draw for an image: the small t512 thumbnail while the image
// is displayed small, the original whenever more detail is visible. Pure so the rule is testable.
//
// tldraw re-resolves an asset (debounced) whenever the zoom changes, passing `screenScale`
// = zoom × (shape width ÷ asset width). So the pixels actually needed for the image's short
// edge are  min(w, h) × screenScale × devicePixelRatio. The thumbnail's short edge is 512, so
// it is only used while that need is ≤ 512 — i.e. it can never be visibly softer than the
// original — and zooming in swaps to the original. Exports, copy and the lightbox ask for the
// original explicitly (`shouldResolveToOriginal`) and never see a thumbnail.

export const THUMB_SHORT_EDGE = 512;

export interface CanvasImageDims { src: string; w: number; h: number }
export interface ResolveContext { screenScale: number; dpr: number; shouldResolveToOriginal: boolean }

export function pickCanvasImageSrc(
  asset: CanvasImageDims,
  thumbs: Readonly<Record<string, string>> | null | undefined,
  ctx: ResolveContext,
): string {
  if (ctx.shouldResolveToOriginal) return asset.src;
  const thumb = thumbs?.[asset.src];
  if (!thumb) return asset.src;
  const short = Math.min(asset.w, asset.h);
  // A source no bigger than the thumbnail gains nothing from one; unknown sizes stay on the original.
  if (!Number.isFinite(short) || short <= THUMB_SHORT_EDGE) return asset.src;
  const needed = short * (ctx.screenScale > 0 ? ctx.screenScale : 1) * (ctx.dpr > 0 ? ctx.dpr : 1);
  return needed <= THUMB_SHORT_EDGE ? thumb : asset.src;
}
