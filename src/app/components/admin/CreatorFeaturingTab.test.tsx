// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({ adminList: vi.fn(), adminFeature: vi.fn(), adminEditFeatured: vi.fn() }));
vi.mock('../../lib/api', () => ({ api: { creators: mocks } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreatorFeaturingTab } from './CreatorFeaturingTab';

const item = (o: object) => ({ id: 'p1', handle: 'asha-draws', displayName: 'Asha Rao', ownerRoll: 'X', verified: false, featured: true, featuredAt: '2026-01-01', displayOrder: null, editorialNote: null, ...o });
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CreatorFeaturingTab />));
  await act(async () => { await new Promise(r => setTimeout(r, 250)); });
  return host;
}
const change = (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
  document.body.innerHTML = '';
  Object.values(mocks).forEach(m => m.mockReset());
});

describe('CreatorFeaturingTab order and note', () => {
  it('offers order and note only for featured creators', async () => {
    mocks.adminList.mockResolvedValue({ available: true, max: 12, featuredCount: 1, creators: [item({}), item({ id: 'p2', handle: 'bala', displayName: 'Bala Iyer', featured: false })] });
    const host = await mount();
    expect(host.querySelector('input[aria-label="Display order for Asha Rao"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="Display order for Bala Iyer"]')).toBeNull();
  });

  it('saves order and note, trimming the note and sending null for blanks', async () => {
    mocks.adminList.mockResolvedValue({ available: true, max: 12, featuredCount: 1, creators: [item({})] });
    mocks.adminEditFeatured.mockResolvedValue({ displayOrder: 2, editorialNote: 'Great' });
    const host = await mount();
    const save = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement;
    expect(save().disabled).toBe(true);                                    // nothing changed yet
    await change(host.querySelector('input[aria-label="Display order for Asha Rao"]') as HTMLInputElement, '2');
    await change(host.querySelector('input[aria-label="Editorial note for Asha Rao"]') as HTMLInputElement, '  Great  ');
    expect(save().disabled).toBe(false);
    await act(async () => { save().click(); });
    expect(mocks.adminEditFeatured).toHaveBeenCalledWith('p1', { displayOrder: 2, editorialNote: 'Great' });
  });

  it('blocks an out-of-range order before calling the server', async () => {
    mocks.adminList.mockResolvedValue({ available: true, max: 12, featuredCount: 1, creators: [item({})] });
    const host = await mount();
    await change(host.querySelector('input[aria-label="Display order for Asha Rao"]') as HTMLInputElement, '1000');
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(mocks.adminEditFeatured).not.toHaveBeenCalled();
  });
});
