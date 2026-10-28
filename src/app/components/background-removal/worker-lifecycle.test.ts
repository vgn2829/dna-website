import { afterEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  run: vi.fn(),
  inputDispose: vi.fn(),
  outputDispose: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("onnxruntime-web/wasm", () => ({
  env: { wasm: {} },
  InferenceSession: { create: fixture.create },
  Tensor: class {
    dispose = fixture.inputDispose;
  },
}));
vi.mock("./model-cache", () => ({ fetchModel: fixture.fetch }));
vi.mock("./preprocess", () => ({
  toInputTensor: () => new Float32Array(3),
  toFullResMask: () => new Uint8ClampedArray([255]),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.resetModules();
});
it("shares in-flight model initialization and disposes tensors for every request", async () => {
  const context = { postMessage: vi.fn(), onmessage: null as any };
  vi.stubGlobal("self", context);
  let loaded!: (v: ArrayBuffer) => void;
  fixture.fetch.mockReturnValue(new Promise((r) => (loaded = r)));
  fixture.run.mockImplementation(async () => ({
    output: { data: new Float32Array([1]), dispose: fixture.outputDispose },
  }));
  fixture.create.mockResolvedValue({
    run: fixture.run,
    inputNames: ["input"],
    outputNames: ["output"],
  });
  await import("./bg-removal.worker");
  const message = (id: number) => ({
    data: {
      type: "segment",
      id,
      model: "general",
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray(4).buffer,
    },
  });
  const a = context.onmessage(message(1)),
    b = context.onmessage(message(2));
  expect(fixture.fetch).toHaveBeenCalledOnce();
  loaded(new ArrayBuffer(1));
  await Promise.all([a, b]);
  expect(fixture.create).toHaveBeenCalledOnce();
  expect(fixture.run).toHaveBeenCalledTimes(2);
  expect(fixture.inputDispose).toHaveBeenCalledTimes(2);
  expect(fixture.outputDispose).toHaveBeenCalledTimes(2);
  expect(
    context.postMessage.mock.calls
      .filter(([m]) => m.type === "result")
      .map(([m]) => m.id),
  ).toEqual([1, 2]);
});
