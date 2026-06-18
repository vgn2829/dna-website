#!/usr/bin/env node
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function test(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓  ${name}`);
    passed++;
  } else {
    console.log(`  ✗  ${name}`);
    if (detail) console.log(`       → ${detail}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`);
}

// ─── Build engine from source ─────────────────────────────────────────────────
// PaletteStudio.tsx exports pure-JS engine functions alongside a React component.
// esbuild strips JSX/TS; react stays external so the module loads in Node.
// Bundle into tests/ so Node's CJS resolver can climb up to node_modules/react
const src = path.resolve(__dirname, '../src/app/components/PaletteStudio.tsx');
const tmp = path.join(__dirname, `.palette-bundle-${Date.now()}.cjs`);

await esbuild.build({
  entryPoints: [src],
  bundle:      true,
  format:      'cjs',
  outfile:     tmp,
  platform:    'node',
  jsx:         'automatic',
  external:    ['react', 'react/jsx-runtime'],
  logLevel:    'silent',
});

const require = createRequire(import.meta.url);
let derivePalette, scorePalette, analyzeCB, HARMONY_MODES;
try {
  const eng     = require(tmp);
  derivePalette = eng.derivePalette;
  scorePalette  = eng.scorePalette;
  analyzeCB     = eng.analyzeCB;
  HARMONY_MODES = eng.HARMONY_MODES;
} finally {
  // clean up temp bundle regardless of load outcome
  import('fs').then(({ unlinkSync }) => { try { unlinkSync(tmp); } catch {} });
}

// ─── Local helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255,
  };
}
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToOKLCH(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  const l  = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m  = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073970466 * bl;
  const s  = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L  = 0.2104542553 * l_ + 0.793617785  * m_ - 0.0040720468 * s_;
  const a  = 1.9779984951 * l_ - 2.428592205  * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766  * s_;
  const C  = Math.sqrt(a * a + b2 * b2);
  let H    = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}
function wcagLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function wcagContrast(hex1, hex2) {
  const l1 = wcagLuminance(hex1), l2 = wcagLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function hueDiff(a, b) {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}
function isValidHex(hex) {
  return typeof hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(hex);
}

const PALETTE_KEYS = [
  'bg', 'surface', 'surfaceElevated', 'text', 'textMuted', 'border',
  'primary', 'primaryFg', 'secondary', 'accent',
  'success', 'successBg', 'warning', 'warningBg',
  'error', 'errorBg', 'info', 'infoBg',
];

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 1 — HARMONY CORRECTNESS
// ─────────────────────────────────────────────────────────────────────────────
section('HARMONY CORRECTNESS');

const SEED    = '#6366F1';
const seedHue = hexToOKLCH(SEED).H;

const EXPECTED_OFFSETS = {
  complementary:      { sec: 180, acc: 150 },
  analogous:          { sec: 30,  acc: 330 },   // 330° = −30° mod 360
  triadic:            { sec: 120, acc: 240 },
  splitComplementary: { sec: 150, acc: 210 },
  tetradic:           { sec: 90,  acc: 270 },
};

for (const [mode, off] of Object.entries(EXPECTED_OFFSETS)) {
  const p       = derivePalette(SEED, false, mode);
  const secH    = hexToOKLCH(p.secondary).H;
  const accH    = hexToOKLCH(p.accent).H;
  const expSec  = (seedHue + off.sec) % 360;
  const expAcc  = (seedHue + off.acc) % 360;
  const secDiff = hueDiff(secH, expSec);
  const accDiff = hueDiff(accH, expAcc);

  test(
    `[${mode}] secondary hue ±5° of +${off.sec}°`,
    secDiff <= 5,
    `actual=${secH.toFixed(2)}°  expected≈${expSec.toFixed(2)}°  diff=${secDiff.toFixed(2)}°`
  );
  test(
    `[${mode}] accent hue ±5° of +${off.acc}°`,
    accDiff <= 5,
    `actual=${accH.toFixed(2)}°  expected≈${expAcc.toFixed(2)}°  diff=${accDiff.toFixed(2)}°`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 2 — CONTRAST CORRECTNESS
// ─────────────────────────────────────────────────────────────────────────────
section('CONTRAST CORRECTNESS');

for (const mode of Object.keys(HARMONY_MODES)) {
  for (const dark of [false, true]) {
    const p   = derivePalette(SEED, dark, mode);
    const tag = `[${mode}/${dark ? 'dark' : 'light'}]`;

    const textBg  = wcagContrast(p.text,      p.bg);
    const primBg  = wcagContrast(p.primary,   p.bg);
    const fgPrim  = wcagContrast(p.primaryFg, p.primary);
    const mutedBg = wcagContrast(p.textMuted, p.bg);

    test(`${tag} text/bg ≥4.5 (WCAG AA)`,           textBg  >= 4.5, `got ${textBg.toFixed(2)}`);
    test(`${tag} primary/bg ≥4.5 (WCAG AA)`,        primBg  >= 4.5, `got ${primBg.toFixed(2)}`);
    test(`${tag} primaryFg/primary ≥4.5 (WCAG AA)`, fgPrim  >= 4.5, `got ${fgPrim.toFixed(2)}`);
    test(`${tag} textMuted/bg ≥3.0 (AA Large)`,     mutedBg >= 3.0, `got ${mutedBg.toFixed(2)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 3 — GAMUT CORRECTNESS
// ─────────────────────────────────────────────────────────────────────────────
section('GAMUT CORRECTNESS  (5 seeds × 5 modes × light+dark)');

const SEEDS = ['#6366F1', '#FF006E', '#00C853', '#FF6B00', '#0EA5E9'];

for (const seed of SEEDS) {
  for (const mode of Object.keys(HARMONY_MODES)) {
    for (const dark of [false, true]) {
      const p   = derivePalette(seed, dark, mode);
      const tag = `[${seed}/${mode}/${dark ? 'dark' : 'light'}]`;
      const bad = [];

      for (const key of PALETTE_KEYS) {
        const hex = p[key];
        if (!isValidHex(hex)) {
          bad.push(`${key}="${hex}" (invalid 7-char hex)`);
          continue;
        }
        const { r, g, b } = hexToRgb(hex);
        const ri = Math.round(r * 255), gi = Math.round(g * 255), bi = Math.round(b * 255);
        if (ri < 0 || ri > 255 || gi < 0 || gi > 255 || bi < 0 || bi > 255) {
          bad.push(`${key}=${hex} channels out of [0,255]`);
        }
      }

      test(`${tag} all 18 slots valid + in-gamut`, bad.length === 0, bad.join('; '));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 4 — LOCK CORRECTNESS
// ─────────────────────────────────────────────────────────────────────────────
section('LOCK CORRECTNESS');

const baseP  = derivePalette('#6366F1', false, 'complementary');
const locked = { primary: baseP.primary, accent: baseP.accent };
const regenP = derivePalette('#FF006E', true, 'triadic', locked);

test(
  'locked primary byte-identical after seed+mode change',
  regenP.primary === baseP.primary,
  `original=${baseP.primary}  got=${regenP.primary}`
);
test(
  'locked accent byte-identical after seed+mode change',
  regenP.accent === baseP.accent,
  `original=${baseP.accent}  got=${regenP.accent}`
);

const NON_LOCKED = PALETTE_KEYS.filter(k => k !== 'primary' && k !== 'accent');
const unchanged  = NON_LOCKED.filter(k => regenP[k] === baseP[k]);

test(
  'all non-locked slots changed after seed+darkMode+mode change',
  unchanged.length === 0,
  `unchanged: ${unchanged.map(k => `${k}=${regenP[k]}`).join(', ')}`
);

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 5 — SCORE SANITY
// ─────────────────────────────────────────────────────────────────────────────
section('SCORE SANITY');

for (const mode of Object.keys(HARMONY_MODES)) {
  const p = derivePalette(SEED, false, mode);
  const f = scorePalette(p);
  test(`[${mode}] score in [0,100]`,  f.score  >= 0 && f.score  <= 100, `got ${f.score}`);
  test(`[${mode}] dScore in [0,100]`, f.dScore >= 0 && f.dScore <= 100, `got ${f.dScore}`);
}

const qualP = derivePalette(SEED, false, 'complementary');
const qualF = scorePalette(qualP);
test('AA-compliant palette scores ≥70', qualF.score >= 70,
  `got ${qualF.score}/100  (dScore=${qualF.dScore})`);
test('scorePalette returns pairs object with ≥6 entries',
  qualF.pairs && Object.keys(qualF.pairs).length >= 6,
  `keys: ${Object.keys(qualF.pairs || {}).join(', ')}`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST GROUP 6 — COLOR BLIND ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
section('COLOR BLIND ANALYSIS');

const cbPal = derivePalette(SEED, false, 'complementary');
const cb    = analyzeCB(cbPal);
const CB_TYPES = ['protanopia', 'deuteranopia', 'tritanopia'];

for (const type of CB_TYPES) {
  test(`analyzeCB returns ${type}`, type in cb, `keys=${Object.keys(cb).join(', ')}`);
}
for (const type of CB_TYPES) {
  const d   = cb[type] || {};
  const tCR = parseFloat(d.textBgCR);
  const pCR = parseFloat(d.primaryBgCR);
  test(`[${type}] has textBgCR field`,           'textBgCR'    in d,           `got ${JSON.stringify(d)}`);
  test(`[${type}] has primaryBgCR field`,        'primaryBgCR' in d,           `got ${JSON.stringify(d)}`);
  test(`[${type}] textBgCR numeric ≥1.0`,        !isNaN(tCR) && tCR >= 1.0,   `got "${d.textBgCR}"`);
  test(`[${type}] primaryBgCR numeric ≥1.0`,     !isNaN(pCR) && pCR >= 1.0,   `got "${d.primaryBgCR}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'═'.repeat(58)}`);
if (failed === 0) {
  console.log(`  ${passed}/${total} tests passed ✓`);
} else {
  console.log(`  ${passed}/${total} tests passed  (${failed} FAILED)`);
}
console.log('═'.repeat(58));

process.exit(failed > 0 ? 1 : 0);
