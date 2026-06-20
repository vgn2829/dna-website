import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Navigation } from './Navigation';
import { Footer } from './Footer';
import { RollModal } from './RollModal';
import { BackToTop } from './BackToTop';
import JoinPrompt from './JoinPrompt';
import { ThemeProvider } from '../context/ThemeContext';
import { StudentProvider, useStudent } from '../context/StudentContext';
import { AppDataProvider } from '../context/AppDataContext';

function SessionGate() {
  const { studentSession } = useStudent();
  if (studentSession) return null;
  return <JoinPrompt />;
}

export function Root() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);

  return (
    <ThemeProvider>
      <StudentProvider>
        <AppDataProvider>
          <div className="min-h-screen" style={{ background: 'var(--color-canvas)', color: 'var(--color-ink)' }}>
            <Navigation />
            <RollModal />
            <SessionGate />

            {/* 56px nav offset */}
            <main style={{ paddingTop: '56px' }}>
              <Outlet />
            </main>

            <Footer />
            <BackToTop />
          </div>
        </AppDataProvider>
      </StudentProvider>
    </ThemeProvider>
  );
}
