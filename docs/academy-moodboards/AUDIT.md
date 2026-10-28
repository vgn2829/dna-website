# Academy and Moodboards UX audit

Base: `79cf2ca` (origin/main, 29 October 2026). PR #82 is open and changes Design Studio, package/config and its tests; none of this work depends on it. Work is isolated in `/private/tmp/dna-academy-moodboards-ux-20261029`; original edits, untracked files, stash, other worktrees and databases are untouched.

## Code-confirmed findings (base line numbers)

| Evidence | User impact | Proposed change / preservation |
| --- | --- | --- |
| AcademyPage.tsx:214–217 | Global progress counts stale and duplicate watched IDs against current lessons; can exceed 100%. | Intersect unique current IDs with watched IDs for display; preserve XP formula in StudentContext.tsx:148–150. |
| AcademyPage.tsx:150–155, 213, 246, 359–401 | Domain switch starts at first lesson; no deliberate next/previous or unfinished discovery. | Use server order, recommend first unfinished, show selected position and completion; filter title/difficulty/status without changing navigation order. |
| AppDataContext.tsx:85–92; backend/src/routes/domains.ts:15–33 | Metadata has sequence, duration, difficulty, title, but no modules or prerequisites. | A collapsible ordered lesson list per domain, with filters. No invented curriculum or content. API already orders sequence then creation time; retain that array order including ties. Seed content is evidence only, not proof of live content. |
| AcademyPage.tsx:199–206 | Load error has no recovery action. | Explicit page reload; retain shared provider/API contract. |
| AcademyPage.tsx:48–78, 91; backend/src/routes/domains.ts:54–66 | Quiz failure resets all answers; badge text calls a domain a module. | Preserve responses on request errors, announce results, explain all answers must be correct, no watched prerequisite. Retain server grading, retry-after-fail, quiz identifiers and 20 XP award. |
| MoodboardsPage.tsx:165–253 | List errors silently become empty lists; in-flight workspace results can replace a newer selection. | Visible per-list errors and retry, cancel stale effect results; preserve endpoints, workspace arguments and cache TTL. |
| MoodboardsPage.tsx:451–460, 588–635 | Favorites concatenate owned/shared lists and duplicate IDs; shortcuts precede collection without explaining scope. | Unique favorite IDs; label shortcuts and collection scope; suppress shortcuts while searching/archived/loading/error. Preserve complete collection and recent behavior. |
| BoardCard.tsx:84–89, 147–210 | Button-like parent contains native action buttons; child Enter/Space bubbles to open board. | Sibling native open/favorite/menu buttons; preserve onClick callback, ownership, preview and IntersectionObserver. |
| MoodboardsPage.tsx:306–312, 791–856 | Menu can overflow right viewport and lacks focus/arrow navigation. | Reuse installed Radix dropdown primitive, preserve all handlers. |
| BoardPage.tsx:632–640, 833–864 | Compact save status is symbols only; failed-save controls have small targets and no announced error. | Accessible status labels and wrapping alert with usable retry/dismiss targets; preserve persistence, retry and dismissal callbacks. |

Paths above are under `src/app/` unless otherwise specified. Existing create/rename/delete dialogs already use useModalA11y; canvas overflow already uses Radix. ProjectDetailPage shares BoardCard: semantic correction applies there without changing project behavior. Existing tldraw tools, collaboration, comments, assets, templates, sharing, fullscreen and version history remain intact.

## Priorities

P1: accurate progress, visible fetch/save failures, independent card controls and workspace-response guards. P2: next-lesson guidance, metadata filters, collection hierarchy and responsive polish. All are bounded frontend changes; no dependency on PR #82 or backend schema work.

## Decisions and risks

- Selection stays local during the Academy visit; no existing Academy selection persistence abstraction exists. Explicit domain changes reset filters and select first unfinished lesson. No watched state changes on opening a lesson.
- Progress writes are optimistic and only log API failure in StudentContext.tsx:114–135. This pre-existing limitation is documented, not changed in this UX scope.
- Shared list cache keys lack student identity on base. Qualify page caches by roll to prevent reuse across sign-in changes; this is client cache hygiene, not a permission/API change.
- Avoid modifying shared global styles: scoped CSS uses current variables and existing classes. Respect reduced motion in affected page animations.
- Backend/database/auth changes are excluded. Live data and authenticated integration workflows require browser verification; fixture browser evidence must be labeled.

## Acceptance plan before edits

Run existing frontend suite and capture baseline TypeScript diagnostics. Browser capture before/after with explicit API fixtures (no production writes), both themes and 320/375/768/1440 widths. Test domain switching, selected/watch state, unique progress, boundary navigation, search/filter empty state, quiz failed/errored/passed submissions; boards tabs/search/sort, favorite, keyboard menu, dialogs, CRUD requests, workspace/project arguments. Check responsive canvas save recovery where feasible. Compare full TypeScript diagnostic identities; production build and frontend suite. Report production backend/collaboration checks separately from fixture tests.

## Browser findings after implementation

The initial code audit established missing semantics and states; visual contrast, overflow and actual focus behavior were hypotheses until browser QA. The fixture matrix now verifies both themes at the requested widths, keyboard favorite/menu operation and dialog Escape. A real tldraw shape edit revealed its page controls overlapping the narrow save alert (BoardPage.tsx base:834–840). The final alert has a local higher stacking level; a hit-test assertion and `screenshots/after-canvas-save-error-375.png` verify its text is unobscured. This changes only the alert, not the canvas engine or its layers. See VERIFICATION.md for explicitly unverified live/backend/accessibility checks.
