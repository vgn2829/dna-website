import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useIsPresent } from 'motion/react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useModalA11y } from './hooks/useModalA11y';
import { usePortalContainer } from './PortalContainer';

// ─────────────────────────────────────────────────────────────────────────
// The artwork preview chrome, shared by the Gallery (ArtworkModal) and the
// Assets library (assets/AssetPreviewModal): a centered two-panel card on
// desktop — media on the left, sized by the artwork's aspect ratio, info on
// the right — and a full-screen sheet with a sticky title bar on phones.
// Escape, backdrop click and the close button dismiss it; clicks inside
// the card never do. Focus moves into the dialog, Tab stays inside it, and
// returns to the opener on close (useModalA11y). Portalled, so a host
// page's stacking context can't trap it under the shell.
//
// The caller owns the content: `media`, the desktop `heading` (left of the
// close button) and `headingExtra` (the row under it), and `children` —
// the rest of the info panel on desktop, everything below the media on
// phones. Pick content per layout with useIsNarrowViewport().
// ─────────────────────────────────────────────────────────────────────────

export function useIsNarrowViewport(breakpoint = 768): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const fn = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, [breakpoint]);
  return narrow;
}

export function ArtworkLightbox({
  label,
  isMobile,
  onClose,
  media,
  mediaLayout = 'media',
  aspectRatio = null,
  heading,
  headingExtra,
  children,
  zIndex = 100,
}: {
  // Accessible name; also the phone title bar.
  label: string;
  isMobile: boolean;
  onClose: () => void;
  media: ReactNode;
  // 'document' (PDF) panels are wider, top-aligned and scroll.
  mediaLayout?: 'media' | 'document';
  aspectRatio?: number | null;
  heading?: ReactNode;
  headingExtra?: ReactNode;
  children?: ReactNode;
  zIndex?: number;
}) {
  // Released as soon as the exit animation starts: a closing dialog no
  // longer takes Escape/Tab, and focus goes back to the opener at once.
  const dialogRef = useModalA11y(useIsPresent(), onClose);
  const container = usePortalContainer();
  const isDocument = mediaLayout === 'document';

  // ── Mobile: full-screen sheet sliding up from bottom ──────────────────────
  if (isMobile) {
    return createPortal(
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        style={{ position: 'fixed', inset: 0, zIndex, background: 'var(--color-surface-1)', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden', outline: 'none' }}
      >
        {/* Sticky header — always reachable */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-hairline)' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
            {label}
          </span>
          <button type="button" onClick={onClose} aria-label="Close preview" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-surface-2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={16} style={{ color: 'var(--color-ink)' }} />
          </button>
        </div>

        {/* Media */}
        <div style={{ width: '100%', flexShrink: 0, height: isDocument ? 'auto' : 'min(60vw, 55vh)', minHeight: isDocument ? '400px' : undefined, background: 'var(--color-canvas)', display: 'flex', alignItems: isDocument ? 'flex-start' : 'center', justifyContent: 'center', overflow: isDocument ? 'visible' : 'hidden', borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0', padding: isDocument ? 12 : 0 }}>
          {media}
        </div>

        {children}
      </motion.div>,
      container
    );
  }

  // ── Desktop: centered floating card ───────────────────────────────────────
  const imagePanelWidth = isDocument ? '62%'
    : aspectRatio === null ? '55%'
    : aspectRatio < 0.8  ? '40%'
    : aspectRatio > 1.3  ? '65%'
    : '50%';

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1024, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'row', background: 'var(--color-surface-1)', borderRadius: 'var(--radius-xxl)', boxShadow: 'var(--shadow-level-2)', outline: 'none' }}
      >
        {/* Media panel */}
        <div style={{ width: imagePanelWidth, flexShrink: 0, background: 'var(--color-canvas)', display: 'flex', alignItems: isDocument ? 'flex-start' : 'center', justifyContent: 'center', padding: 16, minHeight: isDocument ? '600px' : 0, maxHeight: '90vh', borderRadius: 'var(--radius-xl) 0 0 var(--radius-xl)', overflow: isDocument ? 'auto' : 'hidden' }}>
          {media}
        </div>

        {/* Info panel */}
        <div style={{ width: `calc(100% - ${imagePanelWidth})`, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '90vh' }}>
          <div className="p-6" style={{ borderBottom: '1px solid var(--color-hairline-soft)' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">{heading}</div>
              <button type="button" onClick={onClose} aria-label="Close preview" className="btn-icon" style={{ width: 32, height: 32 }}><X size={15} /></button>
            </div>
            {headingExtra}
          </div>
          {children}
        </div>
      </motion.div>
    </motion.div>,
    container
  );
}

// Zoom/pan image viewer for the lightbox's media panel; reports the image's
// natural aspect ratio so the panel can size itself to it.
export function ZoomImage({ src, alt, onAspectRatio }: { src: string; alt: string; onAspectRatio?: (ratio: number) => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [imgError, setImgError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', background: 'var(--color-canvas)', cursor: scale > 1 ? 'grab' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit' }}
      onMouseDown={e => { dragging.current = true; last.current = { x: e.clientX, y: e.clientY }; }}
      onMouseMove={e => { if (!dragging.current) return; setPos(p => ({ x: p.x + e.clientX - last.current.x, y: p.y + e.clientY - last.current.y })); last.current = { x: e.clientX, y: e.clientY }; }}
      onMouseUp={() => { dragging.current = false; }}>
      {imgError ? (
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 13, padding: 24, textAlign: 'center' }}>
          Image could not be loaded
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading="lazy"
          onLoad={e => {
            const img = e.currentTarget;
            if (onAspectRatio && img.naturalWidth && img.naturalHeight) {
              onAspectRatio(img.naturalWidth / img.naturalHeight);
            }
            setLoaded(true);
          }}
          onError={() => setImgError(true)}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
            display: 'block',
            userSelect: 'none',
            opacity: loaded ? 1 : 0,
            transform: `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`,
            transition: dragging.current ? 'none' : 'opacity 0.2s, transform 0.2s',
            borderRadius: 'inherit',
          }}
        />
      )}
      {!imgError && !loaded && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2.5px solid var(--color-hairline)', borderTopColor: 'var(--color-ink-muted)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}
      {!imgError && (
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button type="button" aria-label="Zoom out" onClick={() => setScale(s => Math.max(1, s - 0.5))} className="btn-icon" style={{ width: 32, height: 32 }}><ZoomOut size={13} /></button>
          <button type="button" aria-label="Zoom in" onClick={() => setScale(s => Math.min(4, s + 0.5))} className="btn-icon" style={{ width: 32, height: 32 }}><ZoomIn size={13} /></button>
        </div>
      )}
    </div>
  );
}
