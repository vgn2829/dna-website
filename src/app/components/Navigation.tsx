import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation, useNavigate } from 'react-router';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useStudent } from '../context/StudentContext';
import { useTheme } from '../context/ThemeContext';

// PALETTE_STUDIO_FEATURE — remove the Palette entry below to disable
const NAV_LINKS = [
  { label: 'Home',     path: '/' },
  { label: 'Academy',  path: '/academy' },
  { label: 'Gallery',  path: '/gallery' },
  { label: 'Events',   path: '/events' },
  { label: 'Team',     path: '/team' },
  { label: 'Design Studio', path: '/design-studio' }, // PALETTE_STUDIO_FEATURE
];

export function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { studentSession, openRollModal, logout } = useStudent();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-[200] h-14 transition-all"
        style={{
          background: scrolled ? 'var(--color-nav-blur-bg)' : 'var(--color-canvas)',
          backdropFilter: scrolled ? 'blur(12px)' : 'none',
          borderBottom: `1px solid ${scrolled ? 'var(--color-hairline-soft)' : 'transparent'}`,
        }}
      >
        {/*
         * 3-column grid — each column is independently sized.
         * Left: wordmark (no-shrink)  |  Center: nav links (auto)  |  Right: actions (no-shrink)
         * This prevents any column from bleeding into another.
         */}
        <div
          className="h-full"
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            padding: '0 48px',
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
          }}
        >
          {/* ── Left: Wordmark ── */}
          <div className="flex items-center">
            <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', padding: 0, background: 'none', border: 'none' }}>
              <img
                src="/logo.png"
                alt="DnA Club IIT Kanpur"
                className="h-9 w-auto object-contain"
              />
            </button>
          </div>

          {/* ── Centre: Nav links (desktop) / DnA brand text (mobile) ── */}
          <div className="flex items-center justify-center">
          <span
            className="md:hidden"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--color-ink)',
              letterSpacing: '-0.5px',
            }}
          >
            DnA
          </span>
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map(link => {
              const active = isActive(link.path);
              return (
                <button
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  className="relative px-3.5 py-1.5 rounded-full transition-colors"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: '-0.14px',
                    fontFamily: 'var(--font-body)',
                    color: active ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full"
                      style={{ background: 'var(--color-surface-2)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 38 }}
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </button>
              );
            })}
          </nav>
          </div>

          {/* ── Right: Session + CTA (desktop) / Hamburger (mobile) ── */}
          <div className="flex items-center justify-end gap-2">
            {/* Desktop actions */}
            <div className="hidden md:flex items-center gap-2">
              {studentSession ? (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--color-surface-1)' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink)', letterSpacing: '0.02em' }}>
                    {studentSession.rollNumber}
                  </span>
                  <button onClick={logout} title="Log out" style={{ color: 'var(--color-ink-muted)', display: 'flex', alignItems: 'center' }} className="hover:opacity-60 transition-opacity">
                    <LogOut size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={openRollModal}
                  className="btn-secondary"
                  style={{ minHeight: 34, padding: '6px 13px', fontSize: 13 }}
                >
                  Link roll no.
                </button>
              )}

              {/* Admin — subtle icon-only link so it doesn't crowd the bar */}
              <button
                onClick={() => navigate('/admin')}
                className="btn-secondary"
                style={{
                  minHeight: 34,
                  padding: '6px 13px',
                  fontSize: 13,
                  background: isActive('/admin') ? 'var(--color-surface-2)' : 'var(--color-surface-1)',
                  color: isActive('/admin') ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                }}
                title="Admin"
              >
                Admin
              </button>
            </div>

            {/* Theme toggle — all breakpoints */}
            <button
              onClick={toggle}
              className="btn-icon"
              style={{ width: 34, height: 34 }}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Mobile: hamburger */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="md:hidden btn-icon"
              style={{ width: 34, height: 34 }}
              aria-label="Menu"
            >
              {menuOpen ? <X size={15} /> : <Menu size={15} />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile menu overlay ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[199] flex flex-col pt-14"
            style={{ background: 'var(--color-canvas)' }}
          >
            <nav className="flex flex-col px-5 pt-4 gap-0.5">
              {[...NAV_LINKS, { label: 'Admin', path: '/admin' }].map(link => (
                <button
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  className="text-left px-4 py-3 rounded-xl transition-colors"
                  style={{
                    fontSize: 16,
                    fontWeight: 500,
                    letterSpacing: '-0.3px',
                    color: isActive(link.path) ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                    background: isActive(link.path) ? 'var(--color-surface-1)' : 'transparent',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {link.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-3 px-5 mt-6">
              {studentSession ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: 'var(--color-surface-1)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)' }}>{studentSession.rollNumber}</span>
                  <button onClick={logout}><LogOut size={12} style={{ color: 'var(--color-ink-muted)' }} /></button>
                </div>
              ) : (
                <button onClick={() => { setMenuOpen(false); openRollModal(); }} className="btn-secondary">
                  Link roll no.
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
