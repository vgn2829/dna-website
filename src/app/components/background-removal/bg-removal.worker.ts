/// <reference lib="webworker" />
// Background-removal Web Worker — runs ONNX segmentation off the main thread.
//
// Single-threaded WASM + SIMD (numThreads = 1): no SharedArrayBuffer, so NO
// COOP/COEP / cross-origin isolation is required (see the Phase-2 plan). ORT and
// its WASM live in this worker's own chunk, fetched only when the worker spins
// up (first "Remove" click).

// CPU WASM backend only — avoids pulling the ~27 MB WebGPU (jsep) WASM into the
// build. We run single-thread + SIMD on the CPU backend.
import * as ort from 'onnxruntime-web/wasm';
import type { WorkerRequest, SegmentResult, SegmentError, SegmentProgress, ModelId } from './types';
import { MODELS } from './models';
import { fetchModel } from './model-cache';
import { toInputTensor, toFullResMask } from './preprocess';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let ortConfigured = false;
const sessions = new Map<ModelId, ort.InferenceSession>();

function post(msg: SegmentProgress | SegmentResult | SegmentError): void {
  ctx.postMessage(msg);
}

function configureOrt(): void {
  ort.env.wasm.numThreads = 1; // single-thread — no cross-origin isolation needed
  // No wasmPaths override: the CPU-WASM ("bundle") build references its own .wasm
  // via import.meta.url, which Vite emits as a fingerprinted asset on our origin.
  ortConfigured = true;
}

async function getSession(model: ModelId, id: number): Promise<ort.InferenceSession> {
  const existing = sessions.get(model);
  if (existing) return existing;
  const cfg = MODELS[model];
  post({ type: 'progress', id, phase: 'download' });
  const buf = await fetchModel(cfg.url, (pct) => post({ type: 'progress', id, phase: 'download', pct }));
  post({ type: 'progress', id, phase: 'init' });
  const session = await ort.InferenceSession.create(buf, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  sessions.set(model, session);
  return session;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== 'segment') return;
  try {
    if (!ortConfigured) configureOrt();
    const cfg = MODELS[msg.model];
    const session = await getSession(msg.model, msg.id);

    const rgba = new Uint8ClampedArray(msg.rgba);
    const inputData = toInputTensor(rgba, msg.width, msg.height, cfg);
    const tensor = new ort.Tensor('float32', inputData, [1, 3, cfg.inputSize, cfg.inputSize]);

    post({ type: 'progress', id: msg.id, phase: 'infer' });
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const first = outputs[session.outputNames[0]];

    const mask = toFullResMask(first.data as Float32Array, cfg.inputSize, msg.width, msg.height, cfg);
    const res: SegmentResult = { type: 'result', id: msg.id, mask: mask.buffer };
    ctx.postMessage(res, [mask.buffer]);
  } catch (err) {
    const res: SegmentError = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : 'Inference failed',
    };
    ctx.postMessage(res);
  }
};
