// Pure pre/post-processing for segmentation. No ORT, no React — just pixel math
// and OffscreenCanvas resizing (available inside the worker).

import type { ModelConfig } from './models';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** High-quality resize of an RGBA buffer via OffscreenCanvas. */
function resizeRGBA(rgba: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const src = new OffscreenCanvas(sw, sh);
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), sw, sh), 0, 0);
  const dst = new OffscreenCanvas(dw, dh);
  const dctx = dst.getContext('2d')!;
  dctx.drawImage(src, 0, 0, dw, dh);
  return dctx.getImageData(0, 0, dw, dh).data;
}

/** Resize a single-channel mask by packing it into RGBA, scaling, unpacking. */
function resizeMask(mask: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < mask.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = mask[i];
    rgba[i * 4 + 3] = 255;
  }
  const resized = resizeRGBA(rgba, sw, sh, dw, dh);
  const out = new Uint8ClampedArray(dw * dh);
  for (let i = 0; i < out.length; i++) out[i] = resized[i * 4];
  return out;
}

/** Resize source RGBA to inputSize² and produce an NCHW float32 input tensor. */
export function toInputTensor(rgba: Uint8ClampedArray, srcW: number, srcH: number, cfg: ModelConfig): Float32Array {
  const n = cfg.inputSize;
  const px = resizeRGBA(rgba, srcW, srcH, n, n);
  const out = new Float32Array(3 * n * n);
  const plane = n * n;
  for (let i = 0; i < plane; i++) {
    const r = px[i * 4] / cfg.scaleDiv;
    const g = px[i * 4 + 1] / cfg.scaleDiv;
    const b = px[i * 4 + 2] / cfg.scaleDiv;
    out[i] = (r - cfg.mean[0]) / cfg.std[0];
    out[plane + i] = (g - cfg.mean[1]) / cfg.std[1];
    out[2 * plane + i] = (b - cfg.mean[2]) / cfg.std[2];
  }
  return out;
}

/**
 * Convert model output (inputSize²) into a full-resolution alpha mask (0–255).
 * Saliency maps are contrast-stretched (min-max) like rembg; mattes are used
 * directly as alpha.
 */
export function toFullResMask(
  output: Float32Array,
  modelN: number,
  srcW: number,
  srcH: number,
  cfg: ModelConfig,
): Uint8ClampedArray {
  let lo = 0;
  let span = 1;
  if (cfg.output === 'saliency') {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < output.length; i++) {
      const v = output[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo = min;
    span = max - min || 1;
  }
  const small = new Uint8ClampedArray(modelN * modelN);
  for (let i = 0; i < small.length; i++) {
    const v = cfg.output === 'saliency' ? (output[i] - lo) / span : output[i];
    small[i] = Math.round(clamp01(v) * 255);
  }
  return resizeMask(small, modelN, modelN, srcW, srcH);
}
