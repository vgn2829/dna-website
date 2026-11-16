// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  openRollModal: vi.fn(),
  session: { current: { rollNumber: '230001', name: 'Ada' } as { rollNumber: string; name: string } | null },
}));

vi.mock('../../lib/api', () => {
  class UploadError extends Error {
    readonly failure: { message: string; retryable: boolean };
    constructor(failure: { message: string; retryable: boolean }) { super(failure.message); this.failure = failure; }
  }
  return { UploadError, api: { workspaces: { list: mocks.list }, assets: { upload: mocks.upload } } };
});
vi.mock('../../context/StudentContext', () => ({
  useStudent: () => ({ studentSession: mocks.session.current, openRollModal: mocks.openRollModal }),
}));

import { SaveToAssetsButton } from './SaveToAssetsButton';
import { UploadError } from '../../lib/api';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';

const WORKSPACES = [
  { id: 'ws-shared', is_personal: false, role: 'owner' },
  { id: 'ws-mine', is_personal: true, role: 'owner' },
];
const png = (size = 1000) => new Blob([new Uint8Array(size)], { type: 'image/png' });

async function mount(props: Partial<React.ComponentProps<typeof SaveToAssetsButton>> = {}) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const getBlob = props.getBlob ?? (async () => png());
  await act(async () => root.render(
    <MemoryRouter><SaveToAssetsButton tool="background-remover" baseName="portrait.jpg" getBlob={getBlob} {...props} /></MemoryRouter>));
  const button = () => host.querySelector('button') as HTMLButtonElement;
  const status = () => host.querySelector('[role="status"]')!.textContent ?? '';
  const click = () => act(async () => { button().click(); });
  return { host, button, status, click, unmount: () => act(async () => root.unmount()) };
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(WORKSPACES);
  mocks.upload.mockReset().mockResolvedValue({ id: 'asset-1' });
  mocks.openRollModal.mockReset();
  mocks.session.current = { rollNumber: '230001', name: 'Ada' };
  document.body.innerHTML = '';
});

describe('Save to Assets', () => {
  it('asks signed-out visitors to sign in and uploads nothing', async () => {
    mocks.session.current = null;
    const m = await mount();
    await m.click();
    expect(mocks.openRollModal).toHaveBeenCalledTimes(1);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('uploads a PRIVATE copy to the personal workspace with a safe, descriptive name', async () => {
    const m = await mount();
    await m.click();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [workspaceId, file, opts] = mocks.upload.mock.calls[0];
    expect(workspaceId).toBe('ws-mine');                       // never the shared workspace
    expect(file.name).toBe('portrait - Background Remover.png');
    expect(file.type).toBe('image/png');
    expect(opts.visibility).toBe('personal');                  // never shared/published implicitly
    expect(typeof opts.clientUploadId).toBe('string');
    expect(m.status()).toContain('Saved privately');
    expect(m.host.querySelector('a')?.getAttribute('href')).toBe('/assets');
    // No file URL is ever shown: the only link/source in the output is the in-app Asset Library route.
    expect([...m.host.querySelectorAll('[href],[src]')].map(e => e.getAttribute('href') ?? e.getAttribute('src'))).toEqual(['/assets']);
    await m.unmount();
  });

  it('refuses an empty, unsupported or oversized result without any network call', async () => {
    for (const [blob, text] of [
      [null, /nothing to save/i],
      [new Blob(['x'], { type: 'text/html' }), /format/i],
      [new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/png' }), /larger/i],
    ] as const) {
      document.body.innerHTML = '';
      const m = await mount({ getBlob: async () => blob });
      await m.click();
      expect(m.status()).toMatch(text);
      await m.unmount();
    }
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('says so honestly when no personal workspace exists', async () => {
    mocks.list.mockResolvedValue([{ id: 'ws-shared', is_personal: false, role: 'owner' }]);
    const m = await mount();
    await m.click();
    expect(m.status()).toMatch(/personal workspace/i);
    expect(mocks.upload).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('shows the server\'s specific failure and reuses the idempotency key when retrying the same result', async () => {
    mocks.upload.mockRejectedValueOnce(new UploadError({ message: 'Upload interrupted — retry to finish it.', retryable: true }));
    const m = await mount();
    await m.click();
    expect(m.status()).toBe('Upload interrupted — retry to finish it.');
    await m.click();                                           // retry succeeds
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls[1][2].clientUploadId).toBe(mocks.upload.mock.calls[0][2].clientUploadId);
    expect(m.status()).toContain('Saved privately');
    await m.click();                                           // a NEW save after success is a new asset
    expect(mocks.upload.mock.calls[2][2].clientUploadId).not.toBe(mocks.upload.mock.calls[0][2].clientUploadId);
    await m.unmount();
  });

  it('does not reuse a failed attempt\'s key for a different result', async () => {
    mocks.upload.mockRejectedValueOnce(new UploadError({ message: 'fail', retryable: true }));
    let size = 1000;
    const m = await mount({ getBlob: async () => png(size) });
    await m.click();
    size = 2000;
    await m.click();
    expect(mocks.upload.mock.calls[1][2].clientUploadId).not.toBe(mocks.upload.mock.calls[0][2].clientUploadId);
    await m.unmount();
  });

  it('ignores a second click while a save is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise(r => { release = r; }));
    const m = await mount();
    await act(async () => { m.button().click(); });
    expect(m.button().disabled).toBe(true);
    await act(async () => { m.button().click(); });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await act(async () => { release({ id: 'a' }); });
    expect(m.status()).toContain('Saved privately');
    await m.unmount();
  });

  it('respects the disabled prop', async () => {
    const m = await mount({ disabled: true });
    expect(m.button().disabled).toBe(true);
    await m.unmount();
  });
});
