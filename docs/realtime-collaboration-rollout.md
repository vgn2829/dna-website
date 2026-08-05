# Realtime Collaboration — Rollout Notes (Commits 1, 2 & 3)

This covers everything needed to run and verify the realtime foundation
(WebSocket transport + room lifecycle, commits `77ea49b`/`7393ab9`) and the
frontend `@tldraw/sync` integration (Commit 3). As of Commit 3, a
realtime-enabled board is genuinely usable end-to-end through the real UI —
this is no longer backend-only infrastructure.

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

## What's explicitly NOT yet built (don't test for these)

- No presence, cursors, avatars, or any multi-user awareness UI (Phase 2,
  not this commit).
- No comments, sticky notes, version history, notifications, or plugins.
- No server-side write enforcement for `role: 'viewer'` — documented as a
  known limitation in `roomAccess.ts`, must be resolved before Comments /
  Sticky Notes / Version History / public sharing / team workspaces. In
  Commit 3 terms: a `readOnly` client hides the UI (`hideUi`) but nothing
  server-side rejects a write if one were sent anyway — same trust model
  the manual path already had, not a new gap.
- No UI to flip `board.realtime_enabled` from the app itself — still a
  manual DB flip per "Enabling a pilot board" above.
- No admin visibility into `RoomManager`'s diagnostic accessors
  (`getActiveRoomCount`/`getActiveSessionCount`) — not wired to any endpoint.
