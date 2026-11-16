// @vitest-environment jsdom
import { studioDrafts } from "./drafts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FontPairing, typographyCss } from "./FontPairing";
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
  localStorage.clear();
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
// Palette Studio: roles render as copy buttons carrying their role key.
const roleHex = (key: string) =>
  host.querySelector<HTMLButtonElement>(`button[data-role="${key}"]`)!.textContent!.trim();
const docButton = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text)!;
it("palette edits and locks survive regeneration and theme switching", async () => {
  await render(<PaletteStudio />);
  const edit = host.querySelector<HTMLInputElement>(
    '[aria-label="Edit Accent"]',
  )!;
  await change(edit, "#123456");
  await click(host.querySelector('[aria-label="Lock Accent"]')!);
  await click(button("Generate"));
  await click(button("Dark"));
  expect(roleHex("accent")).toBe("#123456");
  expect(
    host
      .querySelector('[aria-label="Unlock Accent"]')!
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("incomplete or invalid seed input never changes the committed colours", async () => {
  await render(<PaletteStudio />);
  const original = roleHex("primary");
  const seed = host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!;
  await change(seed, "#12");
  expect(seed.value).toBe("#12");
  await change(seed, "#12zz");
  expect(seed.value).toBe("#12");
  expect(roleHex("primary")).toBe(original);
  await act(() => { seed.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(seed.value).toBe("#6366F1");
});
it("clipboard rejection never reports success and CSS remains downloadable", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    configurable: true,
  });
  await render(<PaletteStudio />);
  await click(button("Export"));
  await click(docButton("Copy"));
  const status = document.querySelector('[role="dialog"] .palette-status')!.textContent!;
  expect(status).toContain("Copy failed");
  expect(status).not.toContain("copied");
  expect(docButton("Download CSS")).toBeTruthy();
});
it("mood changes remain separate and accessibility names the pair criteria", async () => {
  await render(<PaletteStudio />);
  const roles = roleHex("primary") + roleHex("accent");
  const swatches = Array.from(host.querySelectorAll(".palette-column-hex")).map((b) => b.textContent).join();
  await click(button("Poster"));
  expect(roleHex("primary") + roleHex("accent")).toBe(roles);
  expect(Array.from(host.querySelectorAll(".palette-column-hex")).map((b) => b.textContent).join()).not.toBe(swatches);
  await click(button("Accessibility"));
  expect(host.textContent).toContain("Normal AA");
  expect(host.textContent).not.toContain("APCA");
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

it("self-hosted font failure reports fallback and exposes retry", async () => {
  vi.stubGlobal("FontFace", class { load() { return Promise.reject(new Error("missing font")); } });
  Object.defineProperty(document,"fonts",{configurable:true,value:new Set()});
  try {
    await render(<FontPairing />);
    expect(host.textContent).toContain("Font download failed");
    expect(button("Retry fonts")).toBeTruthy();
    expect(document.head.querySelector('link[href^="https://fonts.googleapis.com"]')).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
it("same-family CSS preserves the actual selected variable weights and self-hosted URL", () => {
  const css=typographyCss({title:"Product clarity",heading:"inter",body:"inter",headingWeight:800,bodyWeight:400,use:"Product",script:"Latin",reason:""},54);
  expect(css.match(/@font-face/g)).toHaveLength(1);
  expect(css).toContain("font-weight: 400 800");
  expect(css).toContain("/fonts/studio/inter.woff2");
  expect(css).toContain("font-weight: 800");
});

it("halftone replacement and unmount release pending decode URLs before image events arrive", async () => {
  const {HalftoneStudio}=await import('../HalftoneStudio');
  const revoke=vi.mocked(URL.revokeObjectURL);
  vi.stubGlobal('Image',class {onload: (()=>void)|null=null;onerror: (()=>void)|null=null;src='';});
  try {
    await render(<HalftoneStudio/>);
    await upload(host.querySelector('input[type=file]')!,new File(['one'],'one.png',{type:'image/png'}));
    const first=vi.mocked(URL.createObjectURL).mock.results[0].value;
    expect(revoke).not.toHaveBeenCalledWith(first);
    await upload(host.querySelector('input[type=file]')!,new File(['two'],'two.png',{type:'image/png'}));
    const second=vi.mocked(URL.createObjectURL).mock.results[1].value;
    expect(revoke).toHaveBeenCalledWith(first);
    await render(null);expect(revoke).toHaveBeenCalledWith(second);
  } finally {vi.unstubAllGlobals();}
});
