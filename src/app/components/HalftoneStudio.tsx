import { readImageDraft, saveImageDraft, clearImageDraft, type ImageDraft } from '../lib/image-drafts';
import { useStudioDraft } from '../lib/studio-draft';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Upload, Download, RotateCcw, Loader2 } from 'lucide-react';
import type { HalftoneOptions } from '../lib/halftone-logic';
import { renderHalftone } from '../lib/halftone-job';
import { downloadBlob, isAcceptableImage } from './background-removal/compositing';
import { StudioRange } from './studio/StudioRange';
import { Status } from './StudioUI';

const MAX_WORK = 700;

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

  const pickRef = useRef<HTMLInputElement>(null);
  const clearDraft = async () => { ++sourceToken.current; releasePendingSource(); exportJob.current?.abort(); setLoading(false); setExporting(''); draftRef.current = null; srcDataRef.current = null; const ok = await clearImageDraft('halftone'); setImg(null); if (!ok) setError('Device storage could not be cleared. Clear browser site data.'); };

  return (
    <div className="studio-workspace">
      {/* Preview: fixed stage height so renders and status changes never move the controls. */}
      <div
        className="studio-stage is-fixed"
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
      >
        {loading && (
          <div className="studio-stage-overlay" role="status" aria-label="Loading image">
            <Loader2 size={28} className="animate-spin" aria-hidden="true" />
          </div>
        )}
        {img ? (
          <canvas ref={canvasRef} aria-label="Halftone preview" />
        ) : (
          <div className="studio-upload is-bare">
            <input ref={pickRef} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} />
            <Upload size={32} aria-hidden="true" />
            <p>Drag an image here or choose one to start.</p>
            <button type="button" className="btn-secondary" onClick={() => pickRef.current?.click()}>Choose image</button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="studio-controls">
        <div>
          <h2>Halftone</h2>
          <p className="studio-help">Linear-light area sampling · ink on opaque paper. Pattern spacing uses a 700px reference edge.</p>
          {img && <p className="studio-help studio-mono">{img.naturalWidth} × {img.naturalHeight}px export · preview ≤700px</p>}
        </div>
        <Status error={error}>{exporting || (previewBusy ? 'Rendering preview…' : '')}</Status>
        {exporting && <button className="btn-translucent btn-sm" onClick={() => { exportJob.current?.abort(); setExporting(''); }}>Cancel export</button>}

        <div className="studio-group" role="group" aria-labelledby="halftone-style">
          <span className="studio-label" id="halftone-style">Style</span>
          <div className="segmented studio-choice is-fill">
            {(['lines', 'dots', 'squares'] as const).map(t => (
              <button key={t} className="segmented-item" aria-pressed={settings.type === t} onClick={() => update({ type: t })} style={{ textTransform: 'capitalize' }}>{t}</button>
            ))}
          </div>
        </div>

        <StudioRange label="Angle" min={0} max={90} step={1} value={settings.angle} suffix="°" onChange={v => update({ angle: v })} />
        <StudioRange label="Spacing" min={4} max={50} step={1} value={settings.frequency} suffix="px" onChange={v => update({ frequency: v })} />
        <StudioRange label="Detail" min={1} max={20} step={1} value={settings.resolution} suffix="px" onChange={v => update({ resolution: v })} />
        <StudioRange label="Contrast" min={0} max={200} step={5} value={settings.contrast} suffix="%" onChange={v => update({ contrast: v })} />
        <StudioRange label="Brightness" min={0} max={200} step={5} value={settings.brightness} suffix="%" onChange={v => update({ brightness: v })} />

        <label className="studio-check">
          <input aria-label="Invert tone" type="checkbox" checked={settings.inverted} onChange={e => update({ inverted: e.target.checked })} />
          Invert
        </label>

        <div className="studio-inline">
          {(['color', 'backgroundColor'] as const).map(key => (
            <label key={key} className="studio-group" style={{ flex: 1 }}>
              <span className="studio-label">{key === 'color' ? 'Foreground' : 'Background'}</span>
              <input aria-label={key === 'color' ? 'Ink colour' : 'Paper colour'} className="studio-color-input" style={{ width: '100%' }} type="color" value={settings[key]} onChange={e => update({ [key]: e.target.value })} />
            </label>
          ))}
        </div>

        <div className="studio-actions">
          <button className="btn-primary is-grow" onClick={() => download()} disabled={!img || !!exporting}>
            <Download size={14} aria-hidden="true" /> PNG
          </button>
          <button className="btn-translucent is-grow" disabled={!img || !!exporting} onClick={() => download('svg')}>Export vector SVG</button>
          <button className="btn-translucent" onClick={() => setSettings(DEFAULTS)}>
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
        </div>

        <div className="studio-controls-section">
          <label className="studio-group">
            <span className="studio-label">Replace image</span>
            <input aria-label="Replace halftone image" className="studio-file-input" type="file" accept="image/*" onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </label>
          <label className="studio-check"><input type="checkbox" checked={retain} onChange={e => setRetain(e.target.checked)} /> Keep image on this device for 24 hours</label>
          <p className="studio-help studio-status" role="status">{draftStatus}</p>
          <div><button className="btn-translucent btn-sm" onClick={clearDraft}>Clear image draft</button></div>
        </div>
      </div>
    </div>
  );
}
