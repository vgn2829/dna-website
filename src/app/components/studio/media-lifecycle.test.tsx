// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ImageConverter } from "./ImageConverter";
const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  vi.restoreAllMocks();
});
it("reset during PDF getPage destroys the document and never starts late rendering", async () => {
  let resolvePage!: (page: any) => void;
  const render = vi.fn();
  const pagePromise = new Promise((r) => (resolvePage = r));
  const destroy = vi.fn(async () => {});
  pdf.getDocument.mockReturnValue({
    destroy,
    promise: Promise.resolve({ numPages: 2, getPage: () => pagePromise }),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<ImageConverter />));
    const file = new File(["pdf"], "test.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new ArrayBuffer(1),
    });
    await act(async () => {
      const input = host.querySelector("input")!;
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledOnce(), {
        timeout: 2000,
      });
    });
    expect(pdf.getDocument).toHaveBeenCalledOnce();
    await act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "Cancel")!
        .click(),
    );
    await act(async () => {
      resolvePage({ getViewport: () => ({ width: 100, height: 100 }), render });
      await pagePromise;
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(host.textContent).not.toContain("Processing");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("accepts browser-decodable image types and avoids orphan URLs when preview serialization fails", async () => {
  const create = vi.fn(() => "blob:source"),
    revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 40;
      naturalHeight = 30;
      onload: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
    cb(new Blob(["encoded"], { type: "image/png" })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
    throw new Error("preview allocation failed");
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<ImageConverter />));
    await act(async () => {
      const input = host.querySelector("input")!;
      Object.defineProperty(input, "files", {
        value: [new File(["avif"], "test.avif", { type: "image/avif" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("40 × 30px");
    await act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "Convert")!
        .click(),
    );
    expect(host.querySelector("[role=alert]")!.textContent).toContain(
      "preview allocation failed",
    );
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
  expect(revoke).toHaveBeenCalledWith("blob:source");
});
