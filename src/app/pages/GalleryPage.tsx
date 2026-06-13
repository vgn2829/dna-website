import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, MessageCircle, Share2, X, ZoomIn, ZoomOut, Send, ArrowRight, FileText, Play, ExternalLink } from 'lucide-react';
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

function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  return (
    <div className="relative overflow-hidden w-full h-full flex items-center justify-center"
      style={{ background: 'var(--color-canvas)', cursor: scale > 1 ? 'grab' : 'default', borderRadius: 'var(--radius-xl)' }}
      onMouseDown={e => { dragging.current = true; last.current = { x: e.clientX, y: e.clientY }; }}
      onMouseMove={e => { if (!dragging.current) return; setPos(p => ({ x: p.x + e.clientX - last.current.x, y: p.y + e.clientY - last.current.y })); last.current = { x: e.clientX, y: e.clientY }; }}
      onMouseUp={() => { dragging.current = false; }}>
      <img src={src} alt={alt} draggable={false}
        style={{ transform: `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`, transition: dragging.current ? 'none' : 'transform 0.2s', maxWidth: '100%', maxHeight: '100%', userSelect: 'none' }} />
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <button onClick={() => setScale(s => Math.max(1, s - 0.5))} className="btn-icon" style={{ width: 32, height: 32 }}><ZoomOut size={13} /></button>
        <button onClick={() => setScale(s => Math.min(4, s + 0.5))} className="btn-icon" style={{ width: 32, height: 32 }}><ZoomIn size={13} /></button>
      </div>
    </div>
  );
}

function MediaViewer({ artwork }: { artwork: Artwork }) {
  if (artwork.mediaType === 'image') {
    return <ZoomImage src={artwork.mediaUrl} alt={artwork.title} />;
  }
  if (artwork.mediaType === 'video') {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#000', borderRadius: 'var(--radius-xl)' }}>
        <video controls autoPlay src={artwork.mediaUrl} className="max-w-full max-h-full rounded-xl" style={{ maxHeight: '100%' }}>
          Your browser does not support video.
        </video>
      </div>
    );
  }
  // PDF
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4" style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-xl)' }}>
      <FileText size={56} style={{ color: 'var(--color-ink-muted)' }} />
      <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>{artwork.originalFilename ?? artwork.title}</p>
      <a href={artwork.mediaUrl} target="_blank" rel="noreferrer"
        className="btn-primary flex items-center gap-2">
        <ExternalLink size={14} /> Open PDF
      </a>
    </div>
  );
}

