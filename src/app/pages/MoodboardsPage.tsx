import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { api, type Board, type Workspace } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { WorkspacesPanel } from '../components/WorkspacesPanel';
import { WorkspaceSettingsModal } from '../components/WorkspaceSettingsModal';
import { ShareBoardDialog } from '../components/ShareBoardDialog';
import { useModalA11y } from '../components/hooks/useModalA11y';

// Cache keys are workspace-qualified (workspace/organization layer):
// `null` (the "All workspaces" default — see activeWorkspaceId below)
// resolves to the same ':all' suffix every existing session already used
// before workspaces existed, so a user who never touches the switcher
// sees byte-identical caching behavior to before this feature shipped.
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 2}>
      <path d="M12 2.5l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.7 7.1-.6z" strokeLinejoin="round" />
    </svg>
  );
}

function BoardCard({ board, onClick, onMenuOpen, onToggleFavorite, ownerRoll, favoriteBusy }: {
  board: Board;
  onClick: () => void;
  onMenuOpen?: (e: React.MouseEvent, board: Board) => void;
  onToggleFavorite?: (board: Board) => void;
  ownerRoll?: string | null;
  favoriteBusy?: boolean;
}) {
  const isOwner = ownerRoll === board.owner_roll;

  return (
    <div
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Open board ${board.name}`}
      className="board-card"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        cursor: 'pointer',
        transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-surface-2)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--color-surface-1)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Cover placeholder — real thumbnails are a follow-up phase */}
      <div style={{
        width: '100%',
        aspectRatio: '16 / 9',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        overflow: 'hidden',
        background: 'var(--color-surface-2)',
      }}>
        {[0.04, 0.06, 0.08, 0.10].map((alpha, i) => (
          <div key={i} style={{ background: `rgba(233,30,140,${alpha})` }} />
        ))}

        {onToggleFavorite && (
          <button
            onClick={e => { e.stopPropagation(); onToggleFavorite(board); }}
            disabled={favoriteBusy}
            title={board.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={board.is_favorite ? `Remove ${board.name} from favorites` : `Add ${board.name} to favorites`}
            aria-pressed={board.is_favorite}
            className="board-card-star"
            data-favorite={board.is_favorite}
            style={{
              position: 'absolute',
              top: 8, left: 8,
              width: 28, height: 28,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: board.is_favorite ? '#ffd54a' : '#fff',
              cursor: favoriteBusy ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
              opacity: board.is_favorite ? 1 : undefined,
            }}
          >
            <StarIcon filled={board.is_favorite} />
          </button>
        )}

        {onMenuOpen && isOwner && (
          <button
            onClick={e => { e.stopPropagation(); onMenuOpen(e, board); }}
            aria-label={`More options for ${board.name}`}
            aria-haspopup="menu"
            style={{
              position: 'absolute',
              top: 8, right: 8,
              width: 28, height: 28,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              zIndex: 2,
            }}
          >
            ⋮
          </button>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 600,
            color: 'var(--color-ink)', fontFamily: 'var(--font-body)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
          }}>
            {board.name}
          </h3>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 'var(--radius-pill)', flexShrink: 0, fontFamily: 'var(--font-body)',
            background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(128,128,128,0.1)',
            color: board.visibility === 'shared' ? 'var(--color-brand)' : 'var(--color-ink-muted)',
          }}>
            {board.visibility}
          </span>
        </div>
        {board.owner_name && (
          <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            by {board.owner_name}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          {board.item_count} item{board.item_count !== 1 ? 's' : ''}
          {board.member_count > 0 ? ` · ${board.member_count + 1} members` : ''}
          {' · '}edited {timeAgo(board.updated_at)}
        </p>
      </div>
    </div>
  );
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
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
};

export default function MoodboardsPage() {
  const navigate = useNavigate();
  const { studentSession, openRollModal } = useStudent();
  const [tab, setTab] = useState<Tab>('mine');
  // null = "All workspaces" — the exact pre-existing unscoped behavior,
  // and the default every session starts at, so a user who never opens
  // the switcher sees no change at all. Set to a specific workspace id
  // to narrow every list below to just that workspace.
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showWorkspacesPanel, setShowWorkspacesPanel] = useState(false);
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
  const [myBoards, setMyBoards] = useState<Board[]>([]);
  const [sharedBoards, setSharedBoards] = useState<Board[]>([]);
  const [archivedBoards, setArchivedBoards] = useState<Board[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' as 'private' | 'shared' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [menuBoard, setMenuBoard] = useState<Board | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
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
  const createDialogRef = useModalA11y(showCreate, () => setShowCreate(false));
  const deleteDialogRef = useModalA11y(!!confirmDeleteBoard, () => setConfirmDeleteBoard(null));
  const renameDialogRef = useModalA11y(!!renameBoard, () => setRenameBoard(null));

  // Workspace list — fetched once per session (not workspace-scoped
  // itself, obviously), independent of the board-list effects below. Also
  // lazily auto-provisions the caller's personal workspace server-side
  // (see routes/workspaces.ts's GET /), so this always resolves to at
  // least one entry for a signed-in student.
  useEffect(() => {
    if (!studentSession?.rollNumber) { setWorkspaces([]); return; }
    api.workspaces.list(studentSession.rollNumber)
      .then(setWorkspaces)
      .catch(() => {});
  }, [studentSession?.rollNumber]);

  useEffect(() => {
    const cacheKey = CACHE_KEY_SHARED(activeWorkspaceId);
    const cached = readCache<Board[]>(cacheKey);
    if (cached) {
      setSharedBoards(cached);
      setSharedLoading(false);
      // Still re-fetch in background to stay fresh
      api.boards.getShared(studentSession?.rollNumber, activeWorkspaceId ?? undefined)
        .then(data => { setSharedBoards(data); writeCache(cacheKey, data); })
        .catch(() => {});
      return;
    }
    setSharedLoading(true);
    api.boards.getShared(studentSession?.rollNumber, activeWorkspaceId ?? undefined)
      .then(data => { setSharedBoards(data); writeCache(cacheKey, data); })
      .catch(() => {})
      .finally(() => setSharedLoading(false));
  }, [studentSession?.rollNumber, activeWorkspaceId]);

  useEffect(() => {
    if (!studentSession?.rollNumber) return;
    const cacheKey = CACHE_KEY_MY(activeWorkspaceId);
    const cached = readCache<Board[]>(cacheKey);
    if (cached) {
      setMyBoards(cached);
      setMyLoading(false);
      // Still re-fetch in background to stay fresh
      api.boards.getMyBoards(studentSession.rollNumber, activeWorkspaceId ?? undefined)
        .then(data => { setMyBoards(data); writeCache(cacheKey, data); })
        .catch(() => {});
      return;
    }
    setMyLoading(true);
    api.boards.getMyBoards(studentSession.rollNumber, activeWorkspaceId ?? undefined)
      .then(data => { setMyBoards(data); writeCache(cacheKey, data); })
      .catch(() => {})
      .finally(() => setMyLoading(false));
  }, [studentSession?.rollNumber, activeWorkspaceId]);

  // Archived boards are fetched lazily — only once the user actually opens
  // that tab — since most sessions never look at it. archivedLoaded is
  // reset whenever activeWorkspaceId changes (see the switcher's onClick
  // below) so switching workspaces while already on the Archived tab
  // triggers a fresh scoped fetch instead of reusing a different
  // workspace's already-loaded list.
  useEffect(() => {
    if (tab !== 'archived' || !studentSession?.rollNumber || archivedLoaded) return;
    const cacheKey = CACHE_KEY_ARCHIVED(activeWorkspaceId);
    const cached = readCache<Board[]>(cacheKey);
    if (cached) {
      setArchivedBoards(cached);
      setArchivedLoaded(true);
      api.boards.getArchived(studentSession.rollNumber, activeWorkspaceId ?? undefined)
        .then(data => { setArchivedBoards(data); writeCache(cacheKey, data); })
        .catch(() => {});
      return;
    }
    setArchivedLoading(true);
    api.boards.getArchived(studentSession.rollNumber, activeWorkspaceId ?? undefined)
      .then(data => { setArchivedBoards(data); writeCache(cacheKey, data); setArchivedLoaded(true); })
      .catch(() => {})
      .finally(() => setArchivedLoading(false));
  }, [tab, studentSession?.rollNumber, archivedLoaded, activeWorkspaceId]);

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
        if (menuBoard) setMenuBoard(null);
        else if (isTyping && search) setSearch('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuBoard, search]);

  // Switching workspaces resets archivedLoaded so the Archived tab's
  // lazy-load-once effect (see above) re-fetches for the new workspace
  // instead of silently keeping whatever was already loaded for the
  // previous one.
  const handleWorkspaceSwitch = (workspaceId: string | null) => {
    setActiveWorkspaceId(workspaceId);
    setArchivedLoaded(false);
  };

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
      });
      setMyBoards(prev => [board, ...prev]);
      if (form.visibility === 'shared') setSharedBoards(prev => [board, ...prev]);
      clearBoardsCache();
      setShowCreate(false);
      setForm({ name: '', description: '', visibility: 'private' });
      toast.success('Board created');
      navigate(`/moodboards/${board.id}`);
    } catch {
      setError('Failed to create board');
      toast.error('Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const handleCardMenuOpen = (e: React.MouseEvent, board: Board) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
    setMenuBoard(board);
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
        setMyBoards(prev => prev.filter(b => b.id !== board.id));
        setArchivedBoards(prev => [updated, ...prev.filter(b => b.id !== board.id)]);
      } else {
        setArchivedBoards(prev => prev.filter(b => b.id !== board.id));
        setMyBoards(prev => [updated, ...prev.filter(b => b.id !== board.id)]);
      }
      clearBoardsCache();
      setMenuBoard(null);
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
      setMenuBoard(null);
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
    setMenuBoard(null);
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

  const activeBoards = tab === 'mine' ? myBoards : tab === 'shared' ? sharedBoards : archivedBoards;
  const activeLoading = tab === 'mine' ? myLoading : tab === 'shared' ? sharedLoading : archivedLoading;
  const activeWorkspace = activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) ?? null : null;
  const activeWorkspaceLabel = activeWorkspace ? (activeWorkspace.is_personal ? 'Personal' : activeWorkspace.name) : null;

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
    () => sortBoards([...myBoards, ...sharedBoards].filter(b => b.is_favorite), 'edited'),
    [myBoards, sharedBoards]
  );

  const recentBoards = useMemo(
    () => sortBoards(myBoards, 'edited').slice(0, 6),
    [myBoards]
  );

  const showRecentRail = tab === 'mine' && !search.trim() && recentBoards.length > 0;

  return (
    <div className="page-container" style={{ paddingTop: 80, paddingBottom: 80, minHeight: '100vh' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-muted)', letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', marginBottom: 12 }}>
          Creative Workspace
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(40px,6vw,85px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-4.25px', color: 'var(--color-ink)' }}>
            Mood<br /><span style={{ color: 'var(--color-ink-muted)' }}>boards</span>
          </h1>
          {studentSession ? (
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '10px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              + New Board
            </button>
          ) : (
            <button
              onClick={openRollModal}
              style={{ padding: '10px 20px', background: 'var(--color-surface-1)', color: 'var(--color-ink)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              Sign in to create boards
            </button>
          )}
        </div>
      </motion.div>

      {/* Workspace switcher — the pill row is only shown once there's more
          than the personal workspace to switch between, so a user who has
          never created/joined a real workspace sees no change to this
          page at all. "All" (activeWorkspaceId = null) is always first
          and is the default on load, preserving the exact pre-existing
          unscoped behavior for every list below. The "Manage" affordance
          is shown whenever signed in (even with just the personal
          workspace) since it's also the discovery path for CREATING a
          first real workspace. */}
      {studentSession && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {workspaces.length > 1 && (
            <>
              <button
                onClick={() => handleWorkspaceSwitch(null)}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-pill)',
                  border: `1px solid ${activeWorkspaceId === null ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  background: activeWorkspaceId === null ? 'var(--color-brand)' : 'none',
                  color: activeWorkspaceId === null ? '#fff' : 'var(--color-ink-muted)',
                  fontSize: 13, fontWeight: activeWorkspaceId === null ? 600 : 400,
                  fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                All Workspaces
              </button>
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => handleWorkspaceSwitch(ws.id)}
                  style={{
                    padding: '6px 14px', borderRadius: 'var(--radius-pill)',
                    border: `1px solid ${activeWorkspaceId === ws.id ? 'var(--color-brand)' : 'var(--color-border)'}`,
                    background: activeWorkspaceId === ws.id ? 'var(--color-brand)' : 'none',
                    color: activeWorkspaceId === ws.id ? '#fff' : 'var(--color-ink-muted)',
                    fontSize: 13, fontWeight: activeWorkspaceId === ws.id ? 600 : 400,
                    fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {ws.is_personal ? 'Personal' : ws.name}
                </button>
              ))}
            </>
          )}
          <button
            onClick={() => setShowWorkspacesPanel(true)}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--color-border)', background: 'none',
              color: 'var(--color-ink-muted)', fontSize: 13,
              fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Manage Workspaces
          </button>
        </div>
      )}

      <WorkspacesPanel
        open={showWorkspacesPanel}
        onClose={() => setShowWorkspacesPanel(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        roll={studentSession?.rollNumber ?? ''}
        onSwitch={workspaceId => { handleWorkspaceSwitch(workspaceId); setShowWorkspacesPanel(false); }}
        onOpenSettings={workspaceId => setSettingsWorkspaceId(workspaceId)}
        onWorkspaceCreated={workspace => setWorkspaces(prev => [...prev, workspace])}
      />

      {settingsWorkspaceId && studentSession && (
        <WorkspaceSettingsModal
          workspaceId={settingsWorkspaceId}
          roll={studentSession.rollNumber}
          onClose={() => setSettingsWorkspaceId(null)}
          onRenamed={(workspaceId, name) => setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, name } : w))}
          onDeleted={workspaceId => {
            setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
            if (activeWorkspaceId === workspaceId) handleWorkspaceSwitch(null);
            setSettingsWorkspaceId(null);
          }}
          onLeft={workspaceId => {
            setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
            if (activeWorkspaceId === workspaceId) handleWorkspaceSwitch(null);
            setSettingsWorkspaceId(null);
          }}
        />
      )}

      {/* Tabs + search + sort */}
      <div className="moodboards-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--color-border)', marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex' }}>
          {([['mine', 'My Boards'], ['shared', 'Shared Boards'], ...(studentSession ? [['archived', 'Archived']] : [])] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              style={{
                padding: '10px 16px',
                background: 'none',
                border: 'none',
                borderBottom: tab === key ? '2px solid var(--color-brand)' : '2px solid transparent',
                marginBottom: -1,
                color: tab === key ? 'var(--color-brand)' : 'var(--color-ink-muted)',
                fontSize: 14,
                fontWeight: tab === key ? 600 : 400,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 auto' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              className="input-base"
              type="text"
              placeholder="Search boards…"
              aria-label="Search boards"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200, paddingLeft: 30, fontSize: 13 }}
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

      {/* Content */}
      {tab === 'mine' && !studentSession ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 15, marginBottom: 20 }}>
            Link your roll number to create and manage your boards.
          </p>
          <button
            onClick={openRollModal}
            style={{ padding: '12px 24px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
          >
            Enter Roll Number
          </button>
        </motion.div>
      ) : (
        <>
          {/* Favorites rail */}
          {favoriteBoards.length > 0 && !search.trim() && (
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#ffd54a' }}><StarIcon filled /></span> Favorites
              </h2>
              <div className="moodboards-card-grid" style={CARD_GRID_STYLE}>
                {favoriteBoards.map(board => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    onClick={() => navigate(`/moodboards/${board.id}`)}
                    onMenuOpen={board.owner_roll === studentSession?.rollNumber ? handleCardMenuOpen : undefined}
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
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                Recent
              </h2>
              <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 4 }}>
                {recentBoards.map(board => (
                  <div key={board.id} style={{ minWidth: 240, maxWidth: 240, flexShrink: 0 }}>
                    <BoardCard
                      board={board}
                      onClick={() => navigate(`/moodboards/${board.id}`)}
                      onMenuOpen={handleCardMenuOpen}
                      onToggleFavorite={handleToggleFavorite}
                      favoriteBusy={favoriteBusyId === board.id}
                      ownerRoll={studentSession?.rollNumber}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(showRecentRail || (favoriteBoards.length > 0 && !search.trim())) && (
            <h2 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
              {tab === 'mine' ? 'All Boards' : tab === 'shared' ? 'Shared Boards' : 'Archived'}
            </h2>
          )}

          {activeLoading ? (
            <div className="moodboards-card-grid" style={CARD_GRID_STYLE}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : filteredSortedBoards.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
              <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 15, marginBottom: 20 }}>
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
                  style={{ padding: '12px 24px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
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
                    onMenuOpen={tab !== 'shared' && board.owner_roll === studentSession?.rollNumber ? handleCardMenuOpen : undefined}
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
              style={{ width: '100%', maxWidth: 440, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                New Moodboard
              </h3>

              {([
                { label: 'Board Name', key: 'name', placeholder: 'e.g. Typography Inspo' },
                { label: 'Description (optional)', key: 'description', placeholder: 'What is this board about?' },
              ] as const).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                    {label}
                  </label>
                  <input
                    className="input-base"
                    type="text"
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    autoFocus={key === 'name'}
                  />
                </div>
              ))}

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                  Visibility
                </label>
                <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  {(['private', 'shared'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setForm(prev => ({ ...prev, visibility: v }))}
                      style={{
                        flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer',
                        background: form.visibility === v ? 'rgba(233,30,140,0.1)' : 'none',
                        color: form.visibility === v ? 'var(--color-brand)' : 'var(--color-ink-muted)',
                        fontSize: 13, fontWeight: form.visibility === v ? 600 : 400, fontFamily: 'var(--font-body)',
                      }}
                    >
                      {v === 'private' ? 'Private' : 'Shared'}
                    </button>
                  ))}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  {form.visibility === 'private' ? 'Only you and collaborators can see this board.' : 'Anyone with the link can view this board.'}
                </p>
              </div>

              {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleCreate}
                  disabled={creating || !form.name.trim()}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: creating || !form.name.trim() ? 'not-allowed' : 'pointer', opacity: creating || !form.name.trim() ? 0.6 : 1 }}
                >
                  {creating ? 'Creating...' : 'Create Board'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  style={{ flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3-dot dropdown menu */}
      <AnimatePresence>
        {menuBoard && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 8000 }} onClick={() => setMenuBoard(null)} />
            <motion.div
              role="menu"
              aria-label={`Options for ${menuBoard.name}`}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'fixed',
                top: menuPos.y,
                left: menuPos.x,
                zIndex: 8001,
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 6,
                minWidth: 160,
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              }}
            >
              {[
                { label: 'Rename', onClick: () => openRename(menuBoard), danger: false },
                { label: 'Duplicate', onClick: () => handleDuplicate(menuBoard), danger: false },
                { label: 'Share & Invite', onClick: () => { setShowCardShare(menuBoard); setMenuBoard(null); }, danger: false },
                menuBoard.is_archived
                  ? { label: 'Restore', onClick: () => handleArchive(menuBoard, false), danger: false }
                  : { label: 'Archive', onClick: () => handleArchive(menuBoard, true), danger: false },
                { label: 'Delete Board', onClick: () => { setConfirmDeleteBoard(menuBoard); setMenuBoard(null); }, danger: true },
              ].map(item => (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={item.onClick}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '8px 12px', background: 'none',
                    border: 'none', borderRadius: 'var(--radius-sm)',
                    fontSize: 13,
                    color: item.danger ? 'var(--color-error)' : 'var(--color-ink)',
                    fontFamily: 'var(--font-body)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = item.danger ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                >
                  {item.label}
                </button>
              ))}
            </motion.div>
          </>
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
              style={{ width: '100%', maxWidth: 360, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
                Delete "{confirmDeleteBoard.name}"?
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                This will permanently delete the board and all its contents. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleCardDelete(confirmDeleteBoard)}
                  disabled={deleting}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-error)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: deleting ? 'not-allowed' : 'pointer' }}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDeleteBoard(null)}
                  style={{ flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
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
              style={{ width: '100%', maxWidth: 360, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
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
                autoFocus
                maxLength={100}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleRenameSubmit}
                  disabled={renaming || !renameValue.trim()}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: renaming || !renameValue.trim() ? 'not-allowed' : 'pointer', opacity: renaming || !renameValue.trim() ? 0.6 : 1 }}
                >
                  {renaming ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setRenameBoard(null)}
                  style={{ flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
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
