import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { getStorage } from '../storage';
import { v4 as uuidv4 } from 'uuid';

export const teamRouter = Router();

const MAX_PHOTO_BYTES = 10_485_760; // 10 MB for photos

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
});

type MemberRow = {
  id: number; name: string; designation: string; year: string | null;
  bio: string | null; color: string; photo_path: string | null;
  display_order: number; social_instagram: string | null;
  social_linkedin: string | null; social_email: string | null;
};

const IMG_MAGIC: Record<string, (b: Buffer) => boolean> = {
  jpg:  b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  jpeg: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  png:  b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
  webp: b => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};
const IMG_MIMES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function formatMember(m: MemberRow) {
  return {
    id: m.id,
    name: m.name,
    designation: m.designation,
    year: m.year,
    bio: m.bio,
    color: m.color,
    photoUrl: m.photo_path ? getStorage().getPublicUrl(m.photo_path) : null,
    displayOrder: m.display_order,
    social: {
      instagram: m.social_instagram,
      linkedin: m.social_linkedin,
      email: m.social_email,
    },
  };
}

teamRouter.get('/', async (_req, res) => {
  const rows = await query<MemberRow>('SELECT * FROM team_members ORDER BY display_order ASC, id ASC');
  res.json(rows.map(formatMember));
});

const memberSchema = z.object({
  name:            z.string().min(1).max(100),
  designation:     z.string().min(1).max(100),
  year:            z.string().max(50).optional(),
  bio:             z.string().max(500).optional(),
  color:           z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#007AFF'),
  displayOrder:    z.coerce.number().int().default(0),
  socialInstagram: z.string().url().max(200).optional().or(z.literal('')),
  socialLinkedin:  z.string().url().max(200).optional().or(z.literal('')),
  socialEmail:     z.string().email().max(200).optional().or(z.literal('')),
});

teamRouter.post('/', requireAdmin, photoUpload.single('photo'), async (req, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }

  let photoPath: string | null = null;
  if (req.file) {
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const magic = IMG_MAGIC[ext];
    if (!magic || !magic(req.file.buffer)) { res.status(400).json({ error: 'Photo must be jpg, png, or webp' }); return; }
    const safeExt = ext === 'jpeg' ? 'jpg' : ext;
    photoPath = `team/${uuidv4()}.${safeExt}`;
    await getStorage().upload(photoPath, req.file.buffer, IMG_MIMES[ext]);
  }

  const { name, designation, year, bio, color, displayOrder, socialInstagram, socialLinkedin, socialEmail } = parsed.data;
  let id: number;
  try {
    const result = await pool.query(
      `INSERT INTO team_members(name,designation,year,bio,color,photo_path,display_order,social_instagram,social_linkedin,social_email)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [name, designation, year ?? null, bio ?? null, color, photoPath, displayOrder, socialInstagram ?? null, socialLinkedin ?? null, socialEmail || null]
    );
    id = (result.rows[0] as { id: number }).id;
  } catch (err) {
    if (photoPath) await getStorage().delete(photoPath).catch(() => {});
    throw err;
  }
  const rows = await query<MemberRow>('SELECT * FROM team_members WHERE id=$1', [id]);
  res.status(201).json(formatMember(rows[0]));
});

teamRouter.put('/:id', requireAdmin, photoUpload.single('photo'), async (req, res) => {
  const existing = await query<MemberRow>('SELECT * FROM team_members WHERE id=$1', [req.params.id]);
  if (existing.length === 0) { res.status(404).json({ error: 'Member not found' }); return; }

  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }

  const oldPhotoPath = existing[0].photo_path;
  let newPhotoPath: string | null = null;
  if (req.file) {
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const magic = IMG_MAGIC[ext];
    if (!magic || !magic(req.file.buffer)) { res.status(400).json({ error: 'Photo must be jpg, png, or webp' }); return; }
    const safeExt = ext === 'jpeg' ? 'jpg' : ext;
    newPhotoPath = `team/${uuidv4()}.${safeExt}`;
    await getStorage().upload(newPhotoPath, req.file.buffer, IMG_MIMES[ext]);
  }

  const photoPath = newPhotoPath ?? oldPhotoPath;
  const { name, designation, year, bio, color, displayOrder, socialInstagram, socialLinkedin, socialEmail } = parsed.data;
  try {
    await query(
      `UPDATE team_members SET name=$1,designation=$2,year=$3,bio=$4,color=$5,photo_path=$6,
       display_order=$7,social_instagram=$8,social_linkedin=$9,social_email=$10 WHERE id=$11`,
      [name, designation, year ?? null, bio ?? null, color, photoPath, displayOrder, socialInstagram ?? null, socialLinkedin ?? null, socialEmail || null, req.params.id]
    );
  } catch (err) {
    if (newPhotoPath) await getStorage().delete(newPhotoPath).catch(() => {});
    throw err;
  }
  // Delete old photo only after the UPDATE committed successfully
  if (newPhotoPath && oldPhotoPath) await getStorage().delete(oldPhotoPath).catch(() => {});
  const rows = await query<MemberRow>('SELECT * FROM team_members WHERE id=$1', [req.params.id]);
  res.json(formatMember(rows[0]));
});

teamRouter.patch('/:id/order', requireAdmin, async (req, res) => {
  const displayOrder = Number(req.body.display_order);
  if (!Number.isInteger(displayOrder)) { res.status(400).json({ error: 'display_order must be an integer' }); return; }
  const result = await pool.query(
    'UPDATE team_members SET display_order=$1 WHERE id=$2 RETURNING id',
    [displayOrder, req.params.id]
  );
  if (result.rowCount === 0) { res.status(404).json({ error: 'Member not found' }); return; }
  res.json({ success: true });
});

teamRouter.delete('/:id', requireAdmin, async (req, res) => {
  const rows = await query<MemberRow>('SELECT photo_path FROM team_members WHERE id=$1', [req.params.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Member not found' }); return; }
  if (rows[0].photo_path) await getStorage().delete(rows[0].photo_path).catch(() => {});
  await pool.query('DELETE FROM team_members WHERE id=$1', [req.params.id]);
  res.status(204).end();
});
