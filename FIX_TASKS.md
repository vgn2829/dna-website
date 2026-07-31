# Fix Task List

Tracks implementation of fixes for findings in `AUDIT_REPORT.md`. Mirrors the report's
issue IDs. Each row is fixed on its own branch off `main` and shipped as its own PR
(or a small logical group of PRs where noted). Status: not started / in progress / done.

**Explicitly excluded from this pass** (per instructions — do not fix):
- PaletteStudio.tsx internals — off-limits, wiring only.
- schema.ts hardcoded team roster / admin-UI roster management — feature request, skip.
- Anything else under "Explicitly Out-of-Scope / Needs a Product Decision" in the report
  not otherwise called out below.

**Follow-up phase (this update)** — two items previously held back are now in scope:
- **C7 (ResourcesPage)**: decision made — build the real feature. See "C7 — ResourcesPage"
  section below for the plan.
- **Dependency majors**: decision made — evaluate each independently, upgrade only what's
  verifiably safe (typecheck + test suite + build), defer the rest with a stated reason.
  See "Dependency majors" section below.

## Order of work

1. C1 first (test infra) — everything after this should be verifiable by tests where
   the fix touches previously-untested logic.
2. Remaining Critical (C2–C6)
3. Bugs/Correctness (B1–B11)
4. Code Quality/Maintainability
5. UI/UX
6. Remaining Quick Wins

## Task table

