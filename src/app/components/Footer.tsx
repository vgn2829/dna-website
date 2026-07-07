import { useState, useEffect } from 'react';
import { Instagram, Mail } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { api, type LiveSession, API_BASE, getStudentToken } from '../lib/api';
import { useStudent } from '../context/StudentContext';

// Coordinator identity is proven by the signed student token, not a roll header.
function studentAuthHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const tok = getStudentToken();
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  return h;
}

const COLS = [
  {
    heading: 'Explore',
    links: [
      { label: 'Academy',        path: '/academy'        },
      { label: 'Gallery',        path: '/gallery'        },
      { label: 'Events',         path: '/events'         },
      { label: 'Design Studio',  path: '/design-studio'  },
      { label: 'Moodboards',     path: '/moodboards'     },
      { label: 'Team',           path: '/team'           },
    ],
  },
  {
    heading: 'Club',
    links: [
      { label: 'About DnA', path: '/'       },
      { label: 'Join Us',   path: '/events' },
      { label: 'Admin',     path: '/admin'  },
    ],
  },
];

const SOCIAL = [
  { icon: Instagram, href: 'https://www.instagram.com/dnaiitk/', label: 'Instagram' },
  { icon: Mail,      href: 'mailto:designandanimationclub.iitk@gmail.com', label: 'Email' },
];

