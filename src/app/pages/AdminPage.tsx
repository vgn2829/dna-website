import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Lock, Plus, Trash2, Video, Image, CalendarDays, X, Eye, EyeOff, Users, Upload, Loader2, Pencil, Star, MessageSquare, Settings, GripVertical, Mail, Radio, Layout, Send, TriangleAlert } from 'lucide-react';
import { useAppData, type Artwork, type TeamMember, type ClubEvent, type Domain, type VideoResource } from '../context/AppDataContext';
import { api, setAdminToken, clearAdminToken, type SessionJoins, type CoordinatorMember, type EventRegistrants } from '../lib/api';
import { openCropModal, ImageCropperPortal } from '../components/ImageCropper';
import imageCompression from 'browser-image-compression';

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const result = await imageCompression(file, {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    });
    // browser-image-compression returns a Blob with .name patched on, not a real File.
    // FormData ignores a patched .name on a plain Blob and sends filename="blob",
    // which the backend rejects as an unsupported extension. Re-wrap as a true File.
    if (result instanceof File) return result;
    return new File([result], file.name, { type: result.type || file.type });
  } catch (e) {
    console.warn('Image compression failed, uploading original:', e);
    return file; // never block the upload because compression failed
  }
}

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

// Small pill showing whether students have been notified about a record yet.
function NotifiedBadge({ notifiedAt }: { notifiedAt: string | null }) {
  const sent = notifiedAt !== null;
  return (
    <span
      className="type-micro"
      title={sent ? `Notified ${new Date(notifiedAt).toLocaleString('en-IN')}` : 'Students have not been notified yet'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
        background: sent ? 'rgba(46,160,67,0.12)' : 'var(--color-surface-2)',
        color: sent ? '#2ea043' : 'var(--color-ink-muted)',
        border: `1px solid ${sent ? 'rgba(46,160,67,0.35)' : 'var(--color-hairline)'}`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: sent ? '#2ea043' : 'var(--color-ink-muted)' }} />
      {sent ? 'Sent' : 'Not sent'}
    </span>
  );
}

type NotifyPreview = { subject: string; html: string; recipientCount: number };

