import { describe, expect, it } from "vitest";
import { createEditor } from "./editor";
import { deriveVisualPalette } from "./engine";
import { tonalScale } from "./scales";
import { dtcgColour, escapeXml, EXPORT_FORMATS, exportDesignTokens, exportPalette, exportSvg, exportTailwind, moodCss, tokenName } from "./export";

const editor = createEditor("#6366F1", "triadic");
const swatches = deriveVisualPalette("#6366F1", "triadic", "visual", "export").map((s) => ({ role: s.name, hex: s.hex }));
const input = { swatches, themes: editor.variants, includeScales: true, title: "Seed #6366F1 · Triadic · Visual" };
const importModule = (js: string) => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

describe("palette exports", () => {
  it("token names are kebab-case ASCII and unique", () => {
    expect(tokenName("surfaceElevated")).toBe("surface-elevated");
    expect(tokenName("Crème brûlée!")).toBe("creme-brulee");
    expect(tokenName("***")).toBe("colour");
    expect(moodCss({ swatches: [{ role: "Ink", hex: "#000000" }, { role: "ink", hex: "#111111" }] })).toContain("--palette-ink-2: #111111;");
  });
  it("mood CSS lists every swatch and scale step", () => {
    const css = moodCss(input);
    for (const s of swatches) { expect(css).toContain(`--palette-${tokenName(s.role)}: ${s.hex};`); for (const t of tonalScale(s.hex)) expect(css).toContain(`--palette-${tokenName(s.role)}-${t.step}: ${t.hex};`); }
    expect(moodCss({ swatches: [] })).toBe("");
  });
  it("Tailwind config is a valid ES module with DEFAULT, scale and both themes", async () => {
    const colours = (await importModule(exportTailwind(input))).default.theme.extend.colors;
    expect(colours.anchor.DEFAULT).toBe(swatches[0].hex);
    expect(colours.anchor[500]).toBe(tonalScale(swatches[0].hex)[4].hex);
    expect(colours.light["text-muted"]).toBe(editor.variants.light.textMuted);
    expect(colours.dark.bg).toBe(editor.variants.dark.bg);
    expect((await importModule(exportTailwind({ swatches }))).default.theme.extend.colors.paper).toBe(swatches[4].hex);
  });
  it("design tokens follow the DTCG colour format and round-trip to the same hex", () => {
    const doc = JSON.parse(exportDesignTokens(input));
    expect(doc.$type).toBe("color");
    const anchor = doc.palette.anchor.$value;
    expect(anchor).toMatchObject({ colorSpace: "srgb", hex: swatches[0].hex.toLowerCase() });
    expect("#" + anchor.components.map((c: number) => Math.round(c * 255).toString(16).padStart(2, "0")).join("").toUpperCase()).toBe(swatches[0].hex);
    expect(Object.keys(doc.scale.anchor)).toEqual(["100", "200", "300", "400", "500", "600", "700", "800", "900"]);
    expect(doc.ui.light.bg.$value.hex).toBe(editor.variants.light.bg.toLowerCase());
    expect(doc.ui.dark["surface-elevated"].$value.hex).toBe(editor.variants.dark.surfaceElevated.toLowerCase());
    const walk = (node: Record<string, unknown>) => { if ("$value" in node) expect(Object.keys(node).every((k) => k.startsWith("$"))).toBe(true); for (const [k, v] of Object.entries(node)) if (!k.startsWith("$") && v && typeof v === "object") walk(v as Record<string, unknown>); };
    walk(doc);
    expect(dtcgColour("#FFFFFF").components).toEqual([1, 1, 1]);
  });
  it("SVG card is self-contained, escapes text and uses the exact colours", () => {
    expect(escapeXml(`<a & "b" 'c'>\u0001`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
    const svg = exportSvg({ swatches: [{ role: "<script>alert(1)</script>", hex: "#6366F1" }, ...swatches.slice(1)], title: 'Tom & Jerry "pals"' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("Tom &amp; Jerry &quot;pals&quot;");
    expect(svg).not.toMatch(/<image|href=|url\(|@import/);
    for (const s of swatches.slice(1)) expect(svg).toContain(`fill="${s.hex}"`);
    expect((svg.match(/<(g|svg|title|text)\b/g) || []).length).toBe((svg.match(/<\/(g|svg|title|text)>/g) || []).length);
    expect(() => exportSvg({ swatches: [] })).toThrow();
  });
  it("every format is reachable and invalid colours are rejected", () => {
    for (const f of EXPORT_FORMATS) expect(exportPalette(f.id, input).length).toBeGreaterThan(50);
    expect(() => exportTailwind({ swatches: [{ role: "x", hex: "red" }] })).toThrow();
  });
});
