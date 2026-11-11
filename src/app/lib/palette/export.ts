import { colourName } from "./naming";
import { tonalScale } from "./scales";
import { hexToRgb, normalizeHex } from "./color";

// Palette Studio exports beyond the existing CSS (`paletteCSS` in ./editor,
// unchanged). Pure functions over the committed palette, so every format is
// generated from the values the UI shows.

export type ExportSwatch = { role: string; hex: string };
export type ExportInput = {
  /** Mood/creative swatches (optional). */
  swatches?: ExportSwatch[];
  /** UI-system roles for both themes (optional). */
  themes?: { light: Record<string, string>; dark: Record<string, string> };
  includeScales?: boolean;
  /** Human-readable context, e.g. "Seed #6366F1 · Triadic · Visual". */
  title?: string;
};
export type ExportFormat = "tailwind" | "tokens" | "svg";
export const EXPORT_FORMATS: { id: ExportFormat; label: string; filename: string; mime: string }[] = [
  { id: "tailwind", label: "Tailwind", filename: "tailwind.palette.js", mime: "text/javascript" },
  { id: "tokens", label: "Design tokens", filename: "dna-palette.tokens.json", mime: "application/json" },
  { id: "svg", label: "SVG card", filename: "dna-palette.svg", mime: "image/svg+xml" },
];

/** `Surface Elevated` / `surfaceElevated` → `surface-elevated`; ASCII, never empty. */
export function tokenName(value: string) {
  const name = value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return name || "colour";
}
function prepared(input: ExportInput) {
  const seen = new Map<string, number>();
  const swatches = (input.swatches || []).map((s) => {
    const base = tokenName(s.role), n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...s, hex: normalizeHex(s.hex), name: n === 1 ? base : `${base}-${n}` };
  });
  const themes = input.themes && {
    light: Object.fromEntries(Object.entries(input.themes.light).map(([k, v]) => [tokenName(k), normalizeHex(v)])),
    dark: Object.fromEntries(Object.entries(input.themes.dark).map(([k, v]) => [tokenName(k), normalizeHex(v)])),
  };
  return { swatches, themes, includeScales: !!input.includeScales, title: input.title || "" };
}

/** Extra CSS block for the mood palette, appended to the existing role CSS on request. */
export function moodCss(input: ExportInput) {
  const { swatches, includeScales } = prepared(input);
  if (!swatches.length) return "";
  const lines = [":root {"];
  for (const s of swatches) {
    lines.push(`  --palette-${s.name}: ${s.hex}; /* ${colourName(s.hex).replace(/\*\//g, "")} */`);
    if (includeScales) for (const step of tonalScale(s.hex)) lines.push(`  --palette-${s.name}-${step.step}: ${step.hex};`);
  }
  return lines.concat("}", "").join("\n");
}

export function exportTailwind(input: ExportInput) {
  const { swatches, themes, includeScales, title } = prepared(input);
  const out: string[] = [];
  for (const s of swatches) {
    if (!includeScales) { out.push(`        '${s.name}': '${s.hex}',`); continue; }
    out.push(`        '${s.name}': {`, `          DEFAULT: '${s.hex}',`);
    for (const step of tonalScale(s.hex)) out.push(`          ${step.step}: '${step.hex}',`);
    out.push("        },");
  }
  if (themes) for (const theme of ["light", "dark"] as const) {
    out.push(`        '${theme}': {`);
    for (const [k, v] of Object.entries(themes[theme])) out.push(`          '${k}': '${v}',`);
    out.push("        },");
  }
  return [
    `// DNA Palette Studio${title ? ` — ${title.replace(/[\r\n]/g, " ")}` : ""}`,
    "/** @type {import('tailwindcss').Config} */",
    "export default {",
    "  theme: {",
    "    extend: {",
    "      colors: {",
    ...out,
    "      },",
    "    },",
    "  },",
    "};",
    "",
  ].join("\n");
}

/** W3C Design Tokens (DTCG 2025.10) colour value: sRGB components with a hex fallback. */
export function dtcgColour(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return { colorSpace: "srgb", components: [r, g, b].map((v) => Number(v.toFixed(6))), hex: normalizeHex(hex).toLowerCase() };
}
export function exportDesignTokens(input: ExportInput) {
  const { swatches, themes, includeScales, title } = prepared(input);
  const doc: Record<string, unknown> = { $type: "color", $description: `DNA Palette Studio${title ? ` — ${title}` : ""}` };
  if (swatches.length) {
    doc.palette = Object.fromEntries(swatches.map((s) => [s.name, { $value: dtcgColour(s.hex), $description: `${s.role} — ${colourName(s.hex)}` }]));
    if (includeScales) doc.scale = Object.fromEntries(swatches.map((s) => [s.name, Object.fromEntries(tonalScale(s.hex).map((t) => [String(t.step), { $value: dtcgColour(t.hex) }]))]));
  }
  if (themes) doc.ui = Object.fromEntries((["light", "dark"] as const).map((theme) => [theme, Object.fromEntries(Object.entries(themes[theme]).map(([k, v]) => [k, { $value: dtcgColour(v) }]))]));
  return JSON.stringify(doc, null, 2) + "\n";
}

export function escapeXml(text: string) {
  return text
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!)
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
/** Self-contained swatch card (no external fonts, images or links) for Figma and Illustrator. */
export function exportSvg(input: ExportInput) {
  const { swatches, title } = prepared(input);
  if (!swatches.length) throw new Error("No palette swatches to export.");
  const w = 168, gap = 12, pad = 24, h = 220, top = title ? 64 : pad;
  const width = pad * 2 + swatches.length * w + (swatches.length - 1) * gap, height = top + h + 92;
  const font = `font-family="Inter, 'Helvetica Neue', Arial, sans-serif"`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(title ? `DNA palette — ${title}` : "DNA palette")}</title>`,
    `<rect width="${width}" height="${height}" rx="20" fill="#FFFFFF"/>`,
  ];
  if (title) parts.push(`<text x="${pad}" y="${pad + 18}" ${font} font-size="16" font-weight="600" fill="#111110">${escapeXml(title)}</text>`);
  swatches.forEach((s, i) => {
    const x = pad + i * (w + gap);
    parts.push(
      `<g id="${s.name}">`,
      `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="12" fill="${s.hex}" stroke="#000000" stroke-opacity="0.08"/>`,
      `<text x="${x}" y="${top + h + 24}" ${font} font-size="12" fill="#555550">${escapeXml(s.role)}</text>`,
      `<text x="${x}" y="${top + h + 46}" ${font} font-size="15" font-weight="600" fill="#111110">${escapeXml(colourName(s.hex))}</text>`,
      `<text x="${x}" y="${top + h + 68}" font-family="'JetBrains Mono', Menlo, monospace" font-size="13" fill="#111110">${s.hex}</text>`,
      "</g>",
    );
  });
  return parts.concat("</svg>", "").join("\n");
}

export function exportPalette(format: ExportFormat, input: ExportInput) {
  return format === "tailwind" ? exportTailwind(input) : format === "tokens" ? exportDesignTokens(input) : exportSvg(input);
}
