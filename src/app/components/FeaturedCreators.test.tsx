// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const featured = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ api: { creators: { featured } } }));

import { FeaturedCreators } from './FeaturedCreators';

const card = (n: number, o: object = {}) => ({ handle: `creator-${n}`, displayName: `Creator ${n}`, headline: 'Maker', bio: null, avatarUrl: null, verified: false, featured: true, editorialNote: null, skills: [], disciplines: [], projectCount: 0, projects: [], ...o });
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><FeaturedCreators /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  return host;
}
beforeEach(() => { document.body.innerHTML = ''; featured.mockReset(); });

describe('FeaturedCreators (home)', () => {
  it('renders nothing — not even a heading — when nobody is featured', async () => {
    featured.mockResolvedValue({ creators: [] });
    expect((await mount()).innerHTML).toBe('');
  });
  it('renders nothing when the request fails', async () => {
    featured.mockRejectedValue(new Error('down'));
    expect((await mount()).innerHTML).toBe('');
  });
  it('shows at most four featured creators in server order, with the editorial note, linking to /creators', async () => {
    featured.mockResolvedValue({ creators: [card(1, { editorialNote: 'Posters that stop the scroll' }), card(2), card(3), card(4), card(5)] });
    const host = await mount();
    const links = [...host.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(links.filter(h => h?.startsWith('/designers/'))).toEqual(['/designers/creator-1', '/designers/creator-2', '/designers/creator-3', '/designers/creator-4']);
    expect(links).toContain('/creators');
    expect(host.textContent).toContain('Posters that stop the scroll');
    expect(host.textContent).not.toContain('Creator 5');
  });
});
