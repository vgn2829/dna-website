export interface HalftoneOptions {
  type: 'lines' | 'dots' | 'squares';
  frequency: number;
  angle: number;
  contrast: number;
  brightness: number;
  inverted: boolean;
  resolution: number;
  color: string;
  backgroundColor: string;
  minWidth: number;
  maxWidth: number;
}

export function processHalftone(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  imgData: ImageData,
  options: HalftoneOptions
) {
  const { type, frequency, angle, contrast, brightness, inverted, resolution, color, backgroundColor, minWidth, maxWidth } = options;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  const rad = (angle * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const diag = Math.sqrt(width * width + height * height);
  const halfDiag = diag / 2;
  const cx = width / 2;
  const cy = height / 2;
  const getBrightness = (x: number, y: number) => {
    const srcX = Math.round(x * cos - y * sin + cx);
    const srcY = Math.round(x * sin + y * cos + cy);
    if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) return 0;
    const idx = (srcY * width + srcX) * 4;
    const r = imgData.data[idx];
    const g = imgData.data[idx + 1];
    const b = imgData.data[idx + 2];
    let val = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    val = (val - 0.5) * (contrast / 100) + 0.5 + (brightness - 100) / 100;
    return Math.max(0, Math.min(1, val));
  };
  const getWidth = (bright: number) => {
    let t = inverted ? bright : 1 - bright;
    t = minWidth + t * (maxWidth - minWidth);
    return Math.max(0, Math.min(1, t));
  };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  const limit = halfDiag;
  if (type === 'lines') {
    for (let y = -limit; y <= limit; y += frequency) {
      for (let x = -limit - frequency; x <= limit + frequency; x += resolution) {
        let sum = 0; let count = 0;
        const step = resolution / 3;
        for (let i = 0; i < 3; i++) { sum += getBrightness(x + i * step, y); count++; }
        const bright = sum / count;
        let w = getWidth(bright) * frequency;
        w = Math.round(w);
        if (w > 0) ctx.fillRect(x, y - w / 2, resolution + 0.2, w);
      }
    }
  } else if (type === 'dots' || type === 'squares') {
    for (let y = -limit; y <= limit; y += frequency) {
      for (let x = -limit; x <= limit; x += frequency) {
        const bright = getBrightness(x, y);
        const size = getWidth(bright) * frequency;
        if (size <= 0.5) continue;
        if (type === 'dots') {
          ctx.beginPath();
          ctx.arc(x, y, size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
    }
  }
  ctx.restore();
}
