/**
 * One-time backfill: generate 400px webp thumbnails for all image artworks
 * that were uploaded before server-side thumbnailing was added.
 *
 * Safe to re-run — skips any row that already has cover_url set.
 *
 * Usage:
 *   cd backend
 *   npm run backfill:thumbs
 *
 * Run ONCE against production AFTER deploying the thumbnail feature.
 * Back up or snapshot your DB/storage before running on production.
 */

import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { pool, query } from '../src/db/client';
import { getStorage } from '../src/storage';

type ArtworkStub = { id: string; storage_path: string };

async function main() {
  const rows = await query<ArtworkStub>(
    `SELECT id, storage_path FROM artworks
     WHERE media_type = 'image' AND cover_url IS NULL
     ORDER BY created_at ASC`
  );

  const total = rows.length;
  if (total === 0) {
    console.log('Nothing to backfill — all image artworks already have thumbnails.');
    await pool.end();
    return;
  }

  console.log(`Backfilling thumbnails for ${total} image(s)…\n`);

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    const n = done + failed + 1;
    try {
      const publicUrl = getStorage().getPublicUrl(row.storage_path);
      const res = await fetch(publicUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${row.storage_path}`);

      const buffer = Buffer.from(await res.arrayBuffer());

      const thumbBuffer = await sharp(buffer)
        .resize({ width: 400, withoutEnlargement: true })
        .webp({ quality: 60 })
        .toBuffer();

      const thumbPath = `thumbs/${uuidv4()}.webp`;
      await getStorage().upload(thumbPath, thumbBuffer, 'image/webp');
      const thumbUrl = getStorage().getPublicUrl(thumbPath);

      await pool.query('UPDATE artworks SET cover_url = $1 WHERE id = $2', [thumbUrl, row.id]);

      done++;
      console.log(`[${n}/${total}] OK  ${row.id}  →  ${thumbPath}`);
    } catch (e) {
      failed++;
      console.error(`[${n}/${total}] ERR ${row.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nBackfill complete. ${done} succeeded, ${failed} failed.`);
  if (failed > 0) {
    console.log('Re-run the script to retry failed rows (it skips already-thumbnailed rows).');
  }

  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
