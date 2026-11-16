import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium, firefox, webkit } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const results = [];
for (const [engine, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await type.launch(); const page = await browser.newPage();
  const record = { engine, checks: [] };
  try {
    await page.goto('http://127.0.0.1:5173/design-studio?tab=halftone');
    record.rendering = await page.evaluate(async () => {
      const { renderHalftone } = await import('/src/app/lib/halftone-job.ts');
      const options = { type: 'squares', frequency: 10, resolution: 4, angle: 37, contrast: 100, brightness: 100, inverted: false, color: '#000000', backgroundColor: '#FFFFFF', minWidth: 0, maxWidth: 1 };
      const out = [];
      const image = new ImageData(700, 350); for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      for (const type of ['squares', 'dots', 'lines']) {
        const blob = await renderHalftone(image, { ...options, type }, 'png', new AbortController().signal);
        const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(700, 350), ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const data = ctx.getImageData(0, 0, 700, 350).data; let sum = 0; for (let i = 0; i < data.length; i += 4) sum += data[i];
        out.push({ type, blackFieldMean: sum / (700 * 350) });
      }
      const transparent = await renderHalftone(new ImageData(700, 350), { ...options, inverted: true, backgroundColor: '#FF00FF' }, 'png', new AbortController().signal);
      const bitmap = await createImageBitmap(transparent), canvas = new OffscreenCanvas(700, 350), ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixel = [...ctx.getImageData(350, 175, 1, 1).data];
      let large;
      if (navigator.userAgent.includes('Chrome')) {
        const image = new ImageData(4000, 4000); for (let i = 0; i < image.data.length; i += 4) image.data.set([128, 128, 128, 255], i);
        const start = performance.now(); const blob = await renderHalftone(image, options, 'png', new AbortController().signal);
        const result = await createImageBitmap(blob); large = { width: result.width, height: result.height, ms: performance.now() - start, bytes: blob.size }; result.close();
      }
      const pendingController = new AbortController(); const pending = renderHalftone(image, options, 'png', pendingController.signal); pendingController.abort();
      let cancelled = false; try { await pending; } catch (error) { cancelled = error.name === 'AbortError'; }
      return { out, pixel, large, cancelled };
    });
    assert(record.rendering.out.every(x => x.blackFieldMean < 1));
    assert.deepEqual(record.rendering.pixel, [255, 0, 255, 255]); assert(record.rendering.cancelled);
    if (record.rendering.large) assert.deepEqual([record.rendering.large.width, record.rendering.large.height], [4000, 4000]);
    record.checks.push('rotated full-coverage fields, transparent coloured paper, export cancellation', ...(record.rendering.large ? ['16 megapixel source-resolution PNG'] : []));
    record.deniedStorage = await page.evaluate(async () => {
      const original = Object.getOwnPropertyDescriptor(window, 'indexedDB');
      Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('Denied storage fixture'); } });
      try {
        const { saveImageDraft, readImageDraft, clearImageDraft } = await import('/src/app/lib/image-drafts.ts');
        const saved = await saveImageDraft('denied-fixture', { version: 1, file: new Blob(['test'], { type: 'image/png' }), name: 'test.png', saved: Date.now(), retain: true });
        const memory = await readImageDraft('denied-fixture'); const cleared = await clearImageDraft('denied-fixture');
        return { saved, memory: !!memory, cleared };
      } finally { if (original) Object.defineProperty(window, 'indexedDB', original); else delete window.indexedDB; }
    });
    assert.deepEqual(record.deniedStorage, { saved: false, memory: true, cleared: false }); record.checks.push('storage denial preserves session fallback and reports persistence failure');
    await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
    await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/astronaut.png');
    await page.getByRole('button', { name: /Remove Background/i }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('canvas').count(), 0);
    record.checks.push('reset during background processing rejects stale result');
  } catch (error) { record.failure = error.stack; }
  await browser.close(); results.push(record);
}
await fs.writeFile('docs/studio-validation/edge-results.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
if (results.some(r => r.failure)) process.exitCode = 1;
