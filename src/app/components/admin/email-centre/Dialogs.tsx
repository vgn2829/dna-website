import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Send } from 'lucide-react';
import {
  EcError, buildPayload, emailApi, formatBytes, overrideRecipient, randomKey, setExcluded,
  type ComposerState, type PreparedItem, type PreviewResult, type SendPreview,
} from '../../../lib/emailCentre';
import { Badge, Field, ItemStateBadge, Modal, Spinner, errMsg } from './shared';

type SetState = (fn: (s: ComposerState) => ComposerState) => void;

/** Sandboxed, script-free rendering of the exact HTML that would be sent. */
export function MailFrame({ html, height = 460 }: { html: string; height?: number }) {
  // The DNA layout is already a complete HTML document; the plain layout is a fragment.
  const doc = /^\s*<!doctype html/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3}</style></head><body>${html}</body></html>`;
  return <iframe title="Email preview" sandbox="" srcDoc={doc} style={{ width: '100%', height, border: '1px solid var(--color-hairline)', borderRadius: 10, background: '#f3f3f3' }} />;
}

// ── Preview & test ──────────────────────────────────────────────────────────
export function PreviewDialog({ open, onClose, state, setState, startWithTest }: { open: boolean; onClose: () => void; state: ComposerState; setState: SetState; startWithTest: boolean }) {
  const [items, setItems] = useState<PreparedItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [testTo, setTestTo] = useState(() => { try { return localStorage.getItem('ec_test_email') ?? ''; } catch { return ''; } });
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const testRef = useRef<HTMLInputElement>(null);

  const payload = useMemo(() => buildPayload(state), [state]);
  const key = JSON.stringify(payload);
  const individual = state.mode === 'individual';
  const sample = individual && items.length === 0;

  // Refresh the recipient list (statuses) and the rendered email whenever the content changes.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true); setError('');
    const t = setTimeout(async () => {
      try {
        const sp = await emailApi.sendPreview(payload, state.draftId);
        if (!live) return;
        setItems(sp.items);
        const i = Math.min(idx, Math.max(sp.items.length - 1, 0));
        if (i !== idx) setIdx(i);
        const r = await emailApi.preview(payload, { index: i, useSample: individual && sp.items.length === 0 });
        if (live) setResult(r);
      } catch (e) { if (live) setError(errMsg(e)); } finally { if (live) setLoading(false); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, key, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open && startWithTest) setTimeout(() => testRef.current?.focus(), 400); }, [open, startWithTest]);

  const current = items[idx];
  const sendTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      try { localStorage.setItem('ec_test_email', testTo.trim()); } catch { /* optional */ }
      const r = await emailApi.test(payload, { testEmail: testTo.trim(), recipientIndex: individual && items.length ? idx : undefined, useSample: sample });
      setTestMsg({ ok: true, text: `Test sent to ${r.sentTo}${r.mock ? ' (dev mode: no real email — RESEND_API_KEY is not set)' : ''}. Only this address received it.` });
    } catch (e) { setTestMsg({ ok: false, text: errMsg(e) }); } finally { setTesting(false); }
  };

  const fix = (patch: { name?: string; data?: Record<string, string> }) => {
    if (!current) return;
    setState(s => overrideRecipientState(s, current, patch));
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Preview & test" description="This is rendered by the same engine that sends the email.">
      <div style={{ display: 'grid', gap: 14 }}>
        {sample && <p role="note" className="ec-hint" style={{ color: 'var(--color-warning)' }}>No recipients yet — previewing with sample data.</p>}
        {individual && items.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button type="button" className="ec-btn" aria-label="Previous recipient" disabled={idx === 0} onClick={() => setIdx(i => i - 1)}><ChevronLeft size={15} /></button>
            <select className="ec-input" style={{ width: 'auto', maxWidth: '100%', flex: '1 1 260px' }} aria-label="Recipient to preview" value={idx} onChange={e => setIdx(Number(e.target.value))}>
              {items.map(it => <option key={it.index} value={it.index}>{it.name || it.email} — {it.email}{it.state !== 'valid' ? ` (${it.state.replace('_', ' ')})` : ''}</option>)}
            </select>
            <button type="button" className="ec-btn" aria-label="Next recipient" disabled={idx >= items.length - 1} onClick={() => setIdx(i => i + 1)}><ChevronRight size={15} /></button>
            <span className="ec-hint">{idx + 1} of {items.length}</span>
            {current && <ItemStateBadge state={current.state} />}
            {loading && <Spinner />}
          </div>
        )}
        {error && <p role="alert" style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</p>}

        {result && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(240px,1fr)', gap: 16 }} className="ec-preview-grid">
            <style>{`@media (max-width: 860px){ .ec-preview-grid{ grid-template-columns: 1fr !important; } }`}</style>
            <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
              <div className="ec-card" style={{ padding: 12 }}>
                <p className="ec-hint">To: <strong>{current ? `${current.name ?? ''} <${current.email}>` : result.forLabel}</strong></p>
                <p style={{ margin: '4px 0 0', fontWeight: 600 }}>{result.subject}</p>
              </div>
              <MailFrame html={result.html} />
              {result.attachments.length > 0 && (
                <div className="ec-hint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {result.attachments.filter(a => !a.inline).map(a => <span key={a.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><FileText size={12} /> {a.filename} ({formatBytes(a.sizeBytes)})</span>)}
                </div>
              )}
            </div>
            <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }} aria-label="Resolved values">
              {result.issues.filter(i => i.severity === 'error').length > 0 && (
                <div role="alert" className="ec-card" style={{ padding: 12, borderColor: 'var(--color-error)' }}>
                  <p className="ec-label" style={{ color: 'var(--color-error)' }}>Needs attention</p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>{[...new Set(result.issues.filter(i => i.severity === 'error').map(i => i.message))].map(m => <li key={m}>{m}</li>)}</ul>
                </div>
              )}
              {result.issues.filter(i => i.severity === 'warning').length > 0 && (
                <div className="ec-card" style={{ padding: 12 }}>
                  <p className="ec-label" style={{ color: 'var(--color-warning)' }}>Warnings</p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>{[...new Set(result.issues.filter(i => i.severity === 'warning').map(i => i.message))].map(m => <li key={m}>{m}</li>)}</ul>
                </div>
              )}
              {result.branches.length > 0 && (
                <div className="ec-card" style={{ padding: 12 }}>
                  <p className="ec-label">Conditional content shown</p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>{result.branches.map(b => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <div className="ec-card" style={{ padding: 12 }}>
                <p className="ec-label">Values used</p>
                {Object.keys(result.resolved).length === 0 ? <p className="ec-hint">No variables in this email.</p> : (
                  <table className="ec-table"><tbody>{Object.entries(result.resolved).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody></table>
                )}
              </div>
              {current && individual && (
                <FixData item={current} onApply={fix} />
              )}
            </aside>
          </div>
        )}

        <div className="ec-card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <Field label="Send a test" htmlFor="ec-test-to" hint="Sends only this one preview to the address below — never to your audience. The subject is prefixed [TEST].">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input id="ec-test-to" ref={testRef} type="email" className="ec-input" style={{ flex: '1 1 260px', width: 'auto' }} placeholder="you@example.com" value={testTo} onChange={e => setTestTo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && testTo.trim() && !testing) void sendTest(); }} />
              <button type="button" className="ec-btn" disabled={testing || !testTo.trim() || (result ? !result.ok : false)} onClick={sendTest}>{testing ? <Spinner /> : <Send size={14} />} Send test to this address</button>
            </div>
          </Field>
          {testMsg && <p role={testMsg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: testMsg.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{testMsg.text}</p>}
          {result && !result.ok && <p className="ec-hint">Fix the issues above to enable test sending.</p>}
        </div>
      </div>
    </Modal>
  );
}

function overrideRecipientState(s: ComposerState, item: PreparedItem, patch: { name?: string; data?: Record<string, string> }): ComposerState {
  return { ...s, recipients: overrideRecipient(s.recipients, item.email, patch, { source: item.source === 'group' ? 'manual' : item.source, matchedStudent: item.matchedStudent, groupRef: item.groupRef }) };
}

/** Correct this recipient's data for this email only, then the preview regenerates. */
function FixData({ item, onApply }: { item: PreparedItem; onApply: (p: { name?: string; data?: Record<string, string> }) => void }) {
  const [name, setName] = useState(item.name ?? '');
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { setName(item.name ?? ''); setVals({}); }, [item.email, item.index]);
  const fields = [...new Set([...item.missing.filter(m => m !== 'first_name' && m !== 'full_name'), ...Object.keys(item.data).filter(k => !['email', 'first_name', 'full_name', 'roll_number', 'batch'].includes(k))])];
  return (
    <div className="ec-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <p className="ec-label">Correct data for {item.email}</p>
      <input aria-label="Name" className="ec-mini" style={{ width: '100%' }} placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      {fields.map(f => (
        <label key={f} style={{ display: 'grid', gap: 2, fontSize: 12 }}><code>{f}</code>
          <input className="ec-mini" style={{ width: '100%', borderColor: item.missing.includes(f) ? 'var(--color-warning)' : undefined }} value={vals[f] ?? String(item.data[f] ?? '')} onChange={e => setVals(v => ({ ...v, [f]: e.target.value }))} />
        </label>
      ))}
      <button type="button" className="ec-btn" style={{ minHeight: 32 }} onClick={() => onApply({ name, data: vals })}>Apply &amp; refresh preview</button>
      <p className="ec-hint">Applies to this email only. Student records are never changed.</p>
    </div>
  );
}

// ── Review & send ───────────────────────────────────────────────────────────
export function ReviewDialog({ open, onClose, state, setState, flush, onSent, onSaveDraft }: {
  open: boolean; onClose: () => void; state: ComposerState; setState: SetState; flush: () => Promise<void>;
  onSent: (messageId: string, messages: number) => void; onSaveDraft: () => void;
}) {
  const [data, setData] = useState<SendPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmCount, setConfirmCount] = useState('');
  const [ack, setAck] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const idemKey = useRef('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'excluded'>('all');

  const payload = useMemo(() => buildPayload(state), [state]);
  const key = JSON.stringify(payload);

  useEffect(() => { if (open) { idemKey.current = randomKey(); setConfirmCount(''); setAck(false); setSendError(''); } }, [open]);
  useEffect(() => {
    if (!open) return;
    let live = true; setLoading(true); setError('');
    const t = setTimeout(() => {
      emailApi.sendPreview(payload, state.draftId).then(r => { if (live) setData(r); }).catch(e => live && setError(errMsg(e))).finally(() => live && setLoading(false));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = data?.counts;
  const needsAck = state.mode === 'individual' && (c?.ccCount ?? 0) + (c?.bccCount ?? 0) > 0;
  const needsCount = Boolean(data?.requiresCountConfirmation);
  const countOk = !needsCount || confirmCount.trim() === String(c?.messages);
  const canSend = Boolean(data) && data!.blockers.length === 0 && (c?.messages ?? 0) > 0 && countOk && (!needsAck || ack) && !sending;

  const send = async () => {
    setSending(true); setSendError('');
    try {
      await flush();
      const r = await emailApi.send(payload, { idempotencyKey: idemKey.current, draftId: state.draftId, confirmedCount: needsCount ? Number(confirmCount) : undefined, acknowledgeCopies: needsAck ? ack : undefined });
      onSent(r.messageId, r.messages);
    } catch (e) {
      setSendError(e instanceof EcError && e.blockers.length ? e.blockers.join(' · ') : errMsg(e));
    } finally { setSending(false); }
  };

  const items = (data?.items ?? []).filter(i => filter === 'all' ? true : filter === 'excluded' ? i.state === 'excluded' : i.state !== 'valid' && i.state !== 'excluded');
  const toggleItem = (it: PreparedItem) => {
    // Optimistic: flip the row now; the server's authoritative preview replaces it a moment later.
    setData(d => (d ? { ...d, items: d.items.map(x => (x.index === it.index ? { ...x, state: it.state === 'excluded' ? 'valid' : 'excluded' } : x)) } : d));
    applyToggle(it);
  };
  const applyToggle = (it: PreparedItem) => setState(s => ({ ...s, recipients: setExcluded(s.recipients, it.email, it.state !== 'excluded', { name: it.name ?? '', source: it.source === 'group' ? 'group' : it.source, matchedStudent: it.matchedStudent, groupRef: it.groupRef }) }));

  return (
    <Modal open={open} onClose={onClose} wide title="Review & send" description="Check everything — once sent, the recipient list and content are frozen in the activity record.">
      {loading && !data && <Spinner />}
      {error && <p role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>}
      {data && c && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <Stat label="Mode" value={data.mode === 'individual' ? 'Individual' : 'Normal'} sub={data.mode === 'individual' ? 'separate email each' : 'one shared email'} />
            <Stat label={data.mode === 'individual' ? 'Emails to generate' : 'Emails to send'} value={String(c.messages)} sub={`${c.valid} recipient${c.valid === 1 ? '' : 's'}`} tone={c.messages ? undefined : 'bad'} />
            <Stat label="Valid" value={String(c.valid)} tone="good" />
            <Stat label="Need attention" value={String(c.invalid + c.missingData + c.renderError)} sub={`${c.invalid} invalid · ${c.missingData} missing data · ${c.renderError} errors`} tone={c.invalid + c.missingData + c.renderError ? 'bad' : undefined} />
            <Stat label="Excluded" value={String(c.excluded)} />
            <Stat label="To / Cc / Bcc" value={`${c.valid} / ${c.ccCount} / ${c.bccCount}`} sub={data.mode === 'individual' && c.extraCopies ? `+${c.extraCopies} extra copies` : undefined} />
            <Stat label="Quota cost" value={String(data.quota.cost)} sub={data.quota.deferred > 0 ? `${data.quota.sendNow} now · ${data.quota.deferred} queued for later` : `${data.quota.budgetNow} left today`} tone={data.quota.deferred > 0 ? 'warn' : undefined} />
          </div>

          {data.quota.deferred > 0 && (
            <p role="note" className="ec-hint" style={{ color: 'var(--color-warning)' }}>
              Today’s sending budget covers {data.quota.sendNow} of these. The rest stay queued and go out automatically as budget frees up (usually the next day) — the Activity tab shows progress.
            </p>
          )}

          {data.blockers.length > 0 && (
            <div role="alert" className="ec-card" style={{ padding: 12, borderColor: 'var(--color-error)' }}>
              <p className="ec-label" style={{ color: 'var(--color-error)' }}>Fix before sending</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{data.blockers.map(b => <li key={b}>{b}</li>)}</ul>
            </div>
          )}

          <div className="ec-card" style={{ padding: 12 }}>
            <p style={{ margin: '0 0 4px', fontSize: 13 }}><span className="ec-hint">From</span> {data.sender}</p>
            <p style={{ margin: 0, fontSize: 13 }}><span className="ec-hint">Subject</span> {state.subject.default}{(state.subject.variants?.length ?? 0) > 0 ? ` (+${state.subject.variants!.length} variation${state.subject.variants!.length === 1 ? '' : 's'})` : ''}</p>
            {data.attachments.filter(a => !a.inline).length > 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap' }}><span className="ec-hint">Attachments</span>
                {data.attachments.filter(a => !a.inline).map(a => <span key={a.id}>{a.filename} ({formatBytes(a.sizeBytes)})</span>)}</p>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }} role="group" aria-label="Filter recipients">
              {([['all', `All (${data.items.length})`], ['attention', 'Need attention'], ['excluded', 'Excluded']] as const).map(([id, label]) => (
                <button key={id} type="button" className="ec-btn" aria-pressed={filter === id} style={{ minHeight: 30, ...(filter === id ? { background: 'var(--color-surface-2)', borderColor: 'var(--color-brand)' } : {}) }} onClick={() => setFilter(id)}>{label}</button>
              ))}
              {loading && <Spinner />}
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--color-hairline)', borderRadius: 10 }}>
              <table className="ec-table">
                <thead><tr><th>Send</th><th>Name</th><th>Email</th><th className="ec-hide-sm">Source</th><th>Status</th></tr></thead>
                <tbody>
                  {items.map(it => (
                    <tr key={`${it.index}-${it.email}`}>
                      <td><input type="checkbox" aria-label={`Send to ${it.email}`} disabled={it.state === 'invalid_email'} checked={it.state !== 'excluded' && it.state !== 'invalid_email'} onChange={() => toggleItem(it)} /></td>
                      <td>{it.name ?? <span className="ec-hint">—</span>}</td>
                      <td style={{ wordBreak: 'break-all' }}>{it.email}</td>
                      <td className="ec-hide-sm"><Badge>{it.groupRef ? it.groupRef.name : it.source}</Badge></td>
                      <td><ItemStateBadge state={it.state} />{it.missing.length > 0 && <span className="ec-hint"> needs {it.missing.join(', ')}</span>}{it.state !== 'valid' && it.note && <span className="ec-hint"> {it.note}</span>}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={5} className="ec-hint" style={{ padding: 14 }}>Nothing here.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {needsAck && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span>I understand each of the {c.valid} emails will also be copied to {c.ccCount + c.bccCount} Cc/Bcc address{c.ccCount + c.bccCount === 1 ? '' : 'es'} ({c.extraCopies} extra deliveries).</span>
            </label>
          )}
          {needsCount && (
            <Field label={`Large send — type ${c.messages} to confirm`} htmlFor="ec-confirm-count" hint={`This will send ${c.messages} separate emails.`}>
              <input id="ec-confirm-count" className="ec-input" style={{ maxWidth: 160 }} inputMode="numeric" value={confirmCount} onChange={e => setConfirmCount(e.target.value)} />
            </Field>
          )}
          {sendError && <p role="alert" style={{ color: 'var(--color-error)', fontSize: 13 }}>{sendError}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="ec-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="ec-btn" onClick={() => { onSaveDraft(); onClose(); }}>Save draft</button>
            <button type="button" className="ec-btn ec-btn-primary" disabled={!canSend} onClick={send}>{sending ? <Spinner /> : <Send size={14} />} {sending ? 'Sending…' : data.mode === 'individual' ? `Send ${c.messages} email${c.messages === 1 ? '' : 's'} now` : 'Send now'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'warn' }) {
  const color = tone === 'good' ? 'var(--color-success)' : tone === 'bad' ? 'var(--color-error)' : tone === 'warn' ? 'var(--color-warning)' : 'var(--color-ink)';
  return (
    <div className="ec-card" style={{ padding: 12 }}>
      <p className="ec-label" style={{ marginBottom: 2 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-display)', color }}>{value}</p>
      {sub && <p className="ec-hint" style={{ margin: 0 }}>{sub}</p>}
    </div>
  );
}
