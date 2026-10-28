# Interrupted asset upload investigation

Status: a local disconnect/temporary-file defect is reproduced and fixed. The cause of the reported production incident is **not yet established**. Do not describe this change as a verified production fix.

Incident: `dpppp.psd`, approximately 70.9 MB, 28 October 2026 at 13:16 IST (07:46 UTC). No production assets were created, retried or deleted during investigation. Production inspection was limited to the public frontend bundle and a health GET.

## Upload path and evidence

1. The production frontend bundle identifies `https://dna-website.onrender.com` as the API origin. `api.assets.upload` in `src/app/lib/api.ts` sends a multipart `POST /api/assets` directly there using XHR, with a per-queue-item `client_upload_id`. Vercel serves the SPA; the upload does not traverse a Vercel function. `vercel.json` only supplies SPA rewrites/redirects.
2. `AddAssetDialog.tsx` retains the same key on retry. XHR reports bytes sent to Render, not persistence progress. A 100% progress event is not success; only a successful JSON response completes the queue item. XHR has no explicit timeout. Network errors also cover proxy responses the browser cannot read because CORS headers are missing.
3. `backend/src/routes/assets.ts` requires a student token and rate-limits uploads to 20/minute per IP. `diskUploadSingle` streams multipart data to disk, enforcing 314,572,800 bytes (300 MiB, currently labelled “300 MB”). Workspace membership, collection, visibility, filename and file classification are checked server-side.
4. Allowlisted image MIME types take the image path. Other formats require `kind=file` and a valid extension, and are stored as download-only `application/octet-stream`. PSD is not sent to Sharp. Image dimensions are best-effort; thumbnails run after original storage and metadata persistence.
5. `getStorage()` selects Supabase when both storage settings are present. Production startup refuses the local-disk fallback. `SupabaseStorageProvider.uploadFile` buffers files up to 50 MiB and streams larger files through storage-js with `duplex: half`. It is a single standard upload, not TUS/resumable upload. Local tests use the real local provider, not production Supabase.
6. The storage object is written first, then the asset row. DB insertion failure attempts object deletion. Deletion failure is logged and may leave an orphan for inventory review. The unique owner/key index and content fingerprint reject mismatched retries and resolve races to one asset; a racing loser removes its object. This guarantee covers active keyed uploads, not new keys generated after reopening the dialog. Database deletion, process termination and ambiguous database acknowledgments are not made transactional with storage by this change.
7. Node HTTP request reception uses the default request timeout because `server.ts` does not override it. Modern Node defaults to 300 seconds; the deployed runtime and Render edge limits need verification. The alternative Docker nginx configuration has no explicit body-size setting (nginx defaults to 1 MiB including multipart overhead) and a 30-second upstream read timeout. That configuration cannot claim 300 MiB support and is not the route identified in the production bundle.

## Confirmed defect and change

`diskUpload.ts` removes unclaimed temporary files on response close. The asset handler previously claimed an image only when scheduling its derivative, and never claimed ordinary files. After the incoming file was completely received, a connection closing during hashing, storage or database work could unlink a file the handler still needed. A real loopback HTTP test paused storage, disconnected the client and then resumed storage: before the fix it failed with `ENOENT` because the temporary file was gone. This affects all formats and does not establish what caused the original network interruption.

The asset handler now claims the temporary file as soon as multipart parsing finishes, keeps it through all asynchronous processing, and releases it in `finally`. Image derivatives retain their existing cleanup ownership. A response disconnect can therefore leave a successfully completed asset, and retrying with the same key retrieves it rather than creating another asset. An incomplete incoming multipart request is still aborted/cleaned by Multer and creates no asset row.

A second fault-injection test wrote an object and then rejected its acknowledgement; the old handler left that object without metadata. The storage error path now attempts deletion of its fresh key before responding. Cleanup is best-effort: remote deletion failure or an in-flight remote write completing later can still require inventory review.

The handler also distinguishes storage failure (502), metadata save failure (500), and failure to build the response after persistence (500), while retaining existing size, validation and authorization responses. Logs include stage and file size. The frontend explains that retry resends the file and that the server may still finish the first attempt. There is no byte-offset resume or automatic retry of a network error.

Changed files:
- `backend/src/routes/assets.ts`: temporary-file ownership, cleanup after storage failure and failure-stage reporting.
- `backend/tests/asset-upload-recovery.test.ts`: real HTTP recovery, size and failure regression tests.
- `src/app/lib/assetLibrary.ts` and its test: accurate restart wording.
- This investigation report.

## Supported maximum and deployment requirements

**Application/local pipeline:** 314,572,800 bytes, demonstrated with a streamed file at the exact limit. Existing tests also enforce rejection one byte above the limit with a scaled boundary.

