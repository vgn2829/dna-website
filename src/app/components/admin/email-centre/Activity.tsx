import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import {
  emailApi, formatBytes, describeCondition,
  type ActivityDetail, type ActivityRow, type RecipientStatus,
} from '../../../lib/emailCentre';
import { Badge, MessageStatusBadge, RecipientStatusBadge, Spinner, errMsg, timeAgo } from './shared';

const FILTERS = [['', 'All'], ['queued', 'Queued'], ['sending', 'Sending'], ['completed', 'Completed'], ['failed', 'Failed'], ['cancelled', 'Cancelled']] as const;

export function Activity({ openId, notify }: { openId: string | null; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(openId);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try { setRows((await emailApi.activity(status || undefined)).messages); setError(''); }
    catch (e) { setError(errMsg(e)); } finally { setRefreshing(false); }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (openId) setOpen(openId); }, [openId]);

  // Keep in-flight sends fresh without a manual refresh.
  const live = rows?.some(r => r.status === 'queued' || r.status === 'sending') ?? false;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void load(true); }, 5000);
    return () => clearInterval(t);
  }, [live, load]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div role="group" aria-label="Filter by status" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className="ec-btn" aria-pressed={status === id} style={{ minHeight: 32, ...(status === id ? { background: 'var(--color-surface-2)', borderColor: 'var(--color-brand)' } : {}) }} onClick={() => setStatus(id)}>{label}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {live && <span className="ec-hint" role="status">Updating automatically…</span>}
        <button type="button" className="ec-btn" onClick={() => void load()} disabled={refreshing}>{refreshing ? <Spinner /> : <RefreshCw size={14} />} Refresh</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</p>}
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <div className="ec-card" style={{ padding: 28, textAlign: 'center' }}><p style={{ margin: 0 }}>Nothing sent yet.</p><p className="ec-hint">Emails you send from the Email Centre appear here with live delivery status.</p></div>
      ) : (
        <div className="ec-card" style={{ overflow: 'auto' }}>
          <table className="ec-table">
            <thead><tr><th style={{ width: 28 }}><span className="sr-only">Expand</span></th><th>Subject</th><th>Status</th><th className="ec-hide-sm">Mode</th><th className="ec-hide-sm">Sent by</th><th>When</th><th>Recipients</th><th>Delivered</th><th>Failed</th><th>Bounced</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const isOpen = open === r.id;
                return (
                  <FragmentRow key={r.id} row={r} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : r.id)} onChanged={() => void load(true)} notify={notify} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="ec-hint">“Sent (accepted)” means the email provider took the message. “Delivered” only appears once the provider confirms it through a verified delivery event — see the setup notes if nothing ever becomes Delivered.</p>
    </div>
  );
}

