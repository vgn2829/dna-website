# DnA Club Website — Full Codebase Audit Report

*Date: 2026-07-31 | Branch: `feat/manual-event-artwork-notifications` | HEAD: `9be1a27`*

This is a ground-truth re-audit. A prior `AUDIT_REPORT.md` existed at commit `326a463`
(2026-06-14), but 172 commits have landed since then, so it was treated only as
background context, not a source of truth. This report supersedes it.

**Coverage**: Full. Every backend route/middleware/service/schema file, every frontend
page and shared context, the Admin dashboard (3782 lines), the entire Design Studio
subsystem (SVG converter, halftone, AI background removal, image cropper), the
Moodboards/collaborative-canvas feature, deploy config (Docker/nginx/Vercel), the
dependency tree, and the test suite were read in full and reviewed. `PaletteStudio.tsx`
(2023 lines) was intentionally reviewed only at the wiring level and not deep-audited,
per this project's own prior decision to treat it as a stable, previously-reviewed
generation engine that's off-limits for changes — see `AUDIT_TASKS.md` for the full
unit-by-unit checklist this report was built from.

---

## Architecture Summary

**Frontend**: React 18 + TypeScript SPA, Vite build, `react-router` (data router),
Tailwind v4 + a custom CSS-variable design-token system, `motion` for animation,
shadcn/Radix UI primitives. Three heavy client-side subsystems run in Web Workers:
SVG vectorization (`vtracer-wasm`), AI background removal (`onnxruntime-web`, ONNX
models `u2netp`/`modnet`), and a collaborative moodboard canvas (`tldraw`).

**Backend**: Express + TypeScript, single `createApp()` factory (`backend/src/app.ts`),
Postgres via `pg` (schema managed by a hand-rolled idempotent migration runner in
`schema.ts`, not an ORM). Two auth systems: admin (single shared password → JWT) and
student (IITK-email OTP → JWT), both via `jsonwebtoken` + `bcryptjs`. File storage is
pluggable — local disk in dev, Supabase Storage in production — behind a small
`StorageProvider` interface. Outbound email via Resend, with a custom quota-gating
layer (`mailer.ts`) that protects login-critical OTP/welcome mail from being starved
by bulk "Notify Students" broadcasts, plus a queue table drained by an externally
-triggered `/api/internal/tick` endpoint (since the free-tier host spins down when idle).

**Data flow**: Frontend talks to the backend exclusively through `src/app/lib/api.ts`,
a thin typed `fetch` wrapper that attaches admin (sessionStorage) or student
(localStorage) JWTs as needed. `AppDataContext` holds shared CRUD state (events,
artworks, domains, team) fetched once on mount; page components read from it rather
than calling the API directly (except Admin, Moodboards, and Live Sessions, which call
`api.*` directly for their own domains).

**Deploy**: Dockerized (separate frontend/nginx and backend containers via
`docker-compose.yml`), or Vercel (frontend) + a Node host (backend) per `vercel.json`
and `DEPLOYMENT.md`. `nginx.conf` carries a genuinely well-considered CSP (hash-pinned
inline script, no blanket `unsafe-inline` for scripts).

**Overall code quality**: Notably higher than the "vibe coded" framing suggests for the
backend and most page components — consistent Zod validation, parameterized SQL,
rate limiting, JWT algorithm pinning, thoughtful inline comments explaining
non-obvious tradeoffs (quota gating, CORS, storage path traversal guards). The
**Admin dashboard and the Moodboards/canvas feature** are the two areas where quality
drops and real bugs surface — both are reported in detail below.

---

## Critical Issues (security / data-loss / broken-flow risk)

