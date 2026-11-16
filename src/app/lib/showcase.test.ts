import { describe, expect, it } from 'vitest';
import { adminActions, creditLine, hasFilters, isPublicLink, ownerActions, parseTags, previewCredits, STATUS_INFO, topicLine } from './showcase';
import type { ShowcaseStatus } from './api';

const ALL: ShowcaseStatus[] = ['draft', 'submitted', 'changes_requested', 'approved', 'published', 'rejected', 'archived'];

describe('status presentation', () => {
  it('describes every status', () => { for (const s of ALL) expect(STATUS_INFO[s].label).toBeTruthy(); });
});

describe('ownerActions', () => {
  it('never offers a student approve/publish/reject, and freezes approved work', () => {
    for (const s of ALL) for (const a of ownerActions(s)) expect(['submit', 'withdraw', 'archive', 'reopen', 'delete']).toContain(a);
    expect(ownerActions('approved')).toEqual([]);
  });
  it('allows submit from draft and changes_requested, withdraw while in review, archive when published', () => {
    expect(ownerActions('draft')).toContain('submit');
    expect(ownerActions('changes_requested')).toContain('submit');
    expect(ownerActions('submitted')).toEqual(['withdraw']);
    expect(ownerActions('published')).toEqual(['archive']);
    expect(ownerActions('published')).not.toContain('delete');
  });
});

describe('adminActions', () => {
  it('requires a reason for changes and rejection only', () => {
    const sub = adminActions('submitted');
    expect(sub.filter(a => a.needsReason).map(a => a.to).sort()).toEqual(['changes_requested', 'rejected']);
    expect(sub.find(a => a.to === 'approved')?.needsReason).toBe(false);
  });
  it('offers publish only after approval, never from submitted', () => {
    expect(adminActions('approved').some(a => a.to === 'published')).toBe(true);
    expect(adminActions('submitted').some(a => a.to === 'published')).toBe(false);
    expect(adminActions('draft')).toEqual([]);
  });
});

describe('previewCredits', () => {
  it('shows only accepted credits', () => {
    const credits = [
      { id: '1', roll: 'A', roleLabel: 'Creator', contribution: null, displayName: 'Asha', status: 'accepted' as const, isOwner: true },
      { id: '2', roll: 'B', roleLabel: 'Illustrator', contribution: null, displayName: null, status: 'pending' as const, isOwner: false },
      { id: '3', roll: 'C', roleLabel: null, contribution: null, displayName: 'Chitra', status: 'declined' as const, isOwner: false },
    ];
    expect(previewCredits({ credits })).toEqual([{ displayName: 'Asha', roleLabel: 'Creator', isOwner: true }]);
  });
});

describe('topicLine', () => {
  it('does not repeat a discipline that matches the category', () => {
    expect(topicLine('illustration', [{ title: 'Illustration' }, { title: 'UI/UX' }])).toBe('Illustration · UI/UX');
    expect(topicLine(null, [{ title: 'Motion' }])).toBe('Motion');
    expect(topicLine('branding', [])).toBe('Branding');
    expect(topicLine(null, [])).toBe('');
  });
});

describe('helpers', () => {
  it('parses tags', () => { expect(parseTags('#Retro, hand lettered, retro, <b>')).toEqual(['retro', 'hand-lettered']); });
  it('mirrors the public-link rules', () => {
    expect(isPublicLink('https://www.behance.net/g/1')).toBe(true);
    for (const u of ['javascript:1', 'http://localhost', 'http://10.0.0.1', 'https://u:p@x.com', 'ftp://x.com', 'http://intranet/', 'nope']) expect(isPublicLink(u)).toBe(false);
  });
  it('formats credit lines', () => {
    expect(creditLine([{ displayName: 'A' }, { displayName: 'B' }])).toBe('A, B');
    expect(creditLine([{ displayName: 'A' }, { displayName: 'B' }, { displayName: 'C' }, { displayName: 'D' }])).toBe('A, B +2');
    expect(creditLine([{ displayName: null }])).toBe('');
  });
  it('detects active filters', () => {
    expect(hasFilters({ q: ' ', category: '', discipline: '', tags: [], featured: false })).toBe(false);
    expect(hasFilters({ q: '', category: '', discipline: '', tags: [], featured: true })).toBe(true);
  });
});
