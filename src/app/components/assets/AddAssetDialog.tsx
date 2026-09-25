import { useRef, useState } from 'react';
import { UploadCloud, Check, AlertCircle, Loader2, Link2 } from 'lucide-react';
import { api, type Asset, type AssetCollection } from '../../lib/api';
import { classifyUpload, FILE_MAX_BYTES, formatSize, IMAGE_MAX_BYTES, isAcceptableLinkUrl, linkSource } from '../../lib/assetLibrary';
import { LibraryDialog } from './LibraryDialog';

// ─────────────────────────────────────────────────────────────────────────
// "+ Add Asset". Upload accepts images (the original image path —
// previewable, insertable onto boards) and any other design/document
// resource as a general file; each file is classified client-side by
// classifyUpload() for instant feedback and re-validated by the server.
// Files upload one at a time so each row reports its own result.
//
// "Add link" stores an external URL (Envato, Figma, Behance, Dribbble,
// Pinterest, Google Drive, anything http/https) as a first-class asset —
// name + URL only; nothing is fetched to build a preview.
//
// Both flows can file the new asset straight into a collection; the
// default is the collection currently being browsed.
// ─────────────────────────────────────────────────────────────────────────

const FIELD_LABEL: React.CSSProperties = {
  display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)',
};

type QueueItem = { key: string; name: string; status: 'waiting' | 'uploading' | 'done' | 'error'; message?: string };

