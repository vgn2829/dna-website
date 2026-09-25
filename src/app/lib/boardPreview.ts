import type { CanvasPreviewItem } from './api';

// ─────────────────────────────────────────────────────────────────────────
// Pure decisions behind BoardPreview's images (V3.2.5), kept here so the
// node-only unit tests can cover them; BoardPreview/BoardCard just render.
// ─────────────────────────────────────────────────────────────────────────

// Only the first few images of a card draw real pixels; the rest render
// as tiles, so a card never pulls dozens of images.
export const MAX_PREVIEW_IMAGES = 8;

// How far ahead of the viewport a card's preview images start loading:
// about one row of cards, so scrolling feels immediate without eagerly
// fetching the whole list.
export const PREVIEW_ROOT_MARGIN = '300px 0px';

export interface PreviewImage {
  href: string;      // what to load first: the thumbnail when the server has one ready
  original: string;  // the item's own src — the fallback
}

// One entry per preview item, in item order: the image to draw, or null
// for anything that isn't a drawable http(s) image or is past the cap.
// `thumbnails` is the board's read-time preview_thumbnails map (original
// src → t512 URL); anything absent from it uses its original src.
export function planPreviewImages(
  items: CanvasPreviewItem[],
  thumbnails: Record<string, string> | null | undefined,
  max = MAX_PREVIEW_IMAGES,
): Array<PreviewImage | null> {
  let drawn = 0;
  return items.map(it => {
    if (it.k !== 'image' || !it.src || !/^https?:\/\//i.test(it.src) || drawn >= max) return null;
    drawn++;
    const thumb = thumbnails?.[it.src];
    return { href: typeof thumb === 'string' && thumb ? thumb : it.src, original: it.src };
  });
}

// After `failedHref` failed to load: the original to try instead when it
// was the thumbnail that failed; null otherwise (never loops, never
// re-requests a failed thumbnail).
export function previewImageFallback(image: PreviewImage, failedHref: string): string | null {
  return image.href !== image.original && failedHref === image.href ? image.original : null;
}

// Whether a card may load its preview images yet: once it has come near
// the viewport, or always where IntersectionObserver is unavailable.
export function shouldLoadPreviewImages(observerSupported: boolean, nearViewport: boolean): boolean {
  return !observerSupported || nearViewport;
}
