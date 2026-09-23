import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Menu } from 'lucide-react';
import { WorkspaceProvider } from '../../context/WorkspaceContext';
import { useStudent } from '../../context/StudentContext';
import { useTheme } from '../../context/ThemeContext';
import { useScreenSize } from '../hooks/use-screen-size';
import { useModalA11y } from '../hooks/useModalA11y';
import { Sidebar } from './Sidebar';
import { NotificationBell } from '../NotificationBell';

// ─────────────────────────────────────────────────────────────────────────
// WorkspaceShell (V2.0 Phase 2) — the persistent app shell for the
// workspace product surface: Home, Moodboards, Assets, Projects,
// Templates. Mounted as its own layout route in routes.tsx, a sibling of
// Root's existing marketing-site layout, NOT nested inside it — this is
// what keeps the public site (Home marketing composition, Academy,
// Gallery, Events, Team, Design Studio, Admin) on its existing
// Navigation/Footer shell completely untouched (per the V2.0 brief's
// explicit "do not modify the public/marketing site shell").
//
// WorkspaceProvider is mounted HERE, not globally in Root.tsx — it has no
// reason to fetch a signed-in student's workspace list on every public
// marketing page view, and confining it to the one layout that actually
// needs it keeps that boundary enforced by construction rather than by
// convention.
//
// /moodboards/:id (BoardPage, the canvas) is deliberately NOT a child of
// this shell — see routes.tsx: BoardPage keeps its existing full-screen,
// chrome-free layout exactly as before (its own top bar, no sidebar, no
// shell header), preserving every existing board URL/share-link's visual
// behavior unchanged.
// ─────────────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 232;

export function WorkspaceShell() {
  const { studentSession, openRollModal } = useStudent();
  const { theme } = useTheme();
  const location = useLocation();
  const screenSize = useScreenSize();
  const isDesktop = screenSize.greaterThanOrEqual('lg');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useModalA11y(drawerOpen, () => setDrawerOpen(false));

  return (
    <WorkspaceProvider>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-canvas)' }}>
        {isDesktop && (
          <aside
            style={{
              width: SIDEBAR_WIDTH, flexShrink: 0,
              borderRight: '1px solid var(--color-border)',
              background: 'var(--color-canvas)',
              position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
            }}
          >
            <Sidebar />
          </aside>
        )}

        {!isDesktop && (
          <AnimatePresence>
            {drawerOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setDrawerOpen(false)}
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9000 }}
                />
                <motion.aside
                  ref={drawerRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Workspace navigation"
                  tabIndex={-1}
                  initial={{ x: -SIDEBAR_WIDTH }} animate={{ x: 0 }} exit={{ x: -SIDEBAR_WIDTH }}
                  transition={{ duration: 0.2 }}
                  style={{
                    position: 'fixed', top: 0, left: 0, bottom: 0, width: SIDEBAR_WIDTH,
                    background: 'var(--color-canvas)', borderRight: '1px solid var(--color-border)',
                    zIndex: 9001, outline: 'none',
                  }}
                >
                  <Sidebar onNavigate={() => setDrawerOpen(false)} onCloseMobile={() => setDrawerOpen(false)} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <header
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, padding: '12px 20px',
              borderBottom: '1px solid var(--color-border)',
              position: 'sticky', top: 0, background: 'var(--color-canvas)', zIndex: 10,
            }}
          >
            {!isDesktop ? (
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, background: 'none', border: 'none',
                  color: 'var(--color-ink)', cursor: 'pointer',
                }}
              >
                <Menu size={19} />
              </button>
            ) : <span />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {studentSession ? (
                <NotificationBell roll={studentSession.rollNumber} isDark={theme === 'dark'} />
              ) : (
                <button
                  onClick={openRollModal}
                  style={{
                    padding: '7px 16px', background: 'var(--color-brand)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13,
                    fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                  }}
                >
                  Sign in
                </button>
              )}
            </div>
          </header>

          <main style={{ flex: 1, padding: '28px 32px', maxWidth: 1200, width: '100%', margin: '0 auto' }} key={location.pathname}>
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
