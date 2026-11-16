import { describe, expect, it } from 'vitest';
import { pickCanvasImageSrc, THUMB_SHORT_EDGE } from './canvasThumbs';

const SRC = 'https://cdn.test/canvas-files/b/a.jpg', THUMB = 'https://cdn.test/derived/canvas-files/b/a.jpg/t512.webp';
const asset = { src: SRC, w: 1600, h: 1200 };
const thumbs = { [SRC]: THUMB };
const ctx = (screenScale: number, dpr = 1, shouldResolveToOriginal = false) => ({ screenScale, dpr, shouldResolveToOriginal });

describe('pickCanvasImageSrc', () => {
  it('uses the thumbnail while the image is shown small (60 images fitted on screen)', () => {
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0.08))).toBe(THUMB);     // ~126px wide
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0.4))).toBe(THUMB);      // 1200 × 0.4 = 480px short edge
  });
  it('switches to the original as soon as the thumbnail would be softer than the original', () => {
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0.43))).toBe(SRC);       // 1200 × 0.43 = 516 > 512
    expect(pickCanvasImageSrc(asset, thumbs, ctx(1))).toBe(SRC);
    expect(pickCanvasImageSrc(asset, thumbs, ctx(3))).toBe(SRC);
  });
  it('accounts for high-density screens', () => {
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0.3, 1))).toBe(THUMB);
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0.3, 2))).toBe(SRC);     // 1200 × 0.3 × 2 = 720 > 512
  });
  it('never uses a thumbnail for exports, copies or anything that asks for the original', () => {
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0.05, 1, true))).toBe(SRC);
  });
  it('falls back to the original whenever there is no thumbnail (new upload, external, not ready, no map)', () => {
    expect(pickCanvasImageSrc(asset, {}, ctx(0.05))).toBe(SRC);
    expect(pickCanvasImageSrc(asset, null, ctx(0.05))).toBe(SRC);
    expect(pickCanvasImageSrc(asset, undefined, ctx(0.05))).toBe(SRC);
    expect(pickCanvasImageSrc({ ...asset, src: 'https://other.test/x.jpg' }, thumbs, ctx(0.05))).toBe('https://other.test/x.jpg');
  });
  it('never swaps a small source for a thumbnail, and tolerates bad dimensions or scale', () => {
    expect(pickCanvasImageSrc({ src: SRC, w: 400, h: 300 }, thumbs, ctx(0.1))).toBe(SRC);
    expect(pickCanvasImageSrc({ src: SRC, w: THUMB_SHORT_EDGE, h: 2000 }, thumbs, ctx(0.1))).toBe(SRC);
    expect(pickCanvasImageSrc({ src: SRC, w: NaN, h: NaN }, thumbs, ctx(0.1))).toBe(SRC);
    expect(pickCanvasImageSrc(asset, thumbs, ctx(0, 0))).toBe(SRC);        // treated as 1×1 → original
  });
});
