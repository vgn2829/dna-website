import { useCallback, useEffect, useRef, useState } from 'react';
import type { TracerConfig, VectorizeRequest, VectorizeStatus, WorkerResponse } from './types';

interface Pending {
  resolve: (svg: string) => void;
  reject: (err: Error) => void;
}

/**
 * Orchestrates the vectorize Web Worker: lazily spawns it on first use,
 * tracks per-request promises by id, and exposes status/error to the UI.
 * The worker is terminated on unmount.
 */
export function useVectorize() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const pending = useRef<Map<number, Pending>>(new Map());
  const [status, setStatus] = useState<VectorizeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('./vectorize.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const entry = pending.current.get(msg.id);
      if (!entry) return;
      pending.current.delete(msg.id);
      if (msg.type === 'result') entry.resolve(msg.svg);
      else entry.reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      setError(e.message || 'Worker crashed');
      setStatus('error');
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const vectorize = useCallback(
    (image: ImageData, config: TracerConfig): Promise<string> => {
      setStatus('processing');
      setError(null);
      const worker = ensureWorker();
      const id = ++idRef.current;
      const rgba = image.data.slice().buffer; // copy so the caller keeps its pixels
      return new Promise<string>((resolve, reject) => {
        pending.current.set(id, {
          resolve: (svg) => {
            setStatus('done');
            resolve(svg);
          },
          reject: (err) => {
            setStatus('error');
            setError(err.message);
            reject(err);
          },
        });
        const req: VectorizeRequest = { type: 'vectorize', id, width: image.width, height: image.height, rgba, config };
        worker.postMessage(req, [rgba]);
      });
    },
    [ensureWorker],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pending.current.clear();
    },
    [],
  );

  return { status, error, vectorize, reset };
}
