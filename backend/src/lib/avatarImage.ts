import sharp from 'sharp';

// Profile-image processing (DNA 2.0 V1). An avatar is public, so nothing the
// student uploaded is stored as-is: the file is validated by its bytes (never
// its name or declared type), decoded, EXIF-rotated, cropped to a square and
// RE-ENCODED as WebP. Re-encoding drops every metadata block (EXIF/GPS/ICC
// text), embedded scripts in SVG-style payloads, and polyglot trailers.

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 512;
const MAX_INPUT_PIXELS = 36_000_000; // decompression-bomb ceiling (~6000x6000)

export type AvatarProblem = 'unsupported' | 'unreadable' | 'too-large-dimensions';

/** Sniffs JPEG / PNG / WebP from the first bytes. GIF, SVG, HEIC, PDF etc. are refused. */
export function sniffAvatarType(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function processAvatar(input: Buffer): Promise<{ ok: true; buffer: Buffer } | { ok: false; problem: AvatarProblem }> {
  if (!sniffAvatarType(input)) return { ok: false, problem: 'unsupported' };
  try {
    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
    return { ok: true, buffer };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    return { ok: false, problem: /pixel limit/i.test(msg) ? 'too-large-dimensions' : 'unreadable' };
  }
}