| ID | Issue | Area | PR grouping | Branch | Status |
|----|-------|------|-------------|--------|--------|
| C1 | Zero test coverage for auth/OTP/RSVP | backend test infra | own PR | `test/otp-rsvp-integration-tests` | done |
| C2 | AdminPage: session token never restored on mount | frontend/Admin | grouped with C3+C4 | `fix/admin-session-and-error-handling` | not started |
| C3 | AdminPage: 401/SESSION_EXPIRED only handled for subset of actions | frontend/Admin | grouped with C2+C4 | `fix/admin-session-and-error-handling` | not started |
| C4 | AdminPage: mutations report success before request resolves | frontend/Admin | grouped with C2+C3 | `fix/admin-session-and-error-handling` | not started |
| C5 | Moodboards: canvasLoadedRef not reset on board id change | frontend/Moodboards | grouped with C6+B10+B11 | `fix/moodboards-canvas-integrity` | not started |
| C6 | Moodboards: no conflict detection for concurrent canvas edits | frontend/Moodboards | grouped with C5+B10+B11 | `fix/moodboards-canvas-integrity` | not started |
| B1 | SvgConverter: imageUrl object URL never revoked | frontend/Design Studio | grouped with B2+B3 | `fix/design-studio-worker-lifecycle` | not started |
| B2 | BackgroundRemover: stale in-flight inference can paint onto newer image | frontend/Design Studio | grouped with B1+B3 | `fix/design-studio-worker-lifecycle` | not started |
| B3 | HalftoneStudio: synchronous main-thread processing, no debounce/worker | frontend/Design Studio | grouped with B1+B2 | `fix/design-studio-worker-lifecycle` | not started |
| B4 | GalleryPage: PDF viewer error fallback never fires | frontend/Gallery | own PR (small, isolated) | `fix/gallery-pdf-fallback` | not started |
| B5 | event_rsvps reminder-tick query has no supporting index | backend/schema | grouped with B6+B7+B8 | `fix/schema-indexes-and-types` | not started |
| B6 | boards "my boards" query has no supporting index | backend/schema | grouped with B5+B7+B8 | `fix/schema-indexes-and-types` | not started |
| B7 | Timestamp columns inconsistently TEXT vs TIMESTAMPTZ | backend/schema | grouped with B5+B6+B8 | `fix/schema-indexes-and-types` | not started |
| B8 | artworks.domain has no FK to domains | backend/schema | grouped with B5+B6+B7 | `fix/schema-indexes-and-types` | not started |
| B9 | TeamPage: "Learn more" button has no handler | frontend/Team | grouped with B10(dup)/quick wins | `fix/small-ui-quick-wins` | not started |
| B10 | Moodboards: roll-number hash fragile to non-numeric chars | frontend/Moodboards | grouped with C5+C6+B11 | `fix/moodboards-canvas-integrity` | not started |
| B11 | Moodboards: pending debounced save lost on in-app navigation | frontend/Moodboards | grouped with C5+C6+B10 | `fix/moodboards-canvas-integrity` | not started |
| CQ1 | AdminPage: duplicated CRUD-modal boilerplate | frontend/Admin | own PR (large refactor, isolated from bug fixes) | `refactor/admin-entity-form` | not started |
| CQ2 | AdminPage: two inconsistent styling conventions | frontend/Admin | defer — see note below | — | deferred |
| CQ3 | AdminPage: leftover debug console.log statements | frontend/Admin | grouped with C2+C3+C4 | `fix/admin-session-and-error-handling` | not started |
| CQ4 | AdminPage: SessionsTab/MoodboardsAdminTab typed `any[]` | frontend/Admin | grouped with C2+C3+C4 | `fix/admin-session-and-error-handling` | not started |
| CQ5 | AdminPage: CustomAnnouncement uses dangerouslySetInnerHTML, not sandboxed iframe | frontend/Admin | grouped with C2+C3+C4 | `fix/admin-session-and-error-handling` | not started |
| CQ6 | Moodboards: duplicated logic between MoodboardsPage/BoardPage | frontend/Moodboards | grouped with C5+C6+B10+B11 | `fix/moodboards-canvas-integrity` | not started |
| CQ7 | schema.ts: hardcoded team roster in migration | backend/schema | **excluded — feature request** | — | excluded |
| CQ8 | schema.ts: session_joins inconsistent uniqueness modeling | backend/schema | grouped with B5+B6+B7+B8 | `fix/schema-indexes-and-types` | not started |
| CQ9 | SvgConverter/vectorize.worker: duplicated decode boilerplate, fragile regex | frontend/Design Studio | grouped with B1+B2+B3 (if time permits) | `fix/design-studio-worker-lifecycle` | not started |
| CQ10 | DesignStudioPage.tsx bundles unrelated tools in one file | frontend/Design Studio | defer — see note below | — | deferred |
| CQ11 | boards.ts: unused canAccess() helper | backend | grouped with quick wins | `fix/small-ui-quick-wins` | not started |
| CQ12 | notify.ts: leftover /test-email debug endpoint | backend | grouped with quick wins | `fix/small-ui-quick-wins` | not started |
| UX1 | ResourcesPage dead CTAs | — | **excluded — same as C7** | — | excluded |
| UX2 | AdminPage session-expiry dead ends | frontend/Admin | same as C3 | `fix/admin-session-and-error-handling` | not started |
| UX3 | HalftoneStudio: no error state for rejected file drop | frontend/Design Studio | grouped with B1+B2+B3 | `fix/design-studio-worker-lifecycle` | not started |
| UX4 | AcademyTab (admin): no success confirmation for Add Video | frontend/Admin | grouped with C2+C3+C4 | `fix/admin-session-and-error-handling` | not started |
| UX5 | AdminPage Team tab: no URL validation on social links | frontend/Admin | grouped with C2+C3+C4 | `fix/admin-session-and-error-handling` | not started |
| UX6 | BoardPage top action bar not responsive on mobile | frontend/Moodboards | grouped with C5+C6+B10+B11 | `fix/moodboards-canvas-integrity` | not started |
| QW1 | npm audit fix (root + backend) | deps | own tiny PR | `fix/npm-audit-advisories` | not started |
| QW2 | Wire palette-engine test into npm test script | test infra | grouped with C1 | `test/otp-rsvp-integration-tests` | done — surfaces 20 pre-existing failures in PaletteStudio's engine (off-limits code); wired as-is per explicit confirmation, not silently fixed or skipped |
| C7 | ResourcesPage: build the real feature (schema, routes, admin tab, public page) | backend + frontend/Resources | own PR (largest change) | `feat/resources-page` | done — schema+routes+tests+frontend+admin tab all implemented, verified (typecheck, 19/19 tests, build), PR opened; domain-modeling fork (FK to domains vs. free-text) flagged in the plan below, chose FK-to-domains, easy to revisit |
| DEP1 | React 18→19 + @types/react, @types/react-dom, @vitejs/plugin-react | deps | own PR, only if verified safe | `chore/upgrade-react-19` (if pursued) | **deferred** — tldraw@2.4.4 (Moodboards canvas) is React-18-only; see Dependency majors table for full reasoning. No code changes shipped; install was attempted, verified blocked, then cleanly reverted (confirmed zero diff to package.json/pnpm-lock.yaml). |
| DEP2 | Express 4→5 | deps/backend | own PR, only if verified safe | `chore/upgrade-express-5` | done — upgraded, verified (typecheck, 15/15 tests, build clean), PR opened |
| DEP3 | MUI 7→9 (@mui/material, @mui/icons-material) | deps | own PR, only if verified safe | `chore/upgrade-mui-9` (if pursued) | not started |
| DEP4 | Zod 3→4 | deps/backend | own PR, only if verified safe | `chore/upgrade-zod-4` (if pursued) | not started |
| DEP5 | Outdated Radix UI packages (each ~1 minor/major behind) | deps | own PR, only if verified safe | `chore/upgrade-radix` (if pursued) | not started |

