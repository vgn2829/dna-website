import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BoardComment, type CommentEvent } from '../../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// useBoardComments — the single source of truth for a board's comment
// state in the frontend. REST (api.boards.getComments) provides the
// initial/catch-up load; the WS channel (api.boards.getCommentsRealtimeUrl)
// applies live deltas on top of it. Every mutation (create/edit/delete/
// resolve/reopen) goes through REST first — the local state update for the
// ACTING client comes from that REST response, not from waiting on its own
// broadcast echo, so the user who just clicked "resolve" sees it resolved
// immediately regardless of whether their own comments socket is connected.
// Other connected clients see it via the WS event.
//
// Deliberately independent of @tldraw/sync / useSync entirely — this hook
// has no dependency on an Editor, a TLStore, or tldraw being mounted at
// all, so it works identically whether the board is rendering
// TldrawCanvasSync (realtime) or TldrawCanvas (manual save/load). Only the
// WS live-update layer is conditional on realtime actually being available
// (see the `live` parameter) — REST create/list/etc. work either way,
// since routes/comments.ts has no RoomManager dependency (see that file's
// own comment on why comments never touch RoomManager/TLSocketRoom).
//
// PERFORMANCE: this hook owns exactly one piece of state (the comment
// list) and every mutation is a targeted array update (map/filter), not a
// refetch — a resolve on a board with hundreds of comments does not
// re-request the whole list. Consumers (CommentsOverlay for pins,
// CommentThreadPanel for the open thread) each subscribe to this same
// hook instance's returned value via normal React re-render, but pins are
// individually memoized (see CommentPin.tsx) so a content edit on one
// thread does not re-render every other pin.
// ─────────────────────────────────────────────────────────────────────────

export interface UseBoardCommentsOptions {
  boardId: string;
  roll: string | undefined;
  // Only open the live WS channel when realtime is actually available for
  // this board (mirrors BoardPage.tsx's own useRealtimeSync gate) — a
  // manual-save board still gets full REST CRUD, just no live push; a
  // collaborator would see new comments on their next reload/reopen of the
  // panel, same tradeoff the manual canvas path already accepts for
  // document content itself.
  live: boolean;
  roomId: string | null;
}

