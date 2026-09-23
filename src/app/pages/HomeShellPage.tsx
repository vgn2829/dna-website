import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Board, type Asset, type Project, type Template } from '../lib/api';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';

// ─────────────────────────────────────────────────────────────────────────
// HomeShellPage (V2.0 Phase 3; V2.2 adds Recent Projects; V2.3 Phase 10
// adds Recent Templates) — the signed-in Home landing page for the
// workspace app shell. Deliberately small per the V2.0 brief ("do not
// overbuild Home... do NOT introduce a new activity-log database"):
// recent Moodboards, favorite Moodboards, recent Assets, recent Projects,
// recent Templates (each only when a concrete workspace is resolvable),
// and quick-create actions.
//
// Reuses existing, already-shipped endpoints only — api.boards.getMyBoards,
// api.assets.list, api.projects.list, and (V2.3) api.templates.list, each
// already used elsewhere (MoodboardsPage/AssetLibrary/ProjectsPage/
// TemplatesPage) — filtered/sliced client-side for "recent"/"favorite".
// No new backend aggregate endpoint. Clicking a template card here
// navigates to /templates rather than duplicating that page's own
// name+project "Use Template" modal — same "don't duplicate existing UI"
// choice the "+ New Project" button below already makes for project
// creation, keeping this page a dashboard, not a second templates
// management surface.
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

function BoardCard({ board }: { board: Board }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`/moodboards/${board.id}`)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
        padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
        background: 'var(--color-surface-1)', cursor: 'pointer', minWidth: 0,
      }}
    >
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {board.name}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-ink-muted)' }}>
        Edited {timeAgo(board.updated_at)}
      </span>
    </button>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`/projects/${project.id}`)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
        padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
        background: 'var(--color-surface-1)', cursor: 'pointer', minWidth: 0,
      }}
    >
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {project.name}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-ink-muted)' }}>
        {project.board_count} board{project.board_count === 1 ? '' : 's'}
      </span>
    </button>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/templates')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
        padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
        background: 'var(--color-surface-1)', cursor: 'pointer', minWidth: 0,
      }}
    >
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {template.name}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-ink-muted)' }}>
        Use Template →
      </span>
    </button>
  );
}

