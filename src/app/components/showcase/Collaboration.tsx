import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquare, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { api, type ProjectActivityItem, type ProjectCollaborator, type ProjectComment, type ShowcaseProject } from '../../lib/api';
import { ROLE_INFO, buildInviteBody, can, describeActivity, inviteProblem, relativeTime, type InviteKind } from '../../lib/collaboration';
import { ConfirmDialog } from './ShowcaseDialogs';

// ─────────────────────────────────────────────────────────────────────────
// Project collaboration UI (DNA 2.0 V1). Purely presentational: whether a
// control appears is decided by `project.permissions`, which the SERVER computed
// for this viewer — and the server re-checks every action regardless. People
// are shown by name; roll numbers are only ever shown to the owner (who typed
// them). Comment text is always rendered as text, never as HTML.
// ─────────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = { border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 };
const full: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
const pill: React.CSSProperties = { padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)', whiteSpace: 'nowrap' };
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong — please try again');

function Heading({ icon, title, intro }: { icon: React.ReactNode; title: string; intro?: string }) {
  return (
    <div>
      <h2 className="type-headline" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{icon}{title}</h2>
      {intro && <p className="type-micro" style={{ margin: '4px 0 0' }}>{intro}</p>}
    </div>
  );
}

// ── Collaborators ─────────────────────────────────────────────────────────

