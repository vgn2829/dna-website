export interface HalftoneOptions {
  type: 'lines' | 'dots' | 'squares'; frequency: number; angle: number; contrast: number;
  brightness: number; inverted: boolean; resolution: number; color: string;
  backgroundColor: string; minWidth: number; maxWidth: number;
}
export interface HalftoneGeometry { width: number; height: number; angle: number; shapes: { x: number; y: number; width: number; height: number; radius?: number }[] }
const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** Radius in cell units. Accounts for disk overlap above pi/4 coverage. */
export function dotRadius(coverage: number) {
  const target = clamp(coverage);
  if (!target) return 0;
  let lo = 0, hi = Math.SQRT1_2;
  for (let i = 0; i < 24; i++) {
    const r = (lo + hi) / 2;
    const area = Math.PI * r * r - (r > .5 ? 4 * (r * r * Math.acos(.5 / r) - .5 * Math.sqrt(r * r - .25)) : 0);
    if (area < target) lo = r; else hi = r;
  }
  return (lo + hi) / 2;
}
const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
/** Pattern dimensions are in 700px reference-long-edge units, identical at every export size. */
export function halftoneGeometry(image: ImageData, options: HalftoneOptions): HalftoneGeometry {
  const { width, height, data } = image;
  if (!width || !height || width * height > 16_000_000 || Math.max(width, height) > 8192) throw new Error('Export limit: 16 megapixels and 8192px per edge');
  if (![options.frequency, options.resolution, options.angle, options.contrast, options.brightness, options.minWidth, options.maxWidth].every(Number.isFinite) || options.frequency < 1 || options.resolution < 1) throw new Error('Invalid halftone settings');
  if (!/^#[0-9a-f]{6}$/i.test(options.color) || !/^#[0-9a-f]{6}$/i.test(options.backgroundColor)) throw new Error('Invalid ink or paper colour');
  const scale = Math.max(width, height) / 700;
  const dy = options.frequency * scale, dx = options.type === 'lines' ? options.resolution * scale : dy;
  const radians = options.angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const boundX = (Math.abs(width * cos) + Math.abs(height * sin)) / 2;
  const boundY = (Math.abs(width * sin) + Math.abs(height * cos)) / 2;
  const nx = Math.ceil(boundX / dx) + 1, ny = Math.ceil(boundY / dy) + 1;
  const columns = nx * 2 + 1, rows = ny * 2 + 1;
  if (columns * rows > 150_000) throw new Error('Pattern exceeds 150,000 cells. Increase spacing/detail step.');
  const alphas = new Float64Array(columns * rows);
  const sums = new Float64Array(columns * rows), counts = new Uint32Array(columns * rows);
  const table = Float64Array.from({ length: 256 }, (_, i) => linear(i / 255));
  // Inverse-rotate every source pixel into its screen cell. O(pixels + cells), no repeated neighbourhood reads.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + .5 - width / 2, py = y + .5 - height / 2;
    const ix = Math.round((px * cos + py * sin) / dx) + nx;
    const iy = Math.round((-px * sin + py * cos) / dy) + ny;
    const cell = iy * columns + ix, i = (y * width + x) * 4, alpha = data[i + 3] / 255;
    const value = .2126 * table[data[i]] + .7152 * table[data[i + 1]] + .0722 * table[data[i + 2]];
    sums[cell] += value * alpha; alphas[cell] += alpha; counts[cell]++;
  }
  const shapes: HalftoneGeometry['shapes'] = [];
  for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < columns; ix++) {
    const index = iy * columns + ix;
    if (!counts[index] || !alphas[index]) continue;
    const brightness = clamp((sums[index] / alphas[index] - .5) * options.contrast / 100 + .5 + (options.brightness - 100) / 100);
    const tone = options.inverted ? brightness : 1 - brightness;
    const coverage = clamp(options.minWidth + tone * (options.maxWidth - options.minWidth)) * alphas[index] / counts[index];
    if (coverage <= 0) continue;
    const x = (ix - nx) * dx, y = (iy - ny) * dy;
    if (options.type === 'dots') shapes.push({ x, y, width: dy, height: dy, radius: dotRadius(coverage) * dy });
    else if (options.type === 'squares') { const side = Math.sqrt(coverage) * dy; shapes.push({ x, y, width: side, height: side }); }
    else shapes.push({ x, y, width: dx + .01 * scale, height: coverage * dy });
  }
  return { width, height, angle: options.angle, shapes };
}
export function paintHalftone(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, geometry: HalftoneGeometry, options: HalftoneOptions) {
  ctx.fillStyle = options.backgroundColor; ctx.fillRect(0, 0, geometry.width, geometry.height);
  ctx.save(); ctx.translate(geometry.width / 2, geometry.height / 2); ctx.rotate(geometry.angle * Math.PI / 180); ctx.fillStyle = options.color;
  if (geometry.shapes[0]?.radius != null) {
    // Large overlapping compound circle paths are much slower in Skia; individual disks preserve geometry.
    for (const shape of geometry.shapes) { ctx.beginPath(); ctx.arc(shape.x, shape.y, shape.radius!, 0, 2 * Math.PI); ctx.fill(); }
  } else {
    ctx.beginPath();
    for (const shape of geometry.shapes) ctx.rect(shape.x - shape.width / 2, shape.y - shape.height / 2, shape.width, shape.height);
    // Compound rectangles avoid antialias seams between fully covered adjacent cells.
    ctx.fill();
  }
  ctx.restore();
}
export function processHalftone(ctx: CanvasRenderingContext2D, width: number, height: number, image: ImageData, options: HalftoneOptions) {
  if (width !== image.width || height !== image.height) throw new Error('Source dimensions mismatch');
  paintHalftone(ctx, halftoneGeometry(image, options), options);
}
export function halftoneSvg(geometry: HalftoneGeometry, options: HalftoneOptions) {
  const n = (v: number) => Number(v.toFixed(4));
  const shapes = geometry.shapes[0]?.radius != null
    ? geometry.shapes.map(s => `<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(s.radius!)}"/>`).join('')
    : `<path d="${geometry.shapes.map(s => `M${n(s.x - s.width / 2)} ${n(s.y - s.height / 2)}h${n(s.width)}v${n(s.height)}h${n(-s.width)}Z`).join('')}"/>`;
  // Match the raster compound fill, including fully covered rotated cell boundaries.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}"><rect width="100%" height="100%" fill="${options.backgroundColor}"/><g fill="${options.color}" transform="translate(${geometry.width / 2} ${geometry.height / 2}) rotate(${geometry.angle})">${shapes}</g></svg>`;
}
