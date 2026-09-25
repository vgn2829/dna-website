import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { FolderKanban } from 'lucide-react';
import { api, type Project } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useModalA11y } from '../components/hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// ProjectsPage (V2.2 Phase 5) — replaces the V2.0 placeholder with a real,
// intentionally simple organizational-container UI: list, create, rename,
// archive, open, board count. Consumes WorkspaceContext.activeWorkspaceId
// exactly like MoodboardsPage does — projects have no meaningful
// "across all workspaces" view (see api.ts's own comment on why
// api.projects.list requires a concrete workspace_id, unlike
// boards.getMyBoards/getArchived's optional one), so this page requires a
// concrete workspace to be selected and prompts the user to pick one
// otherwise, rather than silently falling back to something that could
// look like "all projects everywhere."
//
// Deliberately NOT built: Kanban, task management, analytics, activity
// feeds, project-specific collaboration/comments/permissions/dashboards —
// this is an organizational container, not a second application (per the
// V2.2 brief's own explicit scope boundary).
// ─────────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

export default function ProjectsPage() {
  const { studentSession, openRollModal } = useStudent();
  const { activeWorkspaceId, personalWorkspace, workspaces, loading: workspaceLoading } = useWorkspace();
  const navigate = useNavigate();

  const targetWorkspace = activeWorkspaceId
    ? workspaces.find(w => w.id === activeWorkspaceId) ?? null
    : personalWorkspace;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [renameProject, setRenameProject] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [menuProject, setMenuProject] = useState<Project | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const createDialogRef = useModalA11y(showCreate, () => setShowCreate(false));
  const renameDialogRef = useModalA11y(!!renameProject, () => setRenameProject(null));

  const fetchProjects = useCallback(() => {
    if (!studentSession?.rollNumber || !targetWorkspace) return;
    setLoading(true);
    setLoadError(false);
    api.projects.list(studentSession.rollNumber, targetWorkspace.id)
      .then(setProjects)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [studentSession?.rollNumber, targetWorkspace]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!menuProject) return;
    const close = () => setMenuProject(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuProject]);

  const handleCreate = async () => {
    if (!studentSession?.rollNumber || !targetWorkspace || !form.name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const project = await api.projects.create(studentSession.rollNumber, {
        workspace_id: targetWorkspace.id,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      });
      setProjects(prev => [project, ...prev]);
      setShowCreate(false);
      setForm({ name: '', description: '' });
      toast.success('Project created');
      navigate(`/projects/${project.id}`);
    } catch {
      setCreateError('Failed to create project');
      toast.error('Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const openRename = (project: Project) => {
    setRenameProject(project);
    setRenameValue(project.name);
    setMenuProject(null);
  };

  const handleRename = async () => {
    if (!renameProject || !studentSession?.rollNumber || !renameValue.trim()) return;
    const trimmed = renameValue.trim();
    if (trimmed === renameProject.name) { setRenameProject(null); return; }
    setRenaming(true);
    try {
      const updated = await api.projects.update(renameProject.id, studentSession.rollNumber, { name: trimmed });
      setProjects(prev => prev.map(p => p.id === updated.id ? { ...p, name: updated.name } : p));
      setRenameProject(null);
      toast.success('Project renamed');
    } catch {
      toast.error('Failed to rename project');
    } finally {
      setRenaming(false);
    }
  };

  const handleArchiveToggle = async (project: Project, archive: boolean) => {
    if (!studentSession?.rollNumber) return;
    setMenuProject(null);
    setArchivingId(project.id);
    try {
      const updated = await api.projects.update(project.id, studentSession.rollNumber, { is_archived: archive });
      setProjects(prev => prev.map(p => p.id === updated.id ? { ...p, is_archived: updated.is_archived } : p));
      toast.success(archive ? 'Project archived' : 'Project restored');
    } catch {
      toast.error(archive ? 'Failed to archive project' : 'Failed to restore project');
    } finally {
      setArchivingId(null);
    }
  };

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--color-ink-muted)', marginBottom: 16 }}>
          Sign in to view and manage projects.
        </p>
        <button onClick={openRollModal} className="btn-primary">
          Sign in
        </button>
      </div>
    );
  }

  if (workspaceLoading && workspaces.length === 0) {
    return <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)', padding: '40px 0' }}>Loading…</p>;
  }

  if (!targetWorkspace) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <FolderKanban size={28} strokeWidth={1.5} style={{ color: 'var(--color-ink-muted)', marginBottom: 14 }} />
        <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
          Select a workspace to view its projects.
        </p>
      </div>
    );
  }

  const visibleProjects = projects.filter(p => showArchived ? p.is_archived : !p.is_archived);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-muted)', letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
            {targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
          </p>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(32px,4.5vw,52px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-2px', color: 'var(--color-ink)' }}>
            Projects
          </h1>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          + New Project
        </button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 28 }}>
        {([['active', 'Active'], ['archived', 'Archived']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setShowArchived(key === 'archived')}
            aria-pressed={(key === 'archived') === showArchived}
            style={{
              padding: '10px 16px', background: 'none', border: 'none',
              borderBottom: (key === 'archived') === showArchived ? '2px solid var(--color-brand)' : '2px solid transparent',
              marginBottom: -1, fontSize: 14, fontFamily: 'var(--font-body)',
              color: (key === 'archived') === showArchived ? 'var(--color-ink)' : 'var(--color-ink-muted)',
              fontWeight: (key === 'archived') === showArchived ? 600 : 400, cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>Loading…</p>
      ) : loadError ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-error)' }}>
          Could not load projects. <button onClick={fetchProjects} style={{ background: 'none', border: 'none', color: 'var(--color-brand-text)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14 }}>Retry</button>
        </p>
      ) : visibleProjects.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
          {showArchived ? 'No archived projects.' : 'No projects yet. Create one to start organizing your boards.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {visibleProjects.map(project => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              style={{
                position: 'relative', padding: 18, borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)', background: 'var(--color-surface-1)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
                opacity: archivingId === project.id ? 0.5 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <FolderKanban size={18} strokeWidth={1.75} style={{ color: 'var(--color-ink-muted)', flexShrink: 0, marginTop: 2 }} />
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setMenuProject(project);
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setMenuPos({ x: rect.right - 160, y: rect.bottom + 4 });
                  }}
                  aria-label={`Options for ${project.name}`}
                  style={{ background: 'none', border: 'none', color: 'var(--color-ink-muted)', cursor: 'pointer', padding: 4, fontSize: 16, lineHeight: 1 }}
                >
                  ⋮
                </button>
              </div>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {project.name}
              </span>
              {project.description && (
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--color-ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {project.description}
                </span>
              )}
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-ink-muted)', marginTop: 4 }}>
                {project.board_count} board{project.board_count === 1 ? '' : 's'} · {timeAgo(project.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 3-dot dropdown menu */}
      <AnimatePresence>
        {menuProject && (
          <motion.div
            role="menu"
            aria-label={`Options for ${menuProject.name}`}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: menuPos.y, left: menuPos.x, zIndex: 8001,
              background: 'var(--color-surface-1)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: 6, minWidth: 160,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}
          >
            {[
              { label: 'Open', onClick: () => navigate(`/projects/${menuProject.id}`) },
              { label: 'Rename', onClick: () => openRename(menuProject) },
              menuProject.is_archived
                ? { label: 'Restore', onClick: () => handleArchiveToggle(menuProject, false) }
                : { label: 'Archive', onClick: () => handleArchiveToggle(menuProject, true) },
            ].map(item => (
              <button
                key={item.label}
                role="menuitem"
                onClick={item.onClick}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none',
                  border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13,
                  color: 'var(--color-ink)', fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create project modal */}
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
              aria-label="New Project"
              tabIndex={-1}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                New Project
              </h3>

              {([
                { label: 'Project Name', key: 'name', placeholder: 'e.g. Q3 Campaign' },
                { label: 'Description (optional)', key: 'description', placeholder: 'What is this project about?' },
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

              {createError && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{createError}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleCreate}
                  disabled={creating || !form.name.trim()}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: creating || !form.name.trim() ? 'not-allowed' : 'pointer', opacity: creating || !form.name.trim() ? 0.6 : 1 }}
                >
                  {creating ? 'Creating...' : 'Create Project'}
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

      {/* Rename project modal */}
      <AnimatePresence>
        {renameProject && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setRenameProject(null)}
          >
            <motion.div
              ref={renameDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Rename Project"
              tabIndex={-1}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 400, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                Rename Project
              </h3>
              <input
                className="input-base"
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
                style={{ width: '100%', boxSizing: 'border-box' }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleRename}
                  disabled={renaming || !renameValue.trim()}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: renaming || !renameValue.trim() ? 'not-allowed' : 'pointer', opacity: renaming || !renameValue.trim() ? 0.6 : 1 }}
                >
                  {renaming ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setRenameProject(null)}
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
