import { useState, useRef, useCallback, useEffect } from 'react';
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

// Module-level singleton — survives tab switches, works across any component
let _resolve: ((blob: Blob | null) => void) | null = null;
let _setOpen: ((config: CropConfig | null) => void) | null = null;
let _isObjectUrl = false;

interface CropConfig {
  src: string;
  aspect?: number;
  ratioPresets?: { label: string; value: number }[];
  showCardPreview?: boolean;
  cardLabel?: string;
}

export function openCropModal(
  fileOrUrl: File | string,
  type: 'artwork' | 'team'
): Promise<Blob | null> {
  if (_resolve !== null) {
    console.warn('ImageCropper: crop already in progress');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    _resolve = resolve;
    const isObjectUrl = typeof fileOrUrl !== 'string';
    const rawSrc = isObjectUrl ? URL.createObjectURL(fileOrUrl as File) : fileOrUrl as string;
    const src = (!isObjectUrl && rawSrc.includes('supabase.co')) ? `${rawSrc}?t=${Date.now()}` : rawSrc;
    _isObjectUrl = isObjectUrl;
    const config: CropConfig =
      type === 'team'
        ? {
            src,
            aspect: 3 / 4,
            showCardPreview: true,
            cardLabel: 'Card Preview',
          }
        : {
            src,
            ratioPresets: [
              { label: '3:4', value: 3 / 4 },
              { label: '1:1', value: 1 },
              { label: '4:5', value: 4 / 5 },
              { label: '2:3', value: 2 / 3 },
            ],
          };
    if (_setOpen) {
      _setOpen(config);
    } else {
      if (isObjectUrl) URL.revokeObjectURL(src);
      resolve(null);
    }
  });
}

function centerAspectCrop(w: number, h: number, aspect: number) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, w, h),
    w, h
  );
}

export function ImageCropperPortal() {
  const [config, setConfig] = useState<CropConfig | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [currentAspect, setCurrentAspect] = useState<number | undefined>();
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    _setOpen = (cfg) => {
      setConfig(cfg);
      setCurrentAspect(cfg?.aspect);
      setCrop(undefined);
      setCompletedCrop(undefined);
    };
    return () => { _setOpen = null; };
  }, []);

  useEffect(() => {
    if (!completedCrop || !imgRef.current || !previewCanvasRef.current) return;
    if (!config?.showCardPreview) return;

    const image = imgRef.current;
    const canvas = previewCanvasRef.current;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    canvas.width = 120;
    canvas.height = 160;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0, 0,
      120, 160
    );
  }, [completedCrop, config]);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
      const asp = currentAspect ?? w / h;
      setCrop(centerAspectCrop(w, h, asp));
    },
    [currentAspect]
  );

  const handleRatioChange = (asp: number | undefined) => {
    setCurrentAspect(asp);
    if (imgRef.current) {
      const { naturalWidth: w, naturalHeight: h } = imgRef.current;
      setCrop(centerAspectCrop(w, h, asp ?? w / h));
    }
  };

  const handleApply = useCallback(async () => {
    const image = imgRef.current;
    if (!image || !completedCrop || !config) return;
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width  = completedCrop.width  * scaleX;
    canvas.height = completedCrop.height * scaleY;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(
      image,
      completedCrop.x * scaleX, completedCrop.y * scaleY,
      completedCrop.width * scaleX, completedCrop.height * scaleY,
      0, 0, canvas.width, canvas.height
    );
    canvas.toBlob((blob) => {
      if (_isObjectUrl) URL.revokeObjectURL(config.src);
      setConfig(null);
      if (_resolve) { _resolve(blob); _resolve = null; }
    }, 'image/jpeg', 0.95);
  }, [completedCrop, config]);

  const handleCancel = () => {
    if (config && _isObjectUrl) URL.revokeObjectURL(config.src);
    setConfig(null);
    if (_resolve) { _resolve(null); _resolve = null; }
  };

  if (!config) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, gap: 16,
    }}>
      {/* Header */}
      <div style={{
        width: '100%', maxWidth: 900,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 4,
      }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', margin: 0, fontFamily: 'var(--font-body)' }}>
            Crop & Reframe
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-ink-muted)', margin: '4px 0 0', fontFamily: 'var(--font-body)' }}>
            Drag to reposition · drag corners to resize
          </p>
        </div>
        <button onClick={handleCancel} style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--color-surface-2)',
          border: 'none', cursor: 'pointer',
          color: 'var(--color-ink)', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>

      {/* Ratio presets */}
      {config.ratioPresets && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => handleRatioChange(undefined)} style={{
            padding: '5px 14px', borderRadius: 'var(--radius-pill)',
            border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            fontFamily: 'var(--font-body)',
            background: currentAspect === undefined ? 'var(--color-inverse-canvas)' : 'var(--color-surface-2)',
            color: currentAspect === undefined ? 'var(--color-canvas)' : 'var(--color-ink-muted)',
          }}>Free</button>
          {config.ratioPresets.map(p => (
            <button key={p.label} onClick={() => handleRatioChange(p.value)} style={{
              padding: '5px 14px', borderRadius: 'var(--radius-pill)',
              border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              fontFamily: 'var(--font-body)',
              background: currentAspect === p.value ? 'var(--color-inverse-canvas)' : 'var(--color-surface-2)',
              color: currentAspect === p.value ? 'var(--color-canvas)' : 'var(--color-ink-muted)',
            }}>{p.label}</button>
          ))}
        </div>
      )}

      {/* Crop area + optional card preview */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', maxWidth: 900, width: '100%' }}>
        {/* Left: crop area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ maxHeight: '55vh', overflow: 'hidden', borderRadius: 'var(--radius-xl)' }}>
            <ReactCrop
              crop={crop}
              onChange={c => setCrop(c)}
              onComplete={c => setCompletedCrop(c)}
              aspect={currentAspect}
              style={{ maxHeight: '55vh' }}
            >
              <img
                ref={imgRef}
                src={config.src}
                crossOrigin="anonymous"
                alt="Crop preview"
                onLoad={onImageLoad}
                style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain', display: 'block' }}
              />
            </ReactCrop>
          </div>
        </div>

        {/* Right: live card preview (team only) */}
        {config.showCardPreview && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-ink-muted)', margin: 0, fontFamily: 'var(--font-body)' }}>
              {config.cardLabel ?? 'Card Preview'}
            </p>
            <div style={{ width: 140, borderRadius: 'var(--radius-xl)', overflow: 'hidden', background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)' }}>
              <div style={{ width: 140, height: 186, overflow: 'hidden', background: 'var(--color-surface-2)' }}>
                <canvas
                  ref={previewCanvasRef}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ height: 10, width: '70%', borderRadius: 4, background: 'var(--color-surface-2)', marginBottom: 6 }} />
                <div style={{ height: 8, width: '50%', borderRadius: 4, background: 'var(--color-surface-2)' }} />
              </div>
            </div>
            <p style={{ fontSize: 10, color: 'var(--color-ink-muted)', margin: 0, fontFamily: 'var(--font-body)', textAlign: 'center', maxWidth: 140, lineHeight: 1.4 }}>
              Drag to position the photo in the card
            </p>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={handleCancel} className="btn-secondary" style={{ minWidth: 100 }}>
          Cancel
        </button>
        <button onClick={handleApply} className="btn-primary" style={{ minWidth: 100 }} disabled={!completedCrop}>
          Apply Crop
        </button>
      </div>
    </div>
  );
}
