// Pure, framework-free canvas helpers for the Background Removal feature:
// image decoding, mask compositing, backdrop painting, and PNG export.
// No React, no worker. Kept local to this feature — the rest of Design Studio
// duplicates similar inline helpers, but consolidating those is out of scope.

import type { Backdrop, SourceImage } from './types';

const ACCEPTED = /^image\/(png|jpeg|jpg|webp|gif|bmp)$/;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB guardrail for a browser tool.

export const MAX_IMAGE_MB = MAX_BYTES / (1024 * 1024);

/** True if the file is an accepted image type within the size limit. */
export function isAcceptableImage(file: File | Blob): boolean {
  return ACCEPTED.test(file.type) && file.size <= MAX_BYTES;
}

/** Decode a Blob into a SourceImage (ImageBitmap + dimensions). */
export async function loadSourceImage(file: File | Blob, name = 'image'): Promise<SourceImage> {
  const bitmap = await createImageBitmap(file);
  return { bitmap, width: bitmap.width, height: bitmap.height, name };
}

/** Draw a source bitmap to a canvas and return its RGBA ImageData. */
export function bitmapToImageData(src: SourceImage): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src.bitmap, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height);
}

/**
 * Apply a single-channel alpha mask to RGBA pixels, returning NEW ImageData
 * whose alpha channel is the mask. The input is left untouched.
 */
export function applyMask(image: ImageData, mask: Uint8ClampedArray): ImageData {
  const out = new Uint8ClampedArray(image.data); // copy RGB(A)
  const px = Math.min(mask.length, out.length / 4);
  for (let i = 0; i < px; i++) {
    out[i * 4 + 3] = mask[i];
  }
  return new ImageData(out, image.width, image.height);
}

/** Put ImageData onto a fresh canvas so it can be alpha-composited via drawImage. */
export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

/** Paint the chosen backdrop (transparent checkerboard or solid colour). */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, backdrop: Backdrop): void {
  if (backdrop.kind === 'color') {
    ctx.fillStyle = backdrop.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  drawCheckerboard(ctx, w, h);
}

/** Classic transparency checkerboard (display only — never baked into exports). */
export function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number, cell = 12): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) ctx.fillRect(x, y, cell, cell);
    }
  }
}

/**
 * Build the canvas to export: the raw transparent cut-out, or the cut-out
 * flattened onto a solid colour. The checkerboard is never included.
 */
export function buildExportCanvas(cutout: HTMLCanvasElement, backdrop: Backdrop): HTMLCanvasElement {
  if (backdrop.kind === 'transparent') return cutout;
  const canvas = document.createElement('canvas');
  canvas.width = cutout.width;
  canvas.height = cutout.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = backdrop.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cutout, 0, 0);
  return canvas;
}

/** Export a canvas to a PNG Blob (PNG preserves the alpha channel). */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png');
  });
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
