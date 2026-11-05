import { readImageDraft, saveImageDraft, clearImageDraft, type ImageDraft } from '../lib/image-drafts';
import { useStudioDraft } from '../lib/studio-draft';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Upload, Download, RotateCcw, Loader2 } from 'lucide-react';
import type { HalftoneOptions } from '../lib/halftone-logic';
import { renderHalftone } from '../lib/halftone-job';
import { downloadBlob, isAcceptableImage } from './background-removal/compositing';

const MAX_WORK = 700;

const Slider = ({ label, val, min, max, step, suffix, onChange }: {
  label: string; val: number; min: number; max: number;
  step: number; suffix: string; onChange: (v: number) => void;
}) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>{val}{suffix}</span>
    </div>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={val}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
  </div>
);

const DEFAULTS: HalftoneOptions = {
  type: 'lines', contrast: 100, brightness: 100, angle: 45,
  frequency: 10, resolution: 4, minWidth: 0, maxWidth: 1,
  inverted: false, color: '#000000', backgroundColor: '#ffffff',
};

export function HalftoneStudio() {
  const [settings, setSettings] = useStudioDraft<HalftoneOptions>('halftone-settings', DEFAULTS, (v): v is HalftoneOptions => {
    if (!v || typeof v !== 'object') return false;
    const o = v as HalftoneOptions;
    return ['lines', 'dots', 'squares'].includes(o.type) && ['frequency', 'resolution', 'angle', 'brightness', 'contrast', 'minWidth', 'maxWidth'].every(k => typeof o[k as keyof HalftoneOptions] === 'number' && Number.isFinite(o[k as keyof HalftoneOptions])) && o.angle >= 0 && o.angle <= 90 && o.contrast >= 0 && o.contrast <= 200 && o.brightness >= 0 && o.brightness <= 200 && o.minWidth >= 0 && o.maxWidth <= 1 && o.minWidth <= o.maxWidth && o.frequency >= 4 && o.frequency <= 50 && o.resolution >= 1 && o.resolution <= 20 && typeof o.inverted === 'boolean' && /^#[0-9a-f]{6}$/i.test(o.color) && /^#[0-9a-f]{6}$/i.test(o.backgroundColor);
  });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportJob = useRef<AbortController | null>(null);
  const sourceToken = useRef(0);
  const pendingSource = useRef<{image: HTMLImageElement; url: string} | null>(null);
  const releasePendingSource = useCallback(() => {const pending=pendingSource.current;pendingSource.current=null;if(pending){pending.image.onload=null;pending.image.onerror=null;pending.image.src='';URL.revokeObjectURL(pending.url);}},[]);
  const draftRef = useRef<ImageDraft | null>(null);
  const [retain, setRetain] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const srcDataRef = useRef<ImageData | null>(null);

  const update = (p: Partial<HalftoneOptions>) => setSettings(s => ({ ...s, ...p }));

  const loadFile = useCallback((file: File) => {
    const token = ++sourceToken.current;
    releasePendingSource();
    exportJob.current?.abort(); setExporting(''); setError(null);
    if (!isAcceptableImage(file)) { setError('Use PNG, JPEG, WebP, GIF or BMP under 25 MB.'); return; }
    setLoading(true);
    const url = URL.createObjectURL(file);
    const image = new Image();
    pendingSource.current={image,url};
    image.onload = () => {
      if(pendingSource.current?.image===image)pendingSource.current=null;
      URL.revokeObjectURL(url);
      if (token !== sourceToken.current) return;
      if (image.naturalWidth * image.naturalHeight > 16_000_000 || Math.max(image.naturalWidth, image.naturalHeight) > 8192) {
        setError('Image limit: 16 megapixels and 8192px per edge.'); setLoading(false); return;
      }
      draftRef.current = { version: 1, file, name: file.name, retain: draftRef.current?.retain || false, saved: Date.now() };
    void saveImageDraft("halftone", draftRef.current);
      setImg(image); srcDataRef.current = null; setLoading(false);
    };
    image.onerror = () => { if(pendingSource.current?.image===image)pendingSource.current=null; URL.revokeObjectURL(url); if (token === sourceToken.current) { setLoading(false); setError('Image could not be decoded.'); } };
    image.src = url;
  }, [releasePendingSource]);

  useEffect(() => {
    let active = true;
    void readImageDraft('halftone').then(draft => {
      if (!active || !draft || sourceToken.current) return;
      setRetain(draft.retain); draftRef.current = draft;
      loadFile(new File([draft.file], draft.name, { type: draft.file.type }));
    });
    return () => { active = false; };
  }, [loadFile]);
  useEffect(() => {
    if (!draftRef.current) return;
    draftRef.current.retain = retain;
    setDraftStatus(retain ? 'Saving device draft…' : 'Image kept for this session');
    void saveImageDraft('halftone', draftRef.current).then(ok => { setDraftStatus(ok ? (retain ? 'Image saved on this device' : 'Image kept for this session') : 'Device storage unavailable'); if (!ok) setError(retain ? 'Device storage unavailable. Draft remains in this session; an older retained image may still exist.' : 'Device storage could not be cleared. A retained image may remain; use Clear image draft or browser site-data settings.'); });
  }, [retain, img]);
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const controller = new AbortController();
    const canvas = canvasRef.current;
    const scale = Math.min(1, MAX_WORK / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    if (!srcDataRef.current) {
      const source = document.createElement('canvas'); source.width = w; source.height = h;
      const ctx = source.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h); srcDataRef.current = ctx.getImageData(0, 0, w, h);
    }
    setPreviewBusy(true);
    const delay = setTimeout(async () => {
      try {
        const blob = await renderHalftone(srcDataRef.current!, settings, 'png', controller.signal);
        const bitmap = await createImageBitmap(blob);
        if (!controller.signal.aborted) { canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); setError(null); setPreviewBusy(false); }
        bitmap.close();
      } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Preview failed'); setPreviewBusy(false); } }
    }, 80);
    return () => { clearTimeout(delay); controller.abort(); };
  }, [img, settings]);

  useEffect(() => () => { ++sourceToken.current; releasePendingSource(); exportJob.current?.abort(); }, [releasePendingSource]);
  const download = async (format: 'png' | 'svg' = 'png') => {
    if (!img) return;
    exportJob.current?.abort(); const controller = new AbortController(); exportJob.current = controller;
    setExporting('Preparing full-resolution source'); setError(null);
    try {
      const source = document.createElement('canvas'); source.width = img.naturalWidth; source.height = img.naturalHeight;
      const ctx = source.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, source.width, source.height);
      const blob = await renderHalftone(pixels, settings, format, controller.signal, setExporting);
      if (!controller.signal.aborted) downloadBlob(blob, `halftone-${source.width}x${source.height}.${format}`);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Export failed'); }
    finally { if (exportJob.current === controller) setExporting(''); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  return (
    <div style={{
      gap: 16,
      width: '100%', maxWidth: 1200, margin: '0 auto',
    }} className="flex flex-col lg:flex-row">
      {/* Canvas area */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        style={{
          flex: 1, minHeight: 320, borderRadius: 'var(--radius-xl)',
          background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden', padding: 24,
        }}
      >
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface-1)', zIndex: 2 }}>
            <Loader2 size={28} style={{ color: 'var(--color-ink-muted)' }} className="animate-spin" />
          </div>
        )}
        {img ? (
          <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', borderRadius: 'var(--radius-md)' }} />
        ) : (
          <label style={{ textAlign: 'center', cursor: 'pointer', color: 'var(--color-ink-muted)' }}>
            <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} />
            <Upload size={32} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontFamily: 'var(--font-body)' }}>Drag an image here or click to upload</div>
          </label>
        )}
      </div>

      {/* Controls */}
      <div style={{
        flexShrink: 0,
        borderRadius: 'var(--radius-xl)', background: 'var(--color-surface-1)',
        border: '1px solid var(--color-hairline)', padding: 20,
      }} className="w-full lg:w-80">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)', marginBottom: 4 }}>Halftone</h3>
        <p style={{ fontSize: 12, color: 'var(--color-ink-muted)', marginBottom: 20, fontFamily: 'var(--font-body)' }}>Linear-light area sampling · ink on opaque paper. Pattern spacing uses a 700px reference edge.</p>
        {img && <p>{img.naturalWidth} × {img.naturalHeight}px export · preview ≤700px</p>}
        {draftStatus && <p role="status">{draftStatus}</p>}
        {error && <p role="alert">{error}</p>}
        {(previewBusy || exporting) && <p role="status">{exporting || 'Rendering preview…'}</p>}
        {exporting && <button onClick={() => { exportJob.current?.abort(); setExporting(''); }}>Cancel export</button>}

        <div style={{ marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', display: 'block', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Style</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['lines', 'dots', 'squares'] as const).map(t => (
              <button key={t} onClick={() => update({ type: t })}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 'var(--radius-sm)', fontSize: 12, textTransform: 'capitalize',
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                  border: '1px solid var(--color-hairline)',
                  background: settings.type === t ? 'var(--color-brand)' : 'transparent',
                  color: settings.type === t ? '#fff' : 'var(--color-ink-muted)',
                }}>{t}</button>
            ))}
          </div>
        </div>

        <Slider label="Angle" val={settings.angle} min={0} max={90} step={1} suffix="°" onChange={v => update({ angle: v })} />
        <Slider label="Spacing" val={settings.frequency} min={4} max={50} step={1} suffix="px" onChange={v => update({ frequency: v })} />
        <Slider label="Detail" val={settings.resolution} min={1} max={20} step={1} suffix="px" onChange={v => update({ resolution: v })} />
        <Slider label="Contrast" val={settings.contrast} min={0} max={200} step={5} suffix="%" onChange={v => update({ contrast: v })} />
        <Slider label="Brightness" val={settings.brightness} min={0} max={200} step={5} suffix="%" onChange={v => update({ brightness: v })} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0 18px' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>Invert</span>
          <input aria-label="Invert tone" type="checkbox" checked={settings.inverted} onChange={e => update({ inverted: e.target.checked })} style={{ accentColor: 'var(--color-brand)', width: 16, height: 16, cursor: 'pointer' }} />
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {(['color', 'backgroundColor'] as const).map(key => (
            <div key={key} style={{ flex: 1 }}>
              <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', display: 'block', marginBottom: 6, fontFamily: 'var(--font-body)' }}>{key === 'color' ? 'Foreground' : 'Background'}</span>
              <input aria-label={key === 'color' ? 'Ink colour' : 'Paper colour'} type="color" value={settings[key]} onChange={e => update({ [key]: e.target.value })}
                style={{ width: '100%', height: 34, border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSettings(DEFAULTS)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
            <RotateCcw size={14} /> Reset
          </button>
          <button onClick={() => download()} disabled={!img || !!exporting}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--color-brand)', color: '#fff', fontSize: 13, cursor: img ? 'pointer' : 'not-allowed', opacity: img ? 1 : 0.5, fontFamily: 'var(--font-body)' }}>
            <Download size={14} /> PNG
          </button>
        </div>
        <label style={{ display: "block", marginTop: 12 }}><input type="checkbox" checked={retain} onChange={e => setRetain(e.target.checked)} /> Keep image on this device for 24 hours</label>
        <button onClick={async () => { ++sourceToken.current; releasePendingSource(); exportJob.current?.abort(); setLoading(false); setExporting(''); draftRef.current = null; srcDataRef.current = null; const ok = await clearImageDraft('halftone'); setImg(null); if (!ok) setError('Device storage could not be cleared. Clear browser site data.'); }}>Clear image draft</button>
        <button disabled={!img || !!exporting} onClick={() => download('svg')} style={{ marginTop: 12 }}>Export vector SVG</button>
        <label style={{ display: 'block', marginTop: 12 }}>Replace image <input aria-label="Replace halftone image" type="file" accept="image/*" onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} /></label>
      </div>
    </div>
  );
}
