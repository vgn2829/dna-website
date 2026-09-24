import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Navigation } from './Navigation';
import { Footer } from './Footer';
import { RollModal } from './RollModal';
import { BackToTop } from './BackToTop';
import JoinPrompt from './JoinPrompt';
import LiveSessionBanner from './LiveSessionBanner';
import { ThemeProvider } from '../context/ThemeContext';
import { StudentProvider, useStudent } from '../context/StudentContext';
import { AppDataProvider } from '../context/AppDataContext';
import { Toaster } from './ui/sonner';
import { SITE_NAV_OFFSET } from '../lib/layout';

function SessionGate({ isAdminPage }: { isAdminPage: boolean }) {
  const { studentSession } = useStudent();
  if (isAdminPage || studentSession) return null;
  return <JoinPrompt />;
}

// Path prefixes owned by the workspace app shell (WorkspaceShell.tsx) —
// V2.0's Home/Moodboards/Assets/Projects/Templates. Root suppresses its
// own Navigation/Footer/padded <main> chrome for these exactly like it
// already does for the board canvas below, since WorkspaceShell renders
// its own sidebar/header instead. This is the ONLY change V2.0 makes to
// Root.tsx — every public/marketing route (/, /academy, /resources,
// /gallery, /events, /team, /palette, /design-studio) and /admin keep
// rendering through Root's existing chrome exactly as before.
const WORKSPACE_SHELL_PREFIXES = ['/home', '/moodboards', '/assets', '/projects', '/templates'];

function isWorkspaceShellPath(pathname: string): boolean {
  // /moodboards/:id (the board canvas) is explicitly excluded — it keeps
  // its own full-screen canvas layout (under the public navbar — see
  // BoardPage's canvas container), not the sidebar shell.
  if (pathname.startsWith('/moodboards/') && pathname !== '/moodboards') return false;
  return WORKSPACE_SHELL_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function Root() {
  const { pathname } = useLocation();
  const isBoardPage = pathname.startsWith('/moodboards/') && pathname !== '/moodboards';
  const isAdminPage = pathname.startsWith('/admin');
  const isWorkspaceShell = isWorkspaceShellPath(pathname);

  useEffect(() => {
    // #root (not window) is the actual scroll container — see BackToTop.tsx
    // for why (overflow-x:hidden on #root forces a computed overflow-y:auto).
    // window.scrollTo here would be a silent no-op.
    if (!isBoardPage) {
      document.getElementById('root')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [pathname, isBoardPage]);

  return (
    <ThemeProvider>
      <StudentProvider>
        <AppDataProvider>
          <div
            className="min-h-screen"
            style={{ background: 'var(--color-canvas)', color: 'var(--color-ink)' }}
          >
            {!isBoardPage && !isAdminPage && !isWorkspaceShell && <LiveSessionBanner />}
            {/* The public navbar also shows above a board (/moodboards/:id);
                BoardPage offsets its canvas container by SITE_NAV_OFFSET and
                sits below the navbar's z-index. Browser fullscreen shows only
                the board's container, so the navbar never enters fullscreen. */}
            {!isWorkspaceShell && <Navigation />}
            {!isAdminPage && <RollModal />}
            <SessionGate isAdminPage={isAdminPage} />

            {isBoardPage || isWorkspaceShell ? (
              <Outlet />
            ) : (
              <>
                <main style={{ paddingTop: SITE_NAV_OFFSET }}>
                  <Outlet />
                </main>
                <Footer />
                <BackToTop />
              </>
            )}
          </div>
          <Toaster position="bottom-right" richColors closeButton />
        </AppDataProvider>
      </StudentProvider>
    </ThemeProvider>
  );
}
