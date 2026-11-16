import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Plus, Sparkles, Mail } from 'lucide-react';
import { api, type ShowcaseInvitation, type ShowcaseListItem } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { STATUS_INFO, formatDate } from '../lib/showcase';
import { CoverImage, StatusBadge } from '../components/showcase/ShowcaseParts';
import { TextPromptDialog } from '../components/showcase/ShowcaseDialogs';
import { SharedProjects } from '../components/showcase/SharedProjects';

// ─────────────────────────────────────────────────────────────────────────
// "My projects": the creator's own showcase projects in every state, plus
// credit invitations from other students. Nothing here is public — projects
// only appear on /showcase once an admin approves AND publishes them.
// ─────────────────────────────────────────────────────────────────────────

export default function ShowcaseManagePage() {
  const { studentSession, openRollModal } = useStudent();
  const navigate = useNavigate();
  const roll = studentSession?.rollNumber ?? '';
  const [projects, setProjects] = useState<ShowcaseListItem[] | null>(null);
  const [invites, setInvites] = useState<ShowcaseInvitation[]>([]);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [accepting, setAccepting] = useState<ShowcaseInvitation | null>(null);

  const load = useCallback(async () => {
    if (!roll) return;
    setError(false);
    try {
      const [m, i] = await Promise.all([api.showcase.mine(roll), api.showcase.invitations(roll)]);
      setProjects(m.projects); setInvites(i.invitations);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') { openRollModal(); return; }
      setError(true);
    }
  }, [roll, openRollModal]);
  useEffect(() => { void load(); }, [load]);

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>Sign in to create and manage Showcase projects.</p>
        <button onClick={openRollModal} className="btn-primary">Sign in</button>
      </div>
    );
  }

  const respond = async (inv: ShowcaseInvitation, accept: boolean, name?: string) => {
    if (accept) await api.showcase.accept(roll, inv.id, name!);
    else await api.showcase.decline(roll, inv.id);
    toast.success(accept ? 'You’re credited on this project once it’s published' : 'Credit declined');
    setAccepting(null);
    void load();
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 'var(--space-lg)' }}>
        <div style={{ minWidth: 0 }}>
          <p className="type-caption" style={{ marginBottom: 8 }}>Public Showcase</p>
          <h1 className="type-display-md" style={{ margin: 0 }}>My projects</h1>
          <p className="type-body" style={{ margin: '10px 0 0', color: 'var(--color-ink-muted)', maxWidth: 620 }}>
            Build a case study from your work, submit it for review, and — once the club approves and publishes it — show it to everyone.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/showcase" className="btn-translucent touch-target"><Sparkles size={15} aria-hidden="true" /> View Showcase</Link>
          <button type="button" className="btn-primary touch-target" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" /> New project</button>
        </div>
      </div>

      {invites.length > 0 && (
        <section aria-label="Credit invitations" style={{ marginBottom: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className="type-headline" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Mail size={16} aria-hidden="true" /> Credit invitations</h2>
          {invites.map(inv => (
            <div key={inv.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <p className="type-body-sm" style={{ margin: 0, fontWeight: 600 }}>{inv.projectTitle}</p>
                <p className="type-caption" style={{ margin: '2px 0 0' }}>
                  {inv.ownerName ? `${inv.ownerName} credited you` : 'You were credited'}{inv.roleLabel ? ` as ${inv.roleLabel}` : ''}{inv.contribution ? ` — “${inv.contribution}”` : ''}
                </p>
                {inv.status === 'accepted' && <p className="type-micro" style={{ margin: '2px 0 0' }}>You accepted as “{inv.displayName}”. You can withdraw your credit any time.</p>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {inv.status === 'pending' && <button type="button" className="btn-primary btn-sm touch-target" onClick={() => setAccepting(inv)}>Accept…</button>}
                <button type="button" className="btn-translucent btn-sm touch-target" onClick={() => void respond(inv, false).catch(e => toast.error(e instanceof Error ? e.message : 'Couldn’t update'))}>
                  {inv.status === 'pending' ? 'Decline' : 'Withdraw my credit'}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <SharedProjects roll={roll} studentName={studentSession.name ?? ''} onSessionExpired={openRollModal} />

      {error && <div role="alert" style={{ padding: '48px 0', textAlign: 'center' }}><p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: '0 0 12px' }}>Couldn’t load your projects.</p><button className="btn-translucent" onClick={() => void load()}>Try again</button></div>}
      {!error && projects === null && <div role="status" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>Loading…</div>}
      {projects && projects.length === 0 && (
        <div style={{ padding: '56px 16px', textAlign: 'center', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-xl)' }}>
          <Sparkles size={30} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          <h2 className="type-headline" style={{ margin: '12px 0 6px' }}>Start your first project</h2>
          <p className="type-body-sm" style={{ margin: '0 auto 16px', maxWidth: 440, color: 'var(--color-ink-muted)' }}>
            Pick images from your Asset Library, describe the project, credit your collaborators and submit it. Nothing becomes public until the club publishes it.
          </p>
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" /> New project</button>
        </div>
      )}
      {projects && projects.length > 0 && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {projects.map(p => (
            <Link key={p.id} to={`/showcase/manage/${p.id}`} aria-label={`${p.title}, ${STATUS_INFO[p.status].label}`}
              style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', overflow: 'hidden' }}>
              <CoverImage src={p.coverUrl} />
              <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{p.title}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><StatusBadge status={p.status} /><span className="type-micro">Updated {formatDate(p.updatedAt)}</span></div>
                {p.status === 'changes_requested' && p.reviewNote && <p className="type-caption" style={{ margin: 0 }}>“{p.reviewNote}”</p>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <TextPromptDialog title="New project" subtitle="You can change everything later, until you submit it" label="Project title" placeholder="e.g. Retro Poster Series" minLength={3} confirmLabel="Create draft" onClose={() => setCreating(false)}
          onSubmit={async title => { const p = await api.showcase.create(roll, title); navigate(`/showcase/manage/${p.id}`); }} />
      )}
      {accepting && (
        <TextPromptDialog title="Accept your credit" subtitle={`${accepting.projectTitle}${accepting.roleLabel ? ` — ${accepting.roleLabel}` : ''}`}
          label="Name to show publicly" initial={studentSession.name ?? ''} confirmLabel="Accept credit" onClose={() => setAccepting(null)}
          onSubmit={name => respond(accepting, true, name)} />
      )}
    </div>
  );
}
