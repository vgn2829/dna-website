import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken');
const WEB = 'http://localhost:5174', API = 'http://localhost:4100/api';
const { boardId } = JSON.parse(fs.readFileSync(new URL('./stress.json', import.meta.url)));
const OUT = new URL('./shots/', import.meta.url).pathname;
const tok = jwt.sign({ typ: 'student', roll: '230001', identityVerified: true }, 'qa-secret-v11-not-for-production-0123456789', { expiresIn: '2h' });
const sess = JSON.stringify({ rollNumber: '230001', uniqueId: 'x', registeredAt: 'x', name: 'Asha Rao', email: 'a@x' });
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const mk = async vp => { const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 500 }); await ctx.addInitScript(([t, s]) => { localStorage.setItem('dna_student_token', t); localStorage.setItem('iitk_dna_student_session', s); localStorage.setItem('iitk_dna_guest_dismissed', '1'); localStorage.setItem('iitk_dna_welcome_shown_230001', 'true'); }, [tok, sess]); return { ctx, page: await ctx.newPage() }; };
const settle = async p => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(400); };
const noH = p => p.evaluate(() => Math.max(document.scrollingElement.scrollWidth, document.getElementById('root')?.scrollWidth ?? 0) <= innerWidth + 1);

// ── Template picker (desktop) ──
{
  const { ctx, page } = await mk({ width: 1280, height: 900 });
  await page.goto(WEB + '/moodboards'); await settle(page);
  await page.getByRole('button', { name: /New (board|moodboard)/i }).first().click(); await page.waitForTimeout(600);
  const radios = await page.locator('fieldset input[type=radio]').count();
  check('picker shows Blank + ten starters as radios', radios === 11, `${radios}`);
  check('every starter card has a preview thumbnail', (await page.locator('.starter-card svg[role="img"]').count()) === 10);
  await page.screenshot({ path: OUT + '30-template-picker-desktop.png' });
  // keyboard: focus the group and use arrow keys
  await page.locator('.starter-card input').first().focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const checkedAfterKeys = await page.evaluate(() => document.querySelector('.starter-card input:checked')?.value);
  check('arrow keys move the selection (native radio group)', checkedAfterKeys && checkedAfterKeys !== '', `selected: ${checkedAfterKeys}`);
  await page.locator('.starter-card', { hasText: 'Photo series' }).click();
  check('description of the selected template is announced', /one hero image/i.test(await page.locator('fieldset [role="status"]').innerText()));
  await page.locator('[role="dialog"] input[type="text"]').first().fill('Starter QA board');
  await page.getByRole('button', { name: /^Create/ }).last().click();
  await page.waitForURL(/\/moodboards\/[0-9a-f-]+\?starter=photo-series/, { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('.tl-canvas', { timeout: 30000 }); await page.waitForTimeout(3500);
  const shapes = await page.locator('.tl-shape').count();
  check('selecting a template creates a board initialised with that layout (Photo series = 14 shapes)', shapes === 14, `${shapes} shapes on a fresh board`);
  await page.screenshot({ path: OUT + '31-template-applied.png' });
  // the starter is applied once: reload must not duplicate it
  const url = page.url(); await page.goto(url); await page.waitForSelector('.tl-canvas'); await page.waitForTimeout(3500);
  const shapes2 = await page.locator('.tl-shape').count();
  check('reloading does not re-apply the template (no duplicates)', shapes2 === shapes, `${shapes} → ${shapes2}`);
  await ctx.close();
}
// ── Blank board stays blank ──
{
  const { ctx, page } = await mk({ width: 1280, height: 900 });
  await page.goto(WEB + '/moodboards'); await settle(page);
  await page.getByRole('button', { name: /New (board|moodboard)/i }).first().click(); await page.waitForTimeout(500);
  await page.locator('[role="dialog"] input[type="text"]').first().fill('Blank QA board'); await page.getByRole('button', { name: /^Create/ }).last().click();
  await page.waitForSelector('.tl-canvas', { timeout: 30000 }); await page.waitForTimeout(2500);
  check('blank board starts empty', (await page.locator('.tl-shape').count()) === 0);
  await page.getByRole('button', { name: 'View board images' }).click(); await page.waitForTimeout(1200);
  check('lightbox on an empty board says so instead of opening', (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 0 && /No images on this board yet/.test(await page.evaluate(() => document.body.innerText)));
  await ctx.close();
}
// ── Lightbox on the 60-image board (desktop) ──
{
  const { ctx, page } = await mk({ width: 1280, height: 900 });
  await page.goto(`${WEB}/moodboards/${boardId}`); await page.waitForSelector('.tl-shape', { timeout: 30000 }); await page.waitForTimeout(2500);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'View board images' }).click();
  const dlg = page.locator('[role="dialog"][aria-label$="images"]'); await dlg.waitFor();
  check('lightbox opens quickly with 60 images', Date.now() - t0 < 1500, `${Date.now() - t0}ms`);
  check('counter shows 1 / 60', /1 \/ 60/.test(await dlg.locator('[role="status"]').innerText()));
  check('page scroll is locked while open', await page.evaluate(() => document.body.style.overflow) === 'hidden');
  await page.waitForFunction(() => { const i = document.querySelector('[role="dialog"][aria-modal] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  const first = await dlg.locator('img').getAttribute('src');
  check('lightbox shows the ORIGINAL (not a 512px thumbnail)', /canvas-files\/.*\.jpg$/.test(first) && !/t512/.test(first), first.split('/').pop());
  await page.keyboard.press('ArrowRight'); check('ArrowRight → 2 / 60', /2 \/ 60/.test(await dlg.locator('[role="status"]').innerText()));
  await page.keyboard.press('End'); check('End → 60 / 60', /60 \/ 60/.test(await dlg.locator('[role="status"]').innerText()));
  await page.keyboard.press('ArrowRight'); check('wraps to 1 / 60', /1 \/ 60/.test(await dlg.locator('[role="status"]').innerText()));
  await page.keyboard.press('ArrowLeft'); check('ArrowLeft wraps back to 60 / 60', /60 \/ 60/.test(await dlg.locator('[role="status"]').innerText()));
  await page.screenshot({ path: OUT + '32-lightbox-desktop.png' });
  const focusInside = await page.evaluate(() => document.querySelector('[role="dialog"][aria-modal]').contains(document.activeElement));
  check('focus is inside the dialog', focusInside);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('Escape closes it and restores scrolling', (await dlg.count()) === 0 && (await page.evaluate(() => document.body.style.overflow)) !== 'hidden');
  // opens at the SELECTED image
  const box = await page.locator('.tl-shape').nth(30).boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'View board images' }).click(); await dlg.waitFor();
  const counter = await dlg.locator('[role="status"]').innerText(); check('opens at the selected image, not always the first', !/^1 \/ 60/.test(counter), counter);
  await page.getByRole('button', { name: 'Close image viewer' }).click(); check('close button works', (await dlg.count()) === 0);
  // broken image handling
  await page.route(/canvas-files\/.*qa-0-.*\.jpg$/, r => r.fulfill({ status: 404, body: 'gone' }));
  await page.getByRole('button', { name: 'View board images' }).click(); await dlg.waitFor();
  for (let i = 0; i < 60; i++) { const t = await dlg.locator('[role="alert"]').count(); if (t) break; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); if (i > 14) break; }
  const alertShown = await dlg.locator('[role="alert"]').count();
  check('a missing image shows an error with Try again (not a blank box)', alertShown === 1 && /couldn’t be loaded/.test(await dlg.locator('[role="alert"]').innerText()));
  await page.unroute(/canvas-files\/.*qa-0-.*\.jpg$/); if (alertShown) { await dlg.getByRole('button', { name: /Try again/ }).click(); await page.waitForTimeout(1500); check('Try again recovers once the image is available', (await dlg.locator('[role="alert"]').count()) === 0); }
  await ctx.close();
}
// ── Lightbox on mobile 390px ──
{
  const { ctx, page } = await mk({ width: 390, height: 844 });
  await page.goto(`${WEB}/moodboards/${boardId}`); await page.waitForSelector('.tl-shape', { timeout: 30000 }); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'More board actions' }).click(); await page.getByRole('menuitem', { name: /View board images/ }).click();
  const dlg = page.locator('[role="dialog"][aria-label$="images"]'); await dlg.waitFor();
  const r = await page.evaluate(() => { const d = document.querySelector('[role="dialog"][aria-modal]').getBoundingClientRect(); const btns = [...document.querySelectorAll('[role="dialog"][aria-modal] button')].map(b => { const x = b.getBoundingClientRect(); return { l: b.getAttribute('aria-label'), w: Math.round(x.width), h: Math.round(x.height), inView: x.left >= 0 && x.right <= innerWidth }; }); return { dw: Math.round(d.width), dh: Math.round(d.height), btns }; });
  check('mobile lightbox fills the screen', r.dw === 390 && r.dh === 844, `${r.dw}x${r.dh}`);
  check('prev/next/close are on-screen and >= 40px', r.btns.length === 3 && r.btns.every(b => b.inView && b.w >= 40 && b.h >= 40), JSON.stringify(r.btns));
  await page.getByRole('button', { name: 'Next image' }).tap(); check('tap Next → 2 / 60', /2 \/ 60/.test(await dlg.locator('[role="status"]').innerText()));
  await page.waitForFunction(() => { const i = document.querySelector('[role="dialog"][aria-modal] img'); return i && i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === '1'; }, null, { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: OUT + '33-lightbox-mobile.png' });
  await page.getByRole('button', { name: 'Close image viewer' }).tap(); check('tap Close', (await dlg.count()) === 0);
  await ctx.close();
}
// ── Template picker (mobile) ──
{
  const { ctx, page } = await mk({ width: 390, height: 844 });
  await page.goto(WEB + '/moodboards'); await settle(page);
  await page.getByRole('button', { name: /New (board|moodboard)/i }).first().click(); await page.waitForTimeout(600);
  check('390px: picker has no horizontal scroll', await noH(page));
  await page.locator('.starter-card', { hasText: 'Poster exploration' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + '34-template-picker-mobile.png' });
  await ctx.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} moodboard checks passed`);
await browser.close();
