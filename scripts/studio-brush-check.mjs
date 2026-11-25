import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const result = {};
try {
  await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
  await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/astronaut.png');
  await page.getByRole('button', { name: 'Portrait (people)', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Background', exact: true }).click();
  await page.getByRole('button', { name: 'Re-run', exact: true }).waitFor({ timeout: 120000 });
  const alpha = () => page.locator('canvas').first().evaluate(c => c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data[3]);
  const initial = await alpha(); assert(initial > 200);
  await page.getByRole('button', { name: 'Erase', exact: true }).click(); await page.getByRole('button', { name: 'Hard', exact: true }).click();
  await page.getByLabel('Mask brush size').fill('80');
  const canvas = page.locator('canvas').first(); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.up();
  assert.equal(await alpha(), 0); assert(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Font Pairing', exact: true }).click(); await page.getByRole('button', { name: 'Background Remover', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).waitFor(); assert(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled()); assert.equal(await alpha(), 0);
  assert.equal(await page.getByLabel('Mask brush size').inputValue(), '80');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); assert.equal(await alpha(), initial);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); assert.equal(await alpha(), 0);
  await page.getByLabel('Keep this image on this device for 24 hours (off by default)').check();
  // Wait for the actual committed draft, rather than a fixed storage delay.
  await page.waitForFunction(async () => { const req = indexedDB.open('dna-studio-images', 1); const db = await new Promise(resolve => req.onsuccess = () => resolve(req.result)); const tx = db.transaction('drafts'); const r = tx.objectStore('drafts').get('background'); const data = await new Promise(resolve => r.onsuccess = () => resolve(r.result)); db.close(); return data?.retain && data?.mask?.length; });
  await page.reload(); await page.getByRole('button', { name: 'Erase', exact: true }).waitFor(); assert.equal(await alpha(), 0);
  await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('canvas'));
  await page.reload(); assert.equal(await page.locator('canvas').count(), 0);
  result.checks = ['real portrait inference', 'manual erase', 'undo/redo history and brush settings survive tool switch', 'edited mask survives opted-in refresh', 'clear commits before immediate refresh'];
} catch (error) { result.failure = error.stack; }
await browser.close(); await fs.writeFile('docs/studio-validation/brush-results.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); if (result.failure) process.exitCode = 1;
