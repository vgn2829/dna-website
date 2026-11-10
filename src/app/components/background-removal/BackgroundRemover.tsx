import { useStudioDraft, isBoolean } from "../../lib/studio-draft";
import { readImageDraft, saveImageDraft, clearImageDraft, type ImageDraft } from '../../lib/image-drafts';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Upload, Download, RotateCcw, Loader2, ImageOff, AlertTriangle, Brush, Eraser, Undo2, Redo2 } from 'lucide-react';
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
import { StudioRange } from '../studio/StudioRange';

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
const HISTORY_BYTES = 32 * 1024 * 1024;
type EditHistory = { stack: Uint8ClampedArray[]; index: number };
// Weak keys keep only the current image draft alive; history survives a tool switch, not a reload.
const editHistories = new WeakMap<Blob, EditHistory>();

export default function BackgroundRemover() {
  const sourceGeneration = useRef(0);
  const draftRef = useRef<ImageDraft | null>(null);
  const [retain, setRetain] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState(false);
  useEffect(() => { let active = true; const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu; void gpu?.requestAdapter().then(adapter => { if (active) setGpuAvailable(!!adapter); }).catch(() => {}); return () => { active = false; }; }, []);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [backdropId, setBackdropId] = useStudioDraft('background-backdrop', 'transparent', (v): v is string => ['transparent', 'white', 'black'].includes(String(v)));
  const [reject, setReject] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>('general');

  // Refine (Phase A)
  const [brushMode, setBrushMode] = useState<BrushMode | 'off'>('off');
  const [brushSize, setBrushSize] = useStudioDraft("background-brush-size", 48, (v): v is number => typeof v === "number" && v >= 8 && v <= 200);
  const [brushHard, setBrushHard] = useStudioDraft("background-brush-hard", false, isBoolean);

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

  const { status, error, progress, backend, removeBackground, release, reset: resetEngine } = useBackgroundRemoval();
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
      if (h.stack.length > Math.max(2, Math.floor(HISTORY_BYTES / mask.byteLength))) {
        h.stack.shift();
        h.index -= 1;
      }
      if (draftRef.current) void saveImageDraft("background", { ...draftRef.current, mask: new Uint8ClampedArray(mask), saved: Date.now() });
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
      const token = ++sourceGeneration.current;
      resetEngine(); clearResult();
      setReject(null);
      try {
      const name = file.name.replace(/\.[^.]+$/, '') || 'image';
      const src = await loadSourceImage(file, name);
      if (token !== sourceGeneration.current) { src.bitmap.close(); return; }
      draftRef.current = { version: 1, file, name, saved: Date.now(), retain: draftRef.current?.retain || false };
      void saveImageDraft("background", draftRef.current);
      setSource(src);
      setImageData(bitmapToImageData(src));
      clearResult();
      resetEngine();
      } catch (error) { if (token === sourceGeneration.current) setReject(error instanceof Error ? error.message : "Image decoding failed"); }
    },
    [clearResult, resetEngine],
  );

  useEffect(() => () => source?.bitmap.close(), [source]);
  useEffect(() => {
    let active = true;
    void readImageDraft('background').then(async draft => {
      if (!active || !draft || sourceGeneration.current) return;
      const token = ++sourceGeneration.current;
      try {
        const restored = await loadSourceImage(draft.file, draft.name);
        if (!active || token !== sourceGeneration.current) { restored.bitmap.close(); return; }
        draftRef.current = draft; setRetain(draft.retain);
        setSource(restored); setImageData(bitmapToImageData(restored)); setModel(draft.model || 'general');
        if (draft.mask?.length === restored.width * restored.height) {
          maskRef.current = new Uint8ClampedArray(draft.mask);
          const edits = editHistories.get(draft.file);
          if (edits && edits.stack.every(mask => mask.length === draft.mask!.length)) { historyRef.current = edits; syncHistoryFlags(); }
          else resetHistory(draft.mask);
          setHasResult(true);
        }
      } catch { setReject('Saved image could not be restored. Upload a new image.'); }
    });
    return () => {
      active = false;
      if (draftRef.current) editHistories.set(draftRef.current.file, historyRef.current);
      if (draftRef.current) void saveImageDraft('background', { ...draftRef.current, mask: maskRef.current ? new Uint8ClampedArray(maskRef.current) : undefined, saved: Date.now() });
    };
  }, [resetHistory, syncHistoryFlags]);
  useEffect(() => {
    if (!draftRef.current) return;
    const draft = { ...draftRef.current, model, retain, mask: hasResult && maskRef.current ? new Uint8ClampedArray(maskRef.current) : undefined, saved: Date.now() };
    draftRef.current = draft;
    void saveImageDraft('background', draft).then(ok => { if (!ok) setReject(retain ? 'Device storage unavailable. Image remains in this session; an older retained image may still exist.' : 'Device storage could not be cleared. A retained image may remain; use Reset or browser site-data settings.'); });
  }, [retain, hasResult, model, source]);
  useEffect(() => () => { ++sourceGeneration.current; }, []);

  const hasSourceAlpha = useMemo(() => { if (!imageData) return false; for (let i = 3; i < imageData.data.length; i += 4) if (imageData.data[i] < 255) return true; return false; }, [imageData]);
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
      const mask = await removeBackground(imageData, model, 'browser');
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
    try {
    const blob = await canvasToPngBlob(buildExportCanvas(canvas, backdrop));
    downloadBlob(blob, `${source.name}-nobg.png`);
    } catch { setReject("PNG export failed. Please retry."); }
  }, [source, hasResult, backdropId]);

  const handleReset = useCallback(async () => {
    const token = ++sourceGeneration.current;
    resetEngine(); clearResult(); draftRef.current = null;
    const ok = await clearImageDraft('background');
    if (token !== sourceGeneration.current) return;
    setSource(null); setImageData(null);
    setReject(ok ? null : 'Device storage could not be cleared. Clear site data in browser settings.');
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

  const busy = status === 'processing';
  return (
    <div className="studio-tool">
      <input ref={upload.inputRef} type="file" accept="image/*" hidden onChange={upload.onInputChange} />

      <div className="studio-actions">
        <p role="status" className="studio-help" style={{ flex: '1 1 320px' }}>{backend === "helper" ? "Python helper on this computer (CPU)" : backend === "webgpu" ? "WebGPU acceleration (float32)" : backend === "wasm" ? "CPU WASM fallback - larger images may take several seconds" : "Local processing: WebGPU when available, CPU WASM fallback"}. Model sessions release after two idle minutes.</p>
        <button className="btn-secondary btn-sm" onClick={release}>Release browser model memory</button>
      </div>
      <label className="studio-check"><input type="checkbox" checked={retain} onChange={e => setRetain(e.target.checked)} /> Keep this image on this device for 24 hours (off by default)</label>
      {!source ? (
        <div
          className={`studio-upload is-clickable${upload.isDragging ? ' is-dragging' : ''}`}
          style={{ minHeight: 320 }}
          onClick={upload.openPicker}
          onDrop={upload.onDrop}
          onDragOver={upload.onDragOver}
          onDragLeave={upload.onDragLeave}
        >
          <Upload size={32} aria-hidden="true" />
          <div>
            <strong>Drop an image, click to browse, or paste from clipboard</strong>
            <p style={{ marginTop: 6 }}>PNG, JPEG, WebP, GIF or BMP · processed entirely on your device</p>
          </div>
          <button type="button" className="btn-secondary" onClick={e => { e.stopPropagation(); upload.openPicker(); }}>Choose image</button>
          {reject && (
            <p role="alert" className="studio-status is-error">
              <AlertTriangle size={15} aria-hidden="true" style={{ verticalAlign: -3, marginRight: 6 }} />{reject}
            </p>
          )}
        </div>
      ) : (
        <div className="studio-workspace">
          {/* Canvas */}
          <section className="studio-panel">
            <h2>{hasResult ? 'Result' : 'Original'}</h2>
            <div className="studio-panel-stage is-padded" style={{ minHeight: 320 }}>
              <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                <canvas
                  ref={displayRef}
                  aria-label={hasResult ? 'Background removal result' : 'Original image'}
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
                  className="studio-brush-ring"
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
          </section>

          {/* Controls */}
          <div className="studio-controls">
            <div className="studio-group" role="group" aria-labelledby="background-model">
              <span className="studio-label" id="background-model">Model</span>
              <div className="segmented studio-choice is-fill">
                {(['general', 'portrait', 'detail'] as ModelId[]).map((m) => (
                  <button key={m} className="segmented-item" aria-pressed={model === m} disabled={m === 'detail' && !gpuAvailable} onClick={() => changeModel(m)}>
                    {MODELS[m].label}
                  </button>
                ))}
              </div>
              {(MODELS[model].caption || !gpuAvailable) && (
                <p className="studio-help">
                  {MODELS[model].caption}
                  {!gpuAvailable && ' Detail needs WebGPU. General and Portrait keep their CPU fallback.'}
                </p>
              )}
            </div>

            <div className="studio-group" role="group" aria-labelledby="background-backdrop">
              <span className="studio-label" id="background-backdrop">Background</span>
              <div className="studio-inline">
                {BACKDROPS.map((b) => (
                  <button
                    key={b.id}
                    className="studio-swatch-choice"
                    onClick={() => setBackdropId(b.id)}
                    title={b.label}
                    aria-label={`${b.label} background`}
                    aria-pressed={backdropId === b.id}
                    style={{
                      background:
                        b.swatch === 'checker'
                          ? 'repeating-conic-gradient(rgba(0,0,0,0.12) 0% 25%, transparent 0% 50%) 50% / 12px 12px'
                          : b.swatch,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="studio-actions">
              <button className="btn-primary" style={{ flex: '1 1 100%' }} onClick={handleRemove} disabled={busy || (model === 'detail' && !gpuAvailable)}>
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {progressLabel(progress)}
                  </>
                ) : (
                  <>
                    <ImageOff size={16} aria-hidden="true" /> {hasResult ? 'Re-run' : 'Remove Background'}
                  </>
                )}
              </button>
              <button className="btn-translucent is-grow" onClick={handleDownload} disabled={!hasResult}>
                <Download size={16} aria-hidden="true" /> PNG
              </button>
              <button className="btn-translucent btn-icon" onClick={handleReset} title="Reset" aria-label="Reset">
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>

            {hasSourceAlpha && <div><button className="btn-translucent btn-sm" onClick={() => { resetEngine(); const mask = new Uint8ClampedArray(imageData!.width * imageData!.height).fill(255); maskRef.current = mask; resetHistory(mask); setHasResult(true); }}>Keep source transparency (skip AI)</button></div>}
            {/* Refine — only once there's a result to fix. */}
            {hasResult && (
              <div className="studio-controls-section" role="group" aria-labelledby="background-refine">
                <span className="studio-label" id="background-refine">Refine mask</span>
                <div className="studio-actions">
                  <button className="btn-translucent is-grow" aria-pressed={brushMode === 'restore'} onClick={() => setBrushMode((m) => (m === 'restore' ? 'off' : 'restore'))}>
                    <Brush size={14} aria-hidden="true" /> Restore
                  </button>
                  <button className="btn-translucent is-grow" aria-pressed={brushMode === 'erase'} onClick={() => setBrushMode((m) => (m === 'erase' ? 'off' : 'erase'))}>
                    <Eraser size={14} aria-hidden="true" /> Erase
                  </button>
                </div>

                <div className="studio-actions">
                  <button className="btn-translucent btn-sm is-grow" onClick={undo} disabled={!canUndo} title="Undo (⌘/Ctrl+Z)">
                    <Undo2 size={14} aria-hidden="true" /> Undo
                  </button>
                  <button className="btn-translucent btn-sm is-grow" onClick={redo} disabled={!canRedo} title="Redo (⌘/Ctrl+Shift+Z)">
                    <Redo2 size={14} aria-hidden="true" /> Redo
                  </button>
                </div>

                <StudioRange label="Brush size" ariaLabel="Mask brush size" min={8} max={200} value={brushSize} suffix="px" onChange={setBrushSize} />

                <div className="studio-group" role="group" aria-labelledby="background-edge">
                  <span className="studio-label" id="background-edge">Edge</span>
                  <div className="segmented studio-choice is-fill">
                    <button className="segmented-item" aria-pressed={!brushHard} onClick={() => setBrushHard(false)}>Soft</button>
                    <button className="segmented-item" aria-pressed={brushHard} onClick={() => setBrushHard(true)}>Hard</button>
                  </div>
                </div>

                <p className="studio-help">
                  {refining
                    ? `Brush over the image to ${brushMode} areas. Restore brings back removed pixels; erase removes kept ones.`
                    : 'Pick Restore or Erase, then brush over the image to fix the mask.'}
                </p>
              </div>
            )}

            {(error || reject) && (
              <p role="alert" className="studio-status is-error">
                <AlertTriangle size={15} aria-hidden="true" style={{ verticalAlign: -3, marginRight: 6 }} />{error || reject}
              </p>
            )}

            <p className="studio-help">
              {source.width} × {source.height}px.
              {source.downscaled && ' Large image downscaled for processing.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
