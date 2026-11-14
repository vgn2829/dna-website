import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, FileText, Paperclip, Plus, Send, Trash2, Users, X } from 'lucide-react';
import { useAppData } from '../../../context/AppDataContext';
import {
  composerProblems, conditionFields, distinctValues, emailApi, fieldType, formatBytes, availableVariables, knownVariables,
  newCondition, uploadAttachment, type AttachmentRow, type ComposerState, type Meta, type Mode,
} from '../../../lib/emailCentre';
import type { ConditionContext } from './ConditionBuilder';
import { ConditionBuilder } from './ConditionBuilder';
import { RichEditor, VariableMenu } from './RichEditor';
import { addFromText } from './RecipientsPanel';
import { Badge, Field, Spinner, errMsg } from './shared';
import type { SaveStatus } from './useComposer';

type SetState = (fn: (s: ComposerState) => ComposerState) => void;

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'individual', label: 'Individual (personalized)', blurb: 'One separate email per recipient. Each person gets their own subject and body, and never sees anyone else’s address.' },
  { id: 'normal', label: 'Normal email', blurb: 'One shared email. To and CC recipients see each other; BCC stays hidden. Same content for everyone.' },
];

export function conditionContext(meta: Meta | null, state: ComposerState): ConditionContext {
  return {
    fields: conditionFields(meta, state),
    operators: meta?.operators ?? ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'gt', 'lt', 'one_of'],
    typeOf: f => fieldType(f, state.recipients),
    valuesOf: f => distinctValues(f, state.recipients),
  };
}

