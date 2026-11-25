import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Search, Star } from 'lucide-react';
import { api, type ShowcaseAdminItem, type ShowcaseProject, type ShowcaseStatus } from '../../lib/api';
import { ShowcaseArticle, StatusBadge } from '../showcase/ShowcaseParts';
import { ConfirmDialog, TextPromptDialog } from '../showcase/ShowcaseDialogs';
import { STATUS_INFO, adminActions, formatDate, previewCredits, type AdminAction } from '../../lib/showcase';

// ─────────────────────────────────────────────────────────────────────────
// Admin moderation for the Public Showcase. Every call goes to the /admin
// endpoints with the admin token; requireAdmin enforces it server-side (the
// UI is never a security boundary). Admins review content and attribution
// (including each contributor's consent), then approve, request changes,
// reject, publish or unpublish. Publishing copies the images to public
// storage — nothing private is ever made public by flipping a flag.
// ─────────────────────────────────────────────────────────────────────────

const FILTERS: Array<{ id: ShowcaseStatus | ''; label: string }> = [
  { id: 'submitted', label: 'Needs review' }, { id: 'changes_requested', label: 'Changes requested' }, { id: 'approved', label: 'Approved' },
  { id: 'published', label: 'Published' }, { id: 'rejected', label: 'Rejected' }, { id: 'archived', label: 'Archived' }, { id: '', label: 'All' },
];

