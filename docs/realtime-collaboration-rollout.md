# Realtime Collaboration — Rollout Notes (Commits 1–7)

This covers everything needed to run and verify the realtime foundation
(WebSocket transport + room lifecycle, commits `77ea49b`/`7393ab9`), the
frontend `@tldraw/sync` integration (Commit 3, `cdb1dc6`), the presence
layer (Commit 4, `a0317b6`), version history (Commit 5), comments
(Commit 6), and real server-side permission enforcement (Commit 7). As of
Commit 5, every board — realtime-enabled or not — automatically
maintains a recoverable timeline of past states, browsable and
restorable from the UI. As of Commit 6, every board also supports
threaded, pinned comments (canvas- or shape-anchored), with live push
updates on boards where realtime is enabled. As of Commit 7, canvas
writes over the realtime transport are enforced server-side — a
Commenter/Viewer session can no longer write to the document just
because a client happened to send one; the write never reaches the
document, never broadcasts, and never persists.

## What changed

- **Schema** (`backend/src/db/schema.ts`, applied automatically by
  `initSchema()` on server boot — same idempotent `ALTER TABLE ... ADD
  COLUMN IF NOT EXISTS` pattern every other migration in this file uses,
  no separate migration tool/files):
  - `boards.realtime_enabled BOOLEAN NOT NULL DEFAULT false` — per-board
    opt-in.
  - (From the same boot, but part of the earlier dashboard commit:
    `boards.is_archived`, `boards.updated_at`, `boards.thumbnail_url`,
    `board_favorites` table — unrelated to realtime, listed here only so
    you know they'll also apply on next boot if you haven't already run
    them.)
- **New dependencies**: `@tldraw/sync-core` + `@tldraw/tlschema` + `ws`
  (backend, npm), `@tldraw/sync` (frontend, pnpm) — all pinned to `2.4.4`
  to match the installed `tldraw` version exactly.
- **New backend module**: `backend/src/realtime/` — WS transport
  (`server.ts`), authorization (`roomAccess.ts`), persistence
  (`roomPersistence.ts`), room lifecycle (`rooms.ts`), and the connection
  glue (`connectionHandler.ts`).
- **`backend/src/server.ts`**: now uses `http.createServer(app)` instead of
  `app.listen()` directly, with the realtime WS upgrade handler attached to
  the same HTTP server/port.

### Commit 3 additions (frontend)

- **New endpoint**: `GET /api/realtime/status` → `{ enabled: boolean }` —
  exposes only the `REALTIME_ENABLED` global flag's current value (nothing
  else), unauthenticated (non-sensitive boolean). `backend/src/routes/realtime.ts`.
- **New frontend files**:
  - `src/app/pages/tldrawCanvasShared.ts` — logic shared between the manual
    and realtime canvas components (clipboard-paste-as-real-image,
    legacy base64 asset migration, Gallery "Save to Moodboard" item
    injection, accepted image MIME types). Extracted out of
    `TldrawCanvas.tsx` so the two components can't silently drift; behavior
    is unchanged (confirmed via identical production bundle size before/after).
  - `src/app/pages/TldrawCanvasSync.tsx` — the new `@tldraw/sync`-based
    canvas component. Full architectural rationale is documented at the top
    of the file itself (read it before modifying).
  - `src/app/lib/api.ts` — added `Board.realtime_enabled`,
    `api.boards.getRealtimeUrl(roomId)` (builds the WS connection URL +
    auth token), `api.realtime.getStatus()`.
- **`TldrawCanvas.tsx`**: unchanged behavior, only its imports changed (pulls
  the shared logic from `tldrawCanvasShared.ts` instead of defining it
  inline). This remains the default/rollback path exactly as before.
- **`BoardPage.tsx`**: fetches `REALTIME_ENABLED`'s value once on mount via
  `api.realtime.getStatus()`, computes `useRealtimeSync = board.realtime_enabled
  && realtimeGloballyEnabled && Boolean(board.room_id)`, and renders
  `TldrawCanvasSync` or `TldrawCanvas` accordingly — the single decision
  point requirement from the Commit 3 spec.

### Commit 4 additions (presence — frontend only, zero backend changes)

**The most important thing to understand about this commit**: reading
tldraw's own source confirmed that live cursors, live selections, idle
detection, join/leave, and cleanup-on-disconnect are ALL already fully
implemented inside `@tldraw/sync` + `tldraw` core — they activate
automatically the moment `useSync` is given a real `userInfo`
(`{ id, name, color }`). `LiveCollaborators` (tldraw's own component,
rendering cursors/selections/brushes/idle-state) is unconditionally mounted
inside `<Tldraw>`'s default canvas; `TLSyncRoom.removeSession` (server-side,
in `@tldraw/sync-core`, unmodified since Commit 2) already deletes a
disconnected user's presence record and broadcasts the removal — this is
why Commit 4 needed **zero backend changes**. The actual gap was: (1) no
real identity was ever passed to `useSync`, so every collaborator showed as
an anonymous "New User" with a random color, and (2) there was no UI
listing who's currently present or a way to follow someone.

- **`src/app/lib/utils.ts`**: added `rollToColor(roll)` — the exact
  avatar-color formula `BoardPage.tsx`'s member/owner avatars already used
  in three places, extracted so board presence and those avatars can never
  visually drift apart. `BoardPage.tsx`'s three inline copies now call this
  instead (behavior-identical, confirmed by inspection — same formula,
  same output).
- **`src/app/context/PresenceProvider.tsx`** — derives `TLSyncUserInfo`
  (`id` = roll number, `name`, `color` = `rollToColor(roll)`) from the
  signed-in student session. This is the ONLY new identity concern in this
  commit; it does not touch cursors, selections, or the collaborator list.
  Scoped locally around `TldrawCanvasSync` in `BoardPage.tsx` (not global in
  `Root.tsx`) since presence identity has no meaning outside a realtime board.
- **`src/app/components/hooks/useCollaborators.ts`** — three small hooks
  built on `Editor`'s public API (`getCollaboratorsOnCurrentPage`,
  `editor.options.collaborator*TimeoutMs`), NOT a new presence protocol:
  - `useCollaboratorIds()` — reactive, coarse list of connected user ids
    (mirrors tldraw's own internal, non-exported `usePeerIds` pattern:
    derives a stable array via `useComputed`'s `isEqual`, so the list
    doesn't force a re-render on every cursor pixel move — only on actual
    join/leave).
  - `useCollaboratorPresence(userId)` — one user's live `TLInstancePresence`
    record, scoped so only the component displaying that specific user
    re-renders on their updates.
  - `useCollaboratorActivity(presence)` — active/idle/inactive, using
    `editor.options.collaboratorIdleTimeoutMs`/`collaboratorInactiveTimeoutMs`
    (tldraw's real configured values, not invented thresholds) so the list's
    status dot always agrees with whether tldraw is currently rendering that
    user's cursor.
- **`src/app/components/hooks/useFollow.ts`** — wraps
  `editor.startFollowingUser`/`stopFollowingUser`/`getInstanceState().followingUserId`.
  Confirmed by reading `Editor.ts` directly: tldraw already auto-calls
  `stopFollowingUser()` if the followed user's presence disappears (they
  disconnect) — no extra handling needed here for that case.
