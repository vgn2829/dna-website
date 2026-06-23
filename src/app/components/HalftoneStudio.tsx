import { useEffect, useRef, useState, useCallback } from 'react';
import { Upload, Download, RotateCcw, Loader2 } from 'lucide-react';
import { processHalftone, HalftoneOptions } from '../lib/halftone-logic';

const DEFAULTS: HalftoneOptions = {
  type: 'lines', contrast: 100, brightness: 100, angle: 45,
  frequency: 10, resolution: 4, minWidth: 0, maxWidth: 1,
  inverted: false, color: '#000000', backgroundColor: '#ffffff',
};

export function HalftoneStudio() {
  const [settings, setSettings] = useState<HalftoneOptions>(DEFAULTS);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const update = (p: Partial<HalftoneOptions>) => setSettings(s => ({ ...s, ...p }));

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setLoading(true);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { setImg(image); URL.revokeObjectURL(url); setLoading(false); };
    image.onerror = () => { setLoading(false); URL.revokeObjectURL(url); };
    image.src = url;
  }, []);

  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    processHalftone(ctx, canvas.width, canvas.height, data, settings);
  }, [img, settings]);

  const download = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = 'halftone.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  const Slider = ({ label, val, min, max, step, suffix, onChange }: {
    label: string; val: number; min: number; max: number;
    step: number; suffix: string; onChange: (v: number) => void;
  }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>{val}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--color-brand)', cursor: 'pointer' }} />
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 16,
      width: '100%', maxWidth: 1200, margin: '0 auto',
    }} className="lg:flex-row">
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
        width: '100%', flexShrink: 0,
        borderRadius: 'var(--radius-xl)', background: 'var(--color-surface-1)',
        border: '1px solid var(--color-hairline)', padding: 20,
      }} className="lg:w-80">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)', marginBottom: 4 }}>Halftone</h3>
        <p style={{ fontSize: 12, color: 'var(--color-ink-muted)', marginBottom: 20, fontFamily: 'var(--font-body)' }}>Convert images into halftone patterns.</p>

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
          <input type="checkbox" checked={settings.inverted} onChange={e => update({ inverted: e.target.checked })} style={{ accentColor: 'var(--color-brand)', width: 16, height: 16, cursor: 'pointer' }} />
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {(['color', 'backgroundColor'] as const).map(key => (
            <div key={key} style={{ flex: 1 }}>
              <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', display: 'block', marginBottom: 6, fontFamily: 'var(--font-body)' }}>{key === 'color' ? 'Foreground' : 'Background'}</span>
              <input type="color" value={settings[key]} onChange={e => update({ [key]: e.target.value })}
                style={{ width: '100%', height: 34, border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSettings(DEFAULTS)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
            <RotateCcw size={14} /> Reset
          </button>
          <button onClick={download} disabled={!img}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--color-brand)', color: '#fff', fontSize: 13, cursor: img ? 'pointer' : 'not-allowed', opacity: img ? 1 : 0.5, fontFamily: 'var(--font-body)' }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>
    </div>
  );
}
