import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { UserPlus, Users } from 'lucide-react';
import { api, type CollabInvitation, type SharedProject } from '../../lib/api';
import { ROLE_INFO, relativeTime } from '../../lib/collaboration';
import { STATUS_INFO } from '../../lib/showcase';
import { CoverImage, StatusBadge } from './ShowcaseParts';
import { TextPromptDialog } from './ShowcaseDialogs';

// Collaboration inbox for "My projects": invitations waiting for an answer and
// projects other students have shared with you. Accepting access and being
// credited publicly are two separate decisions — a proposed credit only
// becomes yours once you accept it and choose the name shown.

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' };
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong — please try again');

export function SharedProjects({ roll, studentName, onSessionExpired }: { roll: string; studentName: string; onSessionExpired: () => void }) {
  const [invites, setInvites] = useState<CollabInvitation[] | null>(null);
  const [shared, setShared] = useState<SharedProject[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [naming, setNaming] = useState<CollabInvitation | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [i, s] = await Promise.all([api.showcase.collab.invitations(roll), api.showcase.collab.shared(roll)]);
      setInvites(i.invitations); setShared(s.projects);
    } catch (e) { if (e instanceof Error && e.message === 'SESSION_EXPIRED') onSessionExpired(); else setFailed(true); }
  }, [roll, onSessionExpired]);
  useEffect(() => { void load(); }, [load]);

  const answer = async (inv: CollabInvitation, fn: () => Promise<unknown>, ok: string) => {
    setBusy(inv.id);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  if (failed) return <p role="alert" className="type-body-sm" style={{ margin: '0 0 var(--space-lg)' }}>Couldn’t load your collaboration invitations. <button type="button" className="btn-translucent btn-sm" onClick={() => void load()}>Try again</button></p>;
  if (!invites && !shared) return null;
  if (!invites?.length && !shared?.length) return null;

  return (
    <>
      {invites && invites.length > 0 && (
        <section aria-label="Collaboration invitations" style={{ marginBottom: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className="type-headline" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><UserPlus size={16} aria-hidden="true" /> Invitations to collaborate</h2>
          {invites.map(inv => (
            <div key={inv.id} style={row}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{inv.projectTitle}</p>
                <p className="type-caption" style={{ margin: '2px 0 0' }}>{inv.ownerName} invited you as {inv.accessRole === 'editor' ? 'an editor' : 'a viewer'} · {relativeTime(inv.invitedAt)}</p>
                <p className="type-micro" style={{ margin: '2px 0 0' }}>{ROLE_INFO[inv.accessRole].blurb}</p>
                {inv.creditProposed && <p className="type-micro" style={{ margin: '2px 0 0' }}>They also asked to credit you{inv.creditRole ? ` as ${inv.creditRole}` : ''}. That’s your decision, and only appears publicly if you accept it.</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary btn-sm touch-target" disabled={busy === inv.id}
                  onClick={() => void answer(inv, () => api.showcase.collab.accept(roll, inv.id), 'You joined the project')}>Accept</button>
                {inv.creditProposed && <button type="button" className="btn-translucent btn-sm touch-target" disabled={busy === inv.id} onClick={() => setNaming(inv)}>Accept &amp; be credited…</button>}
                <button type="button" className="btn-translucent btn-sm touch-target" disabled={busy === inv.id}
                  onClick={() => void answer(inv, () => api.showcase.collab.decline(roll, inv.id), 'Invitation declined')}>Decline</button>
                <button type="button" className="btn-translucent btn-sm is-danger touch-target" disabled={busy === inv.id}
                  onClick={() => void answer(inv, () => api.showcase.collab.decline(roll, inv.id, true), `Declined — ${inv.ownerName} can’t invite you again`)}>Decline &amp; block</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {shared && shared.length > 0 && (
        <section aria-label="Shared with you" style={{ marginBottom: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className="type-headline" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Users size={16} aria-hidden="true" /> Shared with you</h2>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
            {shared.map(p => (
              <Link key={p.id} to={`/showcase/manage/${p.id}`} aria-label={`${p.title}, ${STATUS_INFO[p.status].label}, you are ${p.accessRole === 'editor' ? 'an editor' : 'a viewer'}`}
                style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', overflow: 'hidden' }}>
                <CoverImage src={p.coverUrl} />
                <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{p.title}</p>
                  <p className="type-micro" style={{ margin: 0 }}>{p.ownerName}’s project · you’re {p.accessRole === 'editor' ? 'an editor' : 'a viewer'}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><StatusBadge status={p.status} /><span className="type-micro">{relativeTime(p.updatedAt)}</span></div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {naming && (
        <TextPromptDialog title="Accept and be credited" subtitle={`${naming.projectTitle}${naming.creditRole ? ` — ${naming.creditRole}` : ''}`} label="Name to show publicly"
          initial={studentName} confirmLabel="Accept" onClose={() => setNaming(null)}
          onSubmit={async name => { await api.showcase.collab.accept(roll, naming.id, name); toast.success('You joined and accepted your credit'); setNaming(null); await load(); }} />
      )}
    </>
  );
}
