# DNA 2.0 V1.1 — Creator Ecosystem

Status: **complete against the original brief; ready for review; not merged, not deployed.** Branch `release/dna-2.0-v1.1`, based on `main` at `75fb43d` (the V1 release merge, PR #102).

V1.1 does not add a second app. V1 already shipped most of the ecosystem (profiles, attribution, showcase with moderation, creator discovery, collaboration, tool-to-Asset saving). The audit below separates what was reused from what V1.1 adds. Anything not done is listed under [Known limitations](#known-limitations).

## 1. Audit: what V1 already had

| Area | State on `main` before V1.1 |
|---|---|
| Student auth, workspaces, moodboards, Asset Library, Inspiration, Templates | Complete. Untouched except where noted. |
| Designer profiles (`designer_profiles`) with handle, display name, headline, bio, department, batch opt-in, skills, disciplines, links, avatar, three-level visibility, hidden-by-moderation | Complete, with a `/profile` management page and public `/designers/:handle`. |
| Artwork attribution (`artwork_credits`, consent, withdrawal, audit log) | Complete (V1). Reused as is. |
| Showcase lifecycle: draft → submitted → in review → changes requested → approved → published, plus rejected, withdrawn, archived, feature | Complete, with admin moderation tab and owner-side feedback/resubmission. Server-enforced (`showcaseState`). |
| Creator discovery `/creators` (search, discipline/skill/category filters, sort, pagination, facets), admin featuring (cap 12) | Complete. Public-only predicate on every read. |
| Collaboration on showcase projects (owner/editor/viewer, invitations, activity, comments) | Complete (V1 Milestone F). |
| "Save to Assets" from tools (Background Remover, Halftone, SVG Tools) | Complete for those three. |
| Moodboard export (PNG/JPG/SVG, scope, scale, transparency, large-board scaling) | Complete; no preview. |
| Navigation | Navbar said "Design Studio"; profile lived in the workspace sidebar; sidebar was one flat list. |

## 2. What V1.1 adds or changes

### Navigation and information architecture (Part 3)

- **Creator Studio rename.** All user-facing copy ("Design Studio" → "Creator Studio"): navbar, footer, welcome overlay, join prompt, homepage card, page `<title>`. The route stays `/design-studio`, so bookmarks, sitemap and internal links are unchanged. Route files and code identifiers keep their old names on purpose.
- **Account menu** (`AccountMenu.tsx`): avatar + first name in the top-right, next to the existing notification bell. Entries: My Profile, Edit Profile, Account Settings, Notifications, Invitations, Sign out. Every entry reuses an existing route or action (see [navigation map](#navigation-map)). Accessible menu: `aria-haspopup`/`aria-expanded`, arrow/Home/End navigation, Escape returns focus to the trigger, outside click closes. The small-screen menu has the same destinations.
- **Live avatar/name.** `lib/myProfile.ts` is a small shared store. `ProfilePage` publishes every change to it, so the navbar updates the moment a photo or name is saved, with no reload and no refetch. Fallback order: uploaded image → initials → session name/roll. A failing image URL swaps to initials (no broken-image icon), and a new URL gets a fresh attempt.
- **Sidebar regrouped** into CREATE / DISCOVER / MANAGE. "My profile" moved out of the sidebar. Active state is hash-aware, so two items on `/showcase/manage` never both highlight.
- **Gallery and Showcase remain separate**: Gallery is published artwork, Showcase is complete projects (unchanged routes and pages).

#### Navigation map

| Where | Label | Destination |
|---|---|---|
| Sidebar · Create | Overview | `/home` |
| | Moodboards | `/moodboards` |
| | Asset Library | `/assets` |
| | Templates | `/templates` |
| Sidebar · Discover | Inspiration Library | `/inspiration` |
| | Creator Discovery | `/creators` |
| | Public Showcase | `/showcase` |
| Sidebar · Manage | My Projects | `/projects` (workspace projects) |
| | Showcase submissions | `/showcase/manage` |
| | Collaborations | `/showcase/manage#collaborations` (invitations and projects shared with me) |
| Account menu | My Profile / Edit Profile | `/profile` / `/profile#edit-profile` |
| | Account Settings | existing change-email dialog |
| | Notifications | opens the existing notification panel |
| | Invitations | `/showcase/manage` |

### Profiles (Part 4)

- **Tools** field (new): up to 12, same normalisation and validation as skills. Editable on `/profile`, shown and linked (`/creators?tool=`) on the public profile.
- **Profile completion** card (new, `lib/profileCompletion.ts`): profile image, headline, bio, skills, and at least one credited artwork or published project. Shows what to do next with links, disappears at 100%, and never blocks any action.
- Already present and reused: display name, unique username, avatar, headline, bio, department, batch (opt-in), disciplines (the "creative interests"), portfolio and social links (website, Behance, Dribbble, Instagram, LinkedIn, GitHub, YouTube), private / members / public visibility.

### Creator discovery and featured creators (Parts 7, 8)

- New filters: `tool`, `department`, `featured=1`. Tools are included in text search. New facets: `tools`, `departments`.
- Featured creators now have an **admin-set display order** (0–999, blank sorts last) and an **optional editorial note** (≤ 200 chars) shown on the featured card. Edited in the admin Creators tab.
- Featured creators also appear on the **homepage** (up to four). The strip renders nothing when no one is featured, so there are no placeholder people.
- Unchanged and still enforced in SQL on every read: only `visibility = 'public' AND moderation_status = 'active'` profiles are returned; the note is only ever returned for a creator who is currently featured, public and active.

### Tool outputs to the Asset Library (Part 10)

- **Image Converter** now has the shared Save-to-Assets button (personal workspace, private asset, idempotent retry key, size/type checks, saving/saved/error states). PDF output is download-only, with an on-page explanation, because the library stores images only.
- Background Remover, Halftone and SVG Tools already had it. Palette, Font Pairing, Contrast and Grid produce text/CSS tokens, not files, so they have no asset to save.

### Moodboards (Part 11)

- **Templates.** The create-board dialog uses a new `StarterPicker`: a real radio group (arrow keys, Tab, screen-reader friendly) of cards, each with a preview **drawn from the starter's own shape data** (so it cannot drift from what you get), its use case and image-slot count, and a description of the current choice. Four starters were added to the existing six — UI/UX reference, Motion style frames, Photo series, Poster exploration — for ten layouts. It is the same plain-data starter system and create flow as before: no second template store, saved boards and saved Templates are untouched, and a starter is applied exactly once to a new empty board (browser-verified: reload does not duplicate it).
- **Lightbox.** A full-screen `ImageLightbox` for every image on a board, in reading order, from an **Images** button (desktop header and the phone overflow menu), opening at the selected image. Previous/next by buttons, arrow keys or swipe; Home/End; Escape, the close button or a click outside close it; focus is trapped and returned; the page cannot scroll behind it; loading and error-with-retry states; neighbouring images are preloaded. It always shows the **original** image. Loaded lazily; tldraw helpers stay in the on-demand chunk.
- **Loading performance.** Measured first, on a stress board (60 image shapes over 12 distinct 1600×1200 photos): no duplicate API calls and ~1.2 s to first content, but every image was drawn at about 126 px wide from a full ~1.2 MB original (14.6 MB, 60 large decodes). `GET /api/boards/:id/canvas` now also returns a read-time `image_thumbnails` map (original src → *ready* 512 px derivative, using the same validated lookup the board cards use; `canvas_data` is returned unchanged and nothing is rewritten). The canvas asset store uses a thumbnail only while the pixels needed for the image's short edge (zoom × device-pixel-ratio) are ≤ 512, so it is never softer than the original; zooming in swaps to the original, and exports, copy and the lightbox always use originals. Result: **image traffic at fit-to-screen 14.6 MB → 1.5 MB** (same on a 390 px phone). Verified in a browser that zooming to ~1000 px loads the original, going back returns to thumbnails, and that a 3× export has the detail of the original (neighbour-difference 35.8 vs 37.0 for the original at the same size and 10.1 for an upscaled thumbnail). Best effort: no map entry, no ready derivative or a failed lookup simply means originals. Existing states were audited and kept: skeleton cards, retry on a failed list, empty states, lazy card previews, board connect/retry.
- **Export and preview.** The export dialog shows a live preview of exactly what will be exported (same scope, background and light-theme rendering path as the real export), a checkerboard for transparent output, debounced re-render, stale-render cancellation and object-URL cleanup; formats and files are unchanged. Browser-verified: the preview's aspect ratio matches the downloaded file (2.111 vs 2.107 on a 5806×2755 export of the 60-image board, which the dialog correctly reports as scaled to fit browser limits), a single selected image previews as 4:3 and exports at the matching ratio, PNG/JPG/SVG all export, the SVG embeds the original, and an empty board says "Nothing to preview" with Export disabled.

## 3. Profile visibility and privacy behaviour

| Visibility | Who can see the profile | In directory/featured/homepage |
|---|---|---|
| private (default) | Owner only | No |
| members | Signed-in members (existing rules) | No |
| public | Everyone | Yes, unless hidden by moderation |

- Roll numbers, email addresses, internal ids, storage keys and moderation state are never in a public payload. Public payloads are built by one explicit serializer, and tests pin the exact key set (`tools` was added deliberately to that list).
- Featuring never changes visibility. Making a profile private or hiding it removes it, and its editorial note, from every public response on the next request (`Cache-Control: no-store`).
- Batch year is shown only if the owner opted in.

## 4. Artwork attribution rules (unchanged from V1)

Credits live in `artwork_credits`; one primary creator per artwork; a contributor must accept before they are shown, and can withdraw (primary creators must ask an admin); only the artwork's admin or authorised owner changes attribution; duplicates are prevented by a unique key; legacy free-text artist is shown only when no accepted credit exists; every change is audit-logged. See `backend/tests/gallery-attribution.test.ts` and `showcase-collab-attribution.test.ts`.

## 5. Project submission wizard and moderation workflow

While a project is editable (draft or changes requested) the editor is a **seven-step guided flow**; once submitted, approved or published it shows the existing read-only page, so nothing about frozen states changed. Every step saves through the existing `PATCH`/`PUT` endpoints (so drafts persist on the server and resume at the first incomplete step, or at `?step=N`); no schema or endpoint was added.

| # | Step | What it covers (existing fields) | Blocking rules (mirror the server's `submissionProblems`) |
|---|---|---|---|
| 1 | Basics | title, short summary, category, up to 4 disciplines | title ≥ 3, summary ≥ 10, a category, ≥ 1 discipline |
| 2 | Media | images from your Asset Library, cover, captions, order | ≥ 1 image, exactly one cover, no removed sources |
| 3 | Story | description, with "Brief / Process / Outcome / Tools" prompts | ≥ 30 characters |
| 4 | People | your credited name and role; invite contributors (role, what they did) | owner name; pending contributors warn (the server blocks submission) |
| 5 | Resources | private process moodboards (owner only), public links | links must be public http(s) |
| 6 | Discovery | tags (≤ 10); explains visibility | — |
| 7 | Review | summary of all six sections with Edit buttons, server problems with "Go to step", public-page preview, Submit | server decides |

Behaviour: clear 7-step progress (full stepper on wide screens, "Step n of 7" with a bar on phones); Back never validates and keeps unsaved edits; Continue validates the step then saves; the stepper lets you revisit completed steps but not jump past an incomplete one; refresh/back-forward land on the right step; focus moves to the step heading after you navigate; submission is locked against double clicks and double tabs (browser test: a double-click sent exactly one request; backend test: two simultaneous submits give one submission); a failed submit re-fetches the server's current problems and keeps the wizard. **No fields were invented**: the schema has no separate "tools" or "visibility" field, so tools go in the story or tags, and step 6 states that a project is private until the club approves and publishes it.

Unchanged and re-verified: only the owner can submit (editors see "Only the project owner can submit it"); every credited contributor must accept first (submit returned 400 until they did); other students get 404 on someone else's draft (never the wizard or its data); frozen after submit (409); admin-only moderation with a mandatory reason for changes/rejection; reviewer feedback shown to the owner, who can fix and resubmit; unapproved projects are never public; public payloads carry no roll numbers or emails.

## 6. API changes (all additive)

| Method | Path | Auth | Notes |
|---|---|---|---|
| PUT | `/api/designers/me/tools` | verified student | `{ tools: string[] }`, ≤ 12, normalised, strict body. 404 without a profile. |
| PATCH | `/api/creators/admin/:id/featured` | admin | `{ displayOrder?: 0–999 \| null, editorialNote?: ≤ 200 \| null }`, strict body; 404 if not featured; audit-logged (`profile.feature_edit`). |
| GET | `/api/creators` | public | New query params `tool`, `department`, `featured=1`; cards gain `editorialNote` (featured only). |
| GET | `/api/creators/facets` | public | Adds `tools`, `departments`. |
| GET | `/api/creators/featured` | public | Ordered by `display_order`, then `featured_at`. |
| GET | `/api/creators/admin/list` | admin | Adds `displayOrder`, `editorialNote`. |
| GET | `/api/designers/:handle`, `/me`, `/me/preview` | as before | Adds `tools`. |
| GET | `/api/boards/:id/canvas` | as before | Adds read-time `image_thumbnails` (`{ [original src]: ready t512 URL }`); `canvas_data` unchanged; best effort. |

No endpoint was removed or renamed; no response field was removed.

## 7. Database migration notes

All additive and idempotent, applied by `initSchema()` at backend boot. No table is dropped, truncated or rewritten, and no data is seeded.

```sql
ALTER TABLE designer_profiles ADD COLUMN IF NOT EXISTS tools TEXT[] NOT NULL DEFAULT '{}';
-- + CHECK designer_profiles_tools_max (cardinality(tools) <= 12), added only if missing
ALTER TABLE creator_features ADD COLUMN IF NOT EXISTS display_order INTEGER;
ALTER TABLE creator_features ADD COLUMN IF NOT EXISTS editorial_note TEXT;
-- + CHECKs creator_features_order_range (0..999), creator_features_note_len (<= 200), added only if missing
```

The completion pass (wizard, templates, lightbox, thumbnails) made **no further schema change**. No new tables, so no new RLS policy was needed (`designer_profiles` and `creator_features` are already covered by the V1 RLS migration; `rls.test.ts` passes). Verified by booting the backend against an empty scratch database, then again against the migrated one.

## 8. Deployment notes

1. Deploy the **backend first** (Render auto-deploys `main`; migrations run on boot), then the frontend (Vercel).
2. Old frontend + new backend: fine (new fields are extra).
3. New frontend + old backend (the short window between deploys): `tools` is optional in the types and the profile page tolerates its absence; saving tools returns an error toast until the backend is live; discovery filters are ignored by the old backend; the featured editor's PATCH would 404. Nothing crashes.
4. Rollback: the new columns are harmless to V1 code; no data migration to undo.
5. No new environment variables or secrets.

## 9. Testing report

All figures are from the final tree (`release/dna-2.0-v1.1`), run after the last code change.

| Check | Result |
|---|---|
| Frontend tests (`pnpm vitest run`) | **826 / 826** passing, 69 files |
| Frontend typecheck (`tsc --noEmit`) | clean |
| Backend tests (`npx vitest run`, local `dna_club_test`) | **1107 / 1108** passing, 71 files (1 baseline failure, below) |
| Backend typecheck (`tsc --noEmit`) | clean |
| Production build (`vite build`) | succeeds (the pre-existing >500 kB chunk warning remains; no bundle-size comparison against `main` was made) |
| Route-collision guard (`scripts/check-route-collisions.mjs`, on the final build) | 18 routes, 9 root entries, no collisions (V1.1 adds no routes) |
| Browser: V1.1 journey (isolated backend + brand-new scratch DB) | **77 / 77** |
| Browser: seven-step wizard through the real UI (brand-new scratch DB) | **41 / 41** |
| Browser: templates, starter application, lightbox, mobile (60-image stress board) | **27 / 27** |
| Browser: export preview vs real exports (large, empty, selection; PNG/JPG/SVG) | **10 / 10** |
| Browser: zoom swaps thumbnail → original → thumbnail | verified (126 px: `t512.webp`; 1037 px: original `.jpg`) |
| 390 px: no horizontal scroll | verified on 9 pages (journey) + wizard steps 1/2/4/7 + template picker |

Honest notes on the browser runs: they were developed iteratively. Earlier runs surfaced real defects that are fixed in this branch and covered by tests — the board **Images** button was missing from the phone overflow menu; the wizard moved focus on initial load and duplicated a heading; review-step buttons lacked the `touch-target` hit area; the picker advertised "0 image slots". Other early failures were mistakes in my scripts (wrong selectors, a guessed shape count, a bad crop for an image-detail metric, a fixture in the wrong snapshot format for realtime boards) and were corrected in the scripts, not worked around in the app. The scripts in `verification/v1.1/` are the final versions; they reference scratch paths on the author's machine and are evidence, not CI.

### Baseline failure (verified, not hidden)

`creator-privacy.test.ts › ships no real student identities in the seed data` fails with `expected 45 to be +0`. It fails **identically at the V1 production merge `75fb43d`** (checked out in a separate throwaway worktree and run there). Cause: the local `dna_club_test` database holds 45 rows in the `all_team` audience group, all with `added_at = 2026-09-24T05:40:49Z`, left by an earlier version of the seed that has since been removed; no current code inserts into `all_team`. A database freshly migrated by the current code (the QA scratch databases) has **0** `all_team` rows, so the test passes on clean data — consistent with the V1 runbook, which recorded this suite passing 5/5 on a fresh PostgreSQL. The test was not skipped or edited. Clearing those stale rows in the local test DB would make it pass; that is left to the owner.

**Separate observation (unchanged, pre-existing on `main`):** `backend/src/db/schema.ts` seeds six coordinators (real-looking names and roll numbers) into the `coordinators` group on startup. That is outside this release and was not changed, but it is worth a decision on whether those belong in source.

### New tests in this pass

Frontend: `showcaseWizard` logic (12), editor wizard component (19) with the role/permission tests re-pointed at the right steps, `StarterPicker` (4), starter catalogue and preview geometry (4), `lightbox` helpers (8), `ImageLightbox` (7), `canvasThumbs` (6), board-header regression tests (2). Backend: `showcase-submission-wizard` (11: draft persistence across partial saves, owner-only access incl. 401 for anonymous and admin tokens, server-side validation, single submission under concurrent requests, contributor consent, frozen states, moderation loop, public/private boundaries) and `canvas-image-thumbnails` (9: only *ready* derivatives mapped, `canvas_data` byte-for-byte unchanged, foreign/spoofed URLs not trusted, access rules unchanged, graceful degradation, bounded collector). Earlier in V1.1: see the creator/profile/discovery tests listed in the PR.

Journey coverage (all against isolated data): sign-in, avatar upload with navbar update and no reload, rename, tools, completion, Edit Profile deep link, project creation, contributor invite → blocked submit → consent → submit, admin request-changes with feedback, resubmit, approve, publish, featured order and note, Showcase, project page, Creators page and filters, public profile, homepage strip, private-profile 404, sidebar groups, direct load of nine workspace routes, export preview, plus the wizard, template, lightbox and performance checks above.

## Known limitations

Stated plainly; none were silently skipped.

1. **No "Messages" entry** in the account menu: DNA has no direct-messaging feature, so a link would lead nowhere. "Invitations" (the real inbox for project and credit invitations) takes its place.
2. **Sidebar has one entry beyond the brief** ("Showcase submissions"), because "My Projects" (`/projects`, workspace projects) and the showcase manager (`/showcase/manage`) are different, existing routes that must both stay reachable.
3. **Wizard fields come from the existing schema.** There are no separate fields for objectives/process, tools or per-project visibility; the story step offers prompts inside the single description, tools go in the story or tags, and visibility is explained rather than editable. Adding real fields would need an additive schema change and was not done speculatively.
4. **Canvas thumbnails apply to solo-canvas boards.** Realtime-synced boards use a different asset path and still load originals (unchanged behaviour). Images uploaded after a page load, external images and images without a *ready* derivative also use originals until the next load.
5. **Lightbox is for board images** (images placed on a canvas). It does not enumerate the Asset Library or Inspiration views, which already have their own preview modal.
6. **"Creative interests" are the existing disciplines**; there is no separate free-text interests field. Social links are the existing link kinds (up to 6).
7. **Image Converter PDFs cannot be saved to the Asset Library** (images only). Palette Studio is intentionally untouched (standing read-only rule).
8. **Account Settings** is the existing change-email dialog; there is no broader settings page.
9. **Browser coverage** is headless Chromium on macOS only (no Safari/Firefox/real devices); 390 px is viewport emulation (touch emulation for the lightbox).
10. The first V1.1 journey drove some steps through the API (workspace/asset/project setup, admin transitions) where the UI was unchanged V1 code; the wizard, template, lightbox, preview and export checks were driven through the UI.
11. Running journeys quickly can trip the dev API's request limiter ("Too many requests" console messages); that is the existing limiter.
12. No production verification: nothing was deployed or run against production data.

## Evidence

`docs/dna-2.0/verification/v1.1/` — desktop and 390px screenshots (account menu, sidebar, drawer, creators, public profile, homepage strip, export preview, wizard steps and review, template picker and applied starter, lightbox desktop/mobile), the journey scripts (`browser-journey`, `wizard`, `moodboard`, `exportcheck`, `zoom`, `perf3`, `seedboard`) and their results JSON.
