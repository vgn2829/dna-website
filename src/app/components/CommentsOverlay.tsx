import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor, useValue, stopEventPropagation, type TLShapeId } from 'tldraw';
import { CommentPin } from './CommentPin';
import { CommentThreadPanel } from './CommentThreadPanel';
import type { UseBoardCommentsResult } from './hooks/useBoardComments';
import type { BoardComment } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// CommentsOverlay — mounted as a CHILD of <Tldraw> (same reason
// CollaboratorList/ClipboardOverride are: useEditor() requires an
// EditorContext ancestor). Owns three things:
//
//   1. Comment-mode click-to-pin: while active, a pointerdown on the
//      canvas opens a draft-comment composer anchored at that page point
//      (or at a shape's own space, if the click landed on a shape — see
//      handlePointerDown) instead of doing whatever the current tldraw
//      tool would normally do.
//   2. Rendering existing pins, converted from page space to VIEWPORT
//      space on every camera change (pan/zoom) via editor.pageToViewport
//      — this is what "zoom-aware pins" means: a pin's on-screen position
//      tracks the canvas, but its stored anchor (anchorX/anchorY) never
//      changes just because the user zoomed.
//   3. Opening/closing the thread panel for whichever pin is active.
//
// Does NOT own comment data fetching/mutation/live-sync — all of that is
// useBoardComments (passed in as a prop), which has zero tldraw dependency
// itself (see that hook's own header comment on why) and is shared
// unchanged between the realtime and manual canvas paths. This component
// is the ONLY piece that's tldraw-aware, and it is deliberately identical
// regardless of which persistence mode the board uses — mounted from both
// TldrawCanvas.tsx and TldrawCanvasSync.tsx the same way ClipboardOverride
// already is (see tldrawCanvasShared.ts's own comment on why canvas-UX
// logic must not fork between the two).
// ─────────────────────────────────────────────────────────────────────────

interface CommentsOverlayProps {
  commentsApi: UseBoardCommentsResult;
  commentMode: boolean;
  onExitCommentMode: () => void;
  currentRoll: string | undefined;
  canModerate: boolean;
  lastSeenAt: number;
}

interface DraftPin {
  anchorType: 'canvas' | 'shape';
  anchorShapeId?: string;
  pageX: number;
  pageY: number;
}

function groupByThread(comments: BoardComment[]): Map<string, { root: BoardComment; replies: BoardComment[] }> {
  const roots = new Map<string, { root: BoardComment; replies: BoardComment[] }>();
  for (const c of comments) {
    if (!c.parentCommentId) roots.set(c.id, { root: c, replies: [] });
  }
  for (const c of comments) {
    if (c.parentCommentId) {
      const thread = roots.get(c.parentCommentId);
      if (thread) thread.replies.push(c);
    }
  }
  return roots;
}

