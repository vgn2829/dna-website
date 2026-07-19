import { useEffect, useRef, useState, useCallback } from 'react';
import { Upload, Download, RotateCcw, Loader2, ImageOff, AlertTriangle, Info, Brush, Eraser, Undo2, Redo2 } from 'lucide-react';
import type { SourceImage, ModelId } from './types';
import { MODELS } from './models';
import { useImageUpload } from './useImageUpload';
import { useBackgroundRemoval, type RemovalProgress } from './useBackgroundRemoval';
import {
  loadSourceImage,
  bitmapToImageData,
  applyMask,
  buildExportCanvas,
  canvasToPngBlob,
  downloadBlob,
} from './compositing';
import { stampBrush, recompositeRegion, type BrushMode } from './refine';

// ── Local style objects — same inline-CSS-var convention as the other tools ──
const card = {
  borderRadius: 'var(--radius-xl)',
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-hairline)',
  overflow: 'hidden',
} as const;
const cardHead = {
  padding: '10px 16px',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-ink-muted)',
  borderBottom: '1px solid var(--color-hairline)',
  fontFamily: 'var(--font-body)',
} as const;
const label = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--color-ink)',
  marginBottom: 8,
  fontFamily: 'var(--font-body)',
} as const;
const primaryBtn = (disabled: boolean) => ({
  flex: 1,
  padding: '11px 0',
  borderRadius: 'var(--radius-pill)',
  border: 'none',
  background: 'var(--color-brand)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
  fontFamily: 'var(--font-body)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
});
const ghostBtn = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '11px 16px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid var(--color-hairline)',
  background: 'transparent',
  color: 'var(--color-ink)',
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
} as const;

const pill = (active: boolean) => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 0',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  border: active ? '2px solid var(--color-brand)' : '1px solid var(--color-hairline)',
  background: active ? 'var(--color-surface-2)' : 'transparent',
  color: active ? 'var(--color-ink)' : 'var(--color-ink-muted)',
  fontSize: 13,
  fontWeight: active ? 600 : 500,
  fontFamily: 'var(--font-body)',
});
const edgeBtn = (active: boolean) => ({
  padding: '5px 12px',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  border: '1px solid var(--color-hairline)',
  background: active ? 'var(--color-brand)' : 'transparent',
  color: active ? '#fff' : 'var(--color-ink-muted)',
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
});

const CHECKER = 'repeating-conic-gradient(rgba(0,0,0,0.10) 0% 25%, rgba(255,255,255,0.10) 0% 50%) 50% / 16px 16px, var(--color-canvas)';
function backdropCss(id: string): string {
  if (id === 'white') return '#ffffff';
  if (id === 'black') return '#000000';
  return CHECKER;
}

/** Human-readable label for the current processing phase. */
function progressLabel(p: RemovalProgress | null): string {
  if (!p) return 'Processing…';
  if (p.phase === 'download') return `Downloading model${p.pct != null ? ` ${p.pct}%` : '…'}`;
  if (p.phase === 'init') return 'Initializing…';
  return 'Analyzing…';
}

const BACKDROPS = [
  { id: 'transparent', label: 'Transparent', swatch: 'checker' },
  { id: 'white', label: 'White', swatch: '#ffffff' },
  { id: 'black', label: 'Black', swatch: '#000000' },
];

// Undo/redo depth. Each step is a full-mask snapshot (~W×H bytes), so this caps
// the memory the history can hold — see the memory note in the PR.
const HISTORY_CAP = 15;

