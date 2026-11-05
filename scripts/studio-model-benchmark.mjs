import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': 'http://127.0.0.1:5173' }); createReadStream('/tmp/dna-studio-validation/birefnet-lite.onnx').pipe(response); });
await new Promise(resolve => server.listen(5174, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.STUDIO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.STUDIO_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage();
page.on('console', message => console.log(message.type(), message.text().slice(0, 400)));
page.on('pageerror', error => console.log('pageerror', error.message));

await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
const encoded = (await fs.readFile('docs/studio-validation/fixtures/astronaut.png')).toString('base64');
let timeout;
let result;
try {
  result = await Promise.race([page.evaluate(async encoded => {
    const gpu = navigator.gpu && await navigator.gpu.requestAdapter();
    const capabilities = { gpu: !!gpu, float16: !!gpu?.features.has('shader-f16'), maxStorageBuffers: gpu?.limits.maxStorageBuffersPerShaderStage };
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const inputCanvas = new OffscreenCanvas(1024, 1024), ctx = inputCanvas.getContext('2d'); ctx.drawImage(image, 0, 0, 1024, 1024);
    const pixels = ctx.getImageData(0, 0, 1024, 1024), tensor = new Float32Array(3 * 1024 * 1024), means = [.485, .456, .406], std = [.229, .224, .225];
    for (let i = 0; i < 1024 * 1024; i++) for (let channel = 0; channel < 3; channel++) tensor[channel * 1024 * 1024 + i] = (pixels.data[i * 4 + channel] / 255 - means[channel]) / std[channel];
    const downloadStart = performance.now(); const weights = await (await fetch('http://127.0.0.1:5174/model.onnx')).arrayBuffer(); const downloadMs = performance.now() - downloadStart;
    const results = [];
    for (const backend of capabilities.gpu ? ['webgpu'] : ['wasm']) {
      try {
        const ort = await import(backend === 'webgpu' ? '/node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs' : '/node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs');
        ort.env.wasm.numThreads = 1;
        if (backend === 'webgpu') ort.env.webgpu.device = await gpu.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: gpu.limits.maxStorageBuffersPerShaderStage } });
        console.log('Initializing BiRefNet Lite', backend);
        const initStart = performance.now(); const session = await ort.InferenceSession.create(weights, { executionProviders: [backend], graphOptimizationLevel: 'all' }); const initMs = performance.now() - initStart;
        const input = new ort.Tensor('float32', tensor, [1, 3, 1024, 1024]), timings = []; let png;
        for (let run = 0; run < 3; run++) {
          console.log('Running BiRefNet Lite', backend, run);
          const inferStart = performance.now(); const output = await session.run({ [session.inputNames[0]]: input }, [session.outputNames[0]]); timings.push(performance.now() - inferStart);
          const mask = output[session.outputNames[0]].data;
          const rgba = new Uint8ClampedArray(1024 * 1024 * 4); for (let i = 0; i < mask.length; i++) rgba.set([255, 255, 255, Math.round(255 / (1 + Math.exp(-mask[i])))], i * 4);
          const matte = new OffscreenCanvas(1024, 1024); matte.getContext('2d').putImageData(new ImageData(rgba, 1024, 1024), 0, 0);
          const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512; const c = canvas.getContext('2d'); c.drawImage(image, 0, 0); c.globalCompositeOperation = 'destination-in'; c.drawImage(matte, 0, 0, 512, 512); png = canvas.toDataURL();
          Object.values(output).forEach(value => value.dispose());
        }
        input.dispose(); await session.release(); results.push({ backend, initMs, timings, png });
      } catch (error) { results.push({ backend, error: error.message }); }
    }
    return { capabilities, downloadMs, results };
  }, encoded), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('BiRefNet comparison exceeded the 180-second test limit')), 180000); })]);
} catch (error) { result = { error: error.message }; }
finally { clearTimeout(timeout); await browser.close(); server.close(); }
if (result.results) for (const run of result.results) { if (run.png) { await fs.writeFile(`docs/studio-validation/birefnet-lite-${run.backend}.png`, Buffer.from(run.png.split(',')[1], 'base64')); delete run.png; } }
result.hardware = { cpu: os.cpus()[0].model, memoryGB: os.totalmem() / 1024 ** 3 };
await fs.writeFile('docs/studio-validation/birefnet-results.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
