export const cancelled = () =>
  new DOMException("Operation cancelled", "AbortError");
export class JobOwner {
  private revision = 0;
  next() {
    return ++this.revision;
  }
  capture() {
    return this.revision;
  }
  current(id: number) {
    return this.revision === id;
  }
  cancel() {
    ++this.revision;
  }
}
export class WorkerClient<T> {
  private worker: Worker | null = null;
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (value: T) => void; reject: (error: Error) => void }
  >();
  constructor(
    private create: () => Worker,
    private decode: (message: any) => T,
    private progress?: (message: any) => void,
  ) {}
  request(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          const worker = this.create();
          this.worker = worker;
          worker.onmessage = (e) => {
            if (this.worker !== worker) return;
            const entry = this.pending.get(e.data.id);
            if (!entry) return;
            if (e.data.type === "progress") {
              this.progress?.(e.data);
              return;
            }
            this.pending.delete(e.data.id);
            if (e.data.type === "error")
              entry.reject(new Error(e.data.message));
            else {
              try {
                entry.resolve(this.decode(e.data));
              } catch (error) {
                entry.reject(error as Error);
              }
            }
          };
          worker.onerror = (e) => {
            if (this.worker === worker)
              this.cancel(
                new Error(e.message || "Worker failed. Retry the operation."),
              );
          };
          worker.onmessageerror = () => {
            if (this.worker === worker)
              this.cancel(new Error("Worker returned an unreadable result."));
          };
        }
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error as Error);
        this.cancel();
      }
    });
  }
  cancel(reason: Error = cancelled()) {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(reason);
    this.pending.clear();
  }
}
export function dimensions(
  w: number,
  h: number,
  maxEdge = 8192,
  maxPixels = 16_777_216,
) {
  if (
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w < 1 ||
    h < 1 ||
    w > maxEdge ||
    h > maxEdge ||
    w * h > maxPixels
  )
    throw new Error(
      "Output must be 1–8192px per edge and at most 16 megapixels.",
    );
  return { w: Math.round(w), h: Math.round(h) };
}
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode this image."));
    img.src = url;
  });
}
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 1,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Image encoding failed. Try a smaller output.")),
      type,
      quality,
    ),
  );
}
