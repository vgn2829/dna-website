import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, X, CircleDot, Repeat, Maximize2, Loader2, AlertTriangle, Info } from 'lucide-react';
import { useVectorize } from './svg-converter/useVectorize';
import { PRESETS, type PresetId } from './svg-converter/presets';
import type { TracerConfig } from './svg-converter/types';

const MAX_DIM = 1000;

// Parse the pixel dimensions of an SVG, preferring explicit numeric width/height,
// falling back to the viewBox. Returns null when neither yields usable dimensions.
function parseSvgSize(svg: string): { w: number; h: number } | null {
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const el = doc.querySelector('svg');
    if (!el) return null;
    const numeric = (v: string | null) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
    const w = numeric(el.getAttribute('width'));
    const h = numeric(el.getAttribute('height'));
    if (w > 0 && h > 0) return { w, h };
    const vb = el.getAttribute('viewBox');
    if (vb) {
      const p = vb.split(/[\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] };
    }
  } catch {
    /* malformed SVG — fall through to null */
  }
  return null;
}

export function SvgConverter() {
  const [mode, setMode] = useState<'toSvg' | 'toRaster'>('toSvg');

  // ── Image → SVG state ──────────────────────────────────────────────
  const [traceEngine, setTraceEngine] = useState<'line' | 'vector'>('line');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [svgData, setSvgData] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [threshold, setThreshold] = useState(128);
  const [useFill, setUseFill] = useState(false);
  const [useInvert, setUseInvert] = useState(false);
  const [useDilate, setUseDilate] = useState(false);
  const [rectCount, setRectCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Mirrors traceEngine for the async callbacks below (img.onload, the
  // awaited vectorize() promise): both run uncancelled, so if the user
  // switches engines while one is in flight, its late result must not
  // overwrite the other engine's now-displayed output.
  const traceEngineRef = useRef(traceEngine);
  useEffect(() => { traceEngineRef.current = traceEngine; }, [traceEngine]);

  // ── Vector Trace (VTracer) state ─────────────────────────────────────
  const [preset, setPreset] = useState<PresetId>('photo');
  const [tracerBinary, setTracerBinary] = useState(false);
  const [tracerPathMode, setTracerPathMode] = useState<TracerConfig['mode']>('spline');
  const [tracerFilterSpeckle, setTracerFilterSpeckle] = useState(PRESETS.photo.filterSpeckle);
  const [tracerCornerThreshold, setTracerCornerThreshold] = useState(PRESETS.photo.cornerThreshold);
  const [tracerColorPrecision, setTracerColorPrecision] = useState(PRESETS.photo.colorPrecision);
  const [shapeCount, setShapeCount] = useState(0);
  const { status: vectorizeStatus, error: vectorizeError, vectorize, reset: resetVectorize } = useVectorize();

  const switchEngine = (engine: 'line' | 'vector') => {
    setTraceEngine(engine);
    setSvgData(null);
    setRectCount(0);
    setShapeCount(0);
  };

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    const p = PRESETS[id];
    setTracerBinary(p.binary);
    setTracerPathMode(p.mode);
    setTracerFilterSpeckle(p.filterSpeckle);
    setTracerCornerThreshold(p.cornerThreshold);
    setTracerColorPrecision(p.colorPrecision);
  };

  // ── SVG → raster state ─────────────────────────────────────────────
  const [svgText, setSvgText] = useState<string | null>(null);
  const [svgDims, setSvgDims] = useState<{ w: number; h: number } | null>(null);
  const [rasterUrl, setRasterUrl] = useState<string | null>(null);
  const [rasterInfo, setRasterInfo] = useState<{ w: number; h: number; size: string } | null>(null);
  const [rasterFormat, setRasterFormat] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [rasterQuality, setRasterQuality] = useState(92);
  const [rasterScale, setRasterScale] = useState(100);
  const [isRasterizing, setIsRasterizing] = useState(false);
  const svgFileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageUrl(URL.createObjectURL(file));
      setSvgData(null);
      setRectCount(0);
      setShapeCount(0);
      resetVectorize();
    }
  };

  const processImage = useCallback(() => {
    if (!imageUrl || !canvasRef.current) return;
    setIsProcessing(true);
    setTimeout(() => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (Math.max(w, h) > MAX_DIM) {
          const scale = MAX_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;

        const edgePixels: [number, number][] = [];
        const allDarkPixels: [number, number][] = [];
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            const isDark = useInvert ? gray >= threshold : gray < threshold;
            if (isDark) {
              allDarkPixels.push([x, y]);
              const nb = (dx: number, dy: number) => {
                const nIdx = ((y + dy) * w + (x + dx)) * 4;
                const ng = (data[nIdx] + data[nIdx + 1] + data[nIdx + 2]) / 3;
                return useInvert ? ng < threshold : ng >= threshold;
              };
              if (nb(-1, 0) || nb(1, 0) || nb(0, -1) || nb(0, 1)) edgePixels.push([x, y]);
            }
          }
        }

        let pixels = useFill ? allDarkPixels : edgePixels;
        if (useDilate && !useFill) {
          const set = new Set<string>();
          for (const [x, y] of pixels) {
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) set.add(`${x + dx},${y + dy}`);
          }
          pixels = Array.from(set).map(k => k.split(',').map(Number) as [number, number]);
        }

        const rects = pixels.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`);
        const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects.join('')}</g></svg>`;
        setIsProcessing(false);
        // The user may have switched to Vector Trace while this was in
        // flight — don't let a late result overwrite its output.
        if (traceEngineRef.current !== 'line') return;
        setRectCount(rects.length);
        setSvgData(svg);
      };
      img.onerror = () => setIsProcessing(false);
      img.src = imageUrl;
    }, 10);
  }, [imageUrl, threshold, useFill, useInvert, useDilate]);

  const vectorizeImage = useCallback(() => {
    if (!imageUrl || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const img = new Image();
    img.onload = async () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      const config: TracerConfig = {
        binary: tracerBinary,
        mode: tracerPathMode,
        hierarchical: 'stacked',
        filterSpeckle: tracerFilterSpeckle,
        colorPrecision: tracerColorPrecision,
        layerDifference: PRESETS[preset].layerDifference,
        cornerThreshold: tracerCornerThreshold,
        lengthThreshold: PRESETS[preset].lengthThreshold,
        spliceThreshold: PRESETS[preset].spliceThreshold,
        maxIterations: PRESETS[preset].maxIterations,
        pathPrecision: PRESETS[preset].pathPrecision,
      };

      try {
        const svg = await vectorize(imageData, config);
        // The user may have switched to Line Trace while this was in
        // flight — don't let a late result overwrite its output.
        if (traceEngineRef.current !== 'vector') return;
        setSvgData(svg);
        setShapeCount((svg.match(/<(path|polygon|rect)[\s>]/g) ?? []).length);
      } catch {
        /* error surfaced via vectorizeError from the hook */
      }
    };
    img.onerror = () => { /* image failed to (re)load — vectorizeStatus stays idle */ };
    img.src = imageUrl;
  }, [imageUrl, tracerBinary, tracerPathMode, tracerFilterSpeckle, tracerCornerThreshold, tracerColorPrecision, preset, vectorize]);

  const downloadSvg = () => {
    if (!svgData) return;
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = traceEngine === 'vector' ? 'vector-trace.svg' : 'line-drawing.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setImageUrl(null); setSvgData(null); setRectCount(0); setShapeCount(0);
    resetVectorize();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── SVG → raster handlers ──────────────────────────────────────────
  const handleSvgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      setSvgText(text);
      setSvgDims(parseSvgSize(text));
      if (rasterUrl) URL.revokeObjectURL(rasterUrl);
      setRasterUrl(null);
      setRasterInfo(null);
    };
    reader.readAsText(file);
  };

  const rasterize = useCallback(() => {
    if (!svgText || !canvasRef.current) return;
    setIsRasterizing(true);
    const dims = svgDims || parseSvgSize(svgText) || { w: 1024, h: 1024 };
    const w = Math.max(1, Math.round(dims.w * rasterScale / 100));
    const h = Math.max(1, Math.round(dims.h * rasterScale / 100));
    // Normalise the SVG to explicit pixel dimensions so browsers that ignore a
    // bare viewBox (0×0 intrinsic size) still rasterise at the intended scale.
    let normalized = svgText;
    try {
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const el = doc.querySelector('svg');
      if (el) {
        el.setAttribute('width', String(w));
        el.setAttribute('height', String(h));
        normalized = new XMLSerializer().serializeToString(el);
      }
    } catch {
      /* keep original markup */
    }
    const blob = new Blob([normalized], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      // JPEG has no alpha channel — flatten transparency onto white so it
      // doesn't render as black.
      if (rasterFormat === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const q = rasterFormat === 'image/png' ? 1 : rasterQuality / 100;
      canvas.toBlob(b => {
        if (!b) { setIsRasterizing(false); return; }
        setRasterUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(b); });
        setRasterInfo({ w, h, size: (b.size / 1024).toFixed(1) });
        setIsRasterizing(false);
      }, rasterFormat, q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setIsRasterizing(false); };
    img.src = url;
  }, [svgText, svgDims, rasterScale, rasterFormat, rasterQuality]);

  const downloadRaster = () => {
    if (!rasterUrl) return;
    const a = document.createElement('a');
    a.href = rasterUrl;
    a.download = `image.${rasterFormat === 'image/jpeg' ? 'jpg' : 'png'}`;
    a.click();
  };

  const resetRaster = () => {
    setSvgText(null); setSvgDims(null);
    if (rasterUrl) URL.revokeObjectURL(rasterUrl);
    setRasterUrl(null); setRasterInfo(null);
    if (svgFileRef.current) svgFileRef.current.value = '';
  };

  const card = {
    borderRadius: 'var(--radius-xl)', background: 'var(--color-surface-1)',
    border: '1px solid var(--color-hairline)', overflow: 'hidden',
  } as const;
  const cardHead = {
    padding: '10px 16px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
    textTransform: 'uppercase' as const, color: 'var(--color-ink-muted)',
    borderBottom: '1px solid var(--color-hairline)', fontFamily: 'var(--font-body)',
  } as const;
  const effBtn = (active: boolean) => ({
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '10px 0', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    border: '1px solid var(--color-hairline)',
    background: active ? 'var(--color-brand)' : 'transparent',
    color: active ? '#fff' : 'var(--color-ink-muted)',
  });
  const modeBtn = (active: boolean) => ({
    padding: '8px 18px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
    border: '1px solid var(--color-hairline)',
    background: active ? 'var(--color-brand)' : 'transparent',
    color: active ? '#fff' : 'var(--color-ink-muted)',
    fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)',
  });
  const pill = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
    border: '1px solid var(--color-hairline)',
    background: active ? 'var(--color-brand)' : 'transparent',
    color: active ? '#fff' : 'var(--color-ink-muted)',
    fontSize: 12, fontWeight: active ? 600 : 500, fontFamily: 'var(--font-body)',
  });

  return (
    <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
        <button onClick={() => setMode('toSvg')} style={modeBtn(mode === 'toSvg')}>Image → SVG</button>
        <button onClick={() => setMode('toRaster')} style={modeBtn(mode === 'toRaster')}>SVG → Image</button>
      </div>

      {mode === 'toSvg' ? (
        !imageUrl ? (
          <label style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, cursor: 'pointer', color: 'var(--color-ink-muted)', padding: 40 }}>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileUpload} />
            <Upload size={32} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontFamily: 'var(--font-body)' }}>Select an image (high-contrast works best)</div>
          </label>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              <div style={card}>
                <div style={cardHead}>Original</div>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
                  <img src={imageUrl} alt="Original" style={{ maxWidth: '100%', maxHeight: 440, objectFit: 'contain', borderRadius: 'var(--radius-md)' }} />
                </div>
              </div>
              <div style={card}>
                <div style={cardHead}>SVG Output</div>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
                  {(traceEngine === 'line' ? isProcessing : vectorizeStatus === 'processing') ? (
                    <Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />
                  ) : svgData ? (
                    <div className="svg-output-preview" dangerouslySetInnerHTML={{ __html: svgData }} />
                  ) : (
                    <span style={{ color: 'var(--color-ink-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>No output yet</span>
                  )}
                </div>
              </div>
            </div>

            {traceEngine === 'line' && rectCount > 40000 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                <AlertTriangle size={15} /> Large output ({rectCount.toLocaleString()} shapes). The SVG may be slow to open. Try a higher threshold or a simpler image.
              </div>
            )}

            {traceEngine === 'vector' && vectorizeError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                <AlertTriangle size={15} /> Vectorize failed: {vectorizeError}
              </div>
            )}

            {traceEngine === 'vector' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
                <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Runs on your device — the image never leaves it. Vector Trace works best on <strong>logos, line art,
                  and flat-color images</strong>. Photos with gradients or soft shadows will look posterized or produce
                  many small shapes — try <strong>Line Trace</strong> for pure line-art photos, or simplify the source
                  image first.
                </span>
              </div>
            )}

            <div style={{ ...card, padding: 20 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <button onClick={() => switchEngine('line')} style={pill(traceEngine === 'line')}>Line Trace</button>
                <button onClick={() => switchEngine('vector')} style={pill(traceEngine === 'vector')}>Vector Trace</button>
              </div>

              {traceEngine === 'line' ? (
                <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 18 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Threshold: {threshold}</label>
                    <input type="range" min={0} max={255} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Effects</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setUseFill(!useFill)} title="Fill" style={effBtn(useFill)}><CircleDot size={18} /></button>
                      <button onClick={() => setUseInvert(!useInvert)} title="Invert" style={effBtn(useInvert)}><Repeat size={18} /></button>
                      <button onClick={() => setUseDilate(!useDilate)} title="Thicken" style={effBtn(useDilate)}><Maximize2 size={18} /></button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 18 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Preset</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => applyPreset('photo')} style={pill(preset === 'photo')}>Photo</button>
                      <button onClick={() => applyPreset('lineArt')} style={pill(preset === 'lineArt')}>Line Art</button>
                      <button onClick={() => applyPreset('pixelArt')} style={pill(preset === 'pixelArt')}>Pixel Art</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Color mode</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setTracerBinary(false)} style={pill(!tracerBinary)}>Color</button>
                        <button onClick={() => setTracerBinary(true)} style={pill(tracerBinary)}>Binary</button>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Path style</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setTracerPathMode('spline')} style={pill(tracerPathMode === 'spline')}>Spline</button>
                        <button onClick={() => setTracerPathMode('polygon')} style={pill(tracerPathMode === 'polygon')}>Polygon</button>
                        <button onClick={() => setTracerPathMode('pixel')} style={pill(tracerPathMode === 'pixel')}>Pixel</button>
                      </div>
                    </div>
                  </div>
                  <details>
                    <summary style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Advanced</summary>
                    <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Speckle filter: {tracerFilterSpeckle}</label>
                        <input type="range" min={0} max={32} value={tracerFilterSpeckle} onChange={e => setTracerFilterSpeckle(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Corner threshold: {tracerCornerThreshold}°</label>
                        <input type="range" min={0} max={180} value={tracerCornerThreshold} onChange={e => setTracerCornerThreshold(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Color precision: {tracerColorPrecision}</label>
                        <input type="range" min={0} max={7} value={tracerColorPrecision} onChange={e => setTracerColorPrecision(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
                      </div>
                    </div>
                  </details>
                  {svgData && shapeCount > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>{shapeCount.toLocaleString()} shapes</span>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                {traceEngine === 'line' ? (
                  <button onClick={processImage} disabled={isProcessing}
                    style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--color-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1, fontFamily: 'var(--font-body)' }}>
                    {isProcessing ? 'Processing…' : 'Convert to SVG'}
                  </button>
                ) : (
                  <button onClick={vectorizeImage} disabled={vectorizeStatus === 'processing'}
                    style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--color-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: vectorizeStatus === 'processing' ? 'not-allowed' : 'pointer', opacity: vectorizeStatus === 'processing' ? 0.6 : 1, fontFamily: 'var(--font-body)' }}>
                    {vectorizeStatus === 'processing' ? 'Vectorizing…' : 'Vectorize'}
                  </button>
                )}
                {svgData && (
                  <button onClick={downloadSvg} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                    <Download size={16} /> Download
                  </button>
                )}
                <button onClick={reset} title="Reset" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink)', cursor: 'pointer' }}>
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        )
      ) : (
        !svgText ? (
          <label style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, cursor: 'pointer', color: 'var(--color-ink-muted)', padding: 40 }}>
            <input ref={svgFileRef} type="file" accept="image/svg+xml,.svg" hidden onChange={handleSvgUpload} />
            <Upload size={32} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontFamily: 'var(--font-body)' }}>Select an SVG file to rasterize</div>
          </label>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              <div style={card}>
                <div style={{ ...cardHead, display: 'flex', justifyContent: 'space-between' }}>
                  <span>SVG Input</span>
                  {svgDims && <span style={{ fontFamily: 'var(--font-mono)', textTransform: 'none', letterSpacing: 0 }}>{svgDims.w}×{svgDims.h}</span>}
                </div>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
                  <div className="svg-output-preview" dangerouslySetInnerHTML={{ __html: svgText }} />
                </div>
              </div>
              <div style={card}>
                <div style={{ ...cardHead, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Raster Output</span>
                  {rasterInfo && <span style={{ fontFamily: 'var(--font-mono)', textTransform: 'none', letterSpacing: 0 }}>{rasterInfo.w}×{rasterInfo.h} · {rasterInfo.size}KB</span>}
                </div>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
                  {isRasterizing ? (
                    <Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />
                  ) : rasterUrl ? (
                    <img src={rasterUrl} alt="Raster output" style={{ maxWidth: '100%', maxHeight: 440, objectFit: 'contain', borderRadius: 'var(--radius-md)' }} />
                  ) : (
                    <span style={{ color: 'var(--color-ink-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>No output yet</span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ ...card, padding: 20 }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Format</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setRasterFormat('image/png')} style={pill(rasterFormat === 'image/png')}>PNG</button>
                    <button onClick={() => setRasterFormat('image/jpeg')} style={pill(rasterFormat === 'image/jpeg')}>JPG</button>
                  </div>
                </div>
                {rasterFormat === 'image/jpeg' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Quality — {rasterQuality}%</label>
                    <input type="range" min={10} max={100} value={rasterQuality} onChange={e => setRasterQuality(Number(e.target.value))} style={{ width: 140, accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Scale — {rasterScale}%</label>
                  <input type="range" min={10} max={400} value={rasterScale} onChange={e => setRasterScale(Number(e.target.value))} style={{ width: 140, accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={rasterize} disabled={isRasterizing}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--color-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: isRasterizing ? 'not-allowed' : 'pointer', opacity: isRasterizing ? 0.6 : 1, fontFamily: 'var(--font-body)' }}>
                  {isRasterizing ? 'Rendering…' : 'Convert to Image'}
                </button>
                {rasterUrl && (
                  <button onClick={downloadRaster} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                    <Download size={16} /> Download
                  </button>
                )}
                <button onClick={resetRaster} title="Reset" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink)', cursor: 'pointer' }}>
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
