import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { getStorage } from '../storage';

export const artworksRouter = Router();

const MAX_BYTES = 52_428_800; // 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

type ArtworkRow = {
  id: string; title: string; artist: string; domain: string;
  image_url: string | null; media_type: string; storage_path: string | null;
  original_filename: string | null; mime_type: string | null; file_size: number | null;
  likes: number;
};
type CommentRow = { id: string; sender: string; text: string; created_at: string };

const ALLOWED_EXT: Record<string, { mime: string; mediaType: 'image' | 'pdf' | 'video'; check: (b: Buffer) => boolean }> = {
  jpg:  { mime: 'image/jpeg',       mediaType: 'image', check: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  jpeg: { mime: 'image/jpeg',       mediaType: 'image', check: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  png:  { mime: 'image/png',        mediaType: 'image', check: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  gif:  { mime: 'image/gif',        mediaType: 'image', check: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  webp: { mime: 'image/webp',       mediaType: 'image', check: b => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  pdf:  { mime: 'application/pdf',  mediaType: 'pdf',   check: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  mp4:  { mime: 'video/mp4',        mediaType: 'video', check: b => b.length > 11 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function formatArtwork(row: ArtworkRow, likedByUser: boolean, comments: CommentRow[]) {
  const mediaUrl = row.storage_path
    ? getStorage().getPublicUrl(row.storage_path)
    : (row.image_url ?? '');

  return {
    id: row.id, title: row.title, artist: row.artist, domain: row.domain,
    mediaUrl,
    mediaType: row.media_type as 'image' | 'pdf' | 'video',
    originalFilename: row.original_filename,
    likes: row.likes,
    likedByUser,
    comments: comments.map(c => ({ id: c.id, sender: c.sender, text: c.text, date: relativeTime(c.created_at) })),
  };
}

artworksRouter.get('/', async (req, res) => {
  const roll = (req.headers['x-roll-number'] as string | undefined)?.trim().toUpperCase();
  const rows = await query<ArtworkRow>('SELECT * FROM artworks ORDER BY created_at DESC');
  const allComments = await query<CommentRow & { artwork_id: string }>(
    'SELECT id, artwork_id, sender, text, created_at FROM artwork_comments ORDER BY created_at ASC'
  );

  let likedSet = new Set<string>();
  if (roll) {
    const liked = await query<{ artwork_id: string }>('SELECT artwork_id FROM artwork_likes WHERE roll_number=$1', [roll]);
    likedSet = new Set(liked.map(r => r.artwork_id));
  }

  res.json(rows.map(r => {
    const comments = allComments.filter(c => c.artwork_id === r.id);
    return formatArtwork(r, likedSet.has(r.id), comments);
  }));
});

artworksRouter.post(
  '/',
  requireAdmin,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'File is required' }); return; }

    const file = req.file;
    const originalName = file.originalname;
    const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
    const spec = ALLOWED_EXT[ext];

    if (!spec) {
      res.status(400).json({ error: `Unsupported file type. Allowed: ${Object.keys(ALLOWED_EXT).join(', ')}` });
      return;
    }
    if (!spec.check(file.buffer)) {
      res.status(400).json({ error: 'File content does not match its extension (magic bytes mismatch)' });
      return;
    }
    if (file.size > MAX_BYTES) {
      res.status(400).json({ error: 'File exceeds 50 MB limit' });
      return;
    }

    const bodySchema = z.object({
      title:  z.string().min(1).max(200),
      artist: z.string().min(1).max(200),
      domain: z.string().min(1).max(100),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { title, artist, domain } = parsed.data;

    const safeExt = ext === 'jpeg' ? 'jpg' : ext;
    const storagePath = `gallery/${uuidv4()}.${safeExt}`;

    await getStorage().upload(storagePath, file.buffer, spec.mime);

    const id = `art-${uuidv4().slice(0, 8)}`;
    try {
      await query(
        `INSERT INTO artworks(id,title,artist,domain,media_type,storage_path,original_filename,mime_type,file_size,likes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0)`,
        [id, title, artist, domain, spec.mediaType, storagePath, originalName, spec.mime, file.size]
      );
    } catch (err) {
      await getStorage().delete(storagePath).catch(() => {});
      throw err;
    }

    const rows = await query<ArtworkRow>('SELECT * FROM artworks WHERE id=$1', [id]);
    res.status(201).json(formatArtwork(rows[0], false, []));
  }
);

artworksRouter.delete('/:id', requireAdmin, async (req, res) => {
  const rows = await query<ArtworkRow>('SELECT storage_path FROM artworks WHERE id=$1', [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Artwork not found' }); return; }

  if (rows[0].storage_path) {
    await getStorage().delete(rows[0].storage_path).catch(err => console.error('Storage delete failed:', err));
  }

  await pool.query('DELETE FROM artworks WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

artworksRouter.post('/:id/like', async (req, res) => {
  const roll = (req.headers['x-roll-number'] as string | undefined)?.trim().toUpperCase();
  if (!roll) { res.status(401).json({ error: 'Roll number required' }); return; }

  const rows = await query<{ id: string; likes: number }>('SELECT id, likes FROM artworks WHERE id=$1', [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Artwork not found' }); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM artwork_likes WHERE artwork_id=$1 AND roll_number=$2', [req.params.id, roll]);
    let likedByUser: boolean;
    if (existing.rows.length > 0) {
      await client.query('DELETE FROM artwork_likes WHERE artwork_id=$1 AND roll_number=$2', [req.params.id, roll]);
      await client.query('UPDATE artworks SET likes=GREATEST(0,likes-1) WHERE id=$1', [req.params.id]);
      likedByUser = false;
    } else {
      await client.query('INSERT INTO artwork_likes(artwork_id,roll_number) VALUES($1,$2)', [req.params.id, roll]);
      await client.query('UPDATE artworks SET likes=likes+1 WHERE id=$1', [req.params.id]);
      likedByUser = true;
    }
    await client.query('COMMIT');
    const updated = await query<{ likes: number }>('SELECT likes FROM artworks WHERE id=$1', [req.params.id]);
    res.json({ likes: updated[0].likes, likedByUser });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const commentSchema = z.object({
  sender: z.string().min(1).max(100),
  text:   z.string().min(1).max(1000),
});

artworksRouter.post('/:id/comments', async (req, res) => {
  const roll = (req.headers['x-roll-number'] as string | undefined)?.trim().toUpperCase();
  if (!roll) { res.status(401).json({ error: 'Roll number required' }); return; }

  const artwork = await query('SELECT 1 FROM artworks WHERE id=$1', [req.params.id]);
  if (artwork.length === 0) { res.status(404).json({ error: 'Artwork not found' }); return; }

  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const id = `c-${uuidv4().slice(0, 8)}`;
  await query('INSERT INTO artwork_comments(id,artwork_id,sender,text) VALUES($1,$2,$3,$4)',
    [id, req.params.id, parsed.data.sender, parsed.data.text]);
  res.status(201).json({ id, sender: parsed.data.sender, text: parsed.data.text, date: 'Just now' });
});