function FragmentRow({ row, isOpen, onToggle, onChanged, notify }: { row: ActivityRow; isOpen: boolean; onToggle: () => void; onChanged: () => void; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const c = row.counts;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td><button type="button" className="ec-tb" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} recipients of ${row.subject || 'message'}`} onClick={e => { e.stopPropagation(); onToggle(); }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
        <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.subject || <span className="ec-hint">(no subject)</span>}</td>
        <td><MessageStatusBadge status={row.status} /></td>
        <td className="ec-hide-sm">{row.mode === 'individual' ? 'Individual' : 'Normal'}</td>
        <td className="ec-hide-sm">{row.createdBy}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{timeAgo(row.createdAt)}</td>
        <td>{c.total}</td>
        <td style={{ color: c.delivered ? 'var(--color-success)' : undefined }}>{c.delivered}</td>
        <td style={{ color: c.failed ? 'var(--color-error)' : undefined }}>{c.failed}</td>
        <td style={{ color: c.bounced ? 'var(--color-error)' : undefined }}>{c.bounced}</td>
      </tr>
      {isOpen && <tr><td colSpan={10} style={{ background: 'var(--color-canvas)', padding: 16 }}><Detail id={row.id} onChanged={onChanged} notify={notify} /></td></tr>}
    </>
  );
}

function Detail({ id, onChanged, notify }: { id: string; onChanged: () => void; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [d, setD] = useState<ActivityDetail | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | RecipientStatus>('all');
  const [busy, setBusy] = useState<'retry' | 'cancel' | null>(null);

  const load = useCallback(async () => { try { setD(await emailApi.activityDetail(id)); setError(''); } catch (e) { setError(errMsg(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const open = d && (d.status === 'queued' || d.status === 'sending');
  useEffect(() => { if (!open) return; const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [open, load]);

  const counts = useMemo(() => {
    const m: Partial<Record<RecipientStatus, number>> = {};
    for (const r of d?.recipients ?? []) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [d]);
  if (error) return <p role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>;
  if (!d) return <Spinner />;

  const retryable = d.recipients.filter(r => r.retryable).length;
  const permanent = (counts.bounced ?? 0) + (counts.suppressed ?? 0) + (counts.complained ?? 0);
  const rows = d.recipients.filter(r => filter === 'all' ? true : r.status === filter);

  const act = async (kind: 'retry' | 'cancel') => {
    if (kind === 'cancel' && !window.confirm('Cancel the emails that have not been sent yet? Ones already sent can’t be recalled.')) return;
    setBusy(kind);
    try {
      if (kind === 'retry') { const r = await emailApi.retry(id); notify(`${r.requeued} email${r.requeued === 1 ? '' : 's'} re-queued${r.skipped ? ` · ${r.skipped} permanent bounce${r.skipped === 1 ? '' : 's'} skipped` : ''}`); }
      else { const r = await emailApi.cancel(id); notify(`${r.cancelled} queued email${r.cancelled === 1 ? '' : 's'} cancelled`); }
      await load(); onChanged();
    } catch (e) { notify(errMsg(e), 'warn'); } finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
        <span><span className="ec-hint">From</span> {d.sender}</span>
        <span><span className="ec-hint">By</span> {d.createdBy}</span>
        <span><span className="ec-hint">Mode</span> {d.mode === 'individual' ? 'Individual (separate emails)' : 'Normal (one shared email)'}</span>
        {d.templateId && <span><span className="ec-hint">Template</span> v{d.templateVersion}</span>}
        {d.cc.length > 0 && <span><span className="ec-hint">Cc</span> {d.cc.join(', ')}</span>}
        {d.bcc.length > 0 && <span><span className="ec-hint">Bcc</span> {d.bcc.length} hidden</span>}
        {d.attachments.filter(a => !a.inline).map(a => <span key={a.id}>📎 {a.filename} ({formatBytes(a.sizeBytes)})</span>)}
      </div>
      {(d.subject.variants?.length ?? 0) > 0 && <p className="ec-hint">Subject variations: {d.subject.variants!.map(v => `“${v.subject}” if ${describeCondition(v.when)}`).join('; ')}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div role="group" aria-label="Filter recipients" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="ec-btn" aria-pressed={filter === 'all'} style={{ minHeight: 30, ...(filter === 'all' ? { background: 'var(--color-surface-2)' } : {}) }} onClick={() => setFilter('all')}>All ({d.recipients.length})</button>
          {(Object.keys(counts) as RecipientStatus[]).map(s => (
            <button key={s} type="button" className="ec-btn" aria-pressed={filter === s} style={{ minHeight: 30, ...(filter === s ? { background: 'var(--color-surface-2)' } : {}) }} onClick={() => setFilter(s)}>{s} ({counts[s]})</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {(counts.queued ?? 0) > 0 && <button type="button" className="ec-btn ec-btn-danger" disabled={busy !== null} onClick={() => void act('cancel')}>{busy === 'cancel' ? <Spinner /> : <XCircle size={14} />} Cancel queued</button>}
        <button type="button" className="ec-btn" disabled={retryable === 0 || busy !== null} onClick={() => void act('retry')} title={retryable === 0 ? 'Nothing failed that can be retried' : undefined}>{busy === 'retry' ? <Spinner /> : <RotateCcw size={14} />} Retry {retryable || ''} failed</button>
      </div>
      {permanent > 0 && <p className="ec-hint">{permanent} permanent bounce{permanent === 1 ? '' : 's'}/suppression{permanent === 1 ? '' : 's'} will not be retried. Messages already accepted by the provider are never resent.</p>}

      <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--color-hairline)', borderRadius: 10 }}>
        <table className="ec-table">
          <thead><tr><th>Recipient</th><th>Status</th><th className="ec-hide-sm">Provider message ID</th><th>Attempts</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><div>{r.name || <span className="ec-hint">—</span>}</div><div className="ec-hint" style={{ wordBreak: 'break-all' }}>{r.email}</div></td>
                <td><RecipientStatusBadge status={r.status} /></td>
                <td className="ec-hide-sm"><code style={{ fontSize: 11 }}>{r.providerMessageId ?? '—'}</code></td>
                <td>{r.attempts || '—'}</td>
                <td style={{ maxWidth: 280 }}>{r.error ? <span style={{ color: 'var(--color-error)' }}>{r.error}</span> : r.status === 'excluded' ? <Badge>{r.note ?? 'Excluded'}</Badge> : ''}{r.retryable && <Badge tone="warn"> retryable</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.events.length > 0 && <p className="ec-hint">Provider events: {d.events.slice(0, 8).map(e => `${e.type.replace('email.', '')} (${timeAgo(e.at)})`).join(' · ')}</p>}
    </div>
  );
}
