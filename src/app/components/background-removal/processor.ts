import type { ModelId, SegmentRequest, WorkerResponse } from './types';
export interface RemovalProgress { phase: 'download' | 'init' | 'infer'; pct?: number; backend?: "webgpu" | "wasm" }
export interface BackgroundProcessor {
  segment(image: ImageData, model: ModelId, progress?: (value: RemovalProgress) => void): Promise<Uint8ClampedArray>;
  cancel(): void;
  release(): void;
}
/** One job and at most one model session. Warm worker is released after two idle minutes. */
class LocalProcessor implements BackgroundProcessor {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending: { id: number; resolve: (mask: Uint8ClampedArray) => void; reject: (error: Error) => void; progress?: (value: RemovalProgress) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private idle?: ReturnType<typeof setTimeout>;
  release() {
    clearTimeout(this.idle);
    this.worker?.terminate(); this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new DOMException('Processing cancelled', 'AbortError'));
      this.pending = null;
    }
  }
  cancel() { if (this.pending) this.release(); }
  segment(image: ImageData, model: ModelId, progress?: (value: RemovalProgress) => void) {
    this.cancel(); clearTimeout(this.idle);
    if (!this.worker) {
      const worker = new Worker(new URL('./bg-removal.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const fail = (message: string) => {
        if (this.worker !== worker) return;
        const job = this.pending; this.pending = null;
        if (job) { clearTimeout(job.timer); job.reject(new Error(message)); }
        this.release();
      };
      worker.onerror = event => fail(event.message || 'Processing worker crashed. Retry to restart.');
      worker.onmessageerror = () => fail('Invalid worker response. Retry to restart.');
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (this.worker !== worker) return;
        const job = this.pending, msg = event.data;
        if (!job || job.id !== msg.id) return;
        if (msg.type === 'progress') { job.progress?.(msg); return; }
        this.pending = null; clearTimeout(job.timer);
        if (msg.type === 'result') job.resolve(new Uint8ClampedArray(msg.mask));
        else job.reject(new Error(msg.message));
        this.idle = setTimeout(() => this.release(), 120_000);
      };
    }
    return new Promise<Uint8ClampedArray>((resolve, reject) => {
      const id = ++this.sequence;
      const timeoutMs = model === 'detail' ? 300_000 : 120_000;
      const timer = setTimeout(() => {
        this.pending = null; this.release(); reject(new Error(`Processing timed out after ${timeoutMs / 1000} seconds. Retry or use a smaller image.`));
      }, timeoutMs);
      this.pending = { id, resolve, reject, progress, timer };
      const rgba = image.data.slice().buffer;
      const request: SegmentRequest = { type: 'segment', id, model, rgba, width: image.width, height: image.height };
      try { this.worker!.postMessage(request, [rgba]); }
      catch (error) { this.pending = null; clearTimeout(timer); this.release(); reject(error); }
    });
  }
}
export const localBackgroundProcessor: BackgroundProcessor = new LocalProcessor();
