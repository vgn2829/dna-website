import { NavLink } from 'react-router';
import { Home, LayoutGrid, Image, FolderKanban, LayoutTemplate, X } from 'lucide-react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

// ─────────────────────────────────────────────────────────────────────────
// Sidebar (V2.0 Phase 2) — persistent left-rail navigation for the
// workspace app surface (Home/Moodboards/Assets/Projects/Templates).
// Deliberately separate from the existing top-bar Navigation.tsx, which
// keeps serving the public/marketing site + Design Studio/Academy/etc
// unchanged (see WorkspaceShell.tsx for the route boundary between the
// two shells).
//
// Mobile/tablet: rendered inside a slide-in drawer by WorkspaceShell, not
// duplicated here — this component only knows how to render the nav list
// itself; open/close/backdrop is the shell's responsibility so there is
// exactly one place that owns "is the drawer open."
// ─────────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/moodboards', label: 'Moodboards', icon: LayoutGrid },
  { to: '/assets', label: 'Assets', icon: Image },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
];

export function Sidebar({ onNavigate, onCloseMobile }: { onNavigate?: () => void; onCloseMobile?: () => void }) {
  return (
    <nav
      aria-label="Workspace navigation"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        padding: '16px 14px', gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <WorkspaceSwitcher />
        </div>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            aria-label="Close navigation"
            style={{
              marginLeft: 8, width: 32, height: 32, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', color: 'var(--color-ink-muted)', cursor: 'pointer',
            }}
            className="touch-target"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <p style={{
        margin: '0 0 6px', padding: '0 12px',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', opacity: 0.8,
      }}>
        Workspace
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Visual treatment lives in theme.css (.ws-nav-link) so hover and
            the active state (NavLink sets aria-current="page") can share
            the public nav's pill language. */}
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} onClick={onNavigate} className="ws-nav-link">
            {({ isActive }) => (
              <>
                <item.icon size={16} strokeWidth={isActive ? 2.25 : 1.9} style={{ flexShrink: 0 }} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
