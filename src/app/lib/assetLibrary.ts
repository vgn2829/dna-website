import type { Asset, AssetKind } from './api';

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers for the Workspace Asset Library UI (components/assets/*).
// Kept free of React so they're unit-testable under the node-only vitest
// config. The size/extension rules mirror backend/src/routes/assets.ts —
// the server re-validates everything; these only give instant feedback.
// ─────────────────────────────────────────────────────────────────────────

// Inline-previewable, board-insertable images — the original allowlist.
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const FILE_MAX_BYTES = 25 * 1024 * 1024;

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Same rule as the backend's fileExtension(): last dot-segment, lowercase,
// [a-z0-9]{1,12}. Not an allowlist of formats — any such extension works.
export function fileExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : null;
}

export type UploadPlan =
  | { ok: true; kind: 'image' | 'file' }
  | { ok: false; error: string };

// Decides how a picked/dropped file will be uploaded: allowlisted images
// go through the original image path (previewable, insertable onto
// boards); everything else is a general library file.
export function classifyUpload(file: { name: string; type: string; size: number }): UploadPlan {
  if (IMAGE_MIME.includes(file.type)) {
    if (file.size > IMAGE_MAX_BYTES) return { ok: false, error: `${file.name} is larger than the ${formatSize(IMAGE_MAX_BYTES)} image limit.` };
    return { ok: true, kind: 'image' };
  }
  if (!fileExtension(file.name)) return { ok: false, error: `${file.name} needs a file extension (e.g. .psd, .pdf, .zip).` };
  if (file.size > FILE_MAX_BYTES) return { ok: false, error: `${file.name} is larger than the ${formatSize(FILE_MAX_BYTES)} file limit.` };
  return { ok: true, kind: 'file' };
}

// Visual grouping for a file card's icon/label only — never a restriction
// (unknown extensions simply fall into 'other').
export type FileFamily = 'design' | 'document' | 'slides' | 'archive' | 'image' | 'video' | 'audio' | 'font' | 'other';

const FAMILY_BY_EXT: Record<string, FileFamily> = {
  psd: 'design', ai: 'design', eps: 'design', xd: 'design', fig: 'design', sketch: 'design', indd: 'design', afdesign: 'design', blend: 'design', c4d: 'design', aep: 'design', prproj: 'design',
  pdf: 'document', doc: 'document', docx: 'document', txt: 'document', md: 'document', rtf: 'document', pages: 'document', xls: 'document', xlsx: 'document', csv: 'document',
  ppt: 'slides', pptx: 'slides', key: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', tif: 'image', tiff: 'image', heic: 'image', raw: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', flac: 'audio',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
};

export function fileFamily(extension: string | null | undefined): FileFamily {
  return (extension && FAMILY_BY_EXT[extension.toLowerCase()]) || 'other';
}

export const FAMILY_LABEL: Record<FileFamily, string> = {
  design: 'Design file', document: 'Document', slides: 'Presentation', archive: 'Archive',
  image: 'Image file', video: 'Video', audio: 'Audio', font: 'Font', other: 'File',
};

export const KIND_LABEL: Record<AssetKind, string> = { image: 'Image', file: 'File' };

// Secondary line under an asset card's name, e.g. "PSD · 2.4 MB".
export function assetMetaLine(asset: Pick<Asset, 'kind' | 'extension' | 'size_bytes' | 'width' | 'height'>): string {
  const parts: string[] = [];
  if (asset.extension) parts.push(asset.extension.toUpperCase());
  if (asset.kind === 'image' && asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  const size = formatSize(asset.size_bytes);
  if (size) parts.push(size);
  return parts.join(' · ');
}
