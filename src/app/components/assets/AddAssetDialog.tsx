import { useEffect, useReducer, useRef, useState } from 'react';
import { UploadCloud, Check, AlertCircle, Loader2, Link2, RotateCcw, X } from 'lucide-react';
import { api, UploadError, type Asset, type AssetCollection, type LibraryVisibility } from '../../lib/api';
import { formatSize, isAcceptableLinkUrl, linkSource, newClientUploadId, planUploadBatch } from '../../lib/assetLibrary';
import { MAX_UPLOAD_LABEL } from '../../lib/uploadLimits';
import { LibraryDialog } from './LibraryDialog';
import { VisibilityPicker } from '../library/LibraryVisibility';

// ─────────────────────────────────────────────────────────────────────────
// "+ Add Asset". Upload accepts images (the original image path —
// previewable, insertable onto boards) and any other design/document
// resource as a general file; each file is classified client-side by
// planUploadBatch() for instant feedback and re-validated by the server.
//
// Upload queue: a file refused up front (too large, no extension) never
// enters the queue — it is listed separately with the reason. Queued files
// upload one at a time, each with its own state (Waiting → Uploading n% →
// Added, or Failed with the actual reason), so one failure never blocks the
// rest. A failure that retrying can fix (connection lost, server briefly
// unavailable) offers Retry; the retry reuses the file's client_upload_id,
// so if the first attempt had in fact been stored the server returns that
// asset instead of storing the file twice. When the server rate-limits
// uploads (429 with Retry-After), the queue pauses for exactly that long and
// resumes by itself instead of failing the rest of the batch.
//
// "Add link" stores an external URL (Envato, Figma, Behance, Dribbble,
// Pinterest, Google Drive, anything http/https) as a first-class asset —
// name + URL only; nothing is fetched to build a preview.
//
// Both flows can file the new asset straight into a collection; the
// default is the collection currently being browsed. Both also choose a
// visibility — Personal by default; Community shares it with every signed-in
// DnA member (the file itself is stored once either way).
// ─────────────────────────────────────────────────────────────────────────

// Layout only — type comes from .type-caption on each label.
const FIELD_LABEL: React.CSSProperties = { display: 'block', marginBottom: 6 };

type QueueItem = {
  key: string;
  // Upload order: files go up in the order they were picked.
  seq: number;
  file: File;
  kind: 'image' | 'file';
  // Captured when the file is added, so a later change to the pickers (or a
  // retry) never re-files an already-queued upload.
  visibility: LibraryVisibility;
  collectionId: string | null;
  clientUploadId: string;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  progress: number;
  message?: string;
  retryable?: boolean;
};
type Rejected = { key: string; name: string; reason: string };