function ArtworkModal({ artworkId, onClose }: { artworkId: string; onClose: () => void }) {
  const { artworks, likeArtwork, addComment } = useAppData();
  const artwork = artworks.find(a => a.id === artworkId);
  const [burst, setBurst] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  if (!artwork) return null;

  const handleLike = () => {
    likeArtwork(artwork.id);
    if (!artwork.likedByUser) { setBurst(true); setTimeout(() => setBurst(false), 500); }
  };

  const handleComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !text.trim()) return;
    addComment(artwork.id, name.trim(), text.trim());
    setName(''); setText('');
  };

  const domainColor = DOMAIN_COLORS[artwork.domain] ?? '#007AFF';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col lg:flex-row"
        style={{ background: 'var(--color-surface-1)', borderRadius: 'var(--radius-xxl)', boxShadow: 'var(--shadow-level-2)' }}>

        {/* Media */}
        <div className="lg:w-3/5 h-64 lg:h-auto p-4 min-h-0">
          <MediaViewer artwork={artwork} />
        </div>

        {/* Info */}
        <div className="lg:w-2/5 flex flex-col overflow-y-auto">
          <div className="p-6" style={{ borderBottom: '1px solid var(--color-hairline-soft)' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <span className="type-micro inline-block mb-2 px-2 py-0.5 rounded-full" style={{ background: `${domainColor}18`, color: domainColor }}>{artwork.domain}</span>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="type-headline leading-tight">{artwork.title}</h2>
                  <span className="type-micro px-2 py-0.5 rounded-full uppercase" style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)' }}>{artwork.mediaType}</span>
                </div>
                <p className="type-caption mt-1">by {artwork.artist}</p>
              </div>
              <button onClick={onClose} className="btn-icon" style={{ width: 32, height: 32 }}><X size={15} /></button>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={handleLike} className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full type-body-sm transition-colors" style={{ background: 'var(--color-surface-2)' }}>
                <LikeBurst active={burst} />
                <Heart size={14} fill={artwork.likedByUser ? '#ff4d6d' : 'none'} style={{ color: artwork.likedByUser ? '#ff4d6d' : 'var(--color-ink-muted)' }} />
                <span style={{ color: 'var(--color-ink)' }}>{artwork.likes}</span>
              </button>
              <button onClick={async () => { if (navigator.share) await navigator.share({ title: artwork.title, text: `Check out "${artwork.title}" by ${artwork.artist}` }); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full type-body-sm" style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)' }}>
                <Share2 size={13} /> Share
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

          <form onSubmit={handleComment} className="p-4 space-y-2" style={{ borderTop: '1px solid var(--color-hairline-soft)' }}>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="input-base" style={{ borderRadius: 'var(--radius-md)' }} />
            <div className="flex gap-2">
              <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment…" className="input-base" style={{ borderRadius: 'var(--radius-md)' }} />
              <button type="submit" className="btn-primary shrink-0" style={{ width: 38, height: 38, minHeight: 38, padding: 0, borderRadius: 'var(--radius-md)' }}><Send size={14} /></button>
            </div>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}

function MediaThumbnail({ art, aspect }: { art: Artwork; aspect: string }) {
  if (art.mediaType === 'image') {
    return (
      <img src={art.mediaUrl} alt={art.title}
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
  const { artworks, likeArtwork, domains, loading, error } = useAppData();
  const domainTitles = ['All', ...Object.values(domains).map(d => d.title)];
  const [filter, setFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [burstIds, setBurstIds] = useState<Set<string>>(new Set());

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

  const filtered = filter === 'All' ? artworks : artworks.filter(a => a.domain === filter);

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '6rem', paddingBottom: '5rem' }}>
      <div className="max-w-6xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="type-caption mb-3">Creative Showcase</p>
              <h1 className="type-display-xl" style={{ fontFamily: 'var(--font-display)' }}>Club<br /><span style={{ color: 'var(--color-ink-muted)' }}>Artworks</span></h1>
            </div>
          </div>
          <div className="spotlight spotlight-magenta mt-8 flex items-center justify-between gap-4">
            <div>
              <p className="type-caption mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>FEATURED</p>
              <p className="type-display-md" style={{ fontFamily: 'var(--font-display)', color: '#fff' }}>Spring '26 Creative Showcase</p>
            </div>
            <button onClick={() => setFilter('All')} className="btn-translucent shrink-0">View all <ArrowRight size={13} /></button>
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
                <motion.div key={art.id} layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ delay: i * 0.04 }}
                  className="break-inside-avoid mb-4 group cursor-pointer relative overflow-hidden" style={{ borderRadius: 'var(--radius-xl)' }}
                  onClick={() => setSelectedId(art.id)}>
                  <div className={`${aspect} relative`}>
                    <MediaThumbnail art={art} aspect={aspect} />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4"
                      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 60%, transparent 100%)' }}>
                      <p className="type-body-sm font-semibold text-white leading-tight mb-0.5">{art.title}</p>
                      <p className="type-micro" style={{ color: 'rgba(255,255,255,0.55)' }}>{art.artist}</p>
                    </div>
                    <button onClick={e => handleLike(e, art.id)}
                      className="absolute top-3 right-3 relative flex items-center gap-1 px-2.5 py-1.5 rounded-full opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity type-micro"
                      style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}>
                      <LikeBurst active={hasBurst} />
                      <Heart size={11} fill={art.likedByUser ? '#ff4d6d' : 'none'} style={{ color: art.likedByUser ? '#ff4d6d' : '#fff' }} />
                      {art.likes}
                    </button>
                    <div className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity type-micro px-2 py-0.5 rounded-full"
                      style={{ background: `${domainColor}30`, color: domainColor, backdropFilter: 'blur(4px)' }}>
                      {art.domain}
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
