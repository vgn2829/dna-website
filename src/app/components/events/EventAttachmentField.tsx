import { useId, useRef, useState } from 'react';
import { ExternalLink, FileText, UploadCloud } from 'lucide-react';
import type { EventAttachment } from '../../context/AppDataContext';
import { EVENT_ATTACHMENT_ACCEPT, attachmentFieldState, attachmentMeta, checkEventAttachment } from '../../lib/eventForm';

// ─────────────────────────────────────────────────────────────────────────
// The admin event form's optional attachment (e.g. a problem statement) —
// one component for both Schedule Event and Edit Event.
//
// It only STAGES a choice: the file travels with the event's own save
// request (AdminPage eventFormData), and the server stores the event and
// its file together or not at all. So nothing here claims an upload is
// done — `saving` shows the in-flight state, and after a failed save the
// staged file and the rest of the form are still here to retry.
//
// States (eventForm.ts attachmentFieldState): empty → drop zone; new /
// replacing → the chosen file, marked as not yet uploaded; saved → the
// stored file with Open / Replace / Remove; removing → struck through with
// Undo until the event is saved. Files are checked up front with the
// server's own rules (type, empty, 25 MB), so a bad file is refused here,
// in place, instead of after an upload.
// ─────────────────────────────────────────────────────────────────────────

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
  padding: '10px 12px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-hairline)', background: 'var(--color-surface-2)',
};

export function EventAttachmentField({
  saved,
  file,
  onFileChange,
  removeSaved = false,
  onRemoveSavedChange,
  saving = false,
}: {
  // The event's stored attachment (edit only; null when creating).
  saved: EventAttachment | null;
  file: File | null;
  onFileChange: (file: File | null) => void;
  removeSaved?: boolean;
  onRemoveSavedChange?: (remove: boolean) => void;
  // The event (and this file with it) is being saved.
  saving?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const state = attachmentFieldState(saved !== null, file !== null, removeSaved);

  const choose = (picked: File | undefined) => {
    if (!picked) return;
    const problem = checkEventAttachment(picked);
    if (problem) { setError(`“${picked.name}” wasn’t added — ${problem.charAt(0).toLowerCase()}${problem.slice(1)}.`); return; }
    setError('');
    onFileChange(picked);
    onRemoveSavedChange?.(false);
  };
  const browse = () => inputRef.current?.click();
  const clearFile = () => { onFileChange(null); setError(''); };

  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
      <p id={`${id}-label`} className="type-micro" style={{ margin: '0 0 4px' }}>Attachment (optional)</p>
      <input
        ref={inputRef}
        type="file"
        accept={EVENT_ATTACHMENT_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }}
        style={{ display: 'none' }}
      />

      {state === 'empty' ? (
        <button
          type="button"
          onClick={browse}
          disabled={saving}
          aria-describedby={describedBy}
          onDragOver={e => { e.preventDefault(); if (!saving) setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={e => { e.preventDefault(); setDragActive(false); if (!saving) choose(e.dataTransfer.files?.[0]); }}
          style={{
            width: '100%', padding: '18px 14px', cursor: saving ? 'not-allowed' : 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center',
            border: `1.5px dashed ${dragActive ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
            borderRadius: 'var(--radius-lg)',
            background: dragActive ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'var(--color-canvas)',
            color: 'var(--color-ink)', fontFamily: 'var(--font-body)', transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <UploadCloud size={22} strokeWidth={1.6} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          <span className="type-body-sm">Drop a file here or choose a file</span>
        </button>
      ) : (
        <div style={ROW} aria-live="polite">
          <FileText size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-ink-muted)' }} />
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            {state === 'saved' || state === 'removing' ? (
              <a
                href={saved!.url}
                target="_blank"
                rel="noopener noreferrer"
                className="type-body-sm"
                title={saved!.name}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', color: 'var(--color-ink)',
                  textDecoration: state === 'removing' ? 'line-through' : 'underline', textUnderlineOffset: 2,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saved!.name}</span>
                <ExternalLink size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <p className="type-body-sm" title={file!.name} style={{ margin: 0, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file!.name}
              </p>
            )}
            <p className="type-micro" style={{ margin: '2px 0 0', color: state === 'removing' ? 'var(--color-error)' : 'var(--color-ink-muted)' }}>
              {state === 'saved' && <>{attachmentMeta(saved!.name, saved!.size)} · Saved</>}
              {state === 'removing' && <>Will be removed when you save</>}
              {(state === 'new' || state === 'replacing') && (
                <>
                  {attachmentMeta(file!.name, file!.size)} · {saving ? 'Uploading…' : state === 'replacing' ? `Replaces “${saved!.name}” when you save` : 'Uploads when you save'}
                </>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {state === 'removing' ? (
              <button type="button" className="btn-secondary btn-sm touch-target" disabled={saving}
                onClick={() => onRemoveSavedChange?.(false)} aria-label={`Undo removing ${saved!.name}`}>
                Undo
              </button>
            ) : (<>
              <button type="button" className="btn-secondary btn-sm touch-target" disabled={saving} onClick={browse}
                aria-label={`Replace ${state === 'saved' ? saved!.name : file!.name}`}>
                Replace
              </button>
              {state === 'replacing' ? (
                <button type="button" className="btn-translucent btn-sm touch-target" disabled={saving} onClick={clearFile}
                  aria-label={`Keep ${saved!.name} instead`}>
                  Keep current
                </button>
              ) : (
                <button type="button" className="btn-translucent btn-sm is-danger touch-target" disabled={saving}
                  onClick={() => (state === 'saved' ? onRemoveSavedChange?.(true) : clearFile())}
                  aria-label={`Remove ${state === 'saved' ? saved!.name : file!.name}`}>
                  Remove
                </button>
              )}
            </>)}
          </div>
        </div>
      )}

      <p id={hintId} className="type-micro" style={{ margin: '4px 0 0', color: 'var(--color-ink-muted)' }}>
        A file students can open from the event — e.g. a problem statement. PDF, PNG, JPG, WEBP, DOCX, PPTX or ZIP, up to 25 MB.
      </p>
      {error && (
        <p id={errorId} role="alert" className="type-micro" style={{ margin: '4px 0 0', color: 'var(--color-error)' }}>{error}</p>
      )}
    </div>
  );
}
