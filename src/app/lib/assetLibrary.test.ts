import { describe, it, expect } from 'vitest';
import { assetPreviewFallback, assetPreviewSrc, assetMetaLine, classifyUpload, describeUploadFailure, fileExtension, fileFamily, formatSize, displayUrl, isAcceptableLinkUrl, linkDomain, linkSource, newClientUploadId, planUploadBatch, FAMILY_LABEL, MAX_AUTO_RESUME_SECONDS, FILE_MAX_BYTES, IMAGE_MAX_BYTES } from './assetLibrary';

describe('classifyUpload', () => {
  it('routes allowlisted images through the image path', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
      expect(classifyUpload({ name: 'a.x', type, size: 10 })).toEqual({ ok: true, kind: 'image' });
    }
  });
  it('treats design files, documents and archives as general files', () => {
    for (const name of ['kit.psd', 'logo.ai', 'mark.eps', 'flow.xd', 'ui.fig', 'guide.pdf', 'deck.pptx', 'brief.docx', 'pack.zip']) {
      expect(classifyUpload({ name, type: '', size: 10 })).toEqual({ ok: true, kind: 'file' });
    }
  });
  it('accepts arbitrary extensions rather than a finite list', () => {
    expect(classifyUpload({ name: 'scene.blend', type: 'application/x-blender', size: 10 })).toEqual({ ok: true, kind: 'file' });
  });
  it('rejects a file without an extension', () => {
    expect(classifyUpload({ name: 'README', type: 'text/plain', size: 10 }).ok).toBe(false);
  });
  it('enforces the one shared 300 MB limit for images and files', () => {
    expect(IMAGE_MAX_BYTES).toBe(300 * 1024 * 1024);
    expect(classifyUpload({ name: 'a.png', type: 'image/png', size: IMAGE_MAX_BYTES }).ok).toBe(true);
    expect(classifyUpload({ name: 'a.png', type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).toEqual({ ok: false, error: 'a.png is larger than the 300 MB maximum file size.' });
    expect(classifyUpload({ name: 'a.zip', type: 'application/zip', size: 20 * 1024 * 1024 }).ok).toBe(true);
    expect(FILE_MAX_BYTES).toBe(300 * 1024 * 1024);
    expect(classifyUpload({ name: 'a.zip', type: 'application/zip', size: FILE_MAX_BYTES }).ok).toBe(true);
    expect(classifyUpload({ name: 'a.zip', type: 'application/zip', size: FILE_MAX_BYTES + 1 }).ok).toBe(false);
  });
});

describe('fileExtension', () => {
  it('matches the backend rule', () => {
    expect(fileExtension('Brand Kit.PSD')).toBe('psd');
    expect(fileExtension('.env')).toBeNull();
    expect(fileExtension('x.ps d')).toBeNull();
  });
});

describe('fileFamily', () => {
  it('groups known extensions and falls back to other', () => {
    expect(fileFamily('PSD')).toBe('design');
    expect(fileFamily('pdf')).toBe('document');
    expect(fileFamily('pptx')).toBe('slides');
    expect(fileFamily('zip')).toBe('archive');
    expect(fileFamily('weird')).toBe('other');
    expect(fileFamily(null)).toBe('other');
  });
});

describe('assetMetaLine / formatSize', () => {
  it('describes files and images compactly', () => {
    expect(assetMetaLine({ kind: 'file', extension: 'psd', size_bytes: 2.4 * 1024 * 1024, width: null, height: null })).toBe('PSD · 2.4 MB');
    expect(assetMetaLine({ kind: 'image', extension: 'png', size_bytes: 5000, width: 640, height: 400 })).toBe('PNG · 640×400 · 5 KB');
  });
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(null)).toBe('');
  });
});

