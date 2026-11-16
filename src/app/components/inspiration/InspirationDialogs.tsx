import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Asset, InspirationCategory, InspirationCollection, InspirationItem } from '../../lib/api';
import { LibraryDialog } from '../assets/LibraryDialog';
import { CATEGORY_OPTIONS, isAcceptableReferenceUrl, parseTagInput } from '../../lib/inspiration';
import { displayUrl } from '../../lib/assetLibrary';

// ─────────────────────────────────────────────────────────────────────────
// Inspiration Library dialogs: save/edit a reference, create/rename a
// collection, confirm a removal. Same LibraryDialog chrome (portalled,
// focus-trapped, viewport-capped) as the Asset Library's own dialogs.
// Each submit is async and closes only via the caller on success, so a
// server error ("Already saved…") stays visible inline.
// ─────────────────────────────────────────────────────────────────────────

const LABEL: React.CSSProperties = { display: 'block', marginBottom: 6 };
const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{message}</p>;
}

export type ReferenceTarget =
  | { type: 'link' }
  | { type: 'asset'; asset: Asset }
  | { type: 'edit'; item: InspirationItem };

export interface ReferenceSubmit {
  url?: string;
  image_url?: string | null;
  title?: string;
  description: string | null;
  category: InspirationCategory | null;
  tags: string[];
  collection_ids: string[];
}

