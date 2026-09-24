import type { CanvasPreview, CanvasPreviewItem } from '../lib/api';

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

// Only the first few images load real pixels (each is a full-size asset
// URL); the rest render as tiles so a card never pulls dozens of images.
const MAX_IMAGES = 8;

function Item({ it, showImage }: { it: CanvasPreviewItem; showImage: boolean }) {
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
          {it.src && showImage
            ? <image href={it.src} width={it.w} height={it.h} preserveAspectRatio="xMidYMid slice" />
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

export function BoardPreview({ preview, label }: { preview: CanvasPreview; label: string }) {
  // Pad the content bounds a little and never zoom in past 1:1 on a tiny
  // board (a single small shape shouldn't fill the whole card).
  const minW = 480, minH = 270;
  const w = Math.max(preview.w, minW), h = Math.max(preview.h, minH);
  const pad = Math.max(w, h) * 0.06;
  const vx = preview.x - (w - preview.w) / 2 - pad;
  const vy = preview.y - (h - preview.h) / 2 - pad;
  let images = 0;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${vx} ${vy} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    >
      {preview.items.map((it, i) => {
        const showImage = it.k === 'image' && !!it.src && /^https?:\/\//i.test(it.src) && images++ < MAX_IMAGES;
        return <Item key={i} it={it} showImage={showImage} />;
      })}
    </svg>
  );
}
