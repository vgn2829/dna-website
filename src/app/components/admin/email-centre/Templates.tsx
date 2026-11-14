import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Copy, Eye, FilePlus2, Pencil, Save, Send } from 'lucide-react';
import {
  applyTemplate, availableVariables, emailApi, knownVariables, newComposer,
  type ComposerState, type Meta, type TemplateBody, type TemplateDetail, type TemplateSummary,
} from '../../../lib/emailCentre';
import { conditionContext } from './Compose';
import { PreviewDialog } from './Dialogs';
import { RichEditor } from './RichEditor';
import { Badge, Field, Spinner, errMsg, timeAgo } from './shared';

const CATEGORY_LABEL: Record<string, string> = {
  welcome: 'Welcome', announcement: 'Announcement', event: 'Event', results: 'Results', selection: 'Selection · Official', custom: 'Custom',
};

/** Live thumbnail: the template rendered by the server's real pipeline with sample data, scaled to fit. */
function TemplateThumb({ id, version, name }: { id: string; version: number; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    let live = true; setHtml(null); setFailed(false);
    emailApi.templatePreview(id).then(r => { if (live) setHtml(r.html); }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [id, version]);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 620));
    ro.observe(el); setScale(el.clientWidth / 620);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} aria-label={`Preview of ${name}`} style={{ height: 230, overflow: 'hidden', borderRadius: 10, border: '1px solid var(--color-hairline)', background: '#222', position: 'relative' }}>
      {html ? (
        <iframe title={`${name} preview`} sandbox="" srcDoc={html} tabIndex={-1} aria-hidden
          style={{ width: 620, height: 1100, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }} />
      ) : <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>{failed ? <span className="ec-hint">Preview unavailable</span> : <Spinner />}</div>}
    </div>
  );
}

export function Templates({ meta, onUse, notify }: { meta: Meta | null; onUse: (t: TemplateDetail) => void; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<TemplateDetail | 'new' | null>(null);
  const [preview, setPreview] = useState<{ t: TemplateDetail; test: boolean } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => { try { setList((await emailApi.templates(archived)).templates); } catch (e) { notify(errMsg(e), 'warn'); } }, [archived, notify]);
  useEffect(() => { void load(); }, [load]);

  const withDetail = async (id: string, fn: (t: TemplateDetail) => void) => {
    setBusy(id);
    try { fn(await emailApi.template(id)); } catch (e) { notify(errMsg(e), 'warn'); } finally { setBusy(''); }
  };

  if (editing) {
    return <TemplateEditor meta={meta} initial={editing === 'new' ? null : editing} notify={notify}
      onBack={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" className="ec-btn ec-btn-primary" onClick={() => setEditing('new')}><FilePlus2 size={14} /> New template</button>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived</label>
        <span className="ec-hint" style={{ flex: 1, minWidth: 220 }}>Editing a template saves a new version. Emails already sent keep the exact content they were sent with.</span>
      </div>
      {!list ? <Spinner /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {list.map(t => (
            <article key={t.id} className="ec-card" style={{ padding: 14, display: 'grid', gap: 8, opacity: t.archived ? 0.65 : 1 }} aria-label={t.name}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'start', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-display)' }}>{t.name}</h3>
                <span style={{ display: 'flex', gap: 4 }}>{t.isSystem && <Badge>Built-in</Badge>}{t.archived && <Badge tone="warn">Archived</Badge>}<Badge tone="info">v{t.version}</Badge></span>
              </div>
              <TemplateThumb id={t.id} version={t.version} name={t.name} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Badge tone="neutral">{CATEGORY_LABEL[t.category] ?? t.category}</Badge>
                <Badge tone={t.mode === 'individual' ? 'good' : 'neutral'} title={t.mode === 'individual' ? 'Each recipient gets their own email with their name and data' : 'One shared email for everyone'}>{t.mode === 'individual' ? 'Personalized' : 'Shared'}</Badge>
              </div>
              <p className="ec-hint" style={{ margin: 0 }}>{t.description ?? ''}</p>
              <p className="ec-hint" style={{ margin: 0 }}>Subject: <em>{t.subject || '—'}</em> · updated {timeAgo(t.updatedAt)}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {!t.archived && <button type="button" className="ec-btn ec-btn-primary" style={{ minHeight: 34 }} disabled={busy === t.id} onClick={() => void withDetail(t.id, onUse)}>Use in composer</button>}
                <button type="button" className="ec-btn" style={{ minHeight: 34 }} onClick={() => void withDetail(t.id, d => setEditing(d))}><Pencil size={13} /> Edit</button>
                <button type="button" className="ec-btn" style={{ minHeight: 34 }} onClick={() => void withDetail(t.id, d => setPreview({ t: d, test: false }))}><Eye size={13} /> Preview</button>
                <button type="button" className="ec-btn" style={{ minHeight: 34 }} onClick={() => void withDetail(t.id, d => setPreview({ t: d, test: true }))}><Send size={13} /> Test</button>
                <button type="button" className="ec-btn" style={{ minHeight: 34 }} aria-label={`Duplicate ${t.name}`} onClick={async () => { try { await emailApi.duplicateTemplate(t.id); notify('Template duplicated'); await load(); } catch (e) { notify(errMsg(e), 'warn'); } }}><Copy size={13} /> Duplicate</button>
                <button type="button" className="ec-btn" style={{ minHeight: 34 }} aria-label={`${t.archived ? 'Restore' : 'Archive'} ${t.name}`} onClick={async () => { try { await emailApi.archiveTemplate(t.id, !t.archived); await load(); } catch (e) { notify(errMsg(e), 'warn'); } }}>
                  {t.archived ? <><ArchiveRestore size={13} /> Restore</> : <><Archive size={13} /> Archive</>}</button>
              </div>
            </article>
          ))}
          {list.length === 0 && <p className="ec-hint">No templates.</p>}
        </div>
      )}
      {preview && <TemplatePreview detail={preview.t} test={preview.test} onClose={() => setPreview(null)} />}
    </div>
  );
}