export function AddAssetDialog({
  workspaceId,
  workspaceName,
  roll,
  collections,
  defaultCollectionId,
  isPersonalWorkspace = false,
  onClose,
  onAdded,
}: {
  workspaceId: string;
  workspaceName: string;
  roll: string;
  collections: AssetCollection[];
  defaultCollectionId: string | null;
  isPersonalWorkspace?: boolean;
  onClose: () => void;
  onAdded: (asset: Asset) => void;
}) {
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  const [collectionId, setCollectionId] = useState<string | null>(defaultCollectionId);
  const [visibility, setVisibility] = useState<LibraryVisibility>('personal');
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The queue lives in a ref (the upload loop reads the latest state between
  // awaits); `render` repaints after each change.
  const queueRef = useRef<QueueItem[]>([]);
  const runningRef = useRef(false);
  const seqRef = useRef(0);
  // Closing the dialog ends the loop (and any rate-limit pause).
  const cancelledRef = useRef<(() => void) | null>(null);
  const closedRef = useRef(false);
  useEffect(() => () => { closedRef.current = true; cancelledRef.current?.(); }, []);
  const pause = (ms: number) => new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    cancelledRef.current = () => { clearTimeout(t); resolve(); };
  });
  const [, render] = useReducer((n: number) => n + 1, 0);
  const queue = queueRef.current;

  const setItem = (key: string, patch: Partial<QueueItem>) => {
    queueRef.current = queueRef.current.map(q => (q.key === key ? { ...q, ...patch } : q));
    render();
  };

  // Uploads every waiting item, oldest first, one at a time. Re-entrant
  // calls (new files or a retry while running) just extend the same loop.
  const pump = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      for (;;) {
        if (closedRef.current) break;
        const next = queueRef.current
          .filter(q => q.status === 'waiting')
          .reduce<QueueItem | null>((a, q) => (a === null || q.seq < a.seq ? q : a), null);
        if (!next) break;
        setItem(next.key, { status: 'uploading', progress: 0, message: undefined, retryable: undefined });
        try {
          const asset = await api.assets.upload(workspaceId, next.file, {
            kind: next.kind === 'file' ? 'file' : undefined,
            collectionId: next.collectionId,
            visibility: next.visibility,
            clientUploadId: next.clientUploadId,
            onProgress: fraction => setItem(next.key, { progress: fraction }),
          });
          onAdded(asset);
          setItem(next.key, { status: 'done', progress: 1 });
        } catch (err) {
          const failure = err instanceof UploadError
            ? err.failure
            : { message: err instanceof Error ? err.message : 'Upload failed', retryable: true };
          if (failure.retryAfterSeconds) {
            // Rate-limited: the server said how long to wait. Pause the whole
            // queue that long, then carry on with this file first.
            setItem(next.key, { status: 'waiting', progress: 0, message: failure.message });
            setBusy(false);
            await pause(failure.retryAfterSeconds * 1000);
            setBusy(true);
            continue;
          }
          setItem(next.key, { status: 'error', message: failure.message, retryable: failure.retryable });
        }
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  const uploadFiles = (files: File[]) => {
    if (files.length === 0) return;
    const { accepted, rejected: refused } = planUploadBatch(files);
    const stamp = Date.now();
    if (refused.length > 0) {
      setRejected(prev => [...refused.map((r, i) => ({ key: `${stamp}-r${i}`, ...r })), ...prev]);
    }
    if (accepted.length === 0) return;
    const items: QueueItem[] = accepted.map(({ file, kind }, i) => ({
      key: `${stamp}-${i}-${file.name}`, seq: seqRef.current++, file, kind, visibility, collectionId,
      clientUploadId: newClientUploadId(), status: 'waiting', progress: 0,
    }));
    // Newest batch on top, in the order it was picked.
    queueRef.current = [...items, ...queueRef.current];
    render();
    void pump();
  };

  const retry = (key: string) => {
    setItem(key, { status: 'waiting', progress: 0, message: undefined, retryable: undefined });
    void pump();
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
      const asset = await api.assets.createLink(roll, { workspace_id: workspaceId, name: linkName.trim(), url: linkUrl.trim(), collection_id: collectionId, visibility });
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
      <div role="tablist" aria-label="Add asset type" className="segmented is-block" style={{ marginBottom: 16 }}>
        {([['upload', 'Upload file', UploadCloud], ['link', 'Add link', Link2]] as const).map(([id, label, Icon]) => (
          <button className="segmented-item touch-target"
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            disabled={busy}
            onClick={() => setMode(id)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <VisibilityPicker
          value={visibility}
          onChange={setVisibility}
          kind="asset"
          workspaceName={workspaceName}
          isPersonalWorkspace={isPersonalWorkspace}
          disabled={busy || savingLink}
        />
      </div>

      {collections.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="add-asset-collection" className="type-caption" style={FIELD_LABEL}>Collection</label>
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
          <label htmlFor="link-name" className="type-caption" style={FIELD_LABEL}>Name</label>
          <input
            id="link-name"
            className="input-base"
            value={linkName}
            maxLength={255}
            onChange={e => setLinkName(e.target.value)}
            placeholder="Envato T-Shirt Mockup"
            autoFocus
          />
          <label htmlFor="link-url" className="type-caption" style={{ ...FIELD_LABEL, marginTop: 14 }}>URL</label>
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
        <span className="type-body-sm">Drop files here or browse</span>
        <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', lineHeight: 1.5, maxWidth: 380 }}>
          Files up to {MAX_UPLOAD_LABEL} — images, video, design files, documents and archives.<br />
          Images (PNG, JPG, WEBP, GIF, SVG) can be placed on boards.
        </span>
      </button>

      {rejected.length > 0 && (
        <div role="alert" style={{ margin: '14px 0 0', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb, var(--color-error) 8%, transparent)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span style={{ color: 'var(--color-ink)' }}>{rejected.length === 1 ? '1 file wasn’t added' : `${rejected.length} files weren’t added`}</span>
            <button type="button" className="btn-icon btn-sm touch-target" onClick={() => setRejected([])} aria-label="Dismiss" style={{ flexShrink: 0 }}>
              <X size={14} />
            </button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rejected.map(r => (
              <li key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--color-error)', fontSize: 12, lineHeight: 1.4, minWidth: 0 }}>
                <AlertCircle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {queue.length > 0 && (
        <ul aria-label="Uploads" aria-live="polite" style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queue.map(item => {
            const pct = Math.round(item.progress * 100);
            return (
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
                  <span style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                    <span style={{ color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.file.name}</span>
                    <span style={{ color: 'var(--color-ink-muted)', flexShrink: 0 }}>{formatSize(item.file.size)}</span>
                  </span>
                  {item.status === 'uploading' && (
                    <span
                      role="progressbar"
                      aria-label={`Uploading ${item.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      style={{ display: 'block', height: 3, marginTop: 6, borderRadius: 2, background: 'var(--color-hairline)', overflow: 'hidden' }}
                    >
                      <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--color-ink)', transition: 'width 0.15s linear' }} />
                    </span>
                  )}
                  {item.status === 'error' && <span style={{ display: 'block', marginTop: 2, fontSize: 12, lineHeight: 1.4, color: 'var(--color-error)', overflowWrap: 'anywhere' }}>{item.message}</span>}
                  {item.status === 'waiting' && item.message && <span style={{ display: 'block', marginTop: 2, fontSize: 12, lineHeight: 1.4, color: 'var(--color-ink-muted)', overflowWrap: 'anywhere' }}>{item.message}</span>}
                </span>
                {item.status === 'error' && item.retryable ? (
                  <button type="button" className="btn-secondary btn-sm touch-target" onClick={() => retry(item.key)} aria-label={`Retry ${item.file.name}`} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <RotateCcw size={13} /> Retry
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', flexShrink: 0 }}>
                    {item.status === 'waiting' ? (item.message ? 'Paused' : 'Waiting') : item.status === 'uploading' ? (pct > 0 ? `${pct}%` : 'Uploading…') : item.status === 'done' ? 'Added' : 'Failed'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </>)}
    </LibraryDialog>
  );
}
