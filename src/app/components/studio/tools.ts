import { lazy } from "react";
// All tool implementations are lazy: this registry is also used by the homepage.
export const TOOLS = [
  {
    id: "palette",
    label: "Palette Studio",
    description:
      "Build and refine semantic colour palettes. Inspect contrast for each foreground/background pair.",
    comp: lazy(() => import("../PaletteStudio")),
  },
  {
    id: "font",
    label: "Font Pairing",
    description:
      "Explore curated font pairings, preview text, and revisit recent choices.",
    comp: lazy(() =>
      import("./FontPairing").then((m) => ({ default: m.FontPairing })),
    ),
  },
  {
    id: "contrast",
    label: "Contrast Checker",
    description:
      "Check WCAG AA/AAA requirements for a foreground/background pair and explore alternatives.",
    comp: lazy(() =>
      import("./ContrastChecker").then((m) => ({ default: m.ContrastChecker })),
    ),
  },
  {
    id: "image",
    label: "Image Converter",
    description:
      "Convert images and PDF pages locally. Resize, choose a format, and download the result.",
    comp: lazy(() =>
      import("./ImageConverter").then((m) => ({ default: m.ImageConverter })),
    ),
  },
  {
    id: "grid",
    label: "Grid Calculator",
    description:
      "Explore nine grid systems with validated dimensions, margins, and gutters.",
    comp: lazy(() =>
      import("./GridCalculator").then((m) => ({ default: m.GridCalculator })),
    ),
  },
  {
    id: "halftone",
    label: "Halftone",
    description:
      "Create line, dot, and square patterns. Working output is capped at a 700px long edge.",
    comp: lazy(() =>
      import("../HalftoneStudio").then((m) => ({ default: m.HalftoneStudio })),
    ),
  },
  {
    id: "svg",
    label: "SVG Tools",
    description:
      "Trace images into SVG or rasterize self-contained SVG files. All image processing stays on your device.",
    comp: lazy(() =>
      import("../SvgConverter").then((m) => ({ default: m.SvgConverter })),
    ),
  },
  {
    id: "bg",
    label: "Background Remover",
    description:
      "Remove backgrounds with on-device models, refine the mask, and export PNG.",
    comp: lazy(() => import("../background-removal/BackgroundRemover")),
  },
];
