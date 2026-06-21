import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, MessageCircle, X, ZoomIn, ZoomOut, Send, FileText, Play, ExternalLink } from 'lucide-react';
import { useAppData, type Artwork } from '../context/AppDataContext';
import { useStudent } from '../context/StudentContext';

const DOMAIN_COLORS: Record<string, string> = {
  'UI/UX Design': '#007AFF', Photoshop: '#BF5AF2', Illustrator: '#FF9F0A', '3D Animation': '#FF375F',
};

function LikeBurst({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && [...Array(8)].map((_, i) => {
        const angle = (i / 8) * 360;
        const rad = (angle * Math.PI) / 180;
        return (
          <motion.div key={i} initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            animate={{ opacity: 0, x: Math.cos(rad) * 22, y: Math.sin(rad) * 22, scale: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="absolute w-1.5 h-1.5 rounded-full pointer-events-none"
            style={{ background: '#ff4d6d', left: '50%', top: '50%', marginLeft: -3, marginTop: -3 }} />
        );
      })}
    </AnimatePresence>
  );
}

function ZoomImage({ src, alt, onAspectRatio }: { src: string; alt: string; onAspectRatio?: (ratio: number) => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [imgError, setImgError] = useState(false);
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
            transform: `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`,
            transition: dragging.current ? 'none' : 'transform 0.2s',
            borderRadius: 'inherit',
          }}
        />
      )}
      {!imgError && (
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button onClick={() => setScale(s => Math.max(1, s - 0.5))} className="btn-icon" style={{ width: 32, height: 32 }}><ZoomOut size={13} /></button>
          <button onClick={() => setScale(s => Math.min(4, s + 0.5))} className="btn-icon" style={{ width: 32, height: 32 }}><ZoomIn size={13} /></button>
        </div>
      )}
    </div>
  );
}

