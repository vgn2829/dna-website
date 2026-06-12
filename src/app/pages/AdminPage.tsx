import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Lock, Plus, Trash2, Video, Image, CalendarDays, X, Eye, EyeOff, Users, ChevronDown, Upload, Loader2, Globe } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { api, setAdminToken, clearAdminToken } from '../lib/api';

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

type Tab = 'academy' | 'gallery' | 'team' | 'events';

// ── Academy tab ──────────────────────────────────────────────────────────────
function AcademyTab() {
  const { domains, addDomain, deleteDomain, addVideo, deleteVideo, updateVideoSequence } = useAppData();
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

  const handleAddDomain = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setDLoading(true);
    try {
      await addDomain({ title: dTitle, fullName: dFullName || dTitle, icon: dIcon, tagline: dTagline, description: dDesc, color: dColor });
      setDTitle(''); setDFullName(''); setDTagline(''); setDDesc(''); setDColor('#007AFF');
      setShowNewDomain(false);
    } catch (err) { alert(String(err)); } finally { setDLoading(false); }
  };

  // New video form
  const [vTitle, setVTitle] = useState('');
  const [vUrl, setVUrl] = useState('');
  const [vDiff, setVDiff] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [vDur, setVDur] = useState('');
  const [vSeq, setVSeq] = useState('');

  const handleAddVideo = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!activeDomain) return;
    const seqParsed = parseInt(vSeq, 10);
    const seq = vSeq && seqParsed >= 1 ? seqParsed : undefined;
    addVideo(activeDomain, { title: vTitle, ytUrl: vUrl, ytId: '', difficulty: vDiff, duration: vDur || '15 mins', sequence: seq });
    setVTitle(''); setVUrl(''); setVDur(''); setVSeq('');
  };

  const domain = domains[activeDomain];

  return (
    <div className="space-y-6">
      {/* Domain list */}
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
                <div><label className="type-micro block mb-1">Title *</label><input required value={dTitle} onChange={e => setDTitle(e.target.value)} placeholder="Motion Design" className="input-base" /></div>
                <div><label className="type-micro block mb-1">Full Name</label><input value={dFullName} onChange={e => setDFullName(e.target.value)} placeholder="Motion Design & Animation" className="input-base" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Icon class</label><input value={dIcon} onChange={e => setDIcon(e.target.value)} placeholder="fa-video" className="input-base" /></div>
                <div><label className="type-micro block mb-1">Color</label><input type="color" value={dColor} onChange={e => setDColor(e.target.value)} className="input-base h-10" /></div>
              </div>
              <div><label className="type-micro block mb-1">Tagline</label><input value={dTagline} onChange={e => setDTagline(e.target.value)} placeholder="Short tagline…" className="input-base" /></div>
              <div><label className="type-micro block mb-1">Description</label><textarea value={dDesc} onChange={e => setDDesc(e.target.value)} rows={2} className="input-base resize-none" /></div>
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
          {/* Add video form */}
          <div className="lg:col-span-2 card p-5 space-y-3">
            <p className="type-headline flex items-center gap-2"><Plus size={14} /> Add Video to {domain.title}</p>
            <form onSubmit={handleAddVideo} className="space-y-3">
              <div><label className="type-micro block mb-1">Title *</label><input required value={vTitle} onChange={e => setVTitle(e.target.value)} placeholder="Tutorial title" className="input-base" /></div>
              <div><label className="type-micro block mb-1">YouTube URL or ID *</label><input required value={vUrl} onChange={e => setVUrl(e.target.value)} placeholder="https://youtu.be/… or 11-char ID" className="input-base" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="type-micro block mb-1">Difficulty</label>
                  <select value={vDiff} onChange={e => setVDiff(e.target.value as 'Beginner' | 'Intermediate' | 'Advanced')} className="input-base">
                    {['Beginner','Intermediate','Advanced'].map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div><label className="type-micro block mb-1">Duration</label><input value={vDur} onChange={e => setVDur(e.target.value)} placeholder="15 mins" className="input-base" /></div>
              </div>
              <div><label className="type-micro block mb-1">Sequence <span style={{ color: 'var(--color-ink-muted)' }}>(blank = append to end)</span></label><input type="number" min={1} value={vSeq} onChange={e => setVSeq(e.target.value)} placeholder="auto" className="input-base" /></div>
              <button type="submit" className="btn-primary w-full justify-center">Add Video</button>
            </form>
          </div>

          {/* Video list */}
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
                  <button onClick={() => deleteVideo(activeDomain, v.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Gallery tab ───────────────────────────────────────────────────────────────
function GalleryTab() {
  const { artworks, uploadArtwork, deleteArtwork, domains } = useAppData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [aTitle, setATitle] = useState('');
  const [aArtist, setAArtist] = useState('');
  const [aDomain, setADomain] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const MAX_MB = 50;
  const ALLOWED_EXT = ['jpg','jpeg','png','webp','gif','pdf','mp4'];

  const handleFile = (f: File | null) => {
    if (!f) { setFile(null); return; }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXT.includes(ext)) { setUploadError(`Unsupported type. Allowed: ${ALLOWED_EXT.join(', ')}`); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setUploadError(`File exceeds ${MAX_MB} MB`); return; }
    setUploadError('');
    setFile(f);
  };

  const handleUpload = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', aTitle);
      fd.append('artist', aArtist);
      fd.append('domain', aDomain || Object.values(domains)[0]?.title || 'General');
      await uploadArtwork(fd);
      setFile(null); setATitle(''); setAArtist('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) { setUploadError(String(err)); } finally { setUploading(false); }
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
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0] ?? null); }}
            >
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4" className="sr-only"
                onChange={e => handleFile(e.target.files?.[0] ?? null)} />
              {file ? (
                <p className="type-body-sm truncate">{file.name} <span className="type-micro">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></p>
              ) : (
                <p className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>Click or drag & drop</p>
              )}
            </div>
          </div>
          <div><label className="type-micro block mb-1">Title *</label><input required value={aTitle} onChange={e => setATitle(e.target.value)} placeholder="Artwork title" className="input-base" /></div>
          <div><label className="type-micro block mb-1">Artist *</label><input required value={aArtist} onChange={e => setAArtist(e.target.value)} placeholder="Name (Year)" className="input-base" /></div>
          <div>
            <label className="type-micro block mb-1">Domain</label>
            <select value={aDomain} onChange={e => setADomain(e.target.value)} className="input-base">
              {Object.values(domains).map(d => <option key={d.id} value={d.title}>{d.title}</option>)}
            </select>
          </div>
          {uploadError && <p className="type-micro" style={{ color: '#e5484d' }}>{uploadError}</p>}
          <button type="submit" disabled={uploading || !file} className="btn-primary w-full justify-center" style={{ opacity: uploading || !file ? 0.5 : 1 }}>
            {uploading ? <><Loader2 size={13} className="animate-spin mr-2" />Uploading…</> : 'Publish'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-3 space-y-2">
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
            <button onClick={() => deleteArtwork(a.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Team tab ──────────────────────────────────────────────────────────────────
function TeamTab() {
  const { team, addTeamMember, deleteTeamMember } = useAppData();
  const photoRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
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

  const handleAdd = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('name', tName);
      fd.append('designation', tDesig);
      if (tYear)  fd.append('year', tYear);
      if (tBio)   fd.append('bio', tBio);
      fd.append('color', tColor);
      fd.append('displayOrder', tOrder);
      if (tEmail) fd.append('socialEmail', tEmail);
      if (tIG)    fd.append('socialInstagram', tIG);
      if (tLI)    fd.append('socialLinkedin', tLI);
      if (photo)  fd.append('photo', photo);
      await addTeamMember(fd);
      setTName(''); setTDesig(''); setTYear(''); setTBio(''); setTEmail(''); setTIG(''); setTLI('');
      setPhoto(null); if (photoRef.current) photoRef.current.value = '';
    } catch (error) { setErr(String(error)); } finally { setLoading(false); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 card p-5 space-y-3">
        <p className="type-headline flex items-center gap-2"><Plus size={14} /> Add Member</p>
        <form onSubmit={handleAdd} className="space-y-3">
          <div><label className="type-micro block mb-1">Name *</label><input required value={tName} onChange={e => setTName(e.target.value)} className="input-base" /></div>
          <div><label className="type-micro block mb-1">Designation *</label><input required value={tDesig} onChange={e => setTDesig(e.target.value)} placeholder="Club Coordinator" className="input-base" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="type-micro block mb-1">Year/Dept</label><input value={tYear} onChange={e => setTYear(e.target.value)} placeholder="Y3 · CSE" className="input-base" /></div>
            <div><label className="type-micro block mb-1">Color</label><input type="color" value={tColor} onChange={e => setTColor(e.target.value)} className="input-base h-10" /></div>
          </div>
          <div><label className="type-micro block mb-1">Bio</label><textarea value={tBio} onChange={e => setTBio(e.target.value)} rows={2} className="input-base resize-none" /></div>
          <div><label className="type-micro block mb-1">Email</label><input type="email" value={tEmail} onChange={e => setTEmail(e.target.value)} className="input-base" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="type-micro block mb-1">Instagram URL</label><input value={tIG} onChange={e => setTIG(e.target.value)} placeholder="#" className="input-base" /></div>
            <div><label className="type-micro block mb-1">LinkedIn URL</label><input value={tLI} onChange={e => setTLI(e.target.value)} placeholder="#" className="input-base" /></div>
          </div>
          <div><label className="type-micro block mb-1">Display order</label><input type="number" value={tOrder} onChange={e => setTOrder(e.target.value)} className="input-base" /></div>
          <div>
            <label className="type-micro block mb-1">Photo (optional, jpg/png/webp)</label>
            <input ref={photoRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="input-base text-xs" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
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
            <button onClick={() => deleteTeamMember(m.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Events tab ─────────────────────────────────────────────────────────────────
function EventsTab() {
  const { events, addEvent, deleteEvent } = useAppData();
  const [eTitle, setETitle] = useState('');
  const [eDate, setEDate] = useState('');
  const [eTime, setETime] = useState('');
  const [eLocation, setELocation] = useState('');
  const [eContent, setEContent] = useState('');
  const [eCapacity, setECapacity] = useState('100');

  const handleAdd = (e: React.SyntheticEvent) => {
    e.preventDefault();
    addEvent({ title: eTitle, date: eDate, time: eTime, location: eLocation, content: eContent, capacity: Number(eCapacity) || 100 });
    setETitle(''); setEDate(''); setETime(''); setELocation(''); setEContent('');
  };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 card p-5 space-y-3">
        <p className="type-headline flex items-center gap-2"><Plus size={14} /> Schedule Event</p>
        <form onSubmit={handleAdd} className="space-y-3">
          <div><label className="type-micro block mb-1">Title *</label><input required value={eTitle} onChange={e => setETitle(e.target.value)} className="input-base" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="type-micro block mb-1">Date</label><input type="date" required value={eDate} onChange={e => setEDate(e.target.value)} className="input-base" /></div>
            <div><label className="type-micro block mb-1">Time</label><input required value={eTime} onChange={e => setETime(e.target.value)} placeholder="6–8 PM" className="input-base" /></div>
          </div>
          <div><label className="type-micro block mb-1">Location *</label><input required value={eLocation} onChange={e => setELocation(e.target.value)} className="input-base" /></div>
          <div><label className="type-micro block mb-1">Description *</label><textarea required value={eContent} onChange={e => setEContent(e.target.value)} rows={3} className="input-base resize-none" /></div>
          <div><label className="type-micro block mb-1">Capacity</label><input type="number" value={eCapacity} onChange={e => setECapacity(e.target.value)} className="input-base" /></div>
          <button type="submit" className="btn-primary w-full justify-center">Schedule Event</button>
        </form>
      </div>
      <div className="lg:col-span-3 space-y-2">
        {events.map(e => (
          <div key={e.id} className="card p-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface-2)' }}>
              <CalendarDays size={12} style={{ color: 'var(--color-ink-muted)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="type-body-sm truncate">{e.title}</p>
              <p className="type-micro">{e.date} · {e.registeredCount}/{e.capacity}</p>
            </div>
            <button onClick={() => deleteEvent(e.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main AdminPage ─────────────────────────────────────────────────────────────
export function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('academy');

  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'academy', label: 'Academy',  icon: Video },
    { id: 'gallery', label: 'Gallery',  icon: Image },
    { id: 'team',    label: 'Team',     icon: Users },
    { id: 'events',  label: 'Events',   icon: CalendarDays },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '5rem', paddingBottom: '5rem' }}>
      <div className="max-w-5xl mx-auto px-6">
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
          {tab === 'events'  && <motion.div key="events"  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><EventsTab /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  );
}
