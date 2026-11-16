import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ExternalLink, Eye, Loader2, Plus, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { api, getStudentToken, type MyArtworkCredit, type OwnerProfile, type ProfilePreview, type ProfileVisibility } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { CreatorAvatar, DisciplineChips, VerifiedMark } from '../components/creators/CreatorParts';
import { profilePath } from '../lib/creators';
import {
  LINK_KINDS, LINK_LABELS, PROFILE_LIMITS, VISIBILITY_OPTIONS, avatarFileProblem, cleanSkills, diffFields, handleProblem,
  linkProblem, skillProblem, suggestHandle, tokenIdentityVerified, type LinkKind,
} from '../lib/profileEdit';

// ─────────────────────────────────────────────────────────────────────────
// My creator profile (DNA 2.0 V1). The student edits their OWN profile through
// PR #84's /api/designers/me contract; ownership comes from the session token,
// never from anything on this page. Verification is shown, never editable —
// only the club can grant it. Each section saves on its own so one failed
// save never loses edits made in another.
// ─────────────────────────────────────────────────────────────────────────

const VERIFY_HINT = 'Verify your identity with email OTP before changing account identity';
const card: React.CSSProperties = { border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg, 14px)', padding: 'clamp(16px, 3vw, 24px)', background: 'var(--color-surface)' };
const full: React.CSSProperties = { width: '100%' };

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} className="type-caption" style={{ fontWeight: 600 }}>{label}</label>
      {children}
      {error ? <p role="alert" className="type-micro" style={{ margin: 0, color: 'var(--color-danger, #c0392b)' }}>{error}</p>
        : hint ? <p className="type-micro" style={{ margin: 0 }}>{hint}</p> : null}
    </div>
  );
}

function Section({ title, intro, children, actions }: { title: string; intro?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }} aria-label={title}>
      <div>
        <h2 className="type-headline" style={{ margin: 0 }}>{title}</h2>
        {intro && <p className="type-body-sm" style={{ margin: '6px 0 0', color: 'var(--color-ink-muted)' }}>{intro}</p>}
      </div>
      {children}
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </section>
  );
}

