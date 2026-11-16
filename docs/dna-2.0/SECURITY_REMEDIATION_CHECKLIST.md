# DNA 2.0 — Security Remediation Checklist

| | |
|---|---|
| **Source** | [Architecture audit §7](DNA_2.0_ARCHITECTURE_AUDIT.md) (finding IDs `SEC-nn`) |
| **Audience** | The repository / hosting owner |
| **Rule** | Nothing below is marked *done* unless the provider confirmed it. Code-side fixes are listed separately from owner actions. No secret value belongs in a commit, PR, issue, log or chat. |

## 1. Status at a glance

| ID | Item | Code fix in repo | Owner / provider action |
|---|---|---|---|
| SEC-01 | Exposed JWT secret, admin password, DB password | Values removed from the working tree (history still contains them); boot-time weak-secret warning added | **REQUIRED — rotate all three** (§2) |
| SEC-02 | Real roll numbers + names hard-coded in source | **Fixed** — seed removed (`db/schema.ts`); regression test | Treat data already published as public; optionally purge history (§5) |
| SEC-03 | A student can claim another's roll number | **Mitigation shipped, dormant** — optional `student_roster` gate + audit endpoint | **Provide the roster and load it** (§4); run the audit for existing accounts |
| SEC-04 | Gallery comment authorship spoofable | **Fixed** — sender derived from the session; test | none |
| SEC-07 | Scheduler secret accepted in query string | **Fixed** — header only; test | Update the cron job to send `X-Tick-Secret`; **rotate** `INTERNAL_TICK_SECRET` (§3) |
| SEC-09 | Supabase Data API / RLS unverified | not code | **Verify in dashboard** (§6) |
| SEC-05 | 90-day stateless student tokens, no revocation | Not changed (design item) | Rotating `JWT_SECRET` (§2) invalidates every session once |
| SEC-06 | Single shared admin identity | Not changed (design item) | — |

## 2. Rotate the exposed credentials (SEC-01) — OWNER ACTION

Assume all three values are compromised: they were committed to a **public** repository and remain in git history and any fork/clone. Deleting them from the tree is not a remedy.

Do these in this order, during a quiet period. Expect every signed-in student and the admin to be signed out once (JWT secret change).

1. **Database password** — Supabase dashboard → Project Settings → Database → *Reset database password*. Copy the new connection string straight into Render's `DATABASE_URL` (do not paste it anywhere else). Redeploy the backend.
2. **JWT secret** — generate a new random value (`openssl rand -base64 48`) and set `JWT_SECRET` in Render. Redeploy. All existing tokens become invalid.
3. **Admin password** — the hash is stored in the database and is only seeded when absent, so changing `ADMIN_PASSWORD` alone does **not** change the login. Generate a hash locally and update the row:
   ```bash
   # run on your machine; type the new password at the prompt (it is not echoed or stored in history)
   read -rs PW && (cd backend && node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" "$PW"); unset PW
   ```
   ```sql
   UPDATE admin_config SET value = '<paste the printed hash>' WHERE key = 'admin_password_hash';
   ```
   Also update `ADMIN_PASSWORD` in Render so a fresh database would seed the same value.
4. **Review** provider logs (Supabase auth/DB logs, Render logs) for use of the old credentials since the repository became public. Report anything unexpected.
5. **Confirm** each step in the provider UI. Only then record the rotation as complete.

> Not verified by this work: whether the exposed values were ever live. No attempt was made to use them.

## 3. Scheduler secret (SEC-07)

1. In the cron service (e.g. cron-job.org) change the request to send the secret as a header: `X-Tick-Secret: <value>` and remove any `?secret=` from the URL.
2. Because the old URL form may have been logged, set a **new** `INTERNAL_TICK_SECRET` in Render and update the cron job in the same change.
3. After this release, a request using `?secret=` is rejected with `401` — update the cron job **before** deploying or reminders/mail-queue draining will pause until you do.

## 4. Roll-number claiming (SEC-03) — product decision + data needed

What shipped: a `student_roster` table and three admin endpoints. While the roster is **empty**, registration behaves exactly as before. Once it has rows, a **new** registration must match it (roll number, and email when the row lists one) and the stored name comes from the roster. Existing accounts are never locked out.

Owner steps:
1. Obtain the authoritative member list from the club (roll number, name, optionally IITK email). Do not commit it to the repository.
2. Load it: `PUT /api/students/roster` (admin token) with `{ "entries": [{ "rollNumber": "…", "name": "…", "email": "…" }] }` (≤ 2000 per call).
3. Review `GET /api/students/roster/audit` — registered accounts that are **not on the roster** or whose email **differs**. These may be legitimate (roster incomplete) or earlier claims by someone else. Resolve with the student; the repo provides no automatic action.
4. Decide whether the roster must be mandatory (it activates automatically once non-empty).

## 5. Student data already in source (SEC-02)

Real roll numbers and names were in a public file for the repository's lifetime. Removing them from the tree does not remove them from history. Options: accept (low sensitivity but personal data), or rewrite history with a tool such as `git filter-repo` and force-push — a disruptive, owner-only decision that invalidates all clones and open PRs. This work did **not** rewrite history.

## 6. Supabase Data API and Row Level Security (SEC-09) — OWNER ACTION

The backend uses a direct Postgres connection and the storage service key; it does not need the public REST ("Data API") or the anon key. If the Data API is enabled and a table has RLS off, the anon key can read it.

1. Dashboard → *Project Settings → API (Data API)* — note whether it is enabled. If you do not use it, disable it.
2. If it must stay on, enable RLS (with **no** policies) on every application table. To list what is exposed (read-only):
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY rowsecurity, tablename;
   ```
   Any `rowsecurity = false` table is readable through the anon key while the Data API is on. Sensitive: `student_sessions` (emails), `student_otps`, `admin_config`.
3. Verify from outside with the anon key (from the dashboard; do not paste it into chat): a request to `/rest/v1/student_sessions?select=roll_number&limit=1` must be denied or return nothing.

## 7. Storage privacy (informational)

All uploads share one public bucket addressed by unguessable paths, with no signed URLs. Student-created work is therefore published by **copying** to a separate `gallery/` key; a private workspace file's key is never exposed (see the [verification record](verification/PHASE_1_FOUNDATION_VERIFICATION.md)). Confirm in the dashboard that the bucket is intended to be public and has a file-size limit that matches the app (300 MB).

## 8. Record of completion (fill in)

| Item | Done by | Date | Provider-confirmed |
|---|---|---|---|
| DB password rotated | | | ☐ |
| JWT secret rotated | | | ☐ |
| Admin password rotated | | | ☐ |
| Tick secret rotated + cron updated | | | ☐ |
| Data API / RLS verified | | | ☐ |
| Roster loaded + audit reviewed | | | ☐ |
