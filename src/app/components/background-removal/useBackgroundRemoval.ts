import { helperBackgroundProcessor } from './helper-processor';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelId, RemovalStatus } from './types';
import { localBackgroundProcessor as processor, type RemovalProgress } from './processor';
export type { RemovalProgress } from './processor';
export function useBackgroundRemoval() {
  const [status, setStatus] = useState<RemovalStatus>('idle');
  const [backend, setBackend] = useState<'webgpu' | 'wasm' | 'helper' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RemovalProgress | null>(null);
  const generation = useRef(0);
  const reset = useCallback(() => {
    ++generation.current; processor.cancel(); helperBackgroundProcessor.cancel(); setStatus('idle'); setError(null); setProgress(null);
  }, []);
  const removeBackground = useCallback(async (image: ImageData, model: ModelId = 'general', provider: 'browser' | 'helper' = 'browser') => {
    const token = ++generation.current;
    processor.cancel(); helperBackgroundProcessor.cancel();
    setStatus('processing'); setError(null); setProgress(null);
    try {
      const selected = provider === 'helper' ? helperBackgroundProcessor : processor;
      if (provider === 'helper') setBackend('helper');
      const mask = await selected.segment(image, model, value => { if (token === generation.current) { setProgress(value); if (value.backend) setBackend(value.backend); } });
      if (token !== generation.current) throw new DOMException('Stale result', 'AbortError');
      setStatus('done'); setProgress(null); return mask;
    } catch (reason) {
      if (token === generation.current) { setStatus('error'); setProgress(null); setError(reason instanceof Error ? reason.message : 'Processing failed'); }
      throw reason;
    }
  }, []);
  useEffect(() => () => { ++generation.current; processor.cancel(); helperBackgroundProcessor.cancel(); }, []);
  const release = useCallback(() => { reset(); processor.release(); setBackend(null); }, [reset]);
  return { status, error, progress, backend, removeBackground, reset, release };
}