export function SaveIndicator({ status, savedAt, error }: { status: SaveStatus; savedAt: Date | null; error: string }) {
  const text = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes' : status === 'error' ? `Not saved — ${error}`
    : status === 'saved' && savedAt ? `Draft saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Draft autosaves as you type';
  return (
    <span role="status" aria-live="polite" className="ec-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: status === 'error' ? 'var(--color-error)' : undefined }}>
      {status === 'saving' ? <Spinner size={12} /> : status === 'saved' ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : null}{text}
    </span>
  );
}

// ── Chips for To / CC / BCC ────────────────────────────────────────────────
function EmailListInput({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState('');
  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const invalid = parts.filter(p => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p));
    const ok = parts.filter(p => !invalid.includes(p) && !value.some(v => v.toLowerCase() === p.toLowerCase()));
    if (ok.length) onChange([...value, ...ok]);
    setText(invalid.join(' ')); setBad(invalid.length ? `Not a valid address: ${invalid.join(', ')}` : '');
  };
  return (
    <Field label={label} htmlFor={id} error={bad}>
      <div className="ec-input" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6 }} aria-invalid={Boolean(bad) || undefined}>
        {value.map(v => (
          <span key={v} className="ec-chip">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter(x => x !== v))}><X size={12} /></button></span>
        ))}
        <input id={id} value={text} placeholder={value.length ? '' : placeholder} onChange={e => { setText(e.target.value); if (bad) setBad(''); }}
          onKeyDown={e => { if (['Enter', ',', ';', ' '].includes(e.key) && text.trim()) { e.preventDefault(); commit(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => commit(text)} onPaste={e => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); commit(t); } }}
          style={{ flex: 1, minWidth: 160, background: 'transparent', border: 0, outline: 'none', color: 'inherit', font: 'inherit', fontSize: 14 }} />
      </div>
    </Field>
  );
}

function ToField({ state, setState, goRecipients }: { state: ComposerState; setState: SetState; goRecipients: () => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const shown = state.recipients.slice(0, 12);
  const submit = async (raw: string) => {
    if (!raw.trim()) return;
    setBusy(true); setMsg('');
    try {
      const r = await addFromText(raw, setState);
      setText(r.invalid.join(' '));
      setMsg(r.invalid.length ? `Not valid: ${r.invalid.join(', ')}` : '');
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };
  const missingName = state.mode === 'individual' ? state.recipients.filter(r => !r.excluded && !r.name.trim()).length : 0;
  return (
    <Field label={state.mode === 'normal' ? 'To' : 'Recipients'} htmlFor="ec-to" error={msg}>
      <div className="ec-input" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, alignItems: 'center' }}>
        {state.groups.map(g => (
          <span key={g.id} className="ec-chip"><Users size={12} aria-hidden /> {g.name}<button type="button" aria-label={`Remove group ${g.name}`} onClick={() => setState(s => ({ ...s, groups: s.groups.filter(x => x.id !== g.id) }))}><X size={12} /></button></span>
        ))}
        {shown.map(r => (
          <span key={r.key} className={`ec-chip${r.excluded ? ' is-excluded' : ''}`} title={`${r.name || 'No name'} · ${r.email} · ${r.source}${r.matchedStudent ? ' · matched student' : ''}`}>
            {r.name.trim() ? <><strong style={{ fontWeight: 600 }}>{r.name}</strong> <span className="ec-hint">{r.email}</span></> : <>{r.email}<Badge tone="warn">no name</Badge></>}
            <button type="button" aria-label={`Remove ${r.email}`} onClick={() => setState(s => ({ ...s, recipients: s.recipients.filter(x => x.key !== r.key) }))}><X size={12} /></button>
          </span>
        ))}
        {state.recipients.length > shown.length && <button type="button" className="ec-chip" onClick={goRecipients}>+{state.recipients.length - shown.length} more</button>}
        <input id="ec-to" value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder={state.recipients.length + state.groups.length ? 'Add more…' : 'Type or paste email addresses'}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && text.trim()) { e.preventDefault(); void submit(text); } }}
          onBlur={() => void submit(text)} onPaste={e => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); void submit(t); } }}
          style={{ flex: 1, minWidth: 180, background: 'transparent', border: 0, outline: 'none', color: 'inherit', font: 'inherit', fontSize: 14 }} />
        {busy && <Spinner />}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
        <button type="button" className="ec-btn" style={{ minHeight: 30, padding: '2px 12px' }} onClick={goRecipients}><Users size={13} /> Students, groups &amp; CSV…</button>
        {missingName > 0 && <span className="ec-hint" style={{ color: 'var(--color-warning)' }}>{missingName} recipient{missingName === 1 ? ' has' : 's have'} no name — add one if the email uses {'{{first_name}}'}.</span>}
      </div>
    </Field>
  );
}

// ── Compose ─────────────────────────────────────────────────────────────────
export function Compose({ state, setState, setSilently, meta, contentKey, ensureDraft, goRecipients, onPreview, onReview, onSaveNow, save }: {
  state: ComposerState; setState: SetState; setSilently: SetState; meta: Meta | null; contentKey: number;
  ensureDraft: () => Promise<string>; goRecipients: () => void; onPreview: (test: boolean) => void; onReview: () => void; onSaveNow: () => void;
  save: { status: SaveStatus; savedAt: Date | null; error: string };
}) {
  const { events } = useAppData();
  const [showCc, setShowCc] = useState(state.cc.length > 0);
  const [showBcc, setShowBcc] = useState(state.bcc.length > 0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState((state.subject.variants?.length ?? 0) > 0);
  const subjectRef = useRef<HTMLInputElement>(null);

  const variables = useMemo(() => availableVariables(meta, state), [meta, state]);
  const known = useMemo(() => knownVariables(meta, state), [meta, state]);
  const cond = useMemo(() => conditionContext(meta, state), [meta, state]);
  const problems = composerProblems(state);
  const copies = state.cc.length + state.bcc.length;

  const insertIntoSubject = (name: string) => {
    const el = subjectRef.current; const token = `{{${name}}}`;
    setState(s => {
      const v = s.subject.default;
      const a = el?.selectionStart ?? v.length; const b = el?.selectionEnd ?? v.length;
      return { ...s, subject: { ...s.subject, default: v.slice(0, a) + token + v.slice(b) } };
    });
    requestAnimationFrame(() => el?.focus());
  };

  const [uploads, setUploads] = useState<{ id: string; name: string; pct: number; error?: string }[]>([]);
  const upload = async (files: File[]) => {
    let draftId: string;
    try { draftId = await ensureDraft(); } catch (e) { setUploads(u => [...u, { id: 'e' + Date.now(), name: 'Draft', pct: 0, error: errMsg(e) }]); return; }
    for (const f of files) {
      const id = `${f.name}-${Date.now()}`;
      setUploads(u => [...u, { id, name: f.name, pct: 0 }]);
      try {
        const a = await uploadAttachment(draftId, f, false, pct => setUploads(u => u.map(x => (x.id === id ? { ...x, pct } : x))));
        setSilently(s => ({ ...s, attachments: [...s.attachments, a] }));
        setUploads(u => u.filter(x => x.id !== id));
      } catch (e) { setUploads(u => u.map(x => (x.id === id ? { ...x, error: errMsg(e) } : x))); }
    }
  };
  const uploadInline = async (file: File): Promise<string> => {
    const draftId = await ensureDraft();
    const a = await uploadAttachment(draftId, file, true, () => undefined);
    setSilently(s => ({ ...s, attachments: [...s.attachments, a] }));
    return `cid:${a.id}`;
  };
  const removeAttachment = async (a: AttachmentRow) => {
    try { await emailApi.removeAttachment(a.id); setSilently(s => ({ ...s, attachments: s.attachments.filter(x => x.id !== a.id) })); }
    catch (e) { setUploads(u => [...u, { id: 'r' + a.id, name: a.filename, pct: 0, error: errMsg(e) }]); }
  };
  const totalBytes = state.attachments.reduce((n, a) => n + a.sizeBytes, 0);
  const inlineIds = new Set(state.attachments.filter(a => a.inline).map(a => a.id));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* 1. Mode */}
      <section aria-label="Sending mode">
        <div role="radiogroup" aria-label="Sending mode" className="ec-seg">
          {MODES.map(m => (
            <button key={m.id} type="button" role="radio" aria-checked={state.mode === m.id} onClick={() => setState(s => ({ ...s, mode: m.id }))}>{m.label}</button>
          ))}
        </div>
        <p className="ec-hint" style={{ marginTop: 8, maxWidth: 720 }}>{MODES.find(m => m.id === state.mode)!.blurb}</p>
      </section>

      <div className="ec-card" style={{ padding: 16, display: 'grid', gap: 14 }}>
        {/* 2. Recipient fields */}
        <Field label="From" hint={`Replies go to ${meta?.replyTo ?? '…'}`}>
          <div className="ec-input" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.85 }} aria-readonly="true">{meta?.sender ?? 'Loading…'}</div>
        </Field>
        <ToField state={state} setState={setState} goRecipients={goRecipients} />
        <div style={{ display: 'flex', gap: 14 }}>
          {!showCc && <button type="button" className="ec-btn" style={{ minHeight: 30 }} onClick={() => setShowCc(true)}>Cc</button>}
          {!showBcc && <button type="button" className="ec-btn" style={{ minHeight: 30 }} onClick={() => setShowBcc(true)}>Bcc</button>}
        </div>
        {showCc && <EmailListInput id="ec-cc" label="Cc" value={state.cc} onChange={cc => setState(s => ({ ...s, cc }))} placeholder="Visible to everyone" />}
        {showBcc && <EmailListInput id="ec-bcc" label="Bcc" value={state.bcc} onChange={bcc => setState(s => ({ ...s, bcc }))} placeholder="Hidden from everyone" />}
        {state.mode === 'individual' && copies > 0 && (
          <p role="note" className="ec-hint" style={{ color: 'var(--color-warning)' }}>
            In Individual mode every Cc/Bcc address gets a copy of <strong>each</strong> email — {copies} address{copies === 1 ? '' : 'es'} × your recipients.
            The review step shows the exact number of extra deliveries.
          </p>
        )}

        {/* 3. Subject */}
        <Field label="Subject" htmlFor="ec-subject">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input id="ec-subject" ref={subjectRef} className="ec-input" value={state.subject.default} placeholder="e.g. Congratulations, {{first_name}}! Your {{team_name}} result is here."
              onChange={e => setState(s => ({ ...s, subject: { ...s.subject, default: e.target.value } }))} maxLength={300} />
            <VariableMenu options={variables} onPick={insertIntoSubject} label="Variable" compact />
          </div>
        </Field>
        <div>
          <button type="button" className="ec-tb" aria-expanded={variantsOpen} onClick={() => setVariantsOpen(o => !o)}>
            {variantsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Subject variations {state.subject.variants?.length ? <Badge tone="info">{state.subject.variants.length}</Badge> : null}
          </button>
          {variantsOpen && (
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              <p className="ec-hint">Use a different subject for some recipients — the first matching variation wins, otherwise the subject above is used.</p>
              {(state.subject.variants ?? []).map((v, i) => (
                <div key={i} className="ec-branch" style={{ display: 'grid', gap: 6 }}>
                  <div className="ec-branch-head"><ConditionBuilder value={v.when} ctx={cond} onChange={when => setState(s => ({ ...s, subject: { ...s.subject, variants: s.subject.variants!.map((x, j) => (j === i ? { ...x, when } : x)) } }))} />
                    <button type="button" className="ec-tb" aria-label="Remove variation" onClick={() => setState(s => ({ ...s, subject: { ...s.subject, variants: s.subject.variants!.filter((_, j) => j !== i) } }))}><Trash2 size={13} /></button></div>
                  <input aria-label={`Subject for variation ${i + 1}`} className="ec-input" placeholder="Subject for these recipients" value={v.subject}
                    onChange={e => setState(s => ({ ...s, subject: { ...s.subject, variants: s.subject.variants!.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)) } }))} />
                </div>
              ))}
              <button type="button" className="ec-btn" style={{ justifySelf: 'start' }} onClick={() => setState(s => ({ ...s, subject: { ...s.subject, variants: [...(s.subject.variants ?? []), { when: newCondition(cond.fields[0]?.name ?? ''), subject: '' }] } }))}><Plus size={13} /> Add variation</button>
            </div>
          )}
        </div>

        {/* 4–5. Editor + personalization tools (toolbar) */}
        <div>
          <span className="ec-label" id="ec-body-label">Message</span>
          <RichEditor key={contentKey} value={state.doc} onChange={doc => setState(s => ({ ...s, doc }))} variables={variables}
            env={{ cond, known }} onUploadImage={uploadInline} ariaLabel="Email body" />
          <p className="ec-hint" style={{ marginTop: 6 }}>
            Use <strong>Insert variable</strong> for personalization and <strong>Conditional block</strong> to show different content to different recipients. Variables turn red if they don’t exist.
          </p>
        </div>

        {/* Options */}
        <div>
          <button type="button" className="ec-tb" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(o => !o)}>
            {optionsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Personalization &amp; options
          </button>
          {optionsOpen && <Options state={state} setState={setState} events={events} meta={meta} />}
        </div>

        {/* 7. Attachments */}
        <div>
          <span className="ec-label">Attachments</span>
          <div style={{ display: 'grid', gap: 6 }}>
            {state.attachments.filter(a => !inlineIds.has(a.id)).map(a => (
              <div key={a.id} className="ec-chip" style={{ borderRadius: 10, padding: '6px 8px 6px 10px', justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}><FileText size={14} aria-hidden /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.filename}</span><span className="ec-hint">{formatBytes(a.sizeBytes)}</span></span>
                <button type="button" aria-label={`Remove attachment ${a.filename}`} onClick={() => void removeAttachment(a)}><X size={13} /></button>
              </div>
            ))}
            {uploads.map(u => (
              <div key={u.id} role={u.error ? 'alert' : 'status'} className="ec-chip" style={{ borderRadius: 10, display: 'grid', gap: 4, padding: '6px 10px', borderColor: u.error ? 'var(--color-error)' : undefined }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{u.name}</span>
                  {u.error ? <button type="button" aria-label="Dismiss" onClick={() => setUploads(x => x.filter(y => y.id !== u.id))}><X size={12} /></button> : <span className="ec-hint">{u.pct}%</span>}</span>
                {u.error ? <span className="ec-hint" style={{ color: 'var(--color-error)' }}>{u.error}</span>
                  : <progress value={u.pct} max={100} aria-label={`Uploading ${u.name}`} style={{ width: '100%', height: 4 }} />}
              </div>
            ))}
          </div>
          <label className="ec-btn" style={{ marginTop: 8, cursor: 'pointer' }}>
            <Paperclip size={14} /> Attach files
            <input type="file" multiple hidden accept={meta?.attachmentAccept} onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void upload(fs); }} />
          </label>
          <span className="ec-hint" style={{ marginLeft: 10 }}>
            {totalBytes > 0 ? `${formatBytes(totalBytes)} of ${formatBytes(meta?.limits.maxTotalAttachmentBytes ?? 15728640)} · ` : ''}
            max {formatBytes(meta?.limits.maxAttachmentBytes ?? 10485760)} per file · stored privately, one copy for all recipients
          </span>
        </div>
      </div>

      {/* 8–9. Actions */}
      <div style={{ position: 'sticky', bottom: 8, zIndex: 5 }}>
        <div className="ec-card" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', background: 'var(--color-surface-2)', boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}>
          <SaveIndicator {...save} />
          <span style={{ flex: 1 }} />
          {problems.length > 0 && <span className="ec-hint ec-hide-sm">{problems[0]}</span>}
          <button type="button" className="ec-btn" onClick={onSaveNow}>Save draft</button>
          <button type="button" className="ec-btn" disabled={problems.some(p => p.startsWith('Write') || p.startsWith('Add a subject'))} onClick={() => onPreview(false)}><Eye size={14} /> Preview</button>
          <button type="button" className="ec-btn" disabled={problems.some(p => p.startsWith('Write') || p.startsWith('Add a subject'))} onClick={() => onPreview(true)}>Send test</button>
          <button type="button" className="ec-btn ec-btn-primary" disabled={problems.length > 0} onClick={onReview}><Send size={14} /> Review &amp; send</button>
        </div>
      </div>
    </div>
  );
}

function Options({ state, setState, events, meta }: { state: ComposerState; setState: SetState; events: { id: string; title: string; date: string }[]; meta: Meta | null }) {
  const [k, setK] = useState(''); const [fk, setFk] = useState('');
  const builtinShared = (meta?.variables ?? []).filter(v => v.scope === 'shared' && v.category === 'Selection').map(v => v.name);
  const addShared = (key: string) => { const n = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (n) setState(s => ({ ...s, sharedData: { ...s.sharedData, [n]: s.sharedData[n] ?? '' } })); };
  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 10, paddingLeft: 4 }}>
      <Field label="Event" hint="Fills {{event_name}}, {{event_date}}, {{event_venue}} and {{event_link}} from the event.">
        <select className="ec-input" aria-label="Event" value={state.eventId ?? ''} onChange={e => setState(s => ({ ...s, eventId: e.target.value || null }))}>
          <option value="">— none —</option>{events.map(ev => <option key={ev.id} value={ev.id}>{ev.title} · {ev.date}</option>)}
        </select>
      </Field>
      <div>
        <span className="ec-label">Message variables (same for every recipient)</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.entries(state.sharedData).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <code style={{ minWidth: 150, color: 'var(--color-brand-text)' }}>{`{{${key}}}`}</code>
              <input aria-label={`Value for ${key}`} className="ec-input" style={{ minHeight: 34 }} value={val} onChange={e => setState(s => ({ ...s, sharedData: { ...s.sharedData, [key]: e.target.value } }))} />
              <button type="button" className="ec-tb" aria-label={`Remove ${key}`} onClick={() => setState(s => { const { [key]: _x, ...rest } = s.sharedData; void _x; return { ...s, sharedData: rest }; })}><X size={13} /></button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input className="ec-mini" style={{ width: 170 }} aria-label="New variable name" placeholder="name, e.g. deadline" value={k} onChange={e => setK(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { addShared(k); setK(''); } }} />
          <button type="button" className="ec-btn" style={{ minHeight: 32 }} disabled={!k.trim()} onClick={() => { addShared(k); setK(''); }}>Add</button>
          {builtinShared.filter(n => !(n in state.sharedData)).map(n => <button key={n} type="button" className="ec-btn" style={{ minHeight: 32 }} onClick={() => addShared(n)}>+ {n}</button>)}
        </div>
      </div>
      <div>
        <span className="ec-label">Fallbacks (only used when a recipient has no value)</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.entries(state.fallbacks).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <code style={{ minWidth: 150, color: 'var(--color-brand-text)' }}>{`{{${key}}}`}</code>
              <input aria-label={`Fallback for ${key}`} className="ec-input" style={{ minHeight: 34 }} value={val} onChange={e => setState(s => ({ ...s, fallbacks: { ...s.fallbacks, [key]: e.target.value } }))} />
              <button type="button" className="ec-tb" aria-label={`Remove fallback for ${key}`} onClick={() => setState(s => { const { [key]: _x, ...rest } = s.fallbacks; void _x; return { ...s, fallbacks: rest }; })}><X size={13} /></button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input className="ec-mini" style={{ width: 170 }} aria-label="Variable to give a fallback" placeholder="variable, e.g. first_name" value={fk} onChange={e => setFk(e.target.value)} />
          <button type="button" className="ec-btn" style={{ minHeight: 32 }} disabled={!fk.trim()} onClick={() => { const n = fk.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''); if (n) setState(s => ({ ...s, fallbacks: { ...s.fallbacks, [n]: s.fallbacks[n] ?? '' } })); setFk(''); }}>Add fallback</button>
        </div>
        <p className="ec-hint" style={{ marginTop: 6 }}>Without a fallback, a recipient missing a value is flagged and the send is blocked — nothing is silently left blank. You can also write <code>{'{{first_name|there}}'}</code> inline.</p>
      </div>
      <Field label="Email style">
        <select className="ec-input" aria-label="Email style" value={state.shell} onChange={e => setState(s => ({ ...s, shell: e.target.value as 'dna' | 'plain' }))} style={{ maxWidth: 320 }}>
          <option value="dna">DnA branded (header, footer, website button)</option>
          <option value="plain">Plain (just your content)</option>
        </select>
      </Field>
    </div>
  );
}
