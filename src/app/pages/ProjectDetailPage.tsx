import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { ArrowLeft, FolderKanban } from 'lucide-react';
import { api, type Project, type Board } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { BoardCard } from '../components/BoardCard';
import { useModalA11y } from '../components/hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// ProjectDetailPage (V2.2 Phase 6) — minimal project detail view at
// /projects/:id. Shows name/description/archive state, the project's
// boards (reusing BoardCard, the SAME component MoodboardsPage/this page
// both use — see components/BoardCard.tsx's own comment on why it was
// extracted rather than duplicated), create-Moodboard-in-this-project,
// open an existing Moodboard, and un-group a board back to workspace
// level. Deliberately NOT a second MoodboardsPage — no tabs, no search/
// sort, no favorites rail; just the one project's boards.
//
// Authorization is entirely server-side (GET /api/projects/:id and
// GET /api/projects/:id/boards both re-derive the project's real
// workspace_id and check membership against that — see routes/
// projects.ts) — this page doesn't attempt its own client-side
// workspace-membership gate beyond showing whatever the API returns
// (403/404 render as an error state below).
// ─────────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { studentSession, openRollModal } = useStudent();
  const { workspaces } = useWorkspace();

  const [project, setProject] = useState<Project | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'not_found' | 'access_denied' | 'unknown' | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' as 'private' | 'shared' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const createDialogRef = useModalA11y(showCreate, () => setShowCreate(false));

  const [ungroupingId, setUngroupingId] = useState<string | null>(null);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id || !studentSession?.rollNumber) return;
    setLoading(true);
    setError(null);
    try {
      const [projectRes, boardsRes] = await Promise.all([
        api.projects.get(id, studentSession.rollNumber),
        api.projects.getBoards(id, studentSession.rollNumber),
      ]);
      setProject(projectRes);
      setBoards(boardsRes);
    } catch (err) {
      // api.ts's request() throws a plain Error whose message is the
      // server's JSON `error` string (no HTTP status is attached to the
      // thrown error — see that function's own implementation) — routes/
      // projects.ts's GET /:id returns exactly 'Project not found' (404)
      // or 'Access denied' (403), matched here by message text since
      // that's the only signal actually available, not a `.status` field.
      const message = err instanceof Error ? err.message : '';
      if (message === 'Project not found') setError('not_found');
      else if (message === 'Access denied') setError('access_denied');
      else setError('unknown');
    } finally {
      setLoading(false);
    }
  }, [id, studentSession?.rollNumber]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const projectWorkspace = project ? workspaces.find(w => w.id === project.workspace_id) ?? null : null;

  const handleCreate = async () => {
    if (!studentSession?.rollNumber || !project || !form.name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const board = await api.boards.create(studentSession.rollNumber, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        visibility: form.visibility,
        workspace_id: project.workspace_id,
        project_id: project.id,
      });
      setBoards(prev => [board, ...prev]);
      setShowCreate(false);
      setForm({ name: '', description: '', visibility: 'private' });
      toast.success('Board created');
      navigate(`/moodboards/${board.id}`);
    } catch {
      setCreateError('Failed to create board');
      toast.error('Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const handleUngroup = async (board: Board) => {
    if (!studentSession?.rollNumber) return;
    setUngroupingId(board.id);
    try {
      await api.boards.update(board.id, studentSession.rollNumber, { project_id: null });
      setBoards(prev => prev.filter(b => b.id !== board.id));
      if (project) setProject({ ...project, board_count: Math.max(0, project.board_count - 1) });
      toast.success('Board removed from project');
    } catch {
      toast.error('Failed to update board');
    } finally {
      setUngroupingId(null);
    }
  };

  const handleToggleFavorite = async (board: Board) => {
    if (!studentSession?.rollNumber) return;
    const nextFavorite = !board.is_favorite;
    setBoards(prev => prev.map(b => b.id === board.id ? { ...b, is_favorite: nextFavorite } : b));
    setFavoriteBusyId(board.id);
    try {
      if (nextFavorite) await api.boards.favorite(board.id, studentSession.rollNumber);
      else await api.boards.unfavorite(board.id, studentSession.rollNumber);
    } catch {
      setBoards(prev => prev.map(b => b.id === board.id ? { ...b, is_favorite: board.is_favorite } : b));
      toast.error('Failed to update favorite');
    } finally {
      setFavoriteBusyId(null);
    }
  };

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>
          Sign in to view this project.
        </p>
        <button
          onClick={openRollModal}
          className="btn-primary"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (loading) {
    return <p className="type-body" style={{ color: 'var(--color-ink-muted)', padding: '40px 0' }}>Loading…</p>;
  }

  if (error || !project) {
    const message = error === 'not_found' ? 'Project not found.'
      : error === 'access_denied' ? 'You don\'t have access to this project.'
      : 'Could not load this project.';
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>{message}</p>
        <button
          onClick={() => navigate('/projects')}
          className="btn-primary"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => navigate('/projects')}
        className="type-body-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--color-ink-muted)', cursor: 'pointer', marginBottom: 20, padding: 0 }}
      >
        <ArrowLeft size={14} /> Projects
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <FolderKanban size={26} strokeWidth={1.5} style={{ color: 'var(--color-ink-muted)', marginTop: 6, flexShrink: 0 }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="type-display-md" style={{ margin: 0 }}>
                {project.name}
              </h1>
              {project.is_archived && (
                <span className="type-micro" style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(128,128,128,0.15)', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  Archived
                </span>
              )}
            </div>
            {project.description && (
              <p className="type-body" style={{ margin: '8px 0 0', color: 'var(--color-ink-muted)', maxWidth: 560 }}>
                {project.description}
              </p>
            )}
            <p className="type-caption" style={{ margin: '8px 0 0' }}>
              {projectWorkspace ? (projectWorkspace.is_personal ? 'Personal' : projectWorkspace.name) : 'Workspace'} · {boards.length} board{boards.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        {!project.is_archived && (
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary"
          >
            + New Board
          </button>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        {boards.length === 0 ? (
          <p className="type-body" style={{ color: 'var(--color-ink-muted)' }}>
            No boards in this project yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {boards.map(board => (
              <div key={board.id} style={{ position: 'relative', opacity: ungroupingId === board.id ? 0.5 : 1 }}>
                <BoardCard
                  board={board}
                  onClick={() => navigate(`/moodboards/${board.id}`)}
                  onToggleFavorite={handleToggleFavorite}
                  favoriteBusy={favoriteBusyId === board.id}
                  ownerRoll={studentSession.rollNumber}
                />
                {board.owner_roll === studentSession.rollNumber && (
                  <button
                    onClick={e => { e.stopPropagation(); handleUngroup(board); }}
                    disabled={ungroupingId === board.id}
                    className="btn-secondary btn-sm touch-target"
                    style={{ marginTop: 8 }}
                  >
                    Remove from project
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
              <h3 className="type-headline" style={{ margin: 0 }}>
                New Moodboard in {project.name}
              </h3>

              {([
                { label: 'Board Name', key: 'name', placeholder: 'e.g. Typography Inspo' },
                { label: 'Description (optional)', key: 'description', placeholder: 'What is this board about?' },
              ] as const).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
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
                <label className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
                  Visibility
                </label>
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
              </div>

              {createError && <p className="type-micro" style={{ margin: 0, color: 'var(--color-error)' }}>{createError}</p>}

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
    </div>
  );
}
