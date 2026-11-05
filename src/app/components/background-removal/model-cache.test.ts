import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fetchModel } from "./model-cache";
afterEach(() => vi.unstubAllGlobals());
it.each(["open", "match", "put"])(
  "downloads successfully when cache %s is denied",
  async (failure) => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    };
    if (failure === "match") cache.match.mockRejectedValue(new Error("denied"));
    if (failure === "put") cache.put.mockRejectedValue(new Error("quota"));
    vi.stubGlobal("caches", {
      open:
        failure === "open"
          ? vi.fn().mockRejectedValue(new Error("private mode"))
          : vi.fn(async () => cache),
    });
    const bytes = new Uint8Array(readFileSync("public/models/u2netp.v1.onnx"));
    const fetch = vi.fn(
      async () => new Response(bytes, { headers: { "content-length": String(bytes.length) } }),
    );
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    expect(createHash("sha256").update(new Uint8Array(await fetchModel("/models/u2netp.v1.onnx", progress))).digest("hex")).toBe("309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8");
    expect(fetch).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(100);
  },
);
it("reports HTTP download errors instead of caching them", async () => {
  vi.stubGlobal("caches", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await expect(fetchModel("/models/u2netp.v1.onnx")).rejects.toThrow("503");
});
it('corrupt cache falls back to download; invalid network body is never cached', async () => {
  const put = vi.fn();
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match: async () => new Response('corrupt'), put }) });
  const fetch = vi.fn().mockImplementation(async () => new Response(new Uint8Array(readFileSync('public/models/u2netp.v1.onnx')))); vi.stubGlobal('fetch', fetch);
  expect((await fetchModel('/models/u2netp.v1.onnx')).byteLength).toBe(readFileSync("public/models/u2netp.v1.onnx").byteLength); expect(fetch).toHaveBeenCalledOnce();
  put.mockClear(); fetch.mockImplementation(async () => new Response('<html>not a model</html>'));
  await expect(fetchModel('/models/u2netp.v1.onnx')).rejects.toThrow('integrity'); expect(put).not.toHaveBeenCalled();
});
