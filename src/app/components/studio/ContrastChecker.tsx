import { useStudioDraft } from "./drafts";
import { contrastRatio, hexToRgb } from "../../lib/palette/engine";
import { ArrowDownUp } from "lucide-react";
function hexToRgbCC(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c: string) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
function rgbToHexCC([r, g, b]: [number, number, number]) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function relLum([r, g, b]: [number, number, number]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function cRatio(a: string, b: string) {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}
function isHex(h: string) {
  return /^#[0-9a-fA-F]{6}$/.test(h);
}

function rgbToHsl([r, g, b]: [number, number, number]): [
  number,
  number,
  number,
] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

export function generateSuggestions(
  fgHex: string,
  bgHex: string,
  targetRatio = 4.5,
) {
  if (!isHex(fgHex) || !isHex(bgHex)) return [];
  const [h, s, l] = rgbToHsl(hexToRgbCC(fgHex));
  const options = [
    { offset: 0, label: "Nearest lightness adjustment" },
    { offset: 180, label: "Complementary hue" },
    { offset: 30, label: "Analogous +30°" },
    { offset: -30, label: "Analogous −30°" },
    { offset: 120, label: "Triadic +120°" },
    { offset: 240, label: "Triadic +240°" },
  ];
  return options
    .flatMap(({ offset, label }) => {
      const values = Array.from({ length: 1001 }, (_, i) => i / 10).sort(
        (a, b) => Math.abs(a - l) - Math.abs(b - l),
      );
      for (const lightness of values) {
        const hex = rgbToHexCC(
          hslToRgb((h + offset + 360) % 360, s, lightness),
        );
        if (cRatio(hex, bgHex) >= targetRatio)
          return [
            {
              hex,
              label,
              theory:
                "Adjusted to meet normal-text AA against this background.",
            },
          ];
      }
      return [];
    })
    .filter((v, i, arr) => arr.findIndex((x) => x.hex === v.hex) === i);
}

export function ContrastChecker() {
  const [fg, setFg] = useStudioDraft("contrast.fg", "#ffffff");
  const [bg, setBg] = useStudioDraft("contrast.bg", "#0a0a0b");
  const [fgI, setFgI] = useStudioDraft("contrast.fgI", "#ffffff");
  const [bgI, setBgI] = useStudioDraft("contrast.bgI", "#0a0a0b");

  const ratio = cRatio(isHex(fg) ? fg : "#fff", isHex(bg) ? bg : "#000");
  const rStr = ratio.toFixed(2);
  const tone = ratio >= 4.5 ? "is-pass" : "is-fail";
  const failing = ratio < 4.5;
  const suggestions = failing ? generateSuggestions(fg, bg, 4.5) : [];

  function syncFg(v: string) {
    setFgI(v);
    if (isHex(v)) setFg(v);
  }
  function syncBg(v: string) {
    setBgI(v);
    if (isHex(v)) setBg(v);
  }
  function swap() {
    setFg(isHex(bg) ? bg : fg);
    setBg(isHex(fg) ? fg : bg);
    setFgI(bgI);
    setBgI(fgI);
  }

  const levels = [
    { l: "AA Normal text", p: ratio >= 4.5, r: "4.5:1" },
    { l: "AA Large text", p: ratio >= 3, r: "3.0:1" },
    { l: "AA UI components", p: ratio >= 3, r: "3.0:1" },
    { l: "AAA Normal text", p: ratio >= 7, r: "7.0:1" },
    { l: "AAA Large text", p: ratio >= 4.5, r: "4.5:1" },
  ];

  const field = (
    which: "fg" | "bg",
    label: string,
    value: string,
    draft: string,
    pick: (v: string) => void,
    sync: (v: string) => void,
  ) => (
    <div className="studio-group">
      <label htmlFor={`contrast-${which}`} className="studio-label">
        {label}
      </label>
      <div className="studio-inline">
        <input
          aria-label={which === "fg" ? "Pick foreground" : "Pick background"}
          className="studio-color-input"
          type="color"
          value={isHex(value) ? value : which === "fg" ? "#fff" : "#000"}
          onChange={(e) => pick(e.target.value)}
        />
        <input
          id={`contrast-${which}`}
          className="input-base studio-mono"
          style={{ flex: 1, minWidth: 0 }}
          aria-invalid={!isHex(draft)}
          value={draft}
          onChange={(e) => sync(e.target.value)}
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );

  return (
    <div className="studio-tool">
      {(!isHex(fgI) || !isHex(bgI)) && (
        <p role="alert" className="studio-status is-error">
          Enter complete six-digit hex values. Results below show the last valid
          pair.
        </p>
      )}
      <div
        className="studio-contrast-sample"
        style={{
          background: isHex(bg) ? bg : "var(--color-canvas)",
          color: isHex(fg) ? fg : "var(--color-ink)",
        }}
      >
        <div className="studio-badges">
          <span className={`studio-badge is-strong studio-tone ${tone}`}>
            {rStr}:1
          </span>
          {failing && (
            <span className="studio-badge studio-tone is-fail">
              Fails WCAG AA
            </span>
          )}
        </div>
        <div className="studio-contrast-aa" aria-hidden="true">
          Aa
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.5 }}>
          Contrast ratio: <strong>{rStr}:1</strong>
        </p>
      </div>

      <div className="studio-contrast-pair">
        {field("fg", "Foreground (text)", fg, fgI, (v) => {
          setFg(v);
          setFgI(v);
        }, syncFg)}
        <button
          className="btn-icon"
          aria-label="Swap foreground and background"
          disabled={!isHex(fgI) || !isHex(bgI)}
          onClick={swap}
          style={{ flexShrink: 0, height: 44, width: 44 }}
        >
          <ArrowDownUp size={18} aria-hidden="true" />
        </button>
        {field("bg", "Background", bg, bgI, (v) => {
          setBg(v);
          setBgI(v);
        }, syncBg)}
      </div>

      <div className="studio-card">
        <div className="studio-result-head" style={{ marginBottom: 10 }}>
          <span>Contrast ratio</span>
          <strong className={`studio-tone ${tone}`}>{rStr}:1</strong>
        </div>
        <div className={`studio-meter studio-tone ${tone}`}>
          <span
            style={{ width: `${Math.min(((ratio - 1) / 20) * 100, 100)}%` }}
          />
        </div>
        <div className="studio-scale" aria-hidden="true">
          <span>1:1</span>
          <span>3 · 4.5 · 7 · 21:1</span>
        </div>
      </div>

      <div className="studio-results">
        {levels.map((l) => (
          <div key={l.l} className={`studio-result ${l.p ? "is-pass" : "is-fail"}`}>
            <div className="studio-result-head">
              <span>{l.l}</span>
              <span aria-hidden="true">{l.p ? "✓" : "✗"}</span>
            </div>
            <strong className={`studio-tone ${l.p ? "is-pass" : "is-fail"}`}>
              {l.p ? "Pass" : "Fail"}
            </strong>
            <small>Requires {l.r}</small>
          </div>
        ))}
      </div>

      {failing && (
        <section className="studio-card">
          <h2 className="studio-label">Suggested foreground colors</h2>
          <p className="studio-help" style={{ marginBottom: 16 }}>
            All achieve WCAG AA (4.5:1) against your background, maintaining
            color harmony
          </p>
          <div className="studio-options">
            {suggestions.map((s) => (
              <button
                key={s.hex}
                className="studio-option"
                onClick={() => {
                  setFg(s.hex);
                  setFgI(s.hex);
                }}
              >
                <span className="studio-option-head">
                  <span
                    className="studio-color-chip"
                    style={{ background: s.hex }}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="studio-mono" style={{ display: "block" }}>
                      {s.hex.toUpperCase()}
                    </span>
                    <small>{cRatio(s.hex, bg).toFixed(1)}:1</small>
                  </span>
                </span>
                <strong>{s.label}</strong>
                <small>{s.theory}</small>
                <span
                  aria-hidden="true"
                  style={{
                    padding: "6px 10px",
                    borderRadius: "var(--radius-sm)",
                    background: bg,
                    color: s.hex,
                    fontWeight: 600,
                  }}
                >
                  Aa — preview
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
