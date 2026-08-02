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

function SessionGate({ isAdminPage }: { isAdminPage: boolean }) {
  const { studentSession } = useStudent();
  if (isAdminPage || studentSession) return null;
  return <JoinPrompt />;
}

export function Root() {
  const { pathname } = useLocation();
  const isBoardPage = pathname.startsWith('/moodboards/') && pathname !== '/moodboards';
  const isAdminPage = pathname.startsWith('/admin');

  useEffect(() => {
    if (!isBoardPage) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
            {!isBoardPage && !isAdminPage && <LiveSessionBanner />}
            {!isBoardPage && <Navigation />}
            {!isAdminPage && <RollModal />}
            <SessionGate isAdminPage={isAdminPage} />

            {isBoardPage ? (
              <Outlet />
            ) : (
              <>
                <main style={{ paddingTop: '72px' }}>
                  <Outlet />
                </main>
                <Footer />
                <BackToTop />
              </>
            )}
          </div>
        </AppDataProvider>
      </StudentProvider>
    </ThemeProvider>
  );
}