**Notes on deferrals**:
- **CQ2** (AdminPage two styling conventions) and **CQ10** (DesignStudioPage bundles
  unrelated tools) are large, purely-cosmetic/structural refactors with real risk of
  introducing visual regressions across a 3700-line and 1400-line file respectively,
  with no way for me to verify visually without a live preview. Flagging back per
  instruction 6 rather than guessing — will revisit after live-preview confirmation
  on the smaller PRs first, if still wanted.

## Dependency majors — evaluation (Item 2)

Evaluated independently per instructions; only upgraded if the migration is mechanical
and verifiable by typecheck + test suite + build, otherwise deferred with a reason.
This section will be filled in with findings as each is actually investigated — not
guessed ahead of time. Order: after C7 ships, before the remaining bug-fix PRs, since
these are independent of everything else and easy to slot in whenever.

| Library | Current → Latest | Verdict | Reason |
|---------|-------------------|---------|--------|
| React + react-dom + @types/* | 18.3.1 → 19.2.8 | **DEFERRED** | `tldraw@2.4.4` (the Moodboards canvas library — `2.4.4` is the version actually pinned here, not latest) peer-depends on `react@^18`/`react-dom@^18` only; no React 19 support until tldraw v5.x, itself a major, unrelated jump. Confirmed via actual install + `pnpm peers check`, not just changelog reading: the bump installs cleanly (all *other* used libraries — Radix, MUI, react-image-crop, react-day-picker, next-themes, embla-carousel, vaul, cmdk, react-responsive-panels, react-slick — declare React 19 support at their currently-pinned versions), but tldraw is the one real blocker. `react-popper` and `react-dnd`/`react-dnd-html5-backend`/`react-responsive-masonry` also lack declared React 19 support but are dead dependencies (grepped `src/` — zero imports), so they don't block anything themselves; flagging as separate dead-dependency cleanup candidates, not part of this deferral's reasoning. `@vitejs/plugin-react` did NOT need a bump — the currently-pinned 4.7.0 has no react/react-dom peer dependency at all and already supports Vite 6/7, so it's excluded from this row's "→ Latest" scope entirely. |
| Express | 4.22.2 → 5.2.1 | **UPGRADED** | No bare `*` wildcard routes (Express 5's `path-to-regexp@8` breaking change doesn't apply here), no `req.param()`/`app.del()`/other removed legacy APIs in use. All Express-adjacent middleware (cors, helmet, express-rate-limit, multer) have wide-open peer/engine ranges compatible with v5. One real, bounded type-level break: `@types/express@5` widens `req.params[key]` from `string` to `string \| string[]` (correctly reflecting routes with repeating path segments, none of which exist in this app); fixed 16 call sites across `boards.ts`/`notify.ts`/`students.ts` with a small shared `param()` narrowing helper (`backend/src/routeParams.ts`) rather than scattering `as string` casts — mechanical, no logic changes, verified every affected route uses a single non-repeating `:param` segment. Bonus: Express 5 also fixes a real latent bug in this codebase — rejected promises in the ~76 `async` route handlers now correctly reach the error-handling middleware automatically, where Express 4 would have silently hung the request. |
| MUI (@mui/material, @mui/icons-material) | 7.3.5 → 9.2.0 | _not yet evaluated_ | — |
| Zod | 3.25.76 → 4.4.3 | _not yet evaluated_ | — |
| Radix UI packages (various) | various, 1 major/minor behind | _not yet evaluated_ | — |

**Note on tooling**: the root project is a **pnpm** workspace (`packageManager: pnpm@11.6.0`,
`pnpm-workspace.yaml` present) — `npm install` at the root doesn't understand pnpm's
`workspace:` protocol used somewhere in the dependency graph and fails or hangs
unpredictably. All root-level dependency work must use `pnpm add`/`pnpm install`, not
`npm`. (The `backend/` directory is a separate, plain npm project — `npm` is correct
there.) This cost real time to discover during the React evaluation; recording it here
so it isn't rediscovered on every subsequent dependency-major evaluation.

## C7 — ResourcesPage: build the real feature (plan)

Status: **plan drafted, implementation starting now per instructions (not blocked on a
separate approval round) — flagging the domain-modeling decision below explicitly since
it's a fork in the design, not just an implementation detail.**

### Why "submit + approve", not "admin-only CRUD"

`ResourcesPage.tsx`'s existing CTA is "**Submit a Resource**" — the club's own copy
already implies students propose resources, not just admins authoring them from
scratch. The codebase already has exactly this shape for a different feature:
`audience_group_members(group_id='coordinators', ..., approved BOOLEAN DEFAULT false)` —
anyone can be added, but only an approved row is "live" for coordinator-gated actions.
Resources follow the same submit → pending → admin-approved shape, reusing a pattern
already proven in this codebase rather than inventing a new one:
- Any signed-in student can submit a resource (rate-limited, same shape as artwork
  comments).
- It's invisible on the public page until an admin approves it.
- Admins can also add a resource directly, pre-approved (mirrors how `team_members` and
  `domains` work today — admin-authored content is immediately live).
- Admins can edit/delete/reorder/approve from a new "Resources" AdminPage tab.

### Schema (new migration section in `schema.ts`, modeled on `domains`/`videos`)

```sql
CREATE TABLE IF NOT EXISTS resources (
  id                 TEXT        PRIMARY KEY,
  title              TEXT        NOT NULL,
  url                TEXT        NOT NULL,           -- external link; https(s)-only, enforced by Zod (same httpsUrl refine pattern as liveSessions.ts meet_link), not a DB CHECK
  author             TEXT        NOT NULL DEFAULT '',
  domain_id          TEXT        REFERENCES domains(id) ON DELETE SET NULL, -- reuses the existing domains table instead of a free-text column (avoids repeating the exact B8 anti-pattern flagged for artworks.domain, on brand new code)
  type               TEXT        NOT NULL CHECK (type IN ('video','article','course')),
  level              TEXT        NOT NULL CHECK (level IN ('Beginner','Intermediate','Advanced')),
  duration_label     TEXT        NOT NULL DEFAULT '', -- free-text display label ("4h 30m", "30m read"), same convention as events.time
  tags               TEXT        NOT NULL DEFAULT '[]', -- JSON array string, same convention as quiz_questions.options
  display_order      INT         NOT NULL DEFAULT 0,
  submitted_by_roll  TEXT        REFERENCES student_sessions(roll_number) ON DELETE SET NULL, -- NULL for admin-authored
  approved           BOOLEAN     NOT NULL DEFAULT false, -- admin-authored rows insert with approved=true directly
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resources_domain ON resources(domain_id);
CREATE INDEX IF NOT EXISTS idx_resources_approved ON resources(approved) WHERE approved = false;
```

**Flagging one real fork before implementing** (not guessing past it): the mock data's
domain list (UI/UX Design, Illustrator, Photoshop, 3D Animation, **After Effects,
Blender, Figma**) doesn't map 1:1 onto the 4 real `domains` rows (UI/UX Design,
Photoshop, Illustrator, 3D Animation). Two options:
1. **FK to the real `domains` table** (as drafted above) — more correct, avoids B8's
   exact anti-pattern, but the public page's domain filter will only ever show the 4
   real Academy domains, not the invented extras (After Effects/Blender/Figma) from
   the old mock data.
2. **Free-text `domain` string column** (matching `artworks.domain`'s existing, already
   audit-flagged pattern) — supports arbitrary domain labels beyond the 4 Academy ones,
   but reintroduces the referential-integrity gap B8 specifically called out as a bug.

Proceeding with **option 1** (FK to `domains`) as the default since it's strictly more
correct and the report explicitly flagged the free-text pattern as a bug elsewhere —
but this is a real product-shape decision (do resources need domains beyond the 4
Academy ones?), not just an implementation detail, so calling it out here rather than
silently deciding. Easy to revisit if option 2 is actually wanted.

Other notes:
- Fabricated `rating` numbers from the mock data are dropped entirely — no rating
  submission mechanism exists or was asked for; showing a fake star rating on real data
  would be its own honesty problem.
- Uses `TIMESTAMPTZ` for `created_at` (not `TEXT`), consistent with the B7 fix
  elsewhere in this fix phase, not the older TEXT convention still used by some
  pre-existing tables.

### Backend routes (`backend/src/routes/resources.ts`, mirrors `routes/team.ts` shape)

- `GET /api/resources` — public. Returns only `approved=true` rows, left-joined with
  `domains` for display name, ordered by `display_order ASC, created_at DESC`.
- `POST /api/resources` — `requireStudent` + rate limit (mirrors `commentLimiter` in
  `artworks.ts`: 60s window, 10 requests). Zod-validated (title, https(s)-only `url`
  via the same `httpsUrl` refine already used in `liveSessions.ts`, `domain_id` must
  reference an existing domain row, `type`/`level` enums). Inserts with
  `approved=false, submitted_by_roll=<from verified JWT>` — identity from the token,
  never client-supplied, same convention as every other student-write route.
- `GET /api/resources/pending` — `requireAdmin`. Lists unapproved submissions for the
  admin moderation queue.
- `POST /api/resources/admin` — `requireAdmin`. Admin-authored resource, inserted with
  `approved=true, submitted_by_roll=null` directly (no moderation queue round-trip).
- `PUT /api/resources/:id` — `requireAdmin`. Edits any field, including `approved`
  (this is how an admin approves a pending submission — flip `approved` via the same
  edit form; no separate approve endpoint needed, simpler than the two-endpoint
  coordinators pattern since there's no "revoke" case to mirror here).
- `PATCH /api/resources/:id/order` — `requireAdmin`. Mirrors `team.ts`'s `/order` patch.
- `DELETE /api/resources/:id` — `requireAdmin`.

### Frontend

- `src/app/lib/api.ts`: add a `resources` section mirroring `team`'s shape (list, add,
  update, delete, patchOrder), plus a student-facing `submit` call.
- `src/app/context/AppDataContext.tsx`: add `resources: Resource[]` to shared state
  (fetched alongside domains/artworks/events/team on mount — approved-only, since
  that's all the public GET returns), plus `submitResource`/admin CRUD callbacks.
- `src/app/pages/ResourcesPage.tsx`: remove the hardcoded `resources` array entirely;
  read from `useAppData()`; wire the "Submit a Resource" CTA to a real submit form
  (title, url, type, level, domain picker) gated behind sign-in (same `openRollModal`
  pattern used elsewhere for guest-gated actions); each card's external-link icon
  becomes a real `<a href={resource.url} target="_blank" rel="noopener noreferrer">`.
- New AdminPage tab "Resources" (`ResourcesTab` function, added to the `TABS` array and
  the `Tab` union type) — built with the **older** styling convention (`card`,
  `btn-primary`/`btn-secondary`, `input-base`, `type-headline`/`type-micro`, inline
  `useState`-per-field forms with `AnimatePresence`/`motion.form` expand-collapse),
  matching `AcademyTab`/`GalleryTab`/`TeamTab` — explicitly NOT the newer ad-hoc
  inline-style convention flagged in CQ2. Shows: a pending-submissions queue
  (approve/reject inline), the full resource list (edit/delete/reorder), and an
  admin-direct "add resource" form.

### Tests (backend, vitest — same pattern as C1)

`backend/tests/resources.test.ts`: public GET returns only approved rows; student
submit requires auth + validates url scheme/domain existence; a submitted resource is
invisible on public GET until approved; admin-direct-add is immediately visible; admin
edit/delete/reorder; rate limit on student submission; 401/404 cases.

### PR

Own branch/PR: `feat/resources-page` — schema + routes + AppDataContext + public page
+ admin tab + tests, all in one PR since the pieces are only meaningfully testable
together (per instructions: largest change, separate from everything else). Branched
from `main` directly (not stacked on the still-open test-infra PR) to keep this PR
independently mergeable.

## PR list (created as work progresses)

| PR | Branch | Contains | Status |
|----|--------|----------|--------|
| #25 | `docs/audit-report-2026-07-31` | AUDIT_REPORT.md + AUDIT_TASKS.md | open |
| #26 | `test/otp-rsvp-integration-tests` | C1, QW2 | open |
| #27 | `feat/resources-page` | C7 | open |
| — | `fix/admin-session-and-error-handling` | C2, C3, C4, CQ3, CQ4, CQ5, UX2, UX4, UX5 | not started |
| — | `fix/moodboards-canvas-integrity` | C5, C6, B10, B11, CQ6, UX6 | not started |
| — | `fix/design-studio-worker-lifecycle` | B1, B2, B3, CQ9, UX3 | not started |
| — | `fix/gallery-pdf-fallback` | B4 | not started |
| — | `fix/schema-indexes-and-types` | B5, B6, B7, B8, CQ8 | not started |
| — | `refactor/admin-entity-form` | CQ1 | not started |
| — | `fix/small-ui-quick-wins` | B9, CQ11, CQ12 | not started |
| — | `fix/npm-audit-advisories` | QW1 | not started |
| — | `chore/upgrade-react-19` (if pursued) | DEP1 | deferred — no PR opened, see Dependency majors table |
| #28 | `chore/upgrade-express-5` | DEP2 | open |
| — | `chore/upgrade-mui-9` (if pursued) | DEP3 | not started |
| — | `chore/upgrade-zod-4` (if pursued) | DEP4 | not started |
| — | `chore/upgrade-radix` (if pursued) | DEP5 | not started |
