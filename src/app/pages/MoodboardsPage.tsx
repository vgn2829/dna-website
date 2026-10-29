import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { toast } from 'sonner';
import { api, type Board, type Project } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { favoriteShortcuts } from '../lib/boardShortcuts';
import { workspaceContext } from '../lib/workspaceSearch';
import { ShareBoardDialog } from '../components/ShareBoardDialog';
import { AssetLibrary } from '../components/AssetLibrary';
import { BoardCard, StarIcon } from '../components/BoardCard';
import '../../styles/academy-moodboards.css';
import { useModalA11y } from '../components/hooks/useModalA11y';

// List caches are qualified by workspace here and by student at call sites.
// null retains the all-workspaces selection; the five-minute cache stays
// local to this browser tab and is never reused for another student.
const CACHE_KEY_MY = (workspaceId: string | null) => `dna_boards_mine:${workspaceId ?? 'all'}`;
const CACHE_KEY_SHARED = (workspaceId: string | null) => `dna_boards_shared:${workspaceId ?? 'all'}`;
const CACHE_KEY_ARCHIVED = (workspaceId: string | null) => `dna_boards_archived:${workspaceId ?? 'all'}`;
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // sessionStorage full or unavailable — silent fail
  }
}

// Clears every workspace-scoped board list cache entry, not just one
// workspace's — a board mutation (create/rename/archive/delete/share)
// can affect what ANY workspace's list should show next load (e.g. a
// board moving tabs, or a new board appearing in "All workspaces" too),
// so a full sweep is the only invalidation that's safe by construction.
export function clearBoardsCache(): void {
  const prefixes = ['dna_boards_mine:', 'dna_boards_shared:', 'dna_boards_archived:'];
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key && prefixes.some(p => key.startsWith(p))) sessionStorage.removeItem(key);
  }
}

type Tab = 'mine' | 'shared' | 'archived';
type SortKey = 'newest' | 'oldest' | 'alpha-asc' | 'alpha-desc' | 'edited';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'edited', label: 'Last Edited' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'alpha-asc', label: 'Alphabetical A–Z' },
  { key: 'alpha-desc', label: 'Alphabetical Z–A' },
];

function sortBoards(boards: Board[], sort: SortKey): Board[] {
  const copy = [...boards];
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'oldest':
      return copy.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case 'alpha-asc':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'alpha-desc':
      return copy.sort((a, b) => b.name.localeCompare(a.name));
    case 'edited':
    default:
      return copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

function SkeletonCard() {
  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
      overflow: 'hidden', background: 'var(--color-surface-1)',
    }}>
      <div className="skeleton-pulse" style={{ width: '100%', aspectRatio: '16 / 9', background: 'var(--color-surface-2)' }} />
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton-pulse" style={{ height: 15, width: '70%', borderRadius: 4, background: 'var(--color-surface-2)' }} />
        <div className="skeleton-pulse" style={{ height: 11, width: '45%', borderRadius: 4, background: 'var(--color-surface-2)' }} />
        <div className="skeleton-pulse" style={{ height: 11, width: '55%', borderRadius: 4, background: 'var(--color-surface-2)' }} />
      </div>
    </div>
  );
}

const CARD_GRID_STYLE: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 16,
};

export default function MoodboardsPage() {
  return <MotionConfig reducedMotion="user"><MoodboardsContent /></MotionConfig>;
}

