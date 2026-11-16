import { describe, expect, it } from 'vitest';
import { profileCompletion } from './profileCompletion';

const EMPTY = { avatarUrl: null, headline: null, bio: null, skills: [], worksCount: 0 };

describe('profileCompletion', () => {
  it('starts at 0% with the avatar as the first suggestion', () => {
    const c = profileCompletion(EMPTY);
    expect(c).toMatchObject({ doneCount: 0, total: 5, percent: 0, complete: false });
    expect(c.next?.id).toBe('avatar');
  });
  it('counts each of the five signals and reaches 100% only with all of them', () => {
    expect(profileCompletion({ ...EMPTY, avatarUrl: 'u' }).percent).toBe(20);
    expect(profileCompletion({ ...EMPTY, avatarUrl: 'u', headline: 'h', bio: 'b', skills: ['figma'] }).percent).toBe(80);
    const full = profileCompletion({ avatarUrl: 'u', headline: 'h', bio: 'b', skills: ['figma'], worksCount: 1 });
    expect(full).toMatchObject({ percent: 100, complete: true, next: null });
  });
  it('treats whitespace-only text as missing', () => {
    expect(profileCompletion({ ...EMPTY, headline: '   ', bio: '\n' }).doneCount).toBe(0);
  });
  it('accepts either a credited artwork or a published project as the "work" signal', () => {
    expect(profileCompletion({ ...EMPTY, worksCount: 2 }).steps.find(s => s.id === 'work')?.done).toBe(true);
    expect(profileCompletion({ ...EMPTY, projectCount: 1 }).steps.find(s => s.id === 'work')?.done).toBe(true);
    expect(profileCompletion({ ...EMPTY, projectCount: 0 }).steps.find(s => s.id === 'work')?.done).toBe(false);
  });
  it('never blocks anything: every step carries a destination and a hint', () => {
    for (const s of profileCompletion(EMPTY).steps) { expect(s.href).toBeTruthy(); expect(s.hint.length).toBeGreaterThan(10); }
  });
});
