import { describe, expect, it } from 'vitest';
import type { CreatorCard } from './api';
import { bylineParts, bylineText, categoryLabel, hasCreatorFilters, initials, mergeCards, profilePath, projectCountLabel, showsProjects } from './creators';

const card = (handle: string): CreatorCard => ({ handle, displayName: handle, headline: null, bio: null, avatarUrl: null, verified: false, featured: false, skills: [], disciplines: [], projectCount: 0, projects: [] });

describe('initials', () => {
  it('uses first and last name initials', () => {
    expect(initials('Asha Rao')).toBe('AR');
    expect(initials('  bala   k   iyer ')).toBe('BI');
    expect(initials('Dev')).toBe('D');
    expect(initials('')).toBe('?');
  });
});

describe('paths and labels', () => {
  it('builds safe profile paths', () => {
    expect(profilePath('asha-draws')).toBe('/designers/asha-draws');
    expect(profilePath('a/b')).toBe('/designers/a%2Fb');
  });
  it('labels categories and counts', () => {
    expect(categoryLabel('ui-ux')).toBe('UI / UX');
    expect(categoryLabel('weird')).toBe('weird');
    expect(categoryLabel(null)).toBeNull();
    expect(projectCountLabel(0)).toBe(''); expect(projectCountLabel(1)).toBe('1 project'); expect(projectCountLabel(3)).toBe('3 projects');
  });
  it('detects filters and project capability', () => {
    expect(hasCreatorFilters({ q: ' ', discipline: '', skill: '', category: '' })).toBe(false);
    expect(hasCreatorFilters({ q: '', discipline: 'illus', skill: '', category: '' })).toBe(true);
    expect(showsProjects(null)).toBe(false);
    expect(showsProjects({ profiles: true, projects: false, artworkCredits: true })).toBe(false);
    expect(showsProjects({ profiles: true, projects: true, artworkCredits: true })).toBe(true);
  });
});

describe('bylineParts (Gallery credits)', () => {
  it('prefers accepted credits and links only linkable ones', () => {
    const parts = bylineParts({ artist: 'Legacy Name', credits: [
      { displayName: 'Asha Rao', handle: 'asha-draws', role: 'creator', roleLabel: null, isPrimary: true, verified: true },
      { displayName: 'Bala Iyer', handle: null, role: 'contributor', roleLabel: 'Colorist', isPrimary: false, verified: false },
    ] });
    expect(parts).toEqual([{ text: 'Asha Rao', handle: 'asha-draws', role: null }, { text: 'Bala Iyer', handle: null, role: 'Colorist' }]);
  });
  it('falls back to the legacy artist text, or nothing', () => {
    expect(bylineParts({ artist: '  Old Artist ' })).toEqual([{ text: 'Old Artist', handle: null, role: null }]);
    expect(bylineParts({ artist: 'Old', credits: [] })).toEqual([{ text: 'Old', handle: null, role: null }]);
    expect(bylineParts({ artist: ' ' })).toEqual([]);
  });
});

describe('bylineText (plain-text surfaces: homepage cards)', () => {
  it('joins accepted credits with roles, never the legacy text', () => {
    expect(bylineText({ artist: 'Legacy', credits: [
      { displayName: 'Asha Rao', handle: 'asha-draws', role: 'creator', roleLabel: null, isPrimary: true, verified: true },
      { displayName: 'Bala Iyer', handle: null, role: 'contributor', roleLabel: 'Colorist', isPrimary: false, verified: false },
    ] })).toBe('Asha Rao, Bala Iyer (Colorist)');
  });
  it('shows the legacy text only when nothing structured exists, and an empty string for a blanked artwork', () => {
    expect(bylineText({ artist: 'Old Artist', credits: [] })).toBe('Old Artist');
    expect(bylineText({ artist: '', credits: [] })).toBe('');   // withdrawn attribution
  });
});

describe('mergeCards', () => {
  it('drops duplicates when pages overlap', () => {
    expect(mergeCards([card('a'), card('b')], [card('b'), card('c')]).map(c => c.handle)).toEqual(['a', 'b', 'c']);
  });
});