describe('link helpers', () => {
  it('extracts a display domain', () => {
    expect(linkDomain('https://www.behance.net/gallery/1')).toBe('behance.net');
    expect(linkDomain('not a url')).toBeNull();
  });
  it('names well-known sources and falls back to the domain', () => {
    expect(linkSource('https://elements.envato.com/t-shirt-mockup')).toBe('Envato');
    expect(linkSource('https://www.figma.com/community/file/1')).toBe('Figma');
    expect(linkSource('https://dribbble.com/shots/1')).toBe('Dribbble');
    expect(linkSource('https://in.pinterest.com/pin/1')).toBe('Pinterest');
    expect(linkSource('https://drive.google.com/file/d/1')).toBe('Google Drive');
    expect(linkSource('https://notfigma.com.evil.io/x')).toBe('notfigma.com.evil.io');
    expect(linkSource('https://example.org/x')).toBe('example.org');
  });
  it('formats a URL for display', () => {
    expect(displayUrl('https://www.figma.com/community/file/1/')).toBe('figma.com/community/file/1');
    expect(displayUrl(null)).toBeNull();
  });
  it('accepts only absolute http(s) URLs without credentials', () => {
    expect(isAcceptableLinkUrl('https://figma.com/file/1')).toBe(true);
    expect(isAcceptableLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isAcceptableLinkUrl('figma.com/file')).toBe(false);
    expect(isAcceptableLinkUrl('https://a:b@x.com')).toBe(false);
  });
});

// V3.2.4 — AssetPreview (Assets cards AND Home's Recent Assets, which
// render the same component) loads assetPreviewSrc(asset) and, on error,
// assetPreviewFallback(asset, failedSrc).
describe('asset preview thumbnails', () => {
  const ORIGINAL = 'https://cdn.test/assets/ws/a.jpg';
  const THUMB = 'https://cdn.test/derived/assets/ws/a.jpg/t512.webp';
  it('uses the thumbnail when the server provides one', () => {
    expect(assetPreviewSrc({ kind: 'image', url: ORIGINAL, thumb_url: THUMB })).toBe(THUMB);
  });
  it('falls back to the original when there is no ready thumbnail (null, missing field, empty)', () => {
    expect(assetPreviewSrc({ kind: 'image', url: ORIGINAL, thumb_url: null })).toBe(ORIGINAL);
    expect(assetPreviewSrc({ kind: 'image', url: ORIGINAL })).toBe(ORIGINAL);
    expect(assetPreviewSrc({ kind: 'image', url: ORIGINAL, thumb_url: '' })).toBe(ORIGINAL);
  });
  it('never renders a preview image for files and links, or an image with no url', () => {
    expect(assetPreviewSrc({ kind: 'file', url: 'https://cdn.test/assets/ws/d.pdf', thumb_url: null })).toBeNull();
    expect(assetPreviewSrc({ kind: 'link', url: null, thumb_url: null })).toBeNull();
    expect(assetPreviewSrc({ kind: 'image', url: null, thumb_url: null })).toBeNull();
  });
  it('a failed thumbnail load retries with the original, once; a failed original does not loop', () => {
    expect(assetPreviewFallback({ url: ORIGINAL, thumb_url: THUMB }, THUMB)).toBe(ORIGINAL);
    expect(assetPreviewFallback({ url: ORIGINAL, thumb_url: THUMB }, ORIGINAL)).toBeNull();
    expect(assetPreviewFallback({ url: ORIGINAL, thumb_url: null }, ORIGINAL)).toBeNull();
    expect(assetPreviewFallback({ url: ORIGINAL, thumb_url: ORIGINAL }, ORIGINAL)).toBeNull();
  });
});