function SectionHeading({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 700, color: 'var(--color-ink)' }}>
        {title}
      </h2>
      {action && (
        <button
          onClick={action.onClick}
          style={{ background: 'none', border: 'none', color: 'var(--color-brand)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default function HomeShellPage() {
  const { studentSession, openRollModal } = useStudent();
  const { activeWorkspaceId, personalWorkspace, workspaces } = useWorkspace();
  const navigate = useNavigate();

  const [myBoards, setMyBoards] = useState<Board[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentSession?.rollNumber) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.boards.getMyBoards(studentSession.rollNumber, activeWorkspaceId ?? undefined)
      .then(data => { if (!cancelled) setMyBoards(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentSession?.rollNumber, activeWorkspaceId]);

  // Assets are always workspace-scoped (no cross-workspace list) — same
  // constraint AssetsPage.tsx/AssetLibrary already have. Falls back to the
  // personal workspace in "All Workspaces" view, same fallback AssetsPage
  // uses, so Home never needs a concrete workspace selected to show
  // something here.
  useEffect(() => {
    if (!studentSession?.rollNumber) return;
    const targetWorkspaceId = activeWorkspaceId ?? personalWorkspace?.id;
    if (!targetWorkspaceId) return;
    let cancelled = false;
    api.assets.list(studentSession.rollNumber, targetWorkspaceId)
      .then(res => { if (!cancelled) setAssets(res.assets.slice(0, 6)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [studentSession?.rollNumber, activeWorkspaceId, personalWorkspace?.id]);

  // Projects — same workspace-scoping/personal-fallback shape as Assets
  // above (V2.2 Phase 8); a project has no cross-workspace view (see
  // api.ts's own comment on why api.projects.list requires a concrete
  // workspace_id).
  useEffect(() => {
    if (!studentSession?.rollNumber) return;
    const targetWorkspaceId = activeWorkspaceId ?? personalWorkspace?.id;
    if (!targetWorkspaceId) return;
    let cancelled = false;
    api.projects.list(studentSession.rollNumber, targetWorkspaceId)
      .then(list => {
        if (cancelled) return;
        const active = list.filter(p => !p.is_archived).sort((a, b) => b.created_at.localeCompare(a.created_at));
        setProjects(active.slice(0, 6));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [studentSession?.rollNumber, activeWorkspaceId, personalWorkspace?.id]);

  // Templates — same workspace-scoping/personal-fallback shape as
  // Projects/Assets above (V2.3 Phase 10); a template has no cross-
  // workspace view (see api.ts's own comment on api.templates.list).
  useEffect(() => {
    if (!studentSession?.rollNumber) return;
    const targetWorkspaceId = activeWorkspaceId ?? personalWorkspace?.id;
    if (!targetWorkspaceId) return;
    let cancelled = false;
    api.templates.list(studentSession.rollNumber, targetWorkspaceId)
      .then(list => {
        if (cancelled) return;
        const active = list.filter(t => !t.is_archived).sort((a, b) => b.created_at.localeCompare(a.created_at));
        setTemplates(active.slice(0, 6));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [studentSession?.rollNumber, activeWorkspaceId, personalWorkspace?.id]);

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--color-ink-muted)', marginBottom: 16 }}>
          Sign in to see your recent work.
        </p>
        <button
          onClick={openRollModal}
          style={{
            padding: '10px 20px', background: 'var(--color-brand)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14,
            fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
          }}
        >
          Sign in
        </button>
      </div>
    );
  }

  const favoriteBoards = myBoards.filter(b => b.is_favorite).slice(0, 6);
  const recentBoards = [...myBoards].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(32px,4.5vw,52px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-2px', color: 'var(--color-ink)' }}>
          {studentSession.name ? `Welcome back, ${studentSession.name.split(' ')[0]}` : 'Home'}
        </h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => navigate('/projects')}
            style={{
              padding: '10px 20px', background: 'none', color: 'var(--color-ink)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 14,
              fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
            }}
          >
            + New Project
          </button>
          <button
            onClick={() => navigate('/moodboards')}
            style={{
              padding: '10px 20px', background: 'var(--color-brand)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14,
              fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
            }}
          >
            + New Board
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>Loading…</p>
      ) : (
        <>
          {favoriteBoards.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <SectionHeading title="Favorites" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {favoriteBoards.map(b => <BoardCard key={b.id} board={b} />)}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 36 }}>
            <SectionHeading title="Recent Moodboards" action={{ label: 'View all', onClick: () => navigate('/moodboards') }} />
            {recentBoards.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {recentBoards.map(b => <BoardCard key={b.id} board={b} />)}
              </div>
            ) : (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink-muted)' }}>
                No boards yet — create one to get started.
              </p>
            )}
          </div>

          {projects.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <SectionHeading title="Recent Projects" action={{ label: 'View all', onClick: () => navigate('/projects') }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {projects.map(p => <ProjectCard key={p.id} project={p} />)}
              </div>
            </div>
          )}

          {templates.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <SectionHeading title="Recent Templates" action={{ label: 'View all', onClick: () => navigate('/templates') }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {templates.map(t => <TemplateCard key={t.id} template={t} />)}
              </div>
            </div>
          )}

          {assets.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <SectionHeading title="Recent Assets" action={{ label: 'View all', onClick: () => navigate('/assets') }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                {assets.map(a => (
                  <div
                    key={a.id}
                    style={{
                      aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden',
                      border: '1px solid var(--color-border)', background: 'var(--color-surface-1)',
                    }}
                  >
                    <img src={a.url} alt={a.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {workspaces.length === 0 && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink-muted)' }}>
              Setting up your workspace…
            </p>
          )}
        </>
      )}
    </div>
  );
}
