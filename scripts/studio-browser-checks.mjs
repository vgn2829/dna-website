/** Run with STUDIO_PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
 * Test dependency is kept outside the production bundle. No uploads leave localhost.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium, firefox, webkit } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const output = path.join(root, 'docs/studio-validation');
const fixture = name => path.join(output, 'fixtures', name);
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5173';
const results = [];
const resultFile = process.env.STUDIO_RESULT_FILE || 'browser-results.json';
for (const [engine, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  if (process.env.STUDIO_BROWSERS && !process.env.STUDIO_BROWSERS.split(',').includes(engine)) continue;
  let browser;
  try { browser = await type.launch({ headless: true, ...(engine === 'chromium' && process.env.STUDIO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.STUDIO_CHROMIUM_EXECUTABLE } : {}) }); }
  catch (error) { results.push({ engine, untested: error.message }); continue; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const record = { engine, version: browser.version(), checks: [], errors };
  try {
    await page.goto(base + '/design-studio?tab=palette');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('button', { name: 'Download CSS', exact: true }).waitFor();
    await page.getByLabel('Palette variation seed').fill('browser-recovery');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const primary = await page.getByLabel(/Copy Primary #/).getAttribute('aria-label');
    await page.getByRole('button', { name: 'Font Pairing', exact: true }).click();
    await page.getByText('Selected fonts loaded', { exact: true }).waitFor({ timeout: 25000 });
    await page.getByLabel('Headline specimen').fill('Verified typography');
    await page.getByLabel('Headline size').fill('96');
    assert.equal(await page.getByRole('heading', { name: 'Verified typography' }).evaluate(el => getComputedStyle(el).fontSize), '96px');
    await page.getByLabel('Font script').selectOption('Devanagari');
    await page.getByText('Selected fonts loaded', { exact: true }).waitFor({ timeout: 25000 });
    const cssDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download typography CSS' }).click();
    const css = await fs.readFile(await (await cssDownload).path(), 'utf8'); assert(css.includes('Noto Serif Devanagari')); assert(css.includes('font-size: 96px'));
    record.checks.push('font loading, script filter, 96px specimen, recipe export');
    await page.screenshot({ path: path.join(output, `${engine}-fonts.png`), fullPage: true });
    await page.getByRole('button', { name: 'Palette Studio', exact: true }).first().click();
    assert.equal(await page.getByLabel('Palette variation seed').inputValue(), 'browser-recovery');
    assert.equal(await page.getByLabel(/Copy Primary #/).getAttribute('aria-label'), primary);
    await page.reload(); await page.getByRole('button', { name: 'Download CSS', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Palette variation seed').inputValue(), 'browser-recovery');
    record.checks.push('palette generation, tool-switch draft, refresh recovery');
    await page.screenshot({ path: path.join(output, `${engine}-palette.png`), fullPage: true });
    await page.getByRole('button', { name: 'Halftone', exact: true }).click();
    await page.getByRole('heading',{name:'Halftone',level:3,exact:true}).waitFor();
    await page.locator('input[type=file]').first().setInputFiles(fixture('ramp-wide.png'));
    await page.waitForFunction(() => document.querySelector('canvas')?.width === 700);
    await page.getByRole('button', { name: 'dots', exact: true }).click();
    await page.waitForTimeout(250);
    const pngDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click();
    const png = await pngDownload; await png.saveAs(path.join(output, `${engine}-halftone.png`));
    const size = await page.evaluate(async url => { const bitmap = await createImageBitmap(await (await fetch(url)).blob()); const size = [bitmap.width, bitmap.height]; bitmap.close(); return size; }, 'data:image/png;base64,' + (await fs.readFile(await png.path())).toString('base64'));
    assert.deepEqual(size, [1400, 700]);
    const svgDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export vector SVG' }).click();
    const svg = await svgDownload; await svg.saveAs(path.join(output, `${engine}-halftone.svg`)); assert((await fs.readFile(await svg.path(), 'utf8')).includes('width="1400"'));
    await page.getByRole('button', { name: 'Font Pairing', exact: true }).click(); await page.getByRole('button', { name: 'Halftone', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('canvas')?.width === 700);
    await page.getByLabel('Keep image on this device for 24 hours').check();
    await page.getByText('Image saved on this device', { exact: true }).waitFor(); await page.reload(); await page.waitForFunction(() => document.querySelector('canvas')?.width === 700);
    await page.getByRole('button', { name: 'Clear image draft' }).click(); await page.getByText('Drag an image here or click to upload').waitFor(); await page.reload(); await page.getByText('Drag an image here or click to upload').waitFor();
    await page.locator('input[type=file]').first().setInputFiles(fixture('corrupt.png')); await page.getByRole('alert').waitFor();
    record.checks.push('halftone source-resolution PNG/SVG, image tool-switch, opt-in refresh recovery, clear, corrupt file');
    // Exercise the typed processor directly, with real ORT/WASM and no backend requests.
    await page.goto(base + '/design-studio?tab=bg');
    const inference = await page.evaluate(async () => {
      const { localBackgroundProcessor: processor } = await import('/src/app/components/background-removal/processor.ts');
      const { applyMask } = await import('/src/app/components/background-removal/compositing.ts');
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 160, 120); ctx.fillStyle = '#245366'; ctx.fillRect(50, 20, 60, 80);
      const image = ctx.getImageData(0, 0, 160, 120); const runs = [];
      for (const model of ['general', 'portrait']) {
        for (let run = 0; run < 3; run++) { const start = performance.now(); const phases = []; const mask = await processor.segment(image, model, phase => phases.push({ ...phase, elapsed: performance.now() - start })); if (mask.length !== image.width * image.height) throw new Error('Wrong mask dimensions'); const output = applyMask(image, mask); if (output.data.every((v, i) => i % 4 !== 3 || v === 255)) throw new Error('No transparency produced'); runs.push({ model, run, elapsed: performance.now() - start, phases }); }
      }
      processor.release();
      return { runs, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, gpuAvailable: 'gpu' in navigator };
    });
    record.inference = inference; record.checks.push('real general and portrait WASM inference, 1 cold + 2 warm runs each');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/design-studio?tab=halftone');
    record.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: path.join(output, `${engine}-mobile.png`), fullPage: true });
    assert.equal(record.horizontalOverflow, false);
    assert.deepEqual(errors, []);
  } catch (error) { record.failure = error.stack; }
  results.push(record); await browser.close();
  await fs.writeFile(path.join(output, resultFile), JSON.stringify(results, null, 2));
}
await fs.writeFile(path.join(output, resultFile), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.some(record => record.failure)) process.exitCode = 1;
