# DNA 2.0 — Phase 1 Foundation: Verification Record

| | |
|---|---|
| **Scope** | Plan tasks **T1, T2, T3 (owner + public API), T5, T6, and the admin half of T8/T13** (see "Not in this change"). |
| **Spec** | [Phase 1 technical spec](../DNA_2.0_PHASE_1_TECHNICAL_SPEC.md) · [Plan](../DNA_2.0_IMPLEMENTATION_PLAN.md) |
| **Method** | Backend suite against a disposable local PostgreSQL (never a hosted database); route-level tests with real constraints. |

## 1. Previously uninspected modules — resolved

The audit listed these as unread. They were read line-by-line for this change.

| Module | Finding | Action |
|---|---|---|
| `routes/notify.ts` (artwork notify/preview) | Admin-only, but selected `SELECT * FROM artworks WHERE id=$1` and would email the **whole club** about any artwork id, including a future draft. | Both routes now return `409` unless `status = 'published'`. Test: `creator-privacy.test.ts` "never announces a non-published artwork". |
| `storage/inventory.ts` | `gallery/`, `thumbs/`, `covers/` are classified **UNKNOWN** — "retained, never a candidate" for deletion. | None needed. Published copies under `gallery/` can never be flagged as orphans. |
| `storage/references.ts` | Only scans boards, board versions, templates, board items and thumbnails; used by **asset** deletion. It never looks at `artworks`. | None needed. Because publishing copies bytes to a new key, deleting a source asset cannot break a published work and vice versa. |
| `db/seed.ts` | Inserts sample artworks without `status`; refuses to run without `ADMIN_PASSWORD`. | Column default `'published'` keeps seeded rows public, as before. |
| Readers/writers of `artworks` | `routes/artworks.ts` (all handlers), `routes/notify.ts`, `db/seed.ts`. No other backend module references the table (`git grep` over `backend/src`). The frontend reads only via `GET /api/artworks`. | `GET /` and the new `GET /:id` filter on `published`; admin reads use `GET /admin/list`. |

## 2. Existing public artwork behaviour and historical records

- Legacy rows are **not rewritten**. New columns default (`status='published'`, `source_kind='gallery_admin'`, other columns `NULL`); no `UPDATE` runs.
- The free-text `artist` column is unchanged and remains the displayed fallback when an artwork has no accepted credits.
- No name matching, no automatic attribution, nothing is "claimed".
- Tests: `designer-migration.test.ts` (representative legacy installation: rows, likes, comments identical after two runs; no `creator_designer_id`), `creator-privacy.test.ts` ("startup initialisation preserves Gallery data", "leaves the legacy artist text untouched").
- Response shape for existing clients is unchanged except for one **additive** field, `credits: []`.

## 3. Storage privacy

| Property | Verified how |
|---|---|
| No public endpoint serialises `storage_path`, `created_by_roll`, `source_asset_id`, `status` or any roll number for Gallery artwork | Explicit column list `ARTWORK_COLUMNS` (no `SELECT *` on any public path) + test asserting those keys are absent from `GET /api/artworks`. |
| Draft / hidden artwork is not reachable by list, detail, like, comment, comment feed, or club notification | `creator-privacy.test.ts` (drafts: 404 even to the creator through public routes). |
| Profile and credit responses contain no roll number, email or internal id | `designers.test.ts` (key allow-list + forbidden-pattern scan) and `creator-privacy.test.ts` (works list). |
| Publishing copies the file instead of flipping a flag | **Design only** — the publish endpoint (T7) is not part of this change. The schema keeps provenance in `source_asset_id` (never used to build a URL), and the privacy tests above fail if a private key were ever serialised. |
| Bucket is public / secret-URL model | Unchanged and documented in the audit (SEC-10). Not verifiable from the repo; see the remediation checklist §6–7. |

## 4. Security items

| Item | State |
|---|---|
| Rotate JWT / admin / DB credentials | **Outstanding — owner/provider action.** Checklist provided. Nothing was rotated or claimed rotated. |
| Credential values in the tree | Removed from the working tree; remain in git history (rotation is the remedy). |
| Hard-coded student identities | **Fixed** in source (seed removed); history still contains them. |
| Roll-number claiming | **Mitigation shipped but dormant** until the club roster is loaded; needs owner data. |
| Gallery comment authorship | **Fixed** + test. |
| Scheduler secret in query string | **Fixed** (header only) + test. Cron job must be updated before deploy. |
| Supabase Data API / RLS | **Outstanding — requires dashboard access.** Read-only verification steps provided. |
| Account-takeover via bypass session + email change | **Fixed** (PR #84's `requireVerifiedStudent`; regression suite retained). |

## 5. Automated results

Recorded in the PR description (counts and exit codes of the final run).

## 6. Not in this change (and why)

| Item | Reason |
|---|---|
| Student publishing (T7), profile media upload (T4) | The brief requires the Gallery privacy fix and verification first. They are now unblocked but are separate, larger changes. Student publishing is **not enabled**: no route lets a student create an artwork. |
| Frontend (T10–T12, T14–T15), workspace-sidebar "My Profile" entry (D2) | A sidebar link needs a page to link to; adding a dead entry would be worse than none. It lands with the profile editor. `Navigation.tsx` untouched. |
| Student-initiated credit invitations and attribution requests (rest of T8/T13) | Depend on T7 (a student-owned artwork). Admin-initiated credits, invitations, and the credited person's accept/decline are implemented. |
| Reports (`content_reports`) | Depends on the UI that raises them; table intentionally not created yet (no speculative schema). |

## 7. Operational notes

- **Deploy order:** update the cron job to send `X-Tick-Secret` **before** this release (query-string secrets are now rejected).
- **Privacy default:** `artworks.status` defaults to `'published'` for this release so an old instance still running during the deploy keeps working; a follow-up migration flips the default to `'draft'` (spec §6.4). All new code paths pass `status` explicitly.
- **Rollback:** schema is additive; reverting the code leaves unused tables/columns harmlessly. `student_roster` is empty until an admin loads it.
