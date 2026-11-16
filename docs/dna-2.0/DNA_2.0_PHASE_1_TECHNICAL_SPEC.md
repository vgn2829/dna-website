# DNA 2.0 — Phase 1 Technical Specification
## Designer Profiles + Artwork Attribution

| | |
|---|---|
| **Status** | Proposed — specification only. Nothing here is implemented. |
| **Baseline** | `origin/main` @ `4fac55e` |
| **Depends on** | [Architecture audit](DNA_2.0_ARCHITECTURE_AUDIT.md) (finding IDs `SEC-nn` refer to it) |
| **Next** | [Implementation plan](DNA_2.0_IMPLEMENTATION_PLAN.md) |

---

## 1. Goals and non-goals

**Goals.** A student can create a public creative identity; publish selected work; be credited (with consent) on work they contributed to; and an admin can moderate it — all on the existing student/auth/storage/admin systems.

**Non-goals (Phase 1).** Project showcase, creator discovery/directory, follow/like-a-creator, achievements, collaboration invites beyond artwork credits, workspace↔profile deep integration, PDF/video publication by students, individual admin accounts, per-profile server-rendered social previews.

**Design principles**

1. **One identity.** `student_sessions.roll_number` is the only identity key. A profile *extends* it; it never copies name/email/roll.
2. **Private by default; publishing is an explicit act** that creates a *new public object*; it never reclassifies a private one.
3. **Profile visibility and artwork visibility are independent** (§9.3).
4. **Extend, don't fork.** Public work lives in the existing `artworks` table, with its likes, comments, featuring and admin UI.
5. **Reuse the repo's patterns:** zod, `{error}`, `initXSchema`, `status`-based moderation, `requireStudent`/`requireAdmin`.

---

## 2. Product requirements

| # | Requirement | Spec § |
|---|---|---|
| R1 | Unique public username and URL | 4.1, 8.1 |
| R2 | Display name, avatar, optional cover, short bio | 4.1, 5.3 |
| R3 | Department & batch where appropriate | 4.2 |
| R4 | Creative disciplines, skills/interests | 4.1 |
| R5 | External portfolio/social links | 4.1, 7.4 |
| R6 | Published artwork on the profile | 4.4, 8 |
| R7 | Profile visibility controls | 9.1 |
| R8 | Cannot impersonate or alter verified identity | 4.2, 9.2 |
| R9 | Primary creator + multiple contributors, roles, order | 4.5 |
| R10 | Individual / collaborative / team / tool-created distinction | 4.4, 4.5 |
| R11 | Legacy artwork can be attributed | 6.3 |
| R12 | Uploading never auto-publishes | 6.1 |
| R13 | Attribution on artwork detail; artwork on profiles | 8.2 |
| R14 | Admin moderation, reporting, disputes, verification | 10 |
| R15 | Privacy: no private content or private fields on public endpoints | 9 |

---

## 3. Architecture decisions

### 3.1 Disposition of PR #84 (decision required from the maintainer)

PR #84 is open, unmerged, `CONFLICTING`, and based on an older commit. It overlaps this spec. **Recommendation: salvage, don't merge as-is.**

| PR #84 element | Decision | Why |
|---|---|---|
| `requireVerifiedStudent` + `identityVerified` claim + change-email guard | **Adopt verbatim** (re-apply on current `main`) | Closes a real account-takeover path (bypass session → change mailbox → OTP login). Independent of profiles; ship first (T1). |
| `designer_profiles` table (id, owner_roll UNIQUE FK RESTRICT, handle CHECK, display_name, bio) | **Adopt and extend** (§4.1) | Correct anchor and constraints. |
| `GET/POST/PATCH /designers/me`, `GET /designers/:handle` | **Adopt and extend** | Same routes; add visibility, media, lists. |
| `artworks.creator_designer_id` single FK | **Do not adopt** | Cannot express contributors/roles/order; two sources of truth if kept beside credits. |
| `artwork_attribution_audit` (actor fixed `'admin'`) | **Replace** with `creator_audit_log` (§4.8) | Covers profiles, credits, reports; actor extensible. |
| 16-diagnostic frontend baseline shift in `AppDataContext.tsx` | **Avoid** | New types live in new files (§11). |

Nothing from #84 reached `main`, so no data migration is needed. If the maintainer prefers, T1–T3 can be done as a rebase of #84 plus follow-up commits; the resulting schema is the same.

### 3.2 Where public work lives

| Option | Verdict |
|---|---|
| **A. Extend `artworks`** with status/source/creator columns; student works are `artworks` rows with `status='draft'→'published'` | **Chosen.** Reuses likes, comments, featuring, thumbnails, `SaveToMoodboard`, admin UI. No parallel table. |
| B. New `works`/`portfolio_items` table | Rejected: duplicates the Gallery; two public-work concepts. |
| C. Publish by flipping `assets.visibility='public'` | Rejected: bucket is public-by-URL; the private key would be permanently exposable (audit §5.3, SEC-10). |

### 3.3 Publish = copy

Publishing a workspace asset **copies the bytes** to a new `gallery/<uuid>.<ext>` key and creates an `artworks` row pointing at the copy. The source asset is untouched and stays private; its URL is never emitted by any public endpoint. Unpublishing deletes the copy and the row (or hides it — §6.2). Cost: duplicate bytes, bounded by the Phase 1 image cap (25 MB) and a per-student publish limit (§6.1). The `StorageProvider` has no `copy`; Phase 1 uses `download` + `uploadFile` (works with both providers), with an optional native `copy` as a later optimisation.

### 3.4 Credits, not owner columns

`artwork_credits` joins `artworks` to `designer_profiles` with role, order, and a consent state. "Individual / collaborative / team" is **derived** (1 accepted credit / >1 / a future `project_id`), not stored, so it can never disagree with the credits.

### 3.5 Disciplines reuse `domains`

