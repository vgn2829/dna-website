import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, ImagePlus, Plus, Star, Trash2, X } from 'lucide-react';
import { api, type Asset, type Board, type ShowcaseCategory, type ShowcaseProject } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { ShowcaseAssetPicker } from '../components/showcase/ShowcaseAssetPicker';
import { ShowcaseArticle, StatusBadge } from '../components/showcase/ShowcaseParts';
import { ConfirmDialog } from '../components/showcase/ShowcaseDialogs';
import { ActivityFeed, CollaboratorsPanel, DiscussionPanel } from '../components/showcase/Collaboration';
import { ROLE_INFO, can, readOnlyReason } from '../lib/collaboration';
import { CATEGORY_OPTIONS, STATUS_INFO, formatDate, isPublicLink, ownerActions, parseTags, previewCredits } from '../lib/showcase';

// ─────────────────────────────────────────────────────────────────────────
// Project editor + review status. Content is editable only while a project is
// a draft or has changes requested; once submitted it is frozen so an edit
// can't slip past review. Associating an Asset Library image does NOT publish
// it — an admin's publish step makes a separate sanitised public copy.
// ─────────────────────────────────────────────────────────────────────────

const WORK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const card: React.CSSProperties = { border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 };
const LABEL: React.CSSProperties = { display: 'block', marginBottom: 6 };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

interface Form { title: string; summary: string; description: string; category: ShowcaseCategory | ''; tags: string; links: Array<{ label: string; url: string }>; disciplineIds: string[]; ownerName: string; ownerRole: string }
const toForm = (p: ShowcaseProject): Form => ({
  title: p.title, summary: p.summary ?? '', description: p.description ?? '', category: p.category ?? '', tags: p.tags.join(', '),
  links: p.links.map(l => ({ ...l })), disciplineIds: p.disciplines.map(d => d.id),
  ownerName: p.credits.find(c => c.isOwner)?.displayName ?? '', ownerRole: p.credits.find(c => c.isOwner)?.roleLabel ?? '',
});

