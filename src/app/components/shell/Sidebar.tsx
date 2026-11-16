import { Link, useLocation } from 'react-router';
import { Home, LayoutGrid, Image, Lightbulb, FolderKanban, LayoutTemplate, Sparkles, Users, Handshake, Globe, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

// ─────────────────────────────────────────────────────────────────────────
// Sidebar — persistent left-rail navigation for Creator Studio's workspace
// surface. Deliberately separate from the top-bar Navigation.tsx, which
// keeps serving the public site (see WorkspaceShell.tsx for the boundary).
//
// V1.1 groups the destinations by what a creator is doing:
//   CREATE   make things             DISCOVER  look around
//   MANAGE   publish & collaborate
// Every destination is an existing route; nothing was renamed or moved
// (the old flat list's "Showcase" is "Showcase submissions" below, and
// "My profile" now lives in the navbar's account menu).
//
// Mobile/tablet: rendered inside a slide-in drawer by WorkspaceShell; this
// component only renders the list, the shell owns open/close/backdrop.
// ─────────────────────────────────────────────────────────────────────────

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }
export const NAV_GROUPS: Array<{ id: string; label: string; items: NavItem[] }> = [
  {
    id: 'create', label: 'Create',
    items: [
      { to: '/home', label: 'Overview', icon: Home },
      { to: '/moodboards', label: 'Moodboards', icon: LayoutGrid },
      { to: '/assets', label: 'Asset Library', icon: Image },
      { to: '/templates', label: 'Templates', icon: LayoutTemplate },
    ],
  },
  {
    id: 'discover', label: 'Discover',
    items: [
      { to: '/inspiration', label: 'Inspiration Library', icon: Lightbulb },
      { to: '/creators', label: 'Creator Discovery', icon: Users },
      { to: '/showcase', label: 'Public Showcase', icon: Globe, end: true },
    ],
  },
  {
    id: 'manage', label: 'Manage',
    items: [
      { to: '/projects', label: 'My Projects', icon: FolderKanban },
      { to: '/showcase/manage', label: 'Showcase submissions', icon: Sparkles },
      { to: '/showcase/manage#collaborations', label: 'Collaborations', icon: Handshake },
    ],
  },
];

/** Hash-aware active check: '/showcase/manage#collaborations' is its own destination, not a second highlight of '/showcase/manage'. */
export function isNavItemActive(item: NavItem, pathname: string, hash: string): boolean {
  const [path, itemHash] = item.to.split('#');
  const onPath = item.end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  if (!onPath) return false;
  if (itemHash) return hash === `#${itemHash}`;
  // A plain item yields to a sibling that owns the current hash on the same path.
  const hashOwners = NAV_GROUPS.flatMap(g => g.items).filter(i => i.to.startsWith(`${path}#`));
  return !hashOwners.some(i => hash === `#${i.to.split('#')[1]}`);
}

export function Sidebar({ onNavigate, onCloseMobile }: { onNavigate?: () => void; onCloseMobile?: () => void }) {
  const { pathname, hash } = useLocation();
  return (
    <nav
      aria-label="Creator Studio navigation"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 14px', gap: 4 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
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

      {NAV_GROUPS.map(group => (
        <div key={group.id} role="group" aria-labelledby={`ws-nav-${group.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
          <p id={`ws-nav-${group.id}`} className="type-caption" style={{ margin: '0 0 4px', padding: '0 12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11 }}>
            {group.label}
          </p>
          {/* Visual treatment lives in theme.css (.ws-nav-link): hover and the
              active state (NavLink sets aria-current="page") share the public
              nav's pill language. */}
          {group.items.map(item => {
            const isActive = isNavItemActive(item, pathname, hash);
            return (
              <Link key={item.to} to={item.to} onClick={onNavigate} className="ws-nav-link" aria-current={isActive ? 'page' : undefined}>
                <item.icon size={16} strokeWidth={isActive ? 2.25 : 1.9} style={{ flexShrink: 0 }} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
