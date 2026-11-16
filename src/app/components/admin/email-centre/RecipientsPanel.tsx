import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, FolderPlus, Search, Trash2, Users, UserPlus, X } from 'lucide-react';
import {
  emailApi, mergeRecipients, normalizeKeyClient,
  type ComposerState, type CsvMapping, type CsvPreview, type CsvRow, type GroupSummary, type Meta, type RecipientRow, type StudentHit,
} from '../../../lib/emailCentre';
import { Badge, Field, Spinner, errMsg } from './shared';

type SetState = (fn: (s: ComposerState) => ComposerState) => void;
type Method = 'paste' | 'students' | 'groups' | 'csv';

const SOURCE_LABEL: Record<RecipientRow['source'], string> = { manual: 'Manual', student: 'Student', group: 'Group', csv: 'CSV' };
const looksLikeEmail = (e: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e.trim());

export function RecipientsPanel({ state, setState, meta, notify }: { state: ComposerState; setState: SetState; meta: Meta | null; notify: (msg: string, tone?: 'ok' | 'warn') => void }) {
  const [method, setMethod] = useState<Method>('paste');
  const methods: { id: Method; label: string; icon: typeof Users }[] = [
    { id: 'paste', label: 'Type or paste', icon: UserPlus }, { id: 'students', label: 'Student directory', icon: Search },
    { id: 'groups', label: 'Groups', icon: Users }, { id: 'csv', label: 'CSV import', icon: FileUp },
  ];
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="ec-card" style={{ padding: 16 }} aria-label="Add recipients">
        <div role="tablist" aria-label="Recipient source" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {methods.map(m => (
            <button key={m.id} role="tab" aria-selected={method === m.id} type="button" className="ec-btn" style={method === m.id ? { background: 'var(--color-surface-2)', borderColor: 'var(--color-brand)' } : undefined} onClick={() => setMethod(m.id)}>
              <m.icon size={14} /> {m.label}
            </button>
          ))}
        </div>
        {method === 'paste' && <PasteAdd setState={setState} notify={notify} />}
        {method === 'students' && <StudentDirectory state={state} setState={setState} meta={meta} notify={notify} />}
        {method === 'groups' && <Groups state={state} setState={setState} notify={notify} />}
        {method === 'csv' && <CsvImport setState={setState} notify={notify} />}
      </section>
      <RecipientTable state={state} setState={setState} />
    </div>
  );
}

// ── Paste / type ────────────────────────────────────────────────────────────
export async function addFromText(text: string, setState: SetState): Promise<{ added: number; skipped: number; invalid: string[] }> {
  const parsed = await emailApi.parseEmails(text);
  let added = 0; let skipped = 0;
  setState(s => {
    const out = mergeRecipients(s.recipients, parsed.entries.map(e => ({
      email: e.email, name: e.name ?? '', source: e.matchedStudent ? 'student' as const : 'manual' as const, matchedStudent: e.matchedStudent, data: {},
    })));
    added = out.added; skipped = out.skipped;
    return { ...s, recipients: out.rows };
  });
  return { added, skipped, invalid: parsed.invalid };
}

function PasteAdd({ setState, notify }: { setState: SetState; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await addFromText(text, setState);
      setInvalid(r.invalid);
      setText(r.invalid.length ? r.invalid.join(' ') : '');
      notify(`${r.added} added${r.skipped ? `, ${r.skipped} already in the list` : ''}${r.invalid.length ? `, ${r.invalid.length} not valid` : ''}`, r.invalid.length ? 'warn' : 'ok');
    } catch (e) { notify(errMsg(e), 'warn'); } finally { setBusy(false); }
  };
  return (
    <Field label="Email addresses" htmlFor="ec-paste" hint="Separate with commas, semicolons, spaces or new lines. “Name <email>” keeps the name. Known students are matched automatically and their stored name filled in.">
      <textarea id="ec-paste" className="ec-input" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="asha@iitk.ac.in, Dev Patel <dev@iitk.ac.in>" aria-invalid={invalid.length > 0 || undefined} />
      {invalid.length > 0 && <p role="alert" className="ec-hint" style={{ color: 'var(--color-error)', marginTop: 4 }}>Not valid addresses (left in the box to fix): {invalid.join(', ')}</p>}
      <div style={{ marginTop: 8 }}><button type="button" className="ec-btn ec-btn-primary" disabled={busy || !text.trim()} onClick={add}>{busy && <Spinner />} Add recipients</button></div>
    </Field>
  );
}

