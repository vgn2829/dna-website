// ─────────────────────────────────────────────────────────────────────────
// Moodboard starter layouts (Milestone B).
//
// A starter is PLAIN DATA — a list of shape specs in page coordinates. It is
// turned into real, ordinary tldraw shapes by applyStarterLayout
// (tldrawBoardTools.ts) the first time a freshly created, still-empty board
// opens. Nothing here is stored: no table, no column, no template row. Once
// applied the shapes are exactly what a user would have drawn by hand, so
// they save, sync, undo, export and preview like any other content, and the
// layout can be edited freely. Saved boards are never touched: a starter is
// only ever requested by the create flow (?starter=<id>) and only applied to
// a board that has no shapes.
//
// "Slots" are dashed rectangles labelled "Drop an image" — a visual hint,
// not a binding. Dragging an image onto one is just a normal canvas image.
// ─────────────────────────────────────────────────────────────────────────

export type StarterColor =
  | 'black' | 'grey' | 'light-violet' | 'violet' | 'blue' | 'light-blue'
  | 'yellow' | 'orange' | 'green' | 'light-green' | 'light-red' | 'red' | 'white';

export type StarterTextSize = 's' | 'm' | 'l' | 'xl';

export type StarterShape =
  | { kind: 'frame'; x: number; y: number; w: number; h: number; name: string; children: StarterShape[] }
  | { kind: 'text'; x: number; y: number; text: string; size?: StarterTextSize; color?: StarterColor }
  | { kind: 'note'; x: number; y: number; text: string; color?: StarterColor }
  | { kind: 'slot'; x: number; y: number; w: number; h: number; label?: string }
  | { kind: 'swatch'; x: number; y: number; w: number; h: number; color: StarterColor; label?: string };

export interface StarterLayout {
  id: string;
  name: string;
  description: string;
  /** Short creative use case shown under the name in the picker. */
  useCase: string;
  shapes: StarterShape[];
}

const GAP = 24;

/** `cols × rows` equal cells inside a box; returns each cell's rect. */
export function cellGrid(
  x: number, y: number, w: number, h: number, cols: number, rows: number, gap = GAP,
): Array<{ x: number; y: number; w: number; h: number }> {
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: Math.round(x + c * (cw + gap)), y: Math.round(y + r * (ch + gap)), w: Math.round(cw), h: Math.round(ch) });
    }
  }
  return out;
}

const slots = (cells: ReturnType<typeof cellGrid>, label = 'Drop an image'): StarterShape[] =>
  cells.map(c => ({ kind: 'slot', ...c, label }));

const inspiration: StarterLayout = {
  id: 'inspiration',
  name: 'Inspiration board',
  description: 'A loose reference wall: hero image, supporting images, keywords and a palette strip.',
  useCase: 'Collecting references for any project',
  shapes: [
    { kind: 'text', x: 0, y: -120, text: 'Inspiration', size: 'xl' },
    {
      kind: 'frame', x: 0, y: 0, w: 1040, h: 680, name: 'References',
      children: [
        { kind: 'slot', x: 24, y: 24, w: 480, h: 632, label: 'Hero image' },
        ...slots(cellGrid(528, 24, 488, 632, 2, 2)),
      ],
    },
    {
      kind: 'frame', x: 1080, y: 0, w: 320, h: 680, name: 'Keywords & notes',
      children: [
        { kind: 'note', x: 24, y: 24, text: 'Mood: …', color: 'yellow' },
        { kind: 'note', x: 24, y: 240, text: 'Keywords: …', color: 'light-blue' },
        { kind: 'note', x: 24, y: 456, text: 'What I like about it: …', color: 'light-green' },
      ],
    },
    {
      kind: 'frame', x: 0, y: 720, w: 1400, h: 140, name: 'Palette',
      children: ['black', 'grey', 'light-violet', 'light-blue', 'yellow'].map((color, i): StarterShape => (
        { kind: 'swatch', x: 24 + i * 272, y: 24, w: 248, h: 92, color: color as StarterColor }
      )),
    },
  ],
};

const palette: StarterLayout = {
  id: 'palette-type',
  name: 'Palette & typography',
  description: 'Five colour swatches with labels, plus heading and body type samples.',
  useCase: 'Defining a colour and type direction',
  shapes: [
    { kind: 'text', x: 0, y: -120, text: 'Palette & typography', size: 'xl' },
    {
      kind: 'frame', x: 0, y: 0, w: 1400, h: 360, name: 'Colour palette',
      children: (['blue', 'violet', 'light-red', 'yellow', 'green'] as StarterColor[]).map((color, i): StarterShape => (
        { kind: 'swatch', x: 24 + i * 272, y: 24, w: 248, h: 312, color, label: `Colour ${i + 1}` }
      )),
    },
    {
      kind: 'frame', x: 0, y: 400, w: 1400, h: 500, name: 'Typography',
      children: [
        { kind: 'text', x: 24, y: 24, text: 'Heading — The quick brown fox', size: 'xl' },
        { kind: 'text', x: 24, y: 120, text: 'Subheading — Jumps over the lazy dog', size: 'l' },
        { kind: 'text', x: 24, y: 200, text: 'Body — Write a short paragraph here to test how this typeface reads at body size.', size: 'm' },
        { kind: 'note', x: 24, y: 260, text: 'Typefaces used: …', color: 'yellow' },
        { kind: 'note', x: 264, y: 260, text: 'Why these work together: …', color: 'light-blue' },
      ],
    },
  ],
};