export function CommentsOverlay({
  commentsApi, commentMode, onExitCommentMode, currentRoll, canModerate, lastSeenAt,
}: CommentsOverlayProps) {
  const editor = useEditor();
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [draftPin, setDraftPin] = useState<DraftPin | null>(null);

  // Reactive camera — re-renders this component (and therefore recomputes
  // every pin's viewport position) on every pan/zoom, the same
  // useValue(key, fn, deps) pattern useCollaboratorPresence uses for its
  // own per-frame-ish reactive read. Deliberately NOT reading
  // editor.getCamera() directly in render (that would read a non-reactive
  // snapshot once and never update as the user pans).
  const camera = useValue('comments-overlay-camera', () => editor.getCamera(), [editor]);
  // Referenced only to keep `camera` recomputing on viewport resize too
  // (screenBounds affects pageToViewport indirectly through the container,
  // not the math itself, but keeps this overlay correctly positioned if
  // the window/panel resizes mid-session).
  void useValue('comments-overlay-screen-bounds', () => editor.getViewportScreenBounds(), [editor]);

  const threads = useMemo(() => groupByThread(commentsApi.comments), [commentsApi.comments]);

  // Comment-mode click handling — capture phase on the editor's own
  // container, mirroring ClipboardOverride's approach of listening in
  // capture so this reliably gets first look, and stopping propagation so
  // tldraw's own active tool (select/draw/etc.) never also reacts to the
  // same click. Only installed while commentMode is true, so normal
  // editing is completely unaffected otherwise.
  useEffect(() => {
    if (!commentMode) return;
    const container = editor.getContainer();

    const handlePointerDown = (e: PointerEvent) => {
      // Only the primary button starts a draft; a right-click or modifier
      // click should not hijack whatever the user actually intended.
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const screenPoint = { x: e.clientX, y: e.clientY };
      const pagePoint = editor.screenToPage(screenPoint);
      const hitShape = editor.getShapeAtPoint(pagePoint, { hitInside: true, margin: 0 });

      if (hitShape) {
        setDraftPin({ anchorType: 'shape', anchorShapeId: hitShape.id, pageX: pagePoint.x, pageY: pagePoint.y });
      } else {
        setDraftPin({ anchorType: 'canvas', pageX: pagePoint.x, pageY: pagePoint.y });
      }
      setOpenThreadId(null);
    };

    container.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => container.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, [commentMode, editor]);

  // Escape closes an in-progress draft (and exits comment mode entirely if
  // no draft is open) — see UX requirement "Escape closes draft".
  useEffect(() => {
    if (!commentMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (draftPin) {
        setDraftPin(null);
      } else {
        onExitCommentMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commentMode, draftPin, onExitCommentMode]);

  const handleCreateDraft = useCallback(async (content: string) => {
    if (!draftPin) return;
    const created = await commentsApi.createThread(content, {
      anchorType: draftPin.anchorType,
      anchorShapeId: draftPin.anchorShapeId,
      anchorX: draftPin.pageX,
      anchorY: draftPin.pageY,
    });
    setDraftPin(null);
    if (created) {
      setOpenThreadId(created.id);
      onExitCommentMode();
    }
  }, [draftPin, commentsApi, onExitCommentMode]);

  const pinPageXY = useCallback((comment: BoardComment): { x: number; y: number } => {
    // A shape-anchored pin follows its shape if the shape has moved since
    // the comment was created (reads the shape's current page-space
    // bounds' top-left corner); falls back to the stored anchor if the
    // shape was deleted, per board_comments' own schema comment on this
    // exact fallback. void camera dependency is implicit — this function
    // is only called during render, downstream of the reactive `camera`
    // read above, so it re-runs on every camera change same as a direct read would.
    if (comment.anchorType === 'shape' && comment.anchorShapeId) {
      const shape = editor.getShape(comment.anchorShapeId as TLShapeId);
      if (shape) {
        const bounds = editor.getShapePageBounds(shape);
        if (bounds) return { x: bounds.x, y: bounds.y };
      }
    }
    return { x: comment.anchorX, y: comment.anchorY };
  }, [editor]);

  const openThread = openThreadId ? threads.get(openThreadId) : null;

  return (
    <>
      <div
        onPointerDown={stopEventPropagation}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 440 }}
      >
        {Array.from(threads.values()).map(({ root, replies }) => {
          const { x: pageX, y: pageY } = pinPageXY(root);
          const viewport = editor.pageToViewport({ x: pageX, y: pageY });
          const lastActivityAt = Math.max(
            new Date(root.updatedAt).getTime(),
            ...replies.map(r => new Date(r.updatedAt).getTime())
          );
          const isUnread = root.authorRoll !== currentRoll && lastActivityAt > lastSeenAt;
          return (
            <div key={root.id} style={{ pointerEvents: 'auto' }}>
              <CommentPin
                comment={root}
                x={viewport.x}
                y={viewport.y}
                replyCount={replies.length}
                isOpen={openThreadId === root.id}
                isUnread={isUnread}
                onClick={() => setOpenThreadId(id => id === root.id ? null : root.id)}
              />
            </div>
          );
        })}

        {draftPin && (
          <div style={{ pointerEvents: 'auto' }}>
            <CommentPin
              comment={{
                id: '__draft__', boardId: '', parentCommentId: null,
                authorRoll: currentRoll ?? '', authorName: null,
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                resolvedAt: null, resolvedByRoll: null, deletedAt: null,
                anchorType: draftPin.anchorType, anchorShapeId: draftPin.anchorShapeId ?? null,
                anchorX: draftPin.pageX, anchorY: draftPin.pageY, content: '',
              }}
              x={editor.pageToViewport({ x: draftPin.pageX, y: draftPin.pageY }).x}
              y={editor.pageToViewport({ x: draftPin.pageX, y: draftPin.pageY }).y}
              replyCount={0}
              isOpen
              isUnread={false}
              onClick={() => {}}
            />
          </div>
        )}
      </div>

      {draftPin && (
        <CommentThreadPanel
          mode="draft"
          root={null}
          replies={[]}
          currentRoll={currentRoll}
          canModerate={canModerate}
          onSubmitDraft={handleCreateDraft}
          onClose={() => { setDraftPin(null); onExitCommentMode(); }}
        />
      )}

      {!draftPin && openThread && (
        <CommentThreadPanel
          mode="thread"
          root={openThread.root}
          replies={openThread.replies}
          currentRoll={currentRoll}
          canModerate={canModerate}
          onReply={(content) => commentsApi.reply(content, openThread.root.id)}
          onEdit={(commentId, content) => commentsApi.editComment(commentId, content)}
          onDelete={async (commentId) => {
            const ok = await commentsApi.deleteComment(commentId);
            if (ok && commentId === openThread.root.id) setOpenThreadId(null);
            return ok;
          }}
          onResolve={() => commentsApi.resolveThread(openThread.root.id)}
          onReopen={() => commentsApi.reopenThread(openThread.root.id)}
          onClose={() => setOpenThreadId(null)}
        />
      )}
    </>
  );
}
