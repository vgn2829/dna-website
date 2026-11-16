// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('./WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => <div /> }));

import { NAV_GROUPS, Sidebar, isNavItemActive } from './Sidebar';

async function render(path: string) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Sidebar /></MemoryRouter>));
  return { host, current: () => Array.from(host.querySelectorAll('[aria-current="page"]')).map(a => a.textContent?.trim()), unmount: () => act(async () => root.unmount()) };
}

describe('Creator Studio sidebar', () => {
  it('has exactly the three groups, in order, each as a labelled group', async () => {
    const s = await render('/home');
    const groups = Array.from(s.host.querySelectorAll('[role="group"]'));
    expect(groups.map(g => g.querySelector('p')?.textContent)).toEqual(['Create', 'Discover', 'Manage']);
    expect(Array.from(groups[0].querySelectorAll('a')).map(a => a.textContent?.trim())).toEqual(['Overview', 'Moodboards', 'Asset Library', 'Templates']);
    expect(Array.from(groups[1].querySelectorAll('a')).map(a => a.textContent?.trim())).toEqual(['Inspiration Library', 'Creator Discovery', 'Public Showcase']);
    expect(Array.from(groups[2].querySelectorAll('a')).map(a => a.textContent?.trim())).toEqual(['My Projects', 'Showcase submissions', 'Collaborations']);
    await s.unmount();
  });

  it('no longer lists My profile (it moved to the account menu) and has no duplicate destinations', () => {
    const all = NAV_GROUPS.flatMap(g => g.items);
    expect(all.some(i => /profile/i.test(i.label) || i.to === '/profile')).toBe(false);
    expect(new Set(all.map(i => i.to)).size).toBe(all.length);
    expect(new Set(all.map(i => i.label)).size).toBe(all.length);
  });

  it('keeps every pre-existing workspace destination reachable', () => {
    const tos = NAV_GROUPS.flatMap(g => g.items.map(i => i.to.split('#')[0]));
    for (const must of ['/home', '/moodboards', '/assets', '/inspiration', '/showcase/manage', '/projects', '/templates']) expect(tos).toContain(must);
  });

  it('marks exactly one item current, including nested routes and the collaborations hash', async () => {
    for (const [path, expected] of [
      ['/moodboards', 'Moodboards'], ['/projects/abc', 'My Projects'], ['/showcase/manage/xyz', 'Showcase submissions'],
      ['/showcase/manage', 'Showcase submissions'], ['/showcase/manage#collaborations', 'Collaborations'],
      ['/creators', 'Creator Discovery'], ['/showcase', 'Public Showcase'], ['/assets', 'Asset Library'],
    ] as const) {
      const s = await render(path);
      expect(s.current(), path).toEqual([expected]);
      await s.unmount();
    }
  });

  it('Public Showcase does not light up on the manage pages', () => {
    const pub = NAV_GROUPS.flatMap(g => g.items).find(i => i.to === '/showcase')!;
    expect(isNavItemActive(pub, '/showcase/manage', '')).toBe(false);
    expect(isNavItemActive(pub, '/showcase', '')).toBe(true);
  });
});