const character: StarterLayout = {
  id: 'character-sheet',
  name: 'Character sheet',
  description: 'Front, side and back views, an expression grid, and notes for traits and props.',
  useCase: 'Character and costume design',
  shapes: [
    { kind: 'text', x: 0, y: -120, text: 'Character sheet', size: 'xl' },
    {
      kind: 'frame', x: 0, y: 0, w: 1200, h: 620, name: 'Turnaround',
      children: ['Front', 'Side', 'Back'].map((label, i): StarterShape => (
        { kind: 'slot', x: 24 + i * 392, y: 24, w: 368, h: 572, label }
      )),
    },
    {
      kind: 'frame', x: 1240, y: 0, w: 560, h: 620, name: 'Expressions',
      children: slots(cellGrid(24, 24, 512, 572, 2, 3), 'Expression'),
    },
    {
      kind: 'frame', x: 0, y: 660, w: 1800, h: 300, name: 'Notes',
      children: [
        { kind: 'note', x: 24, y: 24, text: 'Personality: …', color: 'yellow' },
        { kind: 'note', x: 264, y: 24, text: 'Backstory: …', color: 'light-blue' },
        { kind: 'note', x: 504, y: 24, text: 'Props & costume: …', color: 'light-green' },
        { kind: 'note', x: 744, y: 24, text: 'Reference: …', color: 'light-violet' },
      ],
    },
  ],
};

const brand: StarterLayout = {
  id: 'brand-identity',
  name: 'Brand identity',
  description: 'Logo, palette, type, and application mock-up slots for a small identity project.',
  useCase: 'Logos, branding and identity work',
  shapes: [
    { kind: 'text', x: 0, y: -120, text: 'Brand identity', size: 'xl' },
    { kind: 'frame', x: 0, y: 0, w: 560, h: 480, name: 'Logo', children: [{ kind: 'slot', x: 24, y: 24, w: 512, h: 432, label: 'Primary logo' }] },
    {
      kind: 'frame', x: 600, y: 0, w: 560, h: 480, name: 'Colour',
      children: (['black', 'blue', 'light-blue', 'yellow'] as StarterColor[]).map((color, i): StarterShape => (
        { kind: 'swatch', x: 24 + (i % 2) * 260, y: 24 + Math.floor(i / 2) * 224, w: 252, h: 208, color }
      )),
    },
    {
      kind: 'frame', x: 1200, y: 0, w: 400, h: 480, name: 'Typography',
      children: [
        { kind: 'text', x: 24, y: 24, text: 'Aa', size: 'xl' },
        { kind: 'text', x: 24, y: 120, text: 'Primary typeface: …', size: 'm' },
        { kind: 'text', x: 24, y: 180, text: 'Secondary typeface: …', size: 'm' },
      ],
    },
    {
      kind: 'frame', x: 0, y: 520, w: 1600, h: 380, name: 'Applications',
      children: slots(cellGrid(24, 24, 1552, 332, 3, 1), 'Mock-up'),
    },
  ],
};

const storyboard: StarterLayout = {
  id: 'storyboard',
  name: 'Storyboard',
  description: 'Six numbered panels with a caption note under each, for sequencing a short piece.',
  useCase: 'Animation, comics and video planning',
  shapes: [
    { kind: 'text', x: 0, y: -120, text: 'Storyboard', size: 'xl' },
    ...cellGrid(0, 0, 1500, 1180, 3, 2, 40).flatMap((cell, i): StarterShape[] => [
      {
        kind: 'frame', x: cell.x, y: cell.y, w: cell.w, h: cell.h, name: `Panel ${i + 1}`,
        children: [
          { kind: 'slot', x: 16, y: 16, w: cell.w - 32, h: cell.h - 240, label: 'Sketch or frame' },
          { kind: 'note', x: 16, y: cell.h - 220, text: 'Action / dialogue: …', color: 'yellow' },
        ],
      },
    ]),
  ],
};

const brief: StarterLayout = {
  id: 'project-brief',
  name: 'Project brief & critique',
  description: 'Goal, audience, constraints, references and next steps in four labelled columns.',
  useCase: 'Planning a piece or gathering feedback',
  shapes: [
    { kind: 'text', x: 0, y: -120, text: 'Project brief', size: 'xl' },
    ...(['Goal', 'Audience', 'References', 'Next steps'] as const).map((name, i): StarterShape => ({
      kind: 'frame', x: i * 360, y: 0, w: 336, h: 640, name,
      children: i === 2
        ? slots(cellGrid(16, 16, 304, 608, 1, 3), 'Reference')
        : [
          { kind: 'note', x: 16, y: 16, text: `${name}: …`, color: (['yellow', 'light-blue', 'light-green', 'light-violet'] as StarterColor[])[i] },
        ],
    })),
  ],
};

export const STARTER_LAYOUTS: readonly StarterLayout[] = [inspiration, palette, character, brand, storyboard, brief];

export function getStarterLayout(id: string | null | undefined): StarterLayout | null {
  if (!id) return null;
  return STARTER_LAYOUTS.find(s => s.id === id) ?? null;
}

/** Total shape count, frame children included (what the board will report). */
export function countStarterShapes(shapes: readonly StarterShape[]): number {
  return shapes.reduce((n, s) => n + 1 + (s.kind === 'frame' ? countStarterShapes(s.children) : 0), 0);
}
