import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium, firefox, webkit } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.STUDIO_BASE_URL || 'http://127.0.0.1:4173';
const results = [];
for (const [engine, type, mode, executablePath] of [['chromium', chromium, 'wasm', undefined], ['firefox', firefox, 'auto', undefined], ['webkit', webkit, 'auto', undefined], ...(process.env.STUDIO_CHROMIUM_EXECUTABLE ? [['chromium', chromium, 'gpu', process.env.STUDIO_CHROMIUM_EXECUTABLE]] : [])]) {
  const browser = await type.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); const page = await browser.newPage();
  const record = { engine, version: browser.version(), mode, checks: [] }; const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base+'/design-studio?tab=bg');
    await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/astronaut.png');
    await page.getByRole('button', { name: 'Portrait (people)', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Background', exact: true }).click(); await page.getByRole('button', { name: 'Re-run', exact: true }).waitFor({ timeout: 120000 });
    const status = await page.getByRole('status').allTextContents(); record.backendStatus = status; record.actualBackend = status.join(' ').includes('WebGPU acceleration') ? 'webgpu' : 'wasm';
    assert(/WebGPU acceleration|CPU WASM fallback/.test(status.join(' '))); if(mode==='gpu')assert(status.join(' ').includes('WebGPU acceleration'));
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click(); assert((await download).suggestedFilename().endsWith('-nobg.png'));
    record.checks.push('production module worker, runtime chunks, ONNX model load, actual inference, PNG export');
    await page.getByRole('button', { name: 'Halftone', exact: true }).click(); await page.getByRole('heading', {name:'Halftone',exact:true,level:3}).waitFor(); await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/ramp-wide.png');
    await page.waitForFunction(() => document.querySelector('canvas')?.width === 700); const output = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click(); assert((await output).suggestedFilename().includes('1400x700'));
    record.checks.push('production halftone worker and full-resolution export');
    await page.getByRole('button', { name: 'Font Pairing', exact: true }).click(); await page.getByText('Selected fonts loaded', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Palette Studio', exact: true }).first().click(); await page.getByRole('button', { name: 'Generate', exact: true }).click(); await page.getByRole('button', { name: 'Download CSS', exact: true }).waitFor();
    record.checks.push('production local fonts and colour engine');
    await page.getByRole('button', { name: 'Image Converter', exact: true }).click(); await page.getByText(/PNG, JPEG, WebP, GIF, BMP, SVG or PDF/).waitFor(); await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/ramp-wide.png');
    await page.getByRole('img', { name: 'Original', exact: true }).waitFor(); await page.getByRole('button', { name: 'Convert', exact: true }).click(); await page.getByRole('link', { name: /Download/ }).waitFor();
    await page.getByRole('button', { name: 'Font Pairing', exact: true }).click(); await page.getByRole('button', { name: 'Image Converter', exact: true }).click(); await page.getByRole('img', { name: 'Original', exact: true }).waitFor();
    record.checks.push('image conversion and source recovery after tool switch'); assert.deepEqual(errors, []);
  } catch (error) { record.failure = error.stack; }
  await browser.close(); results.push(record);
}
await fs.writeFile('docs/studio-validation/release/production-results.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2)); if (results.some(r => r.failure)) process.exitCode = 1;
