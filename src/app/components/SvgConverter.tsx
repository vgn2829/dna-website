import { useState, useRef, useCallback } from 'react';
import { Upload, Download, X, CircleDot, Repeat, Maximize2, Loader2, AlertTriangle } from 'lucide-react';

const MAX_DIM = 1000;

export function SvgConverter() {
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageUrl(URL.createObjectURL(file));
      setSvgData(null);
      setRectCount(0);
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
        setRectCount(rects.length);
        setSvgData(svg);
        setIsProcessing(false);
      };
      img.onerror = () => setIsProcessing(false);
      img.src = imageUrl;
    }, 10);
  }, [imageUrl, threshold, useFill, useInvert, useDilate]);

  const downloadSvg = () => {
    if (!svgData) return;
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'line-drawing.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setImageUrl(null); setSvgData(null); setRectCount(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  return (
    <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {!imageUrl ? (
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
                {isProcessing ? (
                  <Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />
                ) : svgData ? (
                  <div className="svg-output-preview" dangerouslySetInnerHTML={{ __html: svgData }} />
                ) : (
                  <span style={{ color: 'var(--color-ink-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>No output yet</span>
                )}
              </div>
            </div>
          </div>

          {rectCount > 40000 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
              <AlertTriangle size={15} /> Large output ({rectCount.toLocaleString()} shapes). The SVG may be slow to open. Try a higher threshold or a simpler image.
            </div>
          )}

          <div style={{ ...card, padding: 20 }}>
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
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={processImage} disabled={isProcessing}
                style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--color-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1, fontFamily: 'var(--font-body)' }}>
                {isProcessing ? 'Processing…' : 'Convert to SVG'}
              </button>
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
      )}
    </div>
  );
}
