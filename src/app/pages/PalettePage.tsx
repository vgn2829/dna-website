import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Copy, Upload, ImageIcon, CheckCircle } from 'lucide-react';
import {
  type Color, type Swatch, type Palette, type Report,
  hexToHsl, hslToHex, colorName,
  generatePalette, HARMONY_TYPES, HARMONY_LABELS,
  analyze, extractColours, verifyContrast,
} from '../lib/color-engine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_HEX = '#6E40C9';

function hexValid(h: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(h);
}

// ─── Copy toast ───────────────────────────────────────────────────────────────

function useCopyToast() {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const copy = useCallback((hex: string) => {
    navigator.clipboard.writeText(hex).catch(() => {});
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1500);
  }, []);
  return { copiedHex, copy };
}

// ─── Swatch card ─────────────────────────────────────────────────────────────

function SwatchCard({ swatch, index, onCopy, copied }: {
  swatch: Swatch;
  index: number;
  onCopy: (hex: string) => void;
  copied: boolean;
}) {
  const name = colorName(swatch.color);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04 }}
      style={{
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--color-hairline)',
        background: 'var(--color-surface-1)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{ background: swatch.hex, minHeight: 120, cursor: 'pointer', flexShrink: 0 }}
        title={`Copy ${swatch.hex}`}
        onClick={() => onCopy(swatch.hex)}
      />
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-ink)', letterSpacing: '0.02em' }}>
            {swatch.hex}
          </span>
          <button
            onClick={() => onCopy(swatch.hex)}
            aria-label={`Copy ${swatch.hex}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-muted)', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            {copied ? <CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} />}
          </button>
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>{swatch.label}</span>
        <span style={{ fontSize: 10, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>{name}</span>
      </div>
    </motion.div>
  );
}

// ─── Harmony wheel SVG ────────────────────────────────────────────────────────

function HarmonyWheel({ swatches }: { swatches: Swatch[] }) {
  const R = 100, cx = 120, cy = 120, dotR = 8;
  return (
    <svg width={240} height={240} viewBox="0 0 240 240" style={{ display: 'block' }}>
      {/* Hue ring gradient approximation */}
      <defs>
        {[...Array(12)].map((_, i) => null)}
      </defs>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={2} fill="var(--color-ink-muted)" />
      {/* Cardinal labels */}
      {[{ label: '0°',   x: cx + R + 14, y: cy + 4 },
        { label: '90°',  x: cx - 6,       y: cy + R + 16 },
        { label: '180°', x: cx - R - 24,  y: cy + 4 },
        { label: '270°', x: cx - 10,      y: cy - R - 8 }].map(({ label, x, y }) => (
        <text key={label} x={x} y={y} fill="var(--color-ink-muted)" fontSize={9} fontFamily="var(--font-mono)" textAnchor="middle">{label}</text>
      ))}
      {/* Spokes connecting dots */}
      {swatches.map(sw => {
        const rad = (sw.color.h - 90) * (Math.PI / 180);
        const px = cx + R * Math.cos(rad);
        const py = cy + R * Math.sin(rad);
        return <line key={sw.label} x1={cx} y1={cy} x2={px} y2={py} stroke={sw.hex} strokeWidth={1.5} strokeOpacity={0.35} />;
      })}
      {/* Dots */}
      {swatches.map((sw, i) => {
        const rad = (sw.color.h - 90) * (Math.PI / 180);
        const px = cx + R * Math.cos(rad);
        const py = cy + R * Math.sin(rad);
        return (
          <g key={i}>
            <circle cx={px} cy={py} r={dotR} fill={sw.hex} stroke="var(--color-canvas)" strokeWidth={2} />
            {i === 0 && <circle cx={px} cy={py} r={dotR + 3} fill="none" stroke={sw.hex} strokeWidth={1.5} strokeOpacity={0.5} />}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Score panel ─────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  AAA:         { bg: 'rgba(62,207,95,0.18)',  color: '#3ecf5f' },
  AA:          { bg: 'rgba(0,153,255,0.18)',   color: '#0099ff' },
  'AA Large':  { bg: 'rgba(255,159,10,0.18)',  color: '#ff9f0a' },
  Fail:        { bg: 'rgba(229,72,77,0.18)',   color: '#e5484d' },
};

function ScorePanel({ palette, allSwatches }: { palette: Palette; allSwatches: Swatch[] }) {
  const colors = allSwatches.map(s => s.color);
  const report: Report | null = analyze(colors);

  if (!report) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--color-ink-muted)', fontSize: 14 }}>
        Add at least 2 colours to analyse.
      </div>
    );
  }

  const overallColor = report.overallScore >= 75 ? '#3ecf5f' : report.overallScore >= 50 ? '#ff9f0a' : '#e5484d';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Overall */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 52, fontWeight: 700, fontFamily: 'var(--font-display)', color: overallColor, letterSpacing: '-3px', lineHeight: 1 }}>
          {report.overallScore}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--color-ink-muted)' }}>Overall Score /100</span>
          <span style={{
            display: 'inline-block', padding: '3px 8px', borderRadius: 99,
            fontSize: 11, fontWeight: 600,
            background: overallColor + '22', color: overallColor,
          }}>{report.harmonyLabel}</span>
        </div>
      </div>

      {/* Harmony row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-ink-muted)' }}>
          <span>Harmony — <span style={{ textTransform: 'capitalize' }}>{report.detectedScheme}</span></span>
          <span>{report.harmonyScore}/100</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--color-surface-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 99, background: '#0099ff', width: `${report.harmonyScore}%`, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* Accessibility row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-ink-muted)' }}>
          <span>Accessibility</span>
          <span style={{ color: report.failingCount === 0 ? '#3ecf5f' : '#e5484d' }}>
            {report.passingCount} pass / {report.failingCount} fail
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--color-surface-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 99, background: '#3ecf5f', width: `${report.contrastScore}%`, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* Pair table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)', marginBottom: 4 }}>Contrast Pairs</span>
        {report.pairs.map((pair, i) => {
          const bs = BADGE_STYLES[pair.level];
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-hairline)',
            }}>
              {/* Two colour squares */}
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, background: hslToHex(pair.a), border: '1px solid var(--color-hairline)' }} />
                <div style={{ width: 16, height: 16, borderRadius: 3, background: hslToHex(pair.b), border: '1px solid var(--color-hairline)' }} />
              </div>
              {/* Sample text */}
              <span style={{ fontSize: 11, flex: 1, color: hslToHex(pair.a), background: hslToHex(pair.b), padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Sample Text
              </span>
              {/* Ratio */}
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-ink-muted)', flexShrink: 0 }}>
                {pair.ratio.toFixed(1)}:1
              </span>
              {/* Badge */}
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 99, background: bs.bg, color: bs.color, flexShrink: 0 }}>
                {pair.level}
              </span>
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)' }}>Recommendations</span>
        <ul style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {report.recommendations.map((r, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--color-ink-muted)', lineHeight: 1.5 }}>{r}</li>
          ))}
        </ul>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div style={{
          padding: '12px 14px', borderRadius: 'var(--radius-md)',
          background: 'rgba(255,159,10,0.10)', border: '1px solid rgba(255,159,10,0.30)',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#ff9f0a' }}>Accessibility Warning</span>
          {report.warnings.map((w, i) => (
            <span key={i} style={{ fontSize: 12, color: 'rgba(255,159,10,0.9)' }}>{w}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PalettePage() {
  // Verify math on mount
  useEffect(() => {
    const check = verifyContrast();
    console.assert(check.pass, 'WCAG contrast formula broken: got ' + check.ratio);
  }, []);

  // Input mode
  const [inputMode, setInputMode] = useState<'colour' | 'image'>('colour');

  // Colour input
  const [hexInput, setHexInput] = useState(DEFAULT_HEX);
  const [hexError, setHexError] = useState('');
  const [baseColor, setBaseColor] = useState<Color>(() => hexToHsl(DEFAULT_HEX)!);

  // Harmony type
  const [harmonyType, setHarmonyType] = useState('complementary');

  // Image extraction
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [extractedSwatches, setExtractedSwatches] = useState<{ color: Color; hex: string }[]>([]);
  const [imageMode, setImageMode] = useState<'use-all' | 'pick-one'>('use-all');
  const [pickedImageColor, setPickedImageColor] = useState<Color | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Copy toast
  const { copiedHex, copy } = useCopyToast();

  // Derive active base
  const activeBase: Color =
    inputMode === 'image' && imageMode === 'pick-one' && pickedImageColor
      ? pickedImageColor
      : baseColor;

  // Derive active palette
  const activePalette: Palette | null = (() => {
    if (inputMode === 'image' && imageMode === 'use-all' && extractedSwatches.length >= 2) {
      return {
        type: 'extracted',
        swatches: extractedSwatches.map((s, i) => ({ color: s.color, hex: s.hex, label: i === 0 ? 'Primary' : `Extracted ${i + 1}` })),
      };
    }
    return generatePalette(harmonyType, activeBase);
  })();

  // Hex input change
  function handleHexInput(val: string) {
    setHexInput(val);
    if (hexValid(val)) {
      const c = hexToHsl(val);
      if (c) { setBaseColor(c); setHexError(''); }
    } else {
      setHexError('Invalid hex colour');
    }
  }

  // Color picker change
  function handlePickerChange(val: string) {
    setHexInput(val.toUpperCase());
    const c = hexToHsl(val);
    if (c) { setBaseColor(c); setHexError(''); }
  }

  // Image load
  function loadImage(file: File) {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    const img = new Image();
    img.onload = () => {
      const colours = extractColours(img);
      setExtractedSwatches(colours.map(c => ({ color: c, hex: hslToHex(c) })));
      setPickedImageColor(null);
    };
    img.src = url;
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) loadImage(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) loadImage(f);
  }

  // Active swatches for score panel
  const activeSwatches = activePalette?.swatches ?? [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', color: 'var(--color-ink)', paddingBottom: 80 }}>
      {/* Page header */}
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '48px 20px 0' }}>
        <h1 className="type-display-md" style={{ marginBottom: 6 }}>Palette Studio</h1>
        <p style={{ fontSize: 14, color: 'var(--color-ink-muted)', marginBottom: 40 }}>
          Generate colour harmonies and check WCAG accessibility scores.
        </p>

        {/* ── REGION 1: Input ── */}
        <div style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-xl)',
          padding: '20px 20px',
          marginBottom: 24,
        }}>
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--color-hairline)', paddingBottom: 16 }}>
            {(['colour', 'image'] as const).map(m => (
              <button
                key={m}
                onClick={() => setInputMode(m)}
                style={{
                  padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-body)',
                  background: inputMode === m ? 'var(--color-surface-2)' : 'transparent',
                  color: inputMode === m ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>

          {inputMode === 'colour' ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              {/* Native picker */}
              <div style={{ position: 'relative' }}>
                <input
                  type="color"
                  value={hexInput.startsWith('#') && hexValid(hexInput) ? hexInput : DEFAULT_HEX}
                  onChange={e => handlePickerChange(e.target.value)}
                  style={{
                    width: 52, height: 52, padding: 3, borderRadius: 10,
                    border: '1px solid var(--color-hairline)', cursor: 'pointer',
                    background: 'var(--color-surface-2)',
                  }}
                  aria-label="Pick base colour"
                />
              </div>
              {/* Hex text field */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  type="text"
                  value={hexInput}
                  maxLength={7}
                  onChange={e => handleHexInput(e.target.value)}
                  placeholder="#6E40C9"
                  style={{
                    width: 120, padding: '10px 12px', borderRadius: 'var(--radius-md)',
                    border: `1px solid ${hexError ? '#e5484d' : 'var(--color-hairline)'}`,
                    background: 'var(--color-surface-2)', color: 'var(--color-ink)',
                    fontFamily: 'var(--font-mono)', fontSize: 14,
                  }}
                />
                {hexError && <span style={{ fontSize: 11, color: '#e5484d' }}>{hexError}</span>}
              </div>
              {/* Base swatch preview */}
              <div style={{
                width: 52, height: 52, borderRadius: 10, flexShrink: 0,
                background: hexValid(hexInput) ? hexInput : DEFAULT_HEX,
                border: '1px solid var(--color-hairline)',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-ink-muted)' }}>
                  {colorName(baseColor)} · {isWarmLabel(baseColor.h)}
                </span>
              </div>
            </div>
          ) : (
            /* Image mode */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? 'var(--color-accent-blue)' : 'var(--color-hairline)'}`,
                  borderRadius: 'var(--radius-lg)', padding: '32px 20px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                  background: dragging ? 'rgba(0,153,255,0.04)' : 'transparent',
                }}
              >
                {imageUrl ? (
                  <img src={imageUrl} alt="Uploaded" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 8, objectFit: 'contain' }} />
                ) : (
                  <>
                    <ImageIcon size={28} style={{ color: 'var(--color-ink-muted)' }} />
                    <span style={{ fontSize: 13, color: 'var(--color-ink-muted)' }}>Drag & drop or click to upload</span>
                  </>
                )}
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFileInput} style={{ display: 'none' }} />
              </div>

              {/* Extracted swatches */}
              {extractedSwatches.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {extractedSwatches.map((s, i) => (
                      <div
                        key={i}
                        title={s.hex}
                        onClick={() => { if (imageMode === 'pick-one') { setPickedImageColor(s.color); } }}
                        style={{
                          width: 44, height: 44, borderRadius: 10, background: s.hex,
                          border: `2px solid ${imageMode === 'pick-one' && pickedImageColor === s.color ? 'var(--color-ink)' : 'var(--color-hairline)'}`,
                          cursor: imageMode === 'pick-one' ? 'pointer' : 'default',
                          transition: 'border-color 0.15s',
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12, minHeight: 34, padding: '6px 12px' }}
                      onClick={() => { setImageMode('use-all'); setPickedImageColor(null); }}
                    >
                      Use image colours
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12, minHeight: 34, padding: '6px 12px', background: imageMode === 'pick-one' ? 'var(--color-surface-2)' : undefined }}
                      onClick={() => setImageMode('pick-one')}
                    >
                      Pick one to generate
                    </button>
                  </div>
                  {imageMode === 'pick-one' && (
                    <span style={{ fontSize: 11, color: 'var(--color-ink-muted)' }}>Click a swatch to use it as the base colour.</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── REGION 2: Palette display ── */}
        <div style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-xl)',
          padding: '20px',
          marginBottom: 24,
        }}>
          {/* Harmony type chips — hidden in use-all image mode */}
          {!(inputMode === 'image' && imageMode === 'use-all') && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              {HARMONY_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setHarmonyType(t)}
                  style={{
                    padding: '5px 12px', borderRadius: 99, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-body)',
                    background: harmonyType === t ? 'var(--color-inverse-canvas)' : 'var(--color-surface-2)',
                    color: harmonyType === t ? 'var(--color-canvas)' : 'var(--color-ink-muted)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {HARMONY_LABELS[t]}
                </button>
              ))}
            </div>
          )}

          {/* Swatches grid + wheel */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Swatch grid */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {activePalette ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 10,
                }}>
                  <AnimatePresence mode="popLayout">
                    {activePalette.swatches.map((sw, i) => (
                      <SwatchCard
                        key={sw.hex + sw.label}
                        swatch={sw}
                        index={i}
                        onCopy={copy}
                        copied={copiedHex === sw.hex}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div style={{ padding: 20, color: 'var(--color-ink-muted)', fontSize: 13 }}>
                  Upload an image and extract colours to begin.
                </div>
              )}
            </div>

            {/* Wheel */}
            {activePalette && (
              <div style={{ flexShrink: 0 }}>
                <HarmonyWheel swatches={activePalette.swatches} />
              </div>
            )}
          </div>
        </div>

        {/* ── REGION 3: Score panel ── */}
        {activePalette && (
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-xl)',
            padding: '20px',
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20, color: 'var(--color-ink)' }}>Score & Accessibility</h2>
            <ScorePanel palette={activePalette} allSwatches={activeSwatches} />
          </div>
        )}
      </div>

      {/* Copied toast */}
      <AnimatePresence>
        {copiedHex && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            style={{
              position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--color-inverse-canvas)', color: 'var(--color-canvas)',
              padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 500,
              zIndex: 400, display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: 'var(--shadow-level-2)',
            }}
          >
            <CheckCircle size={13} />
            Copied {copiedHex}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function isWarmLabel(h: number): string {
  return ((h >= 0 && h <= 60) || h >= 300) ? 'Warm' : 'Cool';
}
