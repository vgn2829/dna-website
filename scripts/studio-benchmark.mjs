import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import os from 'node:os';
const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const executablePath = process.env.STUDIO_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage(); page.setDefaultTimeout(180000);
const output = 'docs/studio-validation';
await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
const oldHalftone = execFileSync('git', ['show', 'HEAD:src/app/lib/halftone-logic.ts'], { encoding: 'utf8' });
const oldPreprocess = execFileSync('git', ['show', 'HEAD:src/app/components/background-removal/preprocess.ts'], { encoding: 'utf8' });
await page.addScriptTag({ content: (await transform(oldHalftone, { loader: 'ts', format: 'iife', globalName: 'BeforeHalftone' })).code });
await page.addScriptTag({ content: (await transform(oldPreprocess, { loader: 'ts', format: 'iife', globalName: 'BeforePreprocess' })).code });
const imageBytes = await fs.readFile(output + '/fixtures/astronaut.png');
const rampBytes = await fs.readFile(output + '/fixtures/ramp-wide.png');
const productBytes = await fs.readFile(output + '/fixtures/product-holes.png');
const results = await page.evaluate(async ({ astronaut, ramp, product }) => {
  const current = await import('/src/app/lib/halftone-logic.ts');
  const prep = await import('/src/app/components/background-removal/preprocess.ts');
  const { MODELS } = await import('/src/app/components/background-removal/models.ts');
  const ort = await import('/node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs'); ort.env.wasm.numThreads = 1;
  const decode = async encoded => { const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); return image; };
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const settings = { type: 'dots', frequency: 10, resolution: 4, angle: 37, contrast: 100, brightness: 100, inverted: false, color: '#000000', backgroundColor: '#FFFFFF', minWidth: 0, maxWidth: 1 };
  const rampImage = await decode(ramp), renderCanvas = canvas(700, 350), ctx = renderCanvas.getContext('2d'); ctx.drawImage(rampImage, 0, 0, 700, 350); const pixels = ctx.getImageData(0, 0, 700, 350);
  const halftone = [];
  for (const [name, render] of [['before', BeforeHalftone.processHalftone], ['after', current.processHalftone]]) {
    const timings = [];
    for (let i = 0; i < 7; i++) { const start = performance.now(); render(ctx, 700, 350, pixels, settings); timings.push(performance.now() - start); }
    halftone.push({ name, timings, png: renderCanvas.toDataURL() });
  }
  const inference = [];
  for (const [id, encoded] of [['general', product], ['portrait', astronaut]]) {
    const cfg = MODELS[id]; const image = await decode(encoded);
    const w = id === 'portrait' ? 384 : 700, h = id === 'portrait' ? 512 : 450;
    const src = canvas(w, h), sourceCtx = src.getContext('2d');
    if (id === 'portrait') sourceCtx.drawImage(image, 64, 0, 384, 512, 0, 0, w, h); else sourceCtx.drawImage(image, 0, 0, w, h);
    const source = sourceCtx.getImageData(0, 0, w, h);
    const downloadStart = performance.now(); const buffer = await (await fetch(cfg.url)).arrayBuffer(); const downloadMs = performance.now() - downloadStart;
    const initStart = performance.now(); const session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); const initMs = performance.now() - initStart;
    for (const name of ['before', 'after']) {
      const timings = [], details = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now(); const pre = name === 'before' ? BeforePreprocess : prep;
        const dimensions = name === 'before' ? { width: cfg.inputSize, height: cfg.inputSize } : prep.modelInputDimensions(w, h, cfg);
        const input = new ort.Tensor('float32', pre.toInputTensor(source.data, w, h, cfg), [1, 3, dimensions.height, dimensions.width]);
        const preMs = performance.now() - start, inferStart = performance.now();
        const outputs = await session.run({ [session.inputNames[0]]: input }, [session.outputNames[0]]);
        const inferMs = performance.now() - inferStart, postStart = performance.now();
        const mask = pre.toFullResMask(outputs[session.outputNames[0]].data, name === 'before' ? cfg.inputSize : dimensions, w, h, cfg);
        const rgba = new Uint8ClampedArray(source.data); for (let i = 0; i < mask.length; i++) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * mask[i] / 255);
        sourceCtx.putImageData(new ImageData(rgba, w, h), 0, 0);
        const postMs = performance.now() - postStart; timings.push(performance.now() - start); details.push({ preMs, inferMs, postMs });
        input.dispose(); Object.values(outputs).forEach(t => t.dispose());
      }
      inference.push({ id, name, dimensions: [w, h], input: name === 'before' ? [cfg.inputSize, cfg.inputSize] : Object.values(prep.modelInputDimensions(w, h, cfg)), downloadMs, initMs, timings, details, png: src.toDataURL() });
    }
    await session.release();
  }
  let gpu = { available: false, float16: false };
  if (navigator.gpu) { const adapter = await navigator.gpu.requestAdapter(); gpu = { available: !!adapter, float16: !!adapter?.features.has('shader-f16') }; }
  return { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, gpu, halftone, inference };
}, { astronaut: imageBytes.toString('base64'), ramp: rampBytes.toString('base64'), product: productBytes.toString('base64') });
for (const run of [...results.halftone, ...results.inference]) {
  if (run.png) { const filename = `${run.id || 'halftone'}-${run.name}.png`; await fs.writeFile(output + '/' + filename, Buffer.from(run.png.split(',')[1], 'base64')); delete run.png; }
  const sorted = [...run.timings].sort((a, b) => a - b); run.medianMs = sorted[Math.floor(sorted.length / 2)]; run.slowMs = sorted[sorted.length - 1];
}
results.hardware = { model: os.cpus()[0].model, memoryGB: os.totalmem() / 1024 ** 3, platform: os.platform(), arch: os.arch() };
await fs.writeFile(output + '/benchmarks.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
