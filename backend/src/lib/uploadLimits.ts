// ─────────────────────────────────────────────────────────────────────────
// The single application limit for an individual uploaded file — asset
// library uploads (routes/assets.ts) and gallery artworks
// (routes/artworks.ts). The frontend imports this same module
// (src/app/lib/uploadLimits.ts re-exports it), so client-side validation,
// UI copy and server enforcement can never disagree.
//
// It is the APPLICATION limit only: the storage service may impose a lower
// per-file ceiling of its own (Supabase's global file size limit is capped at
// 50 MB on the Free plan). Uploads the storage service refuses surface as a
// clear 413, never as a silent failure.
// ─────────────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '300 MB';

export function exceedsUploadLimit(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}