- **`src/app/components/CollaboratorList.tsx`** + **`CollaboratorAvatar.tsx`**
  — the actual new UI: an avatar-stack overlay (top-right of the canvas,
  capped at 6 visible + a "+N" overflow badge), click an avatar to
  follow/unfollow. Mounted as a *child* of `<Tldraw>` (same reason
  `ClipboardOverride` already is — both need `useEditor()`, which requires
  being inside `<Tldraw>`'s own React tree) but renders as a visual overlay,
  not canvas content. Uses tldraw's own `stopEventPropagation` utility
  (the same one tldraw's built-in Watermark overlay uses) so a click on an
  avatar doesn't fall through to the canvas underneath and deselect
  shapes/start a drag.
- **`src/app/pages/TldrawCanvasSync.tsx`**: now reads `usePresenceUserInfo()`
  and passes it to `useSync({ uri, assets, userInfo })` when a student
  session exists; mounts `<CollaboratorList />` inside `<Tldraw>`. Confirmed
  by reading `useSync.js` directly that `userInfo` going from `undefined` to
  a real value between renders does NOT retrigger the connection-establishing
  effect (it only updates a separate reactive atom the presence derivation
  reads from) — so this cannot cause a spurious reconnect right after the
  identity resolves.

### Commit 5 additions (version history — dedicated layer on top of persistence)

**Applies to every board**, not just realtime-enabled ones — a checkpoint
just reads through `RoomManager.getCurrentSnapshot` (if a live room exists)
or falls back to `BoardCanvasPersistence.load` (if not), so it works
identically for a board that's never had `realtime_enabled` flipped.

**Why the history layer stays independent of the realtime transport**
(architectural rationale, also documented at the top of
`versionHistoryService.ts` itself): `RoomManager` gained exactly one new
notification — `onSnapshotChanged(roomId)`, no payload, mirroring
`TLSocketRoom`'s own `onDataChange` contract — plus two accessors it
already needed for other reasons (`getCurrentSnapshot`, and a new
`restoreSnapshot`). `VersionHistoryService` and `RestoreService` never
import anything WebSocket- or `TLSocketRoom`-specific; by the time a
`RoomSnapshot` reaches either service, it's just data. Concretely, this
means `RoomManager` could be replaced by an entirely different transport
(or even a batch import pipeline that never opens a live room) and the
history layer would keep working unchanged, as long as its two inputs —
"something changed" and "give me the current snapshot" — are still
satisfied. The reverse holds too: `rooms.ts` has zero import of, or
reference to, anything under `realtime/history/`.

- **Schema**: new `board_versions` table (`id, board_id, snapshot,
  created_by_roll, created_by_name, created_at, trigger, description,
  restored_from_version_id, metadata`) + an index on `(board_id,
  created_at DESC)`. Deliberately NOT an extension of `boards.canvas_data`
  — see the migration's own comment on why mixing "current state" and
  "history of past states" in one column would be wrong (unbounded growth
  in a column every live client's autosave also writes to). `metadata` is
  reserved, unused this commit, so a future feature (e.g. a compare/diff
  view wanting cheap summary stats) doesn't need another migration.
- **`backend/src/realtime/rooms.ts`**: `RoomManager` gained
  `onSnapshotChanged`, `getCurrentSnapshot(roomId)`, and
  `restoreSnapshot(roomId, snapshot)`. The last one is the one genuinely
  new *behavior*, not just a new accessor — see its own extensive doc
  comment for the verified-against-source finding that
  `TLSocketRoom.loadSnapshot()` closes every connected client's socket and
  builds a brand-new internal room (there is no other API for this in the
  installed version). Each client's own `ReconnectManager` (already proven
  automatic for network drops/server restarts in Commits 3/4's QA) brings
  them back within seconds, resyncing to the restored content through the
  same path any fresh connection uses. This is a deliberate, single,
  coordinated reconnect — not custom protocol code, not a "storm."
  `restoreSnapshot` also explicitly triggers a persist, since
  `loadSnapshot` itself never fires `onDataChange` (confirmed by reading
  `TLSocketRoom.js`) — without that, a restore would silently revert on
  the next server restart.
- **New service modules**, `backend/src/realtime/history/`:
  - `versionStorage.ts` — pure Postgres access (create/list/get/count/prune
    versions). No decisions live here.
  - `versionTimeline.ts` — cursor-based pagination (`getPage`) and
    retention (`enforceRetention`, capped at `MAX_VERSIONS_PER_BOARD = 100`,
    run opportunistically after every new version rather than on a
    schedule — this codebase has no in-process cron; see
    `routes/internal.ts`'s own comment on why).
  - `versionHistoryService.ts` — the checkpoint DECISION-maker: debounced
    inactivity checkpoints (60s quiet), immediate major-change checkpoints
    (document-count delta ≥ 20 since the last checkpoint — a cheap proxy,
    not a real diff), a 30s rate limit across both automatic triggers, and
    explicit-trigger methods (`checkpointExplicit`/`checkpointRename`/
    `checkpointArchive`) called from REST routes. Both `VersionStorage` and
    `VersionTimeline` are constructor-injectable (defaulting to the real
    modules) specifically so this service's decision logic is unit-testable
    without a database — see `tests/version-history.test.ts`.
  - `restoreService.ts` — orchestrates restore: reads the target version
    (never modifies or deletes it), hot-swaps a live room or falls back to
    direct persistence, and always writes a NEW version (`trigger:
    'restore'`, `restoredFromVersionId` pointing at the source) — never
    routed through `VersionHistoryService`'s dedup/rate-limit guard, since
    a restore is always a deliberate action that must never be silently
    coalesced with a recent unrelated checkpoint.
- **New REST endpoints**, `backend/src/routes/versions.ts` (a dedicated
  router, not routes bolted onto `boards.ts` — see that file's own comment
  on why: `boards.ts` has zero realtime dependency today and is used
  standalone by existing tests; threading history services through it would
  force every test call site to carry realtime wiring it doesn't need):
  - `GET /api/boards/:id/versions` — paginated, metadata-only list.
  - `POST /api/boards/:id/versions` — explicit "save a version now."
  - `POST /api/boards/:id/versions/:versionId/restore` — restore.
  - Mounted only when `server.ts` passes real service instances to
    `createApp({ versionHistoryService, restoreService })` — every test
    call site (`createApp()` with no args) gets an app with these routes
    absent entirely, which is correct: there's no `RoomManager` behind them
    to test against in that context.
  - **Permission model**: reuses the same owner/member/`edit_mode` rules as
    `boards.ts` (a local `canEditBoard` helper, not the WS transport's
    advisory-only `role`) — restore goes through Express/`requireStudent`,
    so this is REAL server-side write enforcement, closing exactly the gap
    `roomAccess.ts`'s own "known limitation" comment flagged as required
    before version history could ship.
- **`backend/src/routes/boards.ts`**: `PUT /:id` (rename/archive) now calls
  an injectable `checkpointHook` (defaults to a no-op) after a successful
  rename or fresh archive (`is_archived === true` specifically — restoring
  FROM archive isn't a content event). Injected via `setCheckpointHook`
  from `server.ts`, not imported directly, for the same test-isolation
  reason the versions router is separate.
- **Frontend**: `src/app/lib/api.ts` gained `BoardVersion`/`VersionPage`
  types and `getVersions`/`createVersion`/`restoreVersion`.
  `src/app/components/VersionHistoryPanel.tsx` is a deliberately dumb
  REST-list-plus-confirm-dialog panel — zero WebSocket/tldraw/sync
  awareness, matching the existing Share/Collaborators modal shape in
  `BoardPage.tsx`. Lazy-loaded (`lazy(() => import(...))`) and only fetches
  when actually opened (`showVersionHistory` state), so a board where no
  one ever opens the panel never triggers the `GET /versions` request or
  downloads the panel's own JS chunk — verified via the build output
  (`VersionHistoryPanel` code-splits into its own ~8.6kB chunk, separate
  from `TldrawCanvas`/`TldrawCanvasSync`/the shared tldraw-core chunk).
  `BoardPage.tsx` also shows a brief "collaborators will reconnect" hint
  after a restore that had a live room, using the `hadLiveRoom` flag the
  restore endpoint returns — purely informational; the actual reconnect
  status is still `TldrawCanvasSync`'s own connection banner (built in
  Commit 3), unchanged by this commit.

**A real bug found and fixed during this commit's own self-review** (not
asked for, but worth knowing about): the checkpoint dedup guard originally
applied to every trigger, including `explicit`/`rename`/`archive` — meaning
a rename happening within 30s of an unrelated auto-checkpoint would be
silently dropped and its distinct "rename" record would never appear in
the timeline. Fixed to only dedup the two automatic triggers
(`inactivity`/`major_change`), where two firing close together for the same
burst of activity is the actual intended coalescing case — every explicit,
user-caused event now always writes its own row. Covered by dedicated
tests (`tests/version-history.test.ts`).

### Commit 6 additions (comments — threaded, pinned, realtime-pushed)

**Applies to every board**, same as version history — comment CRUD works
over REST regardless of `realtime_enabled`; only the *live push* layer
(new comments/edits appearing without a refresh) is conditional on
realtime being available for that board (see "Why comments use a second
WebSocket channel" below).

**Data model**: one new table, `board_comments` — thread roots and replies
share it (`parent_comment_id` NULL = root, set = reply). See
`schema.ts`'s own comment on this table for the full column rationale
(soft delete via `deleted_at`, resolve state only meaningful on a root,
`anchor_type`/`anchor_shape_id`/`anchor_x`/`anchor_y` for canvas- vs.
shape-anchored pins, `mentions` reserved unused for a future feature).
Deliberately NOT stored in `boards.canvas_data` or as tldraw shape
records — comments are collaboration metadata, not document content, and
must never appear in a version-history snapshot or restore. Because
comments never touch `RoomManager`/`TLSocketRoom` at all, they never fire
`onDataChange`/`onSnapshotChanged`, so "comment actions never create board
versions" holds by construction, not by a rule someone has to remember.

**Why comments use a second WebSocket channel, not the existing tldraw
sync socket** (the spec's own explicit ask: "reuse the existing websocket
infrastructure... do not build another websocket"): `TLSocketRoom`'s wire
protocol is tldraw's own binary sync format for `TLRecord` documents —
there is no supported way to send an out-of-band, non-document message
over that socket without hand-rolling part of tldraw's own sync wire
format, exactly the "custom synchronization engine" this whole rollout
has consistently avoided (see `roomAccess.ts`'s own note reaching the
same conclusion for permission enforcement). Instead, `connectionHandler.ts`
now dispatches on the upgrade path suffix: `/api/realtime/boards/<roomId>`
still goes to `RoomManager`/`TLSocketRoom` exactly as before; the new
`/api/realtime/boards/<roomId>/comments` path goes to a new
`CommentBroadcaster` (`backend/src/realtime/comments/commentBroadcaster.ts`)
— a plain `Map<roomId, Set<WebSocket>>` with a `broadcast()` method, no
persistence, no lifecycle, no document state. This is still "the existing
websocket infrastructure," not a new one: same `WebSocketServer` instance,
same `REALTIME_PATH_PREFIX`, same `checkRoomAccess()` authorization
function, same global `REALTIME_ENABLED` kill switch. The only new thing
is the fan-out set itself.

**New backend modules**, `backend/src/realtime/comments/`:
- `commentsStorage.ts` — pure Postgres access (create/list/get/update/
  soft-delete/resolve/reopen). No decisions live here, same division of
  responsibility as `history/versionStorage.ts`.
- `commentBroadcaster.ts` — the WS fan-out described above. Receive-only
  from the client's perspective today (no client→server WS messages are
  defined) — every mutation goes through REST, which is what "do NOT
  trust the client" required: an attacker holding an open comments socket
  cannot forge a comment by sending a crafted WS frame, because nothing
  ever reads incoming frames as a command.

**New REST endpoints**, `backend/src/routes/comments.ts` (a dedicated
router, same reasoning as `routes/versions.ts` — mounted only when
`server.ts` passes a real `commentBroadcaster` instance, absent entirely
in every test call site that doesn't need one):
- `GET /api/boards/:id/comments[?includeResolved=true]` — flat list of
  non-deleted comments (roots + replies together; the frontend groups
  them client-side), resolved-thread roots hidden by default.
- `POST /api/boards/:id/comments` — create a thread root (anchor
  required) or a reply (`parentCommentId` set; anchor inherited from the
  root server-side, never trusted from the client for a reply).
- `PUT /api/boards/:id/comments/:commentId` — edit content.
- `DELETE /api/boards/:id/comments/:commentId` — soft delete (row stays,
  `deleted_at` set — preserves any replies under a deleted root; see
  `commentsStorage.ts`'s own comment on why this can never be a hard
  delete).
- `POST /api/boards/:id/comments/:commentId/resolve` and `/reopen` —
  thread roots only (rejected with 400 on a reply id).

**Permission model** (the spec's Owner/Editor/Commenter/Viewer, mapped
onto this codebase's actual, existing two-tier board permission system —
adding a third role would have meant inventing a new permission tier the
rest of the app doesn't have, which the spec's own "do not over-engineer"
guidance argues against):
- Read access (member, or `visibility: 'shared'`) is the bar for
  creating comments/replies and reading the thread — this is the
  Commenter/Viewer-with-comment-rights tier. Matches Figma/FigJam/Miro's
  own behavior: anyone who can view a board can comment on it.
- Board-edit access (owner/member/`edit_mode: 'anyone'` on a shared
  board — the same `canEditBoard` helper `routes/versions.ts` already
  uses) additionally grants resolving/reopening any thread and
  editing/deleting ANY comment, not just your own.
- A comment's own author can always edit or delete THEIR OWN comment,
  even without board-edit access — this is what makes the Commenter tier
  actually useful (comment on a board you can't edit, then manage what
  you wrote), matching Figma's own behavior.
- Every check is real server-side enforcement via Express/`requireStudent`
  — never the WS transport's advisory-only `role` (see `roomAccess.ts`'s
  own "known limitation" comment, which explicitly named Comments as a
  feature requiring this before shipping).

**Frontend**: `CommentsOverlay.tsx` is mounted as a child of `<Tldraw>` in
BOTH `TldrawCanvas.tsx` (manual) and `TldrawCanvasSync.tsx` (realtime) —
identical component, identical behavior, regardless of which persistence
mode a board uses (same pattern `ClipboardOverride`/`CollaboratorList`
already established; see `pages/commentsProps.ts` for the shared prop
shape both canvas components accept). It owns comment-mode click-to-pin
(a capture-phase `pointerdown` listener on `editor.getContainer()`,
converting the click to a page-space point via `editor.screenToPage()`,
with `editor.getShapeAtPoint()` used to decide canvas- vs. shape-anchored),
zoom-aware pin rendering (`editor.pageToViewport()`, re-computed on every
camera change via a `useValue`-subscribed `editor.getCamera()` read — a
pin's on-screen position tracks pan/zoom, but its stored `anchor_x`/
`anchor_y` never changes just because the user zoomed), and opening/
closing `CommentThreadPanel.tsx` for the active thread. All actual data
fetching/mutation/live-sync lives in `useBoardComments.ts`
(`components/hooks/`), which has zero tldraw dependency and is owned by
`BoardPage.tsx` (not either canvas component) so comment state survives
regardless of which canvas component is mounted. `CommentPin.tsx` is
`memo`'d so re-rendering one pin (its own hover/open state, a new reply)
never re-renders every other pin on the board.

**Live delta reconciliation**: `useBoardComments`'s WS `onopen` handler
always triggers one REST re-fetch (cheap — comment lists are small
relative to canvas snapshots) to reconcile anything missed while
disconnected, rather than trying to replay a gap of missed WS events —
the same "REST for initial/catch-up state, WS for live deltas" split
`@tldraw/sync` itself uses. A dropped comments socket reconnects with a
short exponential backoff (1s → 15s cap); this is a plain
`WebSocket`, not `@tldraw/sync`'s `ReconnectManager` (that class is
internal to `@tldraw/sync-core` and tightly coupled to `TLSocketRoom`'s
own message protocol), so it needed its own small, bounded retry loop —
acceptable because correctness never depends on it: REST is always the
source of truth, WS is purely a live-update convenience layer on top.

**A real, pre-existing bug found during this commit's own manual QA** (not
introduced by Commit 6, but discovered while live-testing the new comments
WS channel, and it blocked comments' own live-push layer too): `roomAccess.ts`'s
`checkRoomAccess()` queried `boards WHERE id = $1`, but every caller —
the Commit 3 document-sync WS path AND the new Commit 6 comments WS path —
passes `board.room_id`, not `board.id` (see `api.ts`'s `getRealtimeUrl`/
`getCommentsRealtimeUrl`, both keyed by `room_id`). Since `room_id` is a
separately generated UUID (see `schema.ts`'s backfill), it is never equal
to `id` in practice — meaning **every realtime WebSocket connection has
been closing immediately with "Board not found" in production since
Commit 3 shipped**, with zero test coverage catching it. A second,
related bug in the same function meant even a corrected board lookup
would still have failed to recognize board members (`board_members.board_id`
needs the real board `id`, not `room_id`). Both are now fixed — see
`roomAccess.ts`'s own bug-fix comment for the full detail — and covered
by 10 new regression tests in `tests/room-access.test.ts` (verified to
actually fail against the old code, not just pass trivially, by
temporarily reverting the fix and re-running them).

### Commit 7 additions (real server-side permission enforcement)

**Goal**: replace the advisory-only realtime permission model with true
server-side enforcement. Before this commit, `roomAccess.ts` computed the
correct role for a connecting session, but nothing stopped a Commenter/
Viewer session from sending a write anyway — the client's own `readOnly`
UI flag was the only thing standing in the way, and a modified/malicious
client could bypass it trivially. This commit closes that gap for the
canvas transport specifically (Comments' and Version History's REST
endpoints already had real enforcement since Commits 5/6 — see those
sections above).

**Research findings, before any code was written** (per the spec's
explicit "research first" requirement): read `@tldraw/sync-core` 2.4.4's
actual source directly, not assumed from its types or docs.
- `TLSocketRoom.handleSocketConnect()` installs its own `'message'`
  listener on whatever socket it's given, and that listener
  unconditionally calls `this.room.handleMessage(sessionId, data)` — the
  one call that mutates the document — after any per-message hooks run.
- The only per-message hook, `onAfterReceiveMessage`, fires with the
  fully-parsed message but its return value is discarded; nothing checks
  whether it threw before proceeding to the mutation anyway. It can
  observe a write, never block one.
- There is no "readonly session" or permission concept anywhere in the
  package.
- The one thing `TLSocketRoom` DOES accept, `@public` and explicitly
  documented for exactly this purpose, is an arbitrary `WebSocketMinimal`
  — a small structural interface (`addEventListener?`,
  `removeEventListener?`, `send`, `close`, `readyState`) "compatible with
  the standard WebSocket interface... Bun.serve" — built for wrapping
  whatever transport you hand it.

**Mechanism** (`backend/src/realtime/roomSocketGate.ts`, the ONLY file in
this codebase that knows anything about `@tldraw/sync-core`'s
client→server wire framing — see its own extensive header comment):
`RoomManager.join()` now wraps the real `ws` socket in a thin
`WebSocketMinimal`-compatible proxy before handing it to
`TLSocketRoom.handleSocketConnect`. The proxy classifies each incoming
message by its top-level `type` field only (`push` is the sole
write-carrying client→server message type; `connect`/`ping` always pass)
— it never parses, mutates, or reconstructs document operations. A `push`
from a session whose role doesn't permit writes is silently dropped
*before* `TLSocketRoom`'s own listener ever sees it, so it never reaches
`room.handleMessage()`, never mutates `this.room`, never broadcasts to
other sessions, never persists, and never fires `onDataChange` (so it
cannot affect version history either) — true prevention, not a
reactive rollback. `canWriteCanvas()` is re-evaluated per message (not
cached at connect time), so a live permission downgrade (see periodic
re-validation below) takes effect on the very next message with no
reconnect needed.

**Four-tier role model** (`roomAccess.ts`): `RoomRole` is now
`'owner' | 'editor' | 'commenter' | 'viewer'`, computed by
`checkRoomAccess`/`checkRoomAccessForRoll` (room_id-keyed, for the WS
paths) and `getBoardRole` (board.id-keyed, for REST endpoints) — the same
classification function (`classifyBoardAccess`) underlies both, so REST
and realtime can never disagree about who can do what. There is still no
`role` column on `board_members`; these four tiers are a classification
of the same ownership/membership/visibility/edit_mode facts the app
already had, not new permission storage — Commenter is exactly the
"read access but not board-edit access" tier Commit 6's comments
permission model already computed, now given a first-class name and, new
in this commit, enforced at the canvas transport too. **`RoomRole` is
identity, not capability** — `roleCanWriteCanvas(role, isArchived)`
takes `isArchived` as a required second argument rather than being a
pure function of role, specifically because an archived board's owner is
still, correctly, `'owner'` (they didn't stop owning it) but cannot
write — see the real bug below that resulted from getting this
distinction wrong initially.

**Live revocation** (`connectionHandler.ts`'s `startPeriodicRevalidation`,
15s interval): re-runs `checkRoomAccessForRoll` for every currently
connected session and applies the result via `RoomManager`'s new
`updateSessionWriteAccess`/`disconnectSession` — a downgrade (e.g.
archived, edit_mode changed) updates the session in place with no
disconnect; a full revocation (removed from a private board, board
deleted, realtime disabled) force-disconnects the session so the
client's own reconnect logic hits `checkRoomAccess` again and gets the
current, real reason.

**Client-facing errors** (`routes/realtime.ts`'s new
`GET /api/boards/:roomId/access` pre-check, called by
`TldrawCanvasSync.tsx` before ever opening a WebSocket): verified
directly against `@tldraw/sync-core`'s `ClientWebSocketAdapter` source
that any WS close code other than its own hardcoded `NOT_FOUND` (4099) is
treated as a transient `'offline'` status by `useSync`'s
`ReconnectManager`, which then retries indefinitely — a
`permission_denied` close would otherwise look identical to a network
blip to the client and retry forever against a condition that will never
change. The REST pre-check sidesteps this entirely: the frontend learns
the specific reason (`permission_denied` / `session_expired` /
`board_archived` / `board_not_found` / `realtime_disabled`) before
attempting to connect at all, and shows a distinct message per reason
(`AccessDeniedScreen` in `TldrawCanvasSync.tsx`). While connected, the
same endpoint is polled every 20s (`ACCESS_POLL_INTERVAL_MS`) so a
permission revoked mid-session is reflected in the UI promptly — this is
a poll, not an in-band push over the document-sync socket; see the next
paragraph for why.

**Three real bugs found and fixed during this commit's own development**
(the first two caught by this commit's own new tests failing on first
write, the third caught during manual QA before it ever reached a test —
none assumed correct, all reproduced/verified before and after the fix):

1. **Chunked pushes bypassed the write gate entirely.** The gate's first
   implementation forwarded each raw message fragment to `TLSocketRoom`
   immediately as it arrived, only checking `canWriteCanvas()` once the
   *final* fragment completed classification — but `TLSocketRoom` does
   its own, completely independent chunk reassembly on whatever raw
   frames it sees, so the first N-1 fragments of a chunked push from a
   read-only session had already reached it before the gate "dropped"
   the last one. Any edit large enough to exceed `@tldraw/sync-core`'s
   ~256KB chunk threshold would have silently bypassed enforcement
   completely. Fixed by buffering every fragment of a message currently
   being classified and flushing (or dropping) the whole buffered
   sequence as one unit only once classification completes. Caught by
   `tests/room-socket-gate.test.ts`'s own chunked-push test failing on
   first write.
2. **An owner could still write to an archived board.** An intermediate
   version of `classifyBoardAccess` computed `canWrite` correctly
   (incorporating `is_archived`) but then discarded it for the owner
   branch (`isOwner ? 'owner' : canWrite ? 'editor' : 'commenter'`),
   combined with an initial `roleCanWriteCanvas(role)` that was a pure
   function of role with no archive awareness — meaning the board
   owner, specifically, could keep writing to a canvas the "Board
   archived" write-freeze was supposed to guarantee was frozen for
   everyone. Reproduced live against a real server (a direct REST
   pre-check call showing `canWriteCanvas: true` on an archived board)
   before fixing, and now covered by two explicit regression tests
   (verified to fail against the reintroduced bug, not just pass
   trivially).
3. **The gate's original design sent a custom notice back over the
   document-sync socket on a rejected write** (`{ type:
   'permission_denied_notice', ... }`), intended as defense-in-depth for
   a permission revoked mid-session. Re-reading `@tldraw/sync-core`'s
   `TLSyncClient` source during this commit's own review revealed that
   any message `type` the client doesn't already recognize hits its
   `handleServerEvent`'s `default: exhaustiveSwitchError(event)` branch,
   which **throws** — this would have crashed the client's message-
   handling loop instead of being safely ignored. Removed entirely
   before it shipped; the gate is now completely silent on the wire, and
   the REST poll above is the sole mechanism for surfacing a
   mid-session revocation to the UI.

**Mutation-path audit** (per the spec's explicit AUDIT requirement):
every write path under `realtime/`, `routes/comments.ts`,
`routes/versions.ts` was traced and confirmed to go through
`getBoardRole`/`roleCanWriteCanvas`/`roleCanComment` before mutating
anything. The audit also surfaced the same defect class already fixed in
`roomAccess.ts` present in `routes/boards.ts`'s own long-standing
`canEdit()` helper (used by `PUT /:id/canvas`, `POST /:id/duplicate`,
`POST /:id/canvas-files`, `POST /:id/items`) — it never checked
`is_archived` either, so a member could still save canvas content or
upload files to an archived board via plain REST even though the
realtime WS layer and version-restore path both correctly refused
writes. Fixed the same way (an `is_archived` check added to `canEdit`,
scoped to leave `PUT /:id`'s own `isOwner` check — the archive/rename/
unarchive action itself — untouched, since that must keep working on an
archived board).

**Testing**: `tests/room-socket-gate.test.ts` (12 tests) unit-tests the
gate in isolation — push classification, chunk buffering, forward/drop
behavior, and the "never sends anything back over the socket" invariant
— using only literal JSON strings matching `@tldraw/sync-core`'s public
`TLPushRequest`/`TLConnectRequest`/`TLPingRequest` shapes, never
hand-constructing an actual tldraw wire handshake (see
`tests/realtime-rooms.test.ts`'s own pre-existing comment on why that's
avoided — the real `connect` message's exact shape is `@internal`).
`tests/room-access.test.ts` gained the four-tier role model, the
archived-board write freeze (including the two owner-specific regression
tests), `checkRoomAccessForRoll`, and `getBoardRole` coverage.
`tests/periodic-revalidation.test.ts` (6 tests) verifies live
downgrade/disconnect behavior against a fake `RoomManager` and the real
`checkRoomAccessForRoll` (hits the local test DB) — using **real timers**
with a short interval override, not `vi.useFakeTimers()`, since mixing
fake timers with `checkRoomAccessForRoll`'s real Postgres I/O produced
non-deterministic failures (fake-timer advancement doesn't reliably wait
for actual socket I/O to complete) — confirmed directly by writing the
fake-timer version first and watching it fail on first run, not assumed.

## Two-layer rollout gate

Both must be true for a given board to use realtime; either one being false
means that board silently uses the existing manual save/load path,
unchanged:

1. **Global kill switch** — env var `REALTIME_ENABLED=true` on the backend.
   Not read from the database, not toggleable at runtime without a
   restart — this is intentional (see `realtime/server.ts`'s doc comment):
   an incident-response kill switch should not depend on the thing that
   might be misbehaving (a DB-backed admin toggle) still working correctly.
2. **Per-board flag** — `boards.realtime_enabled = true`, defaults `false`
   for every existing and newly created board. No UI exists yet to flip
   this from the app; it's a manual DB flip for now (see "Enabling a pilot
   board" below), by design — this generation of the rollout doesn't ship
   any way for a student to opt a board in themselves.

## Applying the migration

No separate migration command — `initSchema()` runs automatically on every
backend boot (`npm run dev` or the built `node dist/server.js`) and the new
`ALTER TABLE` is idempotent (`IF NOT EXISTS`), so simply starting the
backend against your target database applies it. To apply without booting
the full server (e.g. to inspect the resulting schema first), you can run
just the schema step:

```bash
cd backend
npx tsx -e "import('./src/db/schema.js').then(m => m.initSchema()).then(() => process.exit(0))"
```

(Requires `DATABASE_URL` set in your environment/`.env` for whichever
database you're targeting.)

## Rollback

No migration to reverse — the new column defaults to `false` and nothing
reads or writes it unless a board is explicitly flipped. To fully disable:

1. Unset or set `REALTIME_ENABLED=false` and restart the backend. The WS
   upgrade handler is never attached in that case (`attachRealtimeServer`
   logs `"Realtime collaboration disabled"` and returns `null` — verify
   this log line appears on boot).
2. (Optional, only if you'd flipped any boards on) `UPDATE boards SET
   realtime_enabled = false;` — not required for the kill switch to work
   (step 1 alone fully disables the feature for every board), just tidies
   the per-board flags back to their default.

Nothing in the manual save/load path (`TldrawCanvas.tsx`, `PUT/GET
/boards/:id/canvas`) was touched by these two commits — that path is
completely untouched and is what every board (realtime-flagged or not)
still uses today, since no client wiring exists yet.

## Enabling a pilot board (for your own testing)

```sql
UPDATE boards SET realtime_enabled = true WHERE id = '<board-id>';
```

With `REALTIME_ENABLED=true` on the backend, this board's `room_id` (a
column that's existed since before this rollout, previously unused) is now
a valid realtime room — but nothing will connect to it yet, since the
frontend has no `@tldraw/sync` client wired in (that's Commit 3). Right
now, the only way to exercise the room lifecycle is directly over a raw
WebSocket client or the automated test suite below.

## Automated verification (safe — no live DB)

```bash
cd backend
npx vitest run tests/realtime-rooms.test.ts
```

6 tests, all using an in-memory fake `RoomPersistence` and a fake socket —
deliberately does not import `db/client` or touch any database. Exercises
the real, installed `@tldraw/sync-core` `TLSocketRoom` (not a mock of it)
for: room creation + initial snapshot load, no duplicate room on concurrent
joins to the same `roomId`, independent rooms per `roomId`, persist +
teardown when the last session leaves, room recreation from persistence
after teardown (the server-restart-equivalent case), and that a session
close doesn't tear the room down synchronously while others remain.

Also safe to run: `npm run typecheck`, `npm run build`, `npm run test`
(full suite, 21 tests — the other 15 pre-existing tests DO hit a database,
but only `tests/setup.ts`'s `TEST_DATABASE_URL` / local
`postgresql://localhost:5432/dna_club_test` default, never your
configured `DATABASE_URL`).

## Manual end-to-end verification (needs your dev DB + `REALTIME_ENABLED=true`)

Since there's no client yet, "manual QA" at this stage means confirming the
WS transport + auth + room lifecycle behave correctly over a raw socket —
not the full user-facing collaboration experience (that's after Commit 3).

1. **Boot the backend** with `REALTIME_ENABLED=true` in its env. Confirm
   the log line `Realtime collaboration enabled — WS upgrades accepted
   under /api/realtime/` appears.
2. **Global flag off** — boot without `REALTIME_ENABLED` (or `=false`).
   Confirm the `"disabled"` log line instead, and that connecting to
   `ws://localhost:<port>/api/realtime/boards/<any-room-id>` fails/hangs
   (no upgrade handler attached at all — the connection should behave as
   if nothing is listening on that path, since `attachRealtimeServer`
   returns `null` and never registers an `upgrade` listener).
3. **Board not realtime-enabled** — with the global flag on, connect to a
   real board's `room_id` that still has `realtime_enabled = false`.
   Expect the socket to close immediately with code `1008` and reason
   `"Realtime is not enabled for this board"`.
4. **Unknown board** — connect with a syntactically-valid but non-existent
   UUID as the room id. Expect close code `4099` (tldraw's own
   `TLCloseEventCode.NOT_FOUND` convention, not an invented code) with
   reason `"Board not found"`.
5. **No/invalid token** — connect to a real, realtime-enabled board without
   a `?token=` param, or with a garbage one. Expect close code `1008`,
   reason `"Sign in required"`.
6. **Missing sessionId** — connect with a valid token but no `?sessionId=`
   param. Expect close code `1008`, reason `"Missing sessionId"`.
7. **Happy path** — connect with a valid token (a real student JWT — same
   one the REST API uses, `Authorization: Bearer <token>` isn't used here
   since it's a WS upgrade; pass it as `?token=<jwt>`) + a `?sessionId=`
   value + a real realtime-enabled board's `room_id`. Expect the socket to
   stay open (no immediate close). You won't get a meaningful tldraw
   session without speaking the sync wire protocol from your test client —
   this step just confirms the auth+room-creation path accepts a valid
   connection and doesn't error.
8. **Room reuse** — repeat step 7 with a second `sessionId` for the same
   `room_id` while the first connection is still open. Confirm the backend
   logs/behavior indicate one room, two sessions (no visible way to inspect
   this without adding a temporary log — `RoomManager.getActiveSessionCount(roomId)`
   is exposed for exactly this kind of diagnostic use, not currently wired
   to any endpoint).
9. **Teardown** — close both connections from step 7/8. Wait ~15 seconds
   (the real session-removal grace period observed during implementation,
   see Commit 2's message). Confirm no orphaned state — restart the backend
   process and confirm nothing errors on boot (rooms are pure in-memory
   projections; there's deliberately no "recover rooms" step, see
   `rooms.ts`'s doc comment).

## Commit 3 — manual QA (needs your dev DB, `REALTIME_ENABLED=true`, and a pilot board)

Unlike Commits 1/2's raw-socket checklist, these all go through the real UI
at `/moodboards/<board-id>`. Set up once: enable a board per "Enabling a
pilot board" above, boot the backend with `REALTIME_ENABLED=true`, boot the
frontend (`npm run dev`), sign in as a student who's the owner or a member
of that board.

1. **Loading → Connected** — open the board. Expect a brief "Connecting to
   board…" full-screen state, then the canvas appears with no persistent
   banner (connected = no banner, by design — see `STATUS_COPY` in
   `TldrawCanvasSync.tsx`).
2. **Two browsers (the core multiplayer check)** — open the same board URL
   in two different browsers (or one normal + one incognito window, so
   they're different sessions/tabs). Draw/move/delete a shape in one,
   confirm it appears in the other within roughly a second, with no manual
   save/refresh needed.
3. **Refresh** — with content on the board, hard-refresh the tab. Expect it
   to reload through Loading → Connected again and show the same content
   (proves the room's in-memory state — or its persisted snapshot if the
   room had already torn down — round-trips correctly).
4. **Duplicate tabs** — open the SAME board in two tabs of the SAME
   browser. Both should connect and both should see each other's edits,
   same as step 2. This is the case that specifically exercises tldraw's
   own tab-scoped `TAB_ID`/`sessionId` handling (see `api.ts`'s
   `getRealtimeUrl` comment) — confirm neither tab kicks the other out and
   edits from tab A don't silently overwrite tab B's unsaved local state.
5. **Network interruption** — with the board open and connected, disable
   your network adapter (or use devtools' Network throttling → Offline) for
   ~10 seconds, then re-enable it. Expect: banner changes to
   "Offline — changes will sync when you're back online" (or
   "Reconnecting…" if devtools reports online but the socket is still
   dropped) while disconnected, then automatically clears back to no-banner
   once reconnected — no manual action needed, no page reload needed.
6. **Offline edits preserved** — repeat step 5, but drop a shape onto the
   canvas WHILE offline. Confirm it's still there once reconnected (local
   edits aren't lost while disconnected) and that it appears in the OTHER
   browser from step 2 once sync resumes.
7. **Server restart** — with a board open and connected, restart the
   backend process. Expect the banner to show disconnected/reconnecting
   during the restart, then automatically reconnect once the backend is
   back up (no page reload). Confirm content is intact after reconnecting.
8. **Large board** — on a board with a large number of shapes/images (or
   create one), confirm initial load time is reasonable and panning/editing
   stays responsive. There's no explicit large-board optimization in this
   commit beyond what tldraw/sync already provide — this step is to catch
   any regression, not to validate a specific performance target.
9. **Camera/selection preserved across reconnect** — select a shape and pan
   to a specific spot, then trigger step 5's network drop/restore. Confirm
   the selection and camera position are unchanged after reconnecting (this
   is the property `hasEverConnectedRef` in `TldrawCanvasSync.tsx` exists to
   guarantee — see its doc comment for why a naive implementation would
   break this).
10. **Read-only mode** — as a non-member on a `shared` + `edit_mode:
    'members_only'` board, confirm the UI chrome (toolbar, etc.) is hidden
    (`hideUi`), matching the manual path's existing read-only behavior
    exactly (same `readOnly` expression, unchanged).
11. **Feature parity spot-check** — on a connected realtime board, confirm:
    pasting an image from clipboard works and uploads to storage (same
    `assetStore.upload` as the manual path); copying a single image shape
    and pasting into another app produces a real image (same
    `ClipboardOverride`); undo/redo (Cmd/Ctrl+Z) works; a board opened via
    "Save to Moodboard" from the Gallery shows the injected item.
12. **Memory leaks** — open and close (navigate away from) the same
    realtime board 10-20 times in a row in one tab. Watch the browser's
    JS heap (devtools Memory tab) — it should not grow unbounded across
    iterations. Also check the backend process's memory after the same
    sequence plus waiting ~15s after the last close (the session-removal
    grace period) — `RoomManager` should have torn its room down (no
    endpoint currently exposes `getActiveRoomCount()` for a live check;
    absence of steady memory growth is the practical signal here).
13. **Fall back to manual path still works** — open a DIFFERENT board that
    is NOT realtime-enabled. Confirm it behaves exactly as before this
    commit (debounced manual save, "Saving…"/"Saved" pill, no connection
    banner) — this is the regression check that the rollback path is
    genuinely untouched.

## Commit 4 — manual QA (presence)

Same setup as Commit 3's checklist (pilot board, `REALTIME_ENABLED=true`,
two browsers/tabs signed in as different students where noted).

1. **Real identity, not anonymous** — open a realtime board as two
   different students in two browsers. Confirm each sees the OTHER's
   cursor labeled with their real name (not "New User") and colored with
   their `rollToColor` color — the same color that student's avatar shows
   elsewhere in the app (e.g. the Collaborators modal on this same board).
2. **Live cursors** — move the mouse in one browser; confirm the other
   browser's canvas shows a labeled cursor tracking the movement in
   roughly real time.
3. **Live selection** — select a shape in one browser; confirm the other
   browser shows a colored selection outline around that shape (tldraw's
   own `CollaboratorShapeIndicator`, not custom UI).
4. **Collaborator list appears/updates** — with 2+ students connected,
   confirm the avatar-stack overlay (top-right of the canvas) shows one
   avatar per connected student, initials/colors matching step 1.
5. **Join/leave detection** — with the list visible, close one browser's
   tab. Confirm the departed student's avatar disappears from the OTHER
   browser's list within the ~10s server-side grace period (Commit 2's
   session-removal timing — this hasn't changed).
6. **Rapid join/leave** — open and close the same board rapidly (5-10
   times in quick succession) in a second browser/tab while a first
   browser stays connected. Confirm the collaborator list in the first
   browser doesn't accumulate stale/duplicate/ghost avatars — it should
   settle back to showing only genuinely-connected users.
7. **Idle status** — stay connected but stop interacting (no mouse
   movement/clicks) for over 3 seconds (tldraw's own
   `collaboratorIdleTimeoutMs`). Confirm the OTHER browser's list shows
   that avatar with reduced opacity / no active-dot (see
   `CollaboratorAvatar.tsx`), and that the cursor itself behaves per
   tldraw's own idle rules (may hide per `LiveCollaborators`'s internal logic).
8. **Follow participant** — click a collaborator's avatar in the list.
   Confirm your own viewport starts tracking their camera position/pan/zoom.
   Click the same avatar again (or another) to stop/switch following.
9. **Follow + disconnect** — while actively following someone, have them
   close their browser. Confirm following stops automatically (no error,
   no stuck camera-lock) — this is tldraw's own built-in behavior
   (`Editor.ts`'s `startFollowingUser` reactive check), not something this
   commit implemented.
10. **Reconnect-safe presence** — with 2+ students connected, drop one's
    network (devtools offline) for ~10s, then restore it. Confirm: their
    cursor/avatar disappears from others' views while disconnected (or
    stays if under the grace period), and reappears correctly (same
    identity/color, not a duplicate) once reconnected.
11. **Duplicate tabs** — open the same board in two tabs of the same
    browser as the same student. Confirm the collaborator list shows this
    as either one or two entries consistently in a way that doesn't break
    following (following the "same user, two tabs" case is a known tldraw
    edge case worth just confirming doesn't crash, not something this
    commit specifically hardened).
12. **Memory leaks** — with the collaborator list actively showing 2+
    users, leave the board open for several minutes (or repeat the
    rapid-join-leave test from #6 many times). Check the browser's JS heap
    (devtools Memory tab) doesn't grow unbounded — `useCollaboratorActivity`'s
    interval is cleaned up per-avatar on unmount (verified by code review;
    each avatar owns exactly one `editor.timers.setInterval`, cleared in
    its effect's cleanup function).
13. **No regression to Commit 3** — re-run Commit 3's own checklist items
    2 (two browsers), 4 (duplicate tabs), 5 (network interruption), 7
    (server restart), and 13 (manual-path fallback) — none of that behavior
    should have changed; presence is additive.

## Commit 5 — manual QA (version history)

Same setup as Commit 3/4's checklists (pilot board, `REALTIME_ENABLED=true`
for the realtime-specific scenarios below; version history itself works on
any board, realtime-enabled or not, since it reads through persistence when
no live room exists).

1. **Two browsers** — open the same board as two different students. In one
   browser, open "History." Confirm the panel loads a list (or the empty
   state on a brand-new board) without affecting the other browser's
   session.
2. **Restore while connected** — with both browsers open and both showing
   live cursors, restore an older version from one browser. Confirm: the
   confirmation dialog appears before anything happens; after confirming,
   both browsers' canvases update to the restored content within a few
   seconds; the restoring browser shows the "collaborators will reconnect"
   hint; the OTHER browser's connection banner (Commit 3) briefly shows a
   reconnect and then clears — this is the expected, deliberate
   `loadSnapshot`-driven reconnect, not a bug.
3. **Restore after reconnect** — disconnect one browser's network
   (devtools offline), restore a version from the OTHER (still-connected)
   browser, then restore the first browser's network. Confirm it reconnects
   cleanly and ends up showing the restored content (not stale content, not
   a duplicate/ghost session).
4. **Large board** — on a board with substantial content (many shapes),
   confirm restoring doesn't visibly corrupt shapes/assets and completes in
   a reasonable time.
5. **Rapid edits** — make many small edits in quick succession (drag a
   shape around continuously for 60+ seconds). Confirm this does NOT create
   a new version per edit — only a single inactivity checkpoint (~60s after
   edits stop) or a major-change checkpoint if the edit crossed the
   document-count threshold, whichever fires first.
6. **Offline → reconnect** — go offline mid-edit, make local changes,
   restore connectivity. Confirm normal Commit 3 resync behavior is
   unaffected by version history running in the background.
7. **Duplicate tabs** — open the same board in two tabs as the same
   student, restore from one tab. Confirm the other tab also updates (same
   reconnect path as #2, since both tabs are separate WebSocket sessions to
   the same room) and neither tab is left showing stale content.
8. **Server restart** — create a version, restart the backend process,
   confirm the version is still listed afterward (it's in Postgres, not
   in-memory) and that the room's current content — including anything
   restored before the restart — persisted correctly (`restoreSnapshot`
   explicitly triggers a persist for exactly this reason).
9. **Long version history** — create/accumulate more than one page of
   versions (or temporarily lower `MAX_VERSIONS_PER_BOARD`/page size for
   testing). Confirm "load more" pagination works, and that once the
   100-version retention cap is exceeded, the oldest versions are pruned
   (rename/archive/explicit/restore versions are pruned by age like any
   other — retention is not trigger-aware, only recency-aware).
10. **Permissions** — confirm a student without edit access on the board
    (not owner, not a member with edit rights) cannot restore (403 from the
    endpoint, not just a hidden button) — this is real server-side
    enforcement, unlike the WS-layer `role` limitation noted below.

## Commit 6 — manual QA (comments)

Same setup as Commit 3/4/5's checklists. Comment CRUD (create/reply/edit/
delete/resolve/reopen) works on ANY board via REST; items marked
"(realtime only)" need `REALTIME_ENABLED=true` AND
`board.realtime_enabled=true` for the live-push behavior specifically —
without that, the same action still works, just requires a manual
refresh/reopen of the panel to see someone else's change.

1. **Create comment** — enter comment mode, click empty canvas. Confirm a
   pin drops at the click point and a composer opens; typing and
   submitting creates a thread root pin that persists after closing/
   reopening the panel.
2. **Create comment on a shape** — click directly on a shape while in
   comment mode. Confirm the pin anchors to the shape (not just the click
   coordinate) — moving the shape afterward should move the pin with it.
3. **Reply** — open an existing thread, type a reply, press Enter (not
   Shift+Enter). Confirm it appears in the thread, auto-scrolled into
   view, and the pin's reply-count badge increments.
4. **Resolve** — as the board owner/a member, resolve a thread. Confirm
   it disappears from the default pin view and default comment list, and
   reappears in an "include resolved" view/toggle if the UI +GET request
   includeResolved=true, without being deleted.
5. **Reopen** — reopen a resolved thread. Confirm it reappears in the
   default view again, unmodified content, at the same pin location.
6. **Edit** — edit your own comment. Confirm the "(edited)" marker
   appears once `updatedAt` diverges from `createdAt`, and the content
   updates for anyone else with the panel open (realtime only) or on
   their next refresh otherwise.
7. **Delete** — delete a comment with the confirmation dialog. Confirm it
   disappears from the thread; deleting a thread ROOT that has replies
   must not also delete/orphan those replies (the replies stay listed
   under `includeResolved=true`'s expanded view, or simply remain
   selectable in the panel).
8. **Two browsers** (realtime only) — open the same board as two
   students. Create a comment in one; confirm it appears live in the
   other without a refresh (both the pin AND, if that thread's panel is
   open, the thread content).
9. **Refresh** — reload the page mid-session. Confirm all comments/
   replies/resolved-state reload correctly from REST (nothing was only
   ever in memory).
10. **Reconnect** (realtime only) — drop network (devtools offline),
    restore it. Confirm the comments WS channel reconnects (its own
    bounded backoff, independent of the tldraw document-sync socket) and
    a one-time catch-up re-fetch reconciles anything missed while
    disconnected.
11. **Offline → reconnect** — go offline, attempt to create/edit/delete a
    comment (REST calls will fail while offline — confirm this fails
    gracefully, not silently, and the UI doesn't show a false-success
    state), then restore connectivity and confirm normal operation resumes.
12. **Duplicate tabs** (realtime only) — open the same board in two tabs
    as the same student. Confirm both tabs' comments WS channels connect
    independently and both receive live events for actions taken in
    either tab (or a third party's).
13. **Permission enforcement** — as a student with read-only access to a
    shared board (not owner, not a member with edit rights): confirm you
    CAN create comments/replies, CAN edit/delete your OWN comments, but
    CANNOT resolve/reopen a thread or edit/delete someone ELSE's comment
    (403 from the endpoint itself, not just a hidden button).
14. **Large boards** — on a board with substantial canvas content, confirm
    comment mode/pin dropping/panel opening stays responsive (pins are
    independently memoized — see `CommentPin.tsx` — so this should not
    visibly degrade with more shapes on the canvas).
15. **Hundreds of comments** — create/accumulate a large number of
    comments on one board. Confirm the list endpoint and panel remain
    responsive (no snapshot content is ever fetched for comments, unlike
    version history's own snapshot payloads — comment rows are small) and
    that resolved-by-default filtering keeps the visible pin count
    manageable.

## Commit 7 — manual QA (permission enforcement)

Same setup as Commit 3–6's checklists.

1. **Two browsers, viewer vs editor** — open the same shared board as an
   owner/editor in one browser and a non-member (commenter tier) in
   another. Confirm the editor's edits sync live to the commenter's view
   (read still works), and confirm the commenter's `<Tldraw>` renders
   read-only (`hideUi`) — this now reflects the SERVER's computed
   `canWriteCanvas`, not a client-side guess.
2. **A modified/malicious client cannot bypass read-only** — this is the
   core of what Commit 7 fixes, and isn't testable from the normal UI (by
   design, the UI just doesn't offer write controls to a commenter).
   Verified instead via `tests/room-socket-gate.test.ts`'s unit tests and
   this commit's own manual QA scripts (see the commit message) sending a
   raw, hand-built `push` message as a commenter/viewer session directly
   — confirm server logs show "dropped an unauthorized write" and the
   socket stays open with no crash, no error frame, and the document
   snapshot is unchanged.
3. **Permission changes live** — with a member connected and editing,
   remove them as a board member from another session/tab. Confirm
   within ~15s (the periodic re-validation interval) their session either
   downgrades (still connected, now read-only) or disconnects (if they
   also lost read access), without needing to refresh.
4. **Board archived while connected** — archive a board while a member
   has it open. Confirm their session downgrades to read-only in place
   (no disconnect — they still have read access) within ~15s, and that a
   REST attempt to save canvas content, checkpoint a version, or restore
   a version all now return 403.
5. **Board deleted while connected** — delete a board while someone has
   it open. Confirm their session is force-disconnected within ~15s.
6. **Reconnect after a permission change** — after being disconnected per
   #3/#5, confirm the client's own reconnect attempt gets a clean,
   accurate denial (via the REST pre-check, not a confusing generic
   error) rather than retrying forever.
7. **Refresh** — reload the page as a commenter/viewer. Confirm the REST
   pre-check (`GET /api/boards/:roomId/access`) is what renders the
   correct read-only/denied state immediately, before any WebSocket
   connection is attempted.
8. **Duplicate tabs** — open the same board in two tabs as the same
   editor. Confirm both connect and sync independently; a write in one
   tab appears in the other exactly as before Commit 7 (this commit adds
   no restriction between a user's own tabs).
9. **Offline then reconnect** — same as Commit 3's own offline test;
   Commit 7 adds no new offline-handling code (useSync's own
   ReconnectManager is unchanged), only confirms the reconnect attempt
   re-validates permission from scratch via a fresh `checkRoomAccess`
   call.
10. **Session expired** — use an expired/invalid JWT (or clear the stored
    token) and attempt to open a board. Confirm the REST pre-check
    reports `session_expired` and a clear message is shown, not a raw
    connection-failed screen.
11. **Comments and version history still work correctly alongside the
    canvas write-gate** — resolve/reopen a comment as an editor,
    view/restore version history as an editor, confirm a commenter can
    still create/reply to comments (comments are NOT frozen by an
    archived board, only canvas writes and version-history writes are —
    see this commit's own architecture notes above) but cannot resolve
    threads or view/restore version history.
12. **Large boards** — confirm the write gate's per-message classification
    (a cheap substring check before a full JSON parse — see
    `roomSocketGate.ts`) doesn't introduce a noticeable latency increase
    on a board with heavy, frequent edit traffic.

## What's explicitly NOT yet built (don't test for these)

- No sticky notes, notifications, AI, or plugins.
- No compare/diff view, branching, or merge — version history is strictly
  linear (each restore appends a new version; nothing is ever overwritten).
- No comment branching, threading beyond one level (replies cannot
  themselves have replies), @mentions (the `mentions` column exists,
  reserved, unused), or comment notifications — all explicitly out of
  scope for Commit 6 per its own spec.
- No UI to flip `board.realtime_enabled` from the app itself — still a
  manual DB flip per "Enabling a pilot board" above.
- No admin visibility into `RoomManager`'s diagnostic accessors
  (`getActiveRoomCount`/`getActiveSessionCount`) — not wired to any endpoint.
- The reserved `'viewer'` role (read-only, cannot comment) has no code
  path that produces it yet — no sharing mode exists today that grants
  read access without also granting comment rights. The type and its
  enforcement (`roleCanComment`) exist so a future stricter sharing mode
  doesn't need a new tier invented from scratch.
- Comments and presence data are NOT subject to the periodic
  re-validation interval — only canvas write capability is actively
  re-checked every 15s. A comment REST call is re-validated on every
  request already (no interval needed, since it's not a persistent
  connection); presence is inherently tied to the same document-sync
  session the write gate already covers.
