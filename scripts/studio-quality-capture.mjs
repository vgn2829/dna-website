import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.STUDIO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.STUDIO_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
const output = 'docs/studio-validation/followup', results = [];
for (const name of (await fs.readdir(output + '/fixtures')).filter(name => name.endsWith('.png'))) {
  const encoded = (await fs.readFile(path.join(output, 'fixtures', name))).toString('base64');
  const record = await page.evaluate(async ({ encoded, name }) => {
    const { localBackgroundProcessor: processor } = await import('/src/app/components/background-removal/processor.ts');
    const { applyMask } = await import('/src/app/components/background-removal/compositing.ts');
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const model = name.includes('portrait') || name.includes('similar') || name.includes('motion') ? 'portrait' : 'general';
    const phases = [], start = performance.now(); const mask = await processor.segment(pixels, model, phase => phases.push({ ...phase, elapsedMs: performance.now() - start }));
    ctx.putImageData(applyMask(pixels, mask), 0, 0);
    return { fixture: name, model, dimensions: [canvas.width, canvas.height], elapsedMs: performance.now() - start, phases, png: canvas.toDataURL() };
  }, { encoded, name });
  await fs.writeFile(path.join(output, 'outputs', name.replace('.png', '-current.png')), Buffer.from(record.png.split(',')[1], 'base64')); delete record.png; results.push(record);
}
await browser.close(); await fs.writeFile(output + '/current-browser.json', JSON.stringify(results, null, 2)); console.log('Captured', results.length, 'real browser outputs');
