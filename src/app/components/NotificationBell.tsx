import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Bell } from 'lucide-react';
import { api, type Notification } from '../lib/api';
import { useModalA11y } from './hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// Basic Notifications (Phase C) — a bell in the global nav (Navigation.tsx),
// visible for any signed-in student on any page, not just Moodboard pages.
// No realtime channel: refetches on open, same "poll/refetch on open, no
// new WebSocket infrastructure" approach the rest of this phase uses (see
// backend/src/routes/notifications.ts's own header comment). Self-
// contained the same way ShareBoardDialog/AssetLibrary are — only needs a
// roll from its caller.
// ─────────────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<Notification['type'], (n: Notification) => string> = {
  board_shared: n => `${n.actorName ?? n.actorRoll ?? 'Someone'} added you to "${n.boardName ?? 'a board'}"`,
  workspace_added: n => `${n.actorName ?? n.actorRoll ?? 'Someone'} added you to "${n.workspaceName ?? 'a workspace'}"`,
  workspace_role_changed: n => `Your role in "${n.workspaceName ?? 'a workspace'}" was changed`,
  comment_created: n => `${n.actorName ?? n.actorRoll ?? 'Someone'} commented on "${n.boardName ?? 'your board'}"`,
  comment_replied: n => `${n.actorName ?? n.actorRoll ?? 'Someone'} replied to your comment on "${n.boardName ?? 'a board'}"`,
  comment_mentioned: n => `${n.actorName ?? n.actorRoll ?? 'Someone'} mentioned you in a comment on "${n.boardName ?? 'a board'}"`,
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

// Where clicking a notification takes the user — a board-scoped event
// (comment/reply/share) always goes to the board itself (comments don't
// have their own route to deep-link to; the board page is the right
// destination). A workspace-only event has nowhere more specific than the
// dashboard to go, so it navigates there. Returns null when a
// notification has neither (defensive only — every current event type
// always populates one or the other).
function navigationTarget(n: Notification): string | null {
  if (n.boardId) return `/moodboards/${n.boardId}`;
  if (n.workspaceId) return '/moodboards';
  return null;
}

export function NotificationBell({ roll, isDark }: { roll: string; isDark: boolean }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useModalA11y(open, () => setOpen(false));

  // Lightweight background refresh of just the unread count, independent
  // of opening the panel — so the badge can reflect new activity without
  // requiring the user to open the panel first. Deliberately polling, not
  // a WebSocket: this is exactly the "lightweight polling if already
  // appropriate" option the spec allows, at an interval low enough to
  // never be mistaken for realtime.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api.notifications.list(roll, { unreadOnly: true })
        .then(data => { if (!cancelled) setUnreadCount(data.unreadCount); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [roll]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.notifications.list(roll)
      .then(data => {
        if (cancelled) return;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, roll]);

  const handleMarkAllRead = async () => {
    const previous = notifications;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.notifications.markAllRead(roll);
    } catch {
      setNotifications(previous);
    }
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      setUnreadCount(prev => Math.max(0, prev - 1));
      api.notifications.markRead(roll, n.id).catch(() => {});
    }
    setOpen(false);
    const target = navigationTarget(n);
    if (target) navigate(target);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(prev => !prev)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, background: 'none', border: 'none',
          color: 'var(--color-ink-muted)', cursor: 'pointer', padding: 0,
        }}
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: -2, right: -2,
              minWidth: 14, height: 14, padding: '0 3px', borderRadius: 'var(--radius-full)',
              background: 'var(--color-brand)', color: '#fff',
              fontSize: 9, fontWeight: 700, lineHeight: '14px', textAlign: 'center',
              fontFamily: 'var(--font-body)',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 8000 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.96, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -6 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'absolute', top: 36, right: 0, zIndex: 8001,
                width: 320, maxHeight: 420, overflowY: 'auto',
                background: isDark ? '#1a1a1a' : '#fff',
                border: '1px solid var(--color-hairline, var(--color-border))',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
                outline: 'none',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderBottom: '1px solid var(--color-hairline, var(--color-border))',
              }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                  Notifications
                </p>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    style={{
                      padding: 0, background: 'none', border: 'none',
                      color: 'var(--color-brand)', fontSize: 11, fontWeight: 600,
                      fontFamily: 'var(--font-body)', cursor: 'pointer',
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {loading && !loaded ? (
                <div style={{ padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton-pulse" style={{ height: 32, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)' }} />
                  ))}
                </div>
              ) : loadError ? (
                <p style={{ padding: '24px 14px', margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)', textAlign: 'center' }}>
                  Failed to load notifications.
                </p>
              ) : notifications.length === 0 ? (
                <p style={{ padding: '24px 14px', margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', textAlign: 'center' }}>
                  No notifications yet.
                </p>
              ) : (
                <div>
                  {notifications.map(n => (
                    <button
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '10px 14px', background: n.read ? 'none' : 'color-mix(in srgb, var(--color-brand) 6%, transparent)',
                        border: 'none', borderBottom: '1px solid var(--color-hairline, var(--color-border))',
                        cursor: 'pointer', position: 'relative',
                      }}
                    >
                      {!n.read && (
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute', top: 14, left: 5,
                            width: 6, height: 6, borderRadius: '50%', background: 'var(--color-brand)',
                          }}
                        />
                      )}
                      <p style={{
                        margin: 0, paddingLeft: 10, fontSize: 12, lineHeight: 1.4,
                        color: 'var(--color-ink)', fontFamily: 'var(--font-body)',
                        fontWeight: n.read ? 400 : 600,
                      }}>
                        {TYPE_LABEL[n.type](n)}
                      </p>
                      <p style={{ margin: '3px 0 0', paddingLeft: 10, fontSize: 10, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                        {timeAgo(n.createdAt)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