export default function ProfilePage() {
  const { studentSession, openRollModal, logout } = useStudent();
  const roll = studentSession?.rollNumber ?? '';
  const [profile, setProfile] = useState<OwnerProfile | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [disciplines, setDisciplines] = useState<Array<{ id: string; title: string }>>([]);
  const [credits, setCredits] = useState<MyArtworkCredit[]>([]);
  const verified = useMemo(() => tokenIdentityVerified(getStudentToken()), [studentSession]);   // eslint-disable-line react-hooks/exhaustive-deps

  const expired = useCallback((e: unknown) => {
    if (e instanceof Error && e.message === 'SESSION_EXPIRED') { openRollModal(); return true; }
    return false;
  }, [openRollModal]);

  const load = useCallback(async () => {
    if (!roll) return;
    setLoadError(false);
    try {
      const [me, d, c] = await Promise.all([api.designers.me(roll), api.showcase.disciplines(), api.designers.credits(roll)]);
      setProfile(me); setDisciplines(d.disciplines); setCredits(c);
    } catch (e) {
      if (!expired(e)) setLoadError(true);
    }
  }, [roll, expired]);
  useEffect(() => { void load(); }, [load]);

  // A failed save must say why in plain words; the session-needs-OTP case gets its own banner.
  const fail = useCallback((e: unknown, fallback = 'Could not save — please try again') => {
    if (expired(e)) return;
    toast.error(e instanceof Error && e.message && !/fetch|network|load failed/i.test(e.message) ? e.message : fallback);
  }, [expired]);

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>Sign in to create and manage your creator profile.</p>
        <button onClick={openRollModal} className="btn-primary">Sign in</button>
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>We couldn’t load your profile.</p>
        <button onClick={() => void load()} className="btn-primary">Try again</button>
      </div>
    );
  }
  if (profile === undefined) {
    return <div aria-busy="true" aria-live="polite" style={{ padding: '80px 0', textAlign: 'center' }}><Loader2 className="animate-spin" size={22} aria-label="Loading profile" /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', maxWidth: 820 }}>
      <div>
        <p className="type-caption" style={{ marginBottom: 8 }}>Creator profile</p>
        <h1 className="type-display-md" style={{ margin: 0 }}>{profile ? 'Your profile' : 'Create your profile'}</h1>
        <p className="type-body" style={{ margin: '10px 0 0', color: 'var(--color-ink-muted)', maxWidth: 620 }}>
          This is how other DnA members find you and how you’re credited on work. It stays private until you choose who can see it.
        </p>
      </div>

      {!verified && (
        <div role="status" style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', borderColor: 'var(--color-brand)' }}>
          <ShieldCheck size={18} aria-hidden="true" style={{ color: 'var(--color-brand)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <p className="type-body-sm" style={{ margin: 0, fontWeight: 600 }}>Verify with an email code to edit your profile</p>
            <p className="type-caption" style={{ margin: '4px 0 0' }}>Your current sign-in can view this page, but changing your public identity needs a fresh email code.</p>
          </div>
          <button type="button" className="btn-primary touch-target" onClick={() => { logout(); openRollModal(); }}>Sign in with email code</button>
        </div>
      )}

      {profile === null
        ? <CreateForm studentName={studentSession.name} disabled={!verified} onCreated={p => { setProfile(p); toast.success('Profile created — it’s private until you share it'); }} fail={fail} roll={roll} />
        : (
          <>
            <Header profile={profile} disabled={!verified} roll={roll} onChange={setProfile} fail={fail} />
            {profile.moderationStatus === 'hidden' && (
              <p role="alert" className="type-body-sm" style={{ ...card, margin: 0, borderColor: 'var(--color-danger, #c0392b)' }}>
                An administrator has hidden this profile. You can still edit it; contact the club to have it restored.
              </p>
            )}
            <BasicsSection profile={profile} disabled={!verified} roll={roll} onSaved={setProfile} fail={fail} />
            <DisciplinesSection profile={profile} options={disciplines} disabled={!verified} roll={roll} onSaved={d => setProfile({ ...profile, disciplines: d })} fail={fail} />
            <SkillsSection profile={profile} disabled={!verified} roll={roll} onSaved={skills => setProfile({ ...profile, skills })} fail={fail} />
            <LinksSection profile={profile} disabled={!verified} roll={roll} onSaved={links => setProfile({ ...profile, links })} fail={fail} />
            <VisibilitySection profile={profile} disabled={!verified} roll={roll} onSaved={v => setProfile({ ...profile, visibility: v })} fail={fail} />
            <PreviewSection roll={roll} profile={profile} fail={fail} />
          </>
        )}

      <CreditsSection credits={credits} disabled={!verified} roll={roll} fail={fail} onChanged={() => void load()} />
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────────

function CreateForm({ studentName, disabled, roll, onCreated, fail }: { studentName: string; disabled: boolean; roll: string; onCreated: (p: OwnerProfile) => void; fail: (e: unknown) => void }) {
  const [displayName, setDisplayName] = useState(studentName);
  const [handle, setHandle] = useState(() => suggestHandle(studentName));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'free' | 'taken' | 'reserved'>('idle');
  const hp = touched ? handleProblem(handle) : null;
  const nameOk = displayName.trim().length >= 1;

  useEffect(() => {
    if (handleProblem(handle)) { setAvailability('idle'); return; }
    setAvailability('checking');
    const t = setTimeout(() => {
      api.designers.handleAvailable(roll, handle.trim().toLowerCase())
        .then(r => setAvailability(r.available ? 'free' : r.reason === 'reserved' ? 'reserved' : 'taken'))
        .catch(() => setAvailability('idle'));
    }, 350);
    return () => clearTimeout(t);
  }, [handle, roll]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (handleProblem(handle) || !nameOk || availability === 'taken' || availability === 'reserved') return;
    setBusy(true);
    try { onCreated(await api.designers.create(roll, { handle: handle.trim().toLowerCase(), displayName: displayName.trim() })); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field id="pf-name" label="Display name" hint="Shown on your profile and on credits. Use the name you want to be known by.">
        <input id="pf-name" className="input-base" style={full} maxLength={PROFILE_LIMITS.displayName} value={displayName} onChange={e => setDisplayName(e.target.value)} disabled={disabled} autoComplete="name" />
      </Field>
      <Field id="pf-handle" label="Public username" error={hp ?? (availability === 'taken' ? 'That username is taken' : availability === 'reserved' ? 'That username is reserved' : null)}
        hint={availability === 'free' ? 'Available ✓' : availability === 'checking' ? 'Checking…' : `Your page will be /designers/${handle.trim().toLowerCase() || 'your-name'}`}>
        <input id="pf-handle" className="input-base" style={full} maxLength={30} value={handle} onChange={e => { setTouched(true); setHandle(e.target.value); }} disabled={disabled} autoCapitalize="none" spellCheck={false} />
      </Field>
      <div><button type="submit" className="btn-primary touch-target" disabled={disabled || busy || !nameOk}>{busy ? 'Creating…' : 'Create profile'}</button></div>
    </form>
  );
}

// ── Header (avatar, identity, links to the public page) ───────────────────

function Header({ profile, disabled, roll, onChange, fail }: { profile: OwnerProfile; disabled: boolean; roll: string; onChange: (p: OwnerProfile) => void; fail: (e: unknown) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const problem = avatarFileProblem(f);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try { const r = await api.designers.uploadAvatar(f); onChange({ ...profile, avatarUrl: r.avatarUrl }); toast.success('Profile image updated'); }
    catch (e) { fail(e); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.designers.removeAvatar(roll); onChange({ ...profile, avatarUrl: null }); toast.success('Profile image removed'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const isPublic = profile.visibility === 'public' && profile.moderationStatus === 'active';
  return (
    <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <CreatorAvatar name={profile.displayName} src={profile.avatarUrl} size={84} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <p className="type-headline" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
          {profile.displayName} {profile.verified && <VerifiedMark />}
        </p>
        <p className="type-caption" style={{ margin: '2px 0 0' }}>@{profile.handle} · {VISIBILITY_OPTIONS.find(v => v.id === profile.visibility)?.label}</p>
        <p className="type-micro" style={{ margin: '4px 0 0' }}>{profile.verified ? 'Verified by the club.' : 'Verification is granted by the club — it can’t be set here.'}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => void pick(e.target.files?.[0])} aria-label="Choose a profile image" />
          <button type="button" className="btn-translucent btn-sm touch-target" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} {profile.avatarUrl ? 'Change image' : 'Upload image'}
          </button>
          {profile.avatarUrl && <button type="button" className="btn-translucent btn-sm is-danger touch-target" disabled={disabled || busy} onClick={() => void remove()}><Trash2 size={14} aria-hidden="true" /> Remove</button>}
          {isPublic
            ? <Link to={profilePath(profile.handle)} className="btn-translucent btn-sm touch-target"><ExternalLink size={14} aria-hidden="true" /> View public page</Link>
            : <span className="type-micro" style={{ alignSelf: 'center' }}>Your public page is off — change who can see it below.</span>}
        </div>
        <p className="type-micro" style={{ margin: '8px 0 0' }}>JPG, PNG or WebP, up to 2 MB. We crop it square and remove location data.</p>
      </div>
    </div>
  );
}

// ── Basics ────────────────────────────────────────────────────────────────

function BasicsSection({ profile, disabled, roll, onSaved, fail }: { profile: OwnerProfile; disabled: boolean; roll: string; onSaved: (p: OwnerProfile) => void; fail: (e: unknown) => void }) {
  const initial = useMemo(() => ({
    displayName: profile.displayName, handle: profile.handle, headline: profile.headline ?? '', bio: profile.bio ?? '',
    department: profile.department ?? '', showBatch: profile.showBatch,
  }), [profile]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const [busy, setBusy] = useState(false);
  const lockedUntil = profile.handleChangeableAt ? new Date(profile.handleChangeableAt) : null;
  const handleLocked = !!lockedUntil && lockedUntil.getTime() > Date.now();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  const hp = form.handle !== initial.handle ? handleProblem(form.handle) : null;
  const dirty = Object.keys(diffFields(initial, form)).length > 0;

  const save = async () => {
    if (hp || !form.displayName.trim()) return;
    const d = diffFields(initial, form);
    const body: Record<string, unknown> = {};
    if ('displayName' in d) body.displayName = form.displayName.trim();
    if ('handle' in d) body.handle = form.handle.trim().toLowerCase();
    if ('headline' in d) body.headline = form.headline.trim() || null;
    if ('bio' in d) body.bio = form.bio.trim() || null;
    if ('department' in d) body.department = form.department.trim() || null;
    if ('showBatch' in d) body.showBatch = form.showBatch;
    setBusy(true);
    try { onSaved(await api.designers.update(roll, body)); toast.success('Profile saved'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Section title="About you" intro="Basic details shown on your public page. Your roll number and email are never shown."
      actions={<><button type="button" className="btn-primary touch-target" disabled={disabled || busy || !dirty || !!hp} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>{dirty && <button type="button" className="btn-translucent touch-target" onClick={() => setForm(initial)}>Discard</button>}</>}>
      <Field id="pe-name" label="Display name"><input id="pe-name" className="input-base" style={full} maxLength={PROFILE_LIMITS.displayName} value={form.displayName} onChange={e => set('displayName', e.target.value)} disabled={disabled} /></Field>
      <Field id="pe-handle" label="Public username" error={hp}
        hint={handleLocked ? `You can change this again on ${lockedUntil!.toLocaleDateString()}.` : 'Usernames can be changed once every 30 days; old links stop working when you change it.'}>
        <input id="pe-handle" className="input-base" style={full} maxLength={30} value={form.handle} onChange={e => set('handle', e.target.value)} disabled={disabled || handleLocked} autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field id="pe-headline" label="Headline" hint={`${form.headline.length}/${PROFILE_LIMITS.headline} — e.g. “Illustrator & motion designer”`}>
        <input id="pe-headline" className="input-base" style={full} maxLength={PROFILE_LIMITS.headline} value={form.headline} onChange={e => set('headline', e.target.value)} disabled={disabled} />
      </Field>
      <Field id="pe-bio" label="Bio" hint={`${form.bio.length}/${PROFILE_LIMITS.bio} — plain text`}>
        <textarea id="pe-bio" className="input-base" rows={5} style={{ ...full, resize: 'vertical' }} maxLength={PROFILE_LIMITS.bio} value={form.bio} onChange={e => set('bio', e.target.value)} disabled={disabled} />
      </Field>
      <Field id="pe-dept" label="Department (optional)"><input id="pe-dept" className="input-base" style={full} maxLength={PROFILE_LIMITS.department} value={form.department} onChange={e => set('department', e.target.value)} disabled={disabled} /></Field>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: disabled ? 'default' : 'pointer' }}>
        <input type="checkbox" checked={form.showBatch} onChange={e => set('showBatch', e.target.checked)} disabled={disabled} style={{ marginTop: 3 }} />
        <span className="type-body-sm">Show my batch year on my profile <span className="type-micro" style={{ display: 'block' }}>Worked out from your enrolment; off by default.</span></span>
      </label>
    </Section>
  );
}

// ── Disciplines ───────────────────────────────────────────────────────────

function DisciplinesSection({ profile, options, disabled, roll, onSaved, fail }: { profile: OwnerProfile; options: Array<{ id: string; title: string }>; disabled: boolean; roll: string; onSaved: (d: OwnerProfile['disciplines']) => void; fail: (e: unknown) => void }) {
  const saved = useMemo(() => profile.disciplines.map(d => d.id), [profile.disciplines]);
  const [sel, setSel] = useState<string[]>(saved);
  useEffect(() => setSel(saved), [saved]);
  const [busy, setBusy] = useState(false);
  const dirty = sel.length !== saved.length || sel.some(id => !saved.includes(id));
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= PROFILE_LIMITS.disciplines ? s : [...s, id]));
  const save = async () => {
    setBusy(true);
    try {
      await api.designers.setDisciplines(roll, sel);
      const byId = new Map(profile.disciplines.map(d => [d.id, d]));
      onSaved(sel.map(id => byId.get(id) ?? { id, title: options.find(o => o.id === id)?.title ?? id, color: '#888888' }));
      toast.success('Disciplines saved');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Section title="Disciplines" intro={`Pick up to ${PROFILE_LIMITS.disciplines} areas you work in. People filter creators by these.`}
      actions={<button type="button" className="btn-primary touch-target" disabled={disabled || busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save disciplines'}</button>}>
      {options.length === 0 ? <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>No disciplines are available yet.</p> : (
        <div role="group" aria-label="Disciplines" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {options.map(o => {
            const on = sel.includes(o.id);
            const atMax = !on && sel.length >= PROFILE_LIMITS.disciplines;
            return (
              <button key={o.id} type="button" aria-pressed={on} disabled={disabled || atMax} onClick={() => toggle(o.id)}
                className={on ? 'btn-primary btn-sm touch-target' : 'btn-translucent btn-sm touch-target'} style={{ opacity: atMax ? 0.5 : 1 }}>{o.title}</button>
            );
          })}
        </div>
      )}
      <p className="type-micro" style={{ margin: 0 }}>{sel.length}/{PROFILE_LIMITS.disciplines} selected</p>
    </Section>
  );
}

// ── Skills ────────────────────────────────────────────────────────────────

function SkillsSection({ profile, disabled, roll, onSaved, fail }: { profile: OwnerProfile; disabled: boolean; roll: string; onSaved: (s: string[]) => void; fail: (e: unknown) => void }) {
  const [skills, setSkills] = useState(profile.skills);
  useEffect(() => setSkills(profile.skills), [profile.skills]);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = skills.join('|') !== profile.skills.join('|');
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    const p = skillProblem(value);
    if (p) { setProblem(p); return; }
    if (skills.length >= PROFILE_LIMITS.skills) { setProblem(`You can list up to ${PROFILE_LIMITS.skills} skills`); return; }
    setSkills(cleanSkills([...skills, value])); setDraft(''); setProblem(null);
  };
  const save = async () => {
    setBusy(true);
    try { const r = await api.designers.setSkills(roll, skills); onSaved(r.skills); toast.success('Skills saved'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Section title="Skills" intro="Tools and techniques, like “figma” or “motion graphics”. Shown on your profile and used by search."
      actions={<button type="button" className="btn-primary touch-target" disabled={disabled || busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save skills'}</button>}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input aria-label="Add a skill" className="input-base" style={{ flex: 1, minWidth: 0 }} maxLength={30} value={draft} placeholder="Add a skill"
          onChange={e => { setDraft(e.target.value); setProblem(null); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} disabled={disabled} />
        <button type="button" className="btn-translucent touch-target" onClick={add} disabled={disabled || !draft.trim()}><Plus size={15} aria-hidden="true" /> Add</button>
      </div>
      {problem && <p role="alert" className="type-micro" style={{ margin: 0, color: 'var(--color-danger, #c0392b)' }}>{problem}</p>}
      {skills.length === 0 ? <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>No skills added yet.</p> : (
        <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
          {skills.map(s => (
            <li key={s} className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 12px', border: '1px solid var(--color-hairline)', borderRadius: 999 }}>
              {s}
              <button type="button" aria-label={`Remove ${s}`} disabled={disabled} onClick={() => setSkills(skills.filter(x => x !== s))} style={{ background: 'none', border: 0, cursor: 'pointer', display: 'inline-flex', padding: 4, color: 'inherit' }}><X size={13} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="type-micro" style={{ margin: 0 }}>{skills.length}/{PROFILE_LIMITS.skills}</p>
    </Section>
  );
}

// ── Links ─────────────────────────────────────────────────────────────────

function LinksSection({ profile, disabled, roll, onSaved, fail }: { profile: OwnerProfile; disabled: boolean; roll: string; onSaved: (l: OwnerProfile['links']) => void; fail: (e: unknown) => void }) {
  const toRows = (l: OwnerProfile['links']) => l.map(x => ({ kind: (LINK_KINDS as readonly string[]).includes(x.kind) ? x.kind as LinkKind : 'other', url: x.url }));
  const [rows, setRows] = useState(() => toRows(profile.links));
  useEffect(() => setRows(toRows(profile.links)), [profile.links]);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = rows.map(r => linkProblem(r.kind, r.url));
  const dirty = JSON.stringify(rows) !== JSON.stringify(toRows(profile.links));
  const save = async () => {
    setShowErrors(true);
    if (errors.some(Boolean)) return;
    setBusy(true);
    try { const r = await api.designers.setLinks(roll, rows.map(x => ({ kind: x.kind, url: x.url.trim() }))); onSaved(r.links); setShowErrors(false); toast.success('Links saved'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Section title="Portfolio & social links" intro={`Up to ${PROFILE_LIMITS.links} links. They must start with https:// and match the network you pick.`}
      actions={<><button type="button" className="btn-translucent touch-target" disabled={disabled || rows.length >= PROFILE_LIMITS.links} onClick={() => setRows([...rows, { kind: 'website', url: '' }])}><Plus size={15} aria-hidden="true" /> Add link</button>
        <button type="button" className="btn-primary touch-target" disabled={disabled || busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save links'}</button></>}>
      {rows.length === 0 && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>No links yet.</p>}
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label={`Link ${i + 1} network`} className="input-base" style={{ flex: '0 0 140px' }} value={r.kind} disabled={disabled}
              onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as LinkKind } : x)))}>
              {LINK_KINDS.map(k => <option key={k} value={k}>{LINK_LABELS[k]}</option>)}
            </select>
            <input aria-label={`Link ${i + 1} address`} className="input-base" style={{ flex: '1 1 220px', minWidth: 0 }} inputMode="url" placeholder="https://" maxLength={2048} value={r.url} disabled={disabled}
              onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} autoCapitalize="none" spellCheck={false} />
            <button type="button" className="btn-translucent btn-icon btn-sm is-danger touch-target" aria-label={`Remove link ${i + 1}`} disabled={disabled} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button>
          </div>
          {showErrors && errors[i] && <p role="alert" className="type-micro" style={{ margin: 0, color: 'var(--color-danger, #c0392b)' }}>{errors[i]}</p>}
        </div>
      ))}
    </Section>
  );
}

// ── Visibility ────────────────────────────────────────────────────────────

function VisibilitySection({ profile, disabled, roll, onSaved, fail }: { profile: OwnerProfile; disabled: boolean; roll: string; onSaved: (v: ProfileVisibility) => void; fail: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const hidden = profile.moderationStatus === 'hidden';
  const choose = async (v: ProfileVisibility) => {
    if (v === profile.visibility) return;
    setBusy(true);
    try { await api.designers.setVisibility(roll, v); onSaved(v); toast.success(v === 'public' ? 'Your profile is now public' : 'Visibility updated'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Section title="Who can see your profile" intro="You’re in control. Changing this takes effect immediately, including on credits and the creator directory.">
      <div role="radiogroup" aria-label="Profile visibility" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {VISIBILITY_OPTIONS.map(o => {
          const on = profile.visibility === o.id;
          return (
            <label key={o.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-hairline)'}`, borderRadius: 12, cursor: disabled || busy || (hidden && o.id !== 'private') ? 'default' : 'pointer', opacity: hidden && o.id !== 'private' ? 0.55 : 1 }}>
              <input type="radio" name="visibility" checked={on} disabled={disabled || busy || (hidden && o.id !== 'private')} onChange={() => void choose(o.id)} style={{ marginTop: 3 }} />
              <span><span className="type-body-sm" style={{ fontWeight: 600, display: 'block' }}>{o.label}</span><span className="type-caption">{o.help}</span></span>
            </label>
          );
        })}
      </div>
    </Section>
  );
}

// ── Preview ───────────────────────────────────────────────────────────────

function PreviewSection({ roll, profile, fail }: { roll: string; profile: OwnerProfile; fail: (e: unknown) => void }) {
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPreview(null), [profile]);       // a stale preview must never outlive an edit
  const run = async () => {
    setBusy(true);
    try { setPreview(await api.designers.preview(roll)); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Section title="Preview" intro="See exactly what a visitor sees right now — nothing more."
      actions={<button type="button" className="btn-translucent touch-target" disabled={busy} onClick={() => void run()}><Eye size={15} aria-hidden="true" /> {busy ? 'Loading…' : preview ? 'Refresh preview' : 'Preview my profile'}</button>}>
      {preview && (
        <div aria-live="polite" style={{ border: '1px dashed var(--color-hairline)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="type-micro" style={{ margin: 0 }}>{preview.visibleToPublic ? 'Visitors can open this page.' : 'Visitors can’t open this page right now — only you can. This is what it would show.'}</p>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <CreatorAvatar name={preview.displayName} src={preview.avatarUrl} size={64} />
            <div style={{ minWidth: 0 }}>
              <p className="type-headline" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{preview.displayName} {preview.verified && <VerifiedMark />}</p>
              {preview.headline && <p className="type-body-sm" style={{ margin: '2px 0 0' }}>{preview.headline}</p>}
              {(preview.department || preview.batch) && <p className="type-caption" style={{ margin: '2px 0 0' }}>{[preview.department, preview.batch].filter(Boolean).join(' · ')}</p>}
            </div>
          </div>
          {preview.bio && <p className="type-body-sm" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.bio}</p>}
          <DisciplineChips disciplines={preview.disciplines} max={3} />
          {preview.skills.length > 0 && <p className="type-caption" style={{ margin: 0 }}>{preview.skills.join(' · ')}</p>}
          {preview.links.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{preview.links.map(l => <li key={l.url} className="type-caption" style={{ overflowWrap: 'anywhere' }}>{LINK_LABELS[l.kind as LinkKind] ?? l.kind}: {l.url}</li>)}</ul>}
          <p className="type-micro" style={{ margin: 0 }}>{preview.worksCount} published {preview.worksCount === 1 ? 'work' : 'works'}</p>
        </div>
      )}
    </Section>
  );
}

// ── Artwork credit invitations ────────────────────────────────────────────

function CreditsSection({ credits, disabled, roll, onChanged, fail }: { credits: MyArtworkCredit[]; disabled: boolean; roll: string; onChanged: () => void; fail: (e: unknown) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const respond = async (c: MyArtworkCredit, accept: boolean) => {
    setBusyId(c.id);
    try { await api.designers.respondToCredit(roll, c.id, accept); toast.success(accept ? 'You’re credited on this artwork' : 'Credit removed'); onChanged(); }
    catch (e) { fail(e); } finally { setBusyId(null); }
  };
  if (credits.length === 0) return null;
  const pending = credits.filter(c => c.status === 'pending');
  const accepted = credits.filter(c => c.status === 'accepted');
  return (
    <Section title="Gallery credits" intro="Your name only appears on Gallery work once you’ve accepted the credit. You can leave a credit at any time.">
      {pending.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 className="type-body-sm" style={{ margin: 0, fontWeight: 600 }}>Waiting for you</h3>
          {pending.map(c => (
            <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--color-hairline)', borderRadius: 12 }}>
              <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{c.artworkTitle}</p>
                <p className="type-caption" style={{ margin: '2px 0 0' }}>{c.roleLabel || c.role}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-primary btn-sm touch-target" disabled={disabled || busyId === c.id} onClick={() => void respond(c, true)}>Accept</button>
                <button type="button" className="btn-translucent btn-sm touch-target" disabled={disabled || busyId === c.id} onClick={() => void respond(c, false)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {accepted.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 className="type-body-sm" style={{ margin: 0, fontWeight: 600 }}>You’re credited on</h3>
          {accepted.map(c => (
            <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="type-body-sm" style={{ overflowWrap: 'anywhere', flex: '1 1 200px' }}>{c.artworkTitle} <span className="type-caption">· {c.roleLabel || c.role}</span></span>
              {c.isPrimary
                ? <span className="type-micro" style={{ maxWidth: 260 }}>Primary creator — ask a club admin if this credit needs to change.</span>
                : <button type="button" className="btn-translucent btn-sm is-danger touch-target" disabled={disabled || busyId === c.id} onClick={() => void respond(c, false)}>Remove my credit</button>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
