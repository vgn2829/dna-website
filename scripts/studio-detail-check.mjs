import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.STUDIO_CHROMIUM_EXECUTABLE });
const page = await browser.newPage(); const failures = []; page.on('pageerror', error => failures.push(error.message));
const result = {};
try {
  await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
  await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/followup/fixtures/portrait.png');
  await page.getByRole('button', { name: 'Detail (WebGPU)', exact: true }).click();
  const began = Date.now(); await page.getByRole('button', { name: 'Remove Background', exact: true }).click();
  await page.getByRole('button', { name: 'Re-run', exact: true }).waitFor({ timeout: 310000 });
  const error = await page.getByRole('alert').allTextContents(); assert.deepEqual(error, []);
  result.firstUiJobMs = Date.now() - began;
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click(); await (await download).saveAs('docs/studio-validation/followup/detail-browser-ui.png');
  result.checks = ['real pinned remote model download, integrity check, WebGPU inference and PNG export'];
  const runs = await page.evaluate(async () => {
    const { localBackgroundProcessor: processor } = await import('/src/app/components/background-removal/processor.ts');
    const bitmap = await createImageBitmap(await (await fetch('/docs/studio-validation/followup/fixtures/portrait.png')).blob()); const canvas = document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height; const context=canvas.getContext('2d'); context.drawImage(bitmap,0,0); bitmap.close(); const image=context.getImageData(0,0,canvas.width,canvas.height), runs=[];
    for (let i = 0; i < 3; i++) { const phases = [], start = performance.now(); const mask = await processor.segment(image, 'detail', progress => phases.push({ ...progress, elapsedMs: performance.now() - start })); runs.push({ elapsedMs: performance.now() - start, maskPixels: mask.length, phases }); }
    return runs;
  }); result.processorRuns = runs.map((run,index)=>({...run,temperature:index===0?'cold worker (model cache already populated)':'warm'})); assert.deepEqual(failures, []);
} catch (error) { result.failure = error.stack; }
await browser.close(); await fs.writeFile('docs/studio-validation/followup/detail-browser.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); if (result.failure) process.exitCode = 1;
