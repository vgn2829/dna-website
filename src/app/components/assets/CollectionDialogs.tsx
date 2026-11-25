import { useState } from 'react';
import { Layers, Check } from 'lucide-react';
import type { Asset, AssetCollection } from '../../lib/api';
import { LibraryDialog } from './LibraryDialog';

// ─────────────────────────────────────────────────────────────────────────
// Small forms used by AssetBrowser: create/edit a collection, move an
// asset between collections, rename an asset. Each takes an async
// onSubmit and closes itself only via the caller (on success), keeping
// errors visible inline.
// ─────────────────────────────────────────────────────────────────────────

// Layout only — type comes from .type-caption on each label.
const LABEL: React.CSSProperties = { display: 'block', marginBottom: 6 };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{message}</p>;
}

export function CollectionFormDialog({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: Pick<AssetCollection, 'name' | 'description'>;
  onClose: () => void;
  onSubmit: (name: string, description: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name.trim(), description.trim() || null);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <LibraryDialog
      title={initial ? 'Edit collection' : 'New collection'}
      subtitle="Group related assets into a pack — e.g. Branding, Mockups, UI References"
      maxWidth={460}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={!name.trim() || saving} style={{ minHeight: 40, opacity: !name.trim() || saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : initial ? 'Save' : 'Create collection'}
        </button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="type-caption" style={LABEL} htmlFor="collection-name">Name</label>
        <input
          id="collection-name"
          className="input-base"
          value={name}
          maxLength={80}
          onChange={e => setName(e.target.value)}
          placeholder="Branding Pack"
          autoFocus
        />
        <label className="type-caption" style={{ ...LABEL, marginTop: 14 }} htmlFor="collection-description">Description <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
        <textarea
          id="collection-description"
          className="input-base"
          value={description}
          maxLength={500}
          rows={3}
          onChange={e => setDescription(e.target.value)}
          placeholder="Logos, mockups, typography and references for the 2026 campaign"
          style={{ resize: 'vertical', minHeight: 72 }}
        />
        <FormError message={error} />
        <button type="submit" hidden />
      </form>
    </LibraryDialog>
  );
}

export function MoveAssetDialog({
  asset,
  collections,
  onClose,
  onSubmit,
}: {
  asset: Asset;
  collections: AssetCollection[];
  onClose: () => void;
  onSubmit: (collectionId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(asset.collection_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(target);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const options: { id: string | null; name: string; count?: number }[] = [
    { id: null, name: 'No collection' },
    ...collections.map(c => ({ id: c.id, name: c.name, count: c.asset_count })),
  ];

  return (
    <LibraryDialog
      title="Move to collection"
      subtitle={asset.filename}
      maxWidth={440}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={saving || target === asset.collection_id} style={{ minHeight: 40, opacity: saving || target === asset.collection_id ? 0.6 : 1 }}>
          {saving ? 'Moving…' : 'Move'}
        </button>
      </>}
    >
      <div role="radiogroup" aria-label="Collection" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map(opt => {
          const selected = target === opt.id;
          return (
            <button
              key={opt.id ?? 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTarget(opt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
                background: selected ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'none',
                color: 'var(--color-ink)', fontFamily: 'var(--font-body)', fontSize: 14,
              }}
            >
              <Layers size={15} style={{ flexShrink: 0, color: 'var(--color-ink-muted)' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: opt.id ? 'var(--color-ink)' : 'var(--color-ink-muted)' }}>{opt.name}</span>
              {opt.count !== undefined && <span style={{ fontSize: 12, color: 'var(--color-ink-muted)' }}>{opt.count}</span>}
              {selected && <Check size={15} style={{ color: 'var(--color-brand-text)', flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>
      {collections.length === 0 && (
        <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          No collections yet — create one from the collections bar first.
        </p>
      )}
      <FormError message={error} />
    </LibraryDialog>
  );
}

export function RenameAssetDialog({
  asset,
  onClose,
  onSubmit,
}: {
  asset: Asset;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(asset.filename);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = name.trim() === asset.filename;

  const submit = async () => {
    if (!name.trim() || unchanged || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <LibraryDialog
      title="Rename asset"
      maxWidth={440}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={!name.trim() || unchanged || saving} style={{ minHeight: 40, opacity: !name.trim() || unchanged || saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Rename'}
        </button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="type-caption" style={LABEL} htmlFor="asset-name">Name</label>
        <input id="asset-name" className="input-base" value={name} maxLength={255} onChange={e => setName(e.target.value)} autoFocus />
        <FormError message={error} />
        <button type="submit" hidden />
      </form>
    </LibraryDialog>
  );
}
