import { useEffect, useRef, useState, useCallback } from 'react';
import { Upload, Download, RotateCcw, Loader2, ImageOff, AlertTriangle, Info } from 'lucide-react';
import type { Backdrop, SourceImage, ModelId } from './types';
import { MODELS } from './models';
import { useImageUpload } from './useImageUpload';
import { useBackgroundRemoval, type RemovalProgress } from './useBackgroundRemoval';
import {
  loadSourceImage,
  bitmapToImageData,
  applyMask,
  imageDataToCanvas,
  paintBackdrop,
  buildExportCanvas,
  canvasToPngBlob,
  downloadBlob,
} from './compositing';

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

const modelPill = (active: boolean) => ({
  flex: 1,
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

/** Human-readable label for the current processing phase. */
function progressLabel(p: RemovalProgress | null): string {
  if (!p) return 'Processing…';
  if (p.phase === 'download') return `Downloading model${p.pct != null ? ` ${p.pct}%` : '…'}`;
  if (p.phase === 'init') return 'Initializing…';
  return 'Analyzing…';
}

const BACKDROPS: { id: string; label: string; value: Backdrop; swatch: string }[] = [
  { id: 'transparent', label: 'Transparent', value: { kind: 'transparent' }, swatch: 'checker' },
  { id: 'white', label: 'White', value: { kind: 'color', color: '#ffffff' }, swatch: '#ffffff' },
  { id: 'black', label: 'Black', value: { kind: 'color', color: '#000000' }, swatch: '#000000' },
];

export default function BackgroundRemover() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [cutout, setCutout] = useState<HTMLCanvasElement | null>(null);
  const [backdropId, setBackdropId] = useState('transparent');
  const [reject, setReject] = useState<string | null>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);

  const [model, setModel] = useState<ModelId>('general');
  const { status, error, progress, removeBackground, reset: resetEngine } = useBackgroundRemoval();
  const backdrop = BACKDROPS.find((b) => b.id === backdropId)!.value;

  // Switching model invalidates the current cut-out — the user re-runs.
  const changeModel = useCallback(
    (m: ModelId) => {
      setModel(m);
      setCutout(null);
      resetEngine();
    },
    [resetEngine],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setReject(null);
      const name = file.name.replace(/\.[^.]+$/, '') || 'image';
      const src = await loadSourceImage(file, name);
      setSource(src);
      setImageData(bitmapToImageData(src));
      setCutout(null);
      resetEngine();
    },
    [resetEngine],
  );

  const upload = useImageUpload({ onImage: handleFile, onReject: setReject, enabled: true });

  // Redraw the display canvas whenever the source, result, or backdrop changes.
  useEffect(() => {
    const canvas = displayRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, source.width, source.height);
    if (cutout) {
      paintBackdrop(ctx, source.width, source.height, backdrop);
      ctx.drawImage(cutout, 0, 0);
    } else {
      ctx.drawImage(source.bitmap, 0, 0);
    }
  }, [source, cutout, backdrop]);

  const handleRemove = useCallback(async () => {
    if (!imageData) return;
    try {
      const mask = await removeBackground(imageData, model);
      setCutout(imageDataToCanvas(applyMask(imageData, mask)));
    } catch {
      /* status/error surfaced by the hook */
    }
  }, [imageData, model, removeBackground]);

  const handleDownload = useCallback(async () => {
    if (!cutout || !source) return;
    const blob = await canvasToPngBlob(buildExportCanvas(cutout, backdrop));
    downloadBlob(blob, `${source.name}-nobg.png`);
  }, [cutout, source, backdrop]);

  const handleReset = useCallback(() => {
    setSource(null);
    setImageData(null);
    setCutout(null);
    setReject(null);
    resetEngine();
  }, [resetEngine]);

  return (
    <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <input
        ref={upload.inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={upload.onInputChange}
      />

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
          Runs on your device — the image never leaves it. Results won't match paid
          tools on the hardest cases: neither model cuts out <strong>true
          transparency</strong> (glass, smoke) or very fine hair cleanly.
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 16,
                color: 'var(--color-error)',
                fontSize: 13,
                fontFamily: 'var(--font-body)',
              }}
            >
              <AlertTriangle size={15} /> {reject}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 300px' }} className="bg-remover-grid">
          {/* Canvas */}
          <div style={card}>
            <div style={cardHead}>{cutout ? 'Result' : 'Original'}</div>
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
              <canvas
                ref={displayRef}
                style={{ maxWidth: '100%', maxHeight: '68vh', display: 'block', borderRadius: 'var(--radius-md)' }}
              />
            </div>
          </div>

          {/* Controls */}
          <div style={{ ...card, padding: 20, alignSelf: 'start' }}>
            <label style={label}>Model</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              {(['general', 'portrait'] as ModelId[]).map((m) => (
                <button key={m} onClick={() => changeModel(m)} style={modelPill(model === m)}>
                  {MODELS[m].label}
                </button>
              ))}
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                color: 'var(--color-ink-muted)',
                marginBottom: 20,
                fontFamily: 'var(--font-body)',
              }}
            >
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
                    border:
                      backdropId === b.id
                        ? '2px solid var(--color-brand)'
                        : '1px solid var(--color-hairline)',
                    background:
                      b.swatch === 'checker'
                        ? 'repeating-conic-gradient(rgba(0,0,0,0.12) 0% 25%, transparent 0% 50%) 50% / 12px 12px'
                        : b.swatch,
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={handleRemove}
                disabled={status === 'processing'}
                style={primaryBtn(status === 'processing')}
              >
                {status === 'processing' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> {progressLabel(progress)}
                  </>
                ) : (
                  <>
                    <ImageOff size={16} /> {cutout ? 'Re-run' : 'Remove Background'}
                  </>
                )}
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleDownload} disabled={!cutout} style={{ ...ghostBtn, flex: 1, opacity: cutout ? 1 : 0.5, cursor: cutout ? 'pointer' : 'not-allowed' }}>
                  <Download size={16} /> PNG
                </button>
                <button onClick={handleReset} title="Reset" style={ghostBtn}>
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 16,
                  color: 'var(--color-error)',
                  fontSize: 12.5,
                  fontFamily: 'var(--font-body)',
                }}
              >
                <AlertTriangle size={15} /> {error}
              </div>
            )}

            <div
              style={{
                marginTop: 18,
                fontSize: 11.5,
                lineHeight: 1.5,
                color: 'var(--color-ink-muted)',
                fontFamily: 'var(--font-body)',
              }}
            >
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
