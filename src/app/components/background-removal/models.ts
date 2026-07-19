import type { ModelId } from './types';

/** Whether the model's output is a hard-ish saliency map or a soft alpha matte. */
export type OutputKind = 'saliency' | 'matte';

export interface ModelConfig {
  id: ModelId;
  label: string;
  /** Honest one-line limitation, surfaced in the UI. */
  caption: string;
  /** Served path (versioned filename so cache invalidation is a rename). */
  url: string;
  /** Square input resolution the model expects. */
  inputSize: number;
  /** Per-channel normalization: (channel / scaleDiv - mean) / std. */
  mean: [number, number, number];
  std: [number, number, number];
  scaleDiv: number;
  output: OutputKind;
  /** Rough download size, for the progress copy. */
  approxMB: number;
}

// Adding a model later is a data change here — the worker stays generic.
export const MODELS: Record<ModelId, ModelConfig> = {
  general: {
    id: 'general',
    label: 'General',
    caption: 'Fast, works on most subjects. Edges can be hard on fine hair.',
    url: '/models/u2netp.v1.onnx',
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    scaleDiv: 255,
    output: 'saliency',
    approxMB: 4.6,
  },
  portrait: {
    id: 'portrait',
    label: 'Portrait (people)',
    caption: 'Better hair and edges, but people only — misses objects and products.',
    url: '/models/modnet.v1.onnx',
    inputSize: 512,
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    scaleDiv: 255,
    output: 'matte',
    approxMB: 25,
  },
};
