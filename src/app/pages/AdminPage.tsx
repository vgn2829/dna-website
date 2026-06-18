import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Lock, Plus, Trash2, Video, Image, CalendarDays, X, Eye, EyeOff, Users, Upload, Loader2, Pencil, Star, MessageSquare } from 'lucide-react';
import { useAppData, type Artwork, type TeamMember, type ClubEvent, type Domain, type VideoResource } from '../context/AppDataContext';
import { api, setAdminToken, clearAdminToken } from '../lib/api';
import { openCropModal, ImageCropperPortal } from '../components/ImageCropper';

async function captureVideoFirstFrame(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = 0.1;
    });

    video.addEventListener('seeked', () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        URL.revokeObjectURL(url);
        reject(new Error('Video dimensions unavailable'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to capture frame'));
      }, 'image/jpeg', 0.90);
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('Video load error'));
    });

    video.load();
  });
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { token } = await api.auth.adminLogin(pw);
      setAdminToken(token);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect password');
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--color-canvas)', paddingTop: '5rem' }}>
      <motion.div animate={shake ? { x: [-10, 10, -8, 8, 0] } : { x: 0 }} transition={{ duration: 0.35 }} className="card p-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-5" style={{ background: 'var(--color-surface-2)' }}>
            <Lock size={20} style={{ color: 'var(--color-ink)' }} />
          </div>
          <h1 className="type-display-md mb-2" style={{ fontFamily: 'var(--font-display)' }}>Admin Access</h1>
          <p className="type-body" style={{ color: 'var(--color-ink-muted)' }}>DnA Club Content Management System</p>
        </div>
        <form onSubmit={handle} className="space-y-3">
          <div className="relative">
            <input type={show ? 'text' : 'password'} value={pw} onChange={e => { setPw(e.target.value); setError(''); }} placeholder="Admin password" className="input-base pr-11" autoFocus />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-ink-muted)' }}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {error && <p className="type-micro" style={{ color: '#e5484d' }}>{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center" style={{ opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Verifying…' : 'Unlock Dashboard'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-hairline)' }}>
          <h2 style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
          <button onClick={onClose} className="btn-icon"><X size={16} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>{children}</div>
      </div>
    </div>
  );
}

type Tab = 'academy' | 'gallery' | 'team' | 'events' | 'comments';

