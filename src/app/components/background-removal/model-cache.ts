// Fetch a model file, persisting it in the Cache API so it downloads once and
// survives reloads / works offline afterwards. Runs inside the worker (the
// Cache API is available there). Bump CACHE to invalidate everything.

const CACHE = 'bg-models-v1';

export async function fetchModel(
  url: string,
  onProgress?: (pct?: number) => void,
): Promise<ArrayBuffer> {
  const cache = 'caches' in globalThis ? await caches.open(CACHE) : null;

  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer(); // warm path — no network
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Model download failed (HTTP ${resp.status})`);

  // No streaming body available — fall back to a plain buffered download.
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    if (cache) await cache.put(url, new Response(buf.slice(0)));
    return buf;
  }

  const total = Number(resp.headers.get('content-length')) || 0;
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(total ? Math.round((received / total) * 100) : undefined);
  }

  const blob = new Blob(chunks as BlobPart[]);
  if (cache) await cache.put(url, new Response(blob));
  return blob.arrayBuffer();
}
