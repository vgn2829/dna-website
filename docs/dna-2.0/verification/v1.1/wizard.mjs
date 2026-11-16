// Seven-step submission wizard, driven through the real UI on the isolated stack (:4100/:5174, scratch DB).
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken');
const API = 'http://localhost:4100/api', WEB = 'http://localhost:5174';
const SECRET = 'qa-secret-v11-not-for-production-0123456789';
const OUT = new URL('./shots/', import.meta.url).pathname;
const tok = r => jwt.sign({ typ: 'student', roll: r, identityVerified: true }, SECRET, { expiresIn: '2h' });
const asha = tok('230001'), bala = tok('230002');
const results = []; const check = (n, ok, d = '') => { results.push({ n, ok: !!ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const api = async (m, p, { token, body } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const sharp = require('sharp');

const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const mk = async (viewport, token = asha, roll = '230001', name = 'Asha Rao') => {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([t, s, r]) => { localStorage.setItem('dna_student_token', t); localStorage.setItem('iitk_dna_student_session', s); localStorage.setItem('iitk_dna_guest_dismissed', '1'); localStorage.setItem('iitk_dna_welcome_shown_' + r, 'true'); }, [token, JSON.stringify({ rollNumber: roll, uniqueId: 'x', registeredAt: 'x', name, email: 'a@x' }), roll]);
  const page = await ctx.newPage(); return { ctx, page };
};
const settle = async p => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(300); };
const stepNow = p => p.locator('[aria-current="step"]').getAttribute('aria-label');
const noHScroll = p => p.evaluate(() => Math.max(document.scrollingElement.scrollWidth, document.getElementById('root')?.scrollWidth ?? 0) <= innerWidth + 1);
const clickBtn = (p, re) => p.getByRole('button', { name: re }).last().click();

const { ctx, page } = await mk({ width: 1280, height: 900 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
let submitPosts = 0; page.on('request', r => { if (r.method() === 'POST' && /\/mine\/.*\/submit$/.test(r.url())) submitPosts++; });

// ── create the draft through the UI ──
await page.goto(WEB + '/showcase/manage'); await settle(page);
await page.getByRole('button', { name: /New project/ }).first().click();
await page.fill('#showcase-prompt', 'Wizard QA Project');
await page.getByRole('button', { name: 'Create draft' }).click();
await page.waitForURL(/\/showcase\/manage\/[0-9a-f-]+/); await settle(page);
const projectId = page.url().match(/manage\/([0-9a-f-]+)/)[1];
check('new draft opens at step 1 of 7', /Step 1:/.test(await stepNow(page)) && (await page.locator('ol.wiz-steps button').count()) === 7);
await page.screenshot({ path: OUT + '20-wizard-step1-desktop.png' });

// ── step 1: validation, then fill ──
await clickBtn(page, /Continue/);
const err1 = await page.locator('[role="alert"]').first().innerText();
check('step 1: Continue blocked with specific messages', /summary/i.test(err1) && /category/i.test(err1) && /discipline/i.test(err1), err1.replace(/\n/g, ' | '));
check('step 1: nothing saved while invalid', (await api('GET', `/showcase/mine/${projectId}`, { token: asha })).b.summary === null);
await page.fill('#sc-summary', 'A wizard-driven QA poster series');
await page.selectOption('#sc-cat', 'illustration');
await page.getByRole('button', { name: 'Illustration', exact: true }).click();
await clickBtn(page, /Continue/); await settle(page);
check('step 1 → 2 saved to the server', (await api('GET', `/showcase/mine/${projectId}`, { token: asha })).b.summary === 'A wizard-driven QA poster series');
check('URL carries the step (?step=2)', new URL(page.url()).searchParams.get('step') === '2');

// ── step 2: media (via the asset picker UI, API fallback) ──
const needImage = await page.getByRole('button', { name: /Continue/ }).last().click().then(() => page.locator('[role="alert"]').first().innerText()).catch(() => '');
check('step 2: Continue blocked without an image', /Add at least one image/.test(needImage), needImage.replace(/\n/g, ' '));
await page.getByRole('button', { name: /Add from Assets/ }).click(); await page.waitForTimeout(1200);
let picked = false;
const tile = page.locator('[role="dialog"] img').first();
if (await tile.count()) { await tile.click({ trial: false }).catch(() => {}); await page.waitForTimeout(1200); picked = (await page.locator('ol li img').count()) > 0; }
if (!picked) {
  const wl = (await api('GET', '/workspaces', { token: asha })).b; const aid = (await api('GET', `/assets?workspace_id=${wl.find(w => w.is_personal).id}`, { token: asha })).b;
  const first = (aid.items ?? aid.assets ?? aid)[0];
  await api('PUT', `/showcase/mine/${projectId}/works`, { token: asha, body: { works: [{ asset_id: first.id, is_cover: true }] } }); await page.reload(); await settle(page);
}
console.log('   image added via', picked ? 'asset picker UI' : 'API fallback (picker selector not matched)');
await page.getByRole('button', { name: /Make cover|Cover/ }).first().click().catch(() => {});
await clickBtn(page, /Continue/); await settle(page);
check('step 2 → 3 with an image and cover', /Step 3:/.test(await stepNow(page)));

// ── step 3: story with prompts ──
await page.getByRole('button', { name: /My process/ }).click();
check('step 3: prompt appended to the description', /My process: $/.test(await page.inputValue('#sc-desc')));
await clickBtn(page, /Continue/);
check('step 3: short story blocked', /at least 30 characters/.test(await page.locator('[role="alert"]').first().innerText()));
await page.fill('#sc-desc', 'The brief: a poster series for the campus festival.\n\nMy process: halftone textures, a limited palette, many thumbnails.\n\nThe outcome: three bold posters.');
// Back must not validate and must keep the typed story
await clickBtn(page, /Back/); await settle(page);
check('Back goes to step 2 without validation', /Step 2:/.test(await stepNow(page)));
await clickBtn(page, /Continue/); await settle(page);
check('story preserved after going back and forward', (await page.inputValue('#sc-desc')).includes('three bold posters'));
await clickBtn(page, /Continue/); await settle(page);

// ── step 4: contributors + owner credit ──
check('step 4: owner credit name present', (await page.inputValue('#sc-credit-name')).length > 0);
await page.fill('#sc-inv-roll', '230002'); await page.fill('#sc-inv-role', 'Motion designer'); await page.fill('#sc-inv-what', 'Animated the poster teasers');
await page.getByRole('button', { name: /Invite/ }).click(); await settle(page);
check('step 4: pending contributor warning shown (not blocking)', /accepted yet/.test(await page.evaluate(() => document.body.innerText)));
await page.screenshot({ path: OUT + '21-wizard-step4-desktop.png' });
await clickBtn(page, /Continue/); await settle(page);

// ── step 5: resources/links; step 6: tags + visibility note ──
check('step 5: shows process moodboards section', /Process moodboards/.test(await page.evaluate(() => document.body.innerText)));
await page.getByRole('button', { name: /Add link/ }).click();
await page.fill('input[aria-label="Link 1 label"]', 'Behance'); await page.fill('input[aria-label="Link 1 address"]', 'http://localhost:3000/private');
await clickBtn(page, /Continue/);
check('step 5: private/localhost link blocked', /public http/.test(await page.locator('[role="alert"]').first().innerText().catch(() => '')));
await page.fill('input[aria-label="Link 1 address"]', 'https://www.behance.net/gallery/1');
await clickBtn(page, /Continue/); await settle(page);
check('step 6: visibility explained', /only becomes public if the club approves/.test(await page.evaluate(() => document.body.innerText)));
await page.fill('#sc-tags', 'poster, retro, halftone');
await clickBtn(page, /Continue/); await settle(page);

// ── step 7: review; consent still blocks submission ──
check('step 7 reached', /Step 7:/.test(await stepNow(page)));
const reviewText = await page.evaluate(() => document.body.innerText);
check('review summarises all six sections', ['Project basics', 'Cover and media', 'Project story', 'Contributors', 'Tools and resources', 'Discovery details'].every(t => reviewText.includes(t)));
check('review shows the contributor as waiting', /Waiting/.test(reviewText) && /Motion designer/.test(reviewText));
check('review: server blocks submit until the contributor accepts', await page.getByRole('button', { name: 'Submit for review' }).isDisabled() && /Fix these before submitting/.test(reviewText));
await page.screenshot({ path: OUT + '22-wizard-review-desktop.png', fullPage: true });
await page.getByRole('button', { name: 'Go to step' }).first().click();
check('"Go to step" jumps to Contributors (step 4)', /Step 4:/.test(await stepNow(page)));

// resume: reload keeps the step from the URL, drafts persisted on the server
await page.reload(); await settle(page);
check('refresh keeps step 4 (URL) and server data', /Step 4:/.test(await stepNow(page)));

// contributor accepts (consent), then submit exactly once even with a double-click
const inv = (await api('GET', '/showcase/invitations', { token: bala })).b.invitations.find(i => i.projectTitle === 'Wizard QA Project');
check('contributor sees the invitation', !!inv);
check('contributor accepts', (await api('POST', `/showcase/invitations/${inv.id}/accept`, { token: bala, body: { display_name: 'Bala Iyer' } })).s === 200);
await page.goto(`${WEB}/showcase/manage/${projectId}?step=7`); await settle(page);
const submitBtn = page.getByRole('button', { name: 'Submit for review' });
check('after consent the review has no blocking problems', !(await submitBtn.isDisabled()) && !/Fix these before/.test(await page.evaluate(() => document.body.innerText)));
await submitBtn.dblclick(); await page.waitForSelector('section[aria-label="Submitted"]', { timeout: 15000 }).catch(() => {}); await settle(page);
check('success state shown after submit', await page.locator('section[aria-label="Submitted"]').count() === 1);
check('double-click sent exactly ONE submit request', submitPosts === 1, `submit POSTs: ${submitPosts}`);
check('wizard replaced by the read-only page once submitted', (await page.locator('ol.wiz-steps').count()) === 0);
check('server status is submitted', (await api('GET', `/showcase/mine/${projectId}`, { token: asha })).b.status === 'submitted');
check('edit is frozen server-side while in review', (await api('PATCH', `/showcase/mine/${projectId}`, { token: asha, body: { title: 'A sneaky valid change' } })).s === 409);
await page.screenshot({ path: OUT + '23-wizard-submitted-desktop.png' });

// ── admin feedback loop → wizard re-opens ──
const adm = (await api('POST', '/auth/admin/login', { body: { password: 'qa-admin-v11' } })).b.token;
await api('POST', `/showcase/admin/projects/${projectId}/transition`, { token: adm, body: { to: 'changes_requested', reason: 'Please add a link to the final posters' } });
await page.goto(`${WEB}/showcase/manage/${projectId}`); await settle(page);
const t = await page.evaluate(() => document.body.innerText);
check('changes requested: reviewer note visible and wizard editable again', /add a link to the final posters/.test(t) && (await page.locator('ol.wiz-steps').count()) === 1);
check('resubmit via the review step', /Step 7:/.test(await stepNow(page)));
await submitBtn.click(); await page.waitForSelector('section[aria-label="Submitted"]', { timeout: 15000 }).catch(() => {});
await api('POST', `/showcase/admin/projects/${projectId}/transition`, { token: adm, body: { to: 'approved' } });
check('admin publishes → appears in public Showcase', (await api('POST', `/showcase/admin/projects/${projectId}/transition`, { token: adm, body: { to: 'published' } })).s === 200 && (await api('GET', '/showcase/projects/wizard-qa-project')).s === 200);
await ctx.close();

// ── permissions: another student can't open someone else's draft in the wizard ──
const draft2 = (await api('POST', '/showcase/mine', { token: asha, body: { title: 'Private draft QA' } })).b;
const other = await mk({ width: 1280, height: 900 }, bala, '230002', 'Bala Iyer');
await other.page.goto(`${WEB}/showcase/manage/${draft2.id}?step=3`); await settle(other.page);
const ot = await other.page.evaluate(() => document.body.innerText);
check('another student sees "Project not found", never the wizard or its data', /Project not found/.test(ot) && !/Private draft QA/.test(ot) && (await other.page.locator('ol.wiz-steps').count()) === 0);
await other.ctx.close();

// ── mobile 390px ──
const mob = await mk({ width: 390, height: 844 });
await mob.page.goto(`${WEB}/showcase/manage/${draft2.id}?step=1`); await settle(mob.page);
check('390px: compact stepper (Step 1 of 7) instead of seven labels', /Step 1 of 7/.test(await mob.page.evaluate(() => document.body.innerText)) && !(await mob.page.locator('ol.wiz-steps').isVisible()));
for (const st of [1, 2, 4, 7]) { await mob.page.goto(`${WEB}/showcase/manage/${draft2.id}?step=${st}`); await settle(mob.page); check(`390px: step ${st} has no horizontal scroll`, await noHScroll(mob.page)); if ([1, 4, 7].includes(st)) await mob.page.screenshot({ path: OUT + `24-wizard-step${st}-mobile.png`, fullPage: true }); }
await mob.page.goto(`${WEB}/showcase/manage/${draft2.id}?step=7`); await settle(mob.page);
await mob.page.waitForSelector('section[aria-label="Step actions"] button', { timeout: 10000 });
const tap = await mob.page.evaluate(() => [...document.querySelectorAll('section[aria-label="Step actions"] button')].map(b => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), tt: b.classList.contains('touch-target') })));
check('390px: every step button is >= 36px tall or uses the design system\'s touch-target hit area', tap.length >= 5 && tap.every(b => b.h >= 36 || b.tt), `${tap.length} buttons; small without touch-target: ${tap.filter(b => b.h < 36 && !b.tt).map(b => b.t).join(',') || 'none'}`);
await mob.ctx.close();
check('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
const bad = results.filter(r => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} wizard checks passed`); if (bad.length) { console.log('FAILED:'); bad.forEach(b => console.log(' -', b.n, b.d)); }
fs.writeFileSync(OUT + 'wizard-results.json', JSON.stringify(results, null, 2));
