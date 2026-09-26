import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from './uploadLimits';

// ─────────────────────────────────────────────────────────────────────────
// Large-file uploads (asset library, gallery) — up to MAX_UPLOAD_BYTES
// (300 MB). multer streams each file to a temp file on disk instead of
// buffering it in memory (the memoryStorage these routes used before would
// hold the whole file — twice over during the storage upload — in RAM).
// Route-specific: only the routes that mount this accept large bodies; every
// other endpoint keeps its small JSON/multipart limits.
//
// Temp files are always removed when the response closes (success, error,
// or a client abort), except one a background job has claimed with
// claimTempFile() — that job then removes it itself.
// ─────────────────────────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), 'dna-uploads');

const multerDisk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(TMP_DIR, { recursive: true }, err => cb(err, TMP_DIR));
    },
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${randomUUID()}`),
  }),
  // busboy flags a file once it REACHES fileSize bytes, so the ceiling is
  // exclusive; +1 makes MAX_UPLOAD_BYTES itself allowed and MAX + 1 refused.
  limits: { fileSize: MAX_UPLOAD_BYTES + 1 },
});

export const LIMIT_MESSAGE = `File exceeds the ${MAX_UPLOAD_LABEL} limit`;

type ClaimableRequest = Request & { claimedTempFiles?: Set<string> };

function uploadedFiles(req: Request): Express.Multer.File[] {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files) for (const list of Object.values(req.files)) files.push(...list);
  return files;
}

export function removeTempFile(filePath: string): void {
  fs.promises.unlink(filePath).catch(() => { /* already gone */ });
}

// Wraps a multer middleware so size violations become a JSON 413 (both
// `error` and `message` keys — the asset routes use the first, the gallery
// routes the second) and temp files are cleaned up after the response.
function withCleanup(mw: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('close', () => {
      const claimed = (req as ClaimableRequest).claimedTempFiles;
      for (const f of uploadedFiles(req)) if (!claimed?.has(f.path)) removeTempFile(f.path);
    });
    mw(req, res, err => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: LIMIT_MESSAGE, message: LIMIT_MESSAGE });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message, message: err.message });
      }
      next(err);
    });
  };
}

export const diskUploadSingle = (field: string): RequestHandler => withCleanup(multerDisk.single(field));
export const diskUploadFields = (fields: multer.Field[]): RequestHandler => withCleanup(multerDisk.fields(fields));

// Keeps a temp file past the response for a background job (the image
// thumbnail). The caller must removeTempFile() it when the job settles.
export function claimTempFile(req: Request, filePath: string): void {
  const r = req as ClaimableRequest;
  (r.claimedTempFiles ??= new Set()).add(filePath);
}

// The first bytes of a file — for magic-number checks without reading the
// whole (up to 300 MB) file.
export async function readFileHead(filePath: string, bytes = 16): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
