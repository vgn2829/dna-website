import { describe, expect, it } from 'vitest';
import {
  ADD_TO_MOODBOARD_ERROR, PDF_PREVIEW_MAX_BYTES, assetDownloadHref, assetPreviewMode, canAddToMoodboard,
  classifyAddToMoodboardError, moodboardBlocker, opensPreview, orderMoodboardTargets,
} from './assetPreview';

const desktop = { isMobile: false, pdfViewerEnabled: true };
const image = { kind: 'image' as const, url: 'https://cdn/x.png', extension: 'png', size_bytes: 1000 };
const pdf = { kind: 'file' as const, url: 'https://cdn/brief.pdf?download=brief.pdf', extension: 'pdf', size_bytes: 2_000_000 };

describe('opensPreview', () => {
  it('images and files open the preview; links keep opening the URL', () => {
    expect(opensPreview({ kind: 'image', url: 'https://cdn/x.png' })).toBe(true);
    expect(opensPreview({ kind: 'file', url: 'https://cdn/x.zip' })).toBe(true);
    expect(opensPreview({ kind: 'link', url: null })).toBe(false);
    expect(opensPreview({ kind: 'file', url: null })).toBe(false);
  });
});

describe('assetPreviewMode', () => {
  it('images preview directly', () => {
    expect(assetPreviewMode(image, desktop)).toBe('image');
    expect(assetPreviewMode(image, { isMobile: true, pdfViewerEnabled: false })).toBe('image');
  });

  it('PDFs embed on desktop when the browser has a PDF viewer', () => {
    expect(assetPreviewMode(pdf, desktop)).toBe('pdf');
    expect(assetPreviewMode({ ...pdf, size_bytes: PDF_PREVIEW_MAX_BYTES }, desktop)).toBe('pdf');
  });

  it('PDFs fall back on phones, without a viewer, when too large or of unknown size', () => {
    expect(assetPreviewMode(pdf, { isMobile: true, pdfViewerEnabled: true })).toBe('fallback');
    expect(assetPreviewMode(pdf, { isMobile: false, pdfViewerEnabled: false })).toBe('fallback');
    expect(assetPreviewMode({ ...pdf, size_bytes: PDF_PREVIEW_MAX_BYTES + 1 }, desktop)).toBe('fallback');
    expect(assetPreviewMode({ ...pdf, size_bytes: null }, desktop)).toBe('fallback');
  });

  it('other files (ZIP, DOCX, PPTX, PSD…) use the fallback', () => {
    for (const extension of ['zip', 'docx', 'pptx', 'psd', 'mp4', null]) {
      expect(assetPreviewMode({ ...pdf, extension }, desktop)).toBe('fallback');
    }
  });

  it('anything without a stored object falls back', () => {
    expect(assetPreviewMode({ ...image, url: null }, desktop)).toBe('fallback');
  });
});

describe('assetDownloadHref', () => {
  it('prefers the attachment URL and falls back to the original', () => {
    expect(assetDownloadHref({ url: 'https://cdn/x.png', download_url: 'https://cdn/x.png?download=x.png' })).toBe('https://cdn/x.png?download=x.png');
    expect(assetDownloadHref({ url: 'https://cdn/x.png' })).toBe('https://cdn/x.png');
    expect(assetDownloadHref({ url: 'https://cdn/x.png', download_url: null })).toBe('https://cdn/x.png');
  });
});

describe('canAddToMoodboard', () => {
  it('only images can go on a moodboard', () => {
    expect(canAddToMoodboard({ kind: 'image', url: 'https://cdn/x.png' })).toBe(true);
    expect(canAddToMoodboard({ kind: 'file', url: 'https://cdn/x.pdf' })).toBe(false);
    expect(canAddToMoodboard({ kind: 'link', url: null })).toBe(false);
    expect(canAddToMoodboard({ kind: 'image', url: null })).toBe(false);
  });
});

describe('moodboard targets', () => {
  const boards = [
    { id: 'team-1', workspace_id: 'team' },
    { id: 'mine-1', workspace_id: 'p-me' },
    { id: 'team-2', workspace_id: 'team' },
    { id: 'mine-2', workspace_id: 'p-me' },
  ];

  it('a Personal asset is blocked from boards outside its own workspace', () => {
    const asset = { visibility: 'personal' as const, workspace_id: 'p-me' };
    expect(moodboardBlocker(asset, { workspace_id: 'p-me' })).toBeNull();
    expect(moodboardBlocker(asset, { workspace_id: 'team' })).toBe('personal-elsewhere');
    expect(orderMoodboardTargets(asset, boards).map(b => b.id)).toEqual(['mine-1', 'mine-2', 'team-1', 'team-2']);
  });

  it('Workspace and Community assets are left to the server', () => {
    for (const visibility of ['workspace', 'community'] as const) {
      const asset = { visibility, workspace_id: 'p-me' };
      expect(moodboardBlocker(asset, { workspace_id: 'team' })).toBeNull();
      expect(orderMoodboardTargets(asset, boards).map(b => b.id)).toEqual(['team-1', 'mine-1', 'team-2', 'mine-2']);
    }
  });
});

describe('classifyAddToMoodboardError', () => {
  it('maps server errors to clear messages', () => {
    expect(classifyAddToMoodboardError(new Error('SESSION_EXPIRED'))).toBe('session');
    expect(classifyAddToMoodboardError(new Error('Access denied'))).toBe('no-edit');
    expect(classifyAddToMoodboardError(new Error('Asset not available on this board'))).toBe('unavailable');
    expect(classifyAddToMoodboardError(new Error('Board not found'))).toBe('unavailable');
    expect(classifyAddToMoodboardError(new Error('Internal server error'))).toBe('other');
    expect(classifyAddToMoodboardError(new TypeError('Failed to fetch'))).toBe('other');
    expect(classifyAddToMoodboardError('weird')).toBe('other');
    for (const message of Object.values(ADD_TO_MOODBOARD_ERROR)) expect(message.length).toBeGreaterThan(0);
  });
});
