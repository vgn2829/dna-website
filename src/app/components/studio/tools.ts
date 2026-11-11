import { lazy } from "react";
// All tool implementations are lazy: this registry is also used by the homepage.
export const TOOLS = [
  {
    id: "palette",
    label: "Palette Studio",
    description:
      "From one seed colour to a harmonious palette, tonal scales, WCAG checks and exportable design tokens.",
    comp: lazy(() => import("../PaletteStudio")),
  },
  {
    id: "font",
    label: "Font Pairing",
    description:
      "Preview six licensed, self-hosted pairings in Latin and Devanagari; export typography CSS.",
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
      "Create calibrated line, dot and square patterns with independent source-resolution PNG/SVG exports.",
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
      "Remove backgrounds in your browser, refine the mask and export PNG.",
    comp: lazy(() => import("../background-removal/BackgroundRemover")),
  },
];
