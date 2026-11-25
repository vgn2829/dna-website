import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';
import { getStorage } from '../storage';
import { LIMITS, WORK_MIME_TYPES } from './showcaseValidation';

// ─────────────────────────────────────────────────────────────────────────
// Publish = COPY. A showcase work is made public by writing a NEW, sanitised
// object under showcase/<project>/<uuid>.<ext>; the source asset's key,
// visibility and URL are never changed or emitted publicly. Re-encoding with
// sharp drops EXIF/GPS and any other embedded metadata. SVG/GIF are not
// accepted as works at all (script/animation risk).
// ─────────────────────────────────────────────────────────────────────────

export interface WorkRow { id: string; asset_id: string | null; added_by_roll?: string | null }
export interface PublicCopy { workId: string; key: string; mime: string; width: number; height: number }

const EXT: Record<string, { ext: string; mime: string }> = {
  png: { ext: 'png', mime: 'image/png' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

export type CopyResult = { ok: true; copies: PublicCopy[] } | { ok: false; error: string };

/** Verifies every source (still owned, active, allowed image) and writes the public copies. Cleans up after itself on failure. */
export async function copyWorksToPublic(projectId: string, ownerRoll: string, works: WorkRow[]): Promise<CopyResult> {
  const storage = getStorage();
  const written: string[] = [];
  const copies: PublicCopy[] = [];
  try {
    let total = 0;
    for (const w of works) {
      if (!w.asset_id) return fail('An image’s source file no longer exists');
      const a = (await pool.query('SELECT * FROM assets WHERE id = $1', [w.asset_id])).rows[0] as
        { owner_roll: string; status: string; kind: string; storage_key: string | null; mime_type: string | null; size_bytes: number | null } | undefined;
      // The image must still belong to whoever contributed it (the owner for the owner's own and all pre-collaboration works).
      // A removed collaborator's images are deleted from the project at removal; this is the belt-and-braces check.
      if (!a || a.owner_roll !== (w.added_by_roll ?? ownerRoll) || a.status !== 'active' || a.kind !== 'image' || !a.storage_key) {
        return fail('An image is no longer available to the person who added it');
      }
      if (!a.mime_type || !(WORK_MIME_TYPES as readonly string[]).includes(a.mime_type)) return fail('Only PNG, JPG and WebP images can be published');
      if ((a.size_bytes ?? 0) > LIMITS.workBytes) return fail('An image is larger than 25 MB');
      total += a.size_bytes ?? 0;
      if (total > LIMITS.totalBytes) return fail('The images add up to more than 100 MB');

      const source = await storage.download(a.storage_key);
      const meta = await sharp(source).metadata();
      const target = meta.format ? EXT[meta.format] : undefined;
      if (!target) return fail('Only PNG, JPG and WebP images can be published');
      // rotate() applies EXIF orientation before the metadata is dropped; output carries no metadata.
      const { data, info } = await sharp(source).rotate().toFormat(meta.format as 'png' | 'jpeg' | 'webp').toBuffer({ resolveWithObject: true });
      const key = `showcase/${projectId}/${uuidv4()}.${target.ext}`;
      await storage.upload(key, data, target.mime, { cacheControl: '86400' });
      written.push(key);
      copies.push({ workId: w.id, key, mime: target.mime, width: info.width, height: info.height });
    }
    return { ok: true, copies };
  } catch (err) {
    console.error('Showcase publish copy error:', err);
    await deleteObjects(written);
    return { ok: false, error: 'Couldn’t prepare the images for publishing — nothing was published' };
  }

  async function fail(error: string): Promise<CopyResult> {
    await deleteObjects(written);
    return { ok: false, error };
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  const storage = getStorage();
  await Promise.all(keys.map(k => storage.delete(k).catch(err => console.error('Showcase storage cleanup failed:', k, err))));
}
