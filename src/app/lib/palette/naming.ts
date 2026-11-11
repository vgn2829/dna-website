import { hexToRgb, rgbToOKLCH } from "./color";

// Deterministic, dependency-free descriptive colour names from OKLCH: a hue
// family plus lightness/intensity modifiers ("Deep Indigo", "Dusty Teal").
// Independent of semantic role labels (Anchor, Primary…).
const ACHROMATIC = 0.02;
const HUE_FAMILIES: [number, string][] = [
  [0, "Rose"], [18, "Red"], [38, "Vermilion"], [52, "Orange"], [68, "Amber"], [84, "Gold"], [100, "Yellow"],
  [118, "Chartreuse"], [134, "Green"], [152, "Emerald"], [172, "Teal"], [192, "Cyan"], [215, "Azure"], [245, "Blue"],
  [268, "Indigo"], [288, "Violet"], [308, "Purple"], [326, "Magenta"], [342, "Pink"], [356, "Rose"],
];

export function colourName(hex: string): string {
  const { L, C, H } = rgbToOKLCH(hexToRgb(hex));
  if (C < ACHROMATIC) {
    const base = L > 0.97 ? "White" : L > 0.86 ? "Silver" : L > 0.5 ? "Grey" : L > 0.35 ? "Slate" : L > 0.22 ? "Charcoal" : "Black";
    const tint = C < 0.006 || base === "White" || base === "Black" ? "" : H >= 30 && H < 120 ? "Warm " : H >= 180 && H < 300 ? "Cool " : "";
    return tint + base;
  }
  let family = HUE_FAMILIES[0][1];
  for (const [start, label] of HUE_FAMILIES) if (H >= start) family = label;
  // Low-chroma warm hues read as browns/sands rather than desaturated oranges.
  if (H >= 30 && H < 100 && C < 0.13 && L < 0.62) family = "Brown";
  else if (H >= 40 && H < 110 && C < 0.08 && L >= 0.78) family = "Sand";
  // Bright, saturated hues (pure yellow, lime) are vivid rather than pale.
  const tone = L > 0.9 ? (C < 0.12 ? "Pale" : "") : L > 0.76 ? (C < 0.15 ? "Light" : "") : L < 0.3 ? "Dark" : L < 0.46 ? "Deep" : "";
  const intensity = C < 0.06 ? "Dusty" : C > 0.2 && L > 0.5 ? "Vivid" : "";
  return [tone, intensity, family].filter(Boolean).join(" ");
}
