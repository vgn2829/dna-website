import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Navigation } from './Navigation';
import { Footer } from './Footer';
import { RollModal } from './RollModal';
import { StudentProvider } from '../context/StudentContext';
import { AppDataProvider } from '../context/AppDataContext';

export function Root() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);

  return (
    <StudentProvider>
      <AppDataProvider>
        <div className="min-h-screen" style={{ background: 'var(--color-canvas)', color: 'var(--color-ink)' }}>
          <Navigation />
          <RollModal />

          {/* 56px nav offset — mobile gets no bottom padding since nav is now top-only */}
          <main style={{ paddingTop: '56px' }}>
            <Outlet />
          </main>

          <Footer />
        </div>
      </AppDataProvider>
    </StudentProvider>
  );
}
