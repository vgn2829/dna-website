/// <reference lib="webworker" />
import { halftoneGeometry, paintHalftone, halftoneSvg, type HalftoneOptions } from './halftone-logic';
self.onmessage = async (event: MessageEvent<{ image: ImageData; options: HalftoneOptions; format: 'png' | 'svg' }>) => {
  try {
    const { image, options, format } = event.data;
    self.postMessage({ phase: 'Sampling screen cells' });
    const geometry = halftoneGeometry(image, options);
    self.postMessage({ phase: 'Rendering output' });
    let blob: Blob;
    if (format === 'svg') blob = new Blob([halftoneSvg(geometry, options)], { type: 'image/svg+xml' });
    else {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas rendering unavailable');
      paintHalftone(context, geometry, options);
      blob = await canvas.convertToBlob({ type: 'image/png' });
    }
    self.postMessage({ blob });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Rendering failed' }); }
};
