import { contrastRatio, hexToRgb, oklchToHex, rgbToHex, rgbToOKLCH } from "./color";
import { simulateCB, type Deficiency } from "./simulation";

// Contrast grading, accessible-colour suggestions and palette-level checks that
// harmony alone does not guarantee. All built on the shared ./color maths.

const ratio = (a: string, b: string) => contrastRatio(hexToRgb(a), hexToRgb(b));
const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export type ContrastGrade = { ratio: number; level: "AAA" | "AA" | "AA Large" | "Fail"; normalAA: boolean; normalAAA: boolean; largeAA: boolean; largeAAA: boolean; nonText: boolean };
/** WCAG 2.x: normal text 4.5 (AA) / 7 (AAA); large text 3 / 4.5; non-text UI 3. Unrounded ratios. */
export function contrastGrade(value: number): ContrastGrade {
  return {
    ratio: value,
    level: value >= 7 ? "AAA" : value >= 4.5 ? "AA" : value >= 3 ? "AA Large" : "Fail",
    normalAA: value >= 4.5, normalAAA: value >= 7, largeAA: value >= 3, largeAAA: value >= 4.5, nonText: value >= 3,
  };
}

export type ContrastSuggestion = { hex: string; label: string; theory: string; ratio: number };
/** Passing lightness closest to `startL` toward white and toward black, at constant hue and chroma. */
function lightnessSolutions(H: number, C: number, bg: string, startL: number, target: number) {
  const at = (L: number) => oklchToHex({ L, C, H });
  const out: { hex: string; direction: "lighter" | "darker" }[] = [];
  for (const edge of [1, 0]) {
    if (ratio(at(edge), bg) < target) continue;
    let fail = startL, pass = edge;
    if (ratio(at(startL), bg) >= target) pass = startL;
    else for (let i = 0; i < 28; i++) { const mid = (fail + pass) / 2; if (ratio(at(mid), bg) >= target) pass = mid; else fail = mid; }
    out.push({ hex: at(pass), direction: edge ? "lighter" : "darker" });
  }
  return out;
}
/**
 * Accessible foreground alternatives in OKLCH, using Palette Studio's harmony
 * angles. Every result meets `target` against `bg`; empty only when nothing
 * (not even black or white) can reach it.
 */
export function suggestContrastColours(fg: string, bg: string, target = 4.5): ContrastSuggestion[] {
  if (!isHex(fg) || !isHex(bg)) return [];
  const f = rgbToOKLCH(hexToRgb(fg)), C = f.C < 0.02 ? 0 : f.C, out: ContrastSuggestion[] = [];
  const add = (hex: string, label: string, theory: string) => {
    const r = ratio(hex, bg);
    if (r >= target && !out.some((s) => s.hex === hex)) out.push({ hex, label, theory, ratio: r });
  };
  for (const s of lightnessSolutions(f.H, C, bg, f.L, target)) add(s.hex, `Same hue, ${s.direction}`, "Constant OKLCH hue and chroma; only lightness changes.");
  if (C > 0) {
    const [softer] = lightnessSolutions(f.H, C * 0.5, bg, f.L, target);
    if (softer) add(softer.hex, "Same hue, softer", "Half the chroma at the nearest passing lightness.");
    for (const [offset, label, theory] of [[180, "Complementary hue", "Opposite OKLCH hue"], [30, "Analogous +30°", "Adjacent hue"], [-30, "Analogous −30°", "Adjacent hue"], [120, "Triadic +120°", "Triadic harmony angle"]] as const) {
      const options = lightnessSolutions((f.H + offset + 360) % 360, C, bg, f.L, target);
      options.sort((a, b) => Math.abs(rgbToOKLCH(hexToRgb(a.hex)).L - f.L) - Math.abs(rgbToOKLCH(hexToRgb(b.hex)).L - f.L));
      if (options[0]) add(options[0].hex, label, `${theory}, nearest passing lightness.`);
    }
  }
  add("#FFFFFF", "White", "Maximum lightness.");
  add("#000000", "Black", "Minimum lightness.");
  return out.slice(0, 6);
}

/** Euclidean OKLab distance (native units), the studio's documented difference metric. */
export function okDistance(a: string, b: string) {
  const lab = (hex: string) => { const { L, C, H } = rgbToOKLCH(hexToRgb(hex)), h = (H * Math.PI) / 180; return [L, C * Math.cos(h), C * Math.sin(h)]; };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

type RoleMap = Record<string, string>;
export type NonTextCheck = { name: string; fg: string; bg: string; ratio: number; pass: boolean };
/** WCAG 1.4.11: a border that identifies a control (e.g. an input outline) needs 3:1 against adjacent colours. Decorative separators are exempt. */
export function nonTextChecks(p: RoleMap): NonTextCheck[] {
  return ([["Border / BG", "border", "bg"], ["Border / Surface", "border", "surface"]] as const).map(([name, fg, bg]) => {
    const r = ratio(p[fg], p[bg]);
    return { name, fg, bg, ratio: r, pass: r >= 3 };
  });
}

/** Below this OKLab distance two colours are easy to confuse at a glance (heuristic, not a standard). */
export const COLLISION_DISTANCE = 0.08;
export type Collision = { a: string; b: string; distance: number; condition: "typical vision" | Deficiency };
const BRAND = ["primary", "secondary", "accent"], SEMANTIC = ["success", "warning", "error", "info"];
/**
 * Semantic-role collisions: a brand colour that looks like a status colour,
 * and status colours that become hard to tell apart under simulated
 * colour-vision deficiency (Brettel 1997). Sorted closest first.
 */
export function semanticCollisions(p: RoleMap, threshold = COLLISION_DISTANCE): Collision[] {
  const out: Collision[] = [];
  for (const a of BRAND) for (const b of SEMANTIC) {
    const d = okDistance(p[a], p[b]);
    if (d < threshold) out.push({ a, b, distance: d, condition: "typical vision" });
  }
  for (const type of ["protanopia", "deuteranopia", "tritanopia"] as const) {
    const sim = (hex: string) => rgbToHex(simulateCB(hexToRgb(hex), type));
    for (let i = 0; i < SEMANTIC.length; i++) for (let j = i + 1; j < SEMANTIC.length; j++) {
      const d = okDistance(sim(p[SEMANTIC[i]]), sim(p[SEMANTIC[j]]));
      if (d < threshold) out.push({ a: SEMANTIC[i], b: SEMANTIC[j], distance: d, condition: type });
    }
  }
  return out.sort((x, y) => x.distance - y.distance);
}
