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
    const bytes = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn(
      async () => new Response(bytes, { headers: { "content-length": "3" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    expect(new Uint8Array(await fetchModel("/fixture.onnx", progress))).toEqual(
      bytes,
    );
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
  await expect(fetchModel("/fixture.onnx")).rejects.toThrow("503");
});
