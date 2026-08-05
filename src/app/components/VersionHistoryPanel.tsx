import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api, type BoardVersion, type VersionTrigger } from '../lib/api';
import { rollToColor } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────
// VERSION HISTORY PANEL — the UI for Commit 5. Deliberately dumb: it only
// calls api.boards.getVersions/createVersion/restoreVersion (metadata-only
// list + two mutations) and renders what comes back. All the actual
// decisions — when a checkpoint happens automatically, what counts as a
// "major change," retention, restore orchestration, reconnect handling —
// live entirely on the backend (see backend/src/realtime/history/ and
// docs/realtime-collaboration-rollout.md's Commit 5 section). This
// component has zero WebSocket/tldraw/sync awareness; it's a plain REST
// list + confirm-then-POST panel, same shape as the existing
// Share/Collaborators modals in BoardPage.tsx.
//
// PERFORMANCE: versions are fetched ONLY when this panel is opened
// (see BoardPage.tsx — the panel isn't mounted until showVersionHistory is
// true), never on board load, and the list endpoint never returns snapshot
// content — see api.ts's own comment on getVersions.
// ─────────────────────────────────────────────────────────────────────────

const TRIGGER_LABEL: Record<VersionTrigger, string> = {
  explicit: 'Manual save',
  inactivity: 'Auto-saved',
  major_change: 'Auto-saved (large change)',
  restore: 'Restored',
  rename: 'Board renamed',
  archive: 'Board archived',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

interface VersionHistoryPanelProps {
  boardId: string;
  actorRoll: string;
  isOwnerOrMember: boolean;
  onClose: () => void;
  // Called after a successful restore so BoardPage can show its own
  // "collaborators are reconnecting" hint if hadLiveRoom was true — this
  // panel doesn't know or care about the realtime connection status itself.
  onRestored: (hadLiveRoom: boolean) => void;
}

export function VersionHistoryPanel({ boardId, actorRoll, isOwnerOrMember, onClose, onRestored }: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<BoardVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const [savingManual, setSavingManual] = useState(false);

  const [confirmRestore, setConfirmRestore] = useState<BoardVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  // Guards against a slow first fetch resolving after a faster
  // subsequent one (e.g. this panel closing/reopening quickly, or two
  // loadMore calls racing) from clobbering newer state with stale data.
  const requestIdRef = useRef(0);

  const loadInitial = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const page = await api.boards.getVersions(boardId, actorRoll);
      if (requestIdRef.current !== requestId) return;
      setVersions(page.versions);
      setHasMore(page.hasMore);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setError('Failed to load version history.');
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [boardId, actorRoll]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  const handleLoadMore = async () => {
    const last = versions[versions.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await api.boards.getVersions(boardId, actorRoll, { before: last.createdAt });
      setVersions(prev => [...prev, ...page.versions]);
      setHasMore(page.hasMore);
    } catch {
      // Non-fatal — the list just doesn't grow; the user can retry by
      // clicking "Load more" again rather than losing what's already shown.
    } finally {
      setLoadingMore(false);
    }
  };

  const handleManualSave = async () => {
    setSavingManual(true);
    try {
      const version = await api.boards.createVersion(boardId, actorRoll);
      setVersions(prev => [version, ...prev.filter(v => v.id !== version.id)]);
    } catch {
      setError('Failed to save a version.');
    } finally {
      setSavingManual(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!confirmRestore) return;
    setRestoring(true);
    setRestoreError('');
    try {
      const res = await api.boards.restoreVersion(boardId, actorRoll, confirmRestore.id);
      // The restore itself becomes a new version at the top of the
      // timeline (see backend's RestoreService — history only ever grows).
      setVersions(prev => [res.version, ...prev]);
      setConfirmRestore(null);
      onRestored(res.hadLiveRoom);
    } catch {
      setRestoreError('Failed to restore this version. Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  const currentVersionId = versions[0]?.id ?? null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed', top: 48, right: 0, bottom: 0, width: 340, zIndex: 9000,
          background: 'var(--color-surface-1)', borderLeft: '1px solid var(--color-hairline)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--color-hairline)', flexShrink: 0,
        }}>
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 700,
            color: 'var(--color-ink)', fontFamily: 'var(--font-display)',
          }}>
            Version History
          </h3>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 'var(--radius-full)',
              border: '1px solid var(--color-hairline)', background: 'none',
              color: 'var(--color-ink-muted)', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {isOwnerOrMember && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-hairline)', flexShrink: 0 }}>
            <button
              onClick={handleManualSave}
              disabled={savingManual}
              style={{
                width: '100%', padding: '9px 0', background: 'var(--color-brand)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 600,
                fontFamily: 'var(--font-body)', cursor: savingManual ? 'not-allowed' : 'pointer',
                opacity: savingManual ? 0.6 : 1,
              }}
            >
              {savingManual ? 'Saving…' : 'Save a version now'}
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 8px' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton-pulse" style={{
                  height: 52, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)',
                }} />
              ))}
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                {error}
              </p>
              <button
                onClick={loadInitial}
                style={{
                  padding: '8px 16px', background: 'var(--color-surface-2)', color: 'var(--color-ink)',
                  border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12,
                  fontFamily: 'var(--font-body)', cursor: 'pointer', alignSelf: 'center',
                }}
              >
                Retry
              </button>
            </div>
          ) : versions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                No versions yet. This board will automatically save versions as you work, or you can save one manually.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {versions.map(version => {
                const isCurrent = version.id === currentVersionId;
                return (
                  <div
                    key={version.id}
                    style={{
                      padding: '10px 10px', borderRadius: 'var(--radius-md)',
                      background: isCurrent ? 'rgba(233,30,140,0.08)' : 'transparent',
                      border: isCurrent ? '1px solid rgba(233,30,140,0.25)' : '1px solid transparent',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                        {formatTimestamp(version.createdAt)}
                      </span>
                      {isCurrent && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                          padding: '2px 6px', borderRadius: 'var(--radius-pill)',
                          background: 'var(--color-brand)', color: '#fff', flexShrink: 0,
                        }}>
                          Current
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {version.createdByRoll && (
                        <span style={{
                          width: 16, height: 16, borderRadius: 'var(--radius-full)', flexShrink: 0,
                          background: rollToColor(version.createdByRoll),
                          fontSize: 8, fontWeight: 700, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'var(--font-body)',
                        }}>
                          {(version.createdByName ?? version.createdByRoll)[0].toUpperCase()}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                        {version.createdByName ?? (version.createdByRoll ? version.createdByRoll : 'System')}
                        {' · '}{TRIGGER_LABEL[version.trigger]}
                      </span>
                    </div>

                    {version.description && (
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontStyle: 'italic' }}>
                        "{version.description}"
                      </p>
                    )}

                    {!isCurrent && isOwnerOrMember && (
                      <button
                        onClick={() => setConfirmRestore(version)}
                        style={{
                          alignSelf: 'flex-start', marginTop: 2, padding: '4px 10px',
                          background: 'none', border: '1px solid var(--color-hairline)',
                          borderRadius: 'var(--radius-pill)', color: 'var(--color-ink)',
                          fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                        }}
                      >
                        Restore this version
                      </button>
                    )}
                  </div>
                );
              })}

              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  style={{
                    margin: '8px auto 4px', padding: '8px 16px', background: 'none',
                    border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-pill)',
                    color: 'var(--color-ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)',
                    cursor: loadingMore ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Restore confirmation — separate from the panel's own exit
          animation/unmount, rendered as a true modal overlay so it reads as
          a deliberate, blocking decision rather than part of the scrollable list. */}
      <AnimatePresence>
        {confirmRestore && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
            onClick={() => { if (!restoring) { setConfirmRestore(null); setRestoreError(''); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 380,
                background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-xl)', padding: '28px 24px',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
                Restore this version?
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                The board will be restored to how it looked {formatTimestamp(confirmRestore.createdAt).toLowerCase()}.
                Nothing is deleted — this creates a new version, so you can always undo by restoring again.
                {' '}If anyone else has this board open, they'll briefly reconnect once the restore completes.
              </p>
              {restoreError && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                  {restoreError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleConfirmRestore}
                  disabled={restoring}
                  style={{
                    flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600,
                    fontFamily: 'var(--font-body)', cursor: restoring ? 'not-allowed' : 'pointer',
                  }}
                >
                  {restoring ? 'Restoring…' : 'Restore'}
                </button>
                <button
                  onClick={() => { setConfirmRestore(null); setRestoreError(''); }}
                  disabled={restoring}
                  style={{
                    flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)',
                    border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-pill)',
                    fontSize: 13, fontFamily: 'var(--font-body)', cursor: restoring ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