export function AddAssetDialog({
  workspaceId,
  workspaceName,
  roll,
  collections,
  defaultCollectionId,
  onClose,
  onAdded,
}: {
  workspaceId: string;
  workspaceName: string;
  roll: string;
  collections: AssetCollection[];
  defaultCollectionId: string | null;
  onClose: () => void;
  onAdded: (asset: Asset) => void;
}) {
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  const [collectionId, setCollectionId] = useState<string | null>(defaultCollectionId);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setItem = (key: string, patch: Partial<QueueItem>) =>
    setQueue(prev => prev.map(q => (q.key === key ? { ...q, ...patch } : q)));

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const items = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, status: 'waiting' as const }));
    setQueue(prev => [...items, ...prev]);
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const { key } = items[i];
      const plan = classifyUpload(file);
      if (!plan.ok) {
        setItem(key, { status: 'error', message: plan.error });
        continue;
      }
      setItem(key, { status: 'uploading' });
      try {
        const asset = await api.assets.upload(workspaceId, file, { kind: plan.kind === 'file' ? 'file' : undefined, collectionId });
        onAdded(asset);
        setItem(key, { status: 'done' });
      } catch (err) {
        setItem(key, { status: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
    setBusy(false);
  };

  const urlLooksValid = isAcceptableLinkUrl(linkUrl);
  const saveLink = async () => {
    if (!linkName.trim() || savingLink) return;
    if (!urlLooksValid) {
      setLinkError('Enter a full URL starting with https:// or http://');
      return;
    }
    setSavingLink(true);
    setLinkError(null);
    try {
      const asset = await api.assets.createLink(roll, { workspace_id: workspaceId, name: linkName.trim(), url: linkUrl.trim(), collection_id: collectionId });
      onAdded(asset);
      onClose();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to add link');
      setSavingLink(false);
    }
  };

  return (
    <LibraryDialog
      title="Add asset"
      subtitle={`To ${workspaceName}`}
      onClose={onClose}
      footer={mode === 'upload' ? (
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy} style={{ minHeight: 40 }}>
          {queue.some(q => q.status === 'done') ? 'Done' : 'Close'}
        </button>
      ) : (<>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={saveLink}
            disabled={!linkName.trim() || !linkUrl.trim() || savingLink}
            style={{ minHeight: 40, opacity: !linkName.trim() || !linkUrl.trim() || savingLink ? 0.6 : 1 }}
          >
            {savingLink ? 'Adding…' : 'Add link'}
          </button>
      </>)}
    >
      <div role="tablist" aria-label="Add asset type" style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 16, borderRadius: 'var(--radius-pill)', background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)' }}>
        {([['upload', 'Upload file', UploadCloud], ['link', 'Add link', Link2]] as const).map(([id, label, Icon]) => (
          <button className="touch-target"
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            disabled={busy}
            onClick={() => setMode(id)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer',
              background: mode === id ? 'var(--color-surface-2)' : 'transparent',
              color: mode === id ? 'var(--color-ink)' : 'var(--color-ink-muted)',
              fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-body)',
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {collections.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="add-asset-collection" style={FIELD_LABEL}>Collection</label>
          <select
            id="add-asset-collection"
            className="input-base"
            value={collectionId ?? ''}
            onChange={e => setCollectionId(e.target.value || null)}
            style={{ fontSize: 14 }}
          >
            <option value="">No collection</option>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {mode === 'link' ? (
        <form onSubmit={e => { e.preventDefault(); saveLink(); }}>
          <label htmlFor="link-name" style={FIELD_LABEL}>Name</label>
          <input
            id="link-name"
            className="input-base"
            value={linkName}
            maxLength={255}
            onChange={e => setLinkName(e.target.value)}
            placeholder="Envato T-Shirt Mockup"
            autoFocus
          />
          <label htmlFor="link-url" style={{ ...FIELD_LABEL, marginTop: 14 }}>URL</label>
          <input
            id="link-url"
            className="input-base"
            type="url"
            inputMode="url"
            value={linkUrl}
            maxLength={2048}
            onChange={e => { setLinkUrl(e.target.value); setLinkError(null); }}
            placeholder="https://elements.envato.com/…"
          />
          <p style={{ margin: '8px 0 0', fontSize: 12, color: linkError ? 'var(--color-error)' : 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }} role={linkError ? 'alert' : undefined}>
            {linkError ?? (urlLooksValid ? `Links to ${linkSource(linkUrl)}` : 'Figma, Envato, Behance, Dribbble, Pinterest, Google Drive or any web link.')}
          </p>
          <button type="submit" hidden />
        </form>
      ) : (<>
      <input
        ref={inputRef}
        type="file"
        multiple
        aria-label="Choose files to upload"
        onChange={e => { uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); uploadFiles(Array.from(e.dataTransfer.files ?? [])); }}
        style={{
          width: '100%', padding: '28px 16px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
          border: `1.5px dashed ${dragActive ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
          borderRadius: 'var(--radius-lg)',
          background: dragActive ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'var(--color-canvas)',
          color: 'var(--color-ink)', fontFamily: 'var(--font-body)', transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <UploadCloud size={26} strokeWidth={1.6} style={{ color: 'var(--color-ink-muted)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Drop files here or browse</span>
        <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', lineHeight: 1.5, maxWidth: 380 }}>
          Images (PNG, JPG, WEBP, GIF, SVG) up to {formatSize(IMAGE_MAX_BYTES)} — insertable on boards.<br />
          Design files, documents and archives (PSD, AI, FIG, PDF, PPTX, ZIP…) up to {formatSize(FILE_MAX_BYTES)}.
        </span>
      </button>

      {queue.length > 0 && (
        <ul aria-label="Uploads" style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queue.map(item => (
            <li
              key={item.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)',
                fontFamily: 'var(--font-body)', fontSize: 13, minWidth: 0,
              }}
            >
              <span aria-hidden="true" style={{ display: 'flex', flexShrink: 0, color: item.status === 'error' ? 'var(--color-error)' : item.status === 'done' ? 'var(--color-success)' : 'var(--color-ink-muted)' }}>
                {item.status === 'done' ? <Check size={15} /> : item.status === 'error' ? <AlertCircle size={15} /> : <Loader2 size={15} className={item.status === 'uploading' ? 'animate-spin' : undefined} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                {item.status === 'error' && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-error)' }}>{item.message}</span>}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', flexShrink: 0 }}>
                {item.status === 'waiting' ? 'Waiting' : item.status === 'uploading' ? 'Uploading…' : item.status === 'done' ? 'Added' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      </>)}
    </LibraryDialog>
  );
}
