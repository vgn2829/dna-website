# Fix Task List

Tracks implementation of fixes for findings in `AUDIT_REPORT.md`. Mirrors the report's
issue IDs. Each row is fixed on its own branch off `main` and shipped as its own PR
(or a small logical group of PRs where noted). Status: not started / in progress / done.

**Explicitly excluded from this pass** (per instructions — do not fix):
- C7 (ResourcesPage) — needs a product decision (rebuild vs. remove).
- PaletteStudio.tsx internals — off-limits, wiring only.
- Dependency majors (React 18→19 etc.) — deliberate upgrade pass, not a bug fix.
- schema.ts hardcoded team roster / admin-UI roster management — feature request.
- Anything else under "Explicitly Out-of-Scope / Needs a Product Decision" in the report.

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

**Notes on deferrals**:
- **CQ2** (AdminPage two styling conventions) and **CQ10** (DesignStudioPage bundles
  unrelated tools) are large, purely-cosmetic/structural refactors with real risk of
  introducing visual regressions across a 3700-line and 1400-line file respectively,
  with no way for me to verify visually without a live preview. Flagging back per
  instruction 6 rather than guessing — will revisit after live-preview confirmation
  on the smaller PRs first, if still wanted.

## PR list (created as work progresses)

| PR | Branch | Contains | Status |
|----|--------|----------|--------|
| #25 | `docs/audit-report-2026-07-31` | AUDIT_REPORT.md + AUDIT_TASKS.md | open |
| — | `test/otp-rsvp-integration-tests` | C1, QW2 | ready to open |
| — | `fix/admin-session-and-error-handling` | C2, C3, C4, CQ3, CQ4, CQ5, UX2, UX4, UX5 | not started |
| — | `fix/moodboards-canvas-integrity` | C5, C6, B10, B11, CQ6, UX6 | not started |
| — | `fix/design-studio-worker-lifecycle` | B1, B2, B3, CQ9, UX3 | not started |
| — | `fix/gallery-pdf-fallback` | B4 | not started |
| — | `fix/schema-indexes-and-types` | B5, B6, B7, B8, CQ8 | not started |
| — | `refactor/admin-entity-form` | CQ1 | not started |
| — | `fix/small-ui-quick-wins` | B9, CQ11, CQ12 | not started |
| — | `fix/npm-audit-advisories` | QW1 | not started |