export function ReferenceDialog({ target, collections, onClose, onSubmit }: {
  target: ReferenceTarget;
  collections: InspirationCollection[];
  onClose: () => void;
  onSubmit: (values: ReferenceSubmit) => Promise<void>;
}) {
  const editing = target.type === 'edit' ? target.item : null;
  const [url, setUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [title, setTitle] = useState(editing?.title ?? (target.type === 'asset' ? target.asset.filename : ''));
  const [description, setDescription] = useState(editing?.description ?? '');
  const [category, setCategory] = useState<InspirationCategory | ''>(editing?.category ?? '');
  const [tags, setTags] = useState(editing ? editing.tags.join(', ') : '');
  const [picked, setPicked] = useState<string[]>(editing?.collection_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLink = target.type === 'link';
  // Only complain once something is typed; an empty field just keeps Save disabled.
  const urlOk = !isLink || !url.trim() || isAcceptableReferenceUrl(url);
  const imageOk = !imageUrl.trim() || isAcceptableReferenceUrl(imageUrl, true);
  const canSubmit = !saving && urlOk && imageOk && (!isLink || !!url.trim()) && (isLink || !!title.trim());

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        ...(isLink ? { url: url.trim(), image_url: imageUrl.trim() || null } : {}),
        title: title.trim() || undefined,
        description: description.trim() || null,
        category: category || null,
        tags: parseTagInput(tags),
        collection_ids: picked,
      });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const heading = editing ? 'Edit reference' : isLink ? 'Save a link' : 'Save from Asset Library';
  const subtitle = editing
    ? (editing.kind === 'link' ? displayUrl(editing.url) ?? undefined : 'Library asset — the file itself is not changed')
    : isLink ? 'External pages and images stay where they are — only the link is saved'
    : target.type === 'asset' ? target.asset.filename : undefined;

  return (
    <LibraryDialog
      title={heading}
      subtitle={subtitle}
      maxWidth={520}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={!canSubmit} style={{ minHeight: 40, opacity: canSubmit ? 1 : 0.6 }}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
        </button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isLink && (
          <>
            <div>
              <label htmlFor="insp-url" className="type-caption" style={LABEL}>Link</label>
              <input id="insp-url" className="input-base" type="url" inputMode="url" autoFocus placeholder="https://www.behance.net/gallery/…"
                value={url} onChange={e => setUrl(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} aria-invalid={!urlOk} />
              {!urlOk && <p className="type-micro" role="alert" style={{ margin: '4px 0 0', color: 'var(--color-error)' }}>Use a public http(s) link — not localhost, an IP address or a private network.</p>}
            </div>
            <div>
              <label htmlFor="insp-image" className="type-caption" style={LABEL}>Cover image link (optional)</label>
              <input id="insp-image" className="input-base" type="url" inputMode="url" placeholder="https://…/cover.jpg"
                value={imageUrl} onChange={e => setImageUrl(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} aria-invalid={!imageOk} />
              <p className="type-micro" style={{ margin: '4px 0 0', color: imageOk ? undefined : 'var(--color-error)' }}>
                {imageOk ? 'Shown from its original address — it is not copied or uploaded. Must be https.' : 'The cover image must be a public https link.'}
              </p>
            </div>
          </>
        )}
        <div>
          <label htmlFor="insp-title" className="type-caption" style={LABEL}>Title{isLink ? ' (optional)' : ''}</label>
          <input id="insp-title" className="input-base" type="text" maxLength={120} placeholder={isLink ? 'Defaults to the website name' : 'Title'}
            value={title} onChange={e => setTitle(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} autoFocus={!isLink} />
        </div>
        <div>
          <label htmlFor="insp-desc" className="type-caption" style={LABEL}>Notes (optional)</label>
          <textarea id="insp-desc" className="input-base" rows={3} maxLength={1000} placeholder="What makes this worth keeping?"
            value={description} onChange={e => setDescription(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>
        <div>
          <label htmlFor="insp-cat" className="type-caption" style={LABEL}>Category</label>
          <select id="insp-cat" className="input-base" value={category} onChange={e => setCategory(e.target.value as InspirationCategory | '')} style={{ width: '100%', boxSizing: 'border-box' }}>
            <option value="">No category</option>
            {CATEGORY_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="insp-tags" className="type-caption" style={LABEL}>Tags</label>
          <input id="insp-tags" className="input-base" type="text" placeholder="retro, hand-lettered, poster"
            value={tags} onChange={e => setTags(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
          <p className="type-micro" style={{ margin: '4px 0 0' }}>Separate with commas — up to 10.</p>
        </div>
        {collections.length > 0 && (
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="type-caption" style={LABEL}>Collections</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {collections.map(c => {
                const on = picked.includes(c.id);
                return (
                  <button key={c.id} type="button" aria-pressed={on} className="touch-target"
                    onClick={() => setPicked(p => on ? p.filter(x => x !== c.id) : [...p, c.id])}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                      fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink)',
                      background: on ? 'var(--color-surface-2)' : 'transparent',
                      border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
                    }}>
                    {on && <Check size={13} aria-hidden="true" />}{c.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <FormError message={error} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </LibraryDialog>
  );
}

export function CollectionDialog({ initial, onClose, onSubmit }: {
  initial?: Pick<InspirationCollection, 'name' | 'description'>;
  onClose: () => void;
  onSubmit: (name: string, description: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError(null);
    try { await onSubmit(name.trim(), description.trim() || null); }
    catch (err) { setError(errorText(err)); setSaving(false); }
  };
  return (
    <LibraryDialog
      title={initial ? 'Rename collection' : 'New collection'}
      subtitle="Private to you — only you can see your collections"
      maxWidth={460}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={!name.trim() || saving} style={{ minHeight: 40, opacity: !name.trim() || saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : initial ? 'Save' : 'Create collection'}
        </button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label htmlFor="insp-col-name" className="type-caption" style={LABEL}>Name</label>
        <input id="insp-col-name" className="input-base" autoFocus maxLength={80} placeholder="e.g. Poster layouts"
          value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
        <label htmlFor="insp-col-desc" className="type-caption" style={{ ...LABEL, marginTop: 14 }}>Description (optional)</label>
        <input id="insp-col-desc" className="input-base" maxLength={500} placeholder="What goes in here?"
          value={description} onChange={e => setDescription(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
        <FormError message={error} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </LibraryDialog>
  );
}

export function ConfirmDialog({ title, body, confirmLabel, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(); } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return (
    <LibraryDialog
      title={title}
      role="alertdialog"
      maxWidth={440}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={run} disabled={busy} style={{ minHeight: 40, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </>}
    >
      <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>{body}</p>
      <FormError message={error} />
    </LibraryDialog>
  );
}
