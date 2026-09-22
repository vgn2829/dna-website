import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { api, type Asset } from '../lib/api';
import { useModalA11y } from './hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// Asset Manager (Phase B) — a persistent, workspace-scoped asset library.
// Self-contained the same way ShareBoardDialog/WorkspaceSettingsModal are:
// fetches its own data on open, only needs an id (workspaceId) + roll from
// its caller. Two call sites: MoodboardsPage.tsx (browse/manage only — no
// onSelect) and BoardPage.tsx (onSelect wired to insert the chosen asset
// onto the open board's canvas — see BoardPage.tsx's own comment on the
// editor-ref plumbing that makes that insertion work).
//
// Distinct from the existing canvas-files upload (TldrawCanvas's
// assetStore.upload / boards.uploadCanvasFile): that path stores an object
// with no DB row, referenced only from one board's own canvas_data —
// nothing here replaces or duplicates that; this is a separate, reusable,
// cross-board library sitting alongside it.
// ─────────────────────────────────────────────────────────────────────────

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetLibrary({
  workspaceId,
  workspaceName,
  roll,
  onClose,
  onSelect,
}: {
  workspaceId: string;
  workspaceName: string;
  roll: string;
  onClose: () => void;
  onSelect?: (asset: Asset) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Asset | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalA11y(true, onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.assets.list(roll, workspaceId)
      .then(data => { if (!cancelled) setAssets(data.assets); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, roll]);

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_MIME.includes(file.type)) return 'Unsupported file type — use PNG, JPEG, WEBP, GIF, or SVG.';
    if (file.size > MAX_SIZE_BYTES) return `File exceeds ${formatSize(MAX_SIZE_BYTES)} limit.`;
    return null;
  };

  const handleUpload = async (file: File) => {
    const error = validateFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    setUploading(true);
    try {
      const asset = await api.assets.upload(workspaceId, file);
      setAssets(prev => [asset, ...prev]);
      toast.success('Asset uploaded');
    } catch {
      toast.error('Failed to upload asset');
    } finally {
      setUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDelete = async (asset: Asset) => {
    setDeletingId(asset.id);
    try {
      const res = await api.assets.delete(roll, asset.id);
      setAssets(prev => prev.filter(a => a.id !== asset.id));
      setConfirmDelete(null);
      if (res.storageWarning) {
        toast.warning(res.storageWarning);
      } else {
        toast.success('Asset deleted');
      }
    } catch {
      toast.error('Failed to delete asset');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Asset library"
          tabIndex={-1}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 720,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-xl)', padding: '28px 24px',
            display: 'flex', flexDirection: 'column', gap: 20,
            maxHeight: '85vh', outline: 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{
                margin: 0, fontSize: 18, fontWeight: 700,
                color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
              }}>
                Asset Library
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                {workspaceName}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close asset library"
              style={{
                width: 32, height: 32, borderRadius: 'var(--radius-full)', flexShrink: 0,
                border: '1px solid var(--color-hairline)', background: 'none',
                color: 'var(--color-ink-muted)', fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME.join(',')}
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />

          <div
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            style={{
              border: `1.5px dashed ${dragActive ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: '18px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              background: dragActive ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'none',
              transition: 'all 0.15s ease',
              flexWrap: 'wrap',
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
              Drag and drop an image here, or
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                padding: '8px 16px', background: 'var(--color-brand)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
                fontFamily: 'var(--font-body)', cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.6 : 1, whiteSpace: 'nowrap',
              }}
            >
              {uploading ? 'Uploading…' : 'Upload asset'}
            </button>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 120 }}>
            {loading ? (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12,
              }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton-pulse" style={{
                    aspectRatio: '1 / 1', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)',
                  }} />
                ))}
              </div>
            ) : loadError ? (
              <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                Failed to load assets.
              </p>
            ) : assets.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                No assets yet. Upload an image to add it to this workspace's library.
              </p>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12,
              }}>
                {assets.map(asset => (
                  <div
                    key={asset.id}
                    style={{
                      border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
                      overflow: 'hidden', background: 'var(--color-surface-2)', position: 'relative',
                    }}
                  >
                    <button
                      onClick={() => onSelect?.(asset)}
                      disabled={!onSelect}
                      aria-label={onSelect ? `Insert ${asset.filename} onto the board` : asset.filename}
                      title={onSelect ? `Insert ${asset.filename}` : asset.filename}
                      style={{
                        display: 'block', width: '100%', padding: 0, border: 'none', background: 'none',
                        cursor: onSelect ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', background: 'var(--color-canvas)' }}>
                        <img
                          src={asset.url}
                          alt={asset.filename}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    </button>
                    <div style={{ padding: '8px 10px' }}>
                      <p style={{
                        margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--color-ink)',
                        fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {asset.filename}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                        {formatSize(asset.size_bytes)}
                      </p>
                    </div>
                    <button
                      onClick={() => setConfirmDelete(asset)}
                      aria-label={`Delete ${asset.filename}`}
                      title="Delete asset"
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
                        fontSize: 14, lineHeight: 1, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {confirmDelete && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10001,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => { if (!deletingId) setConfirmDelete(null); }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={`Delete "${confirmDelete.filename}"?`}
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 360,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-xl)', padding: '28px 24px',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
              Delete "{confirmDelete.filename}"?
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              This removes it from the asset library. Copies already placed on boards are unaffected.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deletingId === confirmDelete.id}
                style={{
                  flex: 1, padding: '12px 20px', background: 'var(--color-error)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: deletingId === confirmDelete.id ? 'not-allowed' : 'pointer',
                }}
              >
                {deletingId === confirmDelete.id ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId === confirmDelete.id}
                style={{
                  flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)',
                  border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-pill)',
                  fontSize: 13, fontFamily: 'var(--font-body)', cursor: deletingId === confirmDelete.id ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
