import { useRef, useState } from 'react';
import { UploadCloud, Check, AlertCircle, Loader2 } from 'lucide-react';
import { api, type Asset } from '../../lib/api';
import { classifyUpload, FILE_MAX_BYTES, formatSize, IMAGE_MAX_BYTES } from '../../lib/assetLibrary';
import { LibraryDialog } from './LibraryDialog';

// ─────────────────────────────────────────────────────────────────────────
// "+ Add Asset". Upload accepts images (the original image path —
// previewable, insertable onto boards) and any other design/document
// resource as a general file; each file is classified client-side by
// classifyUpload() for instant feedback and re-validated by the server.
// Files upload one at a time so each row reports its own result.
// ─────────────────────────────────────────────────────────────────────────

type QueueItem = { key: string; name: string; status: 'waiting' | 'uploading' | 'done' | 'error'; message?: string };

export function AddAssetDialog({
  workspaceId,
  workspaceName,
  onClose,
  onAdded,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onAdded: (asset: Asset) => void;
}) {
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
        const asset = await api.assets.upload(workspaceId, file, plan.kind === 'file' ? { kind: 'file' } : undefined);
        onAdded(asset);
        setItem(key, { status: 'done' });
      } catch (err) {
        setItem(key, { status: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
    setBusy(false);
  };

  return (
    <LibraryDialog
      title="Add asset"
      subtitle={`To ${workspaceName}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy} style={{ minHeight: 40 }}>
          {queue.some(q => q.status === 'done') ? 'Done' : 'Close'}
        </button>
      }
    >
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
    </LibraryDialog>
  );
}
