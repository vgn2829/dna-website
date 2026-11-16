import { describe, expect, it } from 'vitest';
import type { InspirationAsset, InspirationItem } from './api';
import {
  boardBlocker, hasActiveFilters, isAcceptableReferenceUrl, itemOpenHref, itemPreviewSrc,
  itemSourceLabel, moodboardPlan, parseTagInput,
} from './inspiration';

const asset = (over: Partial<InspirationAsset> = {}): InspirationAsset => ({
  id: 'a1', kind: 'image', filename: 'p.png', url: 'https://cdn/x/p.png', thumb_url: 'https://cdn/x/p-t.webp',
  width: 10, height: 10, visibility: 'personal', extension: 'png', link_url: null, workspace_id: 'ws1', ...over,
});
const item = (over: Partial<InspirationItem> = {}): InspirationItem => ({
  id: 'i1', kind: 'link', title: 'T', description: null, category: null, tags: [], url: 'https://www.behance.net/g/1',
  image_url: null, asset: null, unavailable: false, collection_ids: [], created_at: '', updated_at: '', ...over,
});

describe('parseTagInput', () => {
  it('splits, lower-cases, strips #, hyphenates, de-duplicates and drops junk', () => {
    expect(parseTagInput('#Retro, hand lettered\nretro, <b>, , x'.concat(', ', 'y'.repeat(40)))).toEqual(['retro', 'hand-lettered', 'x']);
  });
  it('caps at 10 tags', () => {
    expect(parseTagInput(Array.from({ length: 15 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
  });
});

describe('isAcceptableReferenceUrl', () => {
  it.each(['https://www.behance.net/gallery/1', 'http://example.com/a'])('accepts %s', u => expect(isAcceptableReferenceUrl(u)).toBe(true));
  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'https://u:p@x.com', 'http://localhost', 'http://127.0.0.1', 'http://10.1.1.1', 'http://192.168.0.2', 'http://[::1]', 'http://2130706433', 'http://intranet/', 'https://nas.local', '', 'nope'])('rejects %s', u => expect(isAcceptableReferenceUrl(u)).toBe(false));
  it('can require https for images', () => {
    expect(isAcceptableReferenceUrl('http://example.com/a.jpg', true)).toBe(false);
    expect(isAcceptableReferenceUrl('https://example.com/a.jpg', true)).toBe(true);
  });
});

describe('preview / open / source', () => {
  it('uses the asset thumbnail, never anything for an unavailable asset', () => {
    const it1 = item({ kind: 'asset', url: null, asset: asset() });
    expect(itemPreviewSrc(it1)).toBe('https://cdn/x/p-t.webp');
    expect(itemOpenHref(it1)).toBe('https://cdn/x/p.png');
    const gone = item({ kind: 'asset', url: null, asset: null, unavailable: true, image_url: 'https://x.com/a.jpg' });
    expect(itemPreviewSrc(gone)).toBeNull();
    expect(itemOpenHref(gone)).toBeNull();
  });
  it('uses the supplied https image for links and the link itself to open', () => {
    const l = item({ image_url: 'https://cdn.example.com/c.jpg' });
    expect(itemPreviewSrc(l)).toBe('https://cdn.example.com/c.jpg');
    expect(itemOpenHref(l)).toBe('https://www.behance.net/g/1');
  });
  it('labels external references distinctly from library assets', () => {
    expect(itemSourceLabel(item())).toBe('Behance');
    expect(itemSourceLabel(item({ kind: 'asset', url: null, asset: asset() }))).toBe('Asset Library · PNG');
    expect(itemSourceLabel(item({ kind: 'asset', url: null, asset: null, unavailable: true }))).toBe('Asset Library');
  });
  it('a library file (non-image) previews as nothing', () => {
    expect(itemPreviewSrc(item({ kind: 'asset', url: null, asset: asset({ kind: 'file', extension: 'psd' }) }))).toBeNull();
  });
});

describe('moodboardPlan', () => {
  it('places library images by asset id so the server re-checks access', () => {
    expect(moodboardPlan(item({ kind: 'asset', url: null, asset: asset() }))).toEqual({ type: 'asset', assetId: 'a1' });
  });
  it('places a link only when it has an https image, with the page as source', () => {
    expect(moodboardPlan(item())).toBeNull();
    expect(moodboardPlan(item({ image_url: 'https://cdn.example.com/c.jpg', title: 'Case' }))).toEqual({
      type: 'image-link', imageUrl: 'https://cdn.example.com/c.jpg', sourceUrl: 'https://www.behance.net/g/1', note: 'Case',
    });
  });
  it('never places files, link assets or unavailable assets', () => {
    expect(moodboardPlan(item({ kind: 'asset', url: null, asset: asset({ kind: 'file' }) }))).toBeNull();
    expect(moodboardPlan(item({ kind: 'asset', url: null, asset: asset({ kind: 'link', url: null, link_url: 'https://x.com' }) }))).toBeNull();
    expect(moodboardPlan(item({ kind: 'asset', url: null, asset: null, unavailable: true }))).toBeNull();
  });
  it('blocks a Personal asset on boards outside its own workspace only', () => {
    const it1 = item({ kind: 'asset', url: null, asset: asset() });
    expect(boardBlocker(it1, { workspace_id: 'other' })).toBe('personal-elsewhere');
    expect(boardBlocker(it1, { workspace_id: 'ws1' })).toBeNull();
    expect(boardBlocker(item(), { workspace_id: 'other' })).toBeNull();
  });
});

describe('hasActiveFilters', () => {
  it('is true for any narrowing filter', () => {
    expect(hasActiveFilters({ q: '', tags: [], category: '', kind: '' })).toBe(false);
    expect(hasActiveFilters({ q: ' ', tags: [], category: '', kind: '' })).toBe(false);
    expect(hasActiveFilters({ q: 'x', tags: [], category: '', kind: '' })).toBe(true);
    expect(hasActiveFilters({ q: '', tags: ['a'], category: '', kind: '' })).toBe(true);
    expect(hasActiveFilters({ q: '', tags: [], category: 'color', kind: '' })).toBe(true);
  });
});
