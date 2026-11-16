import { useState } from 'react';
import { LibraryDialog } from '../assets/LibraryDialog';

// Small dialogs for the Showcase creator flow (same LibraryDialog chrome as
// the Asset Library: portalled, focus-trapped, viewport-capped). Each submit
// is async and closes only via the caller, so server errors stay visible.

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const LABEL: React.CSSProperties = { display: 'block', marginBottom: 6 };

export function ConfirmDialog({ title, body, confirmLabel, danger, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => { setBusy(true); setError(null); try { await onConfirm(); } catch (e) { setError(errorText(e)); setBusy(false); } };
  return (
    <LibraryDialog title={title} role="alertdialog" maxWidth={440} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
      <button type="button" className={danger ? 'btn-primary is-danger' : 'btn-primary'} onClick={run} disabled={busy} style={{ minHeight: 40, opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : confirmLabel}</button>
    </>}>
      <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>{body}</p>
      {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-error)' }}>{error}</p>}
    </LibraryDialog>
  );
}

/** One required text field (+ optional second) — new project title, accept-credit name, review reason. */
export function TextPromptDialog({ title, subtitle, label, placeholder, initial = '', multiline, confirmLabel, minLength = 1, onClose, onSubmit }: {
  title: string; subtitle?: string; label: string; placeholder?: string; initial?: string; multiline?: boolean;
  confirmLabel: string; minLength?: number; onClose: () => void; onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = value.trim().length >= minLength;
  const submit = async () => { if (!ok || busy) return; setBusy(true); setError(null); try { await onSubmit(value.trim()); } catch (e) { setError(errorText(e)); setBusy(false); } };
  return (
    <LibraryDialog title={title} subtitle={subtitle} maxWidth={460} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
      <button type="button" className="btn-primary" onClick={submit} disabled={!ok || busy} style={{ minHeight: 40, opacity: !ok || busy ? 0.6 : 1 }}>{busy ? 'Working…' : confirmLabel}</button>
    </>}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label htmlFor="showcase-prompt" className="type-caption" style={LABEL}>{label}</label>
        {multiline
          ? <textarea id="showcase-prompt" className="input-base" autoFocus rows={4} maxLength={1000} placeholder={placeholder} value={value} onChange={e => setValue(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
          : <input id="showcase-prompt" className="input-base" autoFocus maxLength={120} placeholder={placeholder} value={value} onChange={e => setValue(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />}
        {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-error)' }}>{error}</p>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </LibraryDialog>
  );
}
