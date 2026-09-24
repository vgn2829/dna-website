import { describe, it, expect } from 'vitest';
import { assetMetaLine, classifyUpload, fileExtension, fileFamily, formatSize, displayUrl, isAcceptableLinkUrl, linkDomain, linkSource, FILE_MAX_BYTES, IMAGE_MAX_BYTES } from './assetLibrary';

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
  it('enforces 15MB for images and 25MB for files', () => {
    expect(classifyUpload({ name: 'a.png', type: 'image/png', size: IMAGE_MAX_BYTES + 1 }).ok).toBe(false);
    expect(classifyUpload({ name: 'a.zip', type: 'application/zip', size: 20 * 1024 * 1024 }).ok).toBe(true);
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
