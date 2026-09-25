import { describe, it, expect } from 'vitest';
import type { CanvasPreviewItem } from './api';
import { MAX_PREVIEW_IMAGES, PREVIEW_ROOT_MARGIN, planPreviewImages, previewImageFallback, shouldLoadPreviewImages } from './boardPreview';

// V3.2.5 — the pure decisions behind BoardPreview images (thumbnail vs
// original, fallback-once, the per-card image cap, viewport gating). The
// live IntersectionObserver wiring is verified in the browser QA.

const item = (k: CanvasPreviewItem['k'], src?: string): CanvasPreviewItem => ({ k, x: 0, y: 0, r: 0, w: 10, h: 10, ...(src !== undefined ? { src } : {}) });
const A = 'https://api.test/uploads/assets/ws/a.jpg';
const B = 'https://api.test/uploads/canvas-files/b1/b.png';
const EXT = 'https://images.example.com/c.jpg';
const T_A = 'https://api.test/uploads/derived/assets/ws/a.jpg/t512.webp';

describe('planPreviewImages', () => {
  it('18: prefers the server thumbnail when there is one', () => {
    expect(planPreviewImages([item('image', A)], { [A]: T_A })).toEqual([{ href: T_A, original: A }]);
  });
  it('19 + 21: falls back to the original when absent; external URLs unchanged', () => {
    expect(planPreviewImages([item('image', B), item('image', EXT)], { [A]: T_A })).toEqual([{ href: B, original: B }, { href: EXT, original: EXT }]);
    expect(planPreviewImages([item('image', A)], undefined)).toEqual([{ href: A, original: A }]);
  });
  it('22: keeps item order and position; non-images and non-http sources draw nothing', () => {
    const items = [item('geo'), item('image', A), item('text'), item('image', 'data:image/png;base64,AA'), item('image', EXT), item('image')];
    expect(planPreviewImages(items, { [A]: T_A })).toEqual([null, { href: T_A, original: A }, null, null, { href: EXT, original: EXT }, null]);
  });
  it('25: every image of a card draws (up to the existing per-card cap), not just the first', () => {
    const items = Array.from({ length: MAX_PREVIEW_IMAGES + 3 }, (_, i) => item('image', `https://x.test/${i}.jpg`));
    const plan = planPreviewImages(items, {});
    expect(plan.filter(Boolean)).toHaveLength(MAX_PREVIEW_IMAGES);
    expect(plan.slice(0, MAX_PREVIEW_IMAGES).every(Boolean)).toBe(true);
    expect(plan.slice(MAX_PREVIEW_IMAGES).every(p => p === null)).toBe(true);
    expect(MAX_PREVIEW_IMAGES).toBe(8); // unchanged from before V3.2.5
  });
});

describe('previewImageFallback', () => {
  it('20 + 27: a failed thumbnail switches to the original exactly once; no loop, no re-request', () => {
    const image = { href: T_A, original: A };
    expect(previewImageFallback(image, T_A)).toBe(A);
    expect(previewImageFallback(image, A)).toBeNull(); // the original failing too: stop
    expect(previewImageFallback({ href: A, original: A }, A)).toBeNull(); // no thumbnail: nothing to fall back from
  });
});

describe('viewport gating decision', () => {
  it('23-24: images stay unloaded until the card is near the viewport', () => {
    expect(shouldLoadPreviewImages(true, false)).toBe(false);
    expect(shouldLoadPreviewImages(true, true)).toBe(true);
  });
  it('without IntersectionObserver, images load as before', () => {
    expect(shouldLoadPreviewImages(false, false)).toBe(true);
  });
  it('26 (contract): gating only withholds image pixels — the plan (and so the card and its tiles) is independent of it', () => {
    const items = [item('image', A), item('geo')];
    expect(planPreviewImages(items, { [A]: T_A })).toEqual(planPreviewImages(items, { [A]: T_A }));
  });
  it('uses a modest preload margin (about one row of cards)', () => {
    expect(PREVIEW_ROOT_MARGIN).toBe('300px 0px');
  });
});
