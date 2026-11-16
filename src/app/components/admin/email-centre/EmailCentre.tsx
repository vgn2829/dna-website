import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, Layers, PenSquare, Users } from 'lucide-react';
import { applyTemplate, emailApi, newComposer, type Meta, type TemplateDetail, type DraftSummary } from '../../../lib/emailCentre';
import { Activity } from './Activity';
import { Compose } from './Compose';
import { PreviewDialog, ReviewDialog } from './Dialogs';
import { RecipientsPanel } from './RecipientsPanel';
import { EC_CSS, Spinner, errMsg, timeAgo } from './shared';
import { Templates } from './Templates';
import { useComposer } from './useComposer';

type Section = 'compose' | 'recipients' | 'templates' | 'activity';
const SECTIONS: { id: Section; label: string; icon: typeof PenSquare }[] = [
  { id: 'compose', label: 'Compose', icon: PenSquare }, { id: 'recipients', label: 'Recipients', icon: Users },
  { id: 'templates', label: 'Templates', icon: Layers }, { id: 'activity', label: 'Activity', icon: Inbox },
];

/** DNA Admin — Email Centre: compose, recipients, templates, activity. */
export function EmailCentre() {
  const [section, setSection] = useState<Section>('compose');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState('');
  const composer = useComposer();
  const { state, setState, setSilently } = composer;
  const [preview, setPreview] = useState<{ test: boolean } | null>(null);
  const [review, setReview] = useState(false);
  const [openActivity, setOpenActivity] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => { emailApi.meta().then(setMeta).catch(e => setMetaError(errMsg(e))); }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const loadDrafts = useCallback(() => emailApi.drafts().then(r => setDrafts(r.drafts)).catch(() => setDrafts([])), []);
  useEffect(() => { if (section === 'compose') void loadDrafts(); }, [section, loadDrafts]);

  const onKeyTabs = (e: React.KeyboardEvent) => {
    const i = SECTIONS.findIndex(s => s.id === section);
    if (e.key === 'ArrowRight') setSection(SECTIONS[(i + 1) % SECTIONS.length].id);
    else if (e.key === 'ArrowLeft') setSection(SECTIONS[(i - 1 + SECTIONS.length) % SECTIONS.length].id);
    else return;
    e.preventDefault();
  };

  const useTemplate = (t: TemplateDetail) => {
    const hasWork = Boolean(state.subject.default.trim()) || JSON.stringify(state.doc) !== JSON.stringify(newComposer().doc);
    if (hasWork && !window.confirm('Replace the subject and message in the composer with this template? Your recipients are kept.')) return;
    composer.reset(applyTemplate({ ...state, draftId: null, revision: 0, attachments: [] }, t));
    setSection('compose');
    notify(`“${t.name}” loaded into the composer`);
  };

  const openDraft = async (id: string) => {
    try { await composer.loadDraft(id); notify('Draft restored'); } catch (e) { notify(errMsg(e), 'warn'); }
  };
  const deleteDraft = async (id: string) => {
    if (!window.confirm('Delete this draft and its attachments?')) return;
    try {
      await emailApi.deleteDraft(id);
      if (state.draftId === id) composer.reset();
      void loadDrafts();
    } catch (e) { notify(errMsg(e), 'warn'); }
  };
  const saveNow = async () => { await composer.flush(); notify('Draft saved'); void loadDrafts(); };

  const onSent = (messageId: string, messages: number) => {
    setReview(false);
    composer.reset();
    setOpenActivity(messageId);
    setSection('activity');
    notify(`${messages} email${messages === 1 ? '' : 's'} queued — follow progress below`);
  };

  return (
    <div className="ec-root">
      <style>{EC_CSS}</style>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 20 }}>Email Centre</h2>
        <p className="ec-hint" style={{ margin: '2px 0 0' }}>
          Compose, personalize and track emails.
          {meta && !meta.providerLive && <strong style={{ color: 'var(--color-warning)' }}> Dev mode: no email provider key is set, so nothing is actually delivered.</strong>}
        </p>
      </div>

      <div role="tablist" aria-label="Email Centre sections" onKeyDown={onKeyTabs} style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-hairline)', marginBottom: 18, overflowX: 'auto' }}>
        {SECTIONS.map(s => (
          <button key={s.id} role="tab" id={`ec-tab-${s.id}`} aria-selected={section === s.id} aria-controls={`ec-panel-${s.id}`} tabIndex={section === s.id ? 0 : -1} className="ec-tab" type="button" onClick={() => setSection(s.id)}>
            <s.icon size={14} style={{ verticalAlign: -2, marginRight: 6 }} aria-hidden />{s.label}
            {s.id === 'recipients' && (state.recipients.length + state.groups.length > 0) && <span className="ec-hint" style={{ marginLeft: 6 }}>({state.recipients.length + state.groups.length})</span>}
          </button>
        ))}
      </div>

      {metaError && <p role="alert" style={{ color: 'var(--color-error)', marginBottom: 12 }}>Couldn’t load Email Centre settings: {metaError}</p>}
      {toast && <div role="status" aria-live="polite" className="ec-card" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1200, padding: '10px 14px', maxWidth: 380, fontSize: 13, borderColor: toast.tone === 'warn' ? 'var(--color-warning)' : 'var(--color-success)', background: 'var(--color-surface-2)' }}>{toast.text}</div>}

      <div role="tabpanel" id={`ec-panel-${section}`} aria-labelledby={`ec-tab-${section}`}>
        {section === 'compose' && (
          <div style={{ display: 'grid', gap: 14 }}>
            {drafts && drafts.filter(d => d.id !== state.draftId).length > 0 && (
              <details className="ec-card" style={{ padding: '8px 14px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>Saved drafts ({drafts.filter(d => d.id !== state.draftId).length})</summary>
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
                  {drafts.filter(d => d.id !== state.draftId).map(d => (
                    <li key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                      <span style={{ flex: 1, minWidth: 200 }}>{d.subject || d.title || '(no subject)'} <span className="ec-hint">· {d.recipientCount} recipients · {timeAgo(d.updatedAt)}</span></span>
                      <button type="button" className="ec-btn" style={{ minHeight: 30 }} onClick={() => void openDraft(d.id)}>Restore</button>
                      <button type="button" className="ec-btn ec-btn-danger" style={{ minHeight: 30 }} onClick={() => void deleteDraft(d.id)}>Delete</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {state.draftId && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ec-btn ec-btn-danger" style={{ minHeight: 30 }} onClick={() => void deleteDraft(state.draftId!)}>Discard this draft</button>
                <button type="button" className="ec-btn" style={{ minHeight: 30 }} onClick={() => { void composer.flush().then(() => composer.reset()); }}>New email</button>
              </div>
            )}
            {!meta && !metaError ? <Spinner /> : (
              <Compose state={state} setState={setState} setSilently={setSilently} meta={meta} contentKey={composer.contentKey}
                ensureDraft={composer.ensureDraft} goRecipients={() => setSection('recipients')} onSaveNow={() => void saveNow()}
                onPreview={test => setPreview({ test })} onReview={() => { void composer.flush(); setReview(true); }}
                save={{ status: composer.status, savedAt: composer.savedAt, error: composer.error }} />
            )}
          </div>
        )}
        {section === 'recipients' && <RecipientsPanel state={state} setState={setState} meta={meta} notify={notify} />}
        {section === 'templates' && <Templates meta={meta} onUse={useTemplate} notify={notify} />}
        {section === 'activity' && <Activity openId={openActivity} notify={notify} />}
      </div>

      {preview && <PreviewDialog open onClose={() => setPreview(null)} state={state} setState={setState} startWithTest={preview.test} />}
      {review && <ReviewDialog open onClose={() => setReview(false)} state={state} setState={setState} flush={composer.flush} onSent={onSent} onSaveDraft={() => void saveNow()} />}
    </div>
  );
}
