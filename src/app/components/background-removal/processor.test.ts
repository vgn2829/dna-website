import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { localBackgroundProcessor as processor } from './processor';
import { applyMask } from './compositing';
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  request?: { id: number }; terminated = false;
  constructor() { WorkerStub.instances.push(this); }
  postMessage(value: { id: number }) { this.request = value; }
  terminate() { this.terminated = true; }
  result() { this.onmessage?.({ data: { type: 'result', id: this.request!.id, mask: new Uint8Array([128]).buffer } }); }
}
const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([20, 30, 40, 128]) } as ImageData;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Worker', WorkerStub); });
afterEach(() => { processor.release(); vi.useRealTimers(); vi.unstubAllGlobals(); WorkerStub.instances = []; });
test('crash rejects current request, retry recreates worker and idle session expires', async () => {
  const pending = processor.segment(pixels, 'general'); const rejected = expect(pending).rejects.toThrow('crash');
  WorkerStub.instances[0].onerror!({ message: 'crash' }); await rejected;
  const next = processor.segment(pixels, 'general'); expect(WorkerStub.instances).toHaveLength(2);
  WorkerStub.instances[1].result(); expect(await next).toEqual(new Uint8ClampedArray([128]));
  const warm = processor.segment(pixels, 'general'); expect(WorkerStub.instances).toHaveLength(2); WorkerStub.instances[1].result(); await warm;
  await vi.advanceTimersByTimeAsync(120001); expect(WorkerStub.instances[1].terminated).toBe(true);
});
test('cancel, replacement, timeout and termination reject jobs', async () => {
  const old = processor.segment(pixels, 'general'); const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  const next = processor.segment(pixels, 'portrait'); await rejected;
  const cancelled = expect(next).rejects.toMatchObject({ name: 'AbortError' }); processor.cancel(); await cancelled;
  const timeout = processor.segment(pixels, 'general'); const timedOut = expect(timeout).rejects.toThrow('timed out'); await vi.advanceTimersByTimeAsync(120001); await timedOut;
  const released = processor.segment(pixels, 'general'); const releaseRejected = expect(released).rejects.toMatchObject({ name: 'AbortError' }); processor.release(); await releaseRejected;
});
test('mask multiplication preserves source transparency and validates dimensions', () => {
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  expect(applyMask(pixels, new Uint8ClampedArray([128])).data[3]).toBe(64);
  expect(pixels.data[3]).toBe(128);
  expect(() => applyMask(pixels, new Uint8ClampedArray(2))).toThrow('dimensions');
});
test('late events from a terminated worker cannot reject the replacement job', async () => {
  const old = processor.segment(pixels, 'general'); const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  const replacement = processor.segment(pixels, 'general'); await cancelled;
  WorkerStub.instances[0].onerror!({ message: 'late crash' }); WorkerStub.instances[0].result();
  WorkerStub.instances[1].result(); expect(await replacement).toEqual(new Uint8ClampedArray([128]));
});
test('manual restore preserves the source alpha in dirty-region compositing', async () => {
  const { recompositeRegion } = await import('./refine');
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  let painted: ImageData | undefined;
  const canvas = { getContext: () => ({ putImageData: (image: ImageData) => { painted = image; } }) } as unknown as HTMLCanvasElement;
  recompositeRegion(canvas, pixels, new Uint8ClampedArray([255]), { x0: 0, y0: 0, x1: 0, y1: 0 });
  expect(painted?.data[3]).toBe(128);
});
