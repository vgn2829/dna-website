/// <reference lib="webworker" />
// Runtime assets and weights are lazy. At most one job and one warm session.
import type * as ORT from 'onnxruntime-web';
import type { WorkerRequest, SegmentResult, SegmentError, SegmentProgress, ModelId } from './types';
import { MODELS } from './models';
import { fetchModel } from './model-cache';
import { toInputTensor, toFullResMask, modelInputDimensions } from './preprocess';
const ctx = self as unknown as DedicatedWorkerGlobalScope;
type Runtime = typeof ORT;
type Session = { ort: Runtime; session: ORT.InferenceSession; backend: 'webgpu' | 'wasm'; model: ModelId };
let warm: Session | null = null;
let initializing: Promise<Session> | null = null;
let runtime: Promise<{ ort: Runtime; gpu: boolean }> | null = null;
let gpuFailed = false, busy = false;
const blockedModels = new Set<ModelId>();
function post(msg: SegmentProgress | SegmentResult | SegmentError) { ctx.postMessage(msg); }
async function getRuntime() {
  if (!runtime) runtime = (async () => {
    let available = false;
    const gpu = (navigator as WorkerNavigator & { gpu?: { requestAdapter(): Promise<{ features: { has(feature: string): boolean } } | null> } }).gpu;
    try {
      const adapter = await gpu?.requestAdapter();
      available = !!adapter;
      // Existing checkpoints use float32. Detect f16, but never assume it is available or required.
      const supportsFloat16 = !!adapter?.features.has('shader-f16');
      void supportsFloat16;
    } catch { /* Missing or denied GPU is a normal CPU path. */ }
    const ort = available ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1; // Works without SharedArrayBuffer/cross-origin isolation.
    return { ort, gpu: available };
  })().catch(error => { runtime = null; throw error; });
  return runtime;
}
async function getSession(model: ModelId, id: number, timings: Record<string, number>, forceWasm = false): Promise<Session> {
  if (blockedModels.has(model)) throw new Error('Detail was disabled after a GPU failure. Use General/Portrait or the Python helper.');
  if (warm?.model === model && (!forceWasm || warm.backend === 'wasm')) return warm;
  if (initializing) return initializing;
  initializing = (async () => {
    if (warm) { await warm.session.release(); warm = null; }
    const cfg = MODELS[model];
    if (cfg.requiresWebGPU) {
      const available = await getRuntime();
      if (!available.gpu || gpuFailed || forceWasm) throw new Error('Detail requires WebGPU. Choose General/Portrait or explicitly select the Python helper.');
    }
    post({ type: 'progress', id, phase: 'download' });
    const downloadStart = performance.now();
    const weights = await fetchModel(cfg.url, pct => post({ type: 'progress', id, phase: 'download', pct }));
    timings.downloadMs += performance.now() - downloadStart;
    post({ type: 'progress', id, phase: 'init' });
    const initStart = performance.now();
    let selected: { ort: Runtime; gpu: boolean };
    try { selected = await getRuntime(); }
    catch { selected = { ort: await import('onnxruntime-web/wasm'), gpu: false }; selected.ort.env.wasm.numThreads = 1; }
    const backend = selected.gpu && !gpuFailed && !forceWasm ? 'webgpu' : 'wasm';
    try {
      const session = await selected.ort.InferenceSession.create(weights, { executionProviders: [backend], graphOptimizationLevel: 'all' });
      warm = { ort: selected.ort, session, backend, model };
    } catch (error) {
      if (cfg.requiresWebGPU) { blockedModels.add(model); throw new Error('Detail could not initialize on this GPU. Use General/Portrait or the Python helper.'); }
      if (backend !== 'webgpu') throw error;
      gpuFailed = true;
      const session = await selected.ort.InferenceSession.create(weights, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      warm = { ort: selected.ort, session, backend: 'wasm', model };
    }
    timings.initMs += performance.now() - initStart;
    return warm;
  })();
  try { return await initializing; } finally { initializing = null; }
}
ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== 'segment') return;
  if (busy) { post({ type: 'error', id: msg.id, message: 'Processor busy' }); return; }
  busy = true;
  try {
    const cfg = MODELS[msg.model];
    if (!cfg || !Number.isInteger(msg.width) || !Number.isInteger(msg.height) || Math.min(msg.width, msg.height) < 1 || Math.max(msg.width, msg.height) > 2560 || msg.width * msg.height > 2560 * 2560 || msg.rgba.byteLength !== msg.width * msg.height * 4) throw new Error('Invalid processing request');
    const timings: Record<string, number> = { downloadMs: 0, initMs: 0 };
    let selected = await getSession(msg.model, msg.id, timings);
    const preprocessStart = performance.now();
    const inputData = toInputTensor(new Uint8ClampedArray(msg.rgba), msg.width, msg.height, cfg);
    const dimensions = modelInputDimensions(msg.width, msg.height, cfg);
    timings.preprocessMs = performance.now() - preprocessStart;
    for (let attempt = 0; attempt < 2; attempt++) {
      const tensor = new selected.ort.Tensor('float32', inputData, [1, 3, dimensions.height, dimensions.width]);
      let outputs: ORT.InferenceSession.ReturnType | undefined;
      try {
        post({ type: 'progress', id: msg.id, phase: 'infer', backend: selected.backend });
        const start = performance.now();
        outputs = await selected.session.run({ [selected.session.inputNames[0]]: tensor }, [selected.session.outputNames[0]]);
        timings.inferenceMs = performance.now() - start;
        const postStart = performance.now();
        const first = outputs[selected.session.outputNames[0]];
        const mask = toFullResMask(first.data as Float32Array, dimensions, msg.width, msg.height, cfg);
        timings.postprocessMs = performance.now() - postStart;
        ctx.postMessage({ type: 'result', id: msg.id, mask: mask.buffer as ArrayBuffer, timings, backend: selected.backend } satisfies SegmentResult, [mask.buffer]);
        break;
      } catch (error) {
        if (cfg.requiresWebGPU) { blockedModels.add(msg.model); throw new Error('Detail failed on this GPU and will not retry automatically. Use General/Portrait or the Python helper.'); }
        if (selected.backend !== 'webgpu' || attempt) throw error;
        gpuFailed = true;
        selected = await getSession(msg.model, msg.id, timings, true);
      } finally { tensor.dispose(); if (outputs) Object.values(outputs).forEach(value => value.dispose()); }
    }
  } catch (error) {
    post({ type: 'error', id: msg.id, message: error instanceof Error ? error.message : 'Inference failed' });
  } finally { busy = false; }
};