export function CollaboratorsPanel({ project, roll, onChanged, onLeft }: {
  project: ShowcaseProject; roll: string; onChanged: (collaborators: ProjectCollaborator[]) => void; onLeft: () => void;
}) {
  const manage = can(project, 'manage_collaborators');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'remove' | 'leave'; c: ProjectCollaborator }>(null);
  const [form, setForm] = useState({ kind: 'username' as InviteKind, value: '', role: 'editor' as 'editor' | 'viewer', creditRole: '', contribution: '', credit: false });
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const people = project.collaborators;

  const act = async <T,>(id: string, fn: () => Promise<T>, ok: string): Promise<T | null> => {
    setBusyId(id);
    try { const r = await fn(); toast.success(ok); return r; } catch (e) { toast.error(errMsg(e)); return null; } finally { setBusyId(null); }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = inviteProblem(form.kind, form.value);
    if (problem) { setFormError(problem); return; }
    const body = buildInviteBody({ kind: form.kind, value: form.value, role: form.role, creditRole: form.credit ? form.creditRole : '', contribution: form.credit ? form.contribution : '' });
    if (!body) return;
    setSending(true); setFormError(null);
    try {
      const r = await api.showcase.collab.invite(roll, project.id, body);
      onChanged(r.collaborators);
      setForm(f => ({ ...f, value: '', creditRole: '', contribution: '', credit: false }));
      toast.success('Invitation sent');
    } catch (err) { setFormError(errMsg(err)); } finally { setSending(false); }
  };

  return (
    <section aria-label="Collaborators" style={card}>
      <Heading icon={<Users size={17} aria-hidden="true" />} title="Collaborators"
        intro={manage ? 'Invite DnA students to work on this project with you. Access is separate from being credited: nobody is named publicly unless they agree to it.' : `You are ${ROLE_INFO[project.access].label.toLowerCase() === 'editor' ? 'an editor' : 'a viewer'} on this project. ${ROLE_INFO[project.access].blurb}`} />

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {people.map(c => {
          const isOwnerRow = c.accessRole === 'owner';
          return (
            <li key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                <p className="type-body-sm" style={{ margin: 0, overflowWrap: 'anywhere' }}>{c.name}{c.isYou ? ' (you)' : ''}</p>
                {c.status === 'pending' && <p className="type-micro" style={{ margin: '2px 0 0' }}>Invitation sent — waiting for a reply</p>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {manage && !isOwnerRow ? (
                  <select aria-label={`Role for ${c.name}`} className="input-base" value={c.accessRole} disabled={busyId === c.id}
                    onChange={async e => {
                      const next = e.target.value as 'editor' | 'viewer';
                      const r = await act(c.id, () => api.showcase.collab.setRole(roll, project.id, c.id, next), `${c.name} is now ${next === 'editor' ? 'an editor' : 'a viewer'}`);
                      if (r) onChanged(r.collaborators);
                    }}>
                    <option value="editor">Editor</option><option value="viewer">Viewer</option>
                  </select>
                ) : <span className="type-micro" style={pill}>{ROLE_INFO[c.accessRole].label}</span>}
                {manage && !isOwnerRow && (
                  <button type="button" className="btn-translucent btn-icon btn-sm is-danger touch-target" disabled={busyId === c.id}
                    aria-label={c.status === 'pending' ? `Withdraw invitation to ${c.name}` : `Remove ${c.name}`}
                    onClick={() => (c.status === 'pending' ? void withdraw(c) : setConfirm({ kind: 'remove', c }))}><Trash2 size={14} aria-hidden="true" /></button>
                )}
                {!manage && c.isYou && !isOwnerRow && <button type="button" className="btn-translucent btn-sm is-danger touch-target" onClick={() => setConfirm({ kind: 'leave', c })}>Leave project</button>}
              </div>
            </li>
          );
        })}
      </ul>

      {manage && (project.contentEditable ? (
        <form onSubmit={e => void send(e)} aria-label="Invite a collaborator" noValidate style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: '1px solid var(--color-hairline)' }}>
          <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><UserPlus size={15} aria-hidden="true" /> Invite someone</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 1 150px' }}>
              <label htmlFor="co-kind" className="type-caption" style={{ display: 'block', marginBottom: 6 }}>Find by</label>
              <select id="co-kind" className="input-base" style={full} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as InviteKind }))}>
                <option value="username">Username</option><option value="roll">Roll number</option>
              </select>
            </div>
            <div style={{ flex: '2 1 190px', minWidth: 0 }}>
              <label htmlFor="co-value" className="type-caption" style={{ display: 'block', marginBottom: 6 }}>{form.kind === 'username' ? 'Creator username' : 'Roll number'}</label>
              <input id="co-value" className="input-base" style={full} value={form.value} maxLength={30} autoCapitalize="none" spellCheck={false}
                aria-invalid={!!formError} aria-describedby={formError ? 'co-error' : undefined} placeholder={form.kind === 'username' ? 'asha-rao' : '230123'}
                onChange={e => { setForm(f => ({ ...f, value: e.target.value })); setFormError(null); }} />
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label htmlFor="co-role" className="type-caption" style={{ display: 'block', marginBottom: 6 }}>Can</label>
              <select id="co-role" className="input-base" style={full} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'editor' | 'viewer' }))}>
                <option value="editor">Edit</option><option value="viewer">View only</option>
              </select>
            </div>
          </div>
          <p className="type-micro" style={{ margin: 0 }}>{ROLE_INFO[form.role].blurb}</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.credit} onChange={e => setForm(f => ({ ...f, credit: e.target.checked }))} style={{ marginTop: 3 }} />
            <span className="type-body-sm">Also ask them to be credited publicly<span className="type-micro" style={{ display: 'block' }}>They decide whether to accept, and which name appears.</span></span>
          </label>
          {form.credit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="input-base" aria-label="Credited role" placeholder="Role, e.g. Illustrator" maxLength={40} value={form.creditRole} onChange={e => setForm(f => ({ ...f, creditRole: e.target.value }))} style={{ flex: '1 1 150px', minWidth: 0 }} />
              <input className="input-base" aria-label="What they did" placeholder="What they did" maxLength={300} value={form.contribution} onChange={e => setForm(f => ({ ...f, contribution: e.target.value }))} style={{ flex: '2 1 220px', minWidth: 0 }} />
            </div>
          )}
          {formError && <p id="co-error" role="alert" className="type-micro" style={{ margin: 0, color: 'var(--color-error)' }}>{formError}</p>}
          <div><button type="submit" className="btn-primary touch-target" disabled={sending || !form.value.trim()}>{sending ? 'Sending…' : 'Send invitation'}</button></div>
        </form>
      ) : <p className="type-micro" role="note" style={{ margin: 0 }}>Invitations are paused while this project is in review or published.</p>)}

      {confirm && (
        <ConfirmDialog danger onClose={() => setConfirm(null)}
          title={confirm.kind === 'leave' ? 'Leave this project?' : `Remove ${confirm.c.name}?`}
          confirmLabel={confirm.kind === 'leave' ? 'Leave project' : 'Remove'}
          body={confirm.kind === 'leave'
            ? 'You will lose access, and any images you added are taken out of the project. If you accepted a public credit, you can withdraw it separately from My projects.'
            : 'They lose access straight away and any images they added are taken out of the project. A public credit they accepted stays unless they withdraw it.'}
          onConfirm={async () => {
            if (confirm.kind === 'leave') { await api.showcase.collab.leave(roll, project.id); toast.success('You left the project'); setConfirm(null); onLeft(); return; }
            const r = await api.showcase.collab.remove(roll, project.id, confirm.c.id); onChanged(r.collaborators); setConfirm(null); toast.success(`${confirm.c.name} was removed`);
          }} />
      )}
    </section>
  );

  async function withdraw(c: ProjectCollaborator) {
    const r = await act(c.id, () => api.showcase.collab.remove(roll, project.id, c.id), 'Invitation withdrawn');
    if (r) onChanged(r.collaborators);
  }
}

// ── Activity ──────────────────────────────────────────────────────────────