export interface UseBoardCommentsResult {
  comments: BoardComment[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  createThread: (content: string, anchor: { anchorType: 'canvas' | 'shape'; anchorShapeId?: string; anchorX: number; anchorY: number }) => Promise<BoardComment | null>;
  reply: (content: string, parentCommentId: string) => Promise<BoardComment | null>;
  editComment: (commentId: string, content: string) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  resolveThread: (commentId: string) => Promise<boolean>;
  reopenThread: (commentId: string) => Promise<boolean>;
  refetch: () => void;
}

function applyEvent(comments: BoardComment[], event: CommentEvent): BoardComment[] {
  switch (event.type) {
    case 'create':
      // Guard against a duplicate if the acting client's own REST response
      // already inserted this comment before its broadcast echo arrives.
      if (comments.some(c => c.id === event.comment.id)) return comments;
      return [...comments, event.comment];
    case 'delete':
      return comments.filter(c => c.id !== event.comment.id);
    case 'edit':
    case 'resolve':
    case 'reopen':
      return comments.map(c => c.id === event.comment.id ? event.comment : c);
    default:
      return comments;
  }
}

export function useBoardComments({ boardId, roll, live, roomId }: UseBoardCommentsOptions): UseBoardCommentsResult {
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [refetchNonce, setRefetchNonce] = useState(0);

  const rollRef = useRef(roll);
  useEffect(() => { rollRef.current = roll; }, [roll]);

  useEffect(() => {
    if (!roll) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.boards.getComments(boardId, roll)
      .then(res => {
        if (cancelled) return;
        setComments(res.comments);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Failed to load comments');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [boardId, roll, refetchNonce]);

  // Live WS subscription — a plain browser WebSocket, not @tldraw/sync
  // (there is no document/store here to sync; see this file's header
  // comment). Reconnects on close with a short fixed backoff rather than
  // reusing ReconnectManager (that class is internal to @tldraw/sync-core
  // and tightly coupled to TLSocketRoom's own message protocol — see
  // rooms.ts's own note on not reimplementing tldraw internals). A dropped
  // comments socket only means live-push is paused; REST GET on next panel
  // open (or the refetch() escape hatch) always recovers full correctness,
  // so a simple bounded retry here is sufficient, not a gap.
  useEffect(() => {
    if (!live || !roomId || !roll) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(api.boards.getCommentsRealtimeUrl(roomId));
      socket = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        retryDelay = 1000;
        // A socket that just (re)connected may have missed events while it
        // was down — re-fetch once to reconcile, cheap relative to the
        // "never miss an update" requirement (comments lists are small
        // relative to canvas snapshots).
        setRefetchNonce(n => n + 1);
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const event = JSON.parse(ev.data as string) as CommentEvent;
          setComments(prev => applyEvent(prev, event));
        } catch (err) {
          console.warn('Failed to parse comment event:', err);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      };

      ws.onerror = () => {
        // onclose always follows onerror for a browser WebSocket — no
        // separate handling needed here beyond letting that reconnect path run.
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [live, roomId, roll]);

  const createThread = useCallback(async (
    content: string,
    anchor: { anchorType: 'canvas' | 'shape'; anchorShapeId?: string; anchorX: number; anchorY: number }
  ): Promise<BoardComment | null> => {
    if (!rollRef.current) return null;
    try {
      const comment = await api.boards.createComment(boardId, rollRef.current, { content, ...anchor });
      setComments(prev => prev.some(c => c.id === comment.id) ? prev : [...prev, comment]);
      return comment;
    } catch {
      return null;
    }
  }, [boardId]);

  const reply = useCallback(async (content: string, parentCommentId: string): Promise<BoardComment | null> => {
    if (!rollRef.current) return null;
    try {
      const comment = await api.boards.createComment(boardId, rollRef.current, { content, parentCommentId });
      setComments(prev => prev.some(c => c.id === comment.id) ? prev : [...prev, comment]);
      return comment;
    } catch {
      return null;
    }
  }, [boardId]);

  const editComment = useCallback(async (commentId: string, content: string): Promise<boolean> => {
    if (!rollRef.current) return false;
    try {
      const updated = await api.boards.editComment(boardId, rollRef.current, commentId, content);
      setComments(prev => prev.map(c => c.id === updated.id ? updated : c));
      return true;
    } catch {
      return false;
    }
  }, [boardId]);

  const deleteComment = useCallback(async (commentId: string): Promise<boolean> => {
    if (!rollRef.current) return false;
    try {
      await api.boards.deleteComment(boardId, rollRef.current, commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      return true;
    } catch {
      return false;
    }
  }, [boardId]);

  const resolveThread = useCallback(async (commentId: string): Promise<boolean> => {
    if (!rollRef.current) return false;
    try {
      const updated = await api.boards.resolveComment(boardId, rollRef.current, commentId);
      setComments(prev => prev.map(c => c.id === updated.id ? updated : c));
      return true;
    } catch {
      return false;
    }
  }, [boardId]);

  const reopenThread = useCallback(async (commentId: string): Promise<boolean> => {
    if (!rollRef.current) return false;
    try {
      const updated = await api.boards.reopenComment(boardId, rollRef.current, commentId);
      setComments(prev => prev.map(c => c.id === updated.id ? updated : c));
      return true;
    } catch {
      return false;
    }
  }, [boardId]);

  const refetch = useCallback(() => setRefetchNonce(n => n + 1), []);

  return { comments, loading, error, connected, createThread, reply, editComment, deleteComment, resolveThread, reopenThread, refetch };
}