// Confirm-before-send dialog for the manual "Notify Students" action. Loads the
// exact email + recipient count (so the admin sees what goes out and to how many),
// warns when re-sending an already-notified record, then triggers the send.
function NotifyDialog({
  kind, item, onClose, fetchPreview, onSend,
}: {
  kind: 'event' | 'artwork';
  item: { id: string; title: string; notifiedAt: string | null };
  onClose: () => void;
  fetchPreview: (id: string) => Promise<NotifyPreview>;
  onSend: (id: string) => Promise<string>;
}) {
  const [preview, setPreview] = useState<NotifyPreview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const alreadySent = item.notifiedAt !== null;
  const count = preview?.recipientCount;

  useEffect(() => {
    let cancelled = false;
    fetchPreview(item.id)
      .then(p => { if (!cancelled) setPreview(p); })
      .catch(e => { if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Failed to load preview'); });
    return () => { cancelled = true; };
  }, [item.id, fetchPreview]);

  const handleSend = async () => {
    setSending(true);
    setSendErr(null);
    try {
      await onSend(item.id);
      onClose();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Failed to send notification');
      setSending(false);
    }
  };

  const noStudents = count === 0;
  const sendLabel = alreadySent ? 'Re-send' : 'Send';
  const canSend = preview !== null && !noStudents && !sending;

  return (
    <Modal title={`Notify students — ${item.title}`} onClose={onClose}>
      <div className="space-y-3">
        {alreadySent && (
          <div className="flex items-start gap-2 p-3" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
            <TriangleAlert size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
            <p className="type-micro" style={{ color: 'var(--color-ink)', margin: 0 }}>
              Already sent on <strong>{new Date(item.notifiedAt!).toLocaleString('en-IN')}</strong>. Sending again will email every registered student a second time.
            </p>
          </div>
        )}

        {loadErr ? (
          <p className="type-body-sm" style={{ color: '#e5484d' }}>{loadErr}</p>
        ) : !preview ? (
          <div className="flex items-center gap-2 type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
            <Loader2 size={14} className="animate-spin" /> Loading preview…
          </div>
        ) : (
          <>
            <p className="type-body-sm" style={{ margin: 0 }}>
              {noStudents
                ? 'No registered students have an email on file — there is no one to notify yet.'
                : <>This will email all <strong>{count}</strong> registered student{count === 1 ? '' : 's'}.</>}
            </p>
            <div>
              <p className="type-micro" style={{ marginBottom: 4, color: 'var(--color-ink-muted)' }}>Subject</p>
              <p className="type-body-sm" style={{ margin: 0 }}>{preview.subject}</p>
            </div>
            <div>
              <p className="type-micro" style={{ marginBottom: 4, color: 'var(--color-ink-muted)' }}>Preview</p>
              <iframe
                title="Email preview"
                srcDoc={preview.html}
                sandbox=""
                style={{ width: '100%', height: 280, border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: '#fff' }}
              />
            </div>
          </>
        )}

        {sendErr && <p className="type-micro" style={{ color: '#e5484d' }}>{sendErr}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="btn-primary flex items-center gap-2"
            style={{ opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed' }}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {noStudents ? 'No recipients' : count !== undefined ? `${sendLabel} to ${count} student${count === 1 ? '' : 's'}` : sendLabel}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={sending}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// Escape a field for CSV: quote it and double any interior quotes whenever it
// contains a comma, quote, or newline that would otherwise break the file.
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Registrant list + export for a single event. Mirrors SessionsTab's attendee
// panel (joins list) but as a modal, since EventsTab is single-column.
function RegistrantsModal({ event, onClose }: { event: ClubEvent; onClose: () => void }) {
  const [data, setData] = useState<EventRegistrants | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.events.registrants(event.id)
      .then(r => { if (!cancelled) setData(r); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load registrants'); });
    return () => { cancelled = true; };
  }, [event.id]);

  const rsvpTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

  const rows = () => (data?.registrants ?? []).map(r => [r.name ?? 'Unknown', r.roll_number, r.email ?? '', rsvpTime(r.rsvped_at)]);

  const handleDownloadCsv = () => {
    const header = ['Name', 'Roll Number', 'Email', 'RSVP Time'];
    const lines = [header, ...rows()].map(row => row.map(csvField).join(','));
    downloadBlob(`dna-${event.id}-registrants.csv`, lines.join('\n'), 'text/csv');
  };

  const handleCopyTsv = async () => {
    const header = ['Name', 'Roll Number', 'Email', 'RSVP Time'];
    const lines = [header, ...rows()].map(row => row.join('\t'));
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title={`Registrants — ${event.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="type-body-sm" style={{ margin: 0 }}>
            {data ? `${data.count} of ${event.capacity} registered` : 'Loading…'}
          </p>
          {data && data.count > 0 && (
            <div className="flex gap-2">
              <button type="button" onClick={handleDownloadCsv} className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
                Download CSV
              </button>
              <button type="button" onClick={handleCopyTsv} className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>

        {error ? (
          <p className="type-body-sm" style={{ color: '#e5484d' }}>{error}</p>
        ) : !data ? (
          <div className="flex items-center gap-2 type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
            <Loader2 size={14} className="animate-spin" /> Loading registrants…
          </div>
        ) : data.registrants.length === 0 ? (
          <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>No one has registered yet.</p>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)' }}>
            {data.registrants.map((r, i) => (
              <div
                key={r.roll_number}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < data.registrants.length - 1 ? '1px solid var(--color-hairline)' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className="type-body-sm" style={{ fontWeight: 600 }}>{r.name ?? 'Unknown'}</span>
                  <span className="type-micro">{r.roll_number}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', flexShrink: 0 }}>
                  <span className="type-micro" style={{ wordBreak: 'break-all', textAlign: 'right' }}>{r.email ?? '—'}</span>
                  <span className="type-micro" style={{ whiteSpace: 'nowrap' }}>{rsvpTime(r.rsvped_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

type Tab = 'academy' | 'gallery' | 'team' | 'events' | 'comments' | 'settings' | 'announcements' | 'sessions' | 'moodboards';

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

interface BulkItem {
  id: string;
  file: File;
  preview: string;
  title: string;
  artist: string;
  domain: string;
  customDomain: string;
  featured: boolean;
  status: 'pending' | 'capturing' | 'uploading' | 'done' | 'error';
  error: string;
  coverFile: File | null;
  coverPreview: string | null;
}

// ── Gallery tab ───────────────────────────────────────────────────────────────
function GalleryTab() {
  const { artworks, uploadArtwork, updateArtwork, deleteArtwork, toggleFeatured, notifyArtwork, domains } = useAppData();
  const [notifyItem, setNotifyItem] = useState<Artwork | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [aTitle, setATitle] = useState('');
  const [aArtist, setAArtist] = useState('');
  const [aDomain, setADomain] = useState('');
  const [aCustomDomain, setACustomDomain] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

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

  const domainTitles = Object.values(domains).map(d => d.title.toUpperCase());
  const featuredCount = artworks.filter(a => a.featured).length;

  const [bulkQueue, setBulkQueue] = useState<BulkItem[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [forceUpper, setForceUpper] = useState(() => localStorage.getItem('forceUppercase') !== 'false');

  useEffect(() => {
    const handleStorage = () => {
      setForceUpper(localStorage.getItem('forceUppercase') !== 'false');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
      fd.append('file', await compressImage(file));
      fd.append('title', aTitle);
      fd.append('artist', aArtist);
      const domainVal = aDomain === '__other__' ? aCustomDomain : (aDomain || domainTitles[0] || 'General');
      fd.append('domain', domainVal);
      if (coverFile) fd.append('cover', await compressImage(coverFile));
      await uploadArtwork(fd);
      setFile(null); setATitle(''); setAArtist(''); setADomain(''); setACustomDomain('');
      setCoverFile(null); if (coverPreview) URL.revokeObjectURL(coverPreview); setCoverPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      setUploadSuccess('Artwork published · use Notify Students to email members');
      setTimeout(() => setUploadSuccess(''), 4000);
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
      if (eaFile) fd.append('file', await compressImage(eaFile));
      if (eaCoverFile) fd.append('cover', await compressImage(eaCoverFile));
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

  const parseFilename = (filename: string) => {
    const base = filename.replace(/\.[^/.]+$/, '');
    const parts = base.split('_');
    if (parts.length === 1) return { title: parts[0].toUpperCase(), artist: '' };
    const artist = parts[parts.length - 1].replace(/-/g, ' ').toUpperCase();
    const title = parts.slice(0, -1).join(' ').toUpperCase();
    return { title, artist };
  };

  const handleBulkFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    if (files.length === 1) return;

    setBulkMode(true);

    const items: BulkItem[] = files
      .filter(f => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        return ALLOWED_EXT.includes(ext) && f.size <= MAX_MB * 1024 * 1024;
      })
      .map(file => {
        const { title, artist } = parseFilename(file.name);
        return {
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          file,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
          title,
          artist,
          domain: domainTitles[0] || 'General',
          customDomain: '',
          featured: false,
          status: 'pending' as const,
          error: '',
          coverFile: null,
          coverPreview: null,
        };
      });

    setBulkQueue(items);

    items.forEach(async (item, idx) => {
      if (!item.file.type.startsWith('video/')) return;

      setBulkQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'capturing' as const } : q));

      try {
        const frameBlob = await captureVideoFirstFrame(item.file);
        const coverFile = new File([frameBlob], 'cover.jpg', { type: 'image/jpeg' });
        const coverPreview = URL.createObjectURL(frameBlob);
        const videoPreview = URL.createObjectURL(item.file);
        setBulkQueue(prev => prev.map((q, i) =>
          i === idx ? { ...q, status: 'pending' as const, coverFile, coverPreview, preview: videoPreview } : q
        ));
      } catch {
        setBulkQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'pending' as const } : q));
      }
    });
  };

  const updateBulkItem = (id: string, updates: Partial<BulkItem>) => {
    setBulkQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const removeBulkItem = (id: string) => {
    setBulkQueue(prev => {
      const item = prev.find(q => q.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      if (item?.coverPreview) URL.revokeObjectURL(item.coverPreview);
      return prev.filter(q => q.id !== id);
    });
  };

  const clearBulkQueue = () => {
    setBulkQueue(prev => {
      prev.forEach(item => {
        if (item.preview) URL.revokeObjectURL(item.preview);
        if (item.coverPreview) URL.revokeObjectURL(item.coverPreview);
      });
      return [];
    });
    setBulkMode(false);
  };

  const publishAll = async () => {
    setBulkUploading(true);

    for (const item of bulkQueue) {
      if (item.status !== 'pending') continue;
      updateBulkItem(item.id, { status: 'uploading' });
      try {
        const fd = new FormData();
        fd.append('file', await compressImage(item.file));
        fd.append('title', item.title.trim() || item.file.name);
        fd.append('artist', item.artist.trim());
        fd.append('domain', item.domain === '__other__' ? (item.customDomain || 'General') : (item.domain || domainTitles[0] || 'General'));
        fd.append('featured', String(item.featured));
        if (item.coverFile) fd.append('cover', await compressImage(item.coverFile));
        await uploadArtwork(fd);
        updateBulkItem(item.id, { status: 'done' });
      } catch (err) {
        updateBulkItem(item.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }

    setBulkUploading(false);

    setTimeout(() => {
      setBulkQueue(prev => {
        const remaining = prev.filter(q => q.status !== 'done');
        if (remaining.length === 0) {
          prev.forEach(item => {
            if (item.preview) URL.revokeObjectURL(item.preview);
            if (item.coverPreview) URL.revokeObjectURL(item.coverPreview);
          });
          setBulkMode(false);
        }
        return remaining;
      });
    }, 2000);
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
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4" multiple className="sr-only"
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) { e.target.value = ''; return; }
                  if (files.length > 1) { await handleBulkFiles(e); return; }
                  const f = files[0];
                  if (!f) { e.target.value = ''; return; }
                  e.target.value = '';
                  const parsed = parseFilename(f.name);
                  if (!aTitle || aTitle.trim() === '') setATitle(parsed.title);
                  if (!aArtist || aArtist.trim() === '') setAArtist(parsed.artist);
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
            <div style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontStyle: 'italic', lineHeight: 1.7, marginTop: 4 }}>
              💡 Name files as <strong style={{ fontStyle: 'normal' }}>title_artist.ext</strong> for auto-fill. Use hyphens for spaces in artist name.
              <div style={{ marginTop: 4 }}>
                <div>• sunset_john-doe.jpg → SUNSET / JOHN DOE</div>
                <div>• hell_v_pie_utham.jpg → HELL V PIE / UTHAM</div>
                <div>• doomsday.png → DOOMSDAY / (empty artist)</div>
              </div>
            </div>
          </div>

          {/* Bulk queue UI — shown when multiple files selected */}
          {bulkMode && bulkQueue.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', margin: 0, fontFamily: 'var(--font-body)' }}>
                    {bulkQueue.length} files selected
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--color-ink-muted)', margin: '2px 0 0', fontFamily: 'var(--font-body)' }}>
                    Edit titles and artists before publishing
                  </p>
                </div>
                <button type="button" onClick={clearBulkQueue} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                  Clear all
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
                {bulkQueue.map((item) => (
                  <div key={item.id} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: item.status === 'done' ? 0.5 : 1, transition: 'opacity 0.3s' }}>
                    <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0, background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {item.coverPreview || item.preview ? (
                        <img src={item.coverPreview || item.preview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                      ) : (
                        <span style={{ fontSize: 18, color: 'var(--color-ink-muted)' }}>
                          {item.file.type === 'application/pdf' ? '📄' : '🎬'}
                        </span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        className="input-base"
                        value={item.title}
                        onChange={e => updateBulkItem(item.id, { title: forceUpper ? e.target.value.toUpperCase() : e.target.value })}
                        placeholder="Title"
                        disabled={item.status === 'uploading' || item.status === 'done'}
                        style={{ width: '100%', marginBottom: 6, fontSize: 13, boxSizing: 'border-box' }}
                        maxLength={200}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          className="input-base"
                          value={item.artist}
                          onChange={e => updateBulkItem(item.id, { artist: forceUpper ? e.target.value.toUpperCase() : e.target.value })}
                          placeholder="Artist (optional)"
                          disabled={item.status === 'uploading' || item.status === 'done'}
                          style={{ flex: 1, fontSize: 12, boxSizing: 'border-box' }}
                          maxLength={100}
                        />
                        <select
                          className="input-base"
                          value={item.domain}
                          onChange={e => updateBulkItem(item.id, { domain: e.target.value, customDomain: e.target.value !== '__other__' ? '' : item.customDomain })}
                          disabled={item.status === 'uploading' || item.status === 'done'}
                          style={{ flex: 1, fontSize: 12 }}
                        >
                          {domainTitles.map(t => <option key={t} value={t}>{t}</option>)}
                          <option value="__other__">Other…</option>
                        </select>
                      </div>
                      {item.domain === '__other__' && (
                        <input
                          className="input-base"
                          value={item.customDomain}
                          onChange={e => updateBulkItem(item.id, { customDomain: e.target.value.toUpperCase() })}
                          placeholder="ENTER CUSTOM DOMAIN..."
                          disabled={item.status === 'uploading' || item.status === 'done'}
                          style={{ marginTop: 6, width: '100%', fontSize: 12, boxSizing: 'border-box' }}
                          maxLength={100}
                        />
                      )}
                      {item.status === 'error' && item.error && (
                        <p style={{ fontSize: 11, color: 'var(--color-error)', margin: '4px 0 0', fontFamily: 'var(--font-body)' }}>{item.error}</p>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {item.status === 'pending' && (
                        <button type="button" onClick={() => removeBulkItem(item.id)} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-surface-2)', border: 'none', cursor: 'pointer', color: 'var(--color-ink-muted)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      )}
                      {item.status === 'capturing' && <span style={{ fontSize: 10, color: 'var(--color-ink-muted)' }}>⏳</span>}
                      {item.status === 'uploading' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />}
                      {item.status === 'done' && <span style={{ fontSize: 14, color: '#4ade80' }}>✓</span>}
                      {item.status === 'error' && <span style={{ fontSize: 14, color: 'var(--color-error)' }}>✗</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={publishAll}
                  disabled={bulkUploading || bulkQueue.every(q => q.status !== 'pending') || bulkQueue.some(q => q.status === 'capturing')}
                  className="btn-primary"
                  style={{ flex: 1, opacity: (bulkUploading || bulkQueue.every(q => q.status !== 'pending') || bulkQueue.some(q => q.status === 'capturing')) ? 0.5 : 1 }}
                >
                  {bulkUploading
                    ? `Uploading… (${bulkQueue.filter(q => q.status === 'done').length}/${bulkQueue.length})`
                    : `Publish All (${bulkQueue.filter(q => q.status === 'pending').length} pending)`
                  }
                </button>
                <button type="button" onClick={clearBulkQueue} className="btn-secondary" disabled={bulkUploading}>Cancel</button>
              </div>
              <p style={{ fontSize: 10, color: 'var(--color-ink-muted)', margin: '8px 0 0', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                💡 Name files as <em>Title_ArtistName.jpg</em> for auto-fill. Underscores and hyphens become spaces.
              </p>
            </div>
          )}

          {/* Single upload fields — hidden when bulk mode active */}
          {!bulkMode && (
            <>
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

              <div><label className="type-micro block mb-1">Title *</label><input required value={aTitle} onChange={e => setATitle(forceUpper ? e.target.value.toUpperCase() : e.target.value)} placeholder="Artwork title" className="input-base" maxLength={200} /></div>
              <div><label className="type-micro block mb-1">Artist</label><input value={aArtist} onChange={e => setAArtist(forceUpper ? e.target.value.toUpperCase() : e.target.value)} placeholder="Name (Year)" className="input-base" maxLength={200} /></div>
              <div>
                <label className="type-micro block mb-1">Domain</label>
                <select value={aDomain} onChange={e => { setADomain(e.target.value); if (e.target.value !== '__other__') setACustomDomain(''); }} className="input-base">
                  {domainTitles.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="__other__">Other (specify)...</option>
                </select>
                {aDomain === '__other__' && (
                  <input value={aCustomDomain} onChange={e => setACustomDomain(e.target.value.toUpperCase())} placeholder="ENTER CUSTOM DOMAIN..." maxLength={100} className="input-base mt-2" />
                )}
              </div>
              {uploadError && <p className="type-micro" style={{ color: '#e5484d' }}>{uploadError}</p>}
              {uploadSuccess && <p className="type-micro" style={{ color: '#4ade80' }}>{uploadSuccess}</p>}
              <button type="submit" disabled={uploading || !file} className="btn-primary w-full justify-center" style={{ opacity: uploading || !file ? 0.5 : 1 }}>
                {uploading ? <><Loader2 size={13} className="animate-spin mr-2" />Uploading…</> : 'Publish'}
              </button>
            </>
          )}
        </form>
      </div>

      <div className="lg:col-span-3 space-y-2">
        <p className="type-micro px-1" style={{ color: 'var(--color-ink-muted)' }}>
          {featuredCount} of {artworks.length} artworks featured — these appear on the homepage
        </p>
        {artworks.map(a => (
          <div key={a.id} className="card p-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)' }}>
            {a.mediaType === 'image' ? (
              <img src={a.coverUrl ?? a.mediaUrl} alt={a.title} className="w-9 h-9 rounded-lg object-cover shrink-0" />
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
            <NotifiedBadge notifiedAt={a.notifiedAt} />
            <button
              onClick={() => setNotifyItem(a)}
              className="btn-icon shrink-0"
              title={a.notifiedAt ? 'Re-send notification to students' : 'Notify students about this artwork'}
              style={{ color: a.notifiedAt ? 'var(--color-ink-muted)' : 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}
            >
              <Send size={12} />
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

      {notifyItem && (
        <NotifyDialog
          kind="artwork"
          item={notifyItem}
          onClose={() => setNotifyItem(null)}
          fetchPreview={api.notify.previewArtwork}
          onSend={notifyArtwork}
        />
      )}

      {editArtwork && (
        <div className="lg:col-span-5">
          <Modal title={`Edit Artwork — ${editArtwork.title}`} onClose={() => { if (eaCoverPreview) { URL.revokeObjectURL(eaCoverPreview); setEaCoverPreview(null); } setEditArtwork(null); }}>
            <form onSubmit={handleEditArtwork} className="space-y-3">
              <div><label className="type-micro block mb-1">Title *</label><input required value={eaTitle} onChange={e => setEaTitle(forceUpper ? e.target.value.toUpperCase() : e.target.value)} className="input-base" maxLength={200} /></div>
              <div><label className="type-micro block mb-1">Artist *</label><input required value={eaArtist} onChange={e => setEaArtist(forceUpper ? e.target.value.toUpperCase() : e.target.value)} className="input-base" maxLength={100} /></div>
              <div>
                <label className="type-micro block mb-1">Domain</label>
                <select value={eaDomain} onChange={e => { setEaDomain(e.target.value); if (e.target.value !== '__other__') setEaCustomDomain(''); }} className="input-base">
                  {domainTitles.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="__other__">Other (specify)...</option>
                </select>
                {eaDomain === '__other__' && (
                  <input value={eaCustomDomain} onChange={e => setEaCustomDomain(e.target.value.toUpperCase())} placeholder="ENTER CUSTOM DOMAIN..." maxLength={100} className="input-base mt-2" />
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
                <img src={editArtwork.mediaUrl} alt="current" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-hairline)' }} />
              )}

              {/* Cover image — for video / PDF only */}
              {(editArtwork.mediaType === 'video' || editArtwork.mediaType === 'pdf') && (
                <div>
                  <label className="type-micro block mb-2">Cover Image</label>
                  {(eaCoverPreview || editArtwork.coverUrl) && (
                    <img src={eaCoverPreview ?? editArtwork.coverUrl!} alt="cover"
                      style={{ width: 80, height: 108, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-hairline)', marginBottom: 8, display: 'block' }} />
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
  const { team, addTeamMember, updateTeamMember, deleteTeamMember, reorderTeamSection } = useAppData();
  const dragIndexRef = useRef<number | null>(null);
  const dragGroupRef = useRef<string | null>(null);

  const sortByOrder = (members: TeamMember[]) =>
    [...members].sort((a, b) => {
      const ao = a.displayOrder ?? 999, bo = b.displayOrder ?? 999;
      return ao !== bo ? ao - bo : a.name.trim().localeCompare(b.name.trim());
    });

  const getGroup = (desig: string): string => {
    const d = desig.toLowerCase();
    if (d.includes('coordinator') && !d.startsWith('ex-')) return 'coordinator';
    if (d.includes('secretary')) return 'secretary';
    return 'other';
  };

  const groupedTeam = {
    coordinator: sortByOrder(team.filter(m => getGroup(m.designation) === 'coordinator')),
    secretary:   sortByOrder(team.filter(m => getGroup(m.designation) === 'secretary')),
    other:       sortByOrder(team.filter(m => getGroup(m.designation) === 'other')),
  };

  const handleDragStart = (groupKey: string, index: number) => {
    dragIndexRef.current = index;
    dragGroupRef.current = groupKey;
  };

  const handleDrop = async (groupKey: string, dropIndex: number) => {
    const from = dragIndexRef.current;
    if (from === null || from === dropIndex || dragGroupRef.current !== groupKey) return;
    const section = [...groupedTeam[groupKey as keyof typeof groupedTeam]];
    const [moved] = section.splice(from, 1);
    section.splice(dropIndex, 0, moved);
    dragIndexRef.current = null;
    dragGroupRef.current = null;
    await reorderTeamSection(section);
  };

  const resetGroupToAlpha = async (groupKey: keyof typeof groupedTeam) => {
    const sorted = [...groupedTeam[groupKey]].sort((a, b) =>
      a.name.trim().localeCompare(b.name.trim())
    );
    await reorderTeamSection(sorted);
  };
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

      <div className="lg:col-span-3 space-y-6">
        {(['coordinator', 'secretary', 'other'] as const).map(groupKey => {
          const members = groupedTeam[groupKey];
          if (members.length === 0) return null;
          const label = groupKey === 'coordinator' ? 'Coordinators' : groupKey === 'secretary' ? 'Secretaries' : 'Others';
          return (
            <div key={groupKey}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p className="type-micro" style={{ color: 'var(--color-ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
                <button
                  type="button"
                  onClick={() => resetGroupToAlpha(groupKey)}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-hairline)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                >
                  Reset to A–Z
                </button>
              </div>
              <div className="space-y-2">
                {members.map((m, idx) => (
                  <div
                    key={m.id}
                    draggable
                    onDragStart={() => handleDragStart(groupKey, idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(groupKey, idx)}
                    className="card p-3 flex items-center gap-3"
                    style={{ borderRadius: 'var(--radius-lg)', cursor: 'default' }}
                  >
                    <GripVertical size={14} style={{ color: 'var(--color-ink-muted)', cursor: 'grab', flexShrink: 0 }} />
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
            </div>
          );
        })}
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
  const { events, addEvent, updateEvent, deleteEvent, notifyEvent } = useAppData();
  const [notifyItem, setNotifyItem] = useState<ClubEvent | null>(null);
  const [registrantsItem, setRegistrantsItem] = useState<ClubEvent | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eDate, setEDate] = useState('');
  const [eTime, setETime] = useState('');
  const [eLocation, setELocation] = useState('');
  const [eContent, setEContent] = useState('');
  const [eCapacity, setECapacity] = useState('100');
  const [addingEvent, setAddingEvent] = useState(false);
  const [eSuccess, setESuccess] = useState('');

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
    setESuccess('Event created · use Notify Students to email members');
    setTimeout(() => { setAddingEvent(false); setESuccess(''); }, 4000);
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
          {eSuccess && <p className="type-micro" style={{ color: '#4ade80' }}>{eSuccess}</p>}
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
            <NotifiedBadge notifiedAt={ev.notifiedAt} />
            <button
              onClick={() => setRegistrantsItem(ev)}
              className="btn-icon shrink-0"
              title="View registrants"
              style={{ color: 'var(--color-ink-muted)', width: 28, height: 28, background: 'transparent' }}
            >
              <Users size={12} />
            </button>
            <button
              onClick={() => setNotifyItem(ev)}
              className="btn-icon shrink-0"
              title={ev.notifiedAt ? 'Re-send notification to students' : 'Notify students about this event'}
              style={{ color: ev.notifiedAt ? 'var(--color-ink-muted)' : 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}
            >
              <Send size={12} />
            </button>
            <button onClick={() => openEditEvent(ev)} className="btn-icon shrink-0" style={{ color: 'var(--color-accent-blue)', width: 28, height: 28, background: 'transparent' }}>
              <Pencil size={12} />
            </button>
            <button onClick={() => deleteEvent(ev.id)} className="btn-icon shrink-0" style={{ color: '#e5484d', width: 28, height: 28, background: 'transparent' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {notifyItem && (
        <NotifyDialog
          kind="event"
          item={notifyItem}
          onClose={() => setNotifyItem(null)}
          fetchPreview={api.notify.previewEvent}
          onSend={notifyEvent}
        />
      )}

      {registrantsItem && (
        <RegistrantsModal event={registrantsItem} onClose={() => setRegistrantsItem(null)} />
      )}

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

// ── Settings tab ─────────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [forceUppercase, setForceUppercase] = useState<boolean>(
    localStorage.getItem('forceUppercase') !== 'false'
  );

  const [coordinators, setCoordinators] = useState<CoordinatorMember[]>([]);
  const [coordLoading, setCoordLoading] = useState(true);
  const [coordUpdating, setCoordUpdating] = useState<string | null>(null);
  const [removingCoord, setRemovingCoord] = useState<string | null>(null);
  const [showAddCoord, setShowAddCoord] = useState(false);
  const [newCoordRoll, setNewCoordRoll] = useState('');
  const [newCoordName, setNewCoordName] = useState('');
  const [addingCoord, setAddingCoord] = useState(false);
  const [addCoordError, setAddCoordError] = useState('');
  const [coordSearch, setCoordSearch] = useState('');

  useEffect(() => {
    api.settings.getAll()
      .then(setSettings)
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.coordinators.getAll()
      .then(setCoordinators)
      .catch(() => setError('Failed to load coordinators'))
      .finally(() => setCoordLoading(false));
  }, []);

  const handleToggleMeet = async () => {
    setSaving(true);
    const newVal = settings.public_meet_enabled === 'true' ? 'false' : 'true';
    try {
      await api.settings.update({ public_meet_enabled: newVal });
      setSettings(prev => ({ ...prev, public_meet_enabled: newVal }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to update setting');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePasscode = async () => {
    if (!newPasscode.trim()) return;
    setSaving(true);
    try {
      await api.settings.update({ public_meet_passcode: newPasscode.trim() });
      setSettings(prev => ({ ...prev, public_meet_passcode: newPasscode.trim() }));
      setNewPasscode('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to update passcode');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCaps = () => {
    const newVal = !forceUppercase;
    setForceUppercase(newVal);
    localStorage.setItem('forceUppercase', newVal ? 'true' : 'false');
    window.dispatchEvent(new Event('storage'));
  };

  const handleCoordinatorToggle = async (coord: CoordinatorMember) => {
    setCoordUpdating(coord.roll_number);
    try {
      const res = await api.coordinators.setApproval(coord.roll_number, !coord.approved);
      setCoordinators(prev => prev.map(c =>
        c.roll_number === coord.roll_number ? { ...c, approved: res.approved } : c
      ));
    } catch {
      setError('Failed to update coordinator access');
    } finally {
      setCoordUpdating(null);
    }
  };

  const handleAddCoordinator = async () => {
    if (!newCoordRoll.trim() || !newCoordName.trim()) return;
    setAddingCoord(true);
    setAddCoordError('');
    try {
      const res = await api.coordinators.add(newCoordRoll.trim(), newCoordName.trim());
      setCoordinators(prev => [...prev, res].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCoordRoll('');
      setNewCoordName('');
      setShowAddCoord(false);
    } catch {
      setAddCoordError('Failed to add. Check roll number format.');
    } finally {
      setAddingCoord(false);
    }
  };

  const handleRemoveCoordinator = async (roll: string) => {
    if (!confirm('Remove this person from coordinator list?')) return;
    setRemovingCoord(roll);
    try {
      await api.coordinators.remove(roll);
      setCoordinators(prev => prev.filter(c => c.roll_number !== roll));
    } catch {
      setError('Failed to remove coordinator');
    } finally {
      setRemovingCoord(null);
    }
  };

  if (loading) return (
    <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      Loading settings...
    </p>
  );

  const isMeetEnabled = settings.public_meet_enabled === 'true';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <h2 style={{
          margin: '0 0 4px', fontSize: 22, fontWeight: 700,
          color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.5px',
        }}>
          Settings
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Configure website features and access controls.
        </p>
      </div>

      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 13, fontFamily: 'var(--font-body)', margin: 0 }}>
          {error}
        </p>
      )}

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
        }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
              Public Meet Scheduler
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
              Show a "Schedule a Meet" option in the footer for coordinators with the passcode.
            </p>
          </div>
          <button
            onClick={handleToggleMeet}
            disabled={saving}
            style={{
              width: 48, height: 26, borderRadius: 'var(--radius-pill)',
              background: isMeetEnabled ? 'var(--color-brand)' : 'var(--color-border)',
              border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: 3, left: isMeetEnabled ? 26 : 3,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>

        <div style={{
          padding: '20px 24px',
          opacity: isMeetEnabled ? 1 : 0.5,
          pointerEvents: isMeetEnabled ? 'all' : 'none',
        }}>
          <p style={{
            margin: '0 0 12px', fontSize: 11, fontWeight: 600,
            color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
            textTransform: 'uppercase', fontFamily: 'var(--font-body)',
          }}>
            Current Passcode
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <code style={{
              padding: '8px 16px', background: 'var(--color-canvas)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
              fontSize: 16, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-brand)',
              fontFamily: 'var(--font-mono, monospace)',
            }}>
              {showPasscode ? (settings.public_meet_passcode ?? 'DNA2025') : '••••••••'}
            </code>
            <button
              onClick={() => setShowPasscode(p => !p)}
              style={{ fontSize: 12, color: 'var(--color-ink-muted)', background: 'none', border: 'none', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              {showPasscode ? 'Hide' : 'Show'}
            </button>
          </div>
          <p style={{
            margin: '0 0 8px', fontSize: 11, fontWeight: 600,
            color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
            textTransform: 'uppercase', fontFamily: 'var(--font-body)',
          }}>
            Change Passcode
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input-base"
              type="text"
              placeholder="New passcode"
              value={newPasscode}
              onChange={e => setNewPasscode(e.target.value)}
              style={{ width: 200 }}
            />
            <button
              className="btn-primary"
              onClick={handleUpdatePasscode}
              disabled={saving || !newPasscode.trim()}
              style={{ fontSize: 13 }}
            >
              {saving ? 'Saving...' : 'Update'}
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            Share this passcode with coordinators who need to schedule meets.
          </p>
        </div>
      </div>

      {/* Coordinator Meet Access */}
      <div style={{
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--color-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}>
          <div>
            <p style={{
              margin: '0 0 2px', fontSize: 15,
              fontWeight: 600,
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-body)',
            }}>
              Meet Scheduler Access
            </p>
            <p style={{
              margin: 0, fontSize: 13,
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
            }}>
              Approved coordinators see
              &quot;Schedule a Meet&quot; in the footer.
              {' '}
              <span style={{ color: 'var(--color-brand)' }}>
                {coordinators.filter(c => c.approved).length}
              </span>
              {' of '}
              {coordinators.length} approved.
            </p>
          </div>
          <button
            onClick={() => setShowAddCoord(p => !p)}
            style={{
              padding: '6px 14px',
              background: showAddCoord
                ? 'var(--color-surface-2)'
                : 'var(--color-brand)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {showAddCoord ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {/* Add coordinator form */}
        {showAddCoord && (
          <div style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--color-hairline)',
            background: 'var(--color-canvas)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <p style={{
              margin: 0, fontSize: 11, fontWeight: 600,
              color: 'var(--color-ink-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-body)',
            }}>
              Add Coordinator
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input-base"
                type="text"
                placeholder="Full name"
                value={newCoordName}
                onChange={e => {
                  setNewCoordName(e.target.value);
                  setAddCoordError('');
                }}
                style={{ flex: 2 }}
              />
              <input
                className="input-base"
                type="text"
                placeholder="Roll number"
                value={newCoordRoll}
                onChange={e => {
                  setNewCoordRoll(e.target.value);
                  setAddCoordError('');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddCoordinator();
                }}
                style={{ flex: 1 }}
              />
              <button
                onClick={handleAddCoordinator}
                disabled={addingCoord || !newCoordRoll.trim() || !newCoordName.trim()}
                style={{
                  padding: '0 16px',
                  background: 'var(--color-brand)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'var(--font-body)',
                  cursor: addingCoord ? 'not-allowed' : 'pointer',
                  opacity: addingCoord ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {addingCoord ? '...' : 'Add'}
              </button>
            </div>
            {addCoordError && (
              <p style={{
                margin: 0, fontSize: 12,
                color: 'var(--color-error)',
                fontFamily: 'var(--font-body)',
              }}>
                {addCoordError}
              </p>
            )}
          </div>
        )}

        {/* Search */}
        {coordinators.length > 5 && (
          <div style={{
            padding: '12px 24px',
            borderBottom: '1px solid var(--color-hairline)',
          }}>
            <input
              className="input-base"
              type="text"
              placeholder="Search coordinators..."
              value={coordSearch}
              onChange={e => setCoordSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        )}

        {/* Coordinator list */}
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {coordLoading ? (
            <p style={{
              padding: '20px 24px', margin: 0,
              fontSize: 13,
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
            }}>
              Loading...
            </p>
          ) : coordinators.length === 0 ? (
            <p style={{
              padding: '20px 24px', margin: 0,
              fontSize: 13,
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
            }}>
              No coordinators yet. Click + Add to add one.
            </p>
          ) : coordinators
              .filter(c =>
                coordSearch === '' ||
                c.name.toLowerCase().includes(coordSearch.toLowerCase()) ||
                c.roll_number.includes(coordSearch)
              )
              .map((coord, i, arr) => (
            <div
              key={coord.roll_number}
              style={{
                padding: '12px 24px',
                borderBottom: i < arr.length - 1
                  ? '1px solid var(--color-hairline)'
                  : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {/* Left — info */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10, minWidth: 0,
              }}>
                <div style={{
                  width: 32, height: 32,
                  borderRadius: 'var(--radius-full)',
                  background: `hsl(${parseInt(coord.roll_number.slice(-3)) % 360}, 55%, 40%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                  color: '#fff',
                  fontFamily: 'var(--font-body)',
                  flexShrink: 0,
                }}>
                  {coord.name[0].toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{
                    margin: 0, fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-ink)',
                    fontFamily: 'var(--font-body)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {coord.name}
                  </p>
                  <p style={{
                    margin: 0, fontSize: 11,
                    color: 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    {coord.roll_number}
                    {coord.registered_at ? ' · Registered' : ' · Not registered yet'}
                  </p>
                </div>
              </div>

              {/* Right — approve toggle + remove */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10, flexShrink: 0,
              }}>
                <span style={{
                  fontSize: 11,
                  color: coord.approved ? 'var(--color-success)' : 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-body)',
                  fontWeight: coord.approved ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}>
                  {coord.approved ? 'Approved' : 'Not approved'}
                </span>

                {/* Toggle */}
                <button
                  onClick={() => handleCoordinatorToggle(coord)}
                  disabled={coordUpdating === coord.roll_number}
                  title={coord.approved ? 'Click to revoke' : 'Click to approve'}
                  style={{
                    width: 44, height: 24,
                    borderRadius: 'var(--radius-pill)',
                    background: coord.approved ? 'var(--color-brand)' : 'var(--color-hairline)',
                    border: 'none',
                    cursor: coordUpdating === coord.roll_number ? 'not-allowed' : 'pointer',
                    position: 'relative',
                    transition: 'background 0.2s ease',
                    flexShrink: 0,
                    opacity: coordUpdating === coord.roll_number ? 0.6 : 1,
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: 3,
                    left: coord.approved ? 23 : 3,
                    width: 18, height: 18,
                    borderRadius: 'var(--radius-full)',
                    background: '#fff',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }} />
                </button>

                {/* Remove */}
                <button
                  onClick={() => handleRemoveCoordinator(coord.roll_number)}
                  disabled={removingCoord === coord.roll_number}
                  title="Remove from list"
                  style={{
                    width: 24, height: 24,
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--color-hairline)',
                    background: 'none',
                    color: 'var(--color-ink-muted)',
                    fontSize: 14,
                    cursor: removingCoord === coord.roll_number ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: removingCoord === coord.roll_number ? 0.4 : 1,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Force Uppercase in Gallery */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}>
          <div>
            <p style={{
              margin: '0 0 2px', fontSize: 15, fontWeight: 600,
              color: 'var(--color-ink)', fontFamily: 'var(--font-body)',
            }}>
              Force Uppercase in Gallery
            </p>
            <p style={{
              margin: 0, fontSize: 13,
              color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)',
            }}>
              Automatically capitalise artwork titles and artist names when uploading.
              Currently{' '}
              <strong style={{ color: forceUppercase ? 'var(--color-brand)' : 'var(--color-ink-muted)' }}>
                {forceUppercase ? 'ON' : 'OFF'}
              </strong>.
            </p>
          </div>
          <button
            onClick={handleToggleCaps}
            style={{
              width: 48, height: 26, borderRadius: 'var(--radius-pill)',
              background: forceUppercase ? 'var(--color-brand)' : 'var(--color-border)',
              border: 'none', cursor: 'pointer',
              position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: 3,
              left: forceUppercase ? 26 : 3,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>
      </div>

      {saved && (
        <p style={{ color: 'var(--color-success)', fontSize: 13, fontFamily: 'var(--font-body)', margin: 0 }}>
          Settings saved
        </p>
      )}
    </div>
  );
}

// ── Announcements tab ─────────────────────────────────────────────────────────

type AnnouncementSubTab = 'welcome' | 'new_post' | 'new_event' | 'custom';

interface TemplateEditorProps {
  templateId: string;
  label: string;
}

function TemplateEditor({ templateId }: TemplateEditorProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [variables, setVariables] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoading(true);
    api.notify.getTemplate(templateId)
      .then(t => { setSubject(t.subject); setBody(t.body); })
      .catch(() => setError('Failed to load template'))
      .finally(() => setLoading(false));
  }, [templateId]);

  // Accurate preview: the backend renders the EXACT send output for the current
  // draft (shell-wrapped or standalone, per the template's real send path), so
  // the preview can never drift from what's actually emailed.
  useEffect(() => {
    if (loading) return;
    const handle = setTimeout(() => {
      api.notify.previewTemplate(templateId, { subject, body })
        .then(r => { setPreviewHtml(r.html); setVariables(r.variables); })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [templateId, subject, body, loading]);

  // Fit the preview iframe to its content (email HTML runs no scripts).
  const fitIframe = () => {
    const f = iframeRef.current;
    try {
      const doc = f?.contentDocument;
      if (f && doc) f.style.height = Math.max(240, doc.documentElement.scrollHeight) + 'px';
    } catch { /* cross-origin guard */ }
  };

  const [testEmail, setTestEmail] = useState('vnayak23@iitk.ac.in');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  const handleSendTest = async () => {
    setTesting(true); setTestMsg('');
    try {
      await api.notify.sendTemplateTest(templateId, { email: testEmail.trim(), subject, body });
      setTestMsg(`✓ Test sent to ${testEmail.trim()}`);
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : 'Failed to send test');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await api.notify.updateTemplate(templateId, { subject, body });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Failed to save template'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      Loading template...
    </p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
          Available Variables
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {variables.map(v => (
            <code
              key={v}
              onClick={() => setBody(prev => prev + v)}
              style={{ padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: 'rgba(233,30,140,0.12)', color: 'var(--color-brand)', fontSize: 12, fontFamily: 'var(--font-mono, monospace)', border: '1px solid rgba(233,30,140,0.2)', cursor: 'pointer' }}
            >
              {v}
            </code>
          ))}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Click a variable to insert it into the body. These are replaced with real values when the email is sent.
        </p>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
          Subject Line
        </label>
        <input className="input-base" type="text" value={subject} onChange={e => setSubject(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
          Email Body (HTML supported)
        </label>
        <textarea
          className="input-base"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={10}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, lineHeight: 1.6 }}
        />
      </div>

      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
          Preview — exact email as sent
        </p>
        <div style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#ffffff' }}>
          <iframe
            ref={iframeRef}
            title="Email preview"
            srcDoc={previewHtml}
            sandbox="allow-same-origin"
            onLoad={fitIframe}
            style={{ width: '100%', height: 400, border: 'none', display: 'block', background: '#ffffff' }}
          />
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Rendered by the real send pipeline with sample variable values — matches the actual email exactly (shell-wrapped or standalone per template).
        </p>
      </div>

      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
          Send test
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input-base"
            type="email"
            value={testEmail}
            onChange={e => { setTestEmail(e.target.value); setTestMsg(''); }}
            placeholder="you@iitk.ac.in"
            style={{ flex: '1 1 240px', minWidth: 180, boxSizing: 'border-box' }}
          />
          <button className="btn-secondary" onClick={handleSendTest} disabled={testing || !testEmail.trim()}>
            {testing ? 'Sending…' : 'Send test'}
          </button>
          {testMsg && (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-body)', color: testMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)' }}>
              {testMsg}
            </span>
          )}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Sends this exact rendered email to that one address only — never the student list.
        </p>
      </div>

      {error && <p style={{ color: 'var(--color-error)', fontSize: 13, fontFamily: 'var(--font-body)', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || !subject || !body}>
          {saving ? 'Saving...' : 'Save Template'}
        </button>
        {saved && <span style={{ color: 'var(--color-success)', fontSize: 13, fontFamily: 'var(--font-body)' }}>Template saved</span>}
      </div>
    </div>
  );
}

function CustomAnnouncement() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('vnayak23@iitk.ac.in');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  const handleSend = async () => {
    setSending(true); setResult(null);
    try {
      const res = await api.notify.sendAnnouncement({ subject, html: body });
      setResult({ success: true, message: `Sent to ${res.sent} registered students` });
      setConfirmOpen(false);
    } catch {
      setResult({ success: false, message: 'Failed to send announcement' });
    } finally { setSending(false); }
  };

  const handleSendTest = async () => {
    setTesting(true); setTestMsg('');
    try {
      await api.notify.sendTemplateTest('custom', { email: testEmail.trim(), subject, body });
      setTestMsg(`✓ Test sent to ${testEmail.trim()}`);
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : 'Failed to send test');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-sm)', background: 'rgba(233,30,140,0.08)', border: '1px solid rgba(233,30,140,0.2)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>
          This sends a one-time custom email to all registered students. Use it for announcements not tied to a specific artwork or event.
        </p>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
          Subject
        </label>
        <input className="input-base" type="text" placeholder="e.g. Recruitment open for DnA Club 2025" value={subject} onChange={e => setSubject(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
          Message (HTML supported)
        </label>
        <textarea
          className="input-base"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={8}
          placeholder="<p>Write your announcement here...</p>"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, lineHeight: 1.6 }}
        />
      </div>

      {body && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
            Preview
          </p>
          <div style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-canvas)' }}>
            <div style={{ background: 'var(--color-brand)', padding: '16px 24px' }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)' }}>Design & Animation Club, IIT Kanpur</p>
            </div>
            <div style={{ padding: 24 }} dangerouslySetInnerHTML={{ __html: body }} />
          </div>
        </div>
      )}

      {result && (
        <p style={{ color: result.success ? 'var(--color-success)' : 'var(--color-error)', fontSize: 13, fontFamily: 'var(--font-body)', margin: 0 }}>
          {result.message}
        </p>
      )}

      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
          Send test to one address first
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input-base"
            type="email"
            value={testEmail}
            onChange={e => { setTestEmail(e.target.value); setTestMsg(''); }}
            placeholder="you@iitk.ac.in"
            style={{ flex: '1 1 240px', minWidth: 180, boxSizing: 'border-box' }}
          />
          <button className="btn-secondary" onClick={handleSendTest} disabled={testing || !testEmail.trim() || !subject || !body}>
            {testing ? 'Sending…' : 'Send test'}
          </button>
          {testMsg && (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-body)', color: testMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)' }}>
              {testMsg}
            </span>
          )}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Sends only to that one address — never the student list.
        </p>
      </div>

      {!confirmOpen ? (
        <button className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={!subject || !body}>
          Send to All Students
        </button>
      ) : (
        <div style={{ padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(233,30,140,0.3)', background: 'rgba(233,30,140,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
            Send this announcement to all registered students?
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            Subject: {subject}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : 'Confirm Send'}</button>
            <button className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementsTab() {
  const [subTab, setSubTab] = useState<AnnouncementSubTab>('welcome');

  const subTabs: { id: AnnouncementSubTab; label: string }[] = [
    { id: 'welcome',   label: 'Welcome'   },
    { id: 'new_post',  label: 'New Post'  },
    { id: 'new_event', label: 'New Event' },
    { id: 'custom',    label: 'Custom'    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.5px' }}>
          Announcements
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Manage email templates and send announcements to registered students.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-hairline)' }}>
        {subTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              borderBottom: subTab === t.id ? '2px solid var(--color-brand)' : '2px solid transparent',
              color: subTab === t.id ? 'var(--color-brand)' : 'var(--color-ink-muted)',
              fontSize: 13, fontWeight: subTab === t.id ? 600 : 400,
              fontFamily: 'var(--font-body)', cursor: 'pointer',
              marginBottom: -1, transition: 'all 0.15s ease',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {subTab === 'welcome'   && <TemplateEditor templateId="welcome"     label="Welcome Email"   />}
        {subTab === 'new_post'  && <TemplateEditor templateId="new_artwork" label="New Artwork Email" />}
        {subTab === 'new_event' && <TemplateEditor templateId="new_event"   label="New Event Email"  />}
        {subTab === 'custom'    && <CustomAnnouncement />}
      </div>
    </div>
  );
}

// ── Sessions tab ──────────────────────────────────────────────────────────────
type SessionSubTab = 'active' | 'past';

function SessionsTab() {
  const [subTab, setSubTab] = useState<SessionSubTab>('active');

  // Active tab state
  const [sessions, setSessions] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    host: '',
    meet_link: '',
    scheduled_at: '',
    audience_group_id: 'all_students',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Past tab state
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [selectedPast, setSelectedPast] = useState<string | null>(null);
  const [joins, setJoins] = useState<SessionJoins | null>(null);
  const [joinsLoading, setJoinsLoading] = useState(false);

  const load = async () => {
    try {
      const [s, g] = await Promise.all([
        api.liveSessions.getAll(),
        api.liveSessions.getGroups(),
      ]);
      setSessions(s);
      setGroups(g);
    } catch {
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (subTab === 'past') {
      setPastLoading(true);
      api.liveSessions.getPast()
        .then(setPastSessions)
        .catch(() => {})
        .finally(() => setPastLoading(false));
    }
  }, [subTab]);

  useEffect(() => {
    if (!selectedPast) return;
    setJoinsLoading(true);
    setJoins(null);
    api.liveSessions.getJoins(selectedPast)
      .then(setJoins)
      .catch(() => {})
      .finally(() => setJoinsLoading(false));
  }, [selectedPast]);

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      await api.liveSessions.create({
        ...form,
        audience_group_id:
          form.audience_group_id === 'all_students'
            ? null
            : form.audience_group_id,
      });
      setShowForm(false);
      setForm({
        title: '', host: '', meet_link: '',
        scheduled_at: '', audience_group_id: 'all_students',
        description: '',
      });
      await load();
    } catch {
      setError('Failed to create session');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, status: string) => {
    try {
      await api.liveSessions.updateStatus(id, status);
      await load();
    } catch {
      setError('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this session?')) return;
    try {
      await api.liveSessions.delete(id);
      await load();
    } catch {
      setError('Failed to delete session');
    }
  };

  const statusColor = (status: string) => {
    if (status === 'live') return 'var(--color-success)';
    if (status === 'upcoming') return 'var(--color-brand)';
    return 'var(--color-ink-muted)';
  };

  const statusLabel = (status: string) => {
    if (status === 'live') return '● Live';
    if (status === 'upcoming') return '◆ Upcoming';
    return 'Ended';
  };

  if (loading) return (
    <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      Loading...
    </p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{
            margin: '0 0 4px', fontSize: 22, fontWeight: 700,
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.5px',
          }}>
            Live Sessions
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            Schedule Google Meet sessions for students.
          </p>
        </div>
        {subTab === 'active' && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            + New Session
          </button>
        )}
      </div>

      {/* Sub-tab navigation */}
      <div style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--color-border)',
        marginBottom: 8,
      }}>
        {(['active', 'past'] as SessionSubTab[]).map(t => (
          <button
            key={t}
            onClick={() => {
              setSubTab(t);
              setSelectedPast(null);
              setJoins(null);
            }}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              borderBottom: subTab === t ? '2px solid var(--color-brand)' : '2px solid transparent',
              color: subTab === t ? 'var(--color-brand)' : 'var(--color-ink-muted)',
              fontSize: 13,
              fontWeight: subTab === t ? 600 : 400,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'active' ? 'Active & Upcoming' : 'Past Sessions'}
          </button>
        ))}
      </div>

      {/* Active tab */}
      {subTab === 'active' && (
        <>
          {error && (
            <p style={{ color: 'var(--color-error)', fontSize: 13, fontFamily: 'var(--font-body)', margin: 0 }}>
              {error}
            </p>
          )}

          {/* Create form */}
          {showForm && (
            <div style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: 24,
              background: 'var(--color-surface)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
                New Session
              </h3>

              {[
                { label: 'Session Title', key: 'title', placeholder: 'e.g. Typography Workshop' },
                { label: 'Host Name', key: 'host', placeholder: 'e.g. Arjun Kumar' },
                { label: 'Google Meet Link', key: 'meet_link', placeholder: 'https://meet.google.com/xxx-xxxx-xxx' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                    textTransform: 'uppercase', marginBottom: 6,
                    fontFamily: 'var(--font-body)',
                  }}>
                    {label}
                  </label>
                  <input
                    className="input-base"
                    type="text"
                    placeholder={placeholder}
                    value={(form as any)[key]}
                    onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              ))}

              <div>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', marginBottom: 6,
                  fontFamily: 'var(--font-body)',
                }}>
                  Date & Time
                </label>
                <input
                  className="input-base"
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={e => setForm(prev => ({ ...prev, scheduled_at: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', marginBottom: 6,
                  fontFamily: 'var(--font-body)',
                }}>
                  Audience
                </label>
                <select
                  className="input-base"
                  value={form.audience_group_id}
                  onChange={e => setForm(prev => ({ ...prev, audience_group_id: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                >
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name}{g.member_count > 0 ? ` (${g.member_count} members)` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', marginBottom: 6,
                  fontFamily: 'var(--font-body)',
                }}>
                  Description (optional)
                </label>
                <textarea
                  className="input-base"
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  placeholder="What will this session cover?"
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-primary"
                  onClick={handleCreate}
                  disabled={saving || !form.title || !form.host || !form.meet_link || !form.scheduled_at}
                >
                  {saving ? 'Creating...' : 'Create Session'}
                </button>
                <button className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Sessions list */}
          {sessions.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '48px 0',
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)', fontSize: 14,
            }}>
              No sessions yet. Create your first one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sessions.map(s => (
                <div key={s.id} style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)', padding: '18px 20px',
                  background: 'var(--color-surface)',
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', gap: 16,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(s.status), fontFamily: 'var(--font-body)' }}>
                        {statusLabel(s.status)}
                      </span>
                      {s.audience_name && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                          textTransform: 'uppercase', padding: '2px 8px', borderRadius: 'var(--radius-pill)',
                          background: 'rgba(233,30,140,0.1)', color: 'var(--color-brand)',
                          fontFamily: 'var(--font-body)',
                        }}>
                          {s.audience_name}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                      {s.title}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                      {s.host} ·{' '}
                      {new Date(s.scheduled_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                      })}
                    </p>
                    <a
                      href={s.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'var(--color-brand)', fontFamily: 'var(--font-body)', textDecoration: 'none', wordBreak: 'break-all' }}
                    >
                      {s.meet_link}
                    </a>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    {s.status === 'upcoming' && (
                      <button
                        className="btn-primary"
                        style={{ fontSize: 12, padding: '6px 14px' }}
                        onClick={() => handleStatus(s.id, 'live')}
                      >
                        Go Live
                      </button>
                    )}
                    {s.status === 'live' && (
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 12, padding: '6px 14px' }}
                        onClick={() => handleStatus(s.id, 'ended')}
                      >
                        End Session
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(s.id)}
                      style={{
                        fontSize: 12, padding: '6px 14px',
                        background: 'none', border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: 'var(--radius-pill)', color: 'var(--color-error)',
                        cursor: 'pointer', fontFamily: 'var(--font-body)',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Past Sessions tab */}
      {subTab === 'past' && (
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Left — past sessions list */}
          <div style={{ flex: '0 0 280px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pastLoading ? (
              <p style={{ fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                Loading...
              </p>
            ) : pastSessions.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                No past sessions yet.
              </p>
            ) : pastSessions.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedPast(s.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: selectedPast === s.id ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                  background: selectedPast === s.id ? 'rgba(233,30,140,0.06)' : 'var(--color-surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                  {s.title}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  {new Date(s.scheduled_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </span>
                <span style={{
                  fontSize: 11,
                  color: s.join_count > 0 ? 'var(--color-brand)' : 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-body)',
                  fontWeight: s.join_count > 0 ? 600 : 400,
                }}>
                  {s.join_count} clicked to join
                </span>
              </button>
            ))}
          </div>

          {/* Right — attendee detail */}
          <div style={{
            flex: 1,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            minHeight: 200,
          }}>
            {!selectedPast ? (
              <div style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 40,
                color: 'var(--color-ink-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                textAlign: 'center',
              }}>
                Select a session to see who joined
              </div>
            ) : joinsLoading ? (
              <div style={{ padding: 24, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                Loading attendees...
              </div>
            ) : joins ? (
              <div>
                <div style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                      {pastSessions.find(s => s.id === selectedPast)?.title}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                      {joins.count} student{joins.count !== 1 ? 's' : ''} clicked to join
                    </p>
                  </div>
                </div>

                {joins.joins.length === 0 ? (
                  <p style={{ padding: '24px 20px', margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                    No one clicked to join this session.
                  </p>
                ) : (
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {joins.joins.map((j, i) => (
                      <div
                        key={j.roll_number}
                        style={{
                          padding: '12px 20px',
                          borderBottom: i < joins.joins.length - 1 ? '1px solid var(--color-border)' : 'none',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                            {j.name ?? 'Unknown'}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                            {j.roll_number}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                          {new Date(j.joined_at).toLocaleTimeString('en-IN', {
                            hour: '2-digit', minute: '2-digit', hour12: true,
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Moodboards tab ────────────────────────────────────────────────────────────
function MoodboardsAdminTab() {
  const [boards, setBoards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.boards.adminGetAll();
      setBoards(data);
    } catch {
      setError('Failed to load boards');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (board: any) => {
    if (!confirm(
      `Delete "${board.name}" by ${board.owner_name ?? board.owner_roll}? This cannot be undone.`
    )) return;
    try {
      await api.boards.adminDelete(board.id);
      setBoards(prev => prev.filter(b => b.id !== board.id));
    } catch {
      setError('Failed to delete board');
    }
  };

  const handleVisibility = async (board: any) => {
    setUpdating(board.id + '_vis');
    const newVal = board.visibility === 'private' ? 'shared' : 'private';
    try {
      const updated = await api.boards.adminUpdate(board.id, { visibility: newVal });
      setBoards(prev => prev.map(b => b.id === board.id ? { ...b, visibility: updated.visibility } : b));
    } catch {
      setError('Failed to update visibility');
    } finally {
      setUpdating(null);
    }
  };

  const handleEditMode = async (board: any) => {
    setUpdating(board.id + '_edit');
    const newVal = board.edit_mode === 'members_only' ? 'anyone' : 'members_only';
    try {
      const updated = await api.boards.adminUpdate(board.id, { edit_mode: newVal });
      setBoards(prev => prev.map(b => b.id === board.id ? { ...b, edit_mode: updated.edit_mode } : b));
    } catch {
      setError('Failed to update edit mode');
    } finally {
      setUpdating(null);
    }
  };

  const filtered = boards.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.owner_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    b.owner_roll.includes(search)
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });

  if (loading) return (
    <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
      Loading...
    </p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.5px' }}>
            Moodboards
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            {boards.length} board{boards.length !== 1 ? 's' : ''} created by students
          </p>
        </div>
        <input
          className="input-base"
          type="text"
          placeholder="Search by name or owner..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 13, fontFamily: 'var(--font-body)', margin: 0 }}>
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
          {search ? 'No boards match your search.' : 'No boards created yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(board => (
            <div key={board.id} style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: '16px 18px',
              background: 'var(--color-surface)',
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: 16, flexWrap: 'wrap',
            }}>
              {/* Left — board info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                    {board.name}
                  </p>
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: 'var(--radius-pill)',
                    background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(255,255,255,0.06)',
                    color: board.visibility === 'shared' ? 'var(--color-brand)' : 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    {board.visibility}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: 'var(--radius-pill)',
                    background: board.edit_mode === 'anyone' ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                    color: board.edit_mode === 'anyone' ? 'var(--color-success)' : 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    {board.edit_mode === 'anyone' ? 'Anyone edits' : 'Members only'}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  by {board.owner_name ?? board.owner_roll}
                  {' · '}
                  {board.item_count} items
                  {' · '}
                  {board.member_count > 0 ? `${board.member_count + 1} collaborators · ` : ''}
                  {formatDate(board.created_at)}
                </p>
              </div>

              {/* Right — controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                {/* Visibility toggle */}
                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  {(['private', 'shared'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => { if (board.visibility !== v) handleVisibility(board); }}
                      disabled={updating === board.id + '_vis'}
                      style={{
                        padding: '5px 10px',
                        background: board.visibility === v ? 'var(--color-brand)' : 'none',
                        border: 'none',
                        color: board.visibility === v ? '#fff' : 'var(--color-ink-muted)',
                        fontSize: 11,
                        fontWeight: board.visibility === v ? 600 : 400,
                        fontFamily: 'var(--font-body)',
                        cursor: updating === board.id + '_vis' ? 'not-allowed' : 'pointer',
                        textTransform: 'capitalize',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                {/* Edit mode toggle */}
                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  {([
                    { value: 'members_only', label: 'Members' },
                    { value: 'anyone', label: 'Anyone' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { if (board.edit_mode !== opt.value) handleEditMode(board); }}
                      disabled={updating === board.id + '_edit'}
                      style={{
                        padding: '5px 10px',
                        background: board.edit_mode === opt.value ? 'var(--color-brand)' : 'none',
                        border: 'none',
                        color: board.edit_mode === opt.value ? '#fff' : 'var(--color-ink-muted)',
                        fontSize: 11,
                        fontWeight: board.edit_mode === opt.value ? 600 : 400,
                        fontFamily: 'var(--font-body)',
                        cursor: updating === board.id + '_edit' ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Open board link */}
                <a
                  href={`/moodboards/${board.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '5px 12px', background: 'none',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-ink-muted)', fontSize: 11,
                    fontFamily: 'var(--font-body)', textDecoration: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  Open ↗
                </a>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(board)}
                  style={{
                    padding: '5px 12px', background: 'none',
                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-error)', fontSize: 11,
                    fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Delete
                </button>
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
    { id: 'comments',      label: 'Comments',      icon: MessageSquare },
    { id: 'settings',      label: 'Settings',      icon: Settings },
    { id: 'announcements', label: 'Announcements', icon: Mail },
    { id: 'sessions',      label: 'Sessions',      icon: Radio },
    { id: 'moodboards',   label: 'Moodboards',   icon: Layout },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '5rem', paddingBottom: '5rem' }}>
      <ImageCropperPortal />
      <div className="page-container">
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
          {tab === 'settings'      && <motion.div key="settings"      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><SettingsTab /></motion.div>}
          {tab === 'announcements' && <motion.div key="announcements" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><AnnouncementsTab /></motion.div>}
          {tab === 'sessions'      && <motion.div key="sessions"      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><SessionsTab /></motion.div>}
          {tab === 'moodboards'   && <motion.div key="moodboards"   initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><MoodboardsAdminTab /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  );
}
