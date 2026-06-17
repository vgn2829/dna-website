import { useState, useRef, useCallback } from 'react';
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

interface ImageCropperProps {
  src: string;                    // object URL of selected file
  aspect?: number;                // locked ratio e.g. 3/4 or undefined for free
  ratioPresets?: {                // optional preset buttons
    label: string;
    value: number;
  }[];
  onComplete: (blob: Blob) => void;  // called with cropped image blob
  onCancel: () => void;
}

function centerAspectCrop(
  mediaWidth: number,
  mediaHeight: number,
  aspect: number
) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight
  );
}

export function ImageCropper({
  src,
  aspect,
  ratioPresets,
  onComplete,
  onCancel,
}: ImageCropperProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [currentAspect, setCurrentAspect] = useState<number | undefined>(aspect);
  const imgRef = useRef<HTMLImageElement>(null);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    const asp = currentAspect ?? width / height;
    setCrop(centerAspectCrop(width, height, asp));
  }, [currentAspect]);

  const handleRatioChange = (newAspect: number | undefined) => {
    setCurrentAspect(newAspect);
    if (imgRef.current) {
      const { naturalWidth: w, naturalHeight: h } = imgRef.current;
      const asp = newAspect ?? w / h;
      setCrop(centerAspectCrop(w, h, asp));
    }
  };

  const handleApply = useCallback(async () => {
    const image = imgRef.current;
    if (!image || !completedCrop) return;

    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = completedCrop.width * scaleX;
    canvas.height = completedCrop.height * scaleY;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob((blob) => {
      if (blob) onComplete(blob);
    }, 'image/jpeg', 0.95);
  }, [completedCrop, onComplete]);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 16,
    }}>
      {/* Header */}
      <div style={{
        width: '100%',
        maxWidth: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div>
          <p style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-body)',
            margin: 0,
          }}>
            Crop & Reframe
          </p>
          <p style={{
            fontSize: 12,
            color: 'var(--color-ink-muted)',
            fontFamily: 'var(--font-body)',
            margin: '4px 0 0',
          }}>
            Drag to reposition · drag corners to resize
          </p>
        </div>
        <button
          onClick={onCancel}
          style={{
            width: 32, height: 32,
            borderRadius: '50%',
            background: 'var(--color-surface-2)',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-ink)',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      {/* Ratio presets (only for gallery) */}
      {ratioPresets && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button
            onClick={() => handleRatioChange(undefined)}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
              background: currentAspect === undefined
                ? 'var(--color-inverse-canvas)'
                : 'var(--color-surface-2)',
              color: currentAspect === undefined
                ? 'var(--color-canvas)'
                : 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
            }}
          >
            Free
          </button>
          {ratioPresets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handleRatioChange(preset.value)}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-pill)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                background: currentAspect === preset.value
                  ? 'var(--color-inverse-canvas)'
                  : 'var(--color-surface-2)',
                color: currentAspect === preset.value
                  ? 'var(--color-canvas)'
                  : 'var(--color-ink-muted)',
                fontFamily: 'var(--font-body)',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {/* Crop area */}
      <div style={{
        maxWidth: 700,
        maxHeight: '55vh',
        overflow: 'hidden',
        borderRadius: 'var(--radius-xl)',
      }}>
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
          aspect={currentAspect}
          style={{ maxHeight: '55vh' }}
        >
          <img
            ref={imgRef}
            src={src}
            alt="Crop preview"
            onLoad={onImageLoad}
            style={{
              maxWidth: '100%',
              maxHeight: '55vh',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </ReactCrop>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button
          onClick={onCancel}
          className="btn-secondary"
          style={{ minWidth: 100 }}
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="btn-primary"
          style={{ minWidth: 100 }}
          disabled={!completedCrop}
        >
          Apply Crop
        </button>
      </div>
    </div>
  );
}
