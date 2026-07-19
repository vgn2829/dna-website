import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelId, RemovalStatus, SegmentRequest, WorkerResponse } from './types';

interface Pending {
  resolve: (mask: Uint8ClampedArray) => void;
  reject: (err: Error) => void;
}

export interface RemovalProgress {
  phase: 'download' | 'init' | 'infer';
  pct?: number;
}

/**
 * Orchestrates the segmentation Web Worker: lazily spawns it on first use,
 * tracks per-request promises by id, and exposes status/error to the UI.
 * The worker is terminated on unmount. Progress messages surface the
 * download / init / inference phases to the UI.
 */
export function useBackgroundRemoval() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const pending = useRef<Map<number, Pending>>(new Map());
  const [status, setStatus] = useState<RemovalStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RemovalProgress | null>(null);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('./bg-removal.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress({ phase: msg.phase, pct: msg.pct });
        return;
      }
      const entry = pending.current.get(msg.id);
      if (!entry) return;
      pending.current.delete(msg.id);
      setProgress(null);
      if (msg.type === 'result') entry.resolve(new Uint8ClampedArray(msg.mask));
      else entry.reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      setError(e.message || 'Worker crashed');
      setStatus('error');
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const removeBackground = useCallback(
    (image: ImageData, model: ModelId = 'general'): Promise<Uint8ClampedArray> => {
      setStatus('processing');
      setError(null);
      setProgress(null);
      const worker = ensureWorker();
      const id = ++idRef.current;
      const rgba = image.data.slice().buffer; // copy so the caller keeps its pixels
      return new Promise<Uint8ClampedArray>((resolve, reject) => {
        pending.current.set(id, {
          resolve: (mask) => {
            setStatus('done');
            resolve(mask);
          },
          reject: (err) => {
            setStatus('error');
            setError(err.message);
            reject(err);
          },
        });
        const req: SegmentRequest = { type: 'segment', id, model, width: image.width, height: image.height, rgba };
        worker.postMessage(req, [rgba]);
      });
    },
    [ensureWorker],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setProgress(null);
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pending.current.clear();
    },
    [],
  );

  return { status, error, progress, removeBackground, reset };
}
