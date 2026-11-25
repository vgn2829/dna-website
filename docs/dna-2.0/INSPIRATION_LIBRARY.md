# Inspiration Library (DNA 2.0 — Milestone C)

A student's **private** set of saved creative references, organised into private collections, searchable, and placeable on moodboards. Route: `/inspiration` (workspace shell). API: `/api/inspiration/*`.

## Architecture findings (audit of `main`, with #97/#98 inspected)

| Question | Finding |
|---|---|
| Can existing asset collections hold inspiration? | No. `asset_collections` are workspace-scoped and visible to members, an asset sits in at most one, and they can only group assets the workspace owns — not "private, many-to-many, includes things I don't own". |
| Do external URLs need a new model? | Library `kind='link'` assets already store URLs, but they are workspace assets (own visibility, workspace scoping, no tags/notes/category, no cover). A reference to a link, or to someone else's Community asset, is a *pointer owned by the saver*, so a thin reference table is cleaner than overloading assets. |
| Storage / ownership | Files live only in the asset store. References never copy files and never change asset ownership. |
| Permissions | Reused `canUseAssetIn` (the exact check board insertion uses) at save time **and on every read**. |
| Moodboards | Reused `POST /api/boards/:id/items` (`asset_id` path re-checks use on the board's workspace and de-duplicates; `image_url`+`source_url` path for external cover images). No second canvas path. |
| #97 / #98 | #97 is frontend-only (tool outputs → existing assets API); #98 is canvas tools/previews. Neither touches assets schema or API, so there is no conflict and no dependency. After #98 merges, placing a reference could use its `insertLibraryImages` for direct canvas insertion; today it uses the existing "pending board item" path, which works either way. |

## Data model (3 additive tables, `db/inspirationSchema.ts`)

- `inspiration_items` — owner-scoped pointer: `kind` `asset` (`asset_id` FK, `ON DELETE CASCADE`) or `link` (`url`, `url_key`, optional https `image_url`); `title`, `description`, `category`, `tags[]`. Unique per owner on `asset_id` and on `url_key` (duplicate prevention; tracking params, `www.`, fragments and trailing slashes normalised).
- `inspiration_collections` — owner-scoped, case-insensitive unique name, `visibility` (always `'private'` today).
- `inspiration_collection_items` — many-to-many join.

**Sharing later:** add `inspiration_collection_members(collection_id, roll, role)` and honour `visibility`; items stay owner-scoped and are exposed through collection membership. No existing column needs to change.

## Security

- Every query is `owner_roll`-scoped; a foreign id is a 404, identical to a missing one.
- **The server never fetches, resolves, scrapes or proxies any URL** → no SSRF surface. URLs are validated for storage anyway: http(s) only, no credentials, no localhost / single-label / `.local`/`.internal` hosts, no IP literals (incl. decimal/hex/IPv6), ≤2048 chars; cover images must be https and are rendered with `referrerPolicy="no-referrer"`.
- Asset items return only whitelisted asset fields (never storage keys). An asset that stops being usable resolves as `unavailable` with no URL.
- Deleting a reference or collection never deletes an asset. Write routes are rate-limited; per-student caps (2000 items, 100 collections).

## Known limits

- Asset picker offers images (the existing library picker's scope); files and library link assets are not saved as visual references.
- An external cover image is hot-linked (not copied), so it can disappear, and exporting a board that contains one may be blocked by the host's CORS policy.
- No server-side link previews/titles by design — titles default to the site name.