export function Footer() {
  const navigate = useNavigate();
  const { studentSession } = useStudent();

  const [meetEnabled, setMeetEnabled] = useState(false);
  const [canSchedule, setCanSchedule] = useState(false);

  // Scheduler modal
  const [showScheduler, setShowScheduler] = useState(false);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [form, setForm] = useState({ title: '', host: '', meet_link: '', scheduled_at: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    api.settings.getPublic().then(s => {
      setMeetEnabled(s['public_meet_enabled'] === 'true');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!studentSession?.rollNumber) { setCanSchedule(false); return; }
    api.coordinators.check(studentSession.rollNumber)
      .then(r => setCanSchedule(r.canSchedule))
      .catch(() => setCanSchedule(false));
  }, [studentSession?.rollNumber]);

  useEffect(() => {
    if (!showScheduler || !canSchedule || !studentSession) return;
    api.liveSessions.getActive(studentSession.rollNumber).then(setSessions).catch(() => {});
  }, [showScheduler, canSchedule, studentSession]);

  const handleCreateSession = async () => {
    if (!studentSession || !form.title || !form.host || !form.meet_link || !form.scheduled_at) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch(`${API_BASE}/live-sessions/coordinator`, {
        method: 'POST',
        headers: studentAuthHeaders(true),
        body: JSON.stringify({
          title: form.title,
          host: form.host,
          meet_link: form.meet_link,
          scheduled_at: form.scheduled_at,
          audience_group_id: null,
          description: form.description || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create session');
      const session = await res.json() as LiveSession;
      setSessions(prev => [session, ...prev]);
      setForm({ title: '', host: '', meet_link: '', scheduled_at: '', description: '' });
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!studentSession) return;
    try {
      await fetch(`${API_BASE}/live-sessions/coordinator/${id}`, {
        method: 'DELETE',
        headers: studentAuthHeaders(),
      });
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {}
  };

  const handleUpdateSessionStatus = async (id: string, status: 'live' | 'ended') => {
    if (!studentSession) return;
    // Optimistic update
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    try {
      await fetch(`${API_BASE}/live-sessions/coordinator/${id}/status`, {
        method: 'PUT',
        headers: studentAuthHeaders(true),
        body: JSON.stringify({ status }),
      });
      // If ended, remove from list after 2 seconds
      if (status === 'ended') {
        setTimeout(() => {
          setSessions(prev => prev.filter(s => s.id !== id));
        }, 2000);
      }
    } catch {
      // Rollback on failure
      setSessions(prev => prev.map(s =>
        s.id === id ? { ...s, status: status === 'live' ? 'upcoming' : 'live' } : s
      ));
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--color-canvas)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 13,
    color: 'var(--color-ink)',
    fontFamily: 'var(--font-body)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <>
      <footer
        style={{
          width: '100%',
          background: 'var(--color-canvas)',
          borderTop: '1px solid var(--color-hairline-soft)',
          padding: '64px 0',
        }}
      >
        <div style={{ maxWidth: 1440, margin: '0 auto', width: '100%', padding: '0 48px', boxSizing: 'border-box' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 40, marginBottom: 48 }}>

            {/* Brand column */}
            <div>
              <p
                className="text-base font-semibold mb-3"
                style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.5px', color: 'var(--color-ink)' }}
              >
                IITK DnA
              </p>
              <p className="type-caption mb-6" style={{ maxWidth: 200 }}>
                IIT Kanpur's community for digital and animation
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {SOCIAL.map(s => {
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.label}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: 'var(--color-surface-1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-ink-muted)',
                        textDecoration: 'none',
                        flexShrink: 0,
                        transition: 'background 0.2s, color 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--color-surface-2)';
                        e.currentTarget.style.color = 'var(--color-ink)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'var(--color-surface-1)';
                        e.currentTarget.style.color = 'var(--color-ink-muted)';
                      }}
                    >
                      <Icon size={16} />
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Link columns */}
            {COLS.map(col => (
              <div key={col.heading}>
                <p style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-ink)',
                  letterSpacing: '-0.13px',
                  lineHeight: 1.20,
                  marginBottom: 16,
                  fontFamily: 'var(--font-body)',
                }}>
                  {col.heading}
                </p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {col.links.map(link => (
                    <li key={link.label}>
                      <button
                        onClick={() => navigate(link.path)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 13,
                          fontWeight: 500,
                          letterSpacing: '-0.13px',
                          lineHeight: 1.20,
                          color: 'var(--color-ink-muted)',
                          textDecoration: 'none',
                          transition: 'color 0.15s',
                          fontFamily: 'var(--font-body)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}
                      >
                        {link.label}
                      </button>
                    </li>
                  ))}
                  {col.heading === 'Club' && meetEnabled && studentSession && canSchedule && (
                    <li>
                      <button
                        onClick={() => setShowScheduler(true)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 13,
                          fontWeight: 500,
                          letterSpacing: '-0.13px',
                          lineHeight: 1.20,
                          color: 'var(--color-brand)',
                          transition: 'opacity 0.15s',
                          fontFamily: 'var(--font-body)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        Schedule a Meet
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            ))}

            {/* Contact column */}
            <div>
              <p style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-ink)',
                letterSpacing: '-0.13px',
                lineHeight: 1.20,
                marginBottom: 16,
                fontFamily: 'var(--font-body)',
              }}>
                Contact
              </p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <li>
                  <a
                    href="mailto:designandanimationclub.iitk@gmail.com"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: '-0.13px',
                      lineHeight: 1.20,
                      color: 'var(--color-accent-blue)',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    designandanimationclub.iitk@gmail.com
                  </a>
                </li>
                <li>
                  <p style={{
                    fontSize: 13,
                    fontWeight: 500,
                    letterSpacing: '-0.13px',
                    lineHeight: 1.20,
                    color: 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    Room No. 210, Indian Institute of Technology Kanpur, Kalyanpur, Kanpur, Uttar Pradesh 208016
                  </p>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar — copyright left, designer credit right */}
          <div style={{
            borderTop: '1px solid var(--color-hairline)',
            marginTop: 48,
            paddingTop: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <p style={{
                fontSize: 12,
                color: 'var(--color-ink-muted)',
                margin: 0,
                letterSpacing: '-0.12px',
                fontFamily: 'var(--font-body)',
              }}>
                © {new Date().getFullYear()} Design &amp; Animation Club, IIT Kanpur
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 12,
                color: 'var(--color-ink-muted)',
                letterSpacing: '-0.12px',
                fontFamily: 'var(--font-body)',
              }}>
                Designed &amp; Developed by{' '}
                <span style={{ color: 'var(--color-ink)', fontWeight: 600 }}>Venugopal</span>
              </span>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a href="https://www.instagram.com/venugopal29_/"
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--color-ink-muted)', display: 'flex', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#E1306C')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                </a>
                <a href="https://www.linkedin.com/in/venugopal29/"
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--color-ink-muted)', display: 'flex', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#0A66C2')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/>
                    <rect x="2" y="9" width="4" height="12"/>
                    <circle cx="4" cy="4" r="2"/>
                  </svg>
                </a>
                <a href="tel:+917019080178"
                  style={{ color: 'var(--color-ink-muted)', display: 'flex', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.56 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Scheduler modal */}
      <AnimatePresence>
        {showScheduler && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setShowScheduler(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 480, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '90vh', overflowY: 'auto' }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                  Schedule a Meet
                </h3>
                <button
                  onClick={() => setShowScheduler(false)}
                  style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-ink-muted)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ×
                </button>
              </div>

              {/* Create form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
                  New Session
                </p>
                <input
                  type="text"
                  placeholder="Title *"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Host name *"
                  value={form.host}
                  onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  style={inputStyle}
                />
                <input
                  type="url"
                  placeholder="Meet link *"
                  value={form.meet_link}
                  onChange={e => setForm(f => ({ ...f, meet_link: e.target.value }))}
                  style={inputStyle}
                />
                <input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={inputStyle}
                />
                {createError && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{createError}</p>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleCreateSession}
                  disabled={creating || !form.title || !form.host || !form.meet_link || !form.scheduled_at}
                  style={{ padding: '13px 0', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1, marginTop: 4 }}
                >
                  {creating ? 'Scheduling…' : 'Schedule Session'}
                </motion.button>
              </div>

              {/* Existing sessions */}
              {sessions.length > 0 && (
                <>
                  <div style={{ height: 1, background: 'var(--color-border)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
                      Upcoming Sessions
                    </p>
                    {sessions.map(s => (
                      <div
                        key={s.id}
                        style={{
                          padding: '12px 14px',
                          background: s.status === 'live' ? 'rgba(233,30,140,0.06)' : 'var(--color-canvas)',
                          border: s.status === 'live' ? '1px solid rgba(233,30,140,0.3)' : '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        {/* Session info */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              {s.status === 'live' && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-brand)', fontFamily: 'var(--font-body)', letterSpacing: '0.06em' }}>
                                  ● LIVE
                                </span>
                              )}
                              {s.status === 'upcoming' && (
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', letterSpacing: '0.06em' }}>
                                  ◆ UPCOMING
                                </span>
                              )}
                            </div>
                            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.title}
                            </p>
                            <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                              {new Date(s.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                              {' · '}{s.host}
                            </p>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {s.status === 'upcoming' && (
                            <button
                              onClick={() => handleUpdateSessionStatus(s.id, 'live')}
                              style={{ flex: 1, padding: '6px 12px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              Go Live
                            </button>
                          )}
                          {s.status === 'live' && (
                            <button
                              onClick={() => handleUpdateSessionStatus(s.id, 'ended')}
                              style={{ flex: 1, padding: '6px 12px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              End Session
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteSession(s.id)}
                            style={{ padding: '6px 12px', background: 'none', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--color-error)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