describe('upload queue planning', () => {
  const MB = 1024 * 1024;
  it('refuses oversized, empty and extensionless files up front — they never enter the queue — and keeps the rest in order', () => {
    const files = [
      { name: 'ok.png', type: 'image/png', size: 5 * MB },
      { name: 'huge.zip', type: 'application/zip', size: 300 * MB + 1 },
      { name: 'noext', type: '', size: 10 },
      { name: 'exact.zip', type: 'application/zip', size: 300 * MB },
      { name: 'DSC09876.ARW', type: 'image/x-sony-arw', size: 22 * MB },
      { name: 'placeholder.png', type: 'image/png', size: 0 },
    ];
    const { accepted, rejected } = planUploadBatch(files);
    expect(accepted.map(a => [a.file.name, a.kind])).toEqual([['ok.png', 'image'], ['exact.zip', 'file'], ['DSC09876.ARW', 'file']]);
    expect(rejected).toEqual([
      { name: 'huge.zip', reason: 'huge.zip is larger than the 300 MB maximum file size.' },
      { name: 'noext', reason: 'noext needs a file extension (e.g. .psd, .pdf, .zip).' },
      { name: 'placeholder.png', reason: 'placeholder.png is empty (0 bytes).' },
    ]);
  });
  it('makes idempotency keys the server accepts, unique per file', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newClientUploadId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('describeUploadFailure', () => {
  it('never surfaces the browser\'s raw "Load failed": a lost connection is explained and retryable', () => {
    const f = describeUploadFailure({ type: 'network' });
    expect(f.retryable).toBe(true);
    expect(f.message).toMatch(/connection to the server was lost/);
    expect(f.message).not.toMatch(/load failed|failed to fetch/i);
    expect(f.message).toContain('Retry sends the file again');
    expect(describeUploadFailure({ type: 'timeout' }).retryable).toBe(true);
  });
  it('treats a proxy error page (non-JSON 502/503) as a temporary, retryable outage', () => {
    for (const status of [502, 503, 504]) {
      const f = describeUploadFailure({ type: 'http', status, body: '<html><h1>Bad Gateway</h1></html>' });
      expect(f).toEqual({ message: `The server is temporarily unavailable (HTTP ${status}). Retry in a moment.`, retryable: true });
    }
  });
  it('passes the server\'s own reason through, retryable only when retrying can help', () => {
    expect(describeUploadFailure({ type: 'http', status: 413, body: '{"error":"File exceeds the 300 MB limit"}' }))
      .toEqual({ message: 'File exceeds the 300 MB limit', retryable: false });
    expect(describeUploadFailure({ type: 'http', status: 413, body: '' }))
      .toEqual({ message: 'This file is larger than the 300 MB maximum file size.', retryable: false });
    expect(describeUploadFailure({ type: 'http', status: 403, body: '{"error":"Not a member of that workspace"}' }))
      .toEqual({ message: 'Not a member of that workspace', retryable: false });
    expect(describeUploadFailure({ type: 'http', status: 500, body: '{"error":"Internal server error"}' }))
      .toEqual({ message: 'Internal server error (HTTP 500). Retry in a moment.', retryable: true });
    expect(describeUploadFailure({ type: 'http', status: 429, body: '{"error":"Too many uploads — please slow down"}' }).retryable).toBe(true);
  });
  it('a rate limit with Retry-After pauses and resumes automatically; without one (or too long) it asks for a manual retry', () => {
    expect(describeUploadFailure({ type: 'http', status: 429, body: '{"error":"Too many uploads — please slow down"}', retryAfterSeconds: 42 }))
      .toEqual({ message: 'Upload limit reached — resuming automatically in about 42 s.', retryable: true, retryAfterSeconds: 42 });
    for (const retryAfterSeconds of [undefined, 0, MAX_AUTO_RESUME_SECONDS + 1]) {
      expect(describeUploadFailure({ type: 'http', status: 429, body: '', retryAfterSeconds }))
        .toEqual({ message: 'Too many uploads in a short time. Wait a minute, then retry.', retryable: true });
    }
  });
  it('flags an expired session instead of offering a retry that cannot work', () => {
    expect(describeUploadFailure({ type: 'http', status: 401, body: '{"error":"Sign in required"}' }))
      .toEqual({ message: 'Your session has expired. Sign in again, then retry.', retryable: false, sessionExpired: true });
  });
});

describe('camera RAW files', () => {
  it('are a RAW image family (a file tile, never an image preview)', () => {
    for (const ext of ['arw', 'ARW', 'cr2', 'cr3', 'nef', 'dng', 'raf', 'rw2', 'orf', 'raw']) expect(fileFamily(ext), ext).toBe('raw');
    expect(FAMILY_LABEL.raw).toBe('RAW image');
    expect(assetPreviewSrc({ kind: 'file', url: 'https://x/a.arw', thumb_url: null })).toBeNull();
  });
});