function stateFromTemplate(t: TemplateDetail | null): ComposerState {
  const base = newComposer();
  if (!t) return { ...base, subject: { default: '' } };
  return applyTemplate(base, t);
}

function TemplatePreview({ detail, test, onClose }: { detail: TemplateDetail; test: boolean; onClose: () => void }) {
  // Edits made in the preview's "fix data" panel are irrelevant here (no recipients); state is read-only.
  const [state, setState] = useState<ComposerState>(() => {
    const s = stateFromTemplate(detail);
    // Message-level variables a template expects get a visible sample so the preview isn't all red.
    const filled = Object.fromEntries(Object.keys(s.sharedData).map(k => [k, s.sharedData[k] || `Sample ${k.replace(/_/g, ' ')}`]));
    return { ...s, sharedData: filled };
  });
  return <PreviewDialog open onClose={onClose} state={state} setState={fn => setState(fn)} startWithTest={test} />;
}

function TemplateEditor({ meta, initial, onBack, onSaved, notify }: { meta: Meta | null; initial: TemplateDetail | null; onBack: () => void; onSaved: () => void; notify: (m: string, t?: 'ok' | 'warn') => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [state, setState] = useState<ComposerState>(() => stateFromTemplate(initial));
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sharedKey, setSharedKey] = useState('');
  const [version, setVersion] = useState(initial?.version);

  const variables = useMemo(() => availableVariables(meta, state), [meta, state]);
  const known = useMemo(() => knownVariables(meta, state), [meta, state]);
  const cond = useMemo(() => conditionContext(meta, state), [meta, state]);
  const set = (fn: (s: ComposerState) => ComposerState) => setState(fn);

  const body: TemplateBody = { mode: state.mode, subject: state.subject, doc: state.doc, settings: { sharedData: state.sharedData, fallbacks: state.fallbacks, shell: state.shell } };
  const save = async () => {
    if (!name.trim()) { notify('Give the template a name', 'warn'); return; }
    setSaving(true);
    try {
      if (initial) { const r = await emailApi.saveTemplate(initial.id, name.trim(), description.trim() || null, body); notify(`Saved as version ${r.version}`); }
      else { await emailApi.createTemplate(name.trim(), description.trim() || null, body); notify('Template created'); }
      onSaved();
    } catch (e) { notify(errMsg(e), 'warn'); } finally { setSaving(false); }
  };
  const loadVersion = async (v: number) => {
    if (!initial) return;
    try { const d = await emailApi.template(initial.id, v); setState(stateFromTemplate(d)); setVersion(v); notify(`Loaded version ${v} — saving creates a new version from it`); } catch (e) { notify(errMsg(e), 'warn'); }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" className="ec-btn" onClick={onBack}><ArrowLeft size={14} /> Templates</button>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16 }}>{initial ? `Edit “${initial.name}”` : 'New template'}</h3>
        {initial && <Badge tone="info">editing from v{version}</Badge>}
        <span style={{ flex: 1 }} />
        <button type="button" className="ec-btn" onClick={() => setPreview(true)}><Eye size={14} /> Preview &amp; test</button>
        <button type="button" className="ec-btn ec-btn-primary" disabled={saving} onClick={save}>{saving ? <Spinner /> : <Save size={14} />} {initial ? 'Save new version' : 'Create template'}</button>
      </div>
      <div className="ec-card" style={{ padding: 16, display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
          <Field label="Template name" htmlFor="ec-tpl-name"><input id="ec-tpl-name" className="ec-input" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Description" htmlFor="ec-tpl-desc"><input id="ec-tpl-desc" className="ec-input" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label="Sending mode"><select className="ec-input" aria-label="Sending mode" value={state.mode} onChange={e => set(s => ({ ...s, mode: e.target.value as 'normal' | 'individual' }))}>
            <option value="individual">Individual (personalized)</option><option value="normal">Normal (shared)</option></select></Field>
          <Field label="Email style"><select className="ec-input" aria-label="Email style" value={state.shell} onChange={e => set(s => ({ ...s, shell: e.target.value as 'dna' | 'plain' }))}>
            <option value="dna">DnA branded</option><option value="plain">Plain</option></select></Field>
        </div>
        <Field label="Subject" htmlFor="ec-tpl-subject" hint="Use {{variables}}; add subject variations in the composer after choosing the template.">
          <input id="ec-tpl-subject" className="ec-input" value={state.subject.default} onChange={e => set(s => ({ ...s, subject: { ...s.subject, default: e.target.value } }))} maxLength={300} />
        </Field>
        <div>
          <span className="ec-label">Message</span>
          <RichEditor key={`${initial?.id ?? 'new'}-${version ?? 0}`} value={state.doc} onChange={doc => set(s => ({ ...s, doc }))} variables={variables} env={{ cond, known }} ariaLabel="Template body" />
        </div>
        <div>
          <span className="ec-label">Message variables this template expects</span>
          <p className="ec-hint" style={{ marginBottom: 6 }}>Variables like <code>{'{{artwork_title}}'}</code> that you fill in each time you use the template.</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {Object.keys(state.sharedData).map(k => (
              <span key={k} className="ec-chip"><code>{`{{${k}}}`}</code><button type="button" aria-label={`Remove ${k}`} onClick={() => set(s => { const { [k]: _x, ...rest } = s.sharedData; void _x; return { ...s, sharedData: rest }; })}>×</button></span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="ec-mini" aria-label="New expected variable" placeholder="e.g. deadline" value={sharedKey} onChange={e => setSharedKey(e.target.value)} />
            <button type="button" className="ec-btn" style={{ minHeight: 32 }} disabled={!sharedKey.trim()} onClick={() => { const n = sharedKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (n) set(s => ({ ...s, sharedData: { ...s.sharedData, [n]: '' } })); setSharedKey(''); }}>Add</button>
          </div>
        </div>
        {initial && initial.versions.length > 1 && (
          <div>
            <span className="ec-label">Version history</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {initial.versions.map(v => <button key={v.version} type="button" className="ec-btn" style={{ minHeight: 30 }} aria-pressed={version === v.version} onClick={() => void loadVersion(v.version)}>v{v.version} · {timeAgo(v.createdAt)}{v.version === initial.currentVersion ? ' (current)' : ''}</button>)}
            </div>
          </div>
        )}
      </div>
      {preview && (
        <PreviewDialog open onClose={() => setPreview(false)} startWithTest={false} state={{ ...state, sharedData: Object.fromEntries(Object.entries(state.sharedData).map(([k, v]) => [k, v || `Sample ${k.replace(/_/g, ' ')}`])) }} setState={() => undefined} />
      )}
    </div>
  );
}
