import { derivativeKey, resolveDerivativeUrls, sourceKeyFromUrl, isDerivableSourceKey } from '../storage/derivatives';
import { getStorage } from '../storage';

// ─────────────────────────────────────────────────────────────────────────
// Board list responses (V3.2.5): a READ-TIME `preview_thumbnails` map for
// the Moodboards card previews (BoardPreview).
//
//   preview_thumbnails: { [original preview image src]: t512 thumbnail URL }
//
// Keys are the exact `src` strings already inside `canvas_preview`, which
// is returned unchanged (and never rewritten in the database) — so the
// original stays the source of truth and the fallback. An entry exists
// only for OUR stored raster images whose t512 derivative is 'ready'
// (storage/derivatives.ts): external URLs, SVGs, malformed or unknown
// URLs, and missing / failed / skipped derivatives are simply absent, and
// the card uses the original. One batched lookup for the whole response
// (all boards, deduplicated), never one per board or per image.
// ─────────────────────────────────────────────────────────────────────────

type PublicBoard = Record<string, unknown>;

function previewImageSources(board: PublicBoard): string[] {
  const preview = board.canvas_preview as { items?: Array<{ k?: unknown; src?: unknown }> } | null | undefined;
  if (!preview || !Array.isArray(preview.items)) return [];
  const out: string[] = [];
  for (const it of preview.items) {
    if (it && it.k === 'image' && typeof it.src === 'string' && /^https?:\/\//i.test(it.src)) out.push(it.src);
  }
  return out;
}

export async function withPreviewThumbnails<T extends PublicBoard>(boards: T[]): Promise<Array<T & { preview_thumbnails: Record<string, string> }>> {
  const perBoard = boards.map(previewImageSources);
  const unique = [...new Set(perBoard.flat())];
  const resolved = unique.length > 0 ? await resolveDerivativeUrls(unique) : new Map<string, string>();

  // Accept a mapping only when it is exactly the derivative of THIS src's
  // own managed source key.
  const thumbFor = new Map<string, string>();
  for (const src of unique) {
    const mapped = resolved.get(src);
    const key = sourceKeyFromUrl(src);
    if (!mapped || !key || !isDerivableSourceKey(key)) continue;
    if (mapped === getStorage().getPublicUrl(derivativeKey(key))) thumbFor.set(src, mapped);
  }

  return boards.map((board, i) => {
    const thumbnails: Record<string, string> = {};
    for (const src of perBoard[i]) {
      const t = thumbFor.get(src);
      if (t) thumbnails[src] = t;
    }
    return { ...board, preview_thumbnails: thumbnails };
  });
}
