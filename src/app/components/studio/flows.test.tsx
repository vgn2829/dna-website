// @vitest-environment jsdom
import { studioDrafts } from "./drafts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FontPairing, makeFontUrl } from "./FontPairing";
import { GridCalculator } from "./GridCalculator";
import PaletteStudio from "../PaletteStudio";
import { SvgConverter } from "../SvgConverter";
import { ImageConverter } from "./ImageConverter";
import { ContrastChecker } from "./ContrastChecker";
import { applyMask } from "../background-removal/compositing";
import { recompositeRegion } from "../background-removal/refine";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  studioDrafts.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  URL.createObjectURL = vi.fn(() => `blob:fixture-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = async (node: React.ReactNode) => {
  await act(() => root.render(node));
};
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!;
const click = async (b: HTMLElement) => {
  await act(() => b.click());
};
const change = async (input: HTMLInputElement, value: string) => {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const upload = async (input: HTMLInputElement, file: File) => {
  await act(async () => {
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
};
it("palette edits and locks survive regeneration and theme switching", async () => {
  await render(<PaletteStudio />);
  const edit = host.querySelector<HTMLInputElement>(
    '[aria-label="Edit Accent"]',
  )!;
  await change(edit, "#123456");
  await click(host.querySelector('[aria-label="Lock Accent"]')!);
  await click(button("Generate"));
  await click(button("Dark"));
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Accent hex value"]')!
      .value,
  ).toBe("#123456");
  expect(
    host
      .querySelector('[aria-label="Unlock Accent"]')!
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("invalid draft generation leaves committed colours intact and reports the error", async () => {
  await render(<PaletteStudio />);
  const original = host.querySelector<HTMLInputElement>(
    '[aria-label="Primary hex value"]',
  )!.value;
  await change(host.querySelector('[aria-label="Seed hex"]')!, "#12");
  await click(button("Generate"));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "complete hex",
  );
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Primary hex value"]')!
      .value,
  ).toBe(original);
});
it("clipboard rejection never reports success and CSS remains downloadable", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    configurable: true,
  });
  await render(<PaletteStudio />);
  await click(button("Copy CSS"));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "Copy failed",
  );
  expect(button("Download CSS")).toBeTruthy();
});
it("mood changes remain separate and accessibility names the pair criteria", async () => {
  await render(<PaletteStudio />);
  await click(button("Mood"));
  expect(host.textContent).toContain("Independent mood exploration");
  await click(button("Accessibility"));
  expect(host.textContent).toContain("Normal AA");
  expect(host.textContent).toContain("signed");
  expect(host.textContent).not.toContain("AA+");
});
it("SVG input is rendered as an image, rejects active files, and recovers to valid input", async () => {
  await render(<SvgConverter />);
  await click(button("SVG → Image"));
  const inp = host.querySelector<HTMLInputElement>("input[type=file]")!;
  await upload(
    inp,
    new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" onload="window.marker=1"/>'],
      "bad.svg",
      { type: "image/svg+xml" },
    ),
  );
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "active content",
  );
  expect(host.querySelector(".studio-svg-preview")).toBeNull();
  await upload(
    inp,
    new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30" fill="red"/></svg>',
      ],
      "ok.svg",
      { type: "image/svg+xml" },
    ),
  );
  const preview = host.querySelector<HTMLImageElement>('img[alt="SVG input"]')!;
  expect(preview.tagName).toBe("IMG");
  expect(preview.src).toMatch(/^data:image\/svg\+xml/);
  expect(host.querySelector("svg rect[fill=red]")).toBeNull();
});
it("unsupported converter input gives an error and can be cleared", async () => {
  await render(<ImageConverter />);
  await upload(
    host.querySelector("input[type=file]")!,
    new File(["text"], "x.txt", { type: "text/plain" }),
  );
  expect(host.querySelector("[role=alert]")!.textContent).toContain(
    "supported image or PDF",
  );
});
it("contrast checker labels invalid drafts instead of silently treating them as current", async () => {
  await render(<ContrastChecker />);
  await change(host.querySelector("#contrast-fg")!, "#12");
  expect(host.querySelector("[role=alert]")!.textContent).toContain(
    "last valid pair",
  );
  expect(host.querySelector("#contrast-fg")!.getAttribute("aria-invalid")).toBe(
    "true",
  );
});
it("full and dirty-region mask compositing preserve original alpha", () => {
  class FixtureImageData {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  }
  vi.stubGlobal("ImageData", FixtureImageData);
  const image = new FixtureImageData(
    new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 128, 7, 8, 9, 255]),
    3,
    1,
  ) as ImageData;
  const mask = new Uint8ClampedArray([255, 128, 0]);
  expect(Array.from(applyMask(image, mask).data)).toEqual([
    1, 2, 3, 0, 4, 5, 6, 64, 7, 8, 9, 0,
  ]);
  const putImageData = vi.fn();
  recompositeRegion(
    { getContext: () => ({ putImageData }) } as unknown as HTMLCanvasElement,
    image,
    mask,
    { x0: 0, y0: 0, x1: 2, y1: 0 },
  );
  expect(putImageData.mock.calls[0][0].data).toEqual(
    applyMask(image, mask).data,
  );
  expect(() => applyMask(image, new Uint8ClampedArray(1))).toThrow(
    "dimensions",
  );
  vi.unstubAllGlobals();
});

it("Clear recents cancels a pending edited grid snapshot", async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D,
  );
  try {
    await render(<GridCalculator />);
    await click(button("A3"));
    expect(button("A3").getAttribute("aria-pressed")).toBe("true");
    await act(() => vi.advanceTimersByTime(700));
    expect(localStorage.getItem("dna_grid_recents")).not.toBeNull();
    await click(button("A5"));
    await click(button("Clear"));
    await act(() => vi.advanceTimersByTime(700));
    expect(localStorage.getItem("dna_grid_recents")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("SVG choices expose the active direction, engine and presets", async () => {
  await render(<SvgConverter />);
  expect(button("Image → SVG").getAttribute("aria-pressed")).toBe("true");
  await click(button("SVG → Image"));
  expect(button("SVG → Image").getAttribute("aria-pressed")).toBe("true");
  expect(button("Image → SVG").getAttribute("aria-pressed")).toBe("false");
});

it("Custom orientation names the actual output shape before and after swapping", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D,
  );
  await render(<GridCalculator />);
  await click(button("Custom"));
  const orientation = () =>
    host.querySelector<HTMLButtonElement>('[aria-label^="Swap orientation"]')!;
  expect(orientation().getAttribute("aria-label")).toContain("landscape");
  expect(orientation().getAttribute("aria-pressed")).toBe("true");
  await click(orientation());
  expect(orientation().getAttribute("aria-label")).toContain("portrait");
  expect(orientation().getAttribute("aria-pressed")).toBe("false");
});

it("releases pending SVG raster image URLs when the tool is left before decode completes", async () => {
  await render(<SvgConverter />);
  await click(button("SVG → Image"));
  await upload(
    host.querySelector("input[type=file]")!,
    new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"/>'],
      "safe.svg",
      { type: "image/svg+xml" },
    ),
  );
  await click(button("Convert to Image"));
  const url = vi.mocked(URL.createObjectURL).mock.results[0].value;
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
  await render(null);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
});

it("font stylesheet failure reports fallback and exposes selected filters", async () => {
  await render(<FontPairing />);
  const sheet = Array.from(document.head.querySelectorAll("link")).find((l) =>
    l.href.startsWith("https://fonts.googleapis.com/css2?"),
  )!;
  expect(new URL(sheet.href).searchParams.getAll("family")).toEqual(
    ["Playfair+Display:wght@700", "Source+Sans+3:wght@400"].map((v) =>
      v.replace(/\+/g, " "),
    ),
  );
  await act(() => {
    sheet.dispatchEvent(new Event("error"));
  });
  expect(host.textContent).toContain("preview uses fallback fonts");
  const all = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "All",
  )!;
  expect(all.getAttribute("aria-pressed")).toBe("true");
});

it("font requests merge weights for the same family without dropping heavy display weights", () => {
  const url = new URL(
    makeFontUrl([
      { name: "Inter", weight: 900 },
      { name: "Inter", weight: 400 },
      { name: "Inter", weight: 900 },
    ]),
  );
  expect(url.searchParams.getAll("family")).toEqual(["Inter:wght@400;900"]);
});
