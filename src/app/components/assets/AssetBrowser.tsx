import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Search, Plus } from 'lucide-react';
import { api, type Asset, type AssetKind } from '../../lib/api';
import { AssetCard } from './AssetCard';
import { AddAssetDialog } from './AddAssetDialog';
import { LibraryDialog } from './LibraryDialog';

// ─────────────────────────────────────────────────────────────────────────
// Workspace Asset Library browser — search, type tabs, grid, pagination,
// add, delete. One component, two hosts:
//   - AssetsPage (/assets): the library as a real page
//   - AssetLibrary (modal): opened from a board, where onInsert inserts an
//     image onto the canvas through BoardPage's existing, unchanged
//     handleInsertAsset → insertImageAsset path
// Filtering is server-side (GET /api/assets kind/q) so it composes with
// the existing cursor pagination instead of only filtering the first page.
// ─────────────────────────────────────────────────────────────────────────

export type LibraryTab = 'all' | AssetKind;

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'file', label: 'Files' },
];

const PAGE_SIZE = 40;

export function AssetBrowser({
  workspaceId,
  workspaceName,
  roll,
  onInsert,
  initialTab = 'all',
}: {
  workspaceId: string;
  workspaceName: string;
  roll: string;
  onInsert?: (asset: Asset) => void;
  initialTab?: LibraryTab;
}) {
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const filters = useCallback(() => ({
    kind: tab === 'all' ? undefined : tab,
    q: debouncedQuery || undefined,
    limit: PAGE_SIZE,
  }), [tab, debouncedQuery]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(false);
    api.assets.list(roll, workspaceId, undefined, filters())
      .then(res => {
        if (seq !== requestSeq.current) return;
        setAssets(res.assets);
        setNextCursor(res.nextCursor);
      })
      .catch(() => { if (seq === requestSeq.current) setLoadError(true); })
      .finally(() => { if (seq === requestSeq.current) setLoading(false); });
  }, [roll, workspaceId, filters]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const res = await api.assets.list(roll, workspaceId, nextCursor, filters());
      if (seq !== requestSeq.current) return;
      setAssets(prev => [...prev, ...res.assets.filter(a => !prev.some(p => p.id === a.id))]);
      setNextCursor(res.nextCursor);
    } catch {
      toast.error('Failed to load more assets');
    } finally {
      setLoadingMore(false);
    }
  };

  // A newly added asset is shown immediately if it belongs in the current
  // view (matching tab + search); otherwise it's there next time the view
  // changes — no refetch needed either way.
  const handleAdded = (asset: Asset) => {
    const matchesTab = tab === 'all' || tab === asset.kind;
    const matchesQuery = !debouncedQuery || asset.filename.toLowerCase().includes(debouncedQuery.toLowerCase());
    if (matchesTab && matchesQuery) setAssets(prev => [asset, ...prev.filter(a => a.id !== asset.id)]);
  };

  const handleDelete = async (asset: Asset) => {
    setDeleting(true);
    try {
      const res = await api.assets.delete(roll, asset.id);
      setAssets(prev => prev.filter(a => a.id !== asset.id));
      setConfirmDelete(null);
      if (res.storageWarning) toast.warning(res.storageWarning);
      else toast.success('Asset deleted');
    } catch (err) {
      toast.error(err instanceof Error && err.message === 'Access denied'
        ? 'Only the uploader or a workspace admin can delete this asset'
        : 'Failed to delete asset');
    } finally {
      setDeleting(false);
    }
  };

  const isFiltered = tab !== 'all' || !!debouncedQuery;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {/* Toolbar: search + add */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
          <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)', pointerEvents: 'none' }} />
          <input
            className="input-base"
            type="search"
            placeholder="Search assets…"
            aria-label="Search assets"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 36, fontSize: 14, borderRadius: 'var(--radius-pill)' }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={() => setShowAdd(true)} style={{ minHeight: 40 }}>
          <Plus size={16} /> Add Asset
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Asset type" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)', maxWidth: '100%', overflowX: 'auto' }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: 'none', whiteSpace: 'nowrap',
                  background: active ? 'var(--color-surface-2)' : 'transparent',
                  color: active ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                  fontSize: 13, fontWeight: 500, letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={GRID} aria-busy="true" aria-label="Loading assets">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-pulse" style={{ aspectRatio: '4 / 4.2', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)' }} />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState title="Couldn’t load assets" body="Check your connection and try again." />
      ) : assets.length === 0 ? (
        isFiltered ? (
          <EmptyState
            title="No matching assets"
            body={debouncedQuery ? `Nothing in ${workspaceName} matches “${debouncedQuery}”.` : 'Nothing of this type yet.'}
          />
        ) : (
          <EmptyState
            title="Your asset library is empty"
            body="Keep everything you need for design work in one place — images, PSD/AI/Figma files, PDFs and more."
            action={<button type="button" className="btn-primary" onClick={() => setShowAdd(true)} style={{ minHeight: 40 }}><Plus size={16} /> Add your first asset</button>}
          />
        )
      ) : (
        <>
          <div style={GRID}>
            {assets.map(asset => (
              <AssetCard key={asset.id} asset={asset} onInsert={onInsert} onDelete={setConfirmDelete} />
            ))}
          </div>
          {nextCursor && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn-secondary" onClick={loadMore} disabled={loadingMore} style={{ minHeight: 40 }}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {showAdd && (
        <AddAssetDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}

      {confirmDelete && (
        <LibraryDialog
          title={`Delete “${confirmDelete.filename}”?`}
          role="alertdialog"
          maxWidth={400}
          onClose={() => { if (!deleting) setConfirmDelete(null); }}
          footer={<>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting} style={{ minHeight: 40 }}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleDelete(confirmDelete)}
              disabled={deleting}
              style={{ minHeight: 40, background: 'var(--color-error)', color: '#fff' }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>}
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            This removes it from the asset library. Copies already placed on boards are unaffected.
          </p>
        </LibraryDialog>
      )}
    </div>
  );
}

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))',
  gap: 14,
};

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
      padding: '56px 20px', borderRadius: 'var(--radius-xl)', border: '1px dashed var(--color-hairline)',
    }}>
      <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, letterSpacing: '-0.4px', color: 'var(--color-ink)' }}>{title}</p>
      <p style={{ margin: 0, maxWidth: 420, fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.5, color: 'var(--color-ink-muted)' }}>{body}</p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