export function ActivityFeed({ projectId, roll, refreshKey }: { projectId: string; roll: string; refreshKey?: unknown }) {
  const [items, setItems] = useState<ProjectActivityItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try { const r = await api.showcase.collab.activity(roll, projectId); setItems(r.items); setNext(r.next); setState('ready'); }
    catch { setState('error'); }
  }, [roll, projectId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    try { const r = await api.showcase.collab.activity(roll, projectId, next); setItems(prev => [...prev, ...r.items.filter(i => !prev.some(p => p.id === i.id))]); setNext(r.next); }
    catch (e) { toast.error(errMsg(e)); } finally { setMore(false); }
  };

  return (
    <section aria-label="Activity" style={card}>
      <Heading icon={<RefreshCw size={16} aria-hidden="true" />} title="Activity" intro="Who invited, joined, edited or commented. Only people on this project can see it." />
      {state === 'loading' && <p role="status" className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}><Loader2 size={14} className="animate-spin" aria-hidden="true" style={{ verticalAlign: -2 }} /> Loading activity…</p>}
      {state === 'error' && <p role="alert" className="type-body-sm" style={{ margin: 0 }}>Couldn’t load activity. <button type="button" className="btn-translucent btn-sm" onClick={() => void load()}>Try again</button></p>}
      {state === 'ready' && items.length === 0 && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>Nothing has happened yet.</p>}
      {state === 'ready' && items.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(i => (
            <li key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span className="type-body-sm" style={{ overflowWrap: 'anywhere', flex: '1 1 220px', minWidth: 0 }}>{describeActivity(i)}</span>
              <time dateTime={i.at} className="type-micro" style={{ whiteSpace: 'nowrap' }}>{relativeTime(i.at)}</time>
            </li>
          ))}
        </ol>
      )}
      {state === 'ready' && next && <div><button type="button" className="btn-translucent btn-sm touch-target" disabled={more} onClick={() => void loadMore()}>{more ? 'Loading…' : 'Show older activity'}</button></div>}
    </section>
  );
}

// ── Discussion ────────────────────────────────────────────────────────────

const MAX_COMMENT = 2000;

export function DiscussionPanel({ projectId, roll, canPost, onPosted }: { projectId: string; roll: string; canPost: boolean; onPosted?: () => void }) {
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.showcase.collab.comments(roll, projectId); setComments(r.comments); setState('ready'); }
    catch { setState('error'); }
  }, [roll, projectId]);
  useEffect(() => { setState('loading'); void load(); }, [load]);

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await api.showcase.collab.addComment(roll, projectId, body); setDraft(''); await load(); onPosted?.(); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const remove = async (c: ProjectComment) => {
    try { await api.showcase.collab.deleteComment(roll, projectId, c.id); setComments(prev => prev.filter(x => x.id !== c.id)); }
    catch (err) { toast.error(errMsg(err)); }
  };

  return (
    <section aria-label="Discussion" style={card}>
      <Heading icon={<MessageSquare size={16} aria-hidden="true" />} title="Discussion" intro="A private thread for the people on this project. It isn’t shown on the public page." />
      {state === 'loading' && <p role="status" className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>Loading the discussion…</p>}
      {state === 'error' && <p role="alert" className="type-body-sm" style={{ margin: 0 }}>Couldn’t load the discussion. <button type="button" className="btn-translucent btn-sm" onClick={() => { setState('loading'); void load(); }}>Try again</button></p>}
      {state === 'ready' && comments.length === 0 && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>No messages yet — start the conversation.</p>}
      {state === 'ready' && comments.length > 0 && (
        <ul aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.map(c => (
            <li key={c.id} style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: c.mine ? 'var(--color-surface-2)' : 'transparent', border: '1px solid var(--color-hairline)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <p className="type-caption" style={{ margin: 0, fontWeight: 600 }}>{c.mine ? 'You' : c.authorName} <time dateTime={c.at} className="type-micro" style={{ fontWeight: 400 }}>· {relativeTime(c.at)}</time></p>
                {c.canDelete && <button type="button" className="btn-translucent btn-icon btn-sm is-danger touch-target" aria-label={`Delete comment by ${c.mine ? 'you' : c.authorName}`} onClick={() => void remove(c)}><Trash2 size={13} aria-hidden="true" /></button>}
              </div>
              {/* Text node only: a comment can never inject markup. */}
              <p className="type-body-sm" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canPost && (
        <form onSubmit={e => void post(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="disc-draft" className="type-caption">Write a message</label>
          <textarea id="disc-draft" className="input-base" rows={3} style={{ ...full, resize: 'vertical' }} maxLength={MAX_COMMENT} value={draft} onChange={e => setDraft(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span className="type-micro">{draft.length}/{MAX_COMMENT}</span>
            <button type="submit" className="btn-primary touch-target" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
