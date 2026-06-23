import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation, useNavigate } from 'react-router';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useStudent } from '../context/StudentContext';
import { useTheme } from '../context/ThemeContext';

// PALETTE_STUDIO_FEATURE — remove the Palette entry below to disable
const NAV_LINKS = [
  { label: 'Home',          path: '/'              },
  { label: 'Academy',       path: '/academy'       },
  { label: 'Gallery',       path: '/gallery'       },
  { label: 'Events',        path: '/events'        },
  { label: 'Team',          path: '/team'          },
  { label: 'Design Studio', path: '/design-studio' },
  { label: 'Moodboards',    path: '/moodboards'    },
];

export function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { studentSession, openRollModal, logout } = useStudent();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const isDark = theme === 'dark';

  return (
    <>
      {/* ── Floating pill container ── */}
      <div
        style={{
          position: 'fixed',
          top: 12,
          left: 0,
          right: 0,
          zIndex: 200,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 16px',
          pointerEvents: 'none',
        }}
      >
        <div
          ref={menuRef}
          style={{
            pointerEvents: 'all',
            width: '100%',
            maxWidth: 1200,
            position: 'relative',
          }}
        >
          {/* ── Main pill ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px 6px 8px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--nav-bg)',
              backdropFilter: 'var(--nav-blur)',
              WebkitBackdropFilter: 'var(--nav-blur)',
              border: '1px solid var(--nav-border)',
              boxShadow: 'var(--nav-shadow)',
              gap: 8,
              position: 'relative',
            }}
          >
            {/* ── Left: Logo pill ── */}
            <button
              onClick={() => navigate('/')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px 4px 4px',
                borderRadius: 'var(--radius-pill)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <img
                src="/logo.png"
                alt="DnA Club"
                style={{
                  height: 28,
                  width: 28,
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-full)',
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--color-ink)',
                  letterSpacing: '-0.4px',
                }}
                className="hidden sm:inline"
              >
                DnA
              </span>
            </button>

            {/* ── Center: Nav links (desktop) ── */}
            <nav
              className="hidden md:flex"
              style={{
                alignItems: 'center',
                gap: 2,
                flex: 1,
                justifyContent: 'center',
              }}
            >
              {NAV_LINKS.map(link => {
                const active = isActive(link.path);
                return (
                  <button
                    key={link.path}
                    onClick={() => navigate(link.path)}
                    style={{
                      position: 'relative',
                      padding: '7px 14px',
                      borderRadius: 'var(--radius-pill)',
                      border: 'none',
                      background: 'none',
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: '-0.13px',
                      fontFamily: 'var(--font-body)',
                      color: active ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.color = 'var(--color-ink)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.color = 'var(--color-ink-muted)';
                      }
                    }}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: 'var(--radius-pill)',
                          background: isDark
                            ? 'rgba(255,255,255,0.1)'
                            : 'rgba(0,0,0,0.07)',
                          zIndex: 0,
                        }}
                        transition={{
                          type: 'spring',
                          stiffness: 400,
                          damping: 38,
                        }}
                      />
                    )}
                    <span style={{ position: 'relative', zIndex: 1 }}>
                      {link.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* ── Center: DnA text (mobile only) ── */}
            <span
              className="md:hidden"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--color-ink)',
                letterSpacing: '-0.4px',
                pointerEvents: 'none',
              }}
            >
              DnA
            </span>

            {/* ── Right: User + theme + hamburger ── */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              {/* Student session pill — desktop */}
              <div className="hidden md:flex items-center">
                {studentSession ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-pill)',
                      background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                      border: '1px solid var(--nav-border)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: 'var(--font-body)',
                        color: 'var(--color-ink)',
                        letterSpacing: '0.02em',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1.2,
                      }}>
                        {studentSession.name
                          ? studentSession.name.split(' ')[0]
                          : studentSession.rollNumber
                        }
                      </span>
                      {studentSession.name && (
                        <span style={{
                          fontSize: 10,
                          color: 'var(--color-ink-muted)',
                          fontFamily: 'var(--font-body)',
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: 1,
                        }}>
                          {studentSession.rollNumber}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={logout}
                      title="Log out"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-ink-muted)',
                        cursor: 'pointer',
                        padding: 0,
                        opacity: 0.7,
                        transition: 'opacity 0.15s ease',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.opacity = '1';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.opacity = '0.7';
                      }}
                    >
                      <LogOut size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={openRollModal}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-pill)',
                      background: 'var(--color-brand)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: 'var(--font-body)',
                      cursor: 'pointer',
                      letterSpacing: '-0.13px',
                    }}
                  >
                    Join
                  </button>
                )}
              </div>

              {/* Theme toggle */}
              <button
                onClick={toggle}
                aria-label="Toggle theme"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--nav-border)',
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  color: 'var(--color-ink-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.color = 'var(--color-ink)';
                  (e.currentTarget as HTMLElement).style.background = isDark
                    ? 'rgba(255,255,255,0.12)'
                    : 'rgba(0,0,0,0.08)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.color = 'var(--color-ink-muted)';
                  (e.currentTarget as HTMLElement).style.background = isDark
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(0,0,0,0.04)';
                }}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>

              {/* Hamburger — mobile + tablet */}
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="md:hidden"
                aria-label="Menu"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--nav-border)',
                  background: menuOpen
                    ? isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
                    : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  color: 'var(--color-ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={menuOpen ? 'close' : 'open'}
                    initial={{ opacity: 0, rotate: -90, scale: 0.7 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 90, scale: 0.7 }}
                    transition={{ duration: 0.15 }}
                    style={{ display: 'flex' }}
                  >
                    {menuOpen ? <X size={15} /> : <Menu size={15} />}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
          </div>

          {/* ── Mobile dropdown menu ── */}
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  borderRadius: 'var(--radius-xxl)',
                  background: 'var(--nav-bg)',
                  backdropFilter: 'var(--nav-blur)',
                  WebkitBackdropFilter: 'var(--nav-blur)',
                  border: '1px solid var(--nav-border)',
                  boxShadow: 'var(--nav-shadow)',
                  padding: 8,
                  zIndex: 199,
                  overflow: 'hidden',
                }}
              >
                {/* Nav links */}
                <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {NAV_LINKS.map((link, i) => {
                    const active = isActive(link.path);
                    return (
                      <motion.button
                        key={link.path}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03, duration: 0.2 }}
                        onClick={() => navigate(link.path)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 16px',
                          borderRadius: 'var(--radius-md)',
                          border: 'none',
                          background: active
                            ? isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
                            : 'none',
                          fontSize: 15,
                          fontWeight: active ? 600 : 500,
                          letterSpacing: '-0.2px',
                          fontFamily: 'var(--font-body)',
                          color: active ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {link.label}
                      </motion.button>
                    );
                  })}
                </nav>

                {/* Divider */}
                <div style={{ height: 1, background: 'var(--nav-border)', margin: '8px 0' }} />

                {/* Session row */}
                <div style={{
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}>
                  {studentSession ? (
                    <>
                      <div>
                        <p style={{
                          margin: 0,
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--color-ink)',
                          fontFamily: 'var(--font-body)',
                        }}>
                          {studentSession.name ?? studentSession.rollNumber}
                        </p>
                        {studentSession.name && (
                          <p style={{
                            margin: 0,
                            fontSize: 11,
                            color: 'var(--color-ink-muted)',
                            fontFamily: 'var(--font-body)',
                          }}>
                            {studentSession.rollNumber}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => { logout(); setMenuOpen(false); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 14px',
                          borderRadius: 'var(--radius-pill)',
                          background: 'none',
                          border: '1px solid var(--nav-border)',
                          color: 'var(--color-ink-muted)',
                          fontSize: 13,
                          fontFamily: 'var(--font-body)',
                          cursor: 'pointer',
                        }}
                      >
                        <LogOut size={12} />
                        Log out
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setMenuOpen(false); openRollModal(); }}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--color-brand)',
                        color: '#fff',
                        border: 'none',
                        fontSize: 14,
                        fontWeight: 600,
                        fontFamily: 'var(--font-body)',
                        cursor: 'pointer',
                      }}
                    >
                      Join DnA Club
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