export default function ShowcaseEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { studentSession, openRollModal } = useStudent();
  const { activeWorkspaceId, workspaces, personalWorkspace } = useWorkspace();
  const roll = studentSession?.rollNumber ?? '';
  const pickerWorkspace = (activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) : null) ?? personalWorkspace;

  const [project, setProject] = useState<ShowcaseProject | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [disciplines, setDisciplines] = useState<Array<{ id: string; title: string }>>([]);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<null | 'withdraw' | 'archive' | 'delete'>(null);
  const [invite, setInvite] = useState({ roll: '', role: '', contribution: '' });
  const [activityTick, setActivityTick] = useState(0);

  const apply = useCallback((p: ShowcaseProject, resetForm = false) => { setProject(p); if (resetForm) { setForm(toForm(p)); setDirty(false); } }, []);

  const load = useCallback(async () => {
    if (!roll) return;
    setState('loading');
    try {
      const p = await api.showcase.getMine(roll, id);
      apply(p, true); setState('ready');
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') { openRollModal(); return; }
      setState(e instanceof Error && e.message === 'Project not found' ? 'missing' : 'error');
    }
  }, [roll, id, apply, openRollModal]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.showcase.disciplines().then(r => setDisciplines(r.disciplines)).catch(() => {}); }, []);
  useEffect(() => { if (roll) api.boards.getMyBoards(roll).then(setBoards).catch(() => setBoards([])); }, [roll]);

  const preview = useMemo(() => {
    if (!project || !form) return null;
    const cover = project.works.find(w => w.isCover)?.previewUrl ?? null;
    return {
      title: form.title || 'Untitled project', summary: form.summary || null, description: form.description || null, category: (form.category || null) as ShowcaseCategory | null,
      tags: parseTags(form.tags), disciplines: disciplines.filter(d => form.disciplineIds.includes(d.id)), publishedAt: null,
      credits: previewCredits({ credits: project.credits.map(c => c.isOwner ? { ...c, displayName: form.ownerName || c.displayName, roleLabel: form.ownerRole || c.roleLabel } : c) }),
      links: form.links.filter(l => l.url.trim() && isPublicLink(l.url)).map(l => ({ label: l.label || l.url, url: l.url })),
      works: project.works.filter(w => w.previewUrl).map(w => ({ url: w.previewUrl!, caption: w.caption, width: w.width, height: w.height })),
      artworks: [], cover: cover ? { url: cover, width: null, height: null } : null,
    };
  }, [project, form, disciplines]);

  if (!studentSession) return <div style={{ padding: '80px 0', textAlign: 'center' }}><button onClick={openRollModal} className="btn-primary">Sign in</button></div>;
  if (state === 'loading') return <div role="status" style={{ padding: '80px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>Loading…</div>;
  if (state === 'missing') return <div style={{ padding: '80px 0', textAlign: 'center' }}><h1 className="type-headline">Project not found</h1><Link to="/showcase/manage" className="btn-primary">Back to my projects</Link></div>;
  if (state === 'error' || !project || !form) return <div role="alert" style={{ padding: '80px 0', textAlign: 'center' }}><p>Couldn’t load this project.</p><button className="btn-translucent" onClick={() => void load()}>Try again</button></div>;

  // Every capability below comes from the server's verdict for THIS viewer (project.permissions); the server re-checks each action.
  const editable = project.editable;                                  // the project's status allows content changes (for every role)
  const isOwner = project.access === 'owner';
  const canEditContent = can(project, 'edit_content') && editable;
  const canEditWorks = can(project, 'edit_works') && editable;
  const canManageCredits = can(project, 'manage_credits') && editable;
  const info = STATUS_INFO[project.status];
  const actions = can(project, 'lifecycle') ? ownerActions(project.status) : [];
  const readOnlyNote = readOnlyReason(project);
  const ownerName = project.collaborators.find(c => c.accessRole === 'owner')?.name ?? 'the owner';
  const linkError = form.links.some(l => l.url.trim() && !isPublicLink(l.url));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm(f => (f ? { ...f, [k]: v } : f)); setDirty(true); };

  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    try { const r = await fn(); if (ok) toast.success(ok); return r; }
    catch (e) { if (e instanceof Error && e.message === 'SESSION_EXPIRED') openRollModal(); else toast.error(errMsg(e)); return null; }
  };

  const saveDetails = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (linkError) { toast.error('Fix the highlighted link first'); return false; }
    setSaving(true);
    const p = await run(() => api.showcase.update(roll, project.id, {
      title: form.title, summary: form.summary || null, description: form.description || null, category: form.category || null,
      tags: parseTags(form.tags), links: form.links.filter(l => l.url.trim()).map(l => ({ label: l.label || undefined, url: l.url.trim() })),
      discipline_ids: form.disciplineIds,
      // The owner's own credit is theirs alone; the server refuses it from anyone else, so we don't send it.
      ...(isOwner ? { owner_display_name: form.ownerName || undefined, owner_role_label: form.ownerRole || null } : {}),
    }), 'Saved');
    setSaving(false);
    if (!p) return false;
    apply(p, true);
    if (p.slug !== project.slug) navigate(`/showcase/manage/${p.id}`, { replace: true });
    return true;
  };

  const works = project.works;
  const putWorks = async (next: Array<{ assetId: string; caption: string | null; isCover: boolean }>) => {
    const p = await run(() => api.showcase.setWorks(roll, project.id, next.map(w => ({ asset_id: w.assetId, caption: w.caption, is_cover: w.isCover }))));
    if (p) apply(p);
  };
  const asDraft = () => works.filter(w => w.assetId).map(w => ({ assetId: w.assetId!, caption: w.caption, isCover: w.isCover }));
  const pickAsset = async (a: Asset) => {
    setPicking(false);
    if (a.owner_roll !== roll) return void toast.error('Only images you uploaded yourself can be showcased');
    if (!a.mime_type || !WORK_TYPES.includes(a.mime_type)) return void toast.error('Showcase images must be PNG, JPG or WebP');
    if (works.some(w => w.assetId === a.id)) return void toast.error('That image is already in the project');
    await putWorks([...asDraft(), { assetId: a.id, caption: null, isCover: false }]);
  };
  const move = (i: number, d: -1 | 1) => { const l = asDraft(); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; void putWorks(l); };

  const doAction = async (a: 'submit' | 'withdraw' | 'archive' | 'reopen') => {
    if (a === 'submit' && !(await saveDetails())) return;
    const p = await run(() => api.showcase.action(roll, project.id, a), { submit: 'Submitted for review', withdraw: 'Withdrawn — you can edit again', archive: 'Archived', reopen: 'Reopened as a draft' }[a]);
    if (p) apply(p, true);
  };

  const removeConfirmed = async () => {
    if (confirm === 'delete') { await api.showcase.remove(roll, project.id); toast.success('Project deleted'); navigate('/showcase/manage'); return; }
    await api.showcase.action(roll, project.id, confirm as 'withdraw' | 'archive').then(p => { apply(p, true); setConfirm(null); toast.success(confirm === 'archive' ? 'Archived' : 'Withdrawn'); });
  };

  const field = (id: string, label: string, el: React.ReactNode, hint?: string) => (
    <div><label htmlFor={id} className="type-caption" style={LABEL}>{label}</label>{el}{hint && <p className="type-micro" style={{ margin: '4px 0 0' }}>{hint}</p>}</div>
  );
  const full: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', maxWidth: 980 }}>
      <div>
        <Link to="/showcase/manage" className="btn-translucent btn-sm" style={{ display: 'inline-flex', marginBottom: 14 }}><ArrowLeft size={14} aria-hidden="true" /> My projects</Link>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <h1 className="type-display-md" style={{ margin: 0, overflowWrap: 'anywhere', minWidth: 0 }}>{form.title || 'Untitled project'}</h1>
          <StatusBadge status={project.status} />
        </div>
      </div>

      {!isOwner && (
        <section aria-label="Your access" style={{ ...card, gap: 6 }}>
          <p className="type-body-sm" style={{ margin: 0 }}><strong>You’re {project.access === 'editor' ? 'an editor' : 'a viewer'}</strong> on {ownerName}’s project. {ROLE_INFO[project.access].blurb}</p>
          {readOnlyNote && <p role="note" className="type-caption" style={{ margin: 0 }}>{readOnlyNote}</p>}
        </section>
      )}

      {/* Review status */}
      <section aria-label="Review status" style={card}>
        <p className="type-body-sm" style={{ margin: 0 }}>{info.blurb}</p>
        {(project.status === 'changes_requested' || project.status === 'rejected') && project.reviewNote && (
          <p role="note" className="type-body-sm" style={{ margin: 0, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)' }}><strong>Reviewer’s note:</strong> {project.reviewNote}</p>
        )}
        {editable && isOwner && project.problems.length > 0 && (
          <div><p className="type-caption" style={{ margin: '0 0 6px' }}>Before you can submit:</p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>{project.problems.map(p => <li key={p} className="type-caption">{p}</li>)}</ul></div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {actions.includes('submit') && <button type="button" className="btn-primary touch-target" disabled={project.problems.length > 0 || saving} onClick={() => void doAction('submit')}>Submit for review</button>}
          {actions.includes('withdraw') && <button type="button" className="btn-translucent touch-target" onClick={() => setConfirm('withdraw')}>Withdraw submission</button>}
          {actions.includes('archive') && <button type="button" className="btn-translucent touch-target" onClick={() => setConfirm('archive')}>{project.status === 'published' ? 'Unpublish (archive)' : 'Archive'}</button>}
          {actions.includes('reopen') && <button type="button" className="btn-primary touch-target" onClick={() => void doAction('reopen')}>Reopen as draft</button>}
          {project.status === 'published' && <Link to={`/showcase/${project.slug}`} className="btn-translucent touch-target">View public page</Link>}
          <button type="button" className="btn-translucent touch-target" aria-pressed={showPreview} onClick={() => setShowPreview(v => !v)}>{showPreview ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />} {showPreview ? 'Hide preview' : 'Preview'}</button>
          {actions.includes('delete') && <button type="button" className="btn-translucent is-danger touch-target" onClick={() => setConfirm('delete')}><Trash2 size={14} aria-hidden="true" /> Delete</button>}
        </div>
        {project.events.length > 1 && (
          <details><summary className="type-caption" style={{ cursor: 'pointer' }}>History</summary>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>{project.events.map((e, i) => <li key={i} className="type-caption">{formatDate(e.at)} — {STATUS_INFO[e.to].label}{e.by === 'admin' ? ' (reviewer)' : ''}{e.reason ? `: “${e.reason}”` : ''}</li>)}</ol></details>
        )}
      </section>

      {showPreview && preview && (
        <section aria-label="Preview" style={{ ...card, gap: 10 }}>
          <p className="type-micro" role="note" style={{ margin: 0 }}>Preview — this is how the page will look once published. It is private until an admin publishes it.</p>
          <div style={{ borderTop: '1px solid var(--color-hairline)', paddingTop: 16 }}><ShowcaseArticle data={preview} preview /></div>
        </section>
      )}

      <fieldset disabled={!(canEditContent || canEditWorks)} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', minWidth: 0 }}>
        {/* Details */}
        <section aria-label="Details" style={card}>
          <h2 className="type-headline" style={{ margin: 0 }}>Details</h2>
          {field('sc-title', 'Title', <input id="sc-title" className="input-base" maxLength={120} value={form.title} onChange={e => set('title', e.target.value)} style={full} />)}
          {field('sc-summary', 'Short summary', <input id="sc-summary" className="input-base" maxLength={200} value={form.summary} onChange={e => set('summary', e.target.value)} style={full} placeholder="One line that appears on the card" />)}
          {field('sc-desc', 'Description', <textarea id="sc-desc" className="input-base" rows={6} maxLength={5000} value={form.description} onChange={e => set('description', e.target.value)} style={{ ...full, resize: 'vertical' }} placeholder="The story: brief, process, outcome…" />)}
          {field('sc-cat', 'Category', <select id="sc-cat" className="input-base" value={form.category} onChange={e => set('category', e.target.value as ShowcaseCategory | '')} style={full}><option value="">Choose a category</option>{CATEGORY_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>)}
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="type-caption" style={LABEL}>Creative disciplines (up to 4)</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {disciplines.map(d => { const on = form.disciplineIds.includes(d.id); return (
                <button key={d.id} type="button" aria-pressed={on} className="touch-target" disabled={!on && form.disciplineIds.length >= 4}
                  onClick={() => set('disciplineIds', on ? form.disciplineIds.filter(x => x !== d.id) : [...form.disciplineIds, d.id])}
                  style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink)', background: on ? 'var(--color-surface-2)' : 'transparent', border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-hairline)'}` }}>{d.title}</button>); })}
            </div>
          </fieldset>
          {field('sc-tags', 'Tags', <input id="sc-tags" className="input-base" value={form.tags} onChange={e => set('tags', e.target.value)} style={full} placeholder="retro, poster, halftone" />, 'Separate with commas — up to 10.')}
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="type-caption" style={LABEL}>Links (up to 5)</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {form.links.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input className="input-base" aria-label={`Link ${i + 1} label`} placeholder="Label (e.g. Behance)" value={l.label} maxLength={60} onChange={e => set('links', form.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ flex: '1 1 140px', minWidth: 0 }} />
                  <input className="input-base" aria-label={`Link ${i + 1} address`} aria-invalid={!!l.url.trim() && !isPublicLink(l.url)} placeholder="https://…" value={l.url} onChange={e => set('links', form.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} style={{ flex: '2 1 220px', minWidth: 0 }} />
                  <button type="button" className="btn-translucent btn-icon btn-sm touch-target" aria-label={`Remove link ${i + 1}`} onClick={() => set('links', form.links.filter((_, j) => j !== i))}><X size={14} /></button>
                </div>
              ))}
              {linkError && <p role="alert" className="type-micro" style={{ margin: 0, color: 'var(--color-error)' }}>Links must be public http(s) addresses — not localhost, IP addresses or private networks.</p>}
              {form.links.length < 5 && <button type="button" className="btn-translucent btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('links', [...form.links, { label: '', url: '' }])}><Plus size={13} aria-hidden="true" /> Add link</button>}
            </div>
          </fieldset>
          {isOwner && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 200px' }}>{field('sc-credit-name', 'Your credited name', <input id="sc-credit-name" className="input-base" maxLength={60} value={form.ownerName} onChange={e => set('ownerName', e.target.value)} style={full} />, 'The name shown publicly.')}</div>
            <div style={{ flex: '1 1 200px' }}>{field('sc-credit-role', 'Your role', <input id="sc-credit-role" className="input-base" maxLength={40} value={form.ownerRole} onChange={e => set('ownerRole', e.target.value)} style={full} placeholder="Creator" />)}</div>
          </div>}
          {canEditContent && <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn-primary touch-target" disabled={!dirty || saving} onClick={() => void saveDetails()}>{saving ? 'Saving…' : 'Save details'}</button>
            {dirty && <span className="type-micro" role="status">Unsaved changes</span>}
          </div>}
        </section>

        {/* Works */}
        <section aria-label="Images" style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div><h2 className="type-headline" style={{ margin: 0 }}>Images</h2>
              <p className="type-micro" style={{ margin: '2px 0 0' }}>From your Asset Library (PNG, JPG, WebP; yours only). Anyone with edit access can add their own images; only the owner can remove images someone else added. Adding an image doesn’t publish it — a reviewer makes a separate public copy when the project is published.</p></div>
            {canEditWorks && <button type="button" className="btn-translucent touch-target" disabled={!pickerWorkspace || works.length >= 12} onClick={() => setPicking(true)}><ImagePlus size={15} aria-hidden="true" /> Add from Assets</button>}
          </div>
          {works.length === 0 && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>No images yet. Add at least one — the first becomes the cover.</p>}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {works.map((w, i) => (
              <li key={w.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: 10, border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ width: 96, height: 72, flexShrink: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--color-surface-2)' }}>
                  {w.previewUrl && <img src={w.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p className="type-caption" style={{ margin: 0, overflowWrap: 'anywhere' }}>{w.filename ?? 'Source image removed'}{w.sourceMissing && <span style={{ color: 'var(--color-error)' }}> — remove this</span>}</p>
                  <input className="input-base" aria-label={`Caption for image ${i + 1}`} placeholder="Caption (optional)" maxLength={300} defaultValue={w.caption ?? ''} disabled={!canEditWorks || !w.assetId}
                    onBlur={e => { if (e.target.value !== (w.caption ?? '')) void putWorks(asDraft().map(x => (x.assetId === w.assetId ? { ...x, caption: e.target.value || null } : x))); }} style={full} />
                </div>
                {canEditWorks && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="button" className={w.isCover ? 'btn-primary btn-sm' : 'btn-translucent btn-sm'} aria-pressed={w.isCover} disabled={!w.assetId} onClick={() => void putWorks(asDraft().map(x => ({ ...x, isCover: x.assetId === w.assetId })))}><Star size={12} aria-hidden="true" /> {w.isCover ? 'Cover' : 'Make cover'}</button>
                    <button type="button" className="btn-translucent btn-icon btn-sm touch-target" aria-label={`Move image ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                    <button type="button" className="btn-translucent btn-icon btn-sm touch-target" aria-label={`Move image ${i + 1} down`} disabled={i === works.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                    {(isOwner || w.addedByYou) && <button type="button" className="btn-translucent btn-icon btn-sm is-danger touch-target" aria-label={`Remove image ${i + 1}`} onClick={() => { const rest = asDraft().filter(x => x.assetId !== w.assetId); void putWorks(rest); }}><Trash2 size={14} /></button>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* Contributors */}
        <section aria-label="Contributors" style={card}>
          <div><h2 className="type-headline" style={{ margin: 0 }}>Contributors</h2>
            <p className="type-micro" style={{ margin: '2px 0 0' }}>Everyone you credit must accept before you can submit, and chooses the name shown. Changing their role asks them again. They can withdraw their credit at any time.</p></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {project.credits.map(c => (
              <li key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ minWidth: 0 }}>
                  <p className="type-body-sm" style={{ margin: 0 }}>{c.isOwner ? `${form.ownerName || 'You'} (you)` : c.displayName || (c.roll ? `Student ${c.roll}` : 'Invited student')}{c.roleLabel ? ` · ${c.roleLabel}` : ''}</p>
                  {c.contribution && <p className="type-micro" style={{ margin: '2px 0 0' }}>{c.contribution}</p>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="type-micro" style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)' }}>{c.status === 'accepted' ? 'Accepted' : c.status === 'pending' ? 'Waiting for reply' : 'Declined'}</span>
                  {canManageCredits && !c.isOwner && <button type="button" className="btn-translucent btn-icon btn-sm is-danger touch-target" aria-label={`Remove ${c.displayName || c.roll || 'contributor'}`} onClick={async () => { const p = await run(() => api.showcase.removeCredit(roll, project.id, c.id)); if (p) apply(p); }}><Trash2 size={14} /></button>}
                </div>
              </li>
            ))}
          </ul>
          {canManageCredits && project.credits.filter(c => !c.isOwner).length < 10 && (
            <form onSubmit={async e => { e.preventDefault(); const p = await run(() => api.showcase.invite(roll, project.id, { roll: invite.roll, role_label: invite.role || null, contribution: invite.contribution || null }), 'Invitation sent'); if (p) { apply(p); setInvite({ roll: '', role: '', contribution: '' }); } }}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 130px' }}><label htmlFor="sc-inv-roll" className="type-caption" style={LABEL}>Roll number</label><input id="sc-inv-roll" className="input-base" value={invite.roll} onChange={e => setInvite(v => ({ ...v, roll: e.target.value }))} style={full} /></div>
              <div style={{ flex: '1 1 130px' }}><label htmlFor="sc-inv-role" className="type-caption" style={LABEL}>Role</label><input id="sc-inv-role" className="input-base" maxLength={40} value={invite.role} onChange={e => setInvite(v => ({ ...v, role: e.target.value }))} style={full} placeholder="Illustrator" /></div>
              <div style={{ flex: '2 1 200px' }}><label htmlFor="sc-inv-what" className="type-caption" style={LABEL}>What they did</label><input id="sc-inv-what" className="input-base" maxLength={300} value={invite.contribution} onChange={e => setInvite(v => ({ ...v, contribution: e.target.value }))} style={full} /></div>
              <button type="submit" className="btn-translucent touch-target" disabled={!invite.roll.trim()}><Plus size={14} aria-hidden="true" /> Invite</button>
            </form>
          )}
        </section>

        {/* Moodboards — the owner's private process references */}
        {isOwner && (
        <section aria-label="Moodboards" style={card}>
          <div><h2 className="type-headline" style={{ margin: 0 }}>Process moodboards</h2>
            <p className="type-micro" style={{ margin: '2px 0 0' }}>Private references for you and reviewers. Moodboards are never published.</p></div>
          {boards === null && <p className="type-caption" style={{ margin: 0 }}>Loading your moodboards…</p>}
          {boards && boards.length === 0 && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>You don’t have any moodboards yet.</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {boards?.map(b => { const on = project.boards.some(x => x.id === b.id); return (
              <button key={b.id} type="button" aria-pressed={on} className="touch-target"
                onClick={async () => { const ids = on ? project.boards.filter(x => x.id !== b.id).map(x => x.id) : [...project.boards.map(x => x.id), b.id]; const p = await run(() => api.showcase.setBoards(roll, project.id, ids)); if (p) apply(p); }}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink)', background: on ? 'var(--color-surface-2)' : 'transparent', border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-hairline)'}` }}>{b.name}</button>); })}
          </div>
        </section>
        )}
      </fieldset>

      {/* Collaboration sits outside the content fieldset so viewers can still discuss and leave. */}
      <CollaboratorsPanel project={project} roll={roll} onChanged={collaborators => setProject(p => (p ? { ...p, collaborators } : p))} onLeft={() => navigate('/showcase/manage')} />
      <DiscussionPanel projectId={project.id} roll={roll} canPost={can(project, 'comment')} onPosted={() => setActivityTick(t => t + 1)} />
      <ActivityFeed projectId={project.id} roll={roll} refreshKey={`${activityTick}:${project.collaborators.length}:${project.updatedAt}`} />

      {picking && pickerWorkspace && (
        <ShowcaseAssetPicker workspaceId={pickerWorkspace.id} workspaceName={pickerWorkspace.is_personal ? 'Personal' : pickerWorkspace.name} isPersonalWorkspace={pickerWorkspace.is_personal} workspaceRole={pickerWorkspace.role}
          roll={roll} onClose={() => setPicking(false)} onSelect={a => void pickAsset(a)} />
      )}
      {confirm && (
        <ConfirmDialog danger={confirm !== 'withdraw'} onClose={() => setConfirm(null)} onConfirm={removeConfirmed}
          title={confirm === 'delete' ? 'Delete this project?' : confirm === 'archive' ? (project.status === 'published' ? 'Unpublish this project?' : 'Archive this project?') : 'Withdraw this submission?'}
          confirmLabel={confirm === 'delete' ? 'Delete project' : confirm === 'archive' ? 'Archive' : 'Withdraw'}
          body={confirm === 'delete' ? 'The project and its credits are removed. Your Asset Library images are not affected.'
            : confirm === 'archive' ? (project.status === 'published' ? 'It is removed from the public Showcase and its public image copies are deleted. You can reopen it as a draft and submit it again.' : 'It stays private. You can reopen it as a draft later.')
            : 'It goes back to a draft so you can edit it. You can submit it again when ready.'} />
      )}
    </div>
  );
}
