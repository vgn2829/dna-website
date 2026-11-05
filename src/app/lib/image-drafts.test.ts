import { afterEach, expect, test, vi } from 'vitest';
import { saveImageDraft, readImageDraft } from './image-drafts';
afterEach(() => vi.unstubAllGlobals());
test('revoking retention reports deletion failure instead of claiming device data was removed', async () => {
  vi.stubGlobal('indexedDB', { open() { throw new Error('Denied storage'); } });
  const draft = { version: 1 as const, file: new Blob(['fixture'], { type: 'image/png' }), name: 'fixture.png', saved: Date.now(), retain: false };
  expect(await saveImageDraft('failed-revoke', draft)).toBe(false);
  expect((await readImageDraft('failed-revoke'))?.file.size).toBe(7);
});
