import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Lightbulb, Link2, ImagePlus, Search, Plus, Pencil, Trash2, MoreHorizontal, X } from 'lucide-react';
import {
  api, type Asset, type Board, type InspirationCategory, type InspirationCollection, type InspirationFacets,
  type InspirationItem, type InspirationSort,
} from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { workspacePageGate } from '../lib/workspaceLoad';
import { AssetLibrary } from '../components/AssetLibrary';
import { SaveToMoodboardDialog } from '../components/SaveToMoodboardDialog';
import { WorkspaceLoadErrorState } from '../components/shell/WorkspaceLoadErrorState';
import { InspirationCard } from '../components/inspiration/InspirationCard';
import {
  CollectionDialog, ConfirmDialog, ReferenceDialog, type ReferenceSubmit, type ReferenceTarget,
} from '../components/inspiration/InspirationDialogs';
import { CATEGORY_OPTIONS, SORT_OPTIONS, boardBlocker, categoryLabel, hasActiveFilters, moodboardPlan } from '../lib/inspiration';
import { ADD_TO_MOODBOARD_ERROR, classifyAddToMoodboardError } from '../lib/assetPreview';

// ─────────────────────────────────────────────────────────────────────────
// Inspiration Library (Milestone C): a student's private, visual set of
// saved references — library assets (by pointer, never copied) and external
// links — organised into private collections, searchable by title / notes /
// tags and filterable by category. Placing a reference on a moodboard goes
// through the existing board-item endpoint, so the board's own permission
// and workspace checks apply. Nothing here is fetched or scraped server-side.
// ─────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 30;
type CollectionFilter = '' | 'none' | string;

