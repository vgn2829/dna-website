import type { BackgroundProcessor, RemovalProgress } from './processor';
import type { ModelId } from './types';
export const HELPER_URL = 'http://127.0.0.1:8935';
const CHECKPOINT = 'studioludens/birefnet-lite-512@962e67969ec6acec9c19fab76acee4f5e22e990c';
const SHA = '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2';
export async function checkHelper(): Promise<void> {
  const response = await fetch(`${HELPER_URL}/health`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Local helper is unavailable');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('protocol' in result) || result.protocol !== 1 || !('ready' in result) || result.ready !== true || !('checkpoint' in result) || result.checkpoint !== CHECKPOINT || !('sha256' in result) || result.sha256 !== SHA) throw new Error('Helper is not ready with the verified checkpoint');
}
class HelperProcessor implements BackgroundProcessor {
  private controller: AbortController | null = null;
  private job: string | null = null;
  cancel() {
    this.controller?.abort(); this.controller = null;
    const id = this.job; this.job = null;
    if (id) void fetch(`${HELPER_URL}/jobs/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(2500) }).catch(() => {});
  }
  release() { this.cancel(); }
  async segment(image: ImageData, model: ModelId, progress?: (value: RemovalProgress) => void): Promise<Uint8ClampedArray> {
    if (model !== 'detail') throw new Error('The Python helper uses the Detail checkpoint only');
    this.cancel(); const controller = new AbortController(); this.controller = controller;
    const job = crypto.randomUUID(); this.job = job;
    let timedOut = false;
    const timer = setTimeout(() => { if (this.controller === controller) { timedOut = true; this.cancel(); } }, 60_000);
    try {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image encoding is unavailable');
      context.putImageData(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/png'));
      if (controller.signal.aborted) throw new DOMException('Helper request cancelled', 'AbortError');
      progress?.({ phase: 'infer' });
      const response = await fetch(`${HELPER_URL}/mask`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/png', 'X-DnA-Job': job }, signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || `Helper failed (HTTP ${response.status}). Browser processing remains available.`);
      }
      if (response.headers.get('Content-Type') !== 'image/png') throw new Error('Helper returned an invalid mask type');
      if (Number(response.headers.get('Content-Length')) > image.width * image.height * 2 + 65536) throw new Error('Helper mask exceeds response limit');
      const output = await response.blob(); if (output.size > image.width * image.height * 2 + 65536) throw new Error('Helper mask exceeds response limit');
      const bitmap = await createImageBitmap(output);
      try {
        if (bitmap.width !== image.width || bitmap.height !== image.height) throw new Error('Helper mask dimensions do not match');
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const mask = new Uint8ClampedArray(image.width * image.height);
        for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4];
        if (controller.signal.aborted) throw new DOMException('Helper request cancelled', 'AbortError');
        return mask;
      } finally { bitmap.close(); }
    } catch (error) {
      if (timedOut) throw new Error('Local helper timed out after 60 seconds. Browser processing remains available.');
      if (error instanceof TypeError) throw new Error('Local helper unavailable. Start it again or choose browser processing.');
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) { this.controller = null; this.job = null; }
    }
  }
}
export const helperBackgroundProcessor: BackgroundProcessor = new HelperProcessor();
