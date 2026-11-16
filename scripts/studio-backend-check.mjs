import fs from 'node:fs/promises';
const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.STUDIO_CHROMIUM_EXECUTABLE, headless: true });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
const encoded = (await fs.readFile('docs/studio-validation/fixtures/astronaut.png')).toString('base64');
const result = await page.evaluate(async encoded => {
  const gpu = navigator.gpu && await navigator.gpu.requestAdapter(); if (!gpu) return { available: false };
  const ort = await import('/node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'); ort.env.wasm.numThreads = 1;
  const { MODELS } = await import('/src/app/components/background-removal/models.ts');
  const { toInputTensor, modelInputDimensions } = await import('/src/app/components/background-removal/preprocess.ts');
  const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
  const canvas = new OffscreenCanvas(384, 512); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 64, 0, 384, 512, 0, 0, 384, 512); const pixels = ctx.getImageData(0, 0, 384, 512);
  const results = [];
  for (const model of ['general', 'portrait']) {
    const cfg = MODELS[model], dim = modelInputDimensions(384, 512, cfg); const weights = await (await fetch(cfg.url)).arrayBuffer();
    const input = new ort.Tensor('float32', toInputTensor(pixels.data, 384, 512, cfg), [1, 3, dim.height, dim.width]);
    let baseline;
    for (const backend of ['wasm', 'webgpu']) {
      try {
        const start = performance.now(); const session = await ort.InferenceSession.create(weights, { executionProviders: [backend], graphOptimizationLevel: 'all' }); const initMs = performance.now() - start;
        const times = [];
        for (let i = 0; i < 3; i++) {
          const start = performance.now(); const outputs = await session.run({ [session.inputNames[0]]: input }, [session.outputNames[0]]); times.push(performance.now() - start);
          const data = outputs[session.outputNames[0]].data;
          if (backend === 'wasm') baseline = new Float32Array(data);
          else {
            let maxError = 0, sum = 0; for (let j = 0; j < data.length; j++) { const error = Math.abs(data[j] - baseline[j]); maxError = Math.max(maxError, error); sum += error; }
            if (i === 2) results.push({ model, backend, initMs, times, maxError, meanError: sum / data.length });
          }
          Object.values(outputs).forEach(v => v.dispose());
        }
        if (backend === 'wasm') results.push({ model, backend, initMs, times });
        await session.release();
      } catch (error) { results.push({ model, backend, error: error.message }); }
    }
    input.dispose();
  }
  return { available: true, float16: gpu.features.has('shader-f16'), maxStorageBuffers: gpu.limits.maxStorageBuffersPerShaderStage, results };
}, encoded);
await browser.close(); await fs.writeFile('docs/studio-validation/backend-results.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