// ── Student directory ───────────────────────────────────────────────────────
function StudentDirectory({ state, setState, meta, notify }: { state: ComposerState; setState: SetState; meta: Meta | null; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [q, setQ] = useState(''); const [batch, setBatch] = useState(''); const [active, setActive] = useState(false);
  const [hits, setHits] = useState<StudentHit[]>([]); const [busy, setBusy] = useState(false); const [picked, setPicked] = useState<Set<string>>(new Set());
  const have = useMemo(() => new Set(state.recipients.map(r => r.email.toLowerCase())), [state.recipients]);

  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      emailApi.searchStudents({ q: q.trim() || undefined, batch: batch || undefined, active }).then(r => { if (live) setHits(r.students); })
        .catch(e => live && notify(errMsg(e), 'warn')).finally(() => live && setBusy(false));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, batch, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (email: string) => setPicked(p => { const n = new Set(p); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  const addPicked = () => {
    const chosen = hits.filter(h => picked.has(h.email));
    setState(s => ({ ...s, recipients: mergeRecipients(s.recipients, chosen.map(h => ({ email: h.email, name: h.name ?? '', source: 'student' as const, matchedStudent: true, data: {} }))).rows }));
    notify(`${chosen.length} student${chosen.length === 1 ? '' : 's'} added`);
    setPicked(new Set());
  };
  const selectable = hits.filter(h => !have.has(h.email.toLowerCase()));

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input className="ec-input" style={{ flex: '1 1 220px', width: 'auto' }} aria-label="Search students by name, email or roll number" placeholder="Search name, email or roll number" value={q} onChange={e => setQ(e.target.value)} />
        <select className="ec-input" style={{ width: 'auto' }} aria-label="Batch" value={batch} onChange={e => setBatch(e.target.value)}>
          <option value="">All batches</option>{(meta?.batches ?? []).filter(b => b !== 'Other').map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active (30 days)</label>
        {busy && <Spinner />}
      </div>
      <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--color-hairline)', borderRadius: 10 }}>
        <table className="ec-table">
          <thead><tr>
            <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={selectable.length > 0 && selectable.every(h => picked.has(h.email))}
              onChange={e => setPicked(e.target.checked ? new Set(selectable.map(h => h.email)) : new Set())} /></th>
            <th>Name</th><th>Email</th><th className="ec-hide-sm">Roll</th><th className="ec-hide-sm">Batch</th></tr></thead>
          <tbody>
            {hits.map(h => {
              const already = have.has(h.email.toLowerCase());
              return (
                <tr key={h.email}>
                  <td><input type="checkbox" aria-label={`Select ${h.name ?? h.email}`} disabled={already} checked={picked.has(h.email) || already} onChange={() => toggle(h.email)} /></td>
                  <td>{h.name ?? <span className="ec-hint">No name</span>}</td><td>{h.email}</td><td className="ec-hide-sm">{h.rollNumber}</td><td className="ec-hide-sm">{h.batch}</td>
                </tr>
              );
            })}
            {!busy && hits.length === 0 && <tr><td colSpan={5} className="ec-hint" style={{ padding: 16 }}>No students match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="ec-btn ec-btn-primary" disabled={picked.size === 0} onClick={addPicked}>Add {picked.size || ''} selected</button></div>
    </div>
  );
}

// ── Groups ──────────────────────────────────────────────────────────────────
function Groups({ state, setState, notify }: { state: ComposerState; setState: SetState; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => emailApi.groups().then(r => setGroups(r.groups)).catch(e => notify(errMsg(e), 'warn'));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = new Set(state.groups.map(g => g.id));
  const toggle = (g: GroupSummary) => setState(s => ({ ...s, groups: s.groups.some(x => x.id === g.id) ? s.groups.filter(x => x.id !== g.id) : [...s.groups, { id: g.id, name: g.name }] }));

  const saveCurrent = async () => {
    const members = state.recipients.filter(r => !r.excluded).map(r => ({ email: r.email, name: r.name || null, data: r.data }));
    if (!name.trim() || members.length === 0) return;
    setBusy(true);
    try { await emailApi.createGroup({ name: name.trim(), kind: 'static', members }); setName(''); notify('Group saved'); await load(); }
    catch (e) { notify(errMsg(e), 'warn'); } finally { setBusy(false); }
  };
  const remove = async (g: GroupSummary) => {
    if (!window.confirm(`Delete the saved group “${g.name}”? Drafts that use it will lose it.`)) return;
    try { await emailApi.deleteGroup(g.id); setState(s => ({ ...s, groups: s.groups.filter(x => x.id !== g.id) })); await load(); } catch (e) { notify(errMsg(e), 'warn'); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="ec-hint">Groups are resolved when you confirm the send, so membership is always current — the final list is then frozen in the send record.</p>
      {!groups ? <Spinner /> : (
        <div role="group" aria-label="Groups" style={{ display: 'grid', gap: 6, maxHeight: 300, overflow: 'auto' }}>
          {groups.map(g => (
            <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--color-hairline)', cursor: 'pointer', background: selected.has(g.id) ? 'var(--color-surface-2)' : 'transparent' }}>
              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{g.name}</strong>
                {g.description && <span className="ec-hint" style={{ display: 'block' }}>{g.description}</span>}
              </span>
              <Badge>{g.kind === 'system' ? 'Live' : g.kind === 'dynamic' ? 'Dynamic' : 'Saved'}</Badge>
              <span className="ec-hint" style={{ minWidth: 56, textAlign: 'right' }}>{g.memberCount == null ? 'live' : `${g.memberCount} people`}</span>
              {g.kind !== 'system' && <button type="button" className="ec-tb" aria-label={`Delete group ${g.name}`} onClick={e => { e.preventDefault(); void remove(g); }}><Trash2 size={13} /></button>}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ flex: '1 1 220px' }}><Field label="Save the recipients below as a group" htmlFor="ec-grp-name">
          <input id="ec-grp-name" className="ec-input" placeholder="e.g. Animation applicants" value={name} onChange={e => setName(e.target.value)} />
        </Field></div>
        <button type="button" className="ec-btn" disabled={busy || !name.trim() || state.recipients.length === 0} onClick={saveCurrent}>{busy ? <Spinner /> : <FolderPlus size={14} />} Save group</button>
      </div>
    </div>
  );
}

// ── CSV import ──────────────────────────────────────────────────────────────
interface CsvRowState extends CsvRow { skip: boolean }

function CsvImport({ setState, notify }: { setState: SetState; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [rows, setRows] = useState<CsvRowState[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (text: string, m?: CsvMapping) => {
    setBusy(true); setError('');
    try {
      const p = await emailApi.importPreview(text, m);
      setPreview(p); setMapping(m ?? p.suggestedMapping);
      setRows(p.rows.map(r => ({ ...r, skip: r.status !== 'ok' })));
    } catch (e) { setError(errMsg(e)); setPreview(null); } finally { setBusy(false); }
  };
  const onFile = async (f: File) => {
    if (f.size > 1_000_000) { setError('That file is over 1 MB. Split it into smaller files.'); return; }
    const text = await f.text();
    setCsv(text); setFileName(f.name); void run(text);
  };

  const remap = (patch: Partial<CsvMapping>) => { if (!mapping) return; const next = { ...mapping, ...patch }; setMapping(next); void run(csv, next); };
  const setField = (column: string, on: boolean, key?: string) => {
    if (!mapping) return;
    const others = (mapping.fields ?? []).filter(f => f.column !== column);
    remap({ fields: on ? [...others, { column, key: key ?? normalizeKeyClient(column) }] : others });
  };
  const editRow = (i: number, patch: Partial<CsvRowState>) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, ...patch };
    if (patch.email !== undefined) {
      const dup = rs.some((o, k) => k !== i && !o.skip && o.email.trim().toLowerCase() === next.email.trim().toLowerCase());
      next.status = !next.email.trim() ? 'missing_email' : !looksLikeEmail(next.email) ? 'invalid_email' : dup ? 'duplicate' : 'ok';
      next.skip = next.status !== 'ok';
    }
    return next;
  }));

  const importable = rows.filter(r => !r.skip && r.status === 'ok');
  const doImport = () => {
    setState(s => {
      const out = mergeRecipients(s.recipients, importable.map(r => ({ email: r.email.trim(), name: r.name.trim(), source: 'csv' as const, data: r.data })));
      notify(`${out.added} imported${out.skipped ? `, ${out.skipped} already in the list` : ''}. CSV values apply to this email only — student records are not changed.`);
      return { ...s, recipients: out.rows };
    });
    setPreview(null); setRows([]); setCsv(''); setFileName('');
  };

  if (!preview) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <p className="ec-hint">Upload a CSV with a header row (e.g. <code>name,email,team,result,role</code>). You will map the columns and review every row before anything is added.</p>
        <div><button type="button" className="ec-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Spinner /> : <FileUp size={14} />} Choose CSV file…</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} /></div>
        {error && <p role="alert" className="ec-hint" style={{ color: 'var(--color-error)' }}>{error}</p>}
      </div>
    );
  }
  const used = new Set((mapping?.fields ?? []).map(f => f.column));
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>{fileName}</strong><span className="ec-hint">{preview.rowCount} rows</span>
        <button type="button" className="ec-btn" style={{ minHeight: 30, padding: '2px 10px' }} onClick={() => { setPreview(null); setRows([]); }}><X size={12} /> Choose another file</button>
        {busy && <Spinner />}
      </div>
      <fieldset style={{ border: '1px solid var(--color-hairline)', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
        <legend className="ec-label" style={{ padding: '0 6px' }}>Map columns</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Field label="Email column" htmlFor="ec-map-email"><select id="ec-map-email" className="ec-input" value={mapping?.email ?? ''} onChange={e => remap({ email: e.target.value })}>
            <option value="">— choose —</option>{preview.headers.map(h => <option key={h} value={h}>{h}</option>)}</select></Field>
          <Field label="Name column" htmlFor="ec-map-name"><select id="ec-map-name" className="ec-input" value={mapping?.name ?? ''} onChange={e => remap({ name: e.target.value || null })}>
            <option value="">— none —</option>{preview.headers.map(h => <option key={h} value={h}>{h}</option>)}</select></Field>
        </div>
        <div>
          <p className="ec-label">Other columns → custom variables</p>
          <div style={{ display: 'grid', gap: 6 }}>
            {preview.headers.filter(h => h !== mapping?.email && h !== mapping?.name).map(h => {
              const f = (mapping?.fields ?? []).find(x => x.column === h);
              return (
                <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, minWidth: 140 }}><input type="checkbox" checked={used.has(h)} onChange={e => setField(h, e.target.checked)} /> {h}</label>
                  {f && <><span className="ec-hint">→</span><code style={{ color: 'var(--color-brand-text)' }}>{`{{${normalizeKeyClient(f.key)}}}`}</code>
                    <input aria-label={`Variable name for column ${h}`} className="ec-mini" style={{ width: 150 }} defaultValue={f.key} onBlur={e => { if (e.target.value !== f.key) setField(h, true, e.target.value); }} /></>}
                </div>
              );
            })}
          </div>
        </div>
      </fieldset>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="good">{importable.length} ready</Badge>
        {preview.summary.invalid > 0 && <Badge tone="bad">{preview.summary.invalid} invalid</Badge>}
        {preview.summary.duplicates > 0 && <Badge tone="warn">{preview.summary.duplicates} duplicates</Badge>}
        {preview.summary.withMissingValues > 0 && <Badge tone="warn">{preview.summary.withMissingValues} with empty values</Badge>}
      </div>
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--color-hairline)', borderRadius: 10 }}>
        <table className="ec-table">
          <thead><tr><th>Use</th><th>#</th><th>Name</th><th>Email</th>{(mapping?.fields ?? []).map(f => <th key={f.column}>{normalizeKeyClient(f.key)}</th>)}<th>Status</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.rowNumber} style={{ opacity: r.skip ? 0.55 : 1 }}>
                <td><input type="checkbox" aria-label={`Import row ${r.rowNumber}`} disabled={r.status !== 'ok'} checked={!r.skip && r.status === 'ok'} onChange={e => editRow(i, { skip: !e.target.checked })} /></td>
                <td className="ec-hint">{r.rowNumber}</td>
                <td><input aria-label={`Name, row ${r.rowNumber}`} className="ec-mini" style={{ width: 130 }} value={r.name} onChange={e => editRow(i, { name: e.target.value })} /></td>
                <td><input aria-label={`Email, row ${r.rowNumber}`} aria-invalid={r.status !== 'ok' || undefined} className="ec-mini" style={{ width: 190, borderColor: r.status !== 'ok' ? 'var(--color-error)' : undefined }} value={r.email} onChange={e => editRow(i, { email: e.target.value })} /></td>
                {(mapping?.fields ?? []).map(f => {
                  const k = normalizeKeyClient(f.key);
                  return <td key={f.column}><input aria-label={`${k}, row ${r.rowNumber}`} className="ec-mini" style={{ width: 110, borderColor: r.data[k] === '' ? 'var(--color-warning)' : undefined }} value={r.data[k] ?? ''}
                    onChange={e => editRow(i, { data: { ...r.data, [k]: e.target.value } })} /></td>;
                })}
                <td>{r.status === 'ok' ? <Badge tone={r.warnings.length ? 'warn' : 'good'}>{r.warnings.length ? 'Check values' : 'OK'}</Badge>
                  : <Badge tone={r.status === 'duplicate' ? 'warn' : 'bad'}>{r.status === 'duplicate' ? 'Duplicate' : r.status === 'missing_email' ? 'No email' : 'Invalid email'}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="ec-btn ec-btn-primary" disabled={importable.length === 0} onClick={doImport}>Import {importable.length} recipient{importable.length === 1 ? '' : 's'}</button></div>
    </div>
  );
}

// ── The working list ────────────────────────────────────────────────────────
export function RecipientTable({ state, setState }: { state: ComposerState; setState: SetState }) {
  const [extra, setExtra] = useState<string[]>([]);
  const [newCol, setNewCol] = useState('');
  const cols = useMemo(() => {
    const set = new Set<string>(extra);
    for (const r of state.recipients) for (const k of Object.keys(r.data)) set.add(k);
    return [...set];
  }, [state.recipients, extra]);
  const patch = (key: string, p: Partial<RecipientRow>) => setState(s => ({ ...s, recipients: s.recipients.map(r => (r.key === key ? { ...r, ...p } : r)) }));
  const included = state.recipients.filter(r => !r.excluded).length;

  return (
    <section className="ec-card" style={{ padding: 16 }} aria-label="Recipient list">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-display)' }}>Recipients <span className="ec-hint">({included} included{state.recipients.length > included ? `, ${state.recipients.length - included} excluded` : ''})</span></h3>
        <span style={{ flex: 1 }} />
        <input className="ec-mini" style={{ width: 140 }} aria-label="New custom field name" placeholder="New field…" value={newCol} onChange={e => setNewCol(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newCol.trim()) { setExtra(x => [...x, normalizeKeyClient(newCol)]); setNewCol(''); } }} />
        <button type="button" className="ec-btn" style={{ minHeight: 32 }} disabled={!newCol.trim()} onClick={() => { setExtra(x => [...x, normalizeKeyClient(newCol)]); setNewCol(''); }}>Add field</button>
        {state.recipients.length > 0 && <button type="button" className="ec-btn ec-btn-danger" style={{ minHeight: 32 }} onClick={() => { if (window.confirm('Remove all recipients from this email?')) setState(s => ({ ...s, recipients: [] })); }}>Clear</button>}
      </div>

      {state.groups.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }} aria-label="Selected groups">
          {state.groups.map(g => (
            <span key={g.id} className="ec-chip"><Users size={12} aria-hidden /> {g.name}
              <button type="button" aria-label={`Remove group ${g.name}`} onClick={() => setState(s => ({ ...s, groups: s.groups.filter(x => x.id !== g.id) }))}><X size={12} /></button></span>
          ))}
          <span className="ec-hint" style={{ alignSelf: 'center' }}>Group members are listed when you review the send.</span>
        </div>
      )}

      {state.recipients.length === 0 ? <p className="ec-hint">No individual recipients yet. Add some above{state.groups.length ? ', or send to the selected groups' : ''}.</p> : (
        <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--color-hairline)', borderRadius: 10 }}>
          <table className="ec-table">
            <thead><tr><th>Send</th><th>Name</th><th>Email</th><th>Source</th>{cols.map(c => <th key={c}>{c}</th>)}<th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {state.recipients.map(r => (
                <tr key={r.key} style={{ opacity: r.excluded ? 0.5 : 1 }}>
                  <td><input type="checkbox" aria-label={`Include ${r.email}`} checked={!r.excluded} onChange={e => patch(r.key, { excluded: !e.target.checked })} /></td>
                  <td>
                    <input aria-label={`Name for ${r.email}`} className="ec-mini" style={{ width: 150, borderColor: !r.name.trim() ? 'var(--color-warning)' : undefined }} placeholder="Name" value={r.name} onChange={e => patch(r.key, { name: e.target.value })} />
                  </td>
                  <td style={{ wordBreak: 'break-all' }}>{r.email}</td>
                  <td><Badge tone={r.matchedStudent ? 'info' : 'neutral'} title={r.matchedStudent ? 'Matched to a registered student — roll number, batch and stored name are filled in' : undefined}>{SOURCE_LABEL[r.source]}{r.matchedStudent && r.source !== 'student' ? ' · student' : ''}</Badge></td>
                  {cols.map(c => <td key={c}><input aria-label={`${c} for ${r.email}`} className="ec-mini" style={{ width: 110 }} value={r.data[c] ?? ''} onChange={e => patch(r.key, { data: { ...r.data, [c]: e.target.value } })} /></td>)}
                  <td><button type="button" className="ec-tb" aria-label={`Remove ${r.email}`} onClick={() => setState(s => ({ ...s, recipients: s.recipients.filter(x => x.key !== r.key) }))}><X size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ec-hint" style={{ marginTop: 8 }}>Names and fields you edit here apply to <strong>this email only</strong> — registered student records are never changed. A name left empty is never guessed from the address.</p>
    </section>
  );
}