### C1. Zero automated test coverage for anything that touches auth, money-equivalent state, or data mutation
The entire repository has exactly one test file: `tests/palette-engine.test.js`, a
standalone Node script (not wired into either `package.json`'s `scripts`, so `npm test`
doesn't even exist) that checks the color-palette derivation engine only. There are
**no tests** for: admin/student login, OTP request/verify/expiry/attempt-lockout, JWT
verification, event RSVP capacity/race-condition handling, artwork/board CRUD,
storage upload/delete, the mail quota gate, or the reminder-tick endpoint. For a site
with real user accounts, file uploads, and a from-scratch OTP auth system, this is the
single biggest structural risk in the codebase — regressions in auth or RSVP capacity
logic would ship silently.
**Fix (described)**: at minimum, add integration tests for the OTP flow (request →
verify → attempt lockout → expiry) and the RSVP capacity race (concurrent requests at
the boundary), since these are the two flows most likely to have a subtle bug with
real consequences (locked-out students, over-capacity events).

### C2. AdminPage: session token is never restored on page load
`src/app/pages/AdminPage.tsx` initializes `const [authed, setAuthed] = useState(false)`
and never checks `getAdminToken()` (from `src/app/lib/api.ts:122`) on mount. Every
full page reload of `/admin` — including an accidental refresh — drops a still-valid,
unexpired admin straight back to the login screen, even though the token is sitting
untouched in `sessionStorage`. Not a security hole (the server still enforces via
`requireAdmin`), but it's a broken-flow bug that will look like "I got logged out for
no reason" to whoever administers the site.
**Fix (described)**: initialize `authed` from `!!getAdminToken()` on mount (optionally
confirmed with one cheap authed GET before trusting it).

### C3. AdminPage: 401/SESSION_EXPIRED is only handled for a subset of admin actions
`api.ts:150` throws `Error('SESSION_EXPIRED')` on a 401 for admin-scoped calls, and
`AppDataContext.tsx`'s `onAdminErr` catches that specific message and redirects to
`/admin` — but that helper is wired in only for the events/artworks/domains/team/notify
CRUD functions that live inside `AppDataContext`. Every other admin surface —
**Settings, Coordinators, Live Sessions, Moodboards-admin, Email Templates, Custom
Announcements, Registrants** — calls `api.*` directly inside `AdminPage.tsx` and
catches errors with a generic `.catch(() => setError('Failed to load...'))`, never
checking for `SESSION_EXPIRED`. Concretely: an admin's token expires while on the
Settings or Sessions tab; every action from then on just shows a generic "Failed to
load" message forever, with no indication why and no path back to login — a dead end.
**Fix (described)**: centralize the SESSION_EXPIRED check (a shared response
interceptor, or route every admin `api.*` call through one wrapper) instead of
duplicating ad hoc `.catch` blocks per tab.

### C4. AdminPage: several mutations report success before the network request resolves
In `AppDataContext.tsx`, `addEvent`, `addVideo`, `deleteArtwork`, `toggleFeatured`,
`deleteVideo`, and `deleteTeamMember` are typed `void`, not `Promise`, and only
`.catch(onAdminErr)` internally (console.error on anything but session expiry). Their
callers in `AdminPage.tsx` assume success unconditionally:
- `EventsTab.handleAdd` (~line 1741) clears the form and shows "Event created" **before**
  the POST resolves. If it fails (validation error, network blip), the admin sees a
  false success message and the event silently never exists.
- `AcademyTab.handleAddVideo` (~line 497) clears the form and runs a hardcoded 600ms
  fake-loading `setTimeout`, unrelated to whether the request actually succeeded.
- `GalleryTab.handleToggleFeatured` (~line 817) flips the star icon optimistically for
  a fixed 800ms, with no rollback UI if the PATCH fails.
**Fix (described)**: make these context functions return promises that reject on
failure, `await` them in the handlers, and only show success / clear the form after
real resolution; surface caught errors in the tab's own error state.

### C5. Moodboards: `canvasLoadedRef` is not reset when navigating between two boards without a full page reload
`BoardPage.tsx` keys `canvasLoadedRef` (and the canvas-loading branch of `loadBoard`)
by a ref that is never reset when the route's `:id` param changes. React Router does
**not** remount the page component just because a param changed on the same route
element — so if a user reaches a different board id while `BoardPage` stays mounted
(e.g. browser back/forward through board history), `canvasLoadedRef.current` is
already `true` from the previous board, the canvas-load branch is skipped, and
`TldrawCanvas` (which also isn't given a `key={id}`) keeps showing the **previous
board's** canvas content under the new board's URL/metadata.
**Fix (described)**: reset `canvasLoadedRef.current = false` (and `setCanvasReady(false)`)
whenever `id` changes inside `loadBoard`, or simpler — pass `key={id}` to force a clean
remount of the canvas subtree per board.

### C6. Moodboards: no conflict detection for concurrent multi-user canvas edits
`TldrawCanvas.tsx` debounces local edits 3s then PUTs the *entire* canvas snapshot to
`/api/boards/:id/canvas`. There is no version/ETag check, no merge, and no polling of
remote state back into an already-open canvas. For a board with `edit_mode: 'anyone'`
or multiple members editing simultaneously, whichever client's debounced save lands
last **silently overwrites** the other's entire canvas with no warning to either party
— the save-status indicator will still show "Saved" on both sides while one user's
work has actually been discarded.
**Fix (described)**: at minimum, add a server-side version counter checked before
accepting a write (reject/merge on mismatch, surface a conflict toast), or poll for
remote changes while idle and warn before an overwriting save.

### C7. `ResourcesPage` is 100% hardcoded mock data with dead CTAs
`src/app/pages/ResourcesPage.tsx` has no backend integration whatsoever — the 12
"resources" (fake authors, fake ratings, fake durations) are a static array in the
component. Every card's external-link icon and the "Submit a Resource" button have no
`href`/`onClick` at all. This isn't a bug in the traditional sense, but it is a
**live, publicly-reachable page that looks fully functional and does nothing** — a
student who clicks any resource card or the submit CTA gets silence. This needs a
product decision (build the real backend-driven feature, or pull the page/nav link
until it's ready) rather than a code fix.

---

## Bugs / Correctness Issues

### B1. `SvgConverter.tsx` — object URL for the raster source image is never revoked
`handleFileUpload` calls `setImageUrl(URL.createObjectURL(file))` unconditionally,
discarding the previous URL without revoking it; `reset()` clears `imageUrl` to `null`
without revoking either. This is inconsistent with the SVG-upload path (`resetRaster()`,
`handleSvgUpload`), which correctly revokes before replacing. Repeated upload/reset
cycles in one session leak decoded-bitmap memory, worst on mobile.
**Fix (described)**: revoke the previous `imageUrl` before replacing it, in both
`handleFileUpload` and `reset()`.

### B2. `BackgroundRemover.tsx` — a stale in-flight inference can paint onto a newer image
`changeModel()` and `handleFile()` both call `clearResult()`/`resetEngine()` but do not
cancel an in-flight `removeBackground()` promise. If a user clicks "Remove Background,"
then uploads a different image before inference finishes, the original promise still
resolves and unconditionally calls `resetHistory(mask)` / `setHasResult(true)` — painting
a mask computed against the old image's dimensions onto the new canvas. `applyMask`
only clamps by `Math.min(mask.length, out.length/4)`, so it silently truncates/misaligns
rather than erroring.
**Fix (described)**: give each `handleRemove` call a generation token (a ref incremented
on every `handleFile`/`changeModel`), captured at call time and checked before applying
the resolved mask.

### B3. `HalftoneStudio.tsx` — synchronous main-thread processing with no debounce or worker offload
Unlike the SVG and background-removal tools, halftone processing runs synchronously on
the main thread inside a `requestAnimationFrame` callback. With aggressive slider
values (low detail/spacing) on a large image, the nested pixel loops run millions of
iterations per frame, visibly freezing the UI on slider drag — worse on low-end/mobile
devices. `requestAnimationFrame` cancellation prevents queuing but not the per-run cost.
**Fix (described)**: move `processHalftone` to a Web Worker (matching the pattern
already used elsewhere in Design Studio), or add a debounce plus a cheaper live-preview
resolution while dragging.

### B4. `GalleryPage.tsx` — PDF viewer's error fallback effectively never fires
`MediaViewer`'s PDF branch relies on `<iframe onError={() => setPdfLoadFailed(true)}>`
around a Google Docs Viewer URL. Iframe `onError` essentially never fires for this kind
of failure — a broken/inaccessible PDF still "loads" the iframe document (the viewer's
own error page), so the fallback UI ("Unable to display PDF… Open PDF") is dead code in
practice; a broken PDF just silently shows an empty/broken embedded viewer instead.
**Fix (described)**: detect failure via the Docs Viewer's own postMessage API if
available, or drop the false confidence and always show the "Open PDF" link alongside
the iframe rather than gating it behind an error state that won't trigger.

### B5. `event_rsvps` reminder-tick query has no supporting index
`backend/src/routes/internal.ts` (`/tick`, hit every ~10 min by an external scheduler)
runs a query filtered on `reminder_sent_at IS NULL` joined against `events`/
`student_sessions`. `event_rsvps` has only its composite PK `(event_id, roll_number)` —
no index backs the `reminder_sent_at IS NULL` scan, and old RSVP rows are never pruned.
As RSVPs accumulate across dozens of past events, every 10-minute tick does a growing
full-table scan indefinitely.
**Fix (described)**: add a partial index, e.g.
`CREATE INDEX ON event_rsvps (event_id) WHERE reminder_sent_at IS NULL`.

### B6. `boards` "my boards" query has no supporting index
`backend/src/routes/boards.ts` (`GET /api/boards`) filters on
`owner_roll = $1 OR id IN (SELECT board_id FROM board_members WHERE roll_number = $1)`.
Neither `boards.owner_roll` nor `board_members.roll_number` alone is indexed (the
latter's composite PK is `(board_id, roll_number)`, which doesn't serve a
roll-number-only lookup). Every dashboard load will do two full scans as boards grow.
**Fix (described)**: `CREATE INDEX ON boards(owner_roll)` and
`CREATE INDEX ON board_members(roll_number)`.

### B7. Timestamp columns are inconsistently `TEXT` vs `TIMESTAMPTZ` across the schema
Several tables store point-in-time values as `TEXT` ISO strings written by JS
(`student_sessions.registered_at`, `live_sessions.scheduled_at`/`created_at`,
`session_joins.joined_at`, `boards.created_at`, `board_items.created_at`,
`audience_group_members.added_at`, `email_templates.updated_at`, `app_settings.updated_at`)
while others correctly use `TIMESTAMPTZ` (`events`, `artworks`, OTP tables, `mail_usage`,
`mail_queue`). The `TEXT` columns can't be used in native SQL interval arithmetic (the
way `events.starts_at BETWEEN NOW() AND ...` is used in the reminder tick) and depend
entirely on every write path producing a consistently-sortable ISO string.
**Fix (described)**: standardize on `TIMESTAMPTZ` for all point-in-time columns; the
`TEXT` ones appear to be legacy from an earlier schema iteration.

### B8. `artworks.domain` has no referential integrity to `domains`
Unlike `videos.domain_id`/`quiz_questions.domain_id` (both `REFERENCES domains(id)
ON DELETE CASCADE`), `artworks.domain` is a free-text column with no FK. Renaming or
deleting a domain silently orphans existing artworks' domain label with no cascade or
warning.
**Fix (described)**: add a foreign key (or rename to `domain_id` for clarity) if
domains are meant to be stable identifiers artworks can rely on.

### B9. TeamPage: "Learn more" CTA button has no handler
`src/app/pages/TeamPage.tsx` (~line 267): `<button ...>Learn more</button>` has no
`onClick` at all — a dead button sitting next to the working "Apply Now" link.

### B10. Moodboards: duplicated last-3-digit roll-number hash is fragile to non-numeric characters
`BoardPage.tsx` inlines `` `hsl(${parseInt(roll.slice(-3)) % 360}, 60%, 45%)` `` three
times for avatar coloring. If a roll number's last 3 characters aren't purely numeric,
`parseInt` returns `NaN`, producing an invalid HSL color that renders as a browser
default (likely black). Should use a hash function tolerant of non-numeric input, and
be extracted to one shared helper instead of being copy-pasted three times.

### B11. Moodboards: pending debounced canvas save is lost on in-app navigation
`TldrawCanvas.tsx` flushes its pending save on `visibilitychange`/`beforeunload`, which
covers tab close/switch, but client-side route navigation (e.g. clicking "← Boards")
just unmounts the component with no equivalent flush-on-unmount effect. A user who
draws something and immediately navigates away within the 3-second debounce window
loses that edit silently.
**Fix (described)**: add an unmount effect that calls `handleSave()` best-effort before
cleanup.

---

## Code Quality / Maintainability Issues

- **AdminPage.tsx (3782 lines) has heavy duplicated CRUD-modal boilerplate.** The
  add/edit forms for Academy domains/videos, Gallery artworks, Team members, and Events
  each repeat ~100-150 lines of near-identical `useState`-per-field + submit-handler +
  form JSX. A shared `useEntityForm`/`<EntityFormModal>` abstraction would remove
  several hundred lines of duplication and the copy-paste drift already visible (e.g.
  one tab awaits its submit properly while a sibling tab fakes a timer instead).
- **AdminPage.tsx mixes two visibly different styling conventions** — earlier tabs
  (Academy, Gallery, Team, Events) use the shared utility classes (`type-micro`, `card`,
  `btn-primary`) consistent with the rest of the site, while later tabs (Settings,
  Templates, Sessions, Moodboards-admin) are written with large ad hoc inline `style={{}}`
  blocks repeating the same design tokens dozens of times. Looks like two different
  authoring sessions; worth consolidating for maintainability.
- **AdminPage.tsx: leftover debug `console.log` statements** in `TeamTab`'s
  `handleEditMember` and the photo-crop `onChange` handler (multiple lines logging
  `'=== handleEditMember called ==='`, file name/size/type, `'updateTeamMember SUCCESS'`
  etc.) — noisy in production console and mildly leaky about uploaded file metadata.
- **AdminPage.tsx: `SessionsTab`/`MoodboardsAdminTab` type API responses as `any[]`**
  (sessions, groups, past sessions, boards), unlike every other tab, which uses the
  properly typed context values — this throws away compiler protection on the two
  largest remaining untyped surfaces.
- **AdminPage.tsx: `CustomAnnouncement`'s live preview uses `dangerouslySetInnerHTML`
  directly into the page** for admin-authored HTML, while the sibling `TemplateEditor`
  preview correctly uses a sandboxed `srcDoc` iframe. Low real-world risk (admin-only,
  self-XSS at worst) but an inconsistency worth aligning.
- **Moodboards: significant duplicated logic between `MoodboardsPage.tsx` and
  `BoardPage.tsx`** — copy-to-clipboard-with-fallback, visibility/edit-mode toggle
  handlers, add/remove-member handlers (with slightly different error copy: "must
  register first" vs. "they must register first"), and the delete-board confirm modal
  are all near-verbatim duplicated between the two files rather than shared.
- **`schema.ts`: hardcoded team roster and coordinator roll numbers/names seeded
  directly in the migration file** (real student names + roll numbers, arguably PII,
  committed to source control permanently). Every committee turnover currently
  requires a code change + deploy rather than an admin-UI action.
- **`schema.ts`: inconsistent uniqueness modeling** — `session_joins` uses a surrogate
  `id` PK plus a `UNIQUE(session_id, roll_number)` constraint, while every structurally
  similar join table (`event_rsvps`, `artwork_likes`, `board_members`,
  `audience_group_members`) uses a natural composite PK. Not a bug, just an
  inconsistent pattern in an otherwise disciplined schema.
- **`SvgConverter.tsx`/`vectorize.worker.ts`**: duplicated image-decode/downscale
  boilerplate between `processImage` and `vectorizeImage`; the SVG post-processing
  relies on regexes against vtracer's raw output string, workable but fragile to any
  upstream format change (undocumented beyond an inline comment).
- **`DesignStudioPage.tsx` (1445 lines)** bundles several unrelated tools (font
  pairing, contrast checker, image converter, grid calculator) plus the tab shell in
  one file, unlike SvgConverter/HalftoneStudio/BackgroundRemover, which each get their
  own file. Worth splitting for future-audit and diff legibility.
- **`backend/src/routes/boards.ts`: `canAccess()` helper is defined but never called**
  — the actual access checks route through `isMember`/`canEdit` instead. Dead code,
  safe to remove.
- **`backend/src/routes/notify.ts`: `GET /notify/test-email`** is a leftover manual
  debug endpoint (hits Resend directly, logs `RESEND_API_KEY: SET/NOT SET` to the
  server console) gated only by `requireAdmin`. Functionally harmless but reads as
  debug scaffolding that should either be removed or moved behind a dev-only flag.

---

## UI/UX Issues

### Navigation & flow
- Overall navigation is clear: a persistent floating nav pill, consistent page headers,
  and a guest-friendly "Join" CTA. No dead-end flows found in the primary pages.
- **ResourcesPage** (see C7) is effectively an orphaned dead end dressed as a working
  feature — the highest-priority UX issue found, because it actively misleads users
  into thinking a submission/browsing feature exists.
- **AdminPage session-expiry dead ends** (see C3): Settings/Sessions/Moodboards-admin
  tabs show a static "Failed to load" message forever after a token expires, with no
  retry button and no link back to login.

### Loading / empty / error states
- Page-level async states (HomePage's children, Events, Gallery, Academy, Team) all
  correctly implement loading/error/empty states via `AppDataContext`'s shared
  `loading`/`error` flags.
- Moodboards (`MoodboardsPage`/`BoardPage`) has particularly well-handled states,
  including distinct 403 ("This board is private") and 404 ("Board not found")
  messages with a clear back-navigation CTA — a high point of the UI/UX pass.
- **HalftoneStudio** has no user-facing error state for a rejected file drop (wrong
  MIME type silently no-ops), inconsistent with `BackgroundRemover`'s equivalent
  upload path, which does surface a rejection message.
- **AcademyTab (admin)**: "Add Video" has no success confirmation message at all,
  unlike its sibling Gallery/Events tabs — combined with C4, an admin has no reliable
  signal the action worked.

### Forms
- Student OTP flow (`RollModal`) and email-change flow (`ChangeEmailModal`) both have
  solid inline validation, clear step-by-step UX, shake animation on error, and
  correctly scoped loading/disabled states on submit buttons — a high point.
- **AdminPage Team tab**: Instagram/LinkedIn fields are plain text inputs with no URL
  format validation (email field alone gets `type="email"`); a typo'd social link
  saves silently and only surfaces as broken on the public Team page later.

### Responsive / accessibility
- **BoardPage's top action bar** (back button, name, save-status badge, avatar stack,
  Share/Invite/Delete buttons) uses `whiteSpace: nowrap` on most elements with no
  responsive collapse — on a phone-width viewport this bar will overflow/clip since
  nothing wraps or collapses into an overflow menu.
- Most marketing pages use Tailwind responsive classes (`md:`, `lg:`) consistently;
  the Navigation, Team, and Academy pages all have deliberate mobile breakpoints
  (verified in code — a live-render check is still recommended before shipping any
  visual changes, per this audit's text-only nature).

### Visual/design consistency
- See "AdminPage mixes two visibly different styling conventions" above — the most
  concrete design-consistency finding in the codebase.

---

## Quick Wins (low effort, real impact)

1. Fix C2 (restore admin session from `sessionStorage` on mount) — a few lines,
   removes a recurring annoyance for whoever administers the site.
2. Fix B1 (revoke `imageUrl` object URL in SvgConverter) — a one-line addition in two
   places, matching a pattern already correctly used elsewhere in the same file.
3. Remove the leftover `console.log` debug statements in AdminPage's Team tab.
4. Wire up or remove TeamPage's dead "Learn more" button.
5. Add the missing indexes from B5/B6 — two `CREATE INDEX` statements.
6. Delete the unused `canAccess()` helper in `boards.ts`.
7. Run `npm audit fix` at the root and in `backend/` — two low-severity advisories
   (`body-parser` DoS, `esbuild` dev-server file read on Windows), both fixable without
   a major version bump.
8. Wire `tests/palette-engine.test.js` into an actual `npm test` script in
   `package.json` so it at least runs somewhere (CI or pre-commit), rather than being
   a script nobody invokes.

---

## Explicitly Out-of-Scope / Needs a Product Decision

- **ResourcesPage (C7)**: is this meant to become a real backend-driven feature, or
  should the page/nav link be pulled until it is? Can't be resolved with a code fix
  alone.
- **Team roster / coordinator seed data living in `schema.ts` (see Code Quality)**:
  moving this to an admin-UI-driven flow is a real feature request, not a bug fix —
  flagging the current state, not prescribing the solution.
- **Docker Compose's backend service** doesn't pass through `DATABASE_URL`,
  `RESEND_API_KEY`, or Supabase storage vars — meaning the documented `docker-compose`
  path will crash on the `server.ts` startup guard (`DATABASE_URL` is required) unless
  those are supplied externally. Worth clarifying in `DEPLOYMENT.md` whether Compose is
  meant to be a fully self-contained local-Postgres setup or assumes an external DB —
  currently ambiguous.
- **Live UI/browser verification**: this audit was code-only (no dev server was run
  against a live browser). Visual/responsive claims above are inferred from
  Tailwind classes and inline styles, not confirmed by rendering — recommend a manual
  pass on mobile viewport widths for BoardPage's action bar specifically (flagged
  above) before considering that finding fully confirmed.
- **Dependency majors**: React 18→19, Express 4→5, MUI 7→9, Zod 3→4, and several Radix
  packages are all one or more majors behind. None showed a *known* high-severity CVE
  in this pass (only two low-severity advisories, both in transitive deps, see Quick
  Wins), but a deliberate upgrade pass is a product/timing decision, not something to
  do incidentally during a bug-fix pass.

---

## What Was Covered vs. Not

**Fully covered** (read in complete detail): all backend route/middleware/service/
storage files, `schema.ts` (754 lines), `client.ts`, `seed.ts`; all frontend contexts,
the API client, routing/app-shell; every marketing/content page (Home, Events, Gallery,
Team, Academy, Resources) and their key sub-components; the entire Admin dashboard
(3782 lines); the entire Moodboards/canvas feature; the entire Design Studio subsystem
except PaletteStudio's internals (SvgConverter, HalftoneStudio, BackgroundRemover and
all their supporting worker/hook/util files, ImageCropper); deploy config (Dockerfiles,
nginx, docker-compose, vercel.json); the full dependency tree (`npm outdated`/
`npm audit` at both root and backend); the one existing test file.

**Not deep-audited, by design**: `PaletteStudio.tsx`'s internal generation/scoring
algorithm — reviewed only at the wiring level, per this project's standing decision
to treat that file as a stable, previously-reviewed engine that's off-limits for
changes. The shared shadcn/Radix UI kit (`components/ui/*`) was spot-checked rather
than read file-by-file, since it's largely unmodified vendor-generated component
scaffolding; nothing unusual surfaced in the spot check.
