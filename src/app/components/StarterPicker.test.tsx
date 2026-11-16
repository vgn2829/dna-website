// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { StarterPicker } from './StarterPicker';
import { STARTER_LAYOUTS } from '../lib/boardStarters';

async function mount(initial = '') {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const seen = vi.fn();
  function Harness() { const [v, setV] = useState(initial); return <StarterPicker value={v} onChange={id => { seen(id); setV(id); }} />; }
  await act(async () => root.render(<Harness />));
  return { host, seen, radios: () => [...host.querySelectorAll('input[type=radio]')] as HTMLInputElement[] };
}

describe('StarterPicker', () => {
  it('offers Blank plus every starter as one radio group, defaulting to Blank', async () => {
    const { host, radios } = await mount();
    expect(radios()).toHaveLength(STARTER_LAYOUTS.length + 1);
    expect(new Set(radios().map(r => r.name)).size).toBe(1);
    expect(radios()[0].checked).toBe(true);
    expect(host.querySelector('legend')?.textContent).toBe('Start from');
  });
  it('shows a preview, use case and slot count for each starter, labelled for screen readers', async () => {
    const { host } = await mount();
    expect(host.querySelectorAll('svg[role="img"]')).toHaveLength(STARTER_LAYOUTS.length);
    expect(host.querySelector('svg[aria-label="Storyboard layout preview"]')).not.toBeNull();
    expect(host.textContent).toMatch(/Animation, comics and video planning · 6 image slots/);
    expect(host.textContent).not.toMatch(/\b0 image slots/);                   // a layout with no slots doesn't advertise "0"
  });
  it('selecting a starter reports its id and describes it; selecting Blank reports the empty id', async () => {
    const { host, radios, seen } = await mount();
    const poster = radios().find(r => r.value === 'poster-exploration')!;
    await act(async () => { poster.click(); });
    expect(seen).toHaveBeenCalledWith('poster-exploration');
    expect(radios().find(r => r.checked)?.value).toBe('poster-exploration');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Three poster directions');
    await act(async () => { radios()[0].click(); });
    expect(seen).toHaveBeenLastCalledWith('');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Start with nothing');
  });
  it('an unknown value falls back to describing Blank rather than crashing', async () => {
    const { host } = await mount('does-not-exist');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Blank board');
  });
});