Creative disciplines are rows of the existing admin-managed `domains` table (the Academy tracks — `schema.ts:33`), also the vocabulary of `artworks.domain`. No second taxonomy. Free-form skills are separate tags.

---

## 4. Data model

**Legend:** 🟦 existing (unchanged) · 🟨 existing, **modified** · 🟩 **new**. All new DDL ships in a single transactional module `backend/src/db/designerSchema.ts` called from `initSchema()` (same pattern as `assetSharingSchema.ts`), idempotent (`IF NOT EXISTS`), after the `dbTarget` guard.

### 4.0 Entity-relationship diagram

```mermaid
erDiagram
  student_sessions ||--o| designer_profiles : "owns (owner_roll)"
  designer_profiles ||--o{ designer_profile_links : has
  designer_profiles ||--o{ designer_profile_disciplines : has
  domains ||--o{ designer_profile_disciplines : "taxonomy"
  designer_profiles ||--o{ artwork_credits : "is credited"
  artworks ||--o{ artwork_credits : "has credits"
  artworks }o--o| assets : "source_asset_id (nullable, SET NULL)"
  designer_profiles ||--o{ attribution_requests : requests
  artworks ||--o{ attribution_requests : about
  artworks ||--o{ artwork_likes : has
  artworks ||--o{ artwork_comments : has
  student_sessions ||--o{ content_reports : "reporter_roll (no FK)"
  creator_audit_log }o..o{ designer_profiles : "entity ref (no FK)"
  creator_audit_log }o..o{ artworks : "entity ref (no FK)"

  student_sessions {
    text roll_number PK
    text name
    text email
  }
  designer_profiles {
    text id PK
    text owner_roll UK_FK
    text handle UK
    text display_name
    text visibility
    text moderation_status
    timestamptz verified_at
  }
  artworks {
    text id PK
    text status
    text source_kind
    text source_asset_id
    text created_by_roll
  }
  artwork_credits {
    text id PK
    text artwork_id FK
    text profile_id FK
    text role
    text status
    int position
    bool is_primary
  }
```

### 4.1 🟩 `designer_profiles`

