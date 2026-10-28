# Implementation and verification

## Delivered behavior

Academy uses the API's existing domain and lesson order. Each domain has a collapsible lesson list; title search, difficulty and watched filters operate within that domain. There are no invented modules, prerequisites or lesson descriptions. The overview uses existing domain descriptions. First unfinished lesson is suggested; explicit previous/next navigation follows the complete course order independently of filters. Selection remains local to this visit. Opening a lesson never marks it watched. Display progress intersects distinct current lesson IDs with watched IDs, so deleted/duplicate history cannot inflate percentages. XP calculation is unchanged.

Quiz grading and answer keys remain exclusively on the server. The UI explains the existing all-correct badge rule and optional lesson completion; request failures retain answers for retry. Failed graded attempts reset as before. Student sign-in and progress APIs are untouched.

Moodboards identifies workspace, creation destination and collection search/sort scope. Favorites are unique, non-archived shortcuts; searching and Archived show the collection without shortcut rails. Recent remains a shortcut to owned boards. Cards retain real server previews, image fallback, IntersectionObserver gating and original callbacks; their open/favorite/menu controls are sibling native buttons. Installed Radix dropdowns provide collision handling, arrow navigation, Escape and focus restoration. Existing dialog focus hooks remain.

List errors now appear separately from empty collections, with retry. List cache TTL and background refresh stay intact; keys now include student identity. Late list/project responses cannot replace a newer workspace selection. Draft project selection resets on scope changes. Archive/restore also updates the shared-list copy of an owned board.

Canvas changes are limited to accessible save-status labels, explicit compact menu labels and a wrapping failed-save alert with usable controls above tldraw's page controls. The canvas engine and all persistence/retry/share/comment/collaboration/history/template/asset/fullscreen handlers remain unchanged.

## Repeatable checks

```sh
npm test
node scripts/check-academy-moodboards-types.mjs
npm run build
npm run dev -- --host 127.0.0.1 --port 5179
# In another terminal, with Playwright available in a separate tooling install:
node scripts/academy-moodboards-browser.mjs after
```

The browser runner can use `PLAYWRIGHT_MODULE` (absolute path to an installed Playwright module), `CHROMIUM_PATH` and `UX_BASE_URL`. It does not add project dependencies. Baseline screenshots were captured before editing using the same fixture runner's `before` mode. Run that mode against base commit `79cf2ca`, not the updated code, to recreate baseline evidence.

All `/api/**` requests in this runner are intercepted. Fake student state exists only in the disposable browser context. Academy fixtures reproduce a subset of repository seed titles/metadata; board names and project are synthetic QA records. YouTube is replaced with a labeled network-isolated placeholder. None of these fixtures are application content or production data. Screenshots are fixture evidence, not a claim of a live authenticated test.

## Results

- Baseline frontend: 234/234 tests pass. Final: 239/239 tests across 18 files pass.
- Full typecheck on base has 16 existing errors. Exact identities (path, source position, TS code and complete message) remain unchanged. Scoped check passes with zero affected-file diagnostics. See baseline and final logs; no test/diagnostic suppression was added.
- Production build passes. Existing bundle-size warning remains.
- Browser: 48 assertions pass, zero uncaught page errors. Browser results and intercepted requests: `browser-results.json`; page-error logs: `before-browser-errors.json`, `after-browser-errors.json`.
- Browser matrix: Academy, Moodboards and the canvas at 320, 375, 768, 1440 in light and dark. Checked document overflow and captured both page headers and complete lesson-list components. Theme transitions are allowed to settle before screenshots.
- Interaction evidence covers lesson selection, domain change, previous/next, search, difficulty, explicit watched toggle, graded quiz failure, retained answers after request error, pass/badge; board collection tabs/search/sort, keyboard favorite/menu, rename, duplicate, archive/restore, create/Escape and workspace/project payload; actual tldraw shape edit, failed save, Retry, unobscured alert and compact menu discovery. Reduced-motion lesson styling and signed-out learning are checked.

## Limits and review checklist

These checks do not certify production authentication, backend grading correctness, realtime multi-client collaboration, sharing permissions, remote database persistence or real YouTube playback. Backend/auth/access/canvas handlers were traced but are not changed. No local or production database was used. The repository's backend CI provides separate server regression evidence after push; it does not substitute for a live multi-client QA session.

Remaining manual checks: VoiceOver/screen-reader announcement quality, real touch hardware, loading/empty states under live data, live share/history/template/asset/fullscreen dialogs and realtime save recovery. Browser fixture verification of manual REST save retry does not certify the realtime transport. No deployment is requested or performed.

Pre-existing Academy progress write failures are still optimistic and logged by StudentContext; selection is not persisted across refresh. Shared AppDataProvider still loads Academy alongside other public collections, so Retry reloads the page rather than changing its API lifecycle.

## Screenshot guide

- `before-academy-1440.png`, `after-academy-1440.png`: overview before/after.
- `before-moodboards-1440.png`, `after-moodboards-1440.png`: library before/after.
- `after-{academy,moodboards}-{320,375,768,1440}-{light,dark}.png`: responsive matrix.
- `after-lessons-*-*.png`: full lesson list, including filters and wrapped lesson titles.
- `after-canvas-*-*.png`: canvas controls at each requested width in both themes.
- `after-canvas-save-error-375.png`: narrow failed-save recovery on the actual editor.
- `after-board-load-error-375.png`: retryable collection failure.
- `after-academy-signed-out-1440.png`: signed-out learning.

The application scrolls inside its root; full-page screenshots of page headers do not capture every lower section. Dedicated lesson-list captures provide that coverage. Exact file manifest is `changed-files.txt`.
