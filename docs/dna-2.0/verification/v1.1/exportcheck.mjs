import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken'); const sharp = require('sharp');
const API = 'http://localhost:4100/api';
const { boardId, wsId } = JSON.parse(fs.readFileSync(new URL('./stress.json', import.meta.url)));
const tok = jwt.sign({ typ: 'student', roll: '230001', identityVerified: true }, 'qa-secret-v11-not-for-production-0123456789', { expiresIn: '2h' });
const s = JSON.stringify({ rollNumber: '230001', uniqueId: 'x', registeredAt: 'x', name: 'Asha Rao', email: 'a@x' });
const empty = (await (await fetch(API + '/boards', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Empty QA', workspace_id: wsId }) })).json()).id;
const OUT = new URL('./shots/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
async function open(id, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.addInitScript(([t, s]) => { localStorage.setItem('dna_student_token', t); localStorage.setItem('iitk_dna_student_session', s); localStorage.setItem('iitk_dna_guest_dismissed', '1'); localStorage.setItem('iitk_dna_welcome_shown_230001', 'true'); }, [tok, s]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:5174/moodboards/${id}`);
  await page.waitForSelector('.tl-canvas', { timeout: 30000 }); await page.waitForTimeout(2500);
  return page;
}
const previewInfo = async page => { await page.waitForFunction(() => document.querySelector('[aria-label="Export preview"] img'), null, { timeout: 15000 }).catch(() => {}); return page.evaluate(() => { const i = document.querySelector('[aria-label="Export preview"] img'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null; }); };
async function exportAs(page, fmt, { selection = false, scale = null } = {}) {
  await page.getByRole('button', { name: /^Export$/ }).first().click(); await page.waitForTimeout(400);
  if (selection) await page.getByRole('button', { name: /Selection/ }).click();
  await page.getByRole('button', { name: fmt, exact: true }).click();
  if (scale) await page.getByRole('button', { name: `${scale}×`, exact: true }).click();
  await page.waitForTimeout(500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: /^Export$/ }).last().click()]);
  const p = OUT + 'export-' + Date.now() + '-' + dl.suggestedFilename(); await dl.saveAs(p); return p;
}

// 1. Large board (60 images, 4200x1980)
{
  const page = await open(boardId);
  await page.getByRole('button', { name: /^Export$/ }).first().click();
  const prev = await previewInfo(page);
  check('large board: preview renders', !!prev, JSON.stringify(prev));
  const note = await page.locator('[role="status"]').last().innerText();
  console.log('   dialog says:', note.replace(/\n/g, ' '));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const t0 = Date.now();
  const png = await exportAs(page, 'PNG');
  const m = await sharp(png).metadata();
  check('large board: PNG exported', m.width > 0, `${m.width}x${m.height} in ${Date.now() - t0}ms`);
  const ratioPrev = prev.w / prev.h, ratioOut = m.width / m.height;
  check('large board: preview aspect ratio matches the exported file', Math.abs(ratioPrev - ratioOut) / ratioOut < 0.02, `preview ${ratioPrev.toFixed(3)} vs export ${ratioOut.toFixed(3)}`);
  await page.screenshot({ path: OUT + '15-export-large.png' });
  await page.context().close();
}
// 2. Empty board
{
  const page = await open(empty);
  await page.getByRole('button', { name: /^Export$/ }).first().click(); await page.waitForTimeout(800);
  const txt = await page.locator('[aria-label="Export preview"]').innerText();
  check('empty board: says nothing to preview', /Nothing to preview/.test(txt), txt.replace(/\n/g, ' '));
  const disabled = await page.getByRole('button', { name: /^Export$/ }).last().isDisabled();
  check('empty board: Export button is disabled', disabled);
  await page.context().close();
}
// 3. Selection scope, scales and formats
{
  const page = await open(boardId);
  const box = await page.locator('.tl-shape').nth(5).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: /^Export$/ }).first().click();
  await page.getByRole('button', { name: /Selection/ }).click();
  const prev = await previewInfo(page);
  check('selection: preview is the single image (4:3)', prev && Math.abs(prev.w / prev.h - 1.333) < 0.15, JSON.stringify(prev));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const png = await exportAs(page, 'PNG', { selection: true, scale: 3 }); const m = await sharp(png).metadata();
  check('selection: export matches preview aspect', prev && Math.abs(prev.w / prev.h - m.width / m.height) < 0.02, `${m.width}x${m.height}`);
  const PAD = 96;   // 32px export padding × 3
  const { data } = await sharp(png).extract({ left: PAD + 150, top: PAD + 150, width: 300, height: 300 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let acc = 0; for (let i = 1; i < data.length; i++) acc += Math.abs(data[i] - data[i - 1]); const detail = acc / data.length;
  check('3x export of one image keeps full detail (a 683px thumbnail would be blurry)', detail > 25, `(original≈37, upscaled 683px thumbnail≈10) mean neighbour diff ${detail.toFixed(1)} at ${m.width}px wide`);
  const jpg = await exportAs(page, 'JPG', { selection: true }); check('JPG export works', (await sharp(jpg).metadata()).format === 'jpeg');
  const svg = await exportAs(page, 'SVG', { selection: true }); const svgText = fs.readFileSync(svg, 'utf8');
  check('SVG export works and embeds the original (no t512 thumbnail URL)', svgText.startsWith('<svg') && !/t512\.webp/.test(svgText), `${(svgText.length / 1e6).toFixed(1)} MB`);
  await page.context().close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} export checks passed`);
await browser.close();
