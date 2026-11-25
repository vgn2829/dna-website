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
          <h3 className="type-headline" style={{ margin: 0 }}>
            Version History
          </h3>
          <button
            onClick={onClose}
            aria-label="Close version history"
            className="btn-translucent btn-icon btn-sm touch-target"
            style={{ fontSize: 16 }}
          >
            ×
          </button>
        </div>

        {isOwnerOrMember && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-hairline)', flexShrink: 0 }}>
            <button
              onClick={handleManualSave}
              disabled={savingManual}
              className="btn-primary btn-sm"
              style={{ width: '100%' }}
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
              <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
                {error}
              </p>
              <button
                onClick={loadInitial}
                className="btn-translucent btn-sm touch-target"
                style={{ alignSelf: 'center' }}
              >
                Retry
              </button>
            </div>
          ) : versions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px' }}>
              <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
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
                      <span className="type-body-sm" style={{ color: 'var(--color-ink)' }}>
                        {formatTimestamp(version.createdAt)}
                      </span>
                      {isCurrent && (
                        <span className="type-micro" style={{
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
                      <span className="type-caption">
                        {version.createdByName ?? (version.createdByRoll ? version.createdByRoll : 'System')}
                        {' · '}{TRIGGER_LABEL[version.trigger]}
                      </span>
                    </div>

                    {version.description && (
                      <p className="type-micro" style={{ margin: 0, fontStyle: 'italic' }}>
                        "{version.description}"
                      </p>
                    )}

                    {!isCurrent && isOwnerOrMember && (
                      <button
                        onClick={() => setConfirmRestore(version)}
                        className="btn-translucent btn-sm touch-target"
                        style={{ alignSelf: 'flex-start', marginTop: 2 }}
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
                  className="btn-translucent btn-sm touch-target"
                  style={{ alignSelf: 'center' }}
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
                borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl) var(--space-lg)', boxShadow: 'var(--shadow-level-2)',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}
            >
              <h3 className="type-headline" style={{ margin: 0 }}>
                Restore this version?
              </h3>
              <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
                The board will be restored to how it looked {formatTimestamp(confirmRestore.createdAt).toLowerCase()}.
                Nothing is deleted — this creates a new version, so you can always undo by restoring again.
                {' '}If anyone else has this board open, they'll briefly reconnect once the restore completes.
              </p>
              {restoreError && (
                <p className="type-micro" style={{ margin: 0, color: 'var(--color-error)' }}>
                  {restoreError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleConfirmRestore}
                  disabled={restoring}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  {restoring ? 'Restoring…' : 'Restore'}
                </button>
                <button
                  onClick={() => { setConfirmRestore(null); setRestoreError(''); }}
                  disabled={restoring}
                  className="btn-translucent"
                  style={{ flex: 1 }}
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
