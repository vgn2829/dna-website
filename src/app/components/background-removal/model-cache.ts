import { MODELS } from './models';
const CACHE = 'bg-models-v2';
const HASHES: Record<string, string> = {
  '/models/u2netp.v1.onnx': '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  '/models/modnet.v1.onnx': '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
};
async function validate(url: string, buffer: ArrayBuffer) {
  const expected = HASHES[url] || Object.values(MODELS).find(model => model.url === url)?.sha256;
  if (!expected) throw new Error('Unknown model artifact');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('Model integrity check failed. Retry the download.');
}
export async function fetchModel(url: string, onProgress?: (pct?: number) => void): Promise<ArrayBuffer> {
  const maxBytes = Object.values(MODELS).find(model => model.url === url)?.requiresWebGPU ? 210 * 1024 * 1024 : 50 * 1024 * 1024;
  let cache: Cache | null = null;
  try {
    cache = 'caches' in globalThis ? await caches.open(CACHE) : null;
    const hit = await cache?.match(url);
    if (hit) { const buffer = await hit.arrayBuffer(); await validate(url, buffer); return buffer; }
  } catch { /* Storage is optional, including corrupt cached entries. */ }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > maxBytes) throw new Error('Model exceeds download limit');
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        received += value.length;
        if (received > maxBytes) { await reader.cancel(); throw new Error('Model exceeds download limit'); }
        chunks.push(value); onProgress?.(total ? Math.min(100, Math.round(received / total * 100)) : undefined);
      }
    } finally { reader.releaseLock(); }
  } else chunks.push(new Uint8Array(await response.arrayBuffer()));
  const buffer = await new Blob(chunks as BlobPart[]).arrayBuffer();
  await validate(url, buffer);
  try { await cache?.put(url, new Response(buffer.slice(0))); } catch { /* Quota/denial must not block inference. */ }
  return buffer;
}
