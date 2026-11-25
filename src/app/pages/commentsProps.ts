import type { UseBoardCommentsResult } from '../components/hooks/useBoardComments';

// Shared prop shape both TldrawCanvas.tsx and TldrawCanvasSync.tsx accept
// for mounting <CommentsOverlay>, analogous to tldrawCanvasShared.ts's own
// "logic shared between the two canvas components" rationale — comments
// must render and behave IDENTICALLY regardless of which persistence mode
// a board uses (see CommentsOverlay.tsx's own header comment), so this is
// one object threaded through unchanged rather than five separate props
// each component would need to repeat.
//
// commentsApi is owned by BoardPage (via useBoardComments), not by either
// canvas component — lifting it up means the comment list/thread state
// survives if BoardPage ever needs to remount a canvas component (it
// doesn't today, but this keeps the ownership boundary correct regardless).
export interface CommentsProps {
  commentsApi: UseBoardCommentsResult;
  commentMode: boolean;
  onExitCommentMode: () => void;
  currentRoll: string | undefined;
  canModerate: boolean;
  lastSeenAt: number;
  mentionables?: Array<{ roll: string; name: string | null }>;
}