function MediaViewer({ artwork, onAspectRatio, isMobile }: { artwork: Artwork; onAspectRatio?: (ratio: number) => void; isMobile?: boolean }) {
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);
  if (artwork.mediaType === 'image') {
    return <ZoomImage src={artwork.mediaUrl} alt={artwork.title} onAspectRatio={onAspectRatio} />;
  }
  if (artwork.mediaType === 'video') {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--color-canvas)', borderRadius: 'var(--radius-xl)' }}>
        <video
          controls
          autoPlay
          src={artwork.mediaUrl}
          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', display: 'block', background: 'transparent', objectFit: 'contain' }}
        >
          Your browser does not support video.
        </video>
      </div>
    );
  }
  // PDF — always use the actual PDF viewer, never coverUrl
  const pdfViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(artwork.mediaUrl)}&embedded=true`;
  if (pdfLoadFailed) {
    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 24 }}>
        <p style={{ color: 'var(--color-ink-muted)', fontSize: 13, textAlign: 'center' }}>Unable to display PDF in browser.</p>
        <a href={artwork.mediaUrl} target="_blank" rel="noreferrer"
          className="btn-primary flex items-center gap-2">
          <ExternalLink size={14} /> Open PDF
        </a>
      </div>
    );
  }
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <iframe
        src={pdfViewerUrl}
        width="100%"
        height={isMobile ? '400px' : '600px'}
        style={{ border: 'none', borderRadius: 8, display: 'block', minHeight: isMobile ? '400px' : '600px' }}
        title={artwork.title}
        onError={() => setPdfLoadFailed(true)}
      />
      <a href={artwork.mediaUrl} target="_blank" rel="noreferrer"
        className="btn-secondary flex items-center gap-2">
        <ExternalLink size={14} /> Open PDF
      </a>
    </div>
  );
}

function ArtworkModal({ artworkId, onClose }: { artworkId: string; onClose: () => void }) {
  const { artworks, likeArtwork, addComment } = useAppData();
  const { studentSession, openRollModal } = useStudent();
  const artwork = artworks.find(a => a.id === artworkId);
  const [burst, setBurst] = useState(false);
  const [text, setText] = useState('');
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const forceUpper = localStorage.getItem('forceUppercase') !== 'false';

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  if (!artwork) return null;

  const handleLike = () => {
    if (!studentSession) { openRollModal(); return; }
    likeArtwork(artwork.id);
    if (!artwork.likedByUser) { setBurst(true); setTimeout(() => setBurst(false), 500); }
  };

  const handleComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const sender = studentSession?.name || studentSession?.rollNumber || 'Anonymous';
    addComment(artwork.id, sender, text.trim());
    setText('');
  };

  const domainColor = DOMAIN_COLORS[artwork.domain] ?? '#007AFF';

  // ── Mobile: full-screen sheet sliding up from bottom ──────────────────────
  if (isMobile) {
    return (
      <motion.div
        initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--color-surface-1)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
      >
        {/* Sticky header — always reachable */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-hairline)' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
            {artwork.title}
          </span>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-surface-2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={16} style={{ color: 'var(--color-ink)' }} />
          </button>
        </div>

        {/* Image */}
        <div style={{ width: '100%', height: artwork.mediaType === 'pdf' ? 'auto' : 'min(60vw, 55vh)', minHeight: artwork.mediaType === 'pdf' ? '400px' : undefined, background: 'var(--color-canvas)', display: 'flex', alignItems: artwork.mediaType === 'pdf' ? 'flex-start' : 'center', justifyContent: 'center', overflow: artwork.mediaType === 'pdf' ? 'visible' : 'hidden', borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0', padding: artwork.mediaType === 'pdf' ? 12 : 0 }}>
          <MediaViewer artwork={artwork} onAspectRatio={setAspectRatio} isMobile={isMobile} />
        </div>

        {/* Info */}
        <div style={{ padding: 16, borderBottom: '1px solid var(--color-hairline-soft)' }}>
          <span className="type-micro inline-block mb-2 px-2 py-0.5 rounded-full" style={{ background: `${domainColor}18`, color: domainColor }}>{artwork.domain}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink)', margin: 0, lineHeight: 1.3, textTransform: forceUpper ? 'uppercase' : 'none' }}>{artwork.title}</h2>
            <span className="type-micro px-2 py-0.5 rounded-full uppercase" style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', flexShrink: 0 }}>{artwork.mediaType}</span>
          </div>
          {artwork.artist?.trim() && <p style={{ fontSize: 13, color: 'var(--color-ink-muted)', marginBottom: 12, textTransform: forceUpper ? 'uppercase' : 'none' }}>by {artwork.artist}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={handleLike} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)', border: 'none', cursor: 'pointer', fontSize: 13 }}>
              <LikeBurst active={burst} />
              <Heart size={14} fill={artwork.likedByUser ? '#ff4d6d' : 'none'} style={{ color: artwork.likedByUser ? '#ff4d6d' : 'var(--color-ink-muted)' }} />
              <span className="tabular-nums" style={{ color: 'var(--color-ink)' }}>{artwork.likes}</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 12, color: 'var(--color-ink-muted)' }}>
              <MessageCircle size={12} /> {artwork.comments.length}
            </div>
          </div>
        </div>

        {/* Comments */}
        <div style={{ padding: '12px 16px', flex: 1 }}>
          {artwork.comments.length === 0 && (
            <p className="type-caption text-center py-6" style={{ color: 'var(--color-ink-muted)' }}>No comments yet.</p>
          )}
          {artwork.comments.map(c => (
            <div key={c.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div className="type-micro font-bold" style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{c.sender[0]}</div>
                <span className="type-body-sm">{c.sender}</span>
                <span className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>{c.date}</span>
              </div>
              <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginLeft: 28 }}>{c.text}</p>
            </div>
          ))}
        </div>

        {/* Comment form — sticky at bottom */}
        {studentSession ? (
          <form onSubmit={handleComment} style={{ position: 'sticky', bottom: 0, padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-hairline-soft)', background: 'var(--color-surface-1)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--color-ink-muted)', margin: 0, fontFamily: 'var(--font-body)' }}>
              Commenting as <strong style={{ color: 'var(--color-ink)' }}>{studentSession.name || studentSession.rollNumber}</strong>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment…" className="input-base" style={{ borderRadius: 'var(--radius-md)', flex: 1 }} />
              <button type="submit" className="btn-primary shrink-0" style={{ width: 38, height: 38, minHeight: 38, padding: 0, borderRadius: 'var(--radius-md)' }}><Send size={14} /></button>
            </div>
          </form>
        ) : (
          <div style={{ position: 'sticky', bottom: 0, borderTop: '1px solid var(--color-hairline-soft)', textAlign: 'center', padding: '16px', paddingBottom: 'max(16px, env(safe-area-inset-bottom))', background: 'var(--color-surface-1)' }}>
            <p style={{ color: 'var(--color-ink-muted)', fontSize: 13, marginBottom: 8 }}>Enter your roll number to comment</p>
            <button onClick={openRollModal} className="btn-secondary">Enter Roll Number</button>
          </div>
        )}
      </motion.div>
    );
  }

  // ── Desktop: centered floating card ───────────────────────────────────────
  const imagePanelWidth = artwork.mediaType === 'pdf' ? '62%'
    : aspectRatio === null ? '55%'
    : aspectRatio < 0.8  ? '40%'
    : aspectRatio > 1.3  ? '65%'
    : '50%';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1024, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'row', background: 'var(--color-surface-1)', borderRadius: 'var(--radius-xxl)', boxShadow: 'var(--shadow-level-2)' }}
      >
        {/* Media panel */}
        <div style={{ width: imagePanelWidth, flexShrink: 0, background: 'var(--color-canvas)', display: 'flex', alignItems: artwork.mediaType === 'pdf' ? 'flex-start' : 'center', justifyContent: 'center', padding: 16, minHeight: artwork.mediaType === 'pdf' ? '600px' : 0, maxHeight: '90vh', borderRadius: 'var(--radius-xl) 0 0 var(--radius-xl)', overflow: artwork.mediaType === 'pdf' ? 'auto' : 'hidden' }}>
          <MediaViewer artwork={artwork} onAspectRatio={setAspectRatio} isMobile={isMobile} />
        </div>

        {/* Info panel */}
        <div style={{ width: `calc(100% - ${imagePanelWidth})`, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '90vh' }}>
          <div className="p-6" style={{ borderBottom: '1px solid var(--color-hairline-soft)' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <span className="type-micro inline-block mb-2 px-2 py-0.5 rounded-full" style={{ background: `${domainColor}18`, color: domainColor }}>{artwork.domain}</span>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="type-headline leading-tight" style={{ textTransform: forceUpper ? 'uppercase' : 'none' }}>{artwork.title}</h2>
                  <span className="type-micro px-2 py-0.5 rounded-full uppercase" style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)' }}>{artwork.mediaType}</span>
                </div>
                {artwork.artist?.trim() && <p className="type-caption mt-1" style={{ textTransform: forceUpper ? 'uppercase' : 'none' }}>by {artwork.artist}</p>}
              </div>
              <button onClick={onClose} className="btn-icon" style={{ width: 32, height: 32 }}><X size={15} /></button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleLike} className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full type-body-sm transition-colors" style={{ background: 'var(--color-surface-2)' }}>
                <LikeBurst active={burst} />
                <Heart size={14} fill={artwork.likedByUser ? '#ff4d6d' : 'none'} style={{ color: artwork.likedByUser ? '#ff4d6d' : 'var(--color-ink-muted)' }} />
                <span className="tabular-nums" style={{ color: 'var(--color-ink)' }}>{artwork.likes}</span>
              </button>
              <div className="flex items-center gap-1 ml-auto type-caption" style={{ color: 'var(--color-ink-muted)' }}>
                <MessageCircle size={12} /> {artwork.comments.length}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {artwork.comments.length === 0 && <p className="type-caption text-center py-6" style={{ color: 'var(--color-ink-muted)' }}>No comments yet.</p>}
            {artwork.comments.map(c => (
              <div key={c.id}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center type-micro font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)' }}>{c.sender[0]}</div>
                  <span className="type-body-sm">{c.sender}</span>
                  <span className="type-micro">{c.date}</span>
                </div>
                <p className="type-body ml-7" style={{ color: 'var(--color-ink-muted)' }}>{c.text}</p>
              </div>
            ))}
          </div>

          {studentSession ? (
            <form onSubmit={handleComment} className="p-4 space-y-2" style={{ borderTop: '1px solid var(--color-hairline-soft)' }}>
              <p style={{ fontSize: 12, color: 'var(--color-ink-muted)', margin: 0, fontFamily: 'var(--font-body)' }}>
                Commenting as <strong style={{ color: 'var(--color-ink)' }}>{studentSession.name || studentSession.rollNumber}</strong>
              </p>
              <div className="flex gap-2">
                <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment…" className="input-base" style={{ borderRadius: 'var(--radius-md)' }} />
                <button type="submit" className="btn-primary shrink-0" style={{ width: 38, height: 38, minHeight: 38, padding: 0, borderRadius: 'var(--radius-md)' }}><Send size={14} /></button>
              </div>
            </form>
          ) : (
            <div style={{ borderTop: '1px solid var(--color-hairline-soft)', textAlign: 'center', padding: '16px' }}>
              <p style={{ color: 'var(--color-ink-muted)', fontSize: 13, marginBottom: 8 }}>Enter your roll number to comment</p>
              <button onClick={openRollModal} className="btn-secondary">Enter Roll Number</button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function thumbUrl(url: string): string {
  return `${url}?width=300&quality=75`;
}

function MediaThumbnail({ art }: { art: Artwork }) {
  if (art.coverUrl && (art.mediaType === 'video' || art.mediaType === 'pdf')) {
    return (
      <img
        src={thumbUrl(art.coverUrl)}
        alt={art.title}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading="lazy"
      />
    );
  }
  if (art.mediaType === 'image') {
    return (
      <img src={thumbUrl(art.mediaUrl)} alt={art.title}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
    );
  }
  if (art.mediaType === 'video') {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)' }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
          <Play size={22} fill="white" className="text-white ml-1" />
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg, #1a1a2e, #0d1117)' }}>
      <FileText size={32} style={{ color: 'rgba(255,255,255,0.4)' }} />
      <p className="type-micro px-3 text-center truncate w-full" style={{ color: 'rgba(255,255,255,0.4)' }}>{art.originalFilename ?? 'PDF'}</p>
    </div>
  );
}

export function GalleryPage() {
  const { artworks, likeArtwork, loading, error } = useAppData();
  const domainTitles = useMemo(() => {
    const unique = [...new Set(
      artworks
        .map(a => a.domain?.trim().toUpperCase())
        .filter(Boolean)
        .filter(d => d !== '')
    )].sort();
    return ['ALL', ...unique];
  }, [artworks]);
  const [filter, setFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [burstIds, setBurstIds] = useState<Set<string>>(new Set());
  const forceUpper = localStorage.getItem('forceUppercase') !== 'false';

  const handleLike = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const art = artworks.find(a => a.id === id);
    if (art && !art.likedByUser) {
      setBurstIds(s => new Set(s).add(id));
      setTimeout(() => setBurstIds(s => { const n = new Set(s); n.delete(id); return n; }), 500);
    }
    likeArtwork(id);
  }, [likeArtwork, artworks]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '6rem' }}>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 14 }}>Loading gallery…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, paddingTop: '6rem' }}>
        <div style={{ color: 'var(--color-ink)', fontSize: 16, fontWeight: 600 }}>Could not load gallery</div>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 13 }}>Please check your connection and try again.</div>
      </div>
    );
  }

  const filtered = filter === 'ALL' ? artworks : artworks.filter(a => a.domain?.trim().toUpperCase() === filter);

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '6rem', paddingBottom: '5rem' }}>
      <div className="page-container">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="type-caption mb-3">Creative Showcase</p>
              <h1 className="type-display-xl" style={{ fontFamily: 'var(--font-display)' }}>Club<br /><span style={{ color: 'var(--color-ink-muted)' }}>Artworks</span></h1>
            </div>
          </div>
        </motion.div>

        <div className="flex flex-wrap gap-2 mb-8">
          {domainTitles.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="type-body-sm px-4 py-2 rounded-full transition-all"
              style={filter === f
                ? { background: 'var(--color-inverse-canvas)', color: 'var(--color-canvas)', borderRadius: 'var(--radius-pill)' }
                : { background: 'var(--color-surface-1)', color: 'var(--color-ink-muted)', borderRadius: 'var(--radius-pill)' }}>
              {f}
            </button>
          ))}
        </div>

        <motion.div layout className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-0">
          <AnimatePresence>
            {filtered.map((art, i) => {
              const domainColor = DOMAIN_COLORS[art.domain] ?? '#007AFF';
              const hasBurst = burstIds.has(art.id);
              const aspects = ['aspect-[3/4]', 'aspect-square', 'aspect-[4/5]', 'aspect-[2/3]'];
              const aspect = aspects[i % aspects.length];
              return (
                <motion.div
                  key={art.id} layout
                  initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ delay: i * 0.04 }}
                  className="break-inside-avoid mb-4 cursor-pointer group"
                  onClick={() => setSelectedId(art.id)}
                >
                  <div style={{ borderRadius: 'var(--radius-xl)', overflow: 'hidden', background: 'var(--color-surface-1)' }}>
                    {/* Image container */}
                    <div className={`${aspect} relative`} style={{ overflow: 'hidden', borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0' }}>
                      <MediaThumbnail art={art} />
                      {/* Domain badge — top-right of image, always visible */}
                      <span className="type-micro absolute px-2 py-0.5 rounded-full"
                        style={{ top: 10, right: 10, background: `${domainColor}30`, color: domainColor, backdropFilter: 'blur(4px)' }}>
                        {art.domain}
                      </span>
                      {/* Like button — bottom-right, visible on hover/touch */}
                      <button
                        onClick={e => handleLike(e, art.id)}
                        className="absolute bottom-3 right-3 relative flex items-center gap-1 px-2.5 py-1.5 rounded-full opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity type-micro"
                        style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}>
                        <LikeBurst active={hasBurst} />
                        <Heart size={11} fill={art.likedByUser ? '#ff4d6d' : 'none'} style={{ color: art.likedByUser ? '#ff4d6d' : '#fff' }} />
                        <span className="tabular-nums">{art.likes}</span>
                      </button>
                    </div>
                    {/* Text area below image — always visible, never overlapped */}
                    <div style={{ padding: '20px 20px 24px' }}>
                      <h3 className="type-display-md" style={{ marginBottom: 4, fontSize: 20, textTransform: forceUpper ? 'uppercase' : 'none' }}>{art.title}</h3>
                      {art.artist?.trim() && <p className="type-caption" style={{ textTransform: forceUpper ? 'uppercase' : 'none' }}>by {art.artist}</p>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>

        {filtered.length === 0 && (
          <p className="text-center py-24 type-body" style={{ color: 'var(--color-ink-muted)' }}>No artworks in this category.</p>
        )}
      </div>

      <AnimatePresence>
        {selectedId && <ArtworkModal artworkId={selectedId} onClose={() => setSelectedId(null)} />}
      </AnimatePresence>
    </div>
  );
}
