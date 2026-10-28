import { afterEach, expect, it, vi } from "vitest";
import { loadSourceImage } from "./compositing";
afterEach(() => vi.unstubAllGlobals());
it("closes the original bitmap when downscale allocation fails", async () => {
  const original = { width: 6000, height: 4000, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockRejectedValueOnce(new Error("allocation failed")),
  );
  await expect(loadSourceImage(new Blob(), "fixture")).rejects.toThrow(
    "allocation failed",
  );
  expect(original.close).toHaveBeenCalledOnce();
});
