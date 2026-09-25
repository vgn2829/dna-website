import { useState } from 'react';
import type { CanvasPreview, CanvasPreviewItem } from '../lib/api';
import { planPreviewImages, previewImageFallback, type PreviewImage } from '../lib/boardPreview';

// ─────────────────────────────────────────────────────────────────────────
// Moodboard card preview. Draws the small list of primitives the backend
// derives from the board's persisted tldraw snapshot at save time
// (backend/src/lib/canvasSummary.ts) as an inline SVG — no tldraw, no
// board document download, no image rendering service. Text goes through
// React (escaped); image hrefs are http(s) only (also enforced server-side).
// ─────────────────────────────────────────────────────────────────────────

// tldraw's named colors. 'black' / 'grey' follow the app theme so strokes
// stay visible on the dark card surface.
const COLORS: Record<string, string> = {
  black: 'var(--color-ink)',
  grey: 'var(--color-ink-muted)',
  white: '#ffffff',
  blue: '#4465e9',
  'light-blue': '#4ba1f1',
  violet: '#ae3ec9',
  'light-violet': '#e085f4',
  red: '#e03131',
  'light-red': '#ff8787',
  orange: '#e16919',
  yellow: '#f1ac4b',
  green: '#099268',
  'light-green': '#40c057',
};
const color = (c?: string) => COLORS[c ?? ''] ?? COLORS.black;

// Which images draw real pixels (the first MAX_PREVIEW_IMAGES), and from
// which URL (the server's t512 thumbnail when ready, else the original):
// see lib/boardPreview.ts. The rest render as tiles.

// A preview image that falls back to its original, once, if the
// thumbnail fails to load (keyed by href in Item, so a new href remounts).
function PreviewImageEl({ image, w, h }: { image: PreviewImage; w: number; h: number }) {
  const [href, setHref] = useState(image.href);
  return (
    <image
      href={href}
      width={w}
      height={h}
      preserveAspectRatio="xMidYMid slice"
      onError={() => {
        const fallback = previewImageFallback(image, href);
        if (fallback) setHref(fallback);
      }}
    />
  );
}

function Item({ it, image, loadImages }: { it: CanvasPreviewItem; image: PreviewImage | null; loadImages: boolean }) {
  const deg = (it.r * 180) / Math.PI;
  const transform = `translate(${it.x} ${it.y})${deg ? ` rotate(${deg})` : ''}`;
  const stroke = color(it.c);
  const label = (text: string | undefined, size: number, fill: string, w: number, h: number) =>
    text ? (
      <text x={w / 2} y={h / 2} fontSize={size} fill={fill} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-body)">
        {text.split('\n')[0].slice(0, 40)}
      </text>
    ) : null;

  switch (it.k) {
    case 'geo': {
      const fillOpacity = it.f === 'solid' ? 0.85 : it.f === 'semi' || it.f === 'pattern' ? 0.3 : 0;
      const common = { fill: fillOpacity ? stroke : 'none', fillOpacity, stroke, strokeWidth: 2, vectorEffect: 'non-scaling-stroke' as const };
      const ellipse = it.g === 'ellipse' || it.g === 'oval';
      return (
        <g transform={transform}>
          {ellipse
            ? <ellipse cx={it.w / 2} cy={it.h / 2} rx={it.w / 2} ry={it.h / 2} {...common} />
            : <rect width={it.w} height={it.h} rx={Math.min(8, it.w / 8)} {...common} />}
          {label(it.t, Math.min(24, it.h / 2.5), it.f === 'solid' ? '#fff' : stroke, it.w, it.h)}
        </g>
      );
    }
    case 'frame':
      return (
        <g transform={transform}>
          <rect width={it.w} height={it.h} fill="var(--color-surface-1)" stroke="var(--color-hairline)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      );
    case 'image':
      return (
        <g transform={transform}>
          {image && loadImages
            ? <PreviewImageEl key={image.href} image={image} w={it.w} h={it.h} />
            : <rect width={it.w} height={it.h} fill="var(--color-surface-1)" stroke="var(--color-hairline)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </g>
      );
    case 'note':
      return (
        <g transform={transform}>
          <rect width={it.w} height={it.h} rx={6} fill={color(it.c)} fillOpacity={0.9} />
          {label(it.t, 22, '#1a1a1a', it.w, it.h)}
        </g>
      );
    case 'text': {
      const fs = it.fs ?? 24;
      return (
        <g transform={transform}>
          <text fontSize={fs} fill={stroke} fontFamily="var(--font-body)" fontWeight={500}>
            {(it.t ?? '').split('\n').slice(0, 4).map((line, i) => (
              <tspan key={i} x={0} dy={i === 0 ? fs : fs * 1.3}>{line.slice(0, 40)}</tspan>
            ))}
          </text>
        </g>
      );
    }
    case 'path': {
      const pts = it.p ?? [];
      const points = Array.from({ length: pts.length / 2 }, (_, i) => `${pts[2 * i]},${pts[2 * i + 1]}`).join(' ');
      return (
        <g transform={transform}>
          <polyline
            points={points} fill="none" stroke={stroke} strokeOpacity={it.hl ? 0.35 : 1}
            strokeWidth={it.hl ? 6 : 2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    }
    default:
      return (
        <g transform={transform}>
          <rect width={it.w} height={it.h} fill="var(--color-surface-1)" stroke="var(--color-hairline)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </g>
      );
  }
}

// `thumbnails`: the board's read-time preview_thumbnails (original src →
// t512 URL). `loadImages`: false while the card is far off-screen
// (BoardCard) — image items then draw as tiles, so nothing is fetched.
export function BoardPreview({ preview, label, thumbnails, loadImages = true }: {
  preview: CanvasPreview;
  label: string;
  thumbnails?: Record<string, string>;
  loadImages?: boolean;
}) {
  // Pad the content bounds a little and never zoom in past 1:1 on a tiny
  // board (a single small shape shouldn't fill the whole card).
  const minW = 480, minH = 270;
  const w = Math.max(preview.w, minW), h = Math.max(preview.h, minH);
  const pad = Math.max(w, h) * 0.06;
  const vx = preview.x - (w - preview.w) / 2 - pad;
  const vy = preview.y - (h - preview.h) / 2 - pad;
  const images = planPreviewImages(preview.items, thumbnails);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${vx} ${vy} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    >
      {preview.items.map((it, i) => <Item key={i} it={it} image={images[i]} loadImages={loadImages} />)}
    </svg>
  );
}
