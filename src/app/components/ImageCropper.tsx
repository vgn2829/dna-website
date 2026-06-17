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

interface CropConfig {
  src: string;
  aspect?: number;
  ratioPresets?: { label: string; value: number }[];
}

export function openCropModal(
  file: File,
  type: 'artwork' | 'team'
): Promise<Blob | null> {
  return new Promise((resolve) => {
    _resolve = resolve;
    const src = URL.createObjectURL(file);
    const config: CropConfig =
      type === 'team'
        ? { src, aspect: 3 / 4 }
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
      URL.revokeObjectURL(src);
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

  useEffect(() => {
    _setOpen = (cfg) => {
      setConfig(cfg);
      setCurrentAspect(cfg?.aspect);
      setCrop(undefined);
      setCompletedCrop(undefined);
    };
    return () => { _setOpen = null; };
  }, []);

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
      URL.revokeObjectURL(config.src);
      setConfig(null);
      if (_resolve) { _resolve(blob); _resolve = null; }
    }, 'image/jpeg', 0.95);
  }, [completedCrop, config]);

  const handleCancel = () => {
    if (config) URL.revokeObjectURL(config.src);
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
        width: '100%', maxWidth: 700,
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

      {/* Crop area */}
      <div style={{ maxWidth: 700, maxHeight: '55vh', overflow: 'hidden', borderRadius: 'var(--radius-xl)' }}>
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
            alt="Crop preview"
            onLoad={onImageLoad}
            style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain', display: 'block' }}
          />
        </ReactCrop>
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