export function ShowcaseModerationTab() {
  const [status, setStatus] = useState<ShowcaseStatus | ''>('submitted');
  const [q, setQ] = useState('');
  const [list, setList] = useState<ShowcaseAdminItem[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShowcaseProject | null>(null);
  const [asking, setAsking] = useState<AdminAction | null>(null);
  const [confirming, setConfirming] = useState<AdminAction | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try { setList((await api.showcase.adminList(status, q.trim() || undefined)).projects); } catch { setError(true); }
  }, [status, q]);
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [load]);

  const open = async (id: string) => {
    setOpenId(id); setDetail(null);
    try { setDetail(await api.showcase.adminGet(id)); } catch { toast.error('Couldn’t load this project'); setOpenId(null); }
  };

  const transition = async (a: AdminAction, reason?: string) => {
    const p = await api.showcase.adminTransition(detail!.id, a.to, reason);
    setDetail(p); void load();
    toast.success(a.to === 'published' ? 'Published — images copied to public storage' : `${a.label} done`);
  };

  const owner = detail?.credits.find(c => c.isOwner);
  const preview = detail && {
    title: detail.title, summary: detail.summary, description: detail.description, category: detail.category, tags: detail.tags, disciplines: detail.disciplines,
    credits: previewCredits(detail), links: detail.links, publishedAt: detail.publishedAt, artworks: [],
    works: detail.works.filter(w => w.previewUrl).map(w => ({ url: w.previewUrl!, caption: w.caption, width: w.width, height: w.height })),
    cover: detail.works.find(w => w.isCover)?.previewUrl ? { url: detail.works.find(w => w.isCover)!.previewUrl!, width: null, height: null } : null,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 className="type-headline" style={{ margin: 0 }}>Showcase projects</h2>
        <p className="type-caption" style={{ margin: '4px 0 0' }}>Review student projects. Only projects you approve <em>and</em> publish appear publicly.</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div role="group" aria-label="Status filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.label} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)} className="type-caption"
              style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', color: 'var(--color-ink)', background: status === f.id ? 'var(--color-surface-2)' : 'transparent', border: `1px solid ${status === f.id ? 'var(--color-brand)' : 'var(--color-hairline)'}` }}>{f.label}</button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)' }} />
          <input className="input-base" type="search" aria-label="Search projects" placeholder="Search by title" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30 }} />
        </div>
        <button type="button" className="btn-translucent btn-sm" onClick={() => void load()}>Refresh</button>
      </div>

      {error && <div role="alert"><p className="type-body-sm">Couldn’t load projects.</p><button className="btn-translucent btn-sm" onClick={() => void load()}>Try again</button></div>}
      {list === null && !error && <p role="status" className="type-caption">Loading…</p>}
      {list && list.length === 0 && <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>Nothing here{status === 'submitted' ? ' — no projects are waiting for review.' : '.'}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list?.map(p => (
          <button key={p.id} type="button" onClick={() => void open(p.id)} aria-label={`Review ${p.title}`}
            style={{ textAlign: 'left', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', border: `1px solid ${openId === p.id ? 'var(--color-brand)' : 'var(--color-hairline)'}`, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', color: 'var(--color-ink)', cursor: 'pointer' }}>
            <span style={{ minWidth: 0 }}>
              <span className="type-body-sm" style={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>{p.title}</span>
              <span className="type-caption" style={{ display: 'block' }}>{p.ownerName ?? p.ownerRoll} · {p.ownerRoll} · {p.submittedAt ? `submitted ${formatDate(p.submittedAt)}` : `updated ${formatDate(p.updatedAt)}`}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{p.featured && <Star size={14} aria-label="Featured" />}<StatusBadge status={p.status} /></span>
          </button>
        ))}
      </div>

      {openId && (
        <section aria-label="Project review" style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-xl)', padding: 20, background: 'var(--color-surface-1)', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {!detail && <p role="status" className="type-caption">Loading…</p>}
          {detail && preview && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><StatusBadge status={detail.status} /><span className="type-caption">{STATUS_INFO[detail.status].label} · /{detail.slug}</span></div>
                <button type="button" className="btn-translucent btn-sm" onClick={() => { setOpenId(null); setDetail(null); }}>Close</button>
              </div>

              <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)' }}>
                  <p className="type-caption" style={{ margin: '0 0 6px', fontWeight: 600 }}>Attribution &amp; consent</p>
                  <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detail.credits.map(c => (
                      <li key={c.id} className="type-caption">
                        {c.displayName ?? '(no name yet)'} <span style={{ color: 'var(--color-ink-muted)' }}>({c.roll})</span>{c.roleLabel ? ` · ${c.roleLabel}` : ''}{c.contribution ? ` — ${c.contribution}` : ''}
                        {' '}<strong>{c.isOwner ? 'owner' : c.status}</strong>
                      </li>
                    ))}
                  </ul>
                  {owner && <p className="type-micro" style={{ margin: '8px 0 0' }}>Owner: {owner.displayName} ({owner.roll}). Only accepted credits appear publicly.</p>}
                </div>
                <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)' }}>
                  <p className="type-caption" style={{ margin: '0 0 6px', fontWeight: 600 }}>Checks</p>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li className="type-caption">{detail.works.length} image{detail.works.length === 1 ? '' : 's'} (publishing copies them to public storage)</li>
                    <li className="type-caption">{detail.problems.length === 0 ? 'All submission requirements met' : `Open items: ${detail.problems.join('; ')}`}</li>
                    {detail.boards.length > 0 && <li className="type-caption">Process moodboards (private): {detail.boards.map(b => b.name).join(', ')}</li>}
                  </ul>
                  {detail.reviewNote && <p className="type-micro" style={{ margin: '8px 0 0' }}>Last note: “{detail.reviewNote}”</p>}
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {adminActions(detail.status).map(a => (
                  <button key={a.to} type="button" className={a.tone === 'primary' ? 'btn-primary' : a.tone === 'danger' ? 'btn-translucent is-danger' : 'btn-translucent'}
                    onClick={() => (a.needsReason ? setAsking(a) : a.to === 'published' || a.to === 'archived' ? setConfirming(a) : void transition(a).catch(e => toast.error(e instanceof Error ? e.message : 'Failed')))}>{a.label}</button>
                ))}
                {detail.status === 'published' && (
                  <button type="button" className="btn-translucent" onClick={() => void api.showcase.adminFeature(detail.id, !detail.featured).then(p => { setDetail(p); void load(); toast.success(p.featured ? 'Featured' : 'Unfeatured'); }).catch(e => toast.error(e instanceof Error ? e.message : 'Failed'))}>
                    <Star size={14} aria-hidden="true" /> {detail.featured ? 'Remove from featured' : 'Feature'}
                  </button>
                )}
              </div>

              {detail.events.length > 0 && (
                <details><summary className="type-caption" style={{ cursor: 'pointer' }}>Audit trail ({detail.events.length})</summary>
                  <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>{detail.events.map((e, i) => <li key={i} className="type-caption">{formatDate(e.at)} · {e.by} · {e.from ? `${STATUS_INFO[e.from].label} → ` : ''}{STATUS_INFO[e.to].label}{e.reason ? ` — “${e.reason}”` : ''}</li>)}</ol></details>
              )}

              <div style={{ borderTop: '1px solid var(--color-hairline)', paddingTop: 18 }}><ShowcaseArticle data={preview} preview /></div>
            </>
          )}
        </section>
      )}

      {asking && detail && (
        <TextPromptDialog title={asking.label} subtitle={`${detail.title} — the student sees this reason`} label="Reason" multiline minLength={3} confirmLabel={asking.label}
          onClose={() => setAsking(null)} onSubmit={async reason => { await transition(asking, reason); setAsking(null); }} />
      )}
      {confirming && detail && (
        <ConfirmDialog danger={confirming.to === 'archived'} title={confirming.label} confirmLabel={confirming.label} onClose={() => setConfirming(null)}
          body={confirming.to === 'published'
            ? `This copies ${detail.works.length} image${detail.works.length === 1 ? '' : 's'} (re-encoded, metadata removed) to public storage and makes “${detail.title}” visible to everyone. The student’s private files are not changed.`
            : 'The project is removed from the public Showcase and its public image copies are deleted.'}
          onConfirm={async () => { await transition(confirming); setConfirming(null); }} />
      )}
    </div>
  );
}