export default function BackgroundRemover() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [backdropId, setBackdropId] = useState('transparent');
  const [reject, setReject] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>('general');

  // Refine (Phase A)
  const [brushMode, setBrushMode] = useState<BrushMode | 'off'>('off');
  const [brushSize, setBrushSize] = useState(48);
  const [brushHard, setBrushHard] = useState(false);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  // Mutable buffers read by the imperative brush handlers (no stale closures).
  const maskRef = useRef<Uint8ClampedArray | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const strokeRef = useRef<{ x: number; y: number } | null>(null);
  const strokeChangedRef = useRef(false);
  // Undo/redo: full-mask snapshots. index points at the current state.
  const historyRef = useRef<{ stack: Uint8ClampedArray[]; index: number }>({ stack: [], index: -1 });

  const { status, error, progress, removeBackground, reset: resetEngine } = useBackgroundRemoval();
  imageDataRef.current = imageData;
  const refining = brushMode !== 'off';

  const syncHistoryFlags = useCallback(() => {
    const h = historyRef.current;
    setCanUndo(h.index > 0);
    setCanRedo(h.index < h.stack.length - 1);
  }, []);

  /** Start a fresh history with the given mask as the baseline (index 0). */
  const resetHistory = useCallback(
    (mask: Uint8ClampedArray) => {
      historyRef.current = { stack: [new Uint8ClampedArray(mask)], index: 0 };
      syncHistoryFlags();
    },
    [syncHistoryFlags],
  );

  /** Push a completed stroke's state, dropping any redo tail and capping depth. */
  const pushHistory = useCallback(
    (mask: Uint8ClampedArray) => {
      const h = historyRef.current;
      h.stack = h.stack.slice(0, h.index + 1);
      h.stack.push(new Uint8ClampedArray(mask));
      h.index = h.stack.length - 1;
      if (h.stack.length > HISTORY_CAP) {
        h.stack.shift();
        h.index -= 1;
      }
      syncHistoryFlags();
    },
    [syncHistoryFlags],
  );

  /** Load a snapshot into the live mask and repaint the whole canvas. */
  const restoreTo = useCallback((i: number) => {
    const h = historyRef.current;
    const img = imageDataRef.current;
    const canvas = displayRef.current;
    if (!img || !canvas || i < 0 || i >= h.stack.length) return;
    maskRef.current = new Uint8ClampedArray(h.stack[i]); // fresh copy — snapshots stay immutable
    h.index = i;
    canvas.getContext('2d')!.putImageData(applyMask(img, maskRef.current), 0, 0);
    setCanUndo(i > 0);
    setCanRedo(i < h.stack.length - 1);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index > 0) restoreTo(h.index - 1);
  }, [restoreTo]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index < h.stack.length - 1) restoreTo(h.index + 1);
  }, [restoreTo]);

  const clearResult = useCallback(() => {
    maskRef.current = null;
    setHasResult(false);
    setBrushMode('off');
    historyRef.current = { stack: [], index: -1 };
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const changeModel = useCallback(
    (m: ModelId) => {
      setModel(m);
      clearResult();
      resetEngine();
    },
    [clearResult, resetEngine],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setReject(null);
      const name = file.name.replace(/\.[^.]+$/, '') || 'image';
      const src = await loadSourceImage(file, name);
      setSource(src);
      setImageData(bitmapToImageData(src));
      clearResult();
      resetEngine();
    },
    [clearResult, resetEngine],
  );

  const upload = useImageUpload({ onImage: handleFile, onReject: setReject, enabled: true });

  // Full repaint on source change or when a result appears/disappears. Brush
  // edits patch the canvas imperatively and don't retrigger this.
  useEffect(() => {
    const canvas = displayRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, source.width, source.height);
    if (hasResult && maskRef.current && imageDataRef.current) {
      ctx.putImageData(applyMask(imageDataRef.current, maskRef.current), 0, 0);
    } else {
      ctx.drawImage(source.bitmap, 0, 0);
    }
  }, [source, hasResult]);

  // Undo/redo keyboard shortcuts, active only while a result exists.
  useEffect(() => {
    if (!hasResult) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasResult, undo, redo]);

  const handleRemove = useCallback(async () => {
    if (!imageData) return;
    try {
      const mask = await removeBackground(imageData, model);
      maskRef.current = mask;
      resetHistory(mask);
      setHasResult(true);
    } catch {
      /* status/error surfaced by the hook */
    }
  }, [imageData, model, removeBackground, resetHistory]);

  const handleDownload = useCallback(async () => {
    const canvas = displayRef.current;
    if (!canvas || !source || !hasResult) return;
    const backdrop = backdropId === 'transparent'
      ? ({ kind: 'transparent' } as const)
      : ({ kind: 'color', color: backdropId === 'white' ? '#ffffff' : '#000000' } as const);
    const blob = await canvasToPngBlob(buildExportCanvas(canvas, backdrop));
    downloadBlob(blob, `${source.name}-nobg.png`);
  }, [source, hasResult, backdropId]);

  const handleReset = useCallback(() => {
    setSource(null);
    setImageData(null);
    setReject(null);
    clearResult();
    resetEngine();
  }, [clearResult, resetEngine]);

  // ── Brush interaction ──────────────────────────────────────────────────────
  const imgCoords = (e: React.PointerEvent) => {
    const c = displayRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    };
  };

  const positionRing = (e: React.PointerEvent) => {
    const ring = ringRef.current;
    const c = displayRef.current;
    if (!ring || !c) return;
    if (!refining) {
      ring.style.display = 'none';
      return;
    }
    const rect = c.getBoundingClientRect();
    const diameter = brushSize * (rect.width / c.width);
    ring.style.display = 'block';
    ring.style.width = `${diameter}px`;
    ring.style.height = `${diameter}px`;
    ring.style.left = `${e.clientX - rect.left}px`;
    ring.style.top = `${e.clientY - rect.top}px`;
  };

  const stamp = (cx: number, cy: number) => {
    const mask = maskRef.current;
    const img = imageDataRef.current;
    const canvas = displayRef.current;
    if (!mask || !img || !canvas || brushMode === 'off') return null;
    const hardness = brushHard ? 1 : 0.35;
    const r = brushSize / 2;
    const dirty = stampBrush(mask, img.width, img.height, cx, cy, r, hardness, brushMode);
    recompositeRegion(canvas, img, mask, dirty);
    strokeChangedRef.current = true;
    return dirty;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!refining || !hasResult) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-captured pointer */
    }
    const { x, y } = imgCoords(e);
    strokeRef.current = { x, y };
    strokeChangedRef.current = false;
    stamp(x, y);
    positionRing(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    positionRing(e);
    if (!refining || !strokeRef.current) return;
    const { x, y } = imgCoords(e);
    const last = strokeRef.current;
    const dist = Math.hypot(x - last.x, y - last.y);
    const step = Math.max(1, brushSize * 0.2);
    const n = Math.max(1, Math.floor(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      stamp(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
    }
    strokeRef.current = { x, y };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    strokeRef.current = null;
    if (strokeChangedRef.current && maskRef.current) {
      pushHistory(maskRef.current); // snapshot the completed stroke, not per-move
      strokeChangedRef.current = false;
    }
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
  };

  const onPointerLeave = () => {
    strokeRef.current = null;
    if (ringRef.current) ringRef.current.style.display = 'none';
  };

  return (
    <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <input ref={upload.inputRef} type="file" accept="image/*" hidden onChange={upload.onInputChange} />

      {/* Honest, persistent limitation note. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 14px',
          marginBottom: 16,
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-hairline)',
          color: 'var(--color-ink-muted)',
          fontSize: 12.5,
          lineHeight: 1.5,
          fontFamily: 'var(--font-body)',
        }}
      >
        <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Runs on your device — the image never leaves it. Results won't match paid tools on the
          hardest cases: neither model cuts out <strong>true transparency</strong> (glass, smoke) or
          very fine hair cleanly. Use <strong>Refine</strong> to fix what the model misses.
        </span>
      </div>

      {!source ? (
        <div
          onClick={upload.openPicker}
          onDrop={upload.onDrop}
          onDragOver={upload.onDragOver}
          onDragLeave={upload.onDragLeave}
          style={{
            ...card,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 320,
            cursor: 'pointer',
            color: 'var(--color-ink-muted)',
            padding: 40,
            textAlign: 'center',
            borderStyle: 'dashed',
            borderColor: upload.isDragging ? 'var(--color-brand)' : 'var(--color-hairline)',
          }}
        >
          <Upload size={32} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
            Drop an image, click to browse, or paste from clipboard
          </div>
          <div style={{ fontSize: 13, marginTop: 6, fontFamily: 'var(--font-body)' }}>
            PNG, JPEG, WebP, GIF or BMP · processed entirely on your device
          </div>
          {reject && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, color: 'var(--color-error)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
              <AlertTriangle size={15} /> {reject}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 300px' }} className="bg-remover-grid">
          {/* Canvas */}
          <div style={card}>
            <div style={cardHead}>{hasResult ? 'Result' : 'Original'}</div>
            <div
              style={{
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 320,
                background: 'var(--color-canvas)',
              }}
            >
              <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                <canvas
                  ref={displayRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerLeave}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '68vh',
                    display: 'block',
                    borderRadius: 'var(--radius-md)',
                    background: hasResult ? backdropCss(backdropId) : 'transparent',
                    cursor: refining ? 'none' : 'default',
                    touchAction: refining ? 'none' : 'auto',
                  }}
                />
                <div
                  ref={ringRef}
                  style={{
                    position: 'absolute',
                    display: 'none',
                    pointerEvents: 'none',
                    left: 0,
                    top: 0,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    border: '1.5px solid rgba(255,255,255,0.95)',
                    boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Controls */}
          <div style={{ ...card, padding: 20, alignSelf: 'start' }}>
            <label style={label}>Model</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              {(['general', 'portrait'] as ModelId[]).map((m) => (
                <button key={m} onClick={() => changeModel(m)} style={pill(model === m)}>
                  {MODELS[m].label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-ink-muted)', marginBottom: 20, fontFamily: 'var(--font-body)' }}>
              {MODELS[model].caption}
            </div>

            <label style={label}>Background</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {BACKDROPS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBackdropId(b.id)}
                  title={b.label}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    border: backdropId === b.id ? '2px solid var(--color-brand)' : '1px solid var(--color-hairline)',
                    background:
                      b.swatch === 'checker'
                        ? 'repeating-conic-gradient(rgba(0,0,0,0.12) 0% 25%, transparent 0% 50%) 50% / 12px 12px'
                        : b.swatch,
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={handleRemove} disabled={status === 'processing'} style={primaryBtn(status === 'processing')}>
                {status === 'processing' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> {progressLabel(progress)}
                  </>
                ) : (
                  <>
                    <ImageOff size={16} /> {hasResult ? 'Re-run' : 'Remove Background'}
                  </>
                )}
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleDownload} disabled={!hasResult} style={{ ...ghostBtn, flex: 1, opacity: hasResult ? 1 : 0.5, cursor: hasResult ? 'pointer' : 'not-allowed' }}>
                  <Download size={16} /> PNG
                </button>
                <button onClick={handleReset} title="Reset" style={ghostBtn}>
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>

            {/* Refine — only once there's a result to fix. */}
            {hasResult && (
              <div style={{ marginTop: 20, borderTop: '1px solid var(--color-hairline)', paddingTop: 18 }}>
                <label style={label}>Refine mask</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setBrushMode((m) => (m === 'restore' ? 'off' : 'restore'))} style={pill(brushMode === 'restore')}>
                    <Brush size={14} /> Restore
                  </button>
                  <button onClick={() => setBrushMode((m) => (m === 'erase' ? 'off' : 'erase'))} style={pill(brushMode === 'erase')}>
                    <Eraser size={14} /> Erase
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    title="Undo (⌘/Ctrl+Z)"
                    style={{ ...ghostBtn, flex: 1, padding: '8px 0', fontSize: 13, opacity: canUndo ? 1 : 0.45, cursor: canUndo ? 'pointer' : 'not-allowed' }}
                  >
                    <Undo2 size={14} /> Undo
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    title="Redo (⌘/Ctrl+Shift+Z)"
                    style={{ ...ghostBtn, flex: 1, padding: '8px 0', fontSize: 13, opacity: canRedo ? 1 : 0.45, cursor: canRedo ? 'pointer' : 'not-allowed' }}
                  >
                    <Redo2 size={14} /> Redo
                  </button>
                </div>

                <div style={{ fontSize: 12, color: 'var(--color-ink-muted)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                  Brush size — {brushSize}px
                </div>
                <input
                  type="range"
                  min={8}
                  max={200}
                  value={brushSize}
                  onChange={(e) => setBrushSize(+e.target.value)}
                  style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer', marginBottom: 14 }}
                />

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>Edge</span>
                  <button onClick={() => setBrushHard(false)} style={edgeBtn(!brushHard)}>Soft</button>
                  <button onClick={() => setBrushHard(true)} style={edgeBtn(brushHard)}>Hard</button>
                </div>

                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-ink-muted)', marginTop: 12, fontFamily: 'var(--font-body)' }}>
                  {refining
                    ? `Brush over the image to ${brushMode} areas. Restore brings back removed pixels; erase removes kept ones.`
                    : 'Pick Restore or Erase, then brush over the image to fix the mask.'}
                </div>
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, color: 'var(--color-error)', fontSize: 12.5, fontFamily: 'var(--font-body)' }}>
                <AlertTriangle size={15} /> {error}
              </div>
            )}

            <div style={{ marginTop: 18, fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
              {source.width} × {source.height}px · everything runs locally; the image never leaves your device.
              {source.downscaled && ' Large image downscaled for processing.'}
            </div>
          </div>
        </div>
      )}

      {/* One-column layout on narrow screens. */}
      <style>{`@media (max-width: 720px){ .bg-remover-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
