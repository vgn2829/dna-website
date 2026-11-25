import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken');
const { boardId } = JSON.parse(fs.readFileSync(new URL('./stress.json', import.meta.url)));
const tok = jwt.sign({ typ: 'student', roll: '230001', identityVerified: true }, 'qa-secret-v11-not-for-production-0123456789', { expiresIn: '2h' });
const s = JSON.stringify({ rollNumber: '230001', uniqueId: 'x', registeredAt: 'x', name: 'Asha Rao', email: 'a@x' });
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([t, s]) => { localStorage.setItem('dna_student_token', t); localStorage.setItem('iitk_dna_student_session', s); localStorage.setItem('iitk_dna_guest_dismissed', '1'); localStorage.setItem('iitk_dna_welcome_shown_230001', 'true'); }, [tok, s]);
const page = await ctx.newPage();
let origN = 0; page.on('request', r => { if (/canvas-files\/.*\.jpg$/.test(r.url())) origN++; });
await page.goto(`http://localhost:5174/moodboards/${boardId}`);
await page.waitForFunction(() => document.querySelectorAll('.tl-shape img').length > 5, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const state = () => page.evaluate(() => { const imgs = [...document.querySelectorAll('.tl-shape img')].map(i => ({ w: Math.round(i.getBoundingClientRect().width), file: i.src.split('/').pop() })); imgs.sort((a, b) => b.w - a.w); return imgs[0]; });
console.log('fit-to-screen   largest:', JSON.stringify(await state()), '| original requests:', origN);
const box = await page.locator('.tl-shape').nth(12).boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.press('Shift+2');                 // tldraw: zoom to selection
await page.waitForTimeout(3000);
console.log('zoomed selection largest:', JSON.stringify(await state()), '| original requests:', origN);
await page.screenshot({ path: new URL('./shots/perf-zoomed.png', import.meta.url).pathname });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.down('Control');
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(80); }
await page.keyboard.up('Control');
await page.waitForTimeout(3500);
console.log('ctrl+wheel zoom   largest:', JSON.stringify(await state()), '| original requests:', origN);
await page.screenshot({ path: new URL('./shots/perf-zoomed-in.png', import.meta.url).pathname });
await page.keyboard.press('Shift+1');                 // zoom to fit all
await page.waitForTimeout(3000);
console.log('back to fit      largest:', JSON.stringify(await state()));
await browser.close();
