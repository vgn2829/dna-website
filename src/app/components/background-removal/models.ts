import type { ModelId } from './types';

/** Whether the model's output is a hard-ish saliency map or a soft alpha matte. */
export type OutputKind = 'saliency' | 'matte' | 'logits';

export interface ModelConfig {
  id: ModelId;
  label: string;
  /** Honest one-line limitation, surfaced in the UI. */
  caption?: string;
  /** Served path (versioned filename so cache invalidation is a rename). */
  url: string;
  /** Reference input resolution (static square for general; dynamic multiples of 32 for portrait). */
  inputSize: number;
  /** Per-channel normalization: (channel / scaleDiv - mean) / std. */
  mean: [number, number, number];
  std: [number, number, number];
  scaleDiv: number;
  output: OutputKind;
  /** Rough download size, for the progress copy. */
  approxMB: number;
  requiresWebGPU?: boolean;
  sha256?: string;
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
    caption: 'People only. Preserves aspect ratio at multiples of 32, with a 1024px inference edge limit.',
    url: '/models/modnet.v1.onnx',
    inputSize: 512,
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    scaleDiv: 255,
    output: 'matte',
    approxMB: 25,
  },
  detail: {
    id: 'detail', label: 'Detail (WebGPU)',
    url: 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model.onnx',
    inputSize: 512, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scaleDiv: 255,
    output: 'logits', approxMB: 192, requiresWebGPU: true,
    sha256: '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2',
  },
};
