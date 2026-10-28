import { useStudioDraft } from "./drafts";
import { contrastRatio, hexToRgb } from "../../lib/palette/engine";
import { useState } from "react";
import { T, ss } from "./style";
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
  const rc = ratio >= 4.5 ? "var(--color-success)" : "var(--color-error)";
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

  return (
    <div className="studio-tool">
      {(!isHex(fgI) || !isHex(bgI)) && (
        <p role="alert">
          Enter complete six-digit hex values. Results below show the last valid
          pair.
        </p>
      )}
      <div
        style={{
          borderRadius: "var(--radius-xl)",
          padding: 40,
          background: isHex(bg) ? bg : T.canvas,
          border: `1px solid ${T.hairlineSoft}`,
          minHeight: 160,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-body)",
            letterSpacing: "-3px",
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1,
            color: isHex(fg) ? fg : T.ink,
          }}
        >
          Aa
        </div>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 15,
            lineHeight: 1.5,
            letterSpacing: "-0.15px",
            margin: "12px 0 0",
            color: isHex(fg) ? fg : T.ink,
          }}
        >
          Contrast ratio: <strong>{rStr}:1</strong>
        </p>
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            padding: "8px 16px",
            borderRadius: 100,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            fontFamily: "var(--font-body)",
            fontSize: 20,
            fontWeight: 700,
            color: rc,
            letterSpacing: "-0.5px",
          }}
        >
          {rStr}:1
        </div>
        {failing && (
          <div
            style={{
              position: "absolute",
              bottom: 16,
              right: 16,
              padding: "5px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.18)",
              border: "1px solid rgba(239,68,68,0.35)",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              color: "#f87171",
            }}
          >
            Fails WCAG AA
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="contrast-fg" style={ss.label}>
            Foreground (text)
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              aria-label="Pick foreground"
              type="color"
              value={isHex(fg) ? fg : "#fff"}
              onChange={(e: any) => {
                setFg(e.target.value);
                setFgI(e.target.value);
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                border: `1px solid ${T.hairline}`,
                background: "none",
                cursor: "pointer",
                padding: 2,
              }}
            />
            <input
              id="contrast-fg"
              aria-invalid={!isHex(fgI)}
              value={fgI}
              onChange={(e: any) => syncFg(e.target.value)}
              style={{
                ...ss.input,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.05em",
              }}
              maxLength={7}
            />
          </div>
        </div>
        <button
          aria-label="Swap foreground and background"
          disabled={!isHex(fgI) || !isHex(bgI)}
          onClick={swap}
          style={{
            background: "var(--color-surface-1)",
            color: "var(--color-ink)",
            borderRadius: "var(--radius-pill)",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            width: 44,
            height: 44,
            fontSize: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ⇅
        </button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="contrast-bg" style={ss.label}>
            Background
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              aria-label="Pick background"
              type="color"
              value={isHex(bg) ? bg : "#000"}
              onChange={(e: any) => {
                setBg(e.target.value);
                setBgI(e.target.value);
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                border: `1px solid ${T.hairline}`,
                background: "none",
                cursor: "pointer",
                padding: 2,
              }}
            />
            <input
              id="contrast-bg"
              aria-invalid={!isHex(bgI)}
              value={bgI}
              onChange={(e: any) => syncBg(e.target.value)}
              style={{
                ...ss.input,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.05em",
              }}
              maxLength={7}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--color-surface-1)",
          borderRadius: "var(--radius-xl)",
          padding: 24,
          border: `1px solid ${T.hairlineSoft}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              color: T.inkMuted,
            }}
          >
            Contrast ratio
          </span>
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 600,
              color: rc,
            }}
          >
            {rStr}:1
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: T.surface2,
            borderRadius: 100,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${Math.min(((ratio - 1) / 20) * 100, 100)}%`,
              height: "100%",
              background: rc,
              borderRadius: 100,
              transition: "width .3s",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11,
              color: T.inkMuted,
            }}
          >
            1:1
          </span>
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11,
              color: T.inkMuted,
            }}
          >
            3 · 4.5 · 7 · 21:1
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
          gap: 10,
        }}
      >
        {levels.map((l: any) => (
          <div
            key={l.l}
            style={{
              background: "var(--color-surface-1)",
              borderRadius: "var(--radius-lg)",
              padding: 14,
              border: `1px solid ${l.p ? "#166534" : "#7f1d1d"}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  color: T.inkMuted,
                  lineHeight: 1.3,
                }}
              >
                {l.l}
              </span>
              <span style={{ fontSize: 16 }}>{l.p ? "✓" : "✗"}</span>
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 13,
                fontWeight: 600,
                color: l.p ? "var(--color-success)" : "var(--color-error)",
              }}
            >
              {l.p ? "Pass" : "Fail"}
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 11,
                color: T.inkMuted,
              }}
            >
              Requires {l.r}
            </div>
          </div>
        ))}
      </div>

      {failing && (
        <div
          style={{
            background: "var(--color-surface-1)",
            borderRadius: "var(--radius-xl)",
            border: "1px solid rgba(239,68,68,0.3)",
            padding: 24,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 13,
                fontWeight: 600,
                color: T.ink,
                marginBottom: 2,
              }}
            >
              Suggested foreground colors
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 11,
                color: T.inkMuted,
              }}
            >
              All achieve WCAG AA (4.5:1) against your background, maintaining
              color harmony
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
              gap: 10,
            }}
          >
            {suggestions.map((s: any, i: number) => (
              <button
                key={i}
                onClick={() => {
                  setFg(s.hex);
                  setFgI(s.hex);
                }}
                style={{
                  background: "var(--color-surface-2)",
                  borderRadius: "var(--radius-lg)",
                  padding: 14,
                  border: `1px solid ${T.hairline}`,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color .15s",
                }}
                onMouseEnter={(e: any) =>
                  (e.currentTarget.style.borderColor = s.hex)
                }
                onMouseLeave={(e: any) =>
                  (e.currentTarget.style.borderColor = T.hairline)
                }
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: s.hex,
                      border: `1px solid ${T.hairline}`,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: T.ink,
                      }}
                    >
                      {s.hex.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: 10,
                        color: T.inkMuted,
                      }}
                    >
                      {cRatio(s.hex, bg).toFixed(1)}:1
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: T.ink,
                    marginBottom: 2,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 10,
                    color: T.inkMuted,
                    lineHeight: 1.4,
                  }}
                >
                  {s.theory}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    background: bg,
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    color: s.hex,
                    fontWeight: 600,
                  }}
                >
                  Aa — preview
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
