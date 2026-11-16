# DNA 2.0 V1.1 — Creator Ecosystem

Status: **ready for review, not merged, not deployed.** Branch `release/dna-2.0-v1.1`, based on `main` at `75fb43d` (the V1 release merge, PR #102).

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

### Moodboard export (Part 11)

- The export dialog shows a **live preview** of exactly what will be exported (same scope, background and light-theme rendering path as the real export), a checkerboard for transparent output, debounced re-render, stale-render cancellation and object-URL cleanup. Nothing is uploaded; the preview is a local blob. Export formats and files are unchanged.

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

## 5. Project submission and moderation workflow

Draft → Submitted → In review → (Changes requested → Resubmitted) → Approved → Published, with Rejected (reason), Withdrawn (back to draft) and Archived. Server-side rules: unapproved projects are never public; submission requires complete required fields and **accepted consent from every credited contributor** (verified in the browser journey: submit returned HTTP 400 until the contributor accepted); moderator feedback is shown to the owner; admin transitions require the admin token (a student token, even the owner's, gets 401). The editor saves drafts and shows status and feedback. It is a single editor page, not a stepped wizard (see limitations).

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

No new tables, so no new RLS policy was needed (`designer_profiles` and `creator_features` are already covered by the V1 RLS migration; `rls.test.ts` passes). Verified by booting the backend against an empty scratch database, then again against the migrated one.

## 8. Deployment notes

1. Deploy the **backend first** (Render auto-deploys `main`; migrations run on boot), then the frontend (Vercel).
2. Old frontend + new backend: fine (new fields are extra).
3. New frontend + old backend (the short window between deploys): `tools` is optional in the types and the profile page tolerates its absence; saving tools returns an error toast until the backend is live; discovery filters are ignored by the old backend; the featured editor's PATCH would 404. Nothing crashes.
4. Rollback: the new columns are harmless to V1 code; no data migration to undo.
5. No new environment variables or secrets.

## 9. Testing report

| Suite | Result |
|---|---|
| Frontend (`pnpm vitest run`) | **754 / 754** passing, 63 files. `tsc --noEmit` clean. |
| Backend, full (`npx vitest run`, local `dna_club_test`) | **1087 / 1088** passing, 69 files. `tsc --noEmit` clean. |
| Browser journey (headless Chromium, isolated backend :4100 on scratch DB `dna_v11_qa`) | 76 / 77 scripted checks passed on the first run. The one failure (mobile hamburger) was a wrong selector in the script, not the app; re-run with the right selector, all expected menu entries were present (see `verification/v1.1/browser-journey.mjs`, results JSON, screenshots). |

New tests in V1.1: `AccountMenu` (10), `Sidebar` (5), `profileCompletion` (5), `ProfilePage` completion/tools (4), `CreatorFeaturingTab` (3), `FeaturedCreators` (3), `previewScale` (2), `image-converter` outputs (1), and backend `v11-creator-ecosystem` (17: tools auth/validation/ownership/privacy; discovery filters incl. SQL-injection-as-data and private-profile exclusion; featured order/note admin-only, strict validation, audit trail, no orphaned note after unfeaturing, note hidden when profile goes private).

**Pre-existing failure, not caused by V1.1:** `creator-privacy.test.ts › ships no real student identities in the seed data` fails identically on the untouched base commit `75fb43d`. It counts members of the `all_team` audience group in the local `dna_club_test` database (45 rows there). That is local test-database state, not repository seed data. Left as is; reset that database to clear it.

Journey coverage (all against isolated data): student sign-in, avatar upload with navbar update and no reload, rename, tools, completion, Edit Profile deep link, project creation with cover, contributor invite → blocked submit → consent → submit, admin request-changes with feedback, owner sees feedback, resubmit, approve, publish, featured order and note, Showcase listing, project page (roles shown, no roll/email), Creators page, tool filter and empty state, public profile (tools, project, no roll/email), homepage strip, private profile 404 and absence from the directory, sidebar groups and hash-aware active state, direct load of nine workspace routes, export preview (blob URL, real pixels, survives toggling transparency), and **no horizontal scroll at 390px on nine pages**.

## Known limitations

Stated plainly; none of these were silently skipped.

1. **No "Messages" entry** in the account menu. DNA has no direct-messaging feature, so a link would lead nowhere. "Invitations" (the real inbox for project and credit invitations) takes its place. Adding messaging is a separate product decision.
2. **Sidebar has one entry beyond the brief** ("Showcase submissions"), because "My Projects" (`/projects`, workspace projects) and the showcase manager (`/showcase/manage`) are different, both existing, and both must stay reachable.
3. **Submission is an editor, not a 7-step wizard.** Draft save/resume, validation, status, moderator feedback, resubmission, duplicate prevention and consent enforcement all exist and are tested; the stepped UI from the brief was not built.
4. **Moodboard improvements are limited to the export preview.** Better templates, organisation, lightbox, loading performance and further responsive work were not done in this release. (V1 already ships starters and export scaling.)
5. **"Creative interests" are the existing disciplines**; there is no separate free-text interests field. Social links are the existing link kinds (up to 6), not a separate system.
6. **Image Converter PDFs cannot be saved to the Asset Library** (images only). Palette Studio is intentionally untouched (standing read-only rule).
7. **Account Settings** is the existing change-email dialog; there is no broader settings page.
8. **Browser coverage** is headless Chromium on macOS only (no Safari/Firefox/real devices); mobile checks are 390px viewport emulation.
9. The browser journey drove some steps through the API (workspace/asset/project setup, admin transitions, visibility) where the UI was unchanged V1 code; the V1.1 UI itself (menu, avatar sync, tools, completion, filters, featured display, export preview, sidebar, drawer) was driven through the browser.
10. Running the full journey quickly can trip the dev API's request limiter ("Too many requests" console messages in the journey log); that is the existing limiter, not a V1.1 change.
11. No production verification: nothing was deployed or run against production data.

## Evidence

`docs/dna-2.0/verification/v1.1/` — desktop and 390px screenshots (account menu, sidebar, drawer, creators, public profile, homepage strip, export preview, mobile menu/profile), the journey script and its results JSON.
