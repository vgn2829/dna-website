import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ImageOff, Loader2, RotateCw, X } from 'lucide-react';
import { useModalA11y } from './hooks/useModalA11y';
import { usePortalContainer } from './PortalContainer';
import { stepIndex, swipeDirection, type LightboxImage } from '../lib/lightbox';

// ─────────────────────────────────────────────────────────────────────────
// Full-screen image viewer for moodboard references. Previous/next with the
// arrow keys, buttons or a swipe; Home/End jump to the ends; Escape, the close
// button or a click outside the image closes it. Focus is trapped and returned
// to the opener (useModalA11y); the page behind cannot scroll while it's open.
// A broken or slow image shows an in-place state with a retry, never a blank
// box, and the neighbouring images are preloaded so stepping feels instant.
// The caller owns the list; this component never fetches or mutates anything.
// ─────────────────────────────────────────────────────────────────────────

export function ImageLightbox({ items, index, onIndexChange, onClose, label = 'Board images' }: {
  items: readonly LightboxImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  label?: string;
}) {
  const dialogRef = useModalA11y(true, onClose);
  const container = usePortalContainer();
  const count = items.length;
  const current = items[Math.min(Math.max(index, 0), Math.max(count - 1, 0))];
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);   // bump to retry a failed image
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback((delta: number) => { if (count > 1) onIndexChange(stepIndex(index, delta, count)); }, [count, index, onIndexChange]);

  // A different image starts in the loading state (and a retry starts over).
  useEffect(() => { setStatus('loading'); }, [current?.src, attempt]);

  // Body scroll lock for as long as the lightbox is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keyboard: arrows and Home/End. Escape and Tab are handled by useModalA11y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Home' && count > 1) { e.preventDefault(); onIndexChange(0); }
      else if (e.key === 'End' && count > 1) { e.preventDefault(); onIndexChange(count - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, count, onIndexChange]);

  // Preload the neighbours so next/previous don't flash a spinner.
  useEffect(() => {
    if (count < 2) return;
    for (const d of [1, -1]) { const n = items[stepIndex(index, d, count)]; if (n) { const img = new Image(); img.src = n.src; } }
  }, [index, items, count]);

  if (!current) return null;
  const navBtn: React.CSSProperties = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff',
  };

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      onClick={onClose}
      onTouchStart={e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={e => {
        const s = touch.current; touch.current = null; if (!s) return;
        const t = e.changedTouches[0]; const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y);
        if (dir !== 0) go(dir);
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', outline: 'none', touchAction: 'pan-y' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', color: '#fff', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13, fontFamily: 'var(--font-body)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {count > 1 ? `${index + 1} / ${count}` : '1 image'}{current.label ? ` · ${current.label}` : ''}
        </p>
        <button type="button" onClick={onClose} aria-label="Close image viewer" className="touch-target"
          style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.14)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px 16px' }}>
        {status === 'loading' && <Loader2 size={28} aria-label="Loading image" role="img" style={{ position: 'absolute', color: '#fff', animation: 'spin 0.9s linear infinite' }} />}
        {status === 'error' ? (
          <div role="alert" onClick={e => e.stopPropagation()} style={{ color: '#fff', textAlign: 'center', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <ImageOff size={32} aria-hidden="true" />
            <p style={{ margin: 0, fontSize: 14 }}>This image couldn’t be loaded.</p>
            <button type="button" className="btn-translucent btn-sm" onClick={() => setAttempt(a => a + 1)}><RotateCw size={13} aria-hidden="true" /> Try again</button>
          </div>
        ) : (
          <img
            key={`${current.src}#${attempt}`}
            src={current.src}
            alt={current.label ? `${current.label} (${index + 1} of ${count})` : `Board image ${index + 1} of ${count}`}
            draggable={false}
            decoding="async"
            onClick={e => e.stopPropagation()}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', opacity: status === 'ready' ? 1 : 0, transition: 'opacity 0.15s', userSelect: 'none', borderRadius: 'var(--radius-md)' }}
          />
        )}
        {count > 1 && (<>
          <button type="button" aria-label="Previous image" className="touch-target" onClick={e => { e.stopPropagation(); go(-1); }} style={{ ...navBtn, left: 8 }}><ChevronLeft size={22} aria-hidden="true" /></button>
          <button type="button" aria-label="Next image" className="touch-target" onClick={e => { e.stopPropagation(); go(1); }} style={{ ...navBtn, right: 8 }}><ChevronRight size={22} aria-hidden="true" /></button>
        </>)}
      </div>
    </div>,
    container,
  );
}
