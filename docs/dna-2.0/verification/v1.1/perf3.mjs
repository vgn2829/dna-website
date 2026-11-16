import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken');
const { boardId } = JSON.parse(fs.readFileSync(new URL('./stress.json', import.meta.url)));
const tok = jwt.sign({ typ: 'student', roll: '230001', identityVerified: true }, 'qa-secret-v11-not-for-production-0123456789', { expiresIn: '2h' });
const s = JSON.stringify({ rollNumber: '230001', uniqueId: 'x', registeredAt: 'x', name: 'Asha Rao', email: 'a@x' });
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([t, s]) => { localStorage.setItem('dna_student_token', t); localStorage.setItem('iitk_dna_student_session', s); localStorage.setItem('iitk_dna_guest_dismissed', '1'); localStorage.setItem('iitk_dna_welcome_shown_230001', 'true'); }, [tok, s]);
  const page = await ctx.newPage();
  let thumbB = 0, origB = 0, thumbN = 0, origN = 0;
  page.on('requestfinished', async r => { const u = r.url(); try { const sz = (await r.sizes()).responseBodySize; if (/t512\.webp/.test(u)) { thumbB += sz; thumbN++; } else if (/canvas-files\/.*\.jpg$/.test(u)) { origB += sz; origN++; } } catch {} });
  const t0 = Date.now();
  await page.goto(`http://localhost:5174/moodboards/${boardId}`);
  await page.waitForFunction(() => document.querySelectorAll('.tl-shape img').length > 5, null, { timeout: 60000 }).catch(() => console.log('timeout'));
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const fit = { ms: Date.now() - t0, thumbN, thumbMB: +(thumbB / 1e6).toFixed(2), origN, origMB: +(origB / 1e6).toFixed(1), heapMB: await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6)) };
  const srcs = await page.evaluate(() => [...document.querySelectorAll('.tl-shape img')].slice(0, 5).map(i => i.src.split('/').slice(-1)[0]));
  console.log(`\n== ${label} (fit-to-screen) ==`, JSON.stringify(fit), '\n first img srcs:', srcs.join(', '));
  // zoom in on one image: expect an upgrade to the original
  const before = { thumbN, origN };
  const box = await page.locator('.tl-shape').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(60); }   // plain wheel zooms in tldraw
  await page.waitForTimeout(2500);
  const z = await page.evaluate(() => { const imgs = [...document.querySelectorAll('.tl-shape img')].map(i => ({ w: i.getBoundingClientRect().width, src: i.src })); imgs.sort((a, b) => b.w - a.w); return { biggest: Math.round(imgs[0]?.w ?? 0), src: imgs[0]?.src.split('/').slice(-1)[0] }; });
  console.log(' after zoom-in: largest image', z.biggest, 'px ->', z.src, '| new original requests:', origN - before.origN);
  await page.screenshot({ path: new URL(`./shots/perf-after-${label}.png`, import.meta.url).pathname });
  await ctx.close();
}
await run('desktop', { width: 1440, height: 900 });
await run('mobile-390', { width: 390, height: 844 });
await browser.close();