function MoodboardsContent() {
  const navigate = useNavigate();
  const { studentSession, openRollModal } = useStudent();
  // Workspace identity/switching (activeWorkspaceId, the workspaces list,
  // switching) now lives in WorkspaceContext (V2.0 Phase 1/4), shared with
  // the shell's WorkspaceSwitcher — this page no longer owns its own copy.
  // null = "All workspaces" — the exact pre-existing unscoped-across-MY-
  // workspaces behavior (see backend/src/routes/boards.ts's own comment,
  // tightened in Phase 0 to never fall back to a global, cross-tenant
  // result), still the default every session starts at.
  const { activeWorkspaceId, workspaces, personalWorkspace } = useWorkspace();
  const [tab, setTab] = useState<Tab>('mine');
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [myBoards, setMyBoards] = useState<Board[]>([]);
  const [sharedBoards, setSharedBoards] = useState<Board[]>([]);
  const [archivedBoards, setArchivedBoards] = useState<Board[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' as 'private' | 'shared', projectId: '' as string });
  // Projects for the active workspace — fetched only when a concrete
  // workspace is selected (projects have no cross-workspace view, same
  // constraint ProjectsPage/AssetsPage already have) so the create-board
  // form can offer "put this board in a project" without turning this
  // page into project management (V2.2 Phase 7 — kept deliberately
  // lightweight: a picker in the create form + a label on cards, nothing
  // more).
  const [projectOptions, setProjectOptions] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [listErrors, setListErrors] = useState<Partial<Record<Tab, string>>>({});
  const [retryLists, setRetryLists] = useState(0);
  const scope = `${studentSession?.rollNumber ?? 'guest'}:${activeWorkspaceId ?? 'all'}`;
  const [loadedScope, setLoadedScope] = useState('');
  const [archivedScope, setArchivedScope] = useState('');
  const [showCardShare, setShowCardShare] = useState<Board | null>(null);
  const [confirmDeleteBoard, setConfirmDeleteBoard] = useState<Board | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [renameBoard, setRenameBoard] = useState<Board | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('edited');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus trap + Escape-to-close + focus restoration for this page's own
  // modals (Dashboard Polish phase) — same hook ShareBoardDialog already
  // uses, applied here since these three (create/delete/rename) are
  // simple enough to stay inline rather than becoming shared components.
  // initialFocus, not autoFocus on the field: autoFocus runs before the hook
  // records the opener, so focus could not return to it on close.
  const createDialogRef = useModalA11y(showCreate, () => setShowCreate(false), { initialFocus: () => document.getElementById('new-board-name') });
  const deleteDialogRef = useModalA11y(!!confirmDeleteBoard, () => setConfirmDeleteBoard(null));
  const renameDialogRef = useModalA11y(!!renameBoard, () => setRenameBoard(null), { initialFocus: () => renameDialogRef.current?.querySelector<HTMLElement>('input') ?? null });

  useEffect(() => {
    let cancelled = false;
    setListErrors({});
    setLoadedScope(scope);
    const load = (key: Tab, cacheKey: string, fetcher: () => Promise<Board[]>, setBoards: React.Dispatch<React.SetStateAction<Board[]>>, setLoading: React.Dispatch<React.SetStateAction<boolean>>) => {
      const cached = readCache<Board[]>(cacheKey);
      setBoards(cached ?? []);
      setLoading(!cached);
      fetcher().then(data => {
        if (cancelled) return;
        setBoards(data); writeCache(cacheKey, data);
      }).catch(() => {
        if (!cancelled) setListErrors(prev => ({ ...prev, [key]: cached ? 'Could not refresh boards. Showing the last loaded list.' : 'Could not load boards. Please try again.' }));
      }).finally(() => { if (!cancelled) setLoading(false); });
    };
    const roll = studentSession?.rollNumber;
    load('shared', `${CACHE_KEY_SHARED(activeWorkspaceId)}:${roll ?? 'guest'}`, () => api.boards.getShared(roll, activeWorkspaceId ?? undefined), setSharedBoards, setSharedLoading);
    if (roll) load('mine', `${CACHE_KEY_MY(activeWorkspaceId)}:${roll}`, () => api.boards.getMyBoards(roll, activeWorkspaceId ?? undefined), setMyBoards, setMyLoading);
    else { setMyBoards([]); setMyLoading(false); }
    return () => { cancelled = true; };
  }, [scope, retryLists]);

  useEffect(() => {
    setForm(prev => ({ ...prev, projectId: '' }));
    setProjectOptions([]);
  }, [scope]);

  // Project options for the create-board form's picker — only fetchable
  // for a concrete workspace (activeWorkspaceId === null, "All
  // Workspaces", has no single project list to offer; falls back to the
  // personal workspace, same pattern the Assets button already uses).
  // Not fetched at all until the create modal is actually opened, so
  // visiting Moodboards never triggers a projects request a user might
  // never need.
  useEffect(() => {
    if (!showCreate || !studentSession?.rollNumber) return;
    const workspaceId = activeWorkspaceId ?? personalWorkspace?.id;
    if (!workspaceId) { setProjectOptions([]); return; }
    let cancelled = false;
    api.projects.list(studentSession.rollNumber, workspaceId)
      .then(list => { if (!cancelled) setProjectOptions(list.filter(p => !p.is_archived)); })
      .catch(() => { if (!cancelled) setProjectOptions([]); });
    return () => { cancelled = true; };
  }, [showCreate, studentSession?.rollNumber, activeWorkspaceId, personalWorkspace?.id]);

  // Archived boards load only while the Archived collection is open.
  useEffect(() => {
    if (tab !== 'archived' || !studentSession?.rollNumber) return;
    let cancelled = false;
    setListErrors(prev => ({ ...prev, archived: undefined }));
    const cacheKey = `${CACHE_KEY_ARCHIVED(activeWorkspaceId)}:${studentSession.rollNumber}`;
    const cached = readCache<Board[]>(cacheKey);
    setArchivedBoards(cached ?? []);
    setArchivedScope(scope);
    setArchivedLoading(!cached);
    api.boards.getArchived(studentSession.rollNumber, activeWorkspaceId ?? undefined)
      .then(data => { if (!cancelled) { setArchivedBoards(data); writeCache(cacheKey, data); } })
      .catch(() => { if (!cancelled) setListErrors(prev => ({ ...prev, archived: 'Could not load archived boards. Please try again.' })); })
      .finally(() => { if (!cancelled) setArchivedLoading(false); });
    return () => { cancelled = true; };
  }, [tab, scope, retryLists]);

  // Keyboard shortcuts: "/" focuses search (unless already typing somewhere),
  // Escape clears search and closes any open card menu.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      );
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (isTyping && search) setSearch('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [search]);

  const handleCreate = async () => {
    if (!studentSession?.rollNumber || !form.name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const board = await api.boards.create(studentSession.rollNumber, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        visibility: form.visibility,
        // Lands in the active workspace filter if one is selected,
        // otherwise falls back server-side to the caller's personal
        // workspace (see api.ts's own comment on this being optional).
        workspace_id: activeWorkspaceId ?? undefined,
        // V2.2 Projects layer — optional, ungrouped (undefined) by
        // default, exactly the pre-Phase-7 behavior when no project is
        // picked in the form below.
        project_id: form.projectId || undefined,
      });
      setMyBoards(prev => [board, ...prev]);
      if (form.visibility === 'shared') setSharedBoards(prev => [board, ...prev]);
      clearBoardsCache();
      setShowCreate(false);
      setForm({ name: '', description: '', visibility: 'private', projectId: '' });
      toast.success('Board created');
      navigate(`/moodboards/${board.id}`);
    } catch {
      setError('Failed to create board');
      toast.error('Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const handleCardDelete = async (board: Board) => {
    if (!studentSession?.rollNumber) return;
    setDeleting(true);
    try {
      await api.boards.delete(board.id, studentSession.rollNumber);
      setMyBoards(prev => prev.filter(b => b.id !== board.id));
      setArchivedBoards(prev => prev.filter(b => b.id !== board.id));
      setSharedBoards(prev => prev.filter(b => b.id !== board.id));
      clearBoardsCache();
      setConfirmDeleteBoard(null);
      toast.success('Board deleted');
    } catch {
      toast.error('Failed to delete board');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleFavorite = async (board: Board) => {
    if (!studentSession?.rollNumber) return;
    const nextFavorite = !board.is_favorite;
    const patch = (list: Board[]) => list.map(b => b.id === board.id ? { ...b, is_favorite: nextFavorite } : b);
    // Optimistic — favoriting is low-stakes and should feel instant; revert on failure.
    setMyBoards(patch);
    setSharedBoards(patch);
    setArchivedBoards(patch);
    setFavoriteBusyId(board.id);
    try {
      if (nextFavorite) await api.boards.favorite(board.id, studentSession.rollNumber);
      else await api.boards.unfavorite(board.id, studentSession.rollNumber);
      clearBoardsCache();
    } catch {
      const revert = (list: Board[]) => list.map(b => b.id === board.id ? { ...b, is_favorite: board.is_favorite } : b);
      setMyBoards(revert);
      setSharedBoards(revert);
      setArchivedBoards(revert);
      toast.error('Failed to update favorite');
    } finally {
      setFavoriteBusyId(null);
    }
  };

  const handleArchive = async (board: Board, archived: boolean) => {
    if (!studentSession?.rollNumber) return;
    setArchivingId(board.id);
    try {
      const updated = await api.boards.update(board.id, studentSession.rollNumber, { is_archived: archived });
      if (archived) {
        setSharedBoards(prev => prev.filter(b => b.id !== board.id));
        setMyBoards(prev => prev.filter(b => b.id !== board.id));
        setArchivedBoards(prev => [updated, ...prev.filter(b => b.id !== board.id)]);
      } else {
        setArchivedBoards(prev => prev.filter(b => b.id !== board.id));
        setMyBoards(prev => [updated, ...prev.filter(b => b.id !== board.id)]);
        if (updated.visibility === 'shared') setSharedBoards(prev => [updated, ...prev.filter(b => b.id !== board.id)]);
      }
      clearBoardsCache();
      toast.success(archived ? 'Board archived' : 'Board restored');
    } catch {
      toast.error(archived ? 'Failed to archive board' : 'Failed to restore board');
    } finally {
      setArchivingId(null);
    }
  };

  const handleDuplicate = async (board: Board) => {
    if (!studentSession?.rollNumber) return;
    setDuplicatingId(board.id);
    try {
      const copy = await api.boards.duplicate(board.id, studentSession.rollNumber);
      setMyBoards(prev => [copy, ...prev]);
      clearBoardsCache();
      toast.success('Board duplicated');
    } catch {
      toast.error('Failed to duplicate board');
    } finally {
      setDuplicatingId(null);
    }
  };

  const openRename = (board: Board) => {
    setRenameBoard(board);
    setRenameValue(board.name);
  };

  const handleRenameSubmit = async () => {
    if (!renameBoard || !studentSession?.rollNumber || !renameValue.trim()) return;
    const trimmed = renameValue.trim();
    if (trimmed === renameBoard.name) { setRenameBoard(null); return; }
    setRenaming(true);
    try {
      const updated = await api.boards.update(renameBoard.id, studentSession.rollNumber, { name: trimmed });
      const patch = (list: Board[]) => list.map(b => b.id === updated.id ? updated : b);
      setMyBoards(patch);
      setSharedBoards(patch);
      setArchivedBoards(patch);
      clearBoardsCache();
      setRenameBoard(null);
      toast.success('Board renamed');
    } catch {
      toast.error('Failed to rename board');
    } finally {
      setRenaming(false);
    }
  };

  const boardMenuItems = (board: Board) => [
    { label: 'Rename', opensDialog: true, onSelect: () => openRename(board) },
    { label: 'Duplicate', onSelect: () => handleDuplicate(board), disabled: duplicatingId === board.id },
    { label: 'Share & Invite', opensDialog: true, onSelect: () => setShowCardShare(board) },
    { label: board.is_archived ? 'Restore' : 'Archive', onSelect: () => handleArchive(board, !board.is_archived), disabled: archivingId === board.id },
    { label: 'Delete Board', danger: true, opensDialog: true, onSelect: () => setConfirmDeleteBoard(board) },
  ];

  const activeBoards = tab === 'mine' ? myBoards : tab === 'shared' ? sharedBoards : archivedBoards;
  const activeLoading = loadedScope !== scope || (tab === 'archived' && archivedScope !== scope) || (tab === 'mine' ? myLoading : tab === 'shared' ? sharedLoading : archivedLoading);
  const collectionLabel = tab === 'mine' ? 'My Boards' : tab === 'shared' ? 'Shared Boards' : 'Archived';
  const activeWorkspace = activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) ?? null : null;
  const activeWorkspaceLabel = activeWorkspace ? (activeWorkspace.is_personal ? 'Personal' : activeWorkspace.name) : null;

  // The Assets button needs a concrete workspace even in "All Workspaces"
  // view (activeWorkspaceId === null) — assets are always workspace-scoped,
  // there's no cross-workspace asset list. Falls back to the caller's
  // personal workspace (from WorkspaceContext, auto-provisioned server-side
  // — see ensurePersonalWorkspace) rather than hiding the button entirely,
  // which is what it did before this fallback existed: a user with only
  // their personal workspace had NO way to ever set activeWorkspaceId away
  // from null, making Assets permanently unreachable — the "Asset Library
  // cannot be found in the UI" bug this fallback fixes.
  const assetsWorkspaceId = activeWorkspaceId ?? personalWorkspace?.id ?? null;
  const assetsWorkspaceName = personalWorkspace ? (personalWorkspace.is_personal ? 'Personal' : personalWorkspace.name) : null;

  const filteredSortedBoards = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? activeBoards.filter(b =>
          b.name.toLowerCase().includes(q) ||
          (b.owner_name?.toLowerCase().includes(q) ?? false) ||
          (b.description?.toLowerCase().includes(q) ?? false)
        )
      : activeBoards;
    return sortBoards(filtered, sort);
  }, [activeBoards, search, sort]);

  const favoriteBoards = useMemo(
    () => favoriteShortcuts(myBoards, sharedBoards),
    [myBoards, sharedBoards]
  );

  const recentBoards = useMemo(
    () => sortBoards(myBoards, 'edited').slice(0, 6),
    [myBoards]
  );

  const showShortcuts = !activeLoading && !listErrors[tab] && tab !== 'archived' && !search.trim();
  const showRecentRail = showShortcuts && tab === 'mine' && recentBoards.length > 0;

  return (
    <div className="moodboards-page">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 'var(--space-xl)' }}>
        <p className="type-caption" style={{ marginBottom: 8 }}>
          {workspaceContext(activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) ?? null : null, { spansAllWorkspaces: true }).label}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="type-display-md" style={{ margin: 0 }}>Moodboards</h1>
          {studentSession ? (
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + New Board
            </button>
          ) : (
            <button onClick={openRollModal} className="btn-secondary">
              Sign in to create boards
            </button>
          )}
        </div>
      </motion.div>

      {/* Workspace switching/management now lives in the shell's sidebar
          (WorkspaceSwitcher.tsx, V2.0 Phase 2/4) via WorkspaceContext —
          this page no longer renders its own switcher pill row or
          WorkspacesPanel/WorkspaceSettingsModal. The Assets quick-action
          stays here as a convenience for jumping into the library without
          leaving the Moodboards list (AssetsPage.tsx, Phase 5, is the
          first-class home for browsing/managing assets). */}
      {studentSession && assetsWorkspaceId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowAssetLibrary(true)}
            className="btn-secondary btn-sm touch-target"
          >
            Assets
          </button>
        </div>
      )}

      {showAssetLibrary && assetsWorkspaceId && studentSession?.rollNumber && (
        <AssetLibrary
          workspaceId={assetsWorkspaceId}
          workspaceName={activeWorkspaceLabel ?? assetsWorkspaceName ?? 'Workspace'}
          roll={studentSession.rollNumber}
          onClose={() => setShowAssetLibrary(false)}
        />
      )}

      {/* Tabs + search + sort */}
      <div className="moodboards-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--color-border)', marginBottom: 32, flexWrap: 'wrap' }}>
        <div className="segmented" style={{ marginBottom: 10 }}>
          {([['mine', 'My Boards'], ['shared', 'Shared Boards'], ...(studentSession ? [['archived', 'Archived']] : [])] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className="segmented-item touch-target"
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, flexWrap: 'wrap' }}>
          <div className="search-field" style={{ flex: '1 1 auto' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              className="input-base"
              type="text"
              placeholder={`Search ${collectionLabel.toLowerCase()}…`}
              aria-label={`Search ${collectionLabel}`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', minWidth: 0 }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                title="Clear search (Esc)"
                aria-label="Clear search"
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  width: 18, height: 18, borderRadius: '50%', border: 'none',
                  background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)',
                  fontSize: 11, lineHeight: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ×
              </button>
            )}
          </div>

          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="input-base"
            aria-label="Sort boards"
            style={{ fontSize: 13, padding: '8px 10px', cursor: 'pointer' }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="type-caption" role="status">{collectionLabel} · {activeWorkspaceLabel ?? 'All your workspaces'}{!activeLoading && !listErrors[tab] ? ` · ${filteredSortedBoards.length} boards` : ''}. Search and sort apply to this collection.</p>
      {showShortcuts && (favoriteBoards.length > 0 || showRecentRail) && <p className="type-caption">Favorites and Recent are shortcuts to boards in the collections below.</p>}
      {/* Content */}
      {tab === 'mine' && !studentSession ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
          <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 20 }}>
            Link your roll number to create and manage your boards.
          </p>
          <button
            onClick={openRollModal}
            className="btn-primary"
          >
            Enter Roll Number
          </button>
        </motion.div>
      ) : (
        <>
          {/* Favorites rail */}
          {favoriteBoards.length > 0 && showShortcuts && (
            <div style={{ marginBottom: 'var(--space-xxl)' }}>
              <h2 className="type-headline" style={{ margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#ffd54a' }}><StarIcon filled /></span> Favorites
              </h2>
              <div className="moodboards-card-grid" style={CARD_GRID_STYLE}>
                {favoriteBoards.map(board => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    onClick={() => navigate(`/moodboards/${board.id}`)}
                    menuItems={board.owner_roll === studentSession?.rollNumber ? boardMenuItems(board) : undefined}
                    onToggleFavorite={handleToggleFavorite}
                    favoriteBusy={favoriteBusyId === board.id}
                    ownerRoll={studentSession?.rollNumber}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recent rail */}
          {showRecentRail && (
            <div style={{ marginBottom: 'var(--space-xxl)' }}>
              <h2 className="type-headline" style={{ margin: '0 0 14px' }}>
                Recent
              </h2>
              <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 4 }}>
                {recentBoards.map(board => (
                  <div key={board.id} style={{ minWidth: 240, maxWidth: 240, flexShrink: 0 }}>
                    <BoardCard
                      board={board}
                      onClick={() => navigate(`/moodboards/${board.id}`)}
                      menuItems={boardMenuItems(board)}
                      onToggleFavorite={handleToggleFavorite}
                      favoriteBusy={favoriteBusyId === board.id}
                      ownerRoll={studentSession?.rollNumber}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="type-headline" style={{ margin: '0 0 14px' }}>
            {collectionLabel}
          </h2>

          {listErrors[tab] && <div className="card p-5" role="alert"><p className="type-body-sm">{listErrors[tab]}</p><button className="btn-secondary" onClick={() => setRetryLists(n => n + 1)}>Retry loading boards</button></div>}
          {activeLoading ? (
            <div className="moodboards-card-grid" style={CARD_GRID_STYLE}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : listErrors[tab] && activeBoards.length === 0 ? null : filteredSortedBoards.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
              <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 20 }}>
                {search.trim()
                  ? `No boards match "${search.trim()}".`
                  : tab === 'mine'
                  ? activeWorkspaceLabel ? `No boards in ${activeWorkspaceLabel} yet. Create one to start collecting inspiration.` : 'No boards yet. Create one to start collecting inspiration.'
                  : tab === 'shared'
                  ? activeWorkspaceLabel ? `No shared boards in ${activeWorkspaceLabel} yet.` : 'No shared boards yet.'
                  : activeWorkspaceLabel ? `No archived boards in ${activeWorkspaceLabel}.` : 'No archived boards.'}
              </p>
              {tab === 'mine' && !search.trim() && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="btn-primary"
                >
                  + New Board
                </button>
              )}
            </motion.div>
          ) : (
            <div className="moodboards-card-grid" style={CARD_GRID_STYLE}>
              {filteredSortedBoards.map((board, i) => (
                <motion.div key={board.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                  <BoardCard
                    board={board}
                    onClick={() => navigate(`/moodboards/${board.id}`)}
                    menuItems={tab !== 'shared' && board.owner_roll === studentSession?.rollNumber ? boardMenuItems(board) : undefined}
                    onToggleFavorite={handleToggleFavorite}
                    favoriteBusy={favoriteBusyId === board.id}
                    ownerRoll={studentSession?.rollNumber}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create board modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              ref={createDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="New Moodboard"
              tabIndex={-1}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl) var(--space-lg)', boxShadow: 'var(--shadow-level-2)', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 className="type-headline" style={{ margin: 0 }}>
                New Moodboard
              </h3>
              <p className="type-caption">Destination: {activeWorkspaceLabel ?? assetsWorkspaceName ?? 'Personal workspace'}. {form.projectId ? 'Board will be added to the selected project.' : 'No project selected.'}</p>

              {([
                { label: 'Board Name', key: 'name', placeholder: 'e.g. Typography Inspo' },
                { label: 'Description (optional)', key: 'description', placeholder: 'What is this board about?' },
              ] as const).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label htmlFor={`new-board-${key}`} className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
                    {label}
                  </label>
                  <input
                    id={`new-board-${key}`}
                    className="input-base"
                    type="text"
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              ))}

              <div>
                <p className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
                  Visibility
                </p>
                <div className="segmented is-block" role="group" aria-label="Visibility">
                  {(['private', 'shared'] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, visibility: v }))}
                      aria-pressed={form.visibility === v}
                      className="segmented-item"
                    >
                      {v === 'private' ? 'Private' : 'Shared'}
                    </button>
                  ))}
                </div>
                <p className="type-micro" style={{ margin: '6px 0 0' }}>
                  {form.visibility === 'private' ? 'Only you and collaborators can see this board.' : 'Anyone with the link can view this board.'}
                </p>
              </div>

              {projectOptions.length > 0 && (
                <div>
                  <label htmlFor="new-board-project" className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
                    Project (optional)
                  </label>
                  <select
                    id="new-board-project"
                    className="input-base"
                    value={form.projectId}
                    onChange={e => setForm(prev => ({ ...prev, projectId: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  >
                    <option value="">No project — ungrouped</option>
                    {projectOptions.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {error && <p className="type-micro" style={{ margin: 0, color: 'var(--color-error)' }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleCreate}
                  disabled={creating || !form.name.trim()}
                  className="btn-primary" style={{ flex: 1 }}
                >
                  {creating ? 'Creating...' : 'Create Board'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="btn-translucent" style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showCardShare && studentSession?.rollNumber && (
        <ShareBoardDialog
          boardId={showCardShare.id}
          roll={studentSession.rollNumber}
          onClose={() => setShowCardShare(null)}
          onUpdated={(boardId, patch) => {
            const apply = (list: Board[]) => list.map(b => b.id === boardId ? { ...b, ...patch } : b);
            setMyBoards(apply);
            setSharedBoards(apply);
            setArchivedBoards(apply);
            clearBoardsCache();
          }}
        />
      )}

      {/* Delete confirm modal */}
      <AnimatePresence>
        {confirmDeleteBoard && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setConfirmDeleteBoard(null)}
          >
            <motion.div
              ref={deleteDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Delete "${confirmDeleteBoard.name}"?`}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 360, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl) var(--space-lg)', boxShadow: 'var(--shadow-level-2)', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 className="type-headline" style={{ margin: 0 }}>
                Delete "{confirmDeleteBoard.name}"?
              </h3>
              <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
                This will permanently delete the board and all its contents. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleCardDelete(confirmDeleteBoard)}
                  disabled={deleting}
                  className="btn-primary btn-danger" style={{ flex: 1 }}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDeleteBoard(null)}
                  className="btn-translucent" style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename modal */}
      <AnimatePresence>
        {renameBoard && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setRenameBoard(null)}
          >
            <motion.div
              ref={renameDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Rename Board"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 360, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl) var(--space-lg)', boxShadow: 'var(--shadow-level-2)', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 className="type-headline" style={{ margin: 0 }}>
                Rename Board
              </h3>
              <input
                className="input-base"
                type="text"
                aria-label="Board name"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); }}
                style={{ width: '100%', boxSizing: 'border-box' }}
                maxLength={100}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleRenameSubmit}
                  disabled={renaming || !renameValue.trim()}
                  className="btn-primary" style={{ flex: 1 }}
                >
                  {renaming ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setRenameBoard(null)}
                  className="btn-translucent" style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
