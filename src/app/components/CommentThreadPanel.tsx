import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { rollToColor } from '../lib/utils';
import type { BoardComment } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// CommentThreadPanel — the slide-in panel for either drafting a brand new
// thread ('draft' mode, right after a comment-mode canvas click) or viewing
// an existing thread with its replies ('thread' mode). Same slide-in-from-
// the-right visual language as VersionHistoryPanel.tsx, positioned lower
// (top: 96px vs 48px) so the two panels can coexist without full overlap if
// a user somehow triggers both — in practice BoardPage only ever shows one
// at a time, but this is a cheap, correct default rather than an assumption.
//
// This component is pure UI: every mutation is a prop callback into
// useBoardComments (via CommentsOverlay) — it has no fetch/api.ts import of
// its own, matching VersionHistoryPanel's "deliberately dumb" shape.
// ─────────────────────────────────────────────────────────────────────────

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

interface CommentAuthorRowProps {
  roll: string;
  name: string | null;
  timestamp: string;
}

function CommentAuthorRow({ roll, name, timestamp }: CommentAuthorRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        aria-hidden="true"
        style={{
          width: 22, height: 22, borderRadius: 'var(--radius-full)', flexShrink: 0,
          background: rollToColor(roll),
          fontSize: 10, fontWeight: 700, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-body)',
        }}
      >
        {(name ?? roll)[0].toUpperCase()}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
          {name ?? roll}
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          {formatTimestamp(timestamp)}
        </span>
      </div>
    </div>
  );
}