// ── Academy tab ──────────────────────────────────────────────────────────────
function AcademyTab() {
  const { domains, addDomain, updateDomain, deleteDomain, addVideo, updateVideo, deleteVideo, updateVideoSequence } = useAppData();
  const domainKeys = Object.keys(domains);
  const [activeDomain, setActiveDomain] = useState(domainKeys[0] ?? '');
  const [showNewDomain, setShowNewDomain] = useState(false);
  const [pendingSeq, setPendingSeq] = useState<Record<string, string>>({});
  const [seqErrors, setSeqErrors] = useState<Record<string, string>>({});

  // New domain form
  const [dTitle, setDTitle] = useState('');
  const [dFullName, setDFullName] = useState('');
  const [dIcon, setDIcon] = useState('fa-layer-group');
  const [dTagline, setDTagline] = useState('');
  const [dDesc, setDDesc] = useState('');
  const [dColor, setDColor] = useState('#007AFF');
  const [dLoading, setDLoading] = useState(false);

  // Edit domain modal
  const [editDomain, setEditDomain] = useState<Domain | null>(null);
  const [edTitle, setEdTitle] = useState('');
  const [edFullName, setEdFullName] = useState('');
  const [edIcon, setEdIcon] = useState('');
  const [edTagline, setEdTagline] = useState('');
  const [edDesc, setEdDesc] = useState('');
  const [edColor, setEdColor] = useState('#007AFF');
  const [edLoading, setEdLoading] = useState(false);
  const [edError, setEdError] = useState('');

  // Edit video modal
  const [editVideoState, setEditVideoState] = useState<{ domainId: string; video: VideoResource } | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evDiff, setEvDiff] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [evDur, setEvDur] = useState('');
  const [evSeq, setEvSeq] = useState('');
  const [evLoading, setEvLoading] = useState(false);
  const [evError, setEvError] = useState('');

  const handleAddDomain = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setDLoading(true);
    try {
      await addDomain({ title: dTitle, fullName: dFullName || dTitle, icon: dIcon, tagline: dTagline, description: dDesc, color: dColor });
      setDTitle(''); setDFullName(''); setDTagline(''); setDDesc(''); setDColor('#007AFF');
      setShowNewDomain(false);
    } catch (err) { console.error(err); } finally { setDLoading(false); }
  };

  const openEditDomain = (d: Domain) => {
    setEditDomain(d);
    setEdTitle(d.title); setEdFullName(d.fullName); setEdIcon(d.icon);
    setEdTagline(d.tagline); setEdDesc(d.description); setEdColor(d.color);
    setEdError('');
  };

  const handleEditDomain = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editDomain) return;
    setEdLoading(true); setEdError('');
    try {
      await updateDomain(editDomain.id, { title: edTitle, fullName: edFullName, icon: edIcon, tagline: edTagline, description: edDesc, color: edColor });
      setEditDomain(null);
    } catch (err) { setEdError(String(err)); } finally { setEdLoading(false); }
  };

  const openEditVideo = (domainId: string, v: VideoResource) => {
    setEditVideoState({ domainId, video: v });
    setEvTitle(v.title); setEvUrl(`https://youtu.be/${v.ytId}`);
    setEvDiff(v.difficulty); setEvDur(v.duration); setEvSeq(String(v.sequence));
    setEvError('');
  };

  const handleEditVideo = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editVideoState) return;
    setEvLoading(true); setEvError('');
    try {
      await updateVideo(editVideoState.domainId, editVideoState.video.id, {
        title: evTitle, ytUrl: evUrl, difficulty: evDiff, duration: evDur,
        sequence: parseInt(evSeq, 10) || editVideoState.video.sequence,
      });
      setEditVideoState(null);
    } catch (err) { setEvError(String(err)); } finally { setEvLoading(false); }
  };

  // New video form
  const [vTitle, setVTitle] = useState('');
  const [vUrl, setVUrl] = useState('');
  const [vDiff, setVDiff] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [vDur, setVDur] = useState('');
  const [vSeq, setVSeq] = useState('');
  const [addingVideo, setAddingVideo] = useState(false);

  const handleAddVideo = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!activeDomain || addingVideo) return;
    const seqParsed = parseInt(vSeq, 10);
    const seq = vSeq && seqParsed >= 1 ? seqParsed : undefined;
    setAddingVideo(true);
    addVideo(activeDomain, { title: vTitle, ytUrl: vUrl, ytId: '', difficulty: vDiff, duration: vDur || '15 mins', sequence: seq });
    setVTitle(''); setVUrl(''); setVDur(''); setVSeq('');
    setTimeout(() => setAddingVideo(false), 600);
  };

  const domain = domains[activeDomain];

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="type-headline">Domains</p>
          <button onClick={() => setShowNewDomain(s => !s)} className="btn-secondary flex items-center gap-1.5">
            <Plus size={13} /> New Domain
          </button>
        </div>

        <AnimatePresence>
          {showNewDomain && (
            <motion.form key="new-domain" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onSubmit={handleAddDomain}
              className="space-y-3 mb-4 pb-4" style={{ borderBottom: '1px solid var(--color-hairline-soft)' }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Title *</label><input required value={dTitle} onChange={e => setDTitle(e.target.value)} placeholder="Motion Design" className="input-base" maxLength={100} /></div>
                <div><label className="type-micro block mb-1">Full Name</label><input value={dFullName} onChange={e => setDFullName(e.target.value)} placeholder="Motion Design & Animation" className="input-base" maxLength={100} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Icon class</label><input value={dIcon} onChange={e => setDIcon(e.target.value)} placeholder="fa-video" className="input-base" /></div>
                <div><label className="type-micro block mb-1">Color</label><input type="color" value={dColor} onChange={e => setDColor(e.target.value)} className="input-base h-10" /></div>
              </div>
              <div><label className="type-micro block mb-1">Tagline</label><input value={dTagline} onChange={e => setDTagline(e.target.value)} placeholder="Short tagline…" className="input-base" maxLength={200} /></div>
              <div><label className="type-micro block mb-1">Description</label><textarea value={dDesc} onChange={e => setDDesc(e.target.value)} rows={2} className="input-base resize-none" maxLength={1000} /></div>
              <div className="flex gap-2">
                <button type="submit" disabled={dLoading} className="btn-primary flex items-center gap-2">
                  {dLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create Domain
                </button>
                <button type="button" onClick={() => setShowNewDomain(false)} className="btn-secondary">Cancel</button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap gap-2">
          {domainKeys.map(k => (
            <div key={k} className="flex items-center gap-1">
              <button onClick={() => { setActiveDomain(k); setPendingSeq({}); setSeqErrors({}); }} className="type-body-sm px-3 py-1.5 rounded-full transition-all"
                style={activeDomain === k ? { background: 'var(--color-surface-2)', color: 'var(--color-ink)' } : { background: 'var(--color-surface-1)', color: 'var(--color-ink-muted)' }}>
                {domains[k].title}
              </button>
              <button onClick={() => openEditDomain(domains[k])} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-blue-500/10 transition-colors" style={{ color: 'var(--color-accent-blue)' }}>
                <Pencil size={10} />
              </button>
              <button onClick={() => { if (confirm(`Delete domain "${domains[k].title}" and all its videos?`)) deleteDomain(k); }}
                className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-500/10 transition-colors" style={{ color: '#e5484d' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {domain && (
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 card p-5 space-y-3">
            <p className="type-headline flex items-center gap-2"><Plus size={14} /> Add Video to {domain.title}</p>
            <form onSubmit={handleAddVideo} className="space-y-3">
              <div><label className="type-micro block mb-1">Title *</label><input required value={vTitle} onChange={e => setVTitle(e.target.value)} placeholder="Tutorial title" className="input-base" maxLength={200} /></div>
              <div><label className="type-micro block mb-1">YouTube URL or ID *</label><input required value={vUrl} onChange={e => setVUrl(e.target.value)} placeholder="https://youtu.be/… or 11-char ID" className="input-base" maxLength={200} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Difficulty</label>
                  <select value={vDiff} onChange={e => setVDiff(e.target.value as 'Beginner' | 'Intermediate' | 'Advanced')} className="input-base">
                    {['Beginner','Intermediate','Advanced'].map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div><label className="type-micro block mb-1">Duration</label><input value={vDur} onChange={e => setVDur(e.target.value)} placeholder="15 mins" className="input-base" /></div>
              </div>
              <div><label className="type-micro block mb-1">Sequence <span style={{ color: 'var(--color-ink-muted)' }}>(blank = append)</span></label><input type="number" min={1} value={vSeq} onChange={e => setVSeq(e.target.value)} placeholder="auto" className="input-base" /></div>
              <button type="submit" disabled={addingVideo} className="btn-primary w-full justify-center" style={{ opacity: addingVideo ? 0.5 : 1 }}>
                {addingVideo ? <><Loader2 size={13} className="animate-spin mr-2" />Adding…</> : 'Add Video'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-3 space-y-2">
            {domain.videos.length === 0 && <p className="type-caption text-center py-8" style={{ color: 'var(--color-ink-muted)' }}>No videos yet</p>}
            {domain.videos.map(v => {
              const saveSeq = async () => {
                setSeqErrors(p => { const n = { ...p }; delete n[v.id]; return n; });
                const raw = pendingSeq[v.id];
                if (raw === undefined) return;
                const val = parseInt(raw, 10);
                try {
                  if (!isNaN(val) && val >= 1 && val !== v.sequence) {
                    await updateVideoSequence(activeDomain, v.id, val);
                  }
                  setPendingSeq(p => { const n = { ...p }; delete n[v.id]; return n; });
                } catch {
                  setSeqErrors(p => ({ ...p, [v.id]: 'Save failed' }));
                }
              };
              return (
                <div key={v.id} className="card p-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface-2)' }}>
                    <Video size={12} style={{ color: 'var(--color-ink-muted)' }} />
                  </div>
                  <input
                    type="number" min={1}
                    value={pendingSeq[v.id] ?? String(v.sequence)}
                    onChange={e => setPendingSeq(p => ({ ...p, [v.id]: e.target.value }))}
                    onBlur={saveSeq}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveSeq(); } }}
                    className="w-10 text-center shrink-0 rounded-lg type-micro"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', border: 'none', outline: 'none', padding: '4px 2px' }}
                    title="Sequence — Enter or blur to save"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="type-body-sm truncate">{v.title}</p>
                    <p className="type-micro">{v.difficulty} · {v.duration}</p>
                    {seqErrors[v.id] && <p className="type-micro" style={{ color: '#e5484d' }}>{seqErrors[v.id]}</p>}
                  </div>
                  <a href={`https://youtube.com/watch?v=${v.ytId}`} target="_blank" rel="noreferrer" className="type-micro shrink-0" style={{ color: 'var(--color-accent-blue)' }}>↗</a>
                  <button onClick={() => openEditVideo(activeDomain, v)} className="btn-icon shrink-0" style={{ color: 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}>
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => deleteVideo(activeDomain, v.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editDomain && (
        <Modal title={`Edit Domain — ${editDomain.title}`} onClose={() => setEditDomain(null)}>
          <form onSubmit={handleEditDomain} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="type-micro block mb-1">Title *</label><input required value={edTitle} onChange={e => setEdTitle(e.target.value)} className="input-base" maxLength={100} /></div>
              <div><label className="type-micro block mb-1">Full Name</label><input value={edFullName} onChange={e => setEdFullName(e.target.value)} className="input-base" maxLength={200} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="type-micro block mb-1">Icon class</label><input value={edIcon} onChange={e => setEdIcon(e.target.value)} className="input-base" /></div>
              <div><label className="type-micro block mb-1">Color</label><input type="color" value={edColor} onChange={e => setEdColor(e.target.value)} className="input-base h-10" /></div>
            </div>
            <div><label className="type-micro block mb-1">Tagline</label><input value={edTagline} onChange={e => setEdTagline(e.target.value)} className="input-base" maxLength={300} /></div>
            <div><label className="type-micro block mb-1">Description</label><textarea value={edDesc} onChange={e => setEdDesc(e.target.value)} rows={3} className="input-base resize-none" maxLength={1000} /></div>
            {edError && <p className="type-micro" style={{ color: '#e5484d' }}>{edError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={edLoading} className="btn-primary flex items-center gap-2" style={{ opacity: edLoading ? 0.6 : 1 }}>
                {edLoading ? <Loader2 size={13} className="animate-spin" /> : null} Save Changes
              </button>
              <button type="button" onClick={() => setEditDomain(null)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {editVideoState && (
        <Modal title={`Edit Video — ${editVideoState.video.title}`} onClose={() => setEditVideoState(null)}>
          <form onSubmit={handleEditVideo} className="space-y-3">
            <div><label className="type-micro block mb-1">Title *</label><input required value={evTitle} onChange={e => setEvTitle(e.target.value)} className="input-base" maxLength={200} /></div>
            <div><label className="type-micro block mb-1">YouTube URL or ID *</label><input required value={evUrl} onChange={e => setEvUrl(e.target.value)} className="input-base" maxLength={200} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="type-micro block mb-1">Difficulty</label>
                <select value={evDiff} onChange={e => setEvDiff(e.target.value as 'Beginner' | 'Intermediate' | 'Advanced')} className="input-base">
                  {['Beginner','Intermediate','Advanced'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div><label className="type-micro block mb-1">Duration</label><input value={evDur} onChange={e => setEvDur(e.target.value)} placeholder="15 mins" className="input-base" /></div>
            </div>
            <div><label className="type-micro block mb-1">Sequence</label><input type="number" min={1} value={evSeq} onChange={e => setEvSeq(e.target.value)} className="input-base" /></div>
            {evError && <p className="type-micro" style={{ color: '#e5484d' }}>{evError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={evLoading} className="btn-primary flex items-center gap-2" style={{ opacity: evLoading ? 0.6 : 1 }}>
                {evLoading ? <Loader2 size={13} className="animate-spin" /> : null} Save Changes
              </button>
              <button type="button" onClick={() => setEditVideoState(null)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Gallery tab ───────────────────────────────────────────────────────────────
function GalleryTab() {
  const { artworks, uploadArtwork, updateArtwork, deleteArtwork, toggleFeatured, domains } = useAppData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [aTitle, setATitle] = useState('');
  const [aArtist, setAArtist] = useState('');
  const [aDomain, setADomain] = useState('');
  const [aCustomDomain, setACustomDomain] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Edit artwork modal state
  const [editArtwork, setEditArtwork] = useState<Artwork | null>(null);
  const eaFileRef = useRef<HTMLInputElement>(null);
  const [eaTitle, setEaTitle] = useState('');
  const [eaArtist, setEaArtist] = useState('');
  const [eaDomain, setEaDomain] = useState('');
  const [eaCustomDomain, setEaCustomDomain] = useState('');
  const [eaFeatured, setEaFeatured] = useState(false);
  const [eaFile, setEaFile] = useState<File | null>(null);
  const [eaLoading, setEaLoading] = useState(false);
  const [eaError, setEaError] = useState('');

  // Cover image state (add form)
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);

  // Cover image state (edit form)
  const [eaCoverFile, setEaCoverFile] = useState<File | null>(null);
  const [eaCoverPreview, setEaCoverPreview] = useState<string | null>(null);

  // Featured star toggling
  const [togglingFeatured, setTogglingFeatured] = useState<Set<string>>(new Set());

  const domainTitles = Object.values(domains).map(d => d.title);
  const featuredCount = artworks.filter(a => a.featured).length;

  const MAX_MB = 50;
  const ALLOWED_EXT = ['jpg','jpeg','png','webp','gif','pdf','mp4'];

  const handleFile = (f: File | null, setFileFn: (f: File | null) => void, setErr: (s: string) => void) => {
    if (!f) { setFileFn(null); return; }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXT.includes(ext)) { setErr(`Unsupported type. Allowed: ${ALLOWED_EXT.join(', ')}`); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setErr(`File exceeds ${MAX_MB} MB`); return; }
    setErr('');
    setFileFn(f);
  };

  const handleUpload = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true); setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', aTitle);
      fd.append('artist', aArtist);
      const domainVal = aDomain === '__other__' ? aCustomDomain : (aDomain || domainTitles[0] || 'General');
      fd.append('domain', domainVal);
      if (coverFile) fd.append('cover', coverFile);
      await uploadArtwork(fd);
      setFile(null); setATitle(''); setAArtist(''); setADomain(''); setACustomDomain('');
      setCoverFile(null); if (coverPreview) URL.revokeObjectURL(coverPreview); setCoverPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) { setUploadError(err instanceof Error ? err.message : String(err)); } finally { setUploading(false); }
  };

  const openEditArtwork = (a: Artwork) => {
    setEditArtwork(a);
    setEaTitle(a.title); setEaArtist(a.artist); setEaFeatured(a.featured);
    if (domainTitles.includes(a.domain)) { setEaDomain(a.domain); setEaCustomDomain(''); }
    else { setEaDomain('__other__'); setEaCustomDomain(a.domain); }
    setEaFile(null); setEaError('');
    setEaCoverFile(null); if (eaCoverPreview) URL.revokeObjectURL(eaCoverPreview); setEaCoverPreview(null);
  };

  const handleEditArtwork = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editArtwork) return;
    setEaLoading(true); setEaError('');
    try {
      const fd = new FormData();
      fd.append('title', eaTitle);
      fd.append('artist', eaArtist);
      fd.append('domain', eaDomain === '__other__' ? eaCustomDomain : eaDomain);
      fd.append('featured', String(eaFeatured));
      if (eaFile) fd.append('file', eaFile);
      if (eaCoverFile) fd.append('cover', eaCoverFile);
      await updateArtwork(editArtwork.id, fd);
      if (eaCoverPreview) { URL.revokeObjectURL(eaCoverPreview); setEaCoverPreview(null); }
      setEditArtwork(null);
    } catch (err) { setEaError(String(err)); } finally { setEaLoading(false); }
  };

  const handleToggleFeatured = (id: string, featured: boolean) => {
    setTogglingFeatured(s => new Set(s).add(id));
    toggleFeatured(id, featured);
    setTimeout(() => setTogglingFeatured(s => { const n = new Set(s); n.delete(id); return n; }), 800);
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 card p-5 space-y-4">
        <p className="type-headline flex items-center gap-2"><Upload size={14} /> Upload Media</p>
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label className="type-micro block mb-1">File * <span style={{ color: 'var(--color-ink-muted)' }}>(jpg/png/webp/gif/pdf/mp4, max 50 MB)</span></label>
            <div
              className="relative border-2 border-dashed rounded-xl p-4 text-center transition-colors"
              style={{ borderColor: file ? 'var(--color-accent-blue)' : 'var(--color-hairline)', cursor: 'pointer' }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0] ?? null, setFile, setUploadError); }}
            >
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4" className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  if (!aTitle || aTitle.trim() === '') {
                    const cleanTitle = f.name
                      .replace(/\.[^.]+$/, '')
                      .replace(/[-_]/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .replace(/\b\w/g, c => c.toUpperCase());
                    setATitle(cleanTitle);
                  }
                  if (f.type.startsWith('image/')) {
                    const blob = await openCropModal(f, 'artwork');
                    if (!blob) return;
                    setFile(new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
                    setCoverFile(null);
                    if (coverPreview) URL.revokeObjectURL(coverPreview);
                    setCoverPreview(null);
                  } else {
                    setFile(f);
                    if (f.type === 'video/mp4' || f.type.startsWith('video/')) {
                      setIsCapturingFrame(true);
                      try {
                        const frameBlob = await captureVideoFirstFrame(f);
                        const frameFile = new File([frameBlob], 'cover.jpg', { type: 'image/jpeg' });
                        setCoverFile(frameFile);
                        if (coverPreview) URL.revokeObjectURL(coverPreview);
                        setCoverPreview(URL.createObjectURL(frameBlob));
                      } catch (e) {
                        console.error('Frame capture failed:', e);
                      } finally {
                        setIsCapturingFrame(false);
                      }
                    } else if (f.type === 'application/pdf') {
                      setCoverFile(null);
                      if (coverPreview) URL.revokeObjectURL(coverPreview);
                      setCoverPreview(null);
                    }
                  }
                }} />
              {file ? (
                <p className="type-body-sm truncate">{file.name} <span className="type-micro">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></p>
              ) : (
                <p className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>Click or drag & drop</p>
              )}
            </div>
          </div>

          {/* Cover image — shown for video and PDF only */}
          {file && (file.type.startsWith('video/') || file.type === 'application/pdf') && (
            <div style={{ marginTop: 4 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Cover Image
                {file.type.startsWith('video/') && (
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8, color: 'var(--color-ink-muted)' }}>(auto-captured from first frame)</span>
                )}
                {file.type === 'application/pdf' && (
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8, color: 'var(--color-ink-muted)' }}>(optional — shown as thumbnail in gallery)</span>
                )}
              </label>
              {isCapturingFrame && (
                <p style={{ fontSize: 12, color: 'var(--color-ink-muted)' }}>Capturing first frame…</p>
              )}
              {coverPreview && !isCapturingFrame && (
                <div style={{ width: 80, height: 108, borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 8, border: '1px solid var(--color-hairline)' }}>
                  <img src={coverPreview} alt="Cover preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', cursor: 'pointer', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  {coverFile ? '↺ Change cover' : '+ Upload cover'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const blob = await openCropModal(f, 'artwork');
                      if (!blob) return;
                      const cropped = new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
                      setCoverFile(cropped);
                      if (coverPreview) URL.revokeObjectURL(coverPreview);
                      setCoverPreview(URL.createObjectURL(blob));
                    }}
                  />
                </label>
                {coverFile && (
                  <button type="button" onClick={() => { setCoverFile(null); if (coverPreview) URL.revokeObjectURL(coverPreview); setCoverPreview(null); }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-ink-muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          )}

          <div><label className="type-micro block mb-1">Title *</label><input required value={aTitle} onChange={e => setATitle(e.target.value)} placeholder="Artwork title" className="input-base" maxLength={200} /></div>
          <div><label className="type-micro block mb-1">Artist</label><input value={aArtist} onChange={e => setAArtist(e.target.value)} placeholder="Name (Year)" className="input-base" maxLength={200} /></div>
          <div>
            <label className="type-micro block mb-1">Domain</label>
            <select value={aDomain} onChange={e => { setADomain(e.target.value); if (e.target.value !== '__other__') setACustomDomain(''); }} className="input-base">
              {domainTitles.map(t => <option key={t} value={t}>{t}</option>)}
              <option value="__other__">Other (specify)...</option>
            </select>
            {aDomain === '__other__' && (
              <input value={aCustomDomain} onChange={e => setACustomDomain(e.target.value)} placeholder="Enter domain name" maxLength={100} className="input-base mt-2" />
            )}
          </div>
          {uploadError && <p className="type-micro" style={{ color: '#e5484d' }}>{uploadError}</p>}
          <button type="submit" disabled={uploading || !file} className="btn-primary w-full justify-center" style={{ opacity: uploading || !file ? 0.5 : 1 }}>
            {uploading ? <><Loader2 size={13} className="animate-spin mr-2" />Uploading…</> : 'Publish'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-3 space-y-2">
        <p className="type-micro px-1" style={{ color: 'var(--color-ink-muted)' }}>
          {featuredCount} of {artworks.length} artworks featured — these appear on the homepage
        </p>
        {artworks.map(a => (
          <div key={a.id} className="card p-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
            {a.mediaType === 'image' ? (
              <img src={a.mediaUrl} alt={a.title} className="w-9 h-9 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface-2)' }}>
                {a.mediaType === 'pdf' ? <span className="type-micro font-bold">PDF</span> : <Video size={14} style={{ color: 'var(--color-ink-muted)' }} />}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="type-body-sm truncate">{a.title}</p>
              <p className="type-micro">{a.artist} · ♥ {a.likes} · <span className="uppercase">{a.mediaType}</span></p>
            </div>
            <button
              onClick={() => handleToggleFeatured(a.id, !a.featured)}
              disabled={togglingFeatured.has(a.id)}
              className="btn-icon shrink-0"
              style={{ width: 28, height: 28, background: 'transparent', color: a.featured ? '#FFD700' : 'var(--color-ink-muted)', opacity: togglingFeatured.has(a.id) ? 0.4 : 1 }}
              title={a.featured ? 'Remove from featured' : 'Add to featured'}
            >
              <Star size={14} fill={a.featured ? '#FFD700' : 'none'} />
            </button>
            <button onClick={() => openEditArtwork(a)} className="btn-icon shrink-0" style={{ color: 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}>
              <Pencil size={12} />
            </button>
            <button onClick={() => deleteArtwork(a.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {editArtwork && (
        <div className="lg:col-span-5">
          <Modal title={`Edit Artwork — ${editArtwork.title}`} onClose={() => { if (eaCoverPreview) { URL.revokeObjectURL(eaCoverPreview); setEaCoverPreview(null); } setEditArtwork(null); }}>
            <form onSubmit={handleEditArtwork} className="space-y-3">
              <div><label className="type-micro block mb-1">Title *</label><input required value={eaTitle} onChange={e => setEaTitle(e.target.value)} className="input-base" maxLength={200} /></div>
              <div><label className="type-micro block mb-1">Artist *</label><input required value={eaArtist} onChange={e => setEaArtist(e.target.value)} className="input-base" maxLength={100} /></div>
              <div>
                <label className="type-micro block mb-1">Domain</label>
                <select value={eaDomain} onChange={e => { setEaDomain(e.target.value); if (e.target.value !== '__other__') setEaCustomDomain(''); }} className="input-base">
                  {domainTitles.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="__other__">Other (specify)...</option>
                </select>
                {eaDomain === '__other__' && (
                  <input value={eaCustomDomain} onChange={e => setEaCustomDomain(e.target.value)} placeholder="Enter domain name" maxLength={100} className="input-base mt-2" />
                )}
              </div>
              <label className="flex items-center gap-2 type-body-sm cursor-pointer">
                <input type="checkbox" checked={eaFeatured} onChange={e => setEaFeatured(e.target.checked)} />
                Mark as featured on homepage
              </label>
              <div>
                <label className="type-micro block mb-1">Replace image (optional)</label>
                <input ref={eaFileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4" className="input-base text-xs"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (f.type.startsWith('image/')) {
                      const blob = await openCropModal(f, 'artwork');
                      if (!blob) return;
                      setEaFile(new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
                    } else {
                      handleFile(f, setEaFile, setEaError);
                    }
                  }} />
              </div>
              {editArtwork.mediaType === 'image' && editArtwork.mediaUrl && (
                <img src={editArtwork.mediaUrl} alt="current" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-hairline)' }} />
              )}

              {/* Cover image — for video / PDF only */}
              {(editArtwork.mediaType === 'video' || editArtwork.mediaType === 'pdf') && (
                <div>
                  <label className="type-micro block mb-2">Cover Image</label>
                  {(eaCoverPreview || editArtwork.coverUrl) && (
                    <img src={eaCoverPreview ?? editArtwork.coverUrl!} alt="cover"
                      style={{ width: 80, height: 108, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-hairline)', marginBottom: 8, display: 'block' }} />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', cursor: 'pointer', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                      {eaCoverFile || editArtwork.coverUrl ? '↺ Change cover' : '+ Upload cover'}
                      <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          const blob = await openCropModal(f, 'artwork');
                          if (!blob) return;
                          const cropped = new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
                          setEaCoverFile(cropped);
                          if (eaCoverPreview) URL.revokeObjectURL(eaCoverPreview);
                          setEaCoverPreview(URL.createObjectURL(blob));
                        }}
                      />
                    </label>
                    {eaCoverFile && (
                      <button type="button" onClick={() => { setEaCoverFile(null); if (eaCoverPreview) URL.revokeObjectURL(eaCoverPreview); setEaCoverPreview(null); }}
                        style={{ background: 'none', border: 'none', color: 'var(--color-ink-muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}

              {eaError && <p className="type-micro" style={{ color: '#e5484d' }}>{eaError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={eaLoading} className="btn-primary flex items-center gap-2" style={{ opacity: eaLoading ? 0.6 : 1 }}>
                  {eaLoading ? <Loader2 size={13} className="animate-spin" /> : null} Save Changes
                </button>
                <button type="button" onClick={() => { if (eaCoverPreview) { URL.revokeObjectURL(eaCoverPreview); setEaCoverPreview(null); } setEditArtwork(null); }} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

    </div>
  );
}

// ── Team tab ──────────────────────────────────────────────────────────────────
function TeamTab() {
  const { team, addTeamMember, updateTeamMember, deleteTeamMember } = useAppData();
  const photoRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [addPhotoPreview, setAddPhotoPreview] = useState<string | null>(null);
  const [tName, setTName] = useState('');
  const [tDesig, setTDesig] = useState('');
  const [tYear, setTYear] = useState('');
  const [tBio, setTBio] = useState('');
  const [tColor, setTColor] = useState('#007AFF');
  const [tEmail, setTEmail] = useState('');
  const [tIG, setTIG] = useState('');
  const [tLI, setTLI] = useState('');
  const [tOrder, setTOrder] = useState('0');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Edit member modal
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const emPhotoRef = useRef<HTMLInputElement>(null);
  const [emName, setEmName] = useState('');
  const [emDesig, setEmDesig] = useState('');
  const [emYear, setEmYear] = useState('');
  const [emBio, setEmBio] = useState('');
  const [emColor, setEmColor] = useState('#007AFF');
  const [emEmail, setEmEmail] = useState('');
  const [emIG, setEmIG] = useState('');
  const [emLI, setEmLI] = useState('');
  const [emOrder, setEmOrder] = useState('0');
  const [emPhoto, setEmPhoto] = useState<File | null>(null);
  const [emPhotoPreview, setEmPhotoPreview] = useState<string | null>(null);
  const [emLoading, setEmLoading] = useState(false);
  const [emError, setEmError] = useState('');

  const handleAdd = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('name', tName); fd.append('designation', tDesig);
      if (tYear) fd.append('year', tYear);
      if (tBio) fd.append('bio', tBio);
      fd.append('color', tColor); fd.append('displayOrder', tOrder);
      if (tEmail) fd.append('socialEmail', tEmail);
      if (tIG) fd.append('socialInstagram', tIG);
      if (tLI) fd.append('socialLinkedin', tLI);
      if (photo) fd.append('photo', photo);
      await addTeamMember(fd);
      setTName(''); setTDesig(''); setTYear(''); setTBio(''); setTColor('#007AFF'); setTEmail(''); setTIG(''); setTLI('');
      setPhoto(null); if (photoRef.current) photoRef.current.value = '';
      if (addPhotoPreview) URL.revokeObjectURL(addPhotoPreview); setAddPhotoPreview(null);
    } catch (error) { setErr(String(error)); } finally { setLoading(false); }
  };

  const openEditMember = (m: TeamMember) => {
    setEditMember(m);
    setEmName(m.name); setEmDesig(m.designation); setEmYear(m.year ?? '');
    setEmBio(m.bio ?? ''); setEmColor(m.color);
    setEmEmail(m.social.email ?? ''); setEmIG(m.social.instagram ?? ''); setEmLI(m.social.linkedin ?? '');
    setEmOrder(String(m.displayOrder)); setEmPhoto(null); setEmPhotoPreview(null); setEmError('');
  };

  const handleEditMember = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editMember) return;
    console.log('=== handleEditMember called ===');
    console.log('emPhoto state:', emPhoto);
    console.log('emPhoto name:', emPhoto?.name);
    console.log('emPhoto size:', emPhoto?.size);
    console.log('emPhoto type:', emPhoto?.type);
    setEmLoading(true); setEmError('');
    try {
      const fd = new FormData();
      fd.append('name', emName); fd.append('designation', emDesig);
      if (emYear) fd.append('year', emYear);
      if (emBio) fd.append('bio', emBio);
      fd.append('color', emColor); fd.append('displayOrder', emOrder);
      if (emEmail) fd.append('socialEmail', emEmail);
      if (emIG) fd.append('socialInstagram', emIG);
      if (emLI) fd.append('socialLinkedin', emLI);
      if (emPhoto) fd.append('photo', emPhoto);
      console.log('FormData has photo?', emPhoto !== null);
      console.log('About to call updateTeamMember');
      await updateTeamMember(editMember.id, fd);
      console.log('updateTeamMember SUCCESS');
      setEditMember(null);
    } catch (error) {
      console.log('updateTeamMember FAILED:', error);
      setEmError(String(error));
    } finally { setEmLoading(false); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 card p-5 space-y-3">
        <p className="type-headline flex items-center gap-2"><Plus size={14} /> Add Member</p>
        <form onSubmit={handleAdd} className="space-y-3">
          <div><label className="type-micro block mb-1">Name *</label><input required value={tName} onChange={e => setTName(e.target.value)} className="input-base" maxLength={100} /></div>
          <div>
            <label className="type-micro block mb-1">Designation *</label>
            <select required value={tDesig} onChange={e => setTDesig(e.target.value)} className="input-base">
              <option value="">Select designation…</option>
              <option value="Coordinator">Coordinator</option>
              <option value="Secretary">Secretary</option>
              <option value="Ex-Coordinator">Ex-Coordinator</option>
              <option value="Ex-Core">Ex-Core</option>
              <option value="Faculty Advisor">Faculty Advisor</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="type-micro block mb-1">Year/Dept</label>
              <input value={tYear} onChange={e => setTYear(e.target.value)} placeholder="Y3 · CSE" className="input-base" />
              {(tDesig === 'Ex-Coordinator' || tDesig === 'Ex-Core') && (
                <p style={{ fontSize: 11, color: 'var(--color-ink-muted)', marginTop: 4 }}>Use format Y-22, Y-23, Y-24 — members are grouped by this year</p>
              )}
            </div>
            <div><label className="type-micro block mb-1">Color</label><input type="color" value={tColor} onChange={e => setTColor(e.target.value)} className="input-base h-10" /></div>
          </div>
          <div><label className="type-micro block mb-1">Bio</label><textarea value={tBio} onChange={e => setTBio(e.target.value)} rows={2} className="input-base resize-none" maxLength={500} /></div>
          <div><label className="type-micro block mb-1">Email</label><input type="email" value={tEmail} onChange={e => setTEmail(e.target.value)} className="input-base" maxLength={200} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="type-micro block mb-1">Instagram URL</label><input value={tIG} onChange={e => setTIG(e.target.value)} placeholder="#" className="input-base" maxLength={200} /></div>
            <div><label className="type-micro block mb-1">LinkedIn URL</label><input value={tLI} onChange={e => setTLI(e.target.value)} placeholder="#" className="input-base" maxLength={200} /></div>
          </div>
          <div><label className="type-micro block mb-1">Display order</label><input type="number" value={tOrder} onChange={e => setTOrder(e.target.value)} className="input-base" /></div>
          <div>
            <label className="type-micro block mb-1">Photo (optional, jpg/png/webp)</label>
            <input ref={photoRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="input-base text-xs"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const blob = await openCropModal(f, 'team');
                if (!blob) return;
                const cropped = new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
                setPhoto(cropped);
                if (addPhotoPreview) URL.revokeObjectURL(addPhotoPreview);
                setAddPhotoPreview(URL.createObjectURL(blob));
              }} />
            {addPhotoPreview && (
              <div style={{ position: 'relative', display: 'inline-block', marginTop: 8 }}>
                <img
                  src={addPhotoPreview}
                  style={{ width: 100, height: 133, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)', display: 'block' }}
                  alt="Photo preview"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const blob = await openCropModal(addPhotoPreview, 'team');
                    if (!blob) return;
                    const cropped = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
                    setPhoto(cropped);
                    if (addPhotoPreview) URL.revokeObjectURL(addPhotoPreview);
                    setAddPhotoPreview(URL.createObjectURL(blob));
                  }}
                  style={{ position: 'absolute', bottom: 6, right: 6, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}
                  title="Reframe photo"
                >✂</button>
              </div>
            )}
          </div>
          {err && <p className="type-micro" style={{ color: '#e5484d' }}>{err}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center" style={{ opacity: loading ? 0.5 : 1 }}>
            {loading ? <Loader2 size={13} className="animate-spin mr-2" /> : <Plus size={13} className="mr-2" />} Add Member
          </button>
        </form>
      </div>

      <div className="lg:col-span-3 space-y-2">
        {team.map(m => (
          <div key={m.id} className="card p-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold"
              style={{ background: `${m.color}20`, color: m.color }}>
              {m.photoUrl ? <img src={m.photoUrl} alt={m.name} className="w-9 h-9 rounded-full object-cover" /> : m.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="type-body-sm truncate">{m.name}</p>
              <p className="type-micro">{m.designation}{m.year ? ` · ${m.year}` : ''}</p>
            </div>
            <button onClick={() => openEditMember(m)} className="btn-icon shrink-0" style={{ color: 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}>
              <Pencil size={12} />
            </button>
            <button onClick={() => deleteTeamMember(m.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {editMember && (
        <div className="lg:col-span-5">
          <Modal title={`Edit Member — ${editMember.name}`} onClose={() => { setEditMember(null); if (emPhotoPreview) URL.revokeObjectURL(emPhotoPreview); setEmPhotoPreview(null); }}>
            <form onSubmit={handleEditMember} className="space-y-3">
              {(emPhotoPreview || editMember?.photoUrl) && (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={emPhotoPreview || editMember!.photoUrl!}
                    alt="Current photo"
                    style={{ width: 100, height: 133, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)', display: 'block' }}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const src = emPhotoPreview || editMember!.photoUrl!;
                      const blob = await openCropModal(src, 'team');
                      if (!blob) return;
                      const cropped = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
                      setEmPhoto(cropped);
                      if (emPhotoPreview) URL.revokeObjectURL(emPhotoPreview);
                      setEmPhotoPreview(URL.createObjectURL(blob));
                    }}
                    style={{ position: 'absolute', bottom: 6, right: 6, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}
                    title="Reframe photo"
                  >✂</button>
                </div>
              )}
              <div><label className="type-micro block mb-1">Name *</label><input required value={emName} onChange={e => setEmName(e.target.value)} className="input-base" maxLength={100} /></div>
              <div>
                <label className="type-micro block mb-1">Designation *</label>
                <select required value={emDesig} onChange={e => setEmDesig(e.target.value)} className="input-base">
                  <option value="">Select designation…</option>
                  <option value="Coordinator">Coordinator</option>
                  <option value="Secretary">Secretary</option>
                  <option value="Ex-Coordinator">Ex-Coordinator</option>
                  <option value="Ex-Core">Ex-Core</option>
                  <option value="Faculty Advisor">Faculty Advisor</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="type-micro block mb-1">Year/Dept</label>
                  <input value={emYear} onChange={e => setEmYear(e.target.value)} className="input-base" />
                  {(emDesig === 'Ex-Coordinator' || emDesig === 'Ex-Core') && (
                    <p style={{ fontSize: 11, color: 'var(--color-ink-muted)', marginTop: 4 }}>Use format Y-22, Y-23, Y-24 — members are grouped by this year</p>
                  )}
                </div>
                <div><label className="type-micro block mb-1">Color</label><input type="color" value={emColor} onChange={e => setEmColor(e.target.value)} className="input-base h-10" /></div>
              </div>
              <div><label className="type-micro block mb-1">Bio</label><textarea value={emBio} onChange={e => setEmBio(e.target.value)} rows={2} className="input-base resize-none" maxLength={500} /></div>
              <div><label className="type-micro block mb-1">Email</label><input type="email" value={emEmail} onChange={e => setEmEmail(e.target.value)} className="input-base" maxLength={200} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Instagram URL</label><input value={emIG} onChange={e => setEmIG(e.target.value)} className="input-base" maxLength={200} /></div>
                <div><label className="type-micro block mb-1">LinkedIn URL</label><input value={emLI} onChange={e => setEmLI(e.target.value)} className="input-base" maxLength={200} /></div>
              </div>
              <div><label className="type-micro block mb-1">Display order</label><input type="number" value={emOrder} onChange={e => setEmOrder(e.target.value)} className="input-base" /></div>
              <div>
                <label className="type-micro block mb-1">Replace photo (optional)</label>
                <input ref={emPhotoRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="input-base text-xs"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const blob = await openCropModal(f, 'team');
                    if (!blob) return;
                    const cropped = new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
                    console.log('=== Crop complete ===');
                    console.log('cropped file:', cropped.name, cropped.size, cropped.type);
                    setEmPhoto(cropped);
                    if (emPhotoPreview) URL.revokeObjectURL(emPhotoPreview);
                    setEmPhotoPreview(URL.createObjectURL(blob));
                    console.log('setEmPhoto called');
                  }} />
              </div>
              {emError && <p className="type-micro" style={{ color: '#e5484d' }}>{emError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={emLoading} className="btn-primary flex items-center gap-2" style={{ opacity: emLoading ? 0.6 : 1 }}>
                  {emLoading ? <Loader2 size={13} className="animate-spin" /> : null} Save Changes
                </button>
                <button type="button" onClick={() => setEditMember(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </Modal>
        </div>
      )}

    </div>
  );
}

// ── Events tab ─────────────────────────────────────────────────────────────────
function EventsTab() {
  const { events, addEvent, updateEvent, deleteEvent } = useAppData();
  const [eTitle, setETitle] = useState('');
  const [eDate, setEDate] = useState('');
  const [eTime, setETime] = useState('');
  const [eLocation, setELocation] = useState('');
  const [eContent, setEContent] = useState('');
  const [eCapacity, setECapacity] = useState('100');
  const [addingEvent, setAddingEvent] = useState(false);

  // Edit event modal
  const [editEvent, setEditEvent] = useState<ClubEvent | null>(null);
  const [eeTitle, setEeTitle] = useState('');
  const [eeDate, setEeDate] = useState('');
  const [eeTime, setEeTime] = useState('');
  const [eeLocation, setEeLocation] = useState('');
  const [eeContent, setEeContent] = useState('');
  const [eeCapacity, setEeCapacity] = useState('100');
  const [eeLoading, setEeLoading] = useState(false);
  const [eeError, setEeError] = useState('');

  const handleAdd = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (addingEvent) return;
    setAddingEvent(true);
    addEvent({ title: eTitle, date: eDate, time: eTime, location: eLocation, content: eContent, capacity: Number(eCapacity) || 100 });
    setETitle(''); setEDate(''); setETime(''); setELocation(''); setEContent('');
    setTimeout(() => setAddingEvent(false), 600);
  };

  const openEditEvent = (ev: ClubEvent) => {
    setEditEvent(ev);
    setEeTitle(ev.title); setEeDate(ev.date); setEeTime(ev.time);
    setEeLocation(ev.location); setEeContent(ev.content); setEeCapacity(String(ev.capacity));
    setEeError('');
  };

  const handleEditEvent = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editEvent) return;
    setEeLoading(true); setEeError('');
    try {
      await updateEvent(editEvent.id, { title: eeTitle, date: eeDate, time: eeTime, location: eeLocation, content: eeContent, capacity: Number(eeCapacity) || editEvent.capacity });
      setEditEvent(null);
    } catch (err) { setEeError(String(err)); } finally { setEeLoading(false); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 card p-5 space-y-3">
        <p className="type-headline flex items-center gap-2"><Plus size={14} /> Schedule Event</p>
        <form onSubmit={handleAdd} className="space-y-3">
          <div><label className="type-micro block mb-1">Title *</label><input required value={eTitle} onChange={e => setETitle(e.target.value)} className="input-base" maxLength={200} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="type-micro block mb-1">Date</label><input type="date" required value={eDate} onChange={e => setEDate(e.target.value)} className="input-base" /></div>
            <div><label className="type-micro block mb-1">Time</label><input required value={eTime} onChange={e => setETime(e.target.value)} placeholder="6–8 PM" className="input-base" /></div>
          </div>
          <div><label className="type-micro block mb-1">Location *</label><input required value={eLocation} onChange={e => setELocation(e.target.value)} className="input-base" maxLength={200} /></div>
          <div><label className="type-micro block mb-1">Description *</label><textarea required value={eContent} onChange={e => setEContent(e.target.value)} rows={3} className="input-base resize-none" maxLength={2000} /></div>
          <div><label className="type-micro block mb-1">Capacity</label><input type="number" value={eCapacity} onChange={e => setECapacity(e.target.value)} className="input-base" /></div>
          <button type="submit" disabled={addingEvent} className="btn-primary w-full justify-center" style={{ opacity: addingEvent ? 0.5 : 1 }}>
            {addingEvent ? <><Loader2 size={13} className="animate-spin mr-2" />Scheduling…</> : 'Schedule Event'}
          </button>
        </form>
      </div>
      <div className="lg:col-span-3 space-y-2">
        {events.map(ev => (
          <div key={ev.id} className="card p-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface-2)' }}>
              <CalendarDays size={12} style={{ color: 'var(--color-ink-muted)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="type-body-sm truncate">{ev.title}</p>
              <p className="type-micro">{ev.date} · {ev.registeredCount}/{ev.capacity}</p>
            </div>
            <button onClick={() => openEditEvent(ev)} className="btn-icon shrink-0" style={{ color: 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}>
              <Pencil size={12} />
            </button>
            <button onClick={() => deleteEvent(ev.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {editEvent && (
        <div className="lg:col-span-5">
          <Modal title={`Edit Event — ${editEvent.title}`} onClose={() => setEditEvent(null)}>
            <form onSubmit={handleEditEvent} className="space-y-3">
              <div><label className="type-micro block mb-1">Title *</label><input required value={eeTitle} onChange={e => setEeTitle(e.target.value)} className="input-base" maxLength={200} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Date</label><input type="date" required value={eeDate} onChange={e => setEeDate(e.target.value)} className="input-base" /></div>
                <div><label className="type-micro block mb-1">Time</label><input required value={eeTime} onChange={e => setEeTime(e.target.value)} className="input-base" /></div>
              </div>
              <div><label className="type-micro block mb-1">Location *</label><input required value={eeLocation} onChange={e => setEeLocation(e.target.value)} className="input-base" maxLength={200} /></div>
              <div><label className="type-micro block mb-1">Description *</label><textarea required value={eeContent} onChange={e => setEeContent(e.target.value)} rows={3} className="input-base resize-none" maxLength={2000} /></div>
              <div><label className="type-micro block mb-1">Capacity</label><input type="number" value={eeCapacity} onChange={e => setEeCapacity(e.target.value)} className="input-base" /></div>
              {eeError && <p className="type-micro" style={{ color: '#e5484d' }}>{eeError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={eeLoading} className="btn-primary flex items-center gap-2" style={{ opacity: eeLoading ? 0.6 : 1 }}>
                  {eeLoading ? <Loader2 size={13} className="animate-spin" /> : null} Save Changes
                </button>
                <button type="button" onClick={() => setEditEvent(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </Modal>
        </div>
      )}
    </div>
  );
}

// ── Comments tab ──────────────────────────────────────────────────────────────
function CommentsTab() {
  const { artworks, deleteComment } = useAppData();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleDelete = async (artworkId: string, commentId: string) => {
    setDeletingId(commentId);
    try {
      await deleteComment(artworkId, commentId);
      setConfirmId(null);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const allComments = artworks.flatMap(artwork =>
    artwork.comments.map(comment => ({
      ...comment,
      artworkId: artwork.id,
      artworkTitle: artwork.title,
      artworkArtist: artwork.artist,
    }))
  );

  const totalComments = allComments.length;
  const artworksWithComments = artworks.filter(a => a.comments.length > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="type-headline">Comments</p>
          <p className="type-micro" style={{ color: 'var(--color-ink-muted)', marginTop: 2 }}>
            {totalComments} comment{totalComments !== 1 ? 's' : ''} across {artworksWithComments} artwork{artworksWithComments !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {allComments.length === 0 ? (
        <p className="type-caption text-center py-12" style={{ color: 'var(--color-ink-muted)' }}>No comments yet.</p>
      ) : (
        <div className="space-y-2">
          {allComments.map(comment => (
            <div key={comment.id} className="card p-3 flex items-start gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
              <div className="flex-1 min-w-0">
                <p className="type-micro truncate" style={{ color: 'var(--color-ink-muted)', marginBottom: 2 }}>
                  <span style={{ fontWeight: 600 }}>{comment.artworkTitle}</span>
                  <span> · {comment.artworkArtist}</span>
                </p>
                <p className="type-body-sm" style={{ marginBottom: 2 }}>"{comment.text}"</p>
                <p className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>
                  — {comment.sender}{comment.date ? ` · ${comment.date}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {confirmId === comment.id ? (
                  <>
                    <span className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>Delete?</span>
                    <button
                      onClick={() => handleDelete(comment.artworkId, comment.id)}
                      disabled={deletingId === comment.id}
                      className="type-micro"
                      style={{ color: '#e5484d', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', opacity: deletingId === comment.id ? 0.5 : 1 }}
                    >
                      {deletingId === comment.id ? '…' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="type-micro"
                      style={{ color: 'var(--color-ink-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmId(comment.id)}
                    className="btn-icon shrink-0"
                    title="Delete comment"
                    style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main AdminPage ─────────────────────────────────────────────────────────────
export function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('academy');

  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'academy',  label: 'Academy',  icon: Video },
    { id: 'gallery',  label: 'Gallery',  icon: Image },
    { id: 'team',     label: 'Team',     icon: Users },
    { id: 'events',   label: 'Events',   icon: CalendarDays },
    { id: 'comments', label: 'Comments', icon: MessageSquare },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '5rem', paddingBottom: '5rem' }}>
      <ImageCropperPortal />
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 48px' }}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--color-surface-1)' }}>
              <Shield size={16} style={{ color: 'var(--color-ink-muted)' }} />
            </div>
            <div><h1 className="type-headline">Admin Dashboard</h1><p className="type-micro">DnA Club CMS</p></div>
          </div>
          <button onClick={() => { clearAdminToken(); setAuthed(false); }} className="btn-secondary flex items-center gap-2">
            <X size={13} /> Exit
          </button>
        </motion.div>

        <div className="flex flex-wrap gap-2 mb-8">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-full type-body-sm transition-all"
                style={tab === t.id
                  ? { background: 'var(--color-surface-2)', color: 'var(--color-ink)', borderRadius: 'var(--radius-pill)' }
                  : { background: 'var(--color-surface-1)', color: 'var(--color-ink-muted)', borderRadius: 'var(--radius-pill)' }}>
                <Icon size={14} />{t.label}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {tab === 'academy' && <motion.div key="academy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><AcademyTab /></motion.div>}
          {tab === 'gallery' && <motion.div key="gallery" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><GalleryTab /></motion.div>}
          {tab === 'team'    && <motion.div key="team"    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><TeamTab /></motion.div>}
          {tab === 'events'   && <motion.div key="events"    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><EventsTab /></motion.div>}
          {tab === 'comments' && <motion.div key="comments"  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><CommentsTab /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  );
}
