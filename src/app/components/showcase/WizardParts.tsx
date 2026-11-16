import { Check, Pencil } from 'lucide-react';
import { WIZARD_STEPS, STEP_COUNT } from '../../lib/showcaseWizard';
import { categoryLabel } from '../../lib/showcase';

// Presentational pieces of the seven-step submission wizard. All state lives in
// ShowcaseEditorPage; nothing here talks to the server.

export function WizardStepper({ current, reach, done, onGo }: {
  current: number;
  /** Highest step the user may jump to (everything before the first incomplete step, or the current one). */
  reach: number;
  done: boolean[];
  onGo: (i: number) => void;
}) {
  return (
    <nav aria-label="Submission steps">
      {/* Small screens: one line + a progress bar. Wider: the full numbered list. */}
      <p className="wiz-compact type-caption" style={{ margin: '0 0 8px' }}>
        Step {current + 1} of {STEP_COUNT} · <strong>{WIZARD_STEPS[current].label}</strong>
      </p>
      <div className="wiz-compact" role="progressbar" aria-label="Submission progress" aria-valuemin={1} aria-valuemax={STEP_COUNT} aria-valuenow={current + 1}
        style={{ height: 4, borderRadius: 999, background: 'var(--color-surface-2)', overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ width: `${((current + 1) / STEP_COUNT) * 100}%`, height: '100%', background: 'var(--color-brand)' }} />
      </div>
      <ol className="wiz-steps">
        {WIZARD_STEPS.map((s, i) => {
          const isCurrent = i === current;
          const allowed = i <= reach;
          return (
            <li key={s.id}>
              <button type="button" className="wiz-step" aria-current={isCurrent ? 'step' : undefined} disabled={!allowed} onClick={() => onGo(i)}
                aria-label={`Step ${i + 1}: ${s.title}${done[i] && !isCurrent ? ' (complete)' : ''}`}>
                <span className="wiz-dot" data-done={done[i] && !isCurrent ? 'true' : undefined} aria-hidden="true">{done[i] && !isCurrent ? <Check size={12} /> : i + 1}</span>
                <span className="wiz-label">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface ReviewData {
  title: string; summary: string; description: string; category: string; tags: string[];
  disciplines: string[]; links: Array<{ label: string; url: string }>;
  coverUrl: string | null; imageCount: number; boardCount: number;
  credits: Array<{ name: string; role: string | null; status: 'accepted' | 'pending' | 'declined'; isOwner: boolean }>;
}

/** Read-only summary of everything that will be submitted; each block links back to the step that edits it. */
export function ReviewSummary({ data, onEdit }: { data: ReviewData; onEdit: (step: number) => void }) {
  const block = (step: number, title: string, children: React.ReactNode) => (
    <section aria-label={title} style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 className="type-body-sm" style={{ margin: 0, fontWeight: 600 }}>{title}</h3>
        <button type="button" className="btn-translucent btn-sm" onClick={() => onEdit(step)} aria-label={`Edit ${title}`}><Pencil size={12} aria-hidden="true" /> Edit</button>
      </div>
      {children}
    </section>
  );
  const muted = { margin: 0, color: 'var(--color-ink-muted)' } as const;
  const none = <p className="type-caption" style={muted}>Nothing added</p>;
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
      {block(0, 'Project basics', <>
        <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{data.title || 'Untitled'}</p>
        <p className="type-caption" style={{ ...muted, overflowWrap: 'anywhere' }}>{data.summary || 'No summary'}</p>
        <p className="type-caption" style={muted}>{categoryLabel(data.category) ?? 'No category'}{data.disciplines.length ? ` · ${data.disciplines.join(', ')}` : ''}</p>
      </>)}
      {block(1, 'Cover and media', <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 88, height: 66, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--color-surface-2)', flexShrink: 0 }}>
          {data.coverUrl && <img src={data.coverUrl} alt="Cover image" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <p className="type-caption" style={muted}>{data.imageCount} image{data.imageCount === 1 ? '' : 's'}{data.coverUrl ? '' : ' · no cover yet'}</p>
      </div>)}
      {block(2, 'Project story', data.description.trim()
        ? <p className="type-caption" style={{ ...muted, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.description}</p> : none)}
      {block(3, 'Contributors', <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.credits.map((c, i) => (
          <li key={i} className="type-caption" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflowWrap: 'anywhere' }}>{c.name || 'Unnamed'}{c.role ? ` · ${c.role}` : ''}{c.isOwner ? ' (you)' : ''}</span>
            <span style={{ color: c.status === 'accepted' ? 'var(--color-ink)' : 'var(--color-ink-muted)', flexShrink: 0 }}>{c.status === 'accepted' ? 'Accepted' : c.status === 'pending' ? 'Waiting' : 'Declined'}</span>
          </li>))}
      </ul>)}
      {block(4, 'Tools and resources', <>
        <p className="type-caption" style={muted}>{data.boardCount} moodboard{data.boardCount === 1 ? '' : 's'} (private)</p>
        {data.links.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{data.links.map((l, i) => <li key={i} className="type-caption" style={{ overflowWrap: 'anywhere' }}>{l.label || l.url}</li>)}</ul> : <p className="type-caption" style={muted}>No links</p>}
      </>)}
      {block(5, 'Discovery details', data.tags.length
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{data.tags.map(t => <span key={t} className="type-micro" style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)' }}>{t}</span>)}</div>
        : <p className="type-caption" style={muted}>No tags (optional)</p>)}
    </div>
  );
}
