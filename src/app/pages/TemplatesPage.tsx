import { LayoutTemplate } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// TemplatesPage (V2.0 Phase 7) — route/shell placeholder ONLY, same rule
// as ProjectsPage.tsx: no templates table, no /api/templates route, no
// data fetching. Exists so the shell's nav has somewhere real to point
// ahead of the dedicated Templates phase (V2.5 per the architecture
// audit).
// ─────────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  return (
    <div style={{ padding: '80px 0', textAlign: 'center' }}>
      <LayoutTemplate size={28} strokeWidth={1.5} style={{ color: 'var(--color-ink-faint, var(--color-ink-muted))', marginBottom: 14 }} />
      <h1 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, color: 'var(--color-ink)' }}>
        Templates
      </h1>
      <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
        Coming soon.
      </p>
    </div>
  );
}