interface CommentRowProps {
  comment: BoardComment;
  currentRoll: string | undefined;
  canModerate: boolean;
  onEdit: (content: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}

function CommentRow({ comment, currentRoll, canModerate, onEdit, onDelete }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = comment.authorRoll === currentRoll || canModerate;

  const handleSaveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === comment.content) { setEditing(false); return; }
    setBusy(true);
    const ok = await onEdit(trimmed);
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <CommentAuthorRow roll={comment.authorRoll} name={comment.authorName} timestamp={comment.createdAt} />
        {canManage && !editing && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => { setDraft(comment.content); setEditing(true); }}
              aria-label="Edit comment"
              style={iconButtonStyle}
            >
              ✎
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete comment"
              style={iconButtonStyle}
            >
              🗑
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 30 }}>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            aria-label="Edit comment content"
            style={textareaStyle}
            rows={2}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleSaveEdit} disabled={busy} style={primaryPillStyle}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} style={secondaryPillStyle}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p style={{
          margin: 0, paddingLeft: 30, fontSize: 12.5, lineHeight: 1.5,
          color: 'var(--color-ink)', fontFamily: 'var(--font-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {comment.content}
          {comment.updatedAt !== comment.createdAt && (
            <span style={{ color: 'var(--color-ink-muted)', fontSize: 10 }}> (edited)</span>
          )}
        </p>
      )}

      {confirmDelete && (
        <div
          role="alertdialog"
          aria-label="Confirm delete comment"
          style={{
            marginLeft: 30, padding: 10, borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)', display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
            Delete this comment? This can't be undone.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={async () => { setBusy(true); await onDelete(); setBusy(false); setConfirmDelete(false); }}
              disabled={busy}
              style={{ ...primaryPillStyle, background: 'var(--color-error-fill)' }}
            >
              Delete
            </button>
            <button onClick={() => setConfirmDelete(false)} disabled={busy} style={secondaryPillStyle}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const iconButtonStyle: CSSProperties = {
  width: 24, height: 24, borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'none', color: 'var(--color-ink-muted)', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const textareaStyle: CSSProperties = {
  width: '100%', resize: 'none', padding: '8px 10px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-hairline)', background: 'var(--color-canvas)',
  color: 'var(--color-ink)', fontSize: 12.5, fontFamily: 'var(--font-body)', lineHeight: 1.5,
};

const primaryPillStyle: CSSProperties = {
  padding: '5px 12px', background: 'var(--color-brand)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
};

const secondaryPillStyle: CSSProperties = {
  padding: '5px 12px', background: 'none', color: 'var(--color-ink-muted)',
  border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-pill)',
  fontSize: 11, fontFamily: 'var(--font-body)', cursor: 'pointer',
};

type CommentThreadPanelProps =
  | {
      mode: 'draft';
      root: null;
      replies: [];
      currentRoll: string | undefined;
      canModerate: boolean;
      // People who can be @mentioned here (V2.6 Phase D). Sourced from the
      // board's OWN member list, which the page already has — so the
      // picker can never surface users from another workspace, and no new
      // user-search endpoint (which would be an enumeration surface)
      // exists. The server re-validates every mention regardless.
      mentionables?: Array<{ roll: string; name: string | null }>;
      onSubmitDraft: (content: string) => Promise<void>;
      onClose: () => void;
    }
  | {
      mode: 'thread';
      root: BoardComment;
      replies: BoardComment[];
      currentRoll: string | undefined;
      canModerate: boolean;
      mentionables?: Array<{ roll: string; name: string | null }>;
      onReply: (content: string) => Promise<BoardComment | null>;
      onEdit: (commentId: string, content: string) => Promise<boolean>;
      onDelete: (commentId: string) => Promise<boolean>;
      onResolve: () => Promise<boolean>;
      onReopen: () => Promise<boolean>;
      onClose: () => void;
    };


// MOBILE BREAKPOINT (V2.6 Phase C) — 768 matches the repo's existing
// use-mobile.ts constant, so the comment panel changes shape at the same
// width as the rest of the app rather than at a second, drifting one.
const MOBILE_BREAKPOINT = 768;

function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsNarrow(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isNarrow;
}

export function CommentThreadPanel(props: CommentThreadPanelProps) {
  const { mode, currentRoll, canModerate, onClose } = props;
  const isNarrow = useIsNarrow();
  const [composerValue, setComposerValue] = useState('');
  // @mention autocomplete (V2.6 Phase D). Deliberately a plain textarea
  // with a suggestion list rather than a rich-text editor: the stored
  // format is just text containing @<rollNumber>, which the SERVER
  // re-parses and re-authorizes, so the picker is a convenience and never
  // the source of truth.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionables = props.mentionables ?? [];
  const mentionMatches = mentionQuery === null ? [] : mentionables
    .filter(m => {
      const q = mentionQuery.toLowerCase();
      return m.roll.toLowerCase().startsWith(q) || (m.name ?? '').toLowerCase().includes(q);
    })
    .slice(0, 6);

  // Tracks the trailing "@word" the caret currently sits in, if any.
  const handleComposerChange = (value: string) => {
    setComposerValue(value);
    const match = /@([A-Za-z0-9]*)$/.exec(value);
    setMentionQuery(match ? match[1] : null);
  };

  const insertMention = (roll: string) => {
    setComposerValue(v => v.replace(/@([A-Za-z0-9]*)$/, `@${roll} `));
    setMentionQuery(null);
    composerRef.current?.focus();
  };
  const [submitting, setSubmitting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto focus the composer — see UX requirement "Auto focus".
  useEffect(() => {
    composerRef.current?.focus();
  }, [mode]);

  // Auto scroll to newest reply whenever the reply count grows.
  const replyCount = mode === 'thread' ? props.replies.length : 0;
  useEffect(() => {
    if (mode === 'thread' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyCount]);

  const handleSubmit = async () => {
    const trimmed = composerValue.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'draft') {
        await props.onSubmitDraft(trimmed);
      } else {
        await props.onReply(trimmed);
      }
      setComposerValue('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits, Shift+Enter inserts a newline — see UX requirements.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const isResolved = mode === 'thread' && props.root.resolvedAt !== null;

  return (
    <motion.div
      role="dialog"
      aria-label={mode === 'draft' ? 'New comment' : 'Comment thread'}
      initial={isNarrow ? { opacity: 0, y: 24 } : { opacity: 0, x: 24 }}
      animate={isNarrow ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
      exit={isNarrow ? { opacity: 0, y: 24 } : { opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      // DESKTOP: unchanged — the same right-hand rail as before.
      // NARROW (<768px): a bottom sheet pinned to the viewport's own
      // edges. The old fixed 320px rail occupied ~82% of a 390px screen
      // and could overflow it entirely; anchoring left/right to 0 and
      // capping the height at 70vh keeps the canvas visible above the
      // sheet, guarantees no horizontal overflow at any width, and keeps
      // every control (reply, edit, delete, resolve, close) on screen.
      style={isNarrow ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9000,
        maxWidth: '100%', maxHeight: '70vh',
        background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.25)',
        // Respect the home-indicator / notch area on phones.
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      } : {
        position: 'fixed', top: 96, right: 0, bottom: 24, width: 320, zIndex: 9000,
        background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-xl) 0 0 var(--radius-xl)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.15)',
        maxHeight: 'calc(100vh - 120px)',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid var(--color-hairline)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
            {mode === 'draft' ? 'New comment' : 'Comment thread'}
          </h3>
          {isResolved && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              padding: '2px 6px', borderRadius: 'var(--radius-pill)',
              background: 'var(--color-success-fill)', color: '#fff',
            }}>
              Resolved
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close comment panel"
          style={{
            width: 24, height: 24, borderRadius: 'var(--radius-full)',
            border: '1px solid var(--color-hairline)', background: 'none',
            color: 'var(--color-ink-muted)', fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      {mode === 'thread' && (
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 16px' }}>
          <div style={{ borderBottom: '1px solid var(--color-hairline)' }}>
            <CommentRow
              comment={props.root}
              currentRoll={currentRoll}
              canModerate={canModerate}
              onEdit={(content) => props.onEdit(props.root.id, content)}
              onDelete={() => props.onDelete(props.root.id)}
            />
          </div>
          {props.replies.map(reply => (
            <div key={reply.id} style={{ borderBottom: '1px solid var(--color-hairline)' }}>
              <CommentRow
                comment={reply}
                currentRoll={currentRoll}
                canModerate={canModerate}
                onEdit={(content) => props.onEdit(reply.id, content)}
                onDelete={() => props.onDelete(reply.id)}
              />
            </div>
          ))}
        </div>
      )}

      {mode === 'thread' && canModerate && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-hairline)', flexShrink: 0 }}>
          <button
            onClick={isResolved ? props.onReopen : props.onResolve}
            style={{
              width: '100%', padding: '8px 0',
              background: isResolved ? 'none' : 'var(--color-success-fill)',
              color: isResolved ? 'var(--color-ink)' : '#fff',
              border: isResolved ? '1px solid var(--color-hairline)' : 'none',
              borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 600,
              fontFamily: 'var(--font-body)', cursor: 'pointer',
            }}
          >
            {isResolved ? 'Reopen thread' : 'Resolve thread'}
          </button>
        </div>
      )}

      {(mode === 'draft' || !isResolved) && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-hairline)', flexShrink: 0, position: 'relative' }}>
          {mentionMatches.length > 0 && (
            <ul
              role="listbox"
              aria-label="Mention a collaborator"
              style={{
                position: 'absolute', bottom: '100%', left: 16, right: 16, zIndex: 10,
                margin: 0, padding: 4, listStyle: 'none',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-md, 10px)',
                boxShadow: '0 -6px 20px rgba(0,0,0,0.2)',
                maxHeight: 180, overflowY: 'auto',
              }}
            >
              {mentionMatches.map(m => (
                <li key={m.roll} role="option" aria-selected="false">
                  <button
                    type="button"
                    onClick={() => insertMention(m.roll)}
                    aria-label={`Mention ${m.name ?? m.roll}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '8px 8px', background: 'none', border: 'none',
                      borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer',
                      textAlign: 'left', fontFamily: 'var(--font-body)',
                      // 44px-friendly row height for touch.
                      minHeight: 40,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)' }}>
                      {m.name ?? m.roll}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--color-ink-muted)' }}>@{m.roll}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={composerRef}
            value={composerValue}
            onChange={e => handleComposerChange(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={mode === 'draft' ? 'Add a comment…' : 'Reply…'}
            aria-label={mode === 'draft' ? 'New comment content' : 'Reply content'}
            rows={mode === 'draft' ? 3 : 2}
            style={textareaStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || !composerValue.trim()}
              style={{
                ...primaryPillStyle,
                cursor: submitting || !composerValue.trim() ? 'not-allowed' : 'pointer',
                opacity: submitting || !composerValue.trim() ? 0.6 : 1,
              }}
            >
              {submitting ? 'Posting…' : mode === 'draft' ? 'Comment' : 'Reply'}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
