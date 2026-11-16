// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { ImageLightbox } from './ImageLightbox';

const ITEMS = [{ id: 'a', src: '/a.png', label: 'a.png' }, { id: 'b', src: '/b.png' }, { id: 'c', src: '/c.png' }];

async function mount(items = ITEMS, start = 0) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  function Harness() { const [i, setI] = useState(start); return <ImageLightbox items={items} index={i} onIndexChange={setI} onClose={onClose} label="Test board images" />; }
  await act(async () => root.render(<Harness />));
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
  const img = () => dialog().querySelector('img') as HTMLImageElement | null;
  const key = (k: string) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
  const status = () => dialog().querySelector('[role="status"]')!.textContent;
  return { host, root, onClose, dialog, img, key, status, click: (sel: string) => act(async () => { (dialog().querySelector(sel) as HTMLElement).click(); }) };
}

beforeEach(() => { document.body.innerHTML = ''; document.body.style.overflow = ''; });

describe('ImageLightbox', () => {
  it('is a labelled modal dialog showing the right image with a position counter', async () => {
    const l = await mount(ITEMS, 1);
    expect(l.dialog().getAttribute('aria-modal')).toBe('true');
    expect(l.dialog().getAttribute('aria-label')).toBe('Test board images');
    expect(l.img()!.getAttribute('src')).toBe('/b.png');
    expect(l.status()).toBe('2 / 3');
  });
  it('navigates with the buttons and arrow keys, wrapping at both ends, plus Home/End', async () => {
    const l = await mount();
    await l.click('button[aria-label="Next image"]'); expect(l.img()!.getAttribute('src')).toBe('/b.png');
    await l.key('ArrowRight'); expect(l.status()).toBe('3 / 3');
    await l.key('ArrowRight'); expect(l.status()).toContain('1 / 3');          // wraps
    await l.key('ArrowLeft'); expect(l.status()).toBe('3 / 3');                // wraps back
    await l.key('Home'); expect(l.status()).toContain('1 / 3');
    await l.key('End'); expect(l.status()).toBe('3 / 3');
    await l.click('button[aria-label="Previous image"]'); expect(l.status()).toBe('2 / 3');
  });
  it('closes with Escape, the close button, and a click on the backdrop — but not a click on the image', async () => {
    let l = await mount();
    await act(async () => { l.dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(l.onClose).toHaveBeenCalledTimes(1);
    await l.click('button[aria-label="Close image viewer"]'); expect(l.onClose).toHaveBeenCalledTimes(2);
    await act(async () => { l.img()!.click(); }); expect(l.onClose).toHaveBeenCalledTimes(2);
    await act(async () => { l.dialog().click(); }); expect(l.onClose).toHaveBeenCalledTimes(3);
  });
  it('locks page scrolling while open and restores it on close', async () => {
    document.body.style.overflow = 'auto';
    const l = await mount();
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => l.root.unmount());
    expect(document.body.style.overflow).toBe('auto');
  });
  it('a single image has no previous/next controls and says so', async () => {
    const l = await mount([ITEMS[0]]);
    expect(l.dialog().querySelector('button[aria-label="Next image"]')).toBeNull();
    expect(l.status()).toContain('1 image');
    await l.key('ArrowRight'); expect(l.img()!.getAttribute('src')).toBe('/a.png');
  });
  it('shows a loading state, then the image; a failing image shows an error with retry instead of a blank box', async () => {
    const l = await mount();
    expect(l.dialog().querySelector('[aria-label="Loading image"]')).not.toBeNull();
    await act(async () => { l.img()!.dispatchEvent(new Event('load')); });
    expect(l.dialog().querySelector('[aria-label="Loading image"]')).toBeNull();
    await l.click('button[aria-label="Next image"]');
    await act(async () => { l.img()!.dispatchEvent(new Event('error')); });
    expect(l.dialog().querySelector('[role="alert"]')!.textContent).toContain('couldn’t be loaded');
    expect(l.img()).toBeNull();
    await act(async () => { ([...l.dialog().querySelectorAll('button')].find(b => b.textContent?.includes('Try again')) as HTMLElement).click(); });
    expect(l.img()).not.toBeNull();                                                  // retry renders the image again
    await l.click('button[aria-label="Next image"]');
    expect(l.dialog().querySelector('[role="alert"]')).toBeNull();                   // the error doesn't stick to the next image
  });
  it('gives each image a descriptive alt text', async () => {
    const l = await mount(ITEMS, 0);
    expect(l.img()!.alt).toBe('a.png (1 of 3)');
    await l.key('ArrowRight');
    expect(l.img()!.alt).toBe('Board image 2 of 3');
  });
  it('swiping left/right changes the image on touch screens', async () => {
    const l = await mount();
    const touch = (type: string, x: number, y: number) => act(async () => {
      const ev = new Event(type, { bubbles: true }) as Event & { touches: unknown[]; changedTouches: unknown[] };
      ev.touches = [{ clientX: x, clientY: y }]; ev.changedTouches = [{ clientX: x, clientY: y }]; l.dialog().dispatchEvent(ev);
    });
    await touch('touchstart', 300, 200); await touch('touchend', 150, 205);
    expect(l.status()).toBe('2 / 3');
    await touch('touchstart', 100, 200); await touch('touchend', 260, 200);
    expect(l.status()).toContain('1 / 3');
  });
});
