# DNA 2.0 V1 — Release runbook

| | |
|---|---|
| **Branch** | `release/dna-2.0-v1` (base: `origin/main` @ `19c58ba`) |
| **Audience** | The repository / hosting owner, who runs the deploy |
| **Rule** | Nothing here is merged or deployed by the work that produced it. Every ☐ below is an owner action; none is claimed as done. |

## 1. What is in the release

| PR | Head SHA at integration | Scope |
|---|---|---|
| #84 | `d36b468e4abc` | Designer profiles, artwork credits with consent, verified-session guard, student roster gate, security fixes |
| #97 | `32be61e29732` | Save creative-tool results (Halftone, SVG, Background Remover) to the private Asset Library |
| #98 | `e71408d5b77a` | Moodboard improvements (starters, asset insertion, organisation, export, previews) |
| #99 | `6bfceb2b9131` | Private Inspiration Library |
| #100 | `509d0f319a31` | Public Project Showcase with moderation |
| #101 | `007aca7ced2b` | Creator Discovery (directory, featured creators) |

Merged with `--no-ff` in that order (history preserved; the original PR branches are untouched). Conflicts were confined to six files (`api.ts`, `schema.ts`, `app.ts`, `routes.tsx`, `AdminPage.tsx`, `Sidebar.tsx`) and were all additive — both sides kept.

**New in this release (not in any of the six PRs):** student profile management page (`/profile`) and profile-image upload; "More by this creator" on Showcase projects; Gallery credits on every Gallery surface, with withdrawal removing the name at once; **project collaboration** ([COLLABORATION.md](COLLABORATION.md)); security fixes (§3).

## 2. Deploy order and gating

1. **Before anything else — the owner actions in §3 (blockers).** In particular update the scheduler to send `X-Tick-Secret` as a **header**: this release rejects `?secret=` with `401`, so a cron job still using the query string will stop draining the mail queue and sending reminders.
2. **Backend (Render) first.** All schema changes are additive and run at boot (`initSchema`). The new API is backward compatible, so the old frontend keeps working against the new backend.
3. **Frontend (Vercel) second.** The new UI calls the new endpoints; deploying it before the backend would 404.
4. Smoke test (§6).

## 3. Production blockers and operational actions (owner)

> **Status: NOT DONE.** The work that produced this PR had no access to Supabase, Render or the scheduler, so none of the following has been performed or verified, and nothing below should be recorded as complete until the provider confirms it.

### 3.1 Rotate the exposed credentials — **release blocker**
The JWT secret, admin password and database password were committed to a public repository and remain in git history (and in forks/clones). Follow [SECURITY_REMEDIATION_CHECKLIST.md §2](SECURITY_REMEDIATION_CHECKLIST.md) exactly. This release additionally found and **redacted two more leaked values** that earlier scrubs missed (a JWT-secret-shaped value and a database-password-shaped token in `AUDIT_REPORT.md`). Redaction does not remove them from history — treat them as compromised.

- ☐ Database password reset in Supabase; new `DATABASE_URL` set in Render.
- ☐ New random `JWT_SECRET` (≥ 32 chars) set in Render. *The server only **warns** if it is short or placeholder-like; it does not refuse to boot, so do not rely on it.* Every session is invalidated once.
- ☐ Admin password hash updated in `admin_config` and `ADMIN_PASSWORD` updated.
- ☐ Old values confirmed dead (attempt a login with the old admin password; it must fail).
- ☐ Provider logs reviewed for use of the old credentials.

### 3.2 Scheduler header — **release blocker**
- ☐ Open the external scheduler (e.g. cron-job.org) and confirm the job sends `X-Tick-Secret: <value>` as a **request header** and no `?secret=` in the URL. The scheduler is outside the repository and could not be inspected.
- ☐ Set a new `INTERNAL_TICK_SECRET` in Render and update the job in the same change.
- ☐ Verify: `POST /api/internal/tick` with the header → `200`; with `?secret=…` → `401`; without → `401`.

### 3.3 Supabase Data API, RLS and storage — verify, don't assume
Not inspectable from the work environment (the Supabase connection requires interactive authorisation).

Read-only audit (run in the SQL editor):
```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY rowsecurity, tablename;
```
- **Tables created by this release** (`student_roster`, `designer_*`, `artwork_credits`, `creator_*`, `inspiration_*`, `showcase_*`) get `ENABLE ROW LEVEL SECURITY` with **no policies** automatically at first boot (`backend/src/db/rls.ts`). The backend connects as the table owner, which bypasses RLS, so behaviour is unchanged; Supabase's public REST API sees nothing. A failure to alter a table is logged and does not stop boot. A test fails if a new V1-prefixed table is not added to the list.
- **Pre-existing tables are deliberately NOT changed by the deploy** (no production policy changes without an approved rollout). The sensitive ones are `student_sessions` (emails), `student_otps`, `admin_config`, `event_rsvps`, `mail_queue`. Rollout procedure for the owner: (1) check Data API state in *Project Settings → API*; if unused, **disable it** and stop; (2) otherwise enable RLS with no policies on those tables in a quiet window, one at a time, running the backend smoke test (§6) after each; (3) rollback for any table is `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;`.
- **Verify from outside** with the anon key (do not paste it anywhere): `GET /rest/v1/student_sessions?select=roll_number&limit=1` must return nothing / be denied.
- **Storage:** all uploads share one *public* bucket addressed by unguessable keys (no signed URLs) — an existing, documented design property. A private Asset Library file is private by obscurity of its key, not by access control; the Showcase publishes by **copying** to a new `showcase/…` key and never exposes a private key. Confirm in the Storage dashboard that the bucket has no listing policy for `anon`.

