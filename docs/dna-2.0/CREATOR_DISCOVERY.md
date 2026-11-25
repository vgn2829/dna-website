# Creator Discovery (DNA 2.0 — Milestone E)

A public creative-community directory: find creators by discipline, skill or name, open their public profile, see their published projects and credited artwork. Public routes `/creators` and `/designers/:handle`; API `/api/creators/*`.

## 1. Architecture report

### 1.1 Verified status (at time of writing)
| PR | State | Head |
|---|---|---|
| #84 creator identity | open, unmerged | `d36b468` |
| #97 tool outputs → assets | open | `32be61e` |
| #98 moodboards | open | `e71408d` |
| #99 inspiration | open | `6bfceb2` |
| #100 public showcase | open | `509d0f3` |

This branch is based on `origin/main` and depends on none of them at the code level.

### 1.2 What exists
- **Identity:** `student_sessions` + student JWT (`studentAuth`). No public identity on main.
- **PR #84 (backend only — it contains no frontend files):** `designer_profiles` (handle, display_name, headline, bio, skills[], avatar/cover keys, `visibility private|members|public`, `moderation_status active|hidden`, `verified_at`), `designer_profile_disciplines` (→ `domains`), `designer_profile_links`, `artwork_credits` (accepted/pending/declined), `creator_audit_log`; routes `GET /api/designers/:handle` and `/:handle/works` (explicit serializer, 404 on private/hidden, `no-store`), owner routes, and admin hide/verify. `lib/credits.ts` makes `GET /artworks` return accepted, linkable `credits[]`. Handle rules/reserved words in `designerValidation.ts`.
- **PR #100:** `showcase_projects/credits/assets`, public APIs (published only), consent model, `creatorIdentity.ts` adapter; its credit chips already link to `/designers/<handle>` for public profiles.
- **Main:** `domains` (disciplines), Gallery, admin tab pattern, per-endpoint rate-limit/pagination patterns (limit ≤48, offset caps, `no-store`).

### 1.3 What is missing (this milestone)
1. A **public directory** query (no PR provides one; #84 only serves a single known handle).
2. **Search/filter/sort** over public profiles.
3. **Featured creators** (admin-controlled, audited, capped).
4. **"Projects by this creator"** (needs #84 profiles ⨝ #100 credits).
5. **All frontend**: directory page, profile page (`/designers/:handle` — #100 already links to it), admin featuring UI, Gallery credit links.

### 1.4 Dependency matrix
| Capability | Needs #84 | Needs #100 | Independent |
|---|---|---|---|
| Directory, search, discipline/skill filters, profile page, artwork list | ✔ (profiles, credits) | | |
| Category filter, "published projects" on cards/profile | ✔ | ✔ | |
| Featured creators | ✔ (profiles + `creator_audit_log`) | | table itself |
| Gallery credit links | ✔ (`credits[]` on artworks) | | |
| Capability detection, state machine for UI degradation, routes, components, tests | | | ✔ |

All server features are **feature-detected** (`lib/creatorDirectory.ts`): before #84 merges the directory is empty and says so; before #100 merges project sections are simply absent. Nothing is faked.

### 1.5 Reuse vs build
- **Reused as-is (not duplicated):** `GET /api/designers/:handle` and `/works` for the profile body and artwork; #84's visibility matrix semantics (directory shows **only** `public` + `active`); `domains`; `creator_audit_log` for featuring audit; `studentAuth`/`requireAdmin`.
- **New:** `routes/creators.ts` (directory, facets, featured, projects-by-creator, admin featuring), `creator_features` table, `lib/creatorDirectory.ts`, frontend pages/components.
- **Not created:** no profile, identity, credits or project tables.

### 1.6 Risks and compatibility
- **Table ordering:** `creator_features` has no FK so it can be created on main today and works whenever profiles appear.
- **Route name:** a new router at `/api/creators` avoids editing #84's `designers.ts` (no merge conflict, no shared `/:handle` ambiguity).
- **Schema drift:** tests use snapshot fixtures of #84 and #100 DDL; swap for the real `initDesignerSchema`/`initShowcaseSchema` after merge.
- **Verified mark:** read-only here; it is set by #84's admin route.

## 2. Plan / decisions
- Directory shows **only `visibility='public' AND moderation_status='active'`**; `members` profiles are not in the public directory. Visibility/moderation are checked in the SQL of every read, so a change takes effect immediately (`Cache-Control: no-store`).
- Explicit allowlisted serializers; internal ids and rolls are used only inside queries.
- Search covers only public fields: handle, display name, headline, skills, discipline titles. A private profile can't match because it is filtered first; roll numbers/emails are never searched.
- Sorting: **featured first (default), name, newest member**. No popularity or activity metrics.
- Featured: separate `creator_features(profile_id, featured_at)`; max 12; only public+active profiles may be featured, and a featured row never makes a non-public profile visible. Admin-only; audited to `creator_audit_log` in the same transaction.
- Anti-enumeration: per-IP limiter, `limit ≤ 36`, `offset ≤ 600`, no id-based lookups, identical empty result for private vs non-existent.
- Contributor consent: project credits come only from `status='accepted'` rows, and only for public+active profiles.

## 3. Post-merge integration (documented, not assumed)
- **#84:** call `initCreatorDiscoverySchema` after `initDesignerSchema` (only `creator_features` is created, independent of order). Replace the DDL fixtures in `tests/fixtures`.
- **#100:** add "More by this creator" to `ShowcaseProjectPage` using `GET /api/creators/:handle/projects` and `<CreatorProjectsGrid>`; its credit chips already target `/designers/:handle`.
- **Navigation:** a public "Creators" top-nav link is left to the maintainer (Footer link and sitemap entry added here).

## 4. Verified integration (scratch merge, not committed)
This branch was merged locally with PR #84 (`d36b468`) and PR #100 (`509d0f3`) in a throwaway worktree:
- **Textual conflicts only** in adjacent-added lines of `app.ts`, `schema.ts`, `routes.tsx`, `AdminPage.tsx`, `api.ts` (keep both). Both typechecks pass.
- Real #84 + #100 + this milestone: backend suites for designers, showcase and creators pass except two known items — #84's `creator-privacy` "no real student identities in seed data" (fails on #84's own branch against the shared test DB) and #100's `showcase.test` artwork-adapter test, which assumes #84's tables are **absent** and must be adjusted when #84 lands.
- Browser journey (directory → profile → project → contributor → back, Gallery credit links, admin featuring, visibility changes) passed against that combined stack.
