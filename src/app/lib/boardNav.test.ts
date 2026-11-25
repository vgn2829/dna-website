import { describe, it, expect } from 'vitest';
import { boardCrumbs, isCompactBoardHeader, MOODBOARDS_HREF, WORKSPACE_HOME_HREF } from './boardNav';

const workspaces = [
  { id: 'p', name: 'roll personal', is_personal: true },
  { id: 'd', name: 'Design Team', is_personal: false },
];

describe('boardCrumbs', () => {
  it('always links up to workspace home and Moodboards, never to browser history', () => {
    const crumbs = boardCrumbs('Brand Moodboard', 'd', workspaces);
    expect(crumbs).toEqual([
      { label: 'Design Team', href: WORKSPACE_HOME_HREF },
      { label: 'Moodboards', href: MOODBOARDS_HREF },
      { label: 'Brand Moodboard' },
    ]);
    expect(WORKSPACE_HOME_HREF).toBe('/home');
    expect(MOODBOARDS_HREF).toBe('/moodboards');
  });
  it('names the personal workspace "Personal"', () => {
    expect(boardCrumbs('B', 'p', workspaces)[0].label).toBe('Personal');
  });
  it('falls back to "Workspace" for a board shared from a workspace the viewer is not in', () => {
    expect(boardCrumbs('B', 'other', workspaces)[0]).toEqual({ label: 'Workspace', href: '/home' });
    expect(boardCrumbs('B', null, [])[0].href).toBe('/home');
  });
});

describe('isCompactBoardHeader', () => {
  it('is compact below the lg breakpoint (1024px) and always in fullscreen', () => {
    expect(isCompactBoardHeader(false, false)).toBe(true);
    expect(isCompactBoardHeader(true, false)).toBe(false);
    expect(isCompactBoardHeader(true, true)).toBe(true);
    expect(isCompactBoardHeader(false, true)).toBe(true);
  });
});
