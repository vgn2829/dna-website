import { describe, expect, it } from "vitest";
import { contrastGrade, nonTextChecks, okDistance, semanticCollisions, suggestContrastColours, COLLISION_DISTANCE } from "./contrast";
import { contrastRatio, hexToRgb, rgbToOKLCH } from "./color";
import { derivePalette } from "./engine";

const ratio = (a: string, b: string) => contrastRatio(hexToRgb(a), hexToRgb(b));
const hueDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

describe("contrast grading and suggestions", () => {
  it("grades follow WCAG 2.x thresholds and separate AA from AAA", () => {
    expect(contrastGrade(7).level).toBe("AAA");
    expect(contrastGrade(6.99).level).toBe("AA");
    expect(contrastGrade(4.5)).toMatchObject({ level: "AA", normalAA: true, normalAAA: false, largeAAA: true });
    expect(contrastGrade(4.49)).toMatchObject({ level: "AA Large", normalAA: false, largeAA: true, nonText: true });
    expect(contrastGrade(2.99)).toMatchObject({ level: "Fail", largeAA: false, nonText: false });
  });
  it("every suggestion passes the target; empty only when nothing can", () => {
    for (const [fg, bg] of [["#777777", "#FFFFFF"], ["#6366F1", "#1E1B4B"], ["#FF006E", "#FF4D94"], ["#00C853", "#FFFFFF"]])
      for (const target of [4.5, 7]) {
        const list = suggestContrastColours(fg, bg, target);
        if (!list.length) { expect(Math.max(ratio("#000000", bg), ratio("#FFFFFF", bg))).toBeLessThan(target); continue; }
        expect(new Set(list.map((s) => s.hex)).size).toBe(list.length);
        for (const s of list) { expect(ratio(s.hex, bg)).toBeGreaterThanOrEqual(target); expect(s.ratio).toBeCloseTo(ratio(s.hex, bg), 10); }
      }
    const same = suggestContrastColours("#6366F1", "#1E1B4B").find((s) => s.label.startsWith("Same hue"))!;
    expect(hueDiff(rgbToOKLCH(hexToRgb(same.hex)).H, rgbToOKLCH(hexToRgb("#6366F1")).H)).toBeLessThan(2.5);
    expect(suggestContrastColours("#12zz34", "#FFFFFF")).toEqual([]);
  });
});

describe("palette role checks", () => {
  it("non-text checks measure border against bg and surface at 3:1", () => {
    const p = derivePalette("#6366F1", false, "triadic");
    const checks = nonTextChecks(p);
    expect(checks.map((c) => c.name)).toEqual(["Border / BG", "Border / Surface"]);
    for (const c of checks) { expect(c.ratio).toBeCloseTo(ratio(p.border, p[c.bg as "bg"]), 10); expect(c.pass).toBe(c.ratio >= 3); }
    // Regression: the generated border is a subtle separator (≈2:1), which this check must surface, not hide.
    expect(checks[0].pass).toBe(false);
  });
  it("flags a brand colour that duplicates a status colour, and status colours merged under CVD", () => {
    const p = { ...derivePalette("#6366F1", false, "triadic") };
    expect(semanticCollisions(p).some((c) => c.condition === "typical vision")).toBe(false);
    const clash = { ...p, primary: p.success };
    const found = semanticCollisions(clash);
    expect(found[0]).toMatchObject({ a: "primary", b: "success", condition: "typical vision" });
    expect(found[0].distance).toBeLessThan(1e-9);
    // Red/green status pairs are a known deuteranopia confusion.
    const redGreen = { ...p, success: "#2E8B57", error: "#C0392B" };
    expect(semanticCollisions(redGreen).some((c) => c.condition === "deuteranopia" && [c.a, c.b].sort().join() === "error,success")).toBe(true);
    expect(semanticCollisions(p).every((c) => c.distance < COLLISION_DISTANCE)).toBe(true);
  });
  it("okDistance is Euclidean OKLab in native units", () => {
    expect(okDistance("#000000", "#FFFFFF")).toBeCloseTo(1, 3);
    expect(okDistance("#123456", "#123456")).toBe(0);
  });
});
