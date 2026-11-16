# Public Project Showcase (DNA 2.0 — Milestone D)

Case-study style projects that students create, submit for review, and — once an admin approves and publishes them — show publicly with credited contributors. Public routes `/showcase`, `/showcase/:slug`; creator routes `/showcase/manage…`; API `/api/showcase/*`.

## 1. Architecture analysis (audit of `main`; #84, #97, #98, #99 inspected, none depended on)

### 1.1 Facts that shape the design
- **`projects` already exists on main** (V2.2 *workspace* projects: private, workspace-scoped board groupings). The public ecosystem is therefore a **separate model** (`showcase_projects`), as the roadmap's `public_projects` also implies. The two are unrelated and never joined.
- **Gallery (`artworks`)** on main is admin-curated: no owner column, no status, free-text `artist`. Students cannot create artworks on main. (#84 adds `status`, `created_by_roll`, `source_*` and `artwork_credits`.)
- **Identity on main = `student_sessions.roll_number` + student JWT.** There is no public identity: a roll number must never be public. #84 introduces the canonical public identity (`designer_profiles`: handle, display name, visibility; 1:1 with `owner_roll`) and `artwork_credits` / `creator_audit_log`.
- **Storage:** all uploads share one public-by-URL bucket; privacy of Asset Library files is by unguessable key only. Flipping a flag can never make a private file "public-safe". #84's spec (§3.3) fixes the rule: **publishing = copy bytes to a new key**.
- **Admin:** one shared admin principal (`requireAdmin`, JWT `role: admin`); moderation lives in `AdminPage` tabs (`LibraryModerationTab` precedent). No per-admin identity.
- **Moodboards** are private tldraw boards; publishing one would require a render/copy pipeline that does not exist.
- **Inspiration (#99)** is a strictly private library; its items are never public.

### 1.2 Dependency matrix

| Capability | Exists on main | Reuse | Create here | Depends on #84 |
|---|---|---|---|---|
| Student auth / roll identity | `studentAuth`, `student_sessions` | ✔ | – | No |
| Public creator identity (handle, avatar, profile page) | – | – | adapter only (`lib/creatorIdentity.ts`) | **Yes** (`designer_profiles`) |
| Credits / consent model | – | pattern of `artwork_credits` | `showcase_credits` (project-scoped, roll-keyed, consent-gated) | Mirrors it; upgrades to profile links post-merge |
| Artwork credits on gallery items | – | – | `showcase_artworks` join + adapter (`ownsArtwork`) | **Yes** (needs `artwork_credits` to prove ownership) |
| Disciplines | `domains` | ✔ | join table | No |
| Private files | Asset Library, `storage` provider (`download`/`upload`) | ✔ | publish-time copy to `showcase/…` | No |
| Image sanitising | `sharp` dep | ✔ | re-encode on copy (strips EXIF/GPS) | No |
| Moderation UI/auth | `AdminPage` tabs, `requireAdmin` | ✔ | `ShowcaseModerationTab` | Audit mirrors into `creator_audit_log` post-merge |
| Audit trail | – | – | `showcase_events` (project-scoped, append-only) | Can be mirrored to `creator_audit_log` |
| Moodboards | boards, membership | ✔ (private reference) | `showcase_boards` join | No |
| Inspiration references | – (#99) | – | none (stays private) | #99 only |
| Public listing / detail / search | `artworks` list as model | pattern | all new | No |

**Independent of #84 (built now):** projects, states, slugs, works (copied assets), categories/disciplines/tags/links, contributors with consent, moderation, audit, featuring, public pages. **Needs #84 to light up (interface only, documented):** profile links on credits, attaching Gallery artworks the student is credited on, mirroring events to `creator_audit_log`.

## 2. Data model (all additive; `db/showcaseSchema.ts`)

- **`showcase_projects`** `id`, `owner_roll`, `slug` (unique), `title`, `summary`, `description`, `category`, `tags[]`, `links` (validated JSON), `status`, `cover_asset_id`, `featured_at`, `review_note` (latest admin reason), `submitted_at`, `published_at`, `created_at`, `updated_at`.
  `status ∈ draft | submitted | changes_requested | approved | published | rejected | archived`.
- **`showcase_project_disciplines`** `(project_id, domain_id)` → existing `domains`.
- **`showcase_assets`** works in order: `project_id`, `asset_id` (FK `assets`, `ON DELETE SET NULL`), `caption`, `position`, plus **`public_key`** — the published *copy* (null until publish). Public reads use only `public_key`.
- **`showcase_credits`** `project_id`, `roll`, `role_label`, `contribution`, `display_name` (the name the person agreed to show), `position`, `status ∈ accepted | pending | declined`, `is_owner`. Only `accepted` credits are public. Keyed by roll — the same key as `designer_profiles.owner_roll`, so #84 profiles attach by lookup with no migration.
- **`showcase_boards`** `(project_id, board_id)` — private process references (owner/member only); **never public**.
- **`showcase_artworks`** `(project_id, artwork_id, position)` — reserved interface, populated only through the identity adapter.
- **`showcase_events`** append-only: `project_id`, `from_status`, `to_status`, `actor_kind (student|admin|system)`, `actor_roll`, `reason`, `created_at`.

## 3. State machine (server-enforced, `lib/showcaseState.ts`)

| From → To | Who | Notes |
|---|---|---|
| draft → submitted | owner | validation + all contributors responded + ≥1 work |
| submitted → changes_requested / rejected | admin | reason required |
| submitted → approved | admin | |
| submitted → draft | owner | withdraw |
| changes_requested → submitted | owner | resubmit (same checks) |
| changes_requested → draft | owner | withdraw |
| approved → published | admin | **copy-to-public workflow**; re-verifies ownership/consent |
| approved → rejected / changes_requested | admin | reason required |
| published → archived | admin or owner | public copies deleted |
| archived → draft | owner | re-enters review |
| rejected → archived | owner/admin | terminal otherwise |

Students can never approve, publish, feature, or act for another creator. Published projects are read-only for the owner (edit = archive → draft → resubmit), so edits cannot bypass moderation.

## 4. Publish = copy (never a flag flip)

At *publish* (admin only): re-verify each work's source asset still exists, is `active`, is an image owned by the project owner; read bytes via `storage.download`, re-encode with `sharp` (strips EXIF/GPS), upload to a fresh `showcase/<project>/<uuid>.<ext>` key, then commit the status change and `public_key`s in one transaction. Any failure deletes the copies already written and leaves the project `approved`. Archiving deletes the copies. The source asset's visibility and URL are never touched or emitted by any public endpoint.

## 5. Privacy & security rules
- Drafts and every non-published state are 404 on public endpoints. Roll numbers, emails, asset ids, asset URLs and board ids never appear in public responses (explicit field allowlists).
- Submission publishes nothing. Contributor consent is per project; a contributor can decline or leave at any time, which removes their public credit.
- Only the owner's own assets can be attached (ownership verified at attach, submit and publish). SVG/GIF are excluded from works (script/metadata risk); size and count caps apply.
- External links use strict http(s)/public-host validation; the server never fetches a URL.

## 6. Post-merge integration (documented, not assumed)
- **#84:** `lib/creatorIdentity.ts` feature-detects `designer_profiles`; once present, public credits gain `profile: { handle }` links for public, active profiles and the artwork-attach endpoint accepts artworks the caller is credited on. Optionally mirror `showcase_events` to `creator_audit_log`; add a Projects section to profile pages.
- **#97/#98:** no code dependency (tool outputs saved to Assets can already be attached as works).
- **#99:** inspiration stays private; no integration needed beyond an optional "from inspiration" shortcut later.
- **Nav:** a public "Showcase" link in the top navigation is left to the maintainer (that file is intentionally untouched here).
