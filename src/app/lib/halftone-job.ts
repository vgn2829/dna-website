import type { HalftoneOptions } from './halftone-logic';
export function renderHalftone(image: ImageData, options: HalftoneOptions, format: 'png' | 'svg', signal: AbortSignal, progress?: (phase: string) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./halftone.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error('Rendering timed out. Increase pattern spacing.')); }, 60_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error('Rendering worker failed. Retry to restart.')); };
    worker.onmessageerror = () => { finish(); reject(new Error('Invalid rendering response')); };
    worker.onmessage = event => {
      if (event.data.phase) { progress?.(event.data.phase); return; }
      finish();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.blob);
    };
    worker.postMessage({ image, options, format });
  });
}
