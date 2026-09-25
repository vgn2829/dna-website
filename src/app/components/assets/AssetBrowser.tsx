import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { Search, Plus, Layers, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { api, type Asset, type AssetCollection, type AssetKind } from '../../lib/api';
import { usePortalContainer } from '../PortalContainer';
import { AssetCard } from './AssetCard';
import { AddAssetDialog } from './AddAssetDialog';
import { LibraryDialog } from './LibraryDialog';
import { CollectionFormDialog, MoveAssetDialog, RenameAssetDialog } from './CollectionDialogs';

// ─────────────────────────────────────────────────────────────────────────
// Workspace Asset Library browser — search, type tabs, collections ("asset
// packs"), grid, pagination, add/move/rename/delete. One component, two
// hosts:
//   - AssetsPage (/assets): the library as a real page
//   - AssetLibrary (modal): opened from a board, where onInsert inserts an
//     image onto the canvas through BoardPage's existing, unchanged
//     handleInsertAsset → insertImageAsset path
// Filtering (kind / q / collection) is server-side so it composes with the
// existing cursor pagination instead of only filtering the first page.
// ─────────────────────────────────────────────────────────────────────────

export type LibraryTab = 'all' | AssetKind;
// 'all' = every asset, 'none' = ungrouped, otherwise a collection id.
type CollectionFilter = 'all' | 'none' | string;

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'file', label: 'Files' },
  { id: 'link', label: 'Links' },
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
  const portalContainer = usePortalContainer();
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [collections, setCollections] = useState<AssetCollection[]>([]);

  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState<Asset | null>(null);
  const [renaming, setRenaming] = useState<Asset | null>(null);
  const [collectionForm, setCollectionForm] = useState<{ editing: AssetCollection | null } | null>(null);
  const [confirmDeleteCollection, setConfirmDeleteCollection] = useState<AssetCollection | null>(null);
  const [deletingCollection, setDeletingCollection] = useState(false);
  const requestSeq = useRef(0);

  const collectionById = useMemo(() => new Map(collections.map(c => [c.id, c])), [collections]);
  const activeCollection = collectionFilter !== 'all' && collectionFilter !== 'none' ? collectionById.get(collectionFilter) ?? null : null;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const refreshCollections = useCallback(() => {
    api.assetCollections.list(roll, workspaceId)
      .then(res => setCollections(res.collections))
      .catch(() => { /* the bar just stays as-is; assets still load */ });
  }, [roll, workspaceId]);

  useEffect(() => { refreshCollections(); }, [refreshCollections]);

  // A collection that disappeared (deleted here or elsewhere) drops the
  // filter back to everything rather than showing a permanently empty view.
  useEffect(() => {
    if (collectionFilter !== 'all' && collectionFilter !== 'none' && !collectionById.has(collectionFilter) && !loading) {
      setCollectionFilter('all');
    }
  }, [collectionFilter, collectionById, loading]);

  const filters = useCallback(() => ({
    kind: tab === 'all' ? undefined : tab,
    q: debouncedQuery || undefined,
    collectionId: collectionFilter === 'all' ? undefined : collectionFilter,
    limit: PAGE_SIZE,
  }), [tab, debouncedQuery, collectionFilter]);

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

  // Would this asset appear in the current view (tab + search + collection)?
  const matchesView = (asset: Asset) =>
    (tab === 'all' || tab === asset.kind)
    && (!debouncedQuery || asset.filename.toLowerCase().includes(debouncedQuery.toLowerCase()))
    && (collectionFilter === 'all'
      || (collectionFilter === 'none' ? asset.collection_id === null : asset.collection_id === collectionFilter));

  const handleAdded = (asset: Asset) => {
    if (matchesView(asset)) setAssets(prev => [asset, ...prev.filter(a => a.id !== asset.id)]);
    if (asset.collection_id) refreshCollections();
  };

  // Apply a server-updated asset: replace in place, or drop it if it no
  // longer belongs in this view (e.g. moved out of the open collection).
  const applyUpdated = (updated: Asset) => {
    setAssets(prev => matchesView(updated)
      ? prev.map(a => (a.id === updated.id ? updated : a))
      : prev.filter(a => a.id !== updated.id));
  };

  const handleMove = async (asset: Asset, collectionId: string | null) => {
    const updated = await api.assets.update(roll, asset.id, { collection_id: collectionId });
    applyUpdated(updated);
    refreshCollections();
    setMoving(null);
    toast.success(collectionId ? `Moved to ${collectionById.get(collectionId)?.name ?? 'collection'}` : 'Removed from collection');
  };

  const handleRename = async (asset: Asset, name: string) => {
    const updated = await api.assets.update(roll, asset.id, { filename: name });
    applyUpdated(updated);
    setRenaming(null);
    toast.success('Asset renamed');
  };

  const handleDelete = async (asset: Asset) => {
    setDeleting(true);
    try {
      const res = await api.assets.delete(roll, asset.id);
      setAssets(prev => prev.filter(a => a.id !== asset.id));
      setConfirmDelete(null);
      if (asset.collection_id) refreshCollections();
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

  const handleSaveCollection = async (name: string, description: string | null) => {
    const editing = collectionForm?.editing ?? null;
    if (editing) {
      const updated = await api.assetCollections.update(roll, editing.id, { name, description });
      setCollections(prev => prev.map(c => (c.id === updated.id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)));
      toast.success('Collection updated');
    } else {
      const created = await api.assetCollections.create(roll, { workspace_id: workspaceId, name, description });
      setCollections(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCollectionFilter(created.id);
      toast.success(`Created “${created.name}”`);
    }
    setCollectionForm(null);
  };

  const handleDeleteCollection = async (collection: AssetCollection) => {
    setDeletingCollection(true);
    try {
      await api.assetCollections.delete(roll, collection.id);
      setCollections(prev => prev.filter(c => c.id !== collection.id));
      setAssets(prev => prev.map(a => (a.collection_id === collection.id ? { ...a, collection_id: null } : a)));
      setCollectionFilter('all');
      setConfirmDeleteCollection(null);
      toast.success('Collection deleted — its assets are still in the library');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete collection');
    } finally {
      setDeletingCollection(false);
    }
  };

  const isFiltered = tab !== 'all' || !!debouncedQuery || collectionFilter !== 'all';

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

      {/* Type tabs */}
      <div role="tablist" aria-label="Asset type" className="segmented" style={{ alignSelf: 'flex-start' }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button className="segmented-item touch-target"
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Collections bar — scrolls horizontally inside itself, never the page */}
      <div
        role="group"
        aria-label="Collections"
        style={{ display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto', paddingBottom: 2, maxWidth: '100%', scrollbarWidth: 'thin' }}
      >
        <Layers size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-ink-muted)', marginRight: 2 }} />
        <CollectionChip label="All assets" active={collectionFilter === 'all'} onClick={() => setCollectionFilter('all')} />
        {collections.map(c => (
          <CollectionChip key={c.id} label={c.name} count={c.asset_count} active={collectionFilter === c.id} onClick={() => setCollectionFilter(c.id)} />
        ))}
        {collections.length > 0 && (
          <CollectionChip label="Ungrouped" active={collectionFilter === 'none'} onClick={() => setCollectionFilter('none')} muted />
        )}
        <button
          type="button"
          onClick={() => setCollectionForm({ editing: null })}
          className="btn-secondary btn-sm touch-target"
          style={{ flexShrink: 0 }}
        >
          <Plus size={13} /> New collection
        </button>
      </div>

      {/* Open collection ("pack") header */}
      {activeCollection && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          padding: '14px 16px', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-hairline)', background: 'var(--color-surface-1)',
        }}>
          <div style={{ minWidth: 0 }}>
            <p className="type-headline" style={{ margin: 0, overflowWrap: 'anywhere' }}>
              {activeCollection.name}
            </p>
            <p className="type-caption" style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>
              {activeCollection.asset_count} {activeCollection.asset_count === 1 ? 'asset' : 'assets'}
              {activeCollection.description ? ` · ${activeCollection.description}` : ''}
            </p>
          </div>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger aria-label={`Collection actions for ${activeCollection.name}`} className="btn-icon" style={{ width: 32, height: 32, flexShrink: 0 }}>
              <MoreHorizontal size={16} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={portalContainer}>
              <DropdownMenu.Content className="dna-menu" align="end" sideOffset={6} collisionPadding={12}>
                <DropdownMenu.Item className="dna-menu-item" onSelect={() => setCollectionForm({ editing: activeCollection })}>
                  <Pencil size={15} /> Edit collection…
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="dna-menu-sep" />
                <DropdownMenu.Item className="dna-menu-item" data-danger="true" onSelect={() => setConfirmDeleteCollection(activeCollection)}>
                  <Trash2 size={15} /> Delete collection
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}

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
        activeCollection && tab === 'all' && !debouncedQuery ? (
          <EmptyState
            title="This collection is empty"
            body="Add new assets straight into it, or use “Move to collection…” on any existing asset."
            action={<button type="button" className="btn-primary" onClick={() => setShowAdd(true)} style={{ minHeight: 40 }}><Plus size={16} /> Add to {activeCollection.name}</button>}
          />
        ) : isFiltered ? (
          <EmptyState
            title="No matching assets"
            body={debouncedQuery ? `Nothing in ${workspaceName} matches “${debouncedQuery}”.` : 'Nothing here yet.'}
          />
        ) : (
          <EmptyState
            title="Your asset library is empty"
            body="Keep everything you need for design work in one place — images, PSD/AI/Figma files, PDFs, and links to Envato, Figma, Behance and more."
            action={<button type="button" className="btn-primary" onClick={() => setShowAdd(true)} style={{ minHeight: 40 }}><Plus size={16} /> Add your first asset</button>}
          />
        )
      ) : (
        <>
          <div style={GRID}>
            {assets.map(asset => (
              <AssetCard
                key={asset.id}
                asset={asset}
                collectionName={asset.collection_id && asset.collection_id !== collectionFilter ? collectionById.get(asset.collection_id)?.name : null}
                onInsert={onInsert}
                onMove={setMoving}
                onRename={setRenaming}
                onDelete={setConfirmDelete}
              />
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
          roll={roll}
          collections={collections}
          defaultCollectionId={activeCollection?.id ?? null}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}

      {moving && (
        <MoveAssetDialog asset={moving} collections={collections} onClose={() => setMoving(null)} onSubmit={id => handleMove(moving, id)} />
      )}

      {renaming && (
        <RenameAssetDialog asset={renaming} onClose={() => setRenaming(null)} onSubmit={name => handleRename(renaming, name)} />
      )}

      {collectionForm && (
        <CollectionFormDialog
          initial={collectionForm.editing ?? undefined}
          onClose={() => setCollectionForm(null)}
          onSubmit={handleSaveCollection}
        />
      )}

      {confirmDelete && (
        <LibraryDialog
          title={`Delete “${confirmDelete.filename}”?`}
          role="alertdialog"
          maxWidth={400}
          onClose={() => { if (!deleting) setConfirmDelete(null); }}
          footer={<>
            <button type="button" className="btn-translucent" onClick={() => setConfirmDelete(null)} disabled={deleting} style={{ minHeight: 40 }}>Cancel</button>
            <button type="button" className="btn-primary btn-danger" onClick={() => handleDelete(confirmDelete)} disabled={deleting} style={{ minHeight: 40 }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>}
        >
          <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
            {confirmDelete.kind === 'link'
              ? 'This removes the link from the asset library.'
              : 'This removes it from the asset library. Copies already placed on boards are unaffected.'}
          </p>
        </LibraryDialog>
      )}

      {confirmDeleteCollection && (
        <LibraryDialog
          title={`Delete “${confirmDeleteCollection.name}”?`}
          role="alertdialog"
          maxWidth={420}
          onClose={() => { if (!deletingCollection) setConfirmDeleteCollection(null); }}
          footer={<>
            <button type="button" className="btn-translucent" onClick={() => setConfirmDeleteCollection(null)} disabled={deletingCollection} style={{ minHeight: 40 }}>Cancel</button>
            <button type="button" className="btn-primary btn-danger" onClick={() => handleDeleteCollection(confirmDeleteCollection)} disabled={deletingCollection} style={{ minHeight: 40 }}>
              {deletingCollection ? 'Deleting…' : 'Delete collection'}
            </button>
          </>}
        >
          <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
            The {confirmDeleteCollection.asset_count} {confirmDeleteCollection.asset_count === 1 ? 'asset' : 'assets'} in it stay in the library — they just won’t be grouped anymore.
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

function CollectionChip({ label, count, active, muted, onClick }: { label: string; count?: number; active: boolean; muted?: boolean; onClick: () => void }) {
  return (
    <button className="touch-target"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220,
        padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${active ? 'var(--color-ink)' : 'var(--color-hairline)'}`,
        background: active ? 'var(--color-inverse-canvas)' : 'transparent',
        color: active ? 'var(--color-canvas)' : muted ? 'var(--color-ink-muted)' : 'var(--color-ink)',
        fontSize: 13, fontWeight: 500, letterSpacing: '-0.13px', fontFamily: 'var(--font-body)',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {count !== undefined && <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
    </button>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
      padding: '56px 20px', borderRadius: 'var(--radius-xl)', border: '1px dashed var(--color-hairline)',
    }}>
      <p className="type-headline" style={{ margin: 0 }}>{title}</p>
      <p className="type-body" style={{ margin: 0, maxWidth: 440, color: 'var(--color-ink-muted)' }}>{body}</p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