export default function InspirationPage() {
  const { studentSession, openRollModal } = useStudent();
  const { activeWorkspaceId, workspaces, personalWorkspace, loading, loadError, refresh } = useWorkspace();
  const navigate = useNavigate();
  const roll = studentSession?.rollNumber ?? '';

  const [items, setItems] = useState<InspirationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [collections, setCollections] = useState<InspirationCollection[]>([]);
  const [facets, setFacets] = useState<InspirationFacets>({ tags: [], categories: [], total: 0 });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<InspirationCategory | 'none' | ''>('');
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>('');
  const [sort, setSort] = useState<InspirationSort>('newest');

  const [reference, setReference] = useState<ReferenceTarget | null>(null);
  const [pickingAsset, setPickingAsset] = useState(false);
  const [collectionDialog, setCollectionDialog] = useState<{ editing: InspirationCollection | null } | null>(null);
  const [confirmCollection, setConfirmCollection] = useState<InspirationCollection | null>(null);
  const [confirmItem, setConfirmItem] = useState<InspirationItem | null>(null);
  const [boardTarget, setBoardTarget] = useState<InspirationItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const sessionExpired = useCallback((err: unknown) => {
    if (err instanceof Error && err.message === 'SESSION_EXPIRED') { toast.error('Your session expired — sign in again'); openRollModal(); return true; }
    return false;
  }, [openRollModal]);

  const query = useMemo(() => ({
    q: debouncedSearch, tags, category, collectionId: collectionFilter, sort,
  }), [debouncedSearch, tags, category, collectionFilter, sort]);

  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!roll) return;
    const mine = ++seq.current;
    setListState(s => (s === 'ready' ? s : 'loading'));
    try {
      const res = await api.inspiration.list(roll, { ...query, limit: PAGE_SIZE });
      if (mine !== seq.current) return;
      setItems(res.items); setTotal(res.total); setHasMore(res.hasMore); setListState('ready');
    } catch (err) {
      if (mine !== seq.current || sessionExpired(err)) return;
      setListState('error');
    }
  }, [roll, query, sessionExpired]);

  const loadSide = useCallback(async () => {
    if (!roll) return;
    try {
      const [c, f] = await Promise.all([api.inspiration.collections(roll), api.inspiration.facets(roll)]);
      setCollections(c.collections); setFacets(f);
    } catch (err) { sessionExpired(err); }
  }, [roll, sessionExpired]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSide(); }, [loadSide]);

  const refreshAll = useCallback(() => { void load(); void loadSide(); }, [load, loadSide]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.inspiration.list(roll, { ...query, limit: PAGE_SIZE, offset: items.length });
      setItems(prev => [...prev, ...res.items.filter(i => !prev.some(p => p.id === i.id))]);
      setHasMore(res.hasMore); setTotal(res.total);
    } catch (err) { if (!sessionExpired(err)) toast.error('Couldn’t load more — try again'); }
    finally { setLoadingMore(false); }
  };

  // ── Guard rails (signed out / workspace load) ──────────────────────────
  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>Sign in to build your Inspiration Library.</p>
        <button onClick={openRollModal} className="btn-primary">Sign in</button>
      </div>
    );
  }
  const activeWorkspace = activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) ?? null : null;
  const pickerWorkspace = activeWorkspace ?? personalWorkspace;
  const gate = workspacePageGate({ loading, loadError, workspaceCount: workspaces.length, hasTargetWorkspace: !!pickerWorkspace });
  if (gate === 'error' && loadError) {
    return <WorkspaceLoadErrorState error={loadError} icon={Lightbulb} noun="inspiration" onRetry={() => void refresh()} onSignIn={openRollModal} />;
  }

  // ── Mutations ──────────────────────────────────────────────────────────
  const submitReference = async (target: ReferenceTarget, v: ReferenceSubmit) => {
    if (target.type === 'edit') {
      await api.inspiration.update(roll, target.item.id, { title: v.title, description: v.description, category: v.category, tags: v.tags });
      // Collections are edited in the same dialog: reconcile membership.
      const before = new Set(target.item.collection_ids), after = new Set(v.collection_ids);
      await Promise.all([
        ...[...after].filter(id => !before.has(id)).map(id => api.inspiration.addToCollection(roll, id, target.item.id)),
        ...[...before].filter(id => !after.has(id)).map(id => api.inspiration.removeFromCollection(roll, id, target.item.id)),
      ]);
      toast.success('Reference updated');
    } else if (target.type === 'asset') {
      await api.inspiration.saveAsset(roll, target.asset.id, { title: v.title, description: v.description, category: v.category, tags: v.tags, collection_ids: v.collection_ids });
      toast.success('Saved to your Inspiration Library');
    } else {
      await api.inspiration.saveLink(roll, { url: v.url!, image_url: v.image_url, title: v.title, description: v.description, category: v.category, tags: v.tags, collection_ids: v.collection_ids });
      toast.success('Link saved');
    }
    setReference(null);
    refreshAll();
  };

  const toggleCollection = async (item: InspirationItem, c: InspirationCollection, on: boolean) => {
    const apply = (ids: string[]) => setItems(prev => prev.map(i => (i.id === item.id ? { ...i, collection_ids: ids } : i)));
    const next = on ? [...item.collection_ids, c.id] : item.collection_ids.filter(x => x !== c.id);
    apply(next);
    try {
      if (on) await api.inspiration.addToCollection(roll, c.id, item.id);
      else await api.inspiration.removeFromCollection(roll, c.id, item.id);
      void loadSide();
      if (collectionFilter === c.id && !on) void load();
    } catch (err) {
      apply(item.collection_ids);
      if (!sessionExpired(err)) toast.error('Couldn’t update the collection');
    }
  };

  const addToBoard = async (item: InspirationItem, board: Board) => {
    const plan = moodboardPlan(item);
    if (!plan) return;
    try {
      const res = plan.type === 'asset'
        ? await api.boards.addAssetItem(board.id, roll, plan.assetId, `${window.location.origin}/inspiration`)
        : await api.boards.addItem(board.id, roll, { image_url: plan.imageUrl, note: plan.note, source_url: plan.sourceUrl ?? undefined });
      setBoardTarget(null);
      toast.success((res as { duplicate?: boolean }).duplicate ? `Already added to “${board.name}”` : `Added to “${board.name}”`, {
        description: 'It appears on the board the next time it opens.',
        action: { label: 'Open board', onClick: () => navigate(`/moodboards/${board.id}`) },
      });
    } catch (err) {
      const failure = classifyAddToMoodboardError(err);
      toast.error(ADD_TO_MOODBOARD_ERROR[failure]);
      if (failure === 'session') { setBoardTarget(null); openRollModal(); }
    }
  };

  const clearFilters = () => { setSearch(''); setTags([]); setCategory(''); };
  const filtersOn = hasActiveFilters({ q: debouncedSearch, tags, category, kind: '' });
  const inCollection = collectionFilter && collectionFilter !== 'none' ? collections.find(c => c.id === collectionFilter) ?? null : null;
  const libraryEmpty = facets.total === 0 && listState === 'ready' && !filtersOn && !collectionFilter;

  const chip = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', flexShrink: 0,
    fontFamily: 'var(--font-body)', fontSize: 13, whiteSpace: 'nowrap', color: 'var(--color-ink)',
    background: active ? 'var(--color-surface-2)' : 'transparent', border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
  });

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 'var(--space-lg)' }}>
        <div style={{ minWidth: 0 }}>
          <p className="type-caption" style={{ marginBottom: 8 }}>Private to you</p>
          <h1 className="type-display-md" style={{ margin: 0 }}>Inspiration</h1>
          <p className="type-body" style={{ margin: '10px 0 0', color: 'var(--color-ink-muted)' }}>
            Save references, group them into collections and bring them to your moodboards.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn-translucent touch-target" disabled={!pickerWorkspace}
            title={pickerWorkspace ? undefined : 'Your workspace is still loading'} onClick={() => setPickingAsset(true)}>
            <ImagePlus size={15} aria-hidden="true" /> From Assets
          </button>
          <button type="button" className="btn-primary touch-target" onClick={() => setReference({ type: 'link' })}>
            <Link2 size={15} aria-hidden="true" /> Save a link
          </button>
        </div>
      </div>

      {/* Collections */}
      <div role="group" aria-label="Collections" style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
        <button type="button" aria-pressed={collectionFilter === ''} style={chip(collectionFilter === '')} onClick={() => setCollectionFilter('')}>All</button>
        <button type="button" aria-pressed={collectionFilter === 'none'} style={chip(collectionFilter === 'none')} onClick={() => setCollectionFilter('none')}>Unfiled</button>
        {collections.map(c => (
          <button key={c.id} type="button" aria-pressed={collectionFilter === c.id} style={chip(collectionFilter === c.id)} onClick={() => setCollectionFilter(c.id)}>
            {c.name} <span className="type-micro">{c.item_count}</span>
          </button>
        ))}
        <button type="button" style={{ ...chip(false), borderStyle: 'dashed' }} onClick={() => setCollectionDialog({ editing: null })}>
          <Plus size={13} aria-hidden="true" /> New collection
        </button>
      </div>

      {inCollection && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="type-headline" style={{ margin: 0 }}>{inCollection.name}</h2>
            {inCollection.description && <p className="type-caption" style={{ margin: '2px 0 0' }}>{inCollection.description}</p>}
          </div>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger className="btn-translucent btn-icon btn-sm touch-target" aria-label={`Actions for collection ${inCollection.name}`}>
              <MoreHorizontal size={15} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="dna-menu" align="end" sideOffset={6} collisionPadding={12} style={{ zIndex: 9100 }}>
                <DropdownMenu.Item className="dna-menu-item" onSelect={() => setCollectionDialog({ editing: inCollection })}><Pencil size={15} /> Rename</DropdownMenu.Item>
                <DropdownMenu.Item className="dna-menu-item" data-danger="true" onSelect={() => setConfirmCollection(inCollection)}><Trash2 size={15} /> Delete collection</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}

      {/* Search + filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
          <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)' }} />
          <input className="input-base" type="search" aria-label="Search references" placeholder="Search titles, notes and tags"
            value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 34 }} />
        </div>
        <select className="input-base" aria-label="Category" value={category} onChange={e => setCategory(e.target.value as InspirationCategory | 'none' | '')} style={{ flex: '0 1 170px' }}>
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map(c => {
            const n = facets.categories.find(f => f.category === c.id)?.count;
            return <option key={c.id} value={c.id}>{c.label}{n ? ` (${n})` : ''}</option>;
          })}
          <option value="none">Uncategorised</option>
        </select>
        <select className="input-base" aria-label="Sort" value={sort} onChange={e => setSort(e.target.value as InspirationSort)} style={{ flex: '0 1 160px' }}>
          {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {facets.tags.length > 0 && (
        <div role="group" aria-label="Filter by tag" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
          {facets.tags.slice(0, 24).map(t => {
            const on = tags.includes(t.tag);
            return (
              <button key={t.tag} type="button" aria-pressed={on} style={chip(on)}
                onClick={() => setTags(prev => (on ? prev.filter(x => x !== t.tag) : [...prev, t.tag]))}>
                #{t.tag} <span className="type-micro">{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {filtersOn && (
        <p className="type-caption" role="status" style={{ margin: '0 0 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {total} {total === 1 ? 'match' : 'matches'}
          {category && category !== 'none' && <span>· {categoryLabel(category)}</span>}
          <button type="button" onClick={clearFilters} className="btn-translucent btn-sm" style={{ minHeight: 28 }}><X size={12} aria-hidden="true" /> Clear filters</button>
        </p>
      )}

      {/* Results */}
      {(listState === 'loading' || gate === 'loading') && (
        <div role="status" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>Loading your references…</div>
      )}
      {listState === 'error' && (
        <div role="alert" style={{ padding: '48px 0', textAlign: 'center' }}>
          <p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: '0 0 12px' }}>Couldn’t load your Inspiration Library.</p>
          <button type="button" className="btn-translucent" onClick={() => void load()}>Try again</button>
        </div>
      )}
      {libraryEmpty && (
        <div style={{ padding: '56px 16px', textAlign: 'center', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-xl)' }}>
          <Lightbulb size={32} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          <h2 className="type-headline" style={{ margin: '12px 0 6px' }}>Start your Inspiration Library</h2>
          <p className="type-body-sm" style={{ margin: '0 auto 18px', maxWidth: 440, color: 'var(--color-ink-muted)' }}>
            Save images from your Asset Library or links to anything that sparks an idea. Everything stays private to you, and you can drop it on a moodboard any time.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn-translucent" disabled={!pickerWorkspace} onClick={() => setPickingAsset(true)}><ImagePlus size={15} aria-hidden="true" /> Save from Assets</button>
            <button type="button" className="btn-primary" onClick={() => setReference({ type: 'link' })}><Link2 size={15} aria-hidden="true" /> Save a link</button>
          </div>
        </div>
      )}
      {listState === 'ready' && !libraryEmpty && items.length === 0 && (
        <div style={{ padding: '48px 16px', textAlign: 'center' }}>
          <p className="type-body" style={{ margin: '0 0 6px', color: 'var(--color-ink)' }}>
            {filtersOn ? 'No references match these filters.' : inCollection ? 'This collection is empty.' : collectionFilter === 'none' ? 'Everything is filed in a collection.' : 'Nothing here yet.'}
          </p>
          <p className="type-caption" style={{ margin: '0 0 14px' }}>
            {filtersOn ? 'Try a different search, tag or category.' : inCollection ? 'Open a reference’s ⋯ menu and tick this collection to add it.' : ''}
          </p>
          {filtersOn && <button type="button" className="btn-translucent" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}
      {listState === 'ready' && items.length > 0 && (
        <>
          <div style={{ columnWidth: 240, columnGap: 16 }}>
            {items.map(item => (
              <InspirationCard
                key={item.id} item={item} collections={collections}
                onEdit={i => setReference({ type: 'edit', item: i })}
                onRemove={setConfirmItem}
                onToggleCollection={toggleCollection}
                onAddToMoodboard={setBoardTarget}
                onTagClick={t => setTags(prev => (prev.includes(t) ? prev : [...prev, t]))}
              />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
              <button type="button" className="btn-translucent" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Show more (${total - items.length} left)`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      {pickingAsset && pickerWorkspace && (
        <AssetLibrary
          workspaceId={pickerWorkspace.id}
          workspaceName={pickerWorkspace.is_personal ? 'Personal' : pickerWorkspace.name}
          isPersonalWorkspace={pickerWorkspace.is_personal}
          workspaceRole={pickerWorkspace.role}
          roll={roll}
          selectHint="save it as inspiration"
          onClose={() => setPickingAsset(false)}
          onSelect={(asset: Asset) => { setPickingAsset(false); setReference({ type: 'asset', asset }); }}
        />
      )}
      {reference && (
        <ReferenceDialog target={reference} collections={collections} onClose={() => setReference(null)} onSubmit={v => submitReference(reference, v)} />
      )}
      {collectionDialog && (
        <CollectionDialog
          initial={collectionDialog.editing ?? undefined}
          onClose={() => setCollectionDialog(null)}
          onSubmit={async (name, description) => {
            if (collectionDialog.editing) await api.inspiration.updateCollection(roll, collectionDialog.editing.id, { name, description });
            else { const c = await api.inspiration.createCollection(roll, { name, description }); setCollectionFilter(c.id); }
            setCollectionDialog(null);
            void loadSide();
          }}
        />
      )}
      {confirmCollection && (
        <ConfirmDialog
          title="Delete collection?" confirmLabel="Delete collection" onClose={() => setConfirmCollection(null)}
          body={`“${confirmCollection.name}” will be deleted. The ${confirmCollection.item_count} reference${confirmCollection.item_count === 1 ? '' : 's'} in it stay in your library.`}
          onConfirm={async () => {
            await api.inspiration.deleteCollection(roll, confirmCollection.id);
            setConfirmCollection(null); setCollectionFilter(''); toast.success('Collection deleted'); refreshAll();
          }}
        />
      )}
      {confirmItem && (
        <ConfirmDialog
          title="Remove this reference?" confirmLabel="Remove" onClose={() => setConfirmItem(null)}
          body={confirmItem.kind === 'asset'
            ? `“${confirmItem.title}” is removed from your Inspiration Library. The file stays in your Asset Library.`
            : `“${confirmItem.title}” is removed from your Inspiration Library. The website is not affected.`}
          onConfirm={async () => { await api.inspiration.remove(roll, confirmItem.id); setConfirmItem(null); toast.success('Reference removed'); refreshAll(); }}
        />
      )}
      <AnimatePresence>
        {boardTarget && <BoardPicker item={boardTarget} roll={roll} onPick={b => addToBoard(boardTarget, b)} onClose={() => setBoardTarget(null)} />}
      </AnimatePresence>
    </div>
  );
}

// Loads the caller's boards and lets them pick one. Personal assets are
// listed last and disabled for boards outside their own workspace; the
// server remains the authority on everything else.
function BoardPicker({ item, roll, onPick, onClose }: { item: InspirationItem; roll: string; onPick: (b: Board) => void; onClose: () => void }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const load = useCallback(() => {
    setBoards(null); setLoadError(false);
    api.boards.getMyBoards(roll).then(setBoards).catch(() => { setBoards([]); setLoadError(true); });
  }, [roll]);
  useEffect(load, [load]);
  const ordered = useMemo(() => boards && [...boards.filter(b => !boardBlocker(item, b)), ...boards.filter(b => boardBlocker(item, b))], [boards, item]);
  return (
    <SaveToMoodboardDialog
      title="Add to Moodboard"
      description={item.kind === 'link' ? `“${item.title}” is placed as its cover image, linked back to the page.` : `Choose a board for “${item.title}”.`}
      boards={ordered} loadError={loadError} onRetry={load} pendingBoardId={pending}
      disabledReason={b => (boardBlocker(item, b) ? 'Not available — this asset is Personal to another workspace' : null)}
      onSelect={b => { setPending(b.id); Promise.resolve(onPick(b)).finally(() => setPending(null)); }}
      onClose={onClose}
    />
  );
}