*Purpose:* the public creative identity of one student.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `TEXT` PK | UUID string (matches repo's TEXT ids; PR #84 uses the same) |
| `owner_roll` | `TEXT NOT NULL UNIQUE` | `REFERENCES student_sessions(roll_number) ON DELETE RESTRICT` — **the only real FK to the identity table** |
| `handle` | `TEXT NOT NULL UNIQUE` | `CHECK (length BETWEEN 3 AND 30 AND handle ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$')`; reserved list enforced in code (§7.1) |
| `handle_changed_at` | `TIMESTAMPTZ` | rate-limits renames |
| `display_name` | `TEXT NOT NULL` | `CHECK (length(btrim(display_name)) BETWEEN 1 AND 100)`; **self-declared** |
| `headline` | `TEXT` | `CHECK (≤ 80)` e.g. "UI/UX · Motion" |
| `bio` | `TEXT` | `CHECK (≤ 500)`; plain text only |
| `department` | `TEXT` | `CHECK (≤ 60)`; **self-declared**, labelled as such |
| `show_batch` | `BOOLEAN NOT NULL DEFAULT false` | batch is derived from the roll prefix at read time (`deriveBatch`), never stored |
| `skills` | `TEXT[] NOT NULL DEFAULT '{}'` | `CHECK (cardinality ≤ 12)`; each tag normalised in code (§7.3). GIN index deferred to the discovery phase |
| `avatar_key` / `cover_key` | `TEXT` | storage keys `profiles/<id>/<uuid>.webp`; URL derived on read |
| `visibility` | `TEXT NOT NULL DEFAULT 'private'` | `CHECK IN ('private','members','public')` |
| `moderation_status` | `TEXT NOT NULL DEFAULT 'active'` | `CHECK IN ('active','hidden')` — admin only (mirrors `LIBRARY_STATUSES`) |
| `verified_at` | `TIMESTAMPTZ` | set only by admin; `NULL` = unverified |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

*Indexes:* PK, `UNIQUE(owner_roll)`, `UNIQUE(handle)`; partial `idx_designer_profiles_public ON (created_at DESC) WHERE visibility='public' AND moderation_status='active'` (future directory).
*Ownership:* the student with `owner_roll = token.roll`. *Deletion:* `RESTRICT` against student deletion; a student erasure request is an admin procedure that deletes the profile first (children cascade). There is no student self-delete in Phase 1 — "make private" is the reversible equivalent.

### 4.2 Field provenance — inherited vs editable

| Field | Source | Student can edit? | Public? |
|---|---|---|---|
| `roll_number` | `student_sessions` | No | **Never** |
| `email` | `student_sessions` | Only via existing OTP email-change | **Never** |
| `unique_id` | `student_sessions` | No | Never |
| Account `name` | `student_sessions.name` (self-declared at registration) | No (Phase 1) | Not directly; used only to **prefill** `display_name` |
| `display_name` | profile | Yes — self-declared | Yes |
| Batch | derived from roll prefix | Only the `show_batch` toggle | If toggled on |
| `department` | profile | Yes — self-declared | Yes, labelled "as stated by the member" in UI |
| Verified badge | admin `verified_at` | **No** | Yes |
| `handle`, bio, headline, skills, disciplines, links, images | profile | Yes | per §9 |

**What "verified" means.** Today the system proves only *"this person controls an `@iitk.ac.in` mailbox"* (audit §2.6, SEC-03). Phase 1 therefore: (a) never labels display name or department as verified; (b) shows a **Verified** mark only when an admin sets `verified_at` after checking the person against the club's own records; (c) blocks `display_name` that case-insensitively equals the display name of a *verified* profile (anti-impersonation, §7.2); (d) lets any visitor report a profile (§10).

All writes that touch identity-adjacent fields (`handle`, `display_name`, `department`, images, `visibility`) require `requireVerifiedStudent` (OTP-issued token; rejects bypass and legacy 90-day tokens). Existing students must therefore re-login by OTP once to edit — acceptable and intentional; read endpoints stay `requireStudent`.

### 4.3 🟩 Child tables for profiles

**`designer_profile_disciplines`** — `profile_id TEXT NOT NULL → designer_profiles ON DELETE CASCADE`, `domain_id TEXT NOT NULL → domains ON DELETE CASCADE`, `PRIMARY KEY (profile_id, domain_id)`; max 3 per profile enforced in code inside the transaction (`SELECT … FOR UPDATE` on the profile row).

**`designer_profile_links`** — `id TEXT PK`, `profile_id → designer_profiles ON DELETE CASCADE`, `kind TEXT NOT NULL CHECK IN ('website','behance','dribbble','instagram','linkedin','github','youtube','other')`, `url TEXT NOT NULL CHECK (length ≤ 2048)`, `position INT NOT NULL`, `UNIQUE(profile_id, position)`; max 6 per profile (code). Index on `profile_id`. Replace-all semantics via `PUT` (one transaction).

### 4.4 🟨 `artworks` (modified — additive only)

| New column | Type | Notes |
|---|---|---|
| `status` | `TEXT NOT NULL DEFAULT 'published'` then default flipped to `'draft'` in a follow-up deploy (§6.4) | `CHECK IN ('draft','published','hidden')`. `hidden` = admin moderation (hide without deleting). |
| `source_kind` | `TEXT NOT NULL DEFAULT 'gallery_admin'` | `CHECK IN ('gallery_admin','asset','tool_export')`. `tool_export` is reserved for Phase 3; no code path writes it in Phase 1. |
| `source_asset_id` | `TEXT` | `REFERENCES assets(id) ON DELETE SET NULL` — provenance only; **never used to resolve a public URL** |
| `created_by_roll` | `TEXT` | the publishing student (audit/ownership of the *submission*); `NULL` for admin uploads. No FK (repo convention) |
| `description` | `TEXT` | `CHECK (≤ 1000)`; plain text |
| `published_at` | `TIMESTAMPTZ` | set on publish |

Existing columns (`artist`, `domain`, `storage_path`, `cover_url`, `featured`, `likes`, `notified_at`, …) are untouched. Backfill: every existing row is `status='published'`, `source_kind='gallery_admin'` (the column defaults do this; no UPDATE needed, so no rewrite risk).
*Indexes:* `idx_artworks_status_published ON (published_at DESC NULLS LAST, created_at DESC) WHERE status='published'`; `idx_artworks_created_by ON (created_by_roll) WHERE created_by_roll IS NOT NULL`.

### 4.5 🟩 `artwork_credits`

*Purpose:* attribution — who made an artwork, in what role, in what order, and whether they agreed.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT` PK | |
| `artwork_id` | `TEXT NOT NULL → artworks ON DELETE CASCADE` | |
| `profile_id` | `TEXT NOT NULL → designer_profiles ON DELETE RESTRICT` | restrict: profile removal must be an explicit admin act that first resolves credits |
| `role` | `TEXT NOT NULL` | `CHECK IN ('creator','co-creator','contributor')` |
| `role_label` | `TEXT` | `CHECK (≤ 40)` free text shown to users, e.g. "Illustration", "Animation" |
| `is_primary` | `BOOLEAN NOT NULL DEFAULT false` | |
| `position` | `INT NOT NULL DEFAULT 0` | display order; primary is always first |
| `status` | `TEXT NOT NULL` | `CHECK IN ('pending','accepted','declined')` |
| `source` | `TEXT NOT NULL` | `CHECK IN ('publisher','invite','admin')` |
| `invited_by_roll` | `TEXT` | |
| `responded_at`, `created_at` | `TIMESTAMPTZ` | |

*Constraints:* `UNIQUE (artwork_id, profile_id)`; `CREATE UNIQUE INDEX … ON (artwork_id) WHERE is_primary` (**exactly zero-or-one primary**; code enforces exactly one on publish); `CHECK (NOT is_primary OR role='creator')`.
*Indexes:* `(profile_id, status)` for profile pages; `(artwork_id, position)` for detail pages.
*Rules:* the publisher's own credit is created `accepted`/`creator`/`is_primary`. Invited credits start `pending`; **only `accepted` credits render publicly**. Admin-created credits (legacy artwork) are `accepted`, `source='admin'`, and the credited person can still decline/remove themselves (they were not asked; it is their name).
*Ownership:* mutable by the artwork's `created_by_roll` (invite/remove/reorder/role), by the credited profile owner (accept/decline/remove self), and by admin.

### 4.6 🟩 `attribution_requests`

Disputes and legacy claims without a new approval workflow for normal publishing: a student asks, an admin resolves.

`id TEXT PK`, `artwork_id → artworks ON DELETE CASCADE`, `profile_id → designer_profiles ON DELETE CASCADE`, `requested_role TEXT`, `note TEXT CHECK (≤ 500)`, `status TEXT CHECK IN ('open','approved','rejected') DEFAULT 'open'`, `resolved_at`, `created_at`, `UNIQUE (artwork_id, profile_id) WHERE status='open'` (partial). Approval inserts an `admin`-source credit in the same transaction and writes the audit log.

### 4.7 🟩 `content_reports`

`id TEXT PK`, `target_type CHECK IN ('profile','artwork')`, `target_id TEXT NOT NULL` (no FK — report must survive deletion), `reporter_roll TEXT NOT NULL` (signed-in only; no anonymous reports in Phase 1), `reason CHECK IN ('impersonation','inappropriate','copyright','wrong_credit','other')`, `detail TEXT CHECK (≤ 500)`, `status CHECK IN ('open','actioned','dismissed') DEFAULT 'open'`, `resolved_at`, `created_at`; `UNIQUE (reporter_roll, target_type, target_id) WHERE status='open'`.

### 4.8 🟩 `creator_audit_log`

Append-only. `id BIGSERIAL PK`, `entity_type`, `entity_id` (no FK — survives deletion), `action TEXT` (`profile.hide`, `profile.verify`, `artwork.hide`, `credit.add`, `credit.remove`, `report.resolve`, …), `actor_kind CHECK IN ('admin','student','system')`, `actor_roll TEXT` (NULL for the shared admin), `detail JSONB`, `created_at`. Index `(entity_type, entity_id, created_at)`. Replaces PR #84's `artwork_attribution_audit`. Note SEC-06: admin actions are attributable only to the shared principal until individual admin accounts exist.

### 4.9 Existing tables used unchanged

`student_sessions` (identity anchor), `domains` (disciplines), `assets` (publication source; **read-only** from this feature), `storage_derivatives` (thumbnails), `artwork_likes`, `artwork_comments`.

### 4.10 Access policies (application-level)

There is no Postgres RLS in this codebase; the API is the only data path and enforces policy. Policy summary: §9. **Verify (audit SEC-09) that Supabase's Data API is off or RLS is on**, otherwise these app-level policies can be bypassed from outside.

---

## 5. Profile media

### 5.1 Rules

| | Avatar | Cover |
|---|---|---|
| Types | JPEG, PNG, WebP (magic-byte verified; extract `IMG_MAGIC` from `team.ts` into `lib/imageMagic.ts`) | same |
| Max upload | 5 MB | 8 MB |
| Output | center-crop 512×512 WebP q80 | max 1600×600 WebP q80 |
| Processing | `sharp`: rotate by EXIF, **drop all metadata (GPS)**, re-encode | same |
| Key | `profiles/<profile_id>/<uuid>.webp` (immutable; old object deleted after the DB row updates) | same |
| Animated GIF / SVG | **Rejected** | rejected |

### 5.2 Failure handling
Upload → process → store → update row; if the row update fails, delete the new object (same compensating pattern as `artworks.ts:203-206`). Replacing deletes the old object best-effort. Wrong type → `415`; too large → `413` (existing JSON 413 convention); decode failure → `422`.

### 5.3 Moderation
Admin `hide` on a profile removes avatar and cover from every public response (the keys stay; URLs just aren't emitted).

---

## 6. Artwork publication & attribution logic

### 6.1 Publish from workspace (student)

```
POST /api/works                (draft from an asset the caller can see)
  validate: asset exists, kind='image', status='active', canUseAssetIn(asset, roll)  → 404 if not visible
  validate: mime ∈ {jpeg,png,webp,gif}; magic bytes re-checked on the downloaded bytes; ≤ 25 MB; NOT svg
  copy bytes → gallery/<uuid>.<ext>; make 400px webp thumb (existing generateThumb, extracted)
  INSERT artworks(status='draft', source_kind='asset', source_asset_id, created_by_roll, …)
  INSERT artwork_credits(primary, creator, accepted, source='publisher')
POST /api/works/:id/publish    (creator only)  → status='published', published_at=now()
```

Preconditions to publish: caller owns a profile with `moderation_status='active'`; title 1–200; `domain` is an existing `domains.title`; ≥1 accepted primary credit; per-student limits (20 drafts, 100 published, 10 publishes/hour). **Publishing never emails the club** (`notified_at` stays `NULL`; only an admin may trigger the existing notify flow).

A student may publish only assets they could *use* under the existing rule (`canUseAssetIn`, `assets.ts:258`) **and** only if the asset's `owner_roll` is the caller (you cannot publish someone else's community asset as your own); publishing someone else's asset is rejected `403`.

### 6.2 Unpublish / delete
`POST /api/works/:id/unpublish` → `status='draft'` (file copy retained; public URL is still fetchable until CDN expiry — stated in the UI). `DELETE /api/works/:id` → deletes row (cascades credits, likes, comments) then storage objects. Admin `hide` → `status='hidden'` (reversible; not shown even to the creator as published).

### 6.3 Legacy (Gallery) artwork
No automatic matching. Paths: (1) **admin attribution** — in the admin Gallery table each unattributed artwork shows its `artist` text and a profile picker (search by handle/display name, *suggestions only*); confirming inserts an `admin` credit + audit entry; (2) **student request** — "This is mine" on a legacy artwork creates an `attribution_requests` row; admin approves/rejects. `artworks.artist` is left untouched; when ≥1 accepted credit exists the UI shows credits instead of `artist`, otherwise it shows `artist` as plain text (no link).

### 6.4 Migration order (zero-downtime on Render auto-deploy)
1. Deploy schema with `status DEFAULT 'published'` and **code that always passes `status` explicitly** (admin insert → `'published'`, student insert → `'draft'`) and filters every public read by `status='published'`.
2. After the deploy is live, a later migration flips `status` default to `'draft'` (privacy-by-default for any future code path). Between steps, an old instance inserting without `status` still yields a published admin artwork, as before.

### 6.5 Credits management
- Creator may add contributors (by handle; target must exist and be `moderation_status='active'`), set `role`/`role_label`, reorder, remove. Max 10 credits per artwork.
- Adding creates a `pending` credit and a notification (existing `notifications` mechanism; no email in Phase 1). The target accepts/declines from their editor.
- Changing the *primary* creator is not allowed by the creator (transfer = admin).
- A contributor's profile being `private` does **not** block credit; their name renders only after they accept, and links to `/designers/:handle` only if the profile is currently `public` and `active` (§9.3).

---

## 7. Validation rules

### 7.1 Handle
Lowercase after `trim`; regex `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`; 3–30; **reserved**: `admin, api, designers, designer, me, new, edit, settings, profile, dna, dnaiitk, club, team, gallery, events, academy, resources, palette, design-studio, assets, home, moodboards, projects, templates, support, help, about, login, logout, null, undefined`. Rename at most once per 30 days (`handle_changed_at`); old handles are **not** redirected in Phase 1 (404; documented trade-off). Availability check is rate-limited.

### 7.2 Display name
1–100 after trim; collapse internal whitespace; reject control/zero-width/bidi characters; case-insensitively must not equal a *verified* profile's display name (unless that profile is the caller's).

### 7.3 Skills / disciplines
Skills: ≤12 tags, each 2–30 chars, lowercased, charset `[a-z0-9 +#.\-]`, deduplicated. Disciplines: ≤3 existing `domains.id`.

### 7.4 Links
≤6; scheme `https` only (stricter than `normalizeLinkUrl`, which also allows `http`); no userinfo; ≤2048; host must match the declared `kind` (e.g. `kind=instagram` → `instagram.com`/`www.instagram.com`); `website`/`other` accept any public host except IP literals and `localhost`. Never fetched server-side. Rendered with `rel="noopener noreferrer nofollow ugc"`, `target="_blank"`. No `mailto:` (anti-scraping).

### 7.5 Text
Bio/description/headline are plain text; rendered as text nodes (never `dangerouslySetInnerHTML`) with CSS `white-space: pre-line`. Strip control characters.

### 7.6 Errors (all `{ error: string }`)
`400` invalid body · `401` not signed in · `403` not allowed / session not OTP-verified · `404` not found *or not visible to caller* (never `403` for hidden existence) · `409` handle/credit conflict · `413` too large · `415` bad type · `422` undecodable media · `429` rate-limited.

---

## 8. API specification

All routes under `/api`. Bodies are JSON unless stated. `S`=`requireStudent`, `V`=`requireVerifiedStudent`, `O`=`optionalStudent`, `A`=`requireAdmin`. Rate limits are per-IP (existing limiter style) unless noted.

### 8.1 Profiles (`routes/designers.ts`, new; mounted `app.use('/api/designers', …)` — **static routes registered before `/:handle`**)

| Method & route | Auth | Request | Response | Notes |
|---|---|---|---|---|
| `GET /designers/me` | S | — | `200 OwnerProfile \| null` | includes `visibility`, `moderationStatus`, `verified`, link/discipline lists |
| `POST /designers/me` | V | `{handle, displayName, headline?, bio?, department?, showBatch?}` `strict()` | `201 OwnerProfile` | `403` if account missing; `409` handle/profile exists. Prefill `displayName` in UI from account name. Always created `visibility='private'` |
| `PATCH /designers/me` | V | partial of the above (`strict()`, ≥1 key) | `200 OwnerProfile` | `409` handle taken; `429` if renamed <30 days ago |
| `GET /designers/handle-available?handle=` | S | query | `200 {available, reason?}` | reason ∈ `invalid|reserved|taken`; 30/5 min |
| `PUT /designers/me/links` | V | `{links:[{kind,url}]}` (≤6, replace-all) | `200 links` | one transaction |
| `PUT /designers/me/disciplines` | V | `{domainIds:string[]}` (≤3) | `200` | |
| `PUT /designers/me/skills` | V | `{skills:string[]}` (≤12) | `200` | |
| `PATCH /designers/me/visibility` | V | `{visibility:'private'\|'members'\|'public'}` | `200 {visibility}` | No server-side preconditions; the editor's Preview-and-confirm step is the UX guard. Rejected with `403` while `moderation_status='hidden'` |
| `POST /designers/me/avatar` · `/cover` | V | multipart `file` | `200 {url}` | §5; 10/min |
| `DELETE /designers/me/avatar` · `/cover` | V | — | `204` | |
| `GET /designers/me/preview` | S | — | `200 PublicProfile` | exactly what a stranger sees right now (ignores caller's identity) |
| `GET /designers/:handle` | O | — | `200 PublicProfile` | `404` unless viewer may see it (§9.1) |
| `GET /designers/:handle/works?cursor=&limit=` | O | `limit ≤ 48` | `200 {items: WorkCard[], next}` | keyset on `(published_at, id)`; only visible works (§9.3) |

**`PublicProfile`** = `{ handle, displayName, headline, bio, department, batch?, verified, avatarUrl, coverUrl, disciplines:[{id,title,color}], skills, links:[{kind,url,label}], worksCount }` — an **explicit projection**; no `id` of the owner, no roll, no email, no `visibility`, no timestamps.
**`OwnerProfile`** = `PublicProfile` + `{ visibility, moderationStatus, handleChangeableAt, createdAt }`.
**`WorkCard`** = `{ id, title, coverUrl, mediaType, domain, role, roleLabel?, publishedAt }`.

### 8.2 Public artwork (`routes/artworks.ts`, modified)

| Method & route | Auth | Change |
|---|---|---|
| `GET /artworks` | O | **Replace `SELECT *`** with an explicit column list and `WHERE status='published'`; add `credits:[Credit]`. Comments remain (pagination is a separate debt item). |
| `GET /artworks/:id` | O | **New.** Public detail: `404` unless `status='published'`. |
| `PATCH /artworks/:id/status` | A (admin routes, §8.4) | `{status:'published'\|'hidden'}` (+ audit) |
| `PUT /artworks/:id/credits` | A | admin replace/adjust credits (legacy attribution), audit |
| `POST /artworks/:id/comments` | S | **Fix SEC-04:** ignore body `sender`; use the token's account name. |

**`Credit`** (public) = `{ displayName, handle?, role, roleLabel?, position, isPrimary, verified }` where `handle` is present **only** if that profile is currently `public` ∧ `active` (§9.3). Pending/declined credits are never emitted.

### 8.3 Student work management (`routes/works.ts`, new — `/api/works`)

| Method & route | Auth | Request | Response |
|---|---|---|---|
| `GET /works/mine` | V | `?status=` | `200 [Work]` (drafts + published, caller's) |
| `POST /works` | V + 10/h | `{assetId, title, description?, domain}` | `201 Work` (draft) |
| `PATCH /works/:id` | V | `{title?, description?, domain?}` | `200 Work` (creator only) |
| `POST /works/:id/publish` · `/unpublish` | V | — | `200 Work` |
| `DELETE /works/:id` | V | — | `204` |
| `GET /works/:id/credits` | S | — | `200 [CreditFull]` (creator or any credited profile) |
| `POST /works/:id/credits` | V | `{handle, role, roleLabel?}` | `201 CreditFull` (pending) |
| `PATCH /works/:id/credits/:creditId` | V | `{role?, roleLabel?, position?}` | `200` (creator only) |
| `DELETE /works/:id/credits/:creditId` | V | — | `204` (creator, or the credited profile for itself) |
| `POST /works/:id/credits/:creditId/respond` | V | `{accept:boolean}` | `200` (credited profile owner only) |
| `POST /works/:id/attribution-requests` | V | `{role?, note?}` | `201` (for **legacy/any published** work not credited to caller) |

All ownership checks derive from `req.studentRoll`; `profile_id` / `created_by_roll` are never accepted from the body. Cross-user access returns `404`.

### 8.4 Reports & admin (`routes/designers.ts` admin section, new; reserved handle `admin` prevents path collision)

| Method & route | Auth | Request → Response |
|---|---|---|
| `POST /reports` | S + 5/h | `{targetType, targetId, reason, detail?}` → `201` (idempotent per open report) |
| `GET /designers/admin/list?status=&q=&cursor=` | A | admin profile list (includes `ownerRoll`, `visibility`, `moderationStatus`, open report count) |
| `PATCH /designers/admin/:id` | A | `{moderationStatus?, verified?}` → `200` (+ audit) |
| `GET /designers/admin/reports?status=` | A | list |
| `PATCH /designers/admin/reports/:id` | A | `{status:'actioned'\|'dismissed'}` → `200` (+ audit) |
| `GET /designers/admin/attribution-requests` · `PATCH …/:id` | A | `{status:'approved'\|'rejected'}`; approve inserts the credit |
| `GET /artworks/admin/list` | A | **New** unfiltered Gallery list for the admin UI (needed once `GET /artworks` filters drafts) |

Admin responses may include `ownerRoll`; **no non-admin response ever does**.

---

## 9. Privacy & permissions

### 9.1 Profile visibility matrix
Viewer rows × profile `visibility` (assumes `moderation_status='active'`; `hidden` → `404` for everyone except admin):

| Viewer | `private` | `members` | `public` |
|---|---|---|---|
| Anonymous | 404 | 404 | ✅ |
| Signed-in student (not owner) | 404 | ✅ | ✅ |
| Owner | ✅ | ✅ | ✅ |
| Admin | ✅ (admin routes) | ✅ | ✅ |

### 9.2 Authorization model

| Action | Who | Mechanism |
|---|---|---|
| Create/edit own profile | OTP-verified student, own row only | `V` + `WHERE owner_roll = $roll` — no id parameter exists for self routes |
| Edit another's profile | nobody (except admin moderation fields) | structural: no route accepts a target profile id except admin |
| Publish an asset | asset owner | `canUseAssetIn` ∧ `asset.owner_roll = roll` |
| Edit artwork / manage credits | `created_by_roll` | row check; else `404` |
| Accept/decline a credit | credited profile's owner | join `designer_profiles.owner_roll = roll` |
| Moderate | admin (shared principal) | `A` |

### 9.3 Artwork visibility is separate from profile visibility
- An artwork is shown publicly iff `status='published'`. A creator with a `private` profile can still have published work credited by **display name text without a link** — but Phase 1 requires an *active* profile to publish, and the UI warns when the profile is not public ("your work is public; your profile page is not").
- A *credit* shows a clickable identity only when that profile is `public` ∧ `active`. A `members`-visibility profile is linkable only for signed-in viewers; the public API omits `handle` for anonymous requests (and the credit renders as plain text).
- A profile's work grid lists a work iff `status='published'` ∧ credit `accepted`. The grid's own visibility inherits the profile's (§9.1).
- Private workspace content (`assets`, `boards`, `projects`) is never referenced by any new public endpoint: public responses contain only the copied `gallery/` URL, never `storage_key`, `source_asset_id`, `created_by_roll`, or workspace ids.

### 9.4 Public-API field allowlist
Public serializers are explicit field lists (never `SELECT *`, never object spread of a row). A unit test asserts that the serialised JSON of every public endpoint contains **none** of: `owner_roll, ownerRoll, roll, email, unique_id, source_asset_id, created_by_roll, storage_path, storage_key, workspace_id`.

### 9.5 Required security tests (backend, real Postgres, in CI)
1. Anonymous `GET /designers/:handle` for `private`/`members`/hidden profile → `404` (identical body to nonexistent).
2. Student B cannot `PATCH /designers/me` as A (no id parameter) and cannot pass `owner_roll`/`profile_id` (strict schema → `400`).
3. Bypass token and legacy (no `identityVerified`) token → `403` on every `V` route; `200` on `S` reads.
4. Draft artwork absent from `GET /artworks`, `GET /artworks/:id`, profile works, and any Gallery-derived feed; present for the creator in `/works/mine`.
5. Publishing someone else's community/workspace asset → `403`/`404`; publishing a private asset the caller owns never changes `assets.visibility` and never exposes its `storage_key`.
6. Public JSON never contains the forbidden fields (§9.4).
7. Pending/declined credits are invisible publicly; accepting by a non-owner → `404`.
8. Exactly one primary credit; concurrent credit adds respect `UNIQUE(artwork_id, profile_id)`.
9. SVG, oversized, polyglot (valid magic + wrong extension) uploads rejected for avatar/cover/publish.
10. Handle: reserved words, case-collision, concurrent claim (one wins, other `409`), rename rate limit.
11. Comment `sender` cannot be spoofed (SEC-04).
12. Admin-only routes → `401` for student tokens and for student tokens carrying `role` claims.
13. Hiding a profile removes avatar/cover/links from all public responses and credit links.
14. Email-change requires verified session (PR #84's regression suite, ported).

---

## 10. Admin & moderation

Principle: **no approval queue for ordinary publishing.** Admin acts on exceptions using the existing single-role model.

| Need | Mechanism |
|---|---|
| Hide a profile / artwork | `moderation_status='hidden'` / `status='hidden'`; reversible; audit-logged; reuses the Library-moderation pattern |
| Verify a creator | set/clear `verified_at` (admin judgement against club records) |
| Inappropriate content | any signed-in student reports; admin resolves (`actioned`/`dismissed`) |
| Attribution dispute | `attribution_requests` or direct admin credit edit; credited person can always remove themselves |
| Legacy attribution | admin Gallery table credit picker (§6.3) |
| Impersonation | report → admin hides + (optionally) verifies the genuine profile |
| Removing a student's content entirely | `DELETE /artworks/:id` (existing) / hide profile |

Admin UI: one new admin tab (modelled on `LibraryModerationTab`) with *Profiles*, *Reports*, *Attribution* sub-views, plus a credit picker in the existing Gallery admin form. Limitation: audit entries cannot name the individual admin (SEC-06).

---

## 11. Frontend specification

### 11.1 Routes

```
Public (children of Root, like /gallery):
  /designers/:handle                 PublicProfilePage          (lazy chunk)
Private (children of WorkspaceShell):
  /profile                           ProfileEditorPage          (tabs: Profile · Work · Credits)
  /profile/work/:id                  WorkEditorPage             (publish + credits)
Existing, extended:
  /gallery  (artwork modal)          credits line → /designers/:handle
```
`/designers` (directory) is deliberately **not** added in Phase 1; the segment is reserved so the route-collision guard and handle list stay stable. New top-level segments `designers`, `profile` are checked by `deepLinkRoutes.test.ts` / `check-route-collisions.mjs`.

### 11.2 Component hierarchy

```
PublicProfilePage
├─ ProfileHeader            (cover, avatar, name, VerifiedMark, headline)
│  ├─ DisciplineChips
│  └─ ProfileLinks
├─ ProfileAbout             (bio, department, batch)  — omitted when empty
├─ WorksGrid                (virtualised only if >48; keyset "Load more")
│  └─ WorkCard              (image, title, role chip when not primary)
│     → opens ArtworkLightbox / links to /gallery?… (existing modal)
├─ ReportMenu               (signed-in only)
└─ states: ProfileSkeleton · NotFoundState · ErrorState(retry)

ProfileEditorPage          (inside WorkspaceShell)
├─ ProfileForm              (react-hook-form + zod mirror of §7)
│  ├─ HandleField           (debounced availability, 300ms)
│  ├─ ImageUploader ×2      (avatar, cover; crop → upload; progress; remove)
│  ├─ DisciplinePicker · SkillsInput · LinksEditor
│  └─ VisibilityControl     (private/members/public + explanation text)
├─ PreviewPane / “Preview as visitor” (GET /designers/me/preview in the real PublicProfile components)
└─ SaveBar                  (dirty state, per-section save, error summary)

WorkEditorPage
├─ AssetPicker              (reuses AssetBrowser, image-only, owned-only)
├─ WorkForm                 (title, description, domain)
├─ CreditsEditor            (add by handle, role, drag-reorder with keyboard alternative, status chips)
└─ PublishPanel             (explicit “Publish to Gallery” confirm; shows exactly what becomes public)
```

**Reuse:** `ArtworkLightbox`, `ZoomImage`, `SaveToMoodboardDialog`, `usePageMeta`, `thumbUrl/displayUrl`, Radix `ui/*`, `AssetBrowser`, the cropper bundled in the admin chunk, `LibraryModerationTab` as the admin template, `StudentContext`.
**New type/file hygiene:** put new API types and calls in new files (`src/app/lib/designers.ts`, `src/app/types/designers.ts`), not `AppDataContext.tsx`/`api.ts` growth — the pinned typecheck baseline (audit §8) is sensitive to line shifts.
**Constraint:** do not modify `Navigation.tsx`. Entry points (open decision D3): (a) a "Profile" item in the *workspace* sidebar (not the public navbar; no logo changes), (b) an "Edit profile" button on the owner's own profile, (c) a one-time prompt in `WelcomeOverlay`. Linking the public navbar to a user's profile needs the owner's explicit approval.

### 11.3 Public profile experience

Design intent: **an exhibition wall, not a dashboard.** Work leads; identity is a quiet header. DNA's existing tokens (`--color-ink`, `--color-canvas`, hairlines, `btn-primary/secondary`), no gradient chrome, no counters/follower numbers, minimal motion (opacity fade ≤150 ms, `prefers-reduced-motion` respected).

Desktop (≥1024 px):
```
┌──────────────────────────────────────────────────────────┐
│ cover (16:5, optional — absent ⇒ plain canvas band)      │
├──────────────────────────────────────────────────────────┤
│ (avatar 96)  Display Name ✓            [links: ↗ ↗ ↗]    │
│              Headline · Department · ’25                 │
│              [UI/UX] [Motion]                            │
│ Bio (max 65ch, 3 lines, “more”)                          │
├──────────────────────────────────────────────────────────┤
│ Work                                  ▢ ▢ ▢ ▢            │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐   (uniform 4:5 tiles,        │
│ │    │ │    │ │    │ │    │    object-fit cover,         │
│ └────┘ └────┘ └────┘ └────┘    title on hover/focus)     │
└──────────────────────────────────────────────────────────┘
```
Mobile (≤640 px): cover 16:9 or hidden; avatar 72 over cover edge; name/headline stacked; links collapse to an icon row (≥44 px targets); bio clamps to 4 lines + "more"; grid is 2 columns, 12 px gap; titles always visible under tiles (no hover). Tablet: 3 columns.

Information hierarchy: (1) name + verified mark → (2) headline/discipline → (3) work grid → (4) bio → (5) links. Collaborative works show a small "with N others" note on the detail view, and a role chip ("Illustration") on the card when the profile's role isn't primary.

**Empty states.** Visitor, no work: "No published work yet." (no CTA). Owner, no work: "Publish your first piece from your Asset Library" → `/profile/work/new`. Owner, empty bio: inline "Add a short bio" prompt visible only to the owner. Never render placeholder sections for future phases (projects, achievements) until they have content.

**Public / private behaviour.** Not visible → generic Not-found page (same as nonexistent). Owner viewing their own `private` profile sees a banner "Only you can see this page — Change visibility".

**Navigation.** Profile ↔ artwork: work tile → existing Gallery modal (deep-linkable); credits in the modal → `/designers/:handle`; browser back returns to the profile with scroll position preserved. Gallery cards gain a credit line (name, linked when permitted).

### 11.4 Profile editing — states and failure modes

| Situation | Behaviour |
|---|---|
| Not signed in | Open existing sign-in modal; return to `/profile` |
| Signed in with legacy/bypass token | Inline notice "Verify with email code to edit your profile" → triggers OTP flow; reads still work |
| First visit (no profile) | Create form: handle (with live check), display name (prefilled, editable), visibility fixed to **Private** with a clear "Make public when ready" step |
| Handle taken (409) | field error, suggestions `name-2`… not auto-applied |
| Rename too soon (429) | message with the date it unlocks |
| Image invalid/too large | field error before upload (client check) and after (server `413/415/422`) |
| Save fails (network/5xx) | form stays dirty, toast + retry; no data loss; unsent-draft kept in `localStorage` (try/catch) |
| Going public | Confirm dialog showing the **Preview** and listing exactly what becomes visible; one explicit button |
| Hidden by admin | Banner explaining the profile is hidden; edits allowed but not visible; contact path shown |

### 11.5 Accessibility & responsive requirements
WCAG 2.2 AA: visible focus; all controls keyboard-operable (including credit reordering via Up/Down buttons); form errors associated via `aria-describedby` and announced (`role="alert"` summary); image `alt` = title (artwork) / "" for decorative cover and "Display Name" for avatar; verified mark has accessible text "Verified by DnA admins"; contrast ≥4.5:1 in light and dark; touch targets ≥44×44 px; no horizontal scroll at 320 px; supports `prefers-reduced-motion` and dark mode; page `<title>` and description set via `usePageMeta` (client-side only — see limitation below).

**Known limitation:** SPA hosting means link previews (WhatsApp/LinkedIn) cannot show a profile's name/image. A Vercel Edge/OG function is a Phase 4 candidate; not Phase 1.

---

## 12. User journeys

1. **First profile.** Sign in (OTP) → "Create your profile" → handle + name → private profile created → add avatar/bio/links → *Preview* → *Make public* (confirm).
2. **Publish work.** Upload to Asset Library (existing) → Profile › Work › "Publish from library" → pick image → title/discipline → credits (add collaborators) → *Publish* confirm → appears on Gallery and profile.
3. **Be credited.** Collaborator receives an in-app notification → opens the work → *Accept* (credit appears publicly) or *Decline*.
4. **Claim legacy work.** Viewer on a Gallery piece → "This is mine" → note → admin approves → credit appears.
5. **Report.** Visitor/student → ⋯ › Report → reason → admin queue → hide/dismiss.
6. **Admin.** Admin › Creators › Reports → open → hide profile or artwork / verify → audit entry.
7. **Unpublish.** Work editor › *Unpublish* → disappears from Gallery & profile immediately.

---

## 13. Integration with future phases

| Future feature | How it attaches (no Phase 1 rework) |
|---|---|
| Public project showcase (P2) | New `public_projects` + `project_credits` (same shape as `artwork_credits`, separate table to keep FK integrity); `artwork_credits`/derived "team" kind gains meaning via a nullable `artworks.project_id` added then. Profile page gains a "Projects" section only when non-empty. |
| Project submission & moderation (P2) | Reuses `status` (`draft→submitted→published/hidden`) and `content_reports` + `creator_audit_log`. |
| Creator discovery / featured creators (P2) | `GET /designers` over the partial public index (§4.1); `featured_at` column on profiles then; skills GIN index then. |
| Asset Library integration (P3) | `artworks.source_asset_id` + "Publish" action in `AssetBrowser`; reverse "Published as…" badge via the FK. |
| Creative-tool outputs (P3) | `source_kind='tool_export'` already reserved; tools upload to Assets first (private), then publish through the same path — no new public pipeline. |
| Moodboards / Inspiration Library (P3/P6) | Existing `SaveToMoodboardDialog` works on published artworks; "Inspiration" = a curated query over published works, no new table. |
| Collaboration & invitations (P4) | `artwork_credits.status` + notifications are the invitation primitive; extends to workspace/project invites with the same consent states. |
| Learning achievements (P5) | New `achievements` table keyed by `profile_id`, derived from `student_completed_quizzes`/`student_watched_videos`; rendered as a profile section when non-empty. |

Nothing speculative is built in Phase 1: no directory, no `featured_at`, no `project_id`, no GIN index.

---

## 14. Open decisions (need the maintainer)

| ID | Decision | Recommendation |
|---|---|---|
| D1 | PR #84: rebase-and-extend vs close-and-reimplement | Salvage per §3.1 (same end state) |
| D2 | Roll-number claim weakness (SEC-03): roster import vs admin verification | Defer to a hardening task; Phase 1 ships with self-declared names + admin Verified mark |
| D3 | Profile entry point without touching `Navigation.tsx` | Workspace sidebar item + owner button + welcome prompt |
| D4 | Keep the `members` visibility tier? | Yes — mirrors Library "community"; cost is one enum value |
| D5 | Students may publish PDF/video? | No in Phase 1 (images only); revisit with Phase 2 |
| D6 | Rotate secrets (SEC-01) before launching public profiles | **Yes — blocking recommendation** |