### 3.4 Student roster and identity
- ☐ Provide the authoritative member list and load it (`PUT /api/students/roster`, admin token), then review `GET /api/students/roster/audit` (checklist §4). While the roster is empty, registration is open exactly as before.
- Verified by this work (code + tests): identity-affecting writes (profile, avatar, collaboration invitations/acceptance/removal) require an **OTP-issued** token — legacy 90-day and bypass tokens get `403`; profile ownership always comes from the token (every body is `.strict()`; an `owner_roll`/`verified` field is a `400`); `verified` can be set only by an admin; OTP codes now come from `crypto.randomInt` (was `Math.random`).
- Known and accepted for V1: `POST /api/auth/student/request-otp` tells a caller whether a roll number is already registered (`isNew`) and returns a masked email, because the sign-in form depends on it. It is rate-limited (6 per 15 min). Roll numbers are not secret on campus; closing this would change the sign-in flow and is listed for V2.

## 4. Migrations: order, behaviour, rollback

`initSchema()` runs at backend boot and is idempotent. Order added by this release (after the existing schema):

1. `student_roster` (inside `initSchema`; #84)
2. `initAssetSharingSchema` (existing)
3. `initDesignerSchema` — `designer_profiles`, `designer_profile_disciplines`, `designer_profile_links`, `artwork_credits`, `creator_audit_log`, and **additive columns on `artworks`** (`status` default `'published'`, `source_kind`, `source_asset_id`, `created_by_roll`, `description`, `published_at`) — existing Gallery rows stay published and the free-text `artist` is untouched
4. `initInspirationSchema` (#99)
5. `initShowcaseSchema` — Showcase tables **plus the collaboration tables** and `showcase_assets.added_by_roll`
6. `initCreatorDiscoverySchema` (#101)
7. `initEmailCentreSchema` (existing)
8. `enableRlsForNewTables` (this release)

* Everything is `CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. **No `DROP`, no `UPDATE`/backfill of existing rows, no destructive DDL** in any of the new modules. Each `ALTER TABLE artworks` takes a brief lock; run during a quiet period.
* **Fresh-database initialisation is tested:** the whole backend suite builds its database from `initSchema()` (no schema snapshots), and `designer-migration.test.ts` covers re-running the designer migration against an already-migrated database.
* **Rollback.** The schema is purely additive, so the previous backend version runs unchanged against the migrated database (it ignores the new tables/columns). To roll back: redeploy the previous Render build, then the previous Vercel deployment. No down-migration is required, and **none should be run** — dropping tables would destroy user-created profiles, credits, projects and comments. If a full revert of data is ever wanted, take a Supabase backup first. RLS on the new tables can be reversed with `ALTER TABLE … DISABLE ROW LEVEL SECURITY`.

## 5. Production configuration required

| Setting | Where | Notes |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET` (≥ 32 random chars), `ADMIN_PASSWORD` | Render | all **rotated** (§3.1) |
| `INTERNAL_TICK_SECRET` | Render | new value; scheduler sends it as `X-Tick-Secret` (§3.2) |
| `RESEND_API_KEY`, `MAIL_FROM` | Render | unchanged; required in production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Render | unchanged; the server refuses to start in production without them. Profile images are stored under `profiles/<id>/avatar-<uuid>.webp` and Showcase copies under `showcase/<project>/…` in the same bucket |
| `CORS_ORIGINS` | Render | must include the production frontend origin; never `*` |
| `VITE_API_BASE_URL` | Vercel | unchanged |
| `PUBLIC_MEET_PASSCODE` | Render | recommended; note the admin UI shows a placeholder `DNA2025` when none is set (cosmetic) |

No new environment variable is introduced by this release.

## 6. Post-deploy smoke test
1. `GET /api/health` → `{"status":"ok"}`; boot log shows `Schema initialization target … allowed` and no `RLS: could not enable` lines.
2. Sign in with a real account by email OTP; open **My profile**, create/edit it, upload an image, switch visibility.
3. Open `/creators` and `/showcase` anonymously; a private profile must not appear.
4. As two accounts: create a Showcase project, invite the second as editor, accept, edit, comment, remove; confirm the removed account gets *Project not found*.
5. Admin: review → approve → publish a project; confirm the public page lists credited names only.
6. Gallery: a credited artwork links to the profile; a withdrawn credit disappears on reload.
7. `POST /api/internal/tick` with the header (200) and with `?secret=` (401).

## 7. Deferred to V2 (explicitly out of V1)
Milestone G — learning achievements, badges, gamification; real-time co-editing; ownership transfer; invitation/comment notifications (bell/e-mail); owner-managed → shared moodboard references on projects; individual admin accounts and revocable student sessions (SEC-05/06); closing the `request-otp` registration oracle.

## 8. Known limitations
* Collaboration: last-write-wins per save (no merge); see [COLLABORATION.md §9](COLLABORATION.md).
* The weak-`JWT_SECRET` check warns but does not refuse to boot (a hard failure before rotation would crash-loop production).
* `DNA_CLUB_DOCS.md` still says a meet passcode is seeded as `DNA2025`; the backend does not seed one.
* Homepage Gallery widgets show credits as plain text (no links) to avoid nested links inside animated cards.
* A large bundle warning (`AdminPage` ≈ 1.1 MB, entry ≈ 1.1 MB) is pre-existing and not addressed here.

## 9. Test and verification record
{{TEST_RECORD}}
