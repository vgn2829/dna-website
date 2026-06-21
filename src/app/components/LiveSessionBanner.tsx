import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api, LiveSession } from '../lib/api';
import { useStudent } from '../context/StudentContext';

export default function LiveSessionBanner() {
  const { studentSession } = useStudent();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [joinCount, setJoinCount] = useState<number>(0);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await api.liveSessions.getActive(
          studentSession?.rollNumber
        );
        setSessions(data);
      } catch {
        // Silent fail — banner is non-critical
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 60000);
    return () => clearInterval(interval);
  }, [studentSession?.rollNumber]);

  const visible = sessions.filter(s => !dismissed.includes(s.id));

  const primary = visible.find(s => s.status === 'live') ?? visible[0];

  useEffect(() => {
    if (primary?.status === 'live') {
      api.liveSessions.getJoinCount(primary.id)
        .then(d => setJoinCount(d.count))
        .catch(() => {});

      const interval = setInterval(() => {
        api.liveSessions.getJoinCount(primary.id)
          .then(d => setJoinCount(d.count))
          .catch(() => {});
      }, 30000);
      return () => clearInterval(interval);
    } else {
      setJoinCount(0);
    }
  }, [primary?.id, primary?.status]);

  if (visible.length === 0) return null;

  const isLive = primary.status === 'live';

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    if (d.toDateString() === today.toDateString()) {
      return `Today at ${formatTime(iso)}`;
    }
    if (d.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow at ${formatTime(iso)}`;
    }
    return (
      d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
      ` at ${formatTime(iso)}`
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        key={primary.id}
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -40 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 8000,
          background: isLive ? '#E91E8C' : 'var(--color-surface)',
          borderBottom: isLive ? 'none' : '1px solid var(--color-border)',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* Left — status + info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {isLive && (
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <motion.div
                animate={{ scale: [1, 1.6, 1], opacity: [1, 0, 1] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.5)',
                }}
              />
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#fff',
                position: 'relative',
              }} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: isLive ? '#fff' : 'var(--color-ink)',
              fontFamily: 'var(--font-body)',
              whiteSpace: 'nowrap',
            }}>
              {isLive ? 'Live now' : formatDate(primary.scheduled_at)}
              {' — '}
              {primary.title}
            </span>
            <span style={{
              fontSize: 12,
              color: isLive ? 'rgba(255,255,255,0.75)' : 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
              whiteSpace: 'nowrap',
            }}>
              Hosted by {primary.host}
            </span>
            {isLive && joinCount > 0 && (
              <span style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.75)',
                fontFamily: 'var(--font-body)',
                whiteSpace: 'nowrap',
              }}>
                · {joinCount} joined
              </span>
            )}

            {primary.audience_group_id &&
             primary.audience_group_id !== 'all_students' && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 100,
                background: isLive ? 'rgba(255,255,255,0.2)' : 'rgba(233,30,140,0.1)',
                color: isLive ? '#fff' : '#E91E8C',
                fontFamily: 'var(--font-body)',
              }}>
                {primary.audience_name}
              </span>
            )}
          </div>
        </div>

        {/* Right — join button + dismiss */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {primary.canAccess && primary.meet_link ? (
            <a
              href={primary.meet_link ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (studentSession?.rollNumber && primary.meet_link) {
                  api.liveSessions.trackJoin(primary.id, studentSession.rollNumber).catch(() => {});
                }
              }}
              style={{
                padding: '6px 16px',
                borderRadius: 100,
                background: isLive ? '#fff' : '#E91E8C',
                color: isLive ? '#E91E8C' : '#fff',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {isLive ? 'Join Meet' : 'View'}
            </a>
          ) : primary.audience_group_id &&
            primary.audience_group_id !== 'all_students' &&
            !primary.canAccess ? (
            <span style={{
              fontSize: 12,
              color: isLive ? 'rgba(255,255,255,0.6)' : 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
            }}>
              Team only
            </span>
          ) : null}

          <button
            onClick={() => setDismissed(prev => [...prev, primary.id])}
            aria-label="Dismiss"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: isLive
                ? '1px solid rgba(255,255,255,0.3)'
                : '1px solid var(--color-border)',
              background: 'none',
              color: isLive ? '#fff' : 'var(--color-ink-muted)',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
