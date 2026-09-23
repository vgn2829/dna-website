import { FolderKanban } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// ProjectsPage (V2.0 Phase 6) — route/shell placeholder ONLY, per the
// V2.0 brief: "Do NOT implement the full Projects feature yet... only
// establish the route/shell placeholder if required by the architecture.
// Do not create database tables unless they are necessary for the
// shell." No projects table, no /api/projects route, no data fetching —
// this page exists solely so the shell's nav has somewhere real to point
// and the URL is stable ahead of the dedicated Projects phase (V2.6 per
// the architecture audit).
// ─────────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  return (
    <div style={{ padding: '80px 0', textAlign: 'center' }}>
      <FolderKanban size={28} strokeWidth={1.5} style={{ color: 'var(--color-ink-faint, var(--color-ink-muted))', marginBottom: 14 }} />
      <h1 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, color: 'var(--color-ink)' }}>
        Projects
      </h1>
      <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
        Coming soon.
      </p>
    </div>
  );
}
