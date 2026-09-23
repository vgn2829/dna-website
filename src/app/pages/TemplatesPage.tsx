import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { LayoutTemplate } from 'lucide-react';
import { api, type Template, type Project } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useModalA11y } from '../components/hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// TemplatesPage (V2.3 Phase 7) — replaces the V2.0/V2.2 placeholder with a
// real, intentionally simple UI: list, rename/edit description, archive,
// delete, use. Modeled directly on ProjectsPage.tsx's structure/styling —
// same WorkspaceContext-driven workspace resolution (concrete workspace
// required, personal-fallback in "All Workspaces" view), same Active/
// Archived tabs, same 3-dot menu pattern.
//
// There is no "create template" button/modal on THIS page — templates are
// only ever created from an existing Moodboard's "Save as Template"
// action (BoardPage.tsx, V2.3 Phase 8). This page is purely browse/
// manage/use, matching the brief's actual flow (Moodboard -> Save as
// Template -> appears here), not a template-authoring surface.
//
// Deliberately NOT built: template marketplace, public templates,
// ratings/likes/comments, sharing, analytics, versioning, AI generation —
// per the V2.3 brief's explicit scope boundary. This is an internal
// workspace productivity feature.
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

export default function TemplatesPage() {
  const { studentSession, openRollModal } = useStudent();
  const { activeWorkspaceId, personalWorkspace, workspaces, loading: workspaceLoading } = useWorkspace();
  const navigate = useNavigate();

  const targetWorkspace = activeWorkspaceId
    ? workspaces.find(w => w.id === activeWorkspaceId) ?? null
    : personalWorkspace;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [renameTemplate, setRenameTemplate] = useState<Template | null>(null);
  const [renameForm, setRenameForm] = useState({ name: '', description: '' });
  const [renaming, setRenaming] = useState(false);

  const [menuTemplate, setMenuTemplate] = useState<Template | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Use Template flow (Phase 9) — name + optional project, scoped to the
  // TEMPLATE's own workspace (which is always targetWorkspace here, since
  // every template listed on this page already belongs to it). Projects
  // are fetched fresh each time the modal opens rather than reusing any
  // page-level state, mirroring MoodboardsPage's own create-form project
  // picker (fetched only while its modal is open).
  const [useTemplate, setUseTemplate] = useState<Template | null>(null);
  const [useForm, setUseForm] = useState({ name: '', projectId: '' });
  const [useProjectOptions, setUseProjectOptions] = useState<Project[]>([]);
  const [using, setUsing] = useState(false);
  const [useError, setUseError] = useState('');

  const renameDialogRef = useModalA11y(!!renameTemplate, () => setRenameTemplate(null));
  const useDialogRef = useModalA11y(!!useTemplate, () => setUseTemplate(null));
  const deleteDialogRef = useModalA11y(!!confirmDelete, () => setConfirmDelete(null));

  const fetchTemplates = useCallback(() => {
    if (!studentSession?.rollNumber || !targetWorkspace) return;
    setLoading(true);
    setLoadError(false);
    api.templates.list(studentSession.rollNumber, targetWorkspace.id)
      .then(setTemplates)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [studentSession?.rollNumber, targetWorkspace]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (!menuTemplate) return;
    const close = () => setMenuTemplate(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuTemplate]);

  // Project options for the Use Template picker — fetched only when that
  // modal is actually open, scoped to the template's own workspace (never
  // the caller's currently-active workspace in the abstract — those are
  // the same value here, but the fetch is keyed off useTemplate.workspace_id
  // specifically so this can never drift if that assumption changes).
  useEffect(() => {
    if (!useTemplate || !studentSession?.rollNumber) return;
    api.projects.list(studentSession.rollNumber, useTemplate.workspace_id)
      .then(list => setUseProjectOptions(list.filter(p => !p.is_archived)))
      .catch(() => setUseProjectOptions([]));
  }, [useTemplate, studentSession?.rollNumber]);

  const openRename = (template: Template) => {
    setRenameTemplate(template);
    setRenameForm({ name: template.name, description: template.description ?? '' });
    setMenuTemplate(null);
  };

  const handleRename = async () => {
    if (!renameTemplate || !studentSession?.rollNumber || !renameForm.name.trim()) return;
    setRenaming(true);
    try {
      const updated = await api.templates.update(renameTemplate.id, studentSession.rollNumber, {
        name: renameForm.name.trim(),
        description: renameForm.description.trim() || null,
      });
      setTemplates(prev => prev.map(t => t.id === updated.id ? { ...t, name: updated.name, description: updated.description } : t));
      setRenameTemplate(null);
      toast.success('Template updated');
    } catch {
      toast.error('Failed to update template');
    } finally {
      setRenaming(false);
    }
  };

  const handleArchiveToggle = async (template: Template, archive: boolean) => {
    if (!studentSession?.rollNumber) return;
    setMenuTemplate(null);
    setArchivingId(template.id);
    try {
      const updated = await api.templates.update(template.id, studentSession.rollNumber, { is_archived: archive });
      setTemplates(prev => prev.map(t => t.id === updated.id ? { ...t, is_archived: updated.is_archived } : t));
      toast.success(archive ? 'Template archived' : 'Template restored');
    } catch {
      toast.error(archive ? 'Failed to archive template' : 'Failed to restore template');
    } finally {
      setArchivingId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !studentSession?.rollNumber) return;
    setDeleting(true);
    try {
      await api.templates.delete(confirmDelete.id, studentSession.rollNumber);
      setTemplates(prev => prev.filter(t => t.id !== confirmDelete.id));
      setConfirmDelete(null);
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    } finally {
      setDeleting(false);
    }
  };

  const openUse = (template: Template) => {
    setUseTemplate(template);
    setUseForm({ name: template.name, projectId: '' });
    setUseError('');
    setMenuTemplate(null);
  };

  const handleUse = async () => {
    if (!useTemplate || !studentSession?.rollNumber) return;
    setUsing(true);
    setUseError('');
    try {
      const board = await api.templates.use(useTemplate.id, studentSession.rollNumber, {
        name: useForm.name.trim() || undefined,
        project_id: useForm.projectId || undefined,
      });
      setUseTemplate(null);
      toast.success('Moodboard created');
      navigate(`/moodboards/${board.id}`);
    } catch {
      setUseError('Failed to create Moodboard from template');
      toast.error('Failed to create Moodboard from template');
    } finally {
      setUsing(false);
    }
  };

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--color-ink-muted)', marginBottom: 16 }}>
          Sign in to view and manage templates.
        </p>
        <button
          onClick={openRollModal}
          style={{ padding: '10px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
        >
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
        <LayoutTemplate size={28} strokeWidth={1.5} style={{ color: 'var(--color-ink-muted)', marginBottom: 14 }} />
        <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
          Select a workspace to view its templates.
        </p>
      </div>
    );
  }

  const visibleTemplates = templates.filter(t => showArchived ? t.is_archived : !t.is_archived);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-muted)', letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
          {targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
        </p>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(32px,4.5vw,52px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-2px', color: 'var(--color-ink)' }}>
          Templates
        </h1>
        <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink-muted)' }}>
          Save any Moodboard as a template from its canvas page, then reuse it here.
        </p>
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
          Could not load templates. <button onClick={fetchTemplates} style={{ background: 'none', border: 'none', color: 'var(--color-brand)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14 }}>Retry</button>
        </p>
      ) : visibleTemplates.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
          {showArchived ? 'No archived templates.' : 'No templates yet. Open a Moodboard and choose "Save as Template" to create one.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {visibleTemplates.map(template => (
            <div
              key={template.id}
              style={{
                position: 'relative', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)', background: 'var(--color-surface-1)',
                overflow: 'hidden', opacity: archivingId === template.id ? 0.5 : 1,
              }}
            >
              {/* Thumbnail placeholder — no thumbnail-generation system in
                  this phase (see thumbnail_url's own schema comment);
                  same 4-quadrant tint pattern BoardCard.tsx already uses
                  for the identical "no real thumbnail yet" case. */}
              <div style={{
                width: '100%', aspectRatio: '16 / 9', position: 'relative',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
                gap: 1, overflow: 'hidden', background: 'var(--color-surface-2)',
              }}>
                {template.thumbnail_url ? (
                  <img
                    src={template.thumbnail_url}
                    alt=""
                    style={{ gridColumn: '1 / -1', gridRow: '1 / -1', width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  [0.04, 0.06, 0.08, 0.10].map((alpha, i) => (
                    <div key={i} style={{ background: `rgba(233,30,140,${alpha})` }} />
                  ))
                )}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setMenuTemplate(template);
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setMenuPos({ x: rect.right - 160, y: rect.bottom + 4 });
                  }}
                  aria-label={`Options for ${template.name}`}
                  aria-haspopup="menu"
                  style={{
                    position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: 16,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}
                >
                  ⋮
                </button>
              </div>

              <div style={{ padding: '14px 16px 16px' }}>
                <h3 style={{
                  margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--color-ink)',
                  fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {template.name}
                </h3>
                {template.description && (
                  <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {template.description}
                  </p>
                )}
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  Saved {timeAgo(template.created_at)}
                </p>
                {!template.is_archived && (
                  <button
                    onClick={() => openUse(template)}
                    style={{
                      width: '100%', padding: '8px 0', background: 'var(--color-brand)', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600,
                      fontFamily: 'var(--font-body)', cursor: 'pointer',
                    }}
                  >
                    Use Template
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3-dot dropdown menu */}
      <AnimatePresence>
        {menuTemplate && (
          <motion.div
            role="menu"
            aria-label={`Options for ${menuTemplate.name}`}
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
              ...(menuTemplate.is_archived ? [] : [{ label: 'Use Template', onClick: () => openUse(menuTemplate) }]),
              { label: 'Rename / Edit', onClick: () => openRename(menuTemplate) },
              menuTemplate.is_archived
                ? { label: 'Restore', onClick: () => handleArchiveToggle(menuTemplate, false) }
                : { label: 'Archive', onClick: () => handleArchiveToggle(menuTemplate, true) },
              { label: 'Delete', onClick: () => { setConfirmDelete(menuTemplate); setMenuTemplate(null); }, danger: true },
            ].map(item => (
              <button
                key={item.label}
                role="menuitem"
                onClick={item.onClick}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none',
                  border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13,
                  color: item.danger ? 'var(--color-error)' : 'var(--color-ink)', fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = item.danger ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename / edit description modal */}
      <AnimatePresence>
        {renameTemplate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setRenameTemplate(null)}
          >
            <motion.div
              ref={renameDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Edit Template"
              tabIndex={-1}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                Edit Template
              </h3>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                  Name
                </label>
                <input
                  className="input-base"
                  type="text"
                  value={renameForm.name}
                  onChange={e => setRenameForm(prev => ({ ...prev, name: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                  Description (optional)
                </label>
                <input
                  className="input-base"
                  type="text"
                  value={renameForm.description}
                  onChange={e => setRenameForm(prev => ({ ...prev, description: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleRename}
                  disabled={renaming || !renameForm.name.trim()}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: renaming || !renameForm.name.trim() ? 'not-allowed' : 'pointer', opacity: renaming || !renameForm.name.trim() ? 0.6 : 1 }}
                >
                  {renaming ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setRenameTemplate(null)}
                  style={{ flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Use Template modal (Phase 9) */}
      <AnimatePresence>
        {useTemplate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setUseTemplate(null)}
          >
            <motion.div
              ref={useDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Use Template"
              tabIndex={-1}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                New Moodboard from "{useTemplate.name}"
              </h3>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                  Board Name
                </label>
                <input
                  className="input-base"
                  type="text"
                  placeholder={useTemplate.name}
                  value={useForm.name}
                  onChange={e => setUseForm(prev => ({ ...prev, name: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  autoFocus
                />
              </div>

              {useProjectOptions.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                    Project (optional)
                  </label>
                  <select
                    className="input-base"
                    value={useForm.projectId}
                    onChange={e => setUseForm(prev => ({ ...prev, projectId: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  >
                    <option value="">No project — ungrouped</option>
                    {useProjectOptions.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {useError && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{useError}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleUse}
                  disabled={using}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: using ? 'not-allowed' : 'pointer', opacity: using ? 0.6 : 1 }}
                >
                  {using ? 'Creating...' : 'Create Moodboard'}
                </button>
                <button
                  onClick={() => setUseTemplate(null)}
                  style={{ flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              ref={deleteDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Delete Template"
              tabIndex={-1}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 400, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, outline: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                Delete "{confirmDelete.name}"?
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                This cannot be undone. Boards already created from this template are not affected.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{ flex: 1, padding: '12px 20px', background: 'var(--color-error)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
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