**Production end-to-end maximum: unverified.** It is the minimum of the app limit, Render edge/runtime limits, Supabase project global size limit and bucket size/MIME restrictions. Supabase currently documents a Free-plan maximum of 50 MB; paid-plan settings can be higher. A 70.9 MB PSD is above that Free-plan maximum. This is a diagnostic lead, not evidence of the actual project's plan or settings. The advertised 300 MB remains an application ceiling pending configuration evidence, not a certified production capability.

No environment variable, storage policy, plan, infrastructure setting or timeout was changed. The local fix requires only a normal backend/frontend deployment after approval. Before certifying 300 MiB support, confirm Render limits/runtime and Supabase plan, global limit and bucket limit (at least 314,572,800 bytes), plus acceptance of octet-stream. If those settings cannot support it, lower the advertised/enforced application limit together in a follow-up. If the alternate nginx deployment is used, its body-size and proxy time budgets need an explicitly reviewed configuration change. Do not raise limits or provision a paid plan without approval.

## Evidence needed to close the production incident

Collect redacted entries for **28 October 2026, 07:41–07:51 UTC** (extend earlier if the upload started earlier):

- Render: `POST /api/assets`, request start/end, status, bytes received, duration, request/correlation ID if available; connection resets/timeouts; service deploy/restart and OOM/memory events; `Asset upload error`, `Supabase storage upload error`, `Supabase storage streamed upload error`, and orphan/duplicate cleanup errors. Existing logs may not contain request/access entries; absence of a line alone cannot prove that Render did not receive the request.
- Supabase Storage logs: object-upload request time, HTTP status/error code, size and duration, and whether completion was recorded. Redact project/object paths and all private or signed URLs. Read-only project/bucket size and MIME configuration (values only) is also needed.
- Database: read-only matching asset rows near the incident, with creation time, size, status, kind and visibility. Keep identifiers private when sharing. A committed row plus a completed storage request suggests response loss; storage success without a row suggests metadata/cleanup investigation. A missing row alone does not prove no upload attempt occurred.
- Browser Network panel, if still available: request start/duration, status or browser error and response body. Do not share Authorization headers, cookies or HAR files containing secrets.

Optional read-only SQL for an authorized operator (timestamps are stored as text; ISO string comparison follows the application's timestamp convention):

```sql
SELECT created_at, size_bytes, status, kind, visibility
FROM assets
WHERE filename = 'dpppp.psd'
  AND created_at >= '2026-10-28T07:41:00.000Z'
  AND created_at <= '2026-10-28T07:51:00.000Z'
ORDER BY created_at;
```

Do not delete any matching row/object or retry the upload to diagnose it. A follow-up may select resumable uploads if logs establish large/slow transfers as the bottleneck; this patch does not introduce a speculative transport redesign.

## References

- [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads): standard uploads support larger files, but TUS is recommended above 6 MB for reliability.
- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits): global, plan and per-bucket limits.
- [Node HTTP request timeout](https://nodejs.org/api/http.html#serverrequesttimeout).
- [nginx body-size default](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).

## Validation

Tests use a separate local Postgres instance and never the original checkout's scratch database or hosted services. Node 22 was used for the test/build tooling.

- Backend full suite: **48 files, 725 tests passed**, against an isolated Postgres cluster containing `dna_club_test`.
- Added recovery suite: **7 tests passed**, including a 70,900,000-byte PSD-named binary and a 314,572,800-byte streamed file. These fixtures exercise the download-only binary path, not a PSD/ZIP parser. The incoming-disconnect test verifies partial temp-file cleanup and same-key retry; the storage-disconnect test reproduces the original `ENOENT` before the fix and passes after it.
- Existing integration suites exercise small PNG/PDF uploads, extension/type validation, oversize rejection, concurrent duplicate prevention, visibility, collection and authorization behavior.
- Backend `npm run typecheck` and `npm run build`: **passed**.
- Frontend suite: **16 files, 234 tests passed**. Production build: **passed**, with the existing large-chunk warning.
- Frontend typecheck: **16 pre-existing errors, no new errors**. Output was compared with an isolated clean worktree at `79cf2ca` and was byte-for-byte identical; these unrelated errors were not repaired.
- `git diff --check`: **passed**.

An earlier full backend run using the new database name `dna_upload_investigation_test` had 722 passes and two failures in the existing `db-safety.test.ts`, which hardcodes `dna_club_test` despite the configurable test URL. Rather than touch the original scratch DB or weaken the guard, the successful final full run used a separate Postgres instance with the expected database name. An optional native Rolldown binding missing from `npm ci` was installed into the isolated dependency directory only; package manifests and lockfiles were not changed.

The original checkout's edits, stash and other worktrees were left untouched. Work was based on freshly fetched main (`79cf2ca`) in a dedicated `fix/interrupted-asset-uploads` worktree. No infrastructure/configuration change is included.
