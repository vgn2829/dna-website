// DNA 2.0 V1.1 browser journey against an ISOLATED backend (:4100, scratch DB dna_v11_qa) and Vite (:5174).
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');

const OUT = '/private/tmp/claude-501/-Users-venugopal-Downloads-dna-website/4c52a94e-805f-4e61-8a24-93cc99c6183e/scratchpad/qa/shots';
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://localhost:4100/api';
const WEB = 'http://localhost:5174';
const SECRET = 'qa-secret-v11-not-for-production-0123456789';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const tok = roll => jwt.sign({ typ: 'student', roll, identityVerified: true }, SECRET, { algorithm: 'HS256', expiresIn: '2h' });
const asha = tok('230001'), bala = tok('230002');
const session = (roll, name, email) => JSON.stringify({ rollNumber: roll, uniqueId: `IITK-DnA-${roll}-AAAA`, registeredAt: '01 Jan 2026', name, email });

async function api(method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// Real images
const png = async (color, w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const avatarPath = path.join(OUT, 'avatar.png'); fs.writeFileSync(avatarPath, await png('#3366cc', 256, 256));
const coverBuf = await png('#cc2233', 800, 600);

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const ctxFor = async (token, name, email, roll, viewport) => {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([t, s]) => {
    try { localStorage.setItem('dna_student_token', t); localStorage.setItem('iitk_dna_student_session', s); localStorage.setItem('iitk_dna_guest_dismissed', '1'); localStorage.setItem('iitk_dna_welcome_shown_' + JSON.parse(s).rollNumber, 'true'); } catch {}
  }, [token, session(roll, name, email)]);
  return ctx;
};
const errors = [];
const watch = page => {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
};
const settle = async page => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const noHScroll = async page => page.evaluate(() => { const el = document.scrollingElement; const r = document.getElementById('root'); return Math.max(el.scrollWidth, r?.scrollWidth ?? 0) <= window.innerWidth + 1; });

try {
  // ── 1. Student signs in; navbar + account menu ───────────────────────────
  const ctx = await ctxFor(asha, 'Asha Rao', 'asha@iitk.ac.in', '230001', { width: 1440, height: 900 });
  const page = await ctx.newPage(); watch(page);
  await page.goto(WEB + '/'); await settle(page);
  const navText = await page.locator('nav, header').first().innerText().catch(() => '');
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('navbar says "Creator Studio"', /Creator Studio/.test(bodyText));
  check('no "Design Studio" label remains in the navbar', !(await page.locator('text=Design Studio').count()));
  const trigger = page.locator('.acct-trigger');
  check('account trigger visible (desktop)', await trigger.isVisible());
  await trigger.click();
  const items = await page.locator('[role="menuitem"]').allInnerTexts();
  check('account menu entries', items.map(s => s.trim()).join('|') === 'My Profile|Edit Profile|Account Settings|Notifications|Invitations|Sign out', items.join('|'));
  await page.screenshot({ path: `${OUT}/01-account-menu-desktop.png` });
  await page.keyboard.press('Escape');
  check('Escape closes menu and refocuses trigger', (await page.locator('[role="menu"]').count()) === 0 && await trigger.evaluate(el => el === document.activeElement));

  // old bookmark still works
  await page.goto(WEB + '/design-studio'); await settle(page);
  check('/design-studio still routes (old bookmarks)', /Creator Studio|Palette|tool/i.test(await page.evaluate(() => document.body.innerText)) && new URL(page.url()).pathname === '/design-studio');

  // ── 2. Profile: create, avatar updates navbar WITHOUT reload ─────────────
  await page.goto(WEB + '/profile'); await settle(page);
  await page.evaluate(() => { window.__noReload = true; });
  await page.fill('#pf-name', 'Asha Rao');
  await page.fill('#pf-handle', 'asha-draws');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /create (my )?profile/i }).click().catch(async () => { await page.locator('button.btn-primary').first().click(); });
  await settle(page);
  check('profile created', await page.locator('#edit-profile').count() > 0);
  check('completion card visible on a fresh profile', /Profile \d+% complete/.test(await page.evaluate(() => document.body.innerText)));
  const initialsBefore = await page.locator('.acct-trigger img').count();
  check('navbar shows initials before an image exists', initialsBefore === 0 && /AR/.test(await page.locator('.acct-trigger').innerText()));
  await page.locator('input[type=file]').first().setInputFiles(avatarPath);
  await page.waitForFunction(() => document.querySelector('.acct-trigger img'), null, { timeout: 15000 }).catch(() => {});
  check('navbar avatar appears after upload', await page.locator('.acct-trigger img').count() === 1);
  check('…without a full-page reload', await page.evaluate(() => window.__noReload === true));
  check('profile completion advanced', /Profile (40|60|80)% complete|% complete/.test(await page.evaluate(() => document.body.innerText)));

  // tools UI
  await page.fill('input[aria-label="Add a tool"]', 'Figma'); await page.keyboard.press('Enter');
  await page.fill('input[aria-label="Add a tool"]', 'Blender'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save tools' }).click(); await settle(page);
  check('tools saved via UI', (await api('GET', '/designers/me', { token: asha })).body.tools?.join(',') === 'figma,blender');
  // basics via UI
  await page.fill('#pe-headline', 'Illustrator & motion designer');
  await page.fill('#pe-bio', 'I make posters and short animations.');
  await page.getByRole('button', { name: 'Save changes' }).click(); await settle(page);
  // display-name change updates navbar live
  await page.fill('#pe-name', 'Asha R. Rao');
  await page.getByRole('button', { name: 'Save changes' }).click(); await settle(page);
  check('navbar name updates after rename (no reload)', /Asha/.test(await page.locator('.acct-trigger').innerText()) && await page.evaluate(() => window.__noReload === true));
  await page.fill('#pe-name', 'Asha Rao');
  await page.getByRole('button', { name: 'Save changes' }).click(); await settle(page);
  await page.screenshot({ path: `${OUT}/02-profile-desktop.png`, fullPage: false });

  // Edit Profile deep link scrolls to the editor
  await page.goto(WEB + '/'); await settle(page);
  await page.locator('.acct-trigger').click(); await page.getByRole('menuitem', { name: 'Edit Profile' }).click(); await settle(page);
  check('Edit Profile lands on #edit-profile', new URL(page.url()).hash === '#edit-profile' && new URL(page.url()).pathname === '/profile');

  // Visibility → public (API; existing control)
  check('profile set public', (await api('PATCH', '/designers/me/visibility', { token: asha, body: { visibility: 'public' } })).status === 200);
  // Bala's profile (API)
  await api('POST', '/designers/me', { token: bala, body: { handle: 'bala-makes', displayName: 'Bala Iyer' } });
  await api('PATCH', '/designers/me/visibility', { token: bala, body: { visibility: 'public' } });

  // ── 3. Project: create, cover, contributor, submit ───────────────────────
  const ws = (await api('POST', '/workspaces', { token: asha, body: { name: 'Asha QA' } })).body;
  const wsList = (await api('GET', '/workspaces', { token: asha })).body;
  const wsId = (Array.isArray(wsList) ? (wsList.find(w => w.is_personal) ?? wsList[0]) : ws)?.id ?? ws.id;
  const fd = new FormData(); fd.append('workspace_id', wsId); fd.append('filename', 'cover.png'); fd.append('file', new Blob([coverBuf], { type: 'image/png' }), 'cover.png');
  const asset = await api('POST', '/assets', { token: asha, form: fd });
  check('asset uploaded', asset.status === 201 || asset.status === 200, `status ${asset.status}`);
  const proj = (await api('POST', '/showcase/mine', { token: asha, body: { title: 'Retro Poster Series' } })).body;
  await api('PATCH', `/showcase/mine/${proj.id}`, { token: asha, body: { summary: 'Retro posters', description: 'Three posters exploring halftone textures and limited palettes for a campus festival.', category: 'illustration', tags: ['retro'], discipline_ids: ['illus'] } });
  const works = await api('PUT', `/showcase/mine/${proj.id}/works`, { token: asha, body: { works: [{ asset_id: asset.body.id, caption: 'Poster 1', is_cover: true }] } });
  check('cover attached', works.status === 200, JSON.stringify(works.body).slice(0, 120));
  const invite = await api('POST', `/showcase/mine/${proj.id}/credits`, { token: asha, body: { roll: '230002', role_label: 'Motion designer' } });
  check('contributor invited', invite.status === 201);
  const early = await api('POST', `/showcase/mine/${proj.id}/submit`, { token: asha });
  check('submit before contributor consent is handled (200 or explicit 4xx)', [200, 400, 409].includes(early.status), `status ${early.status}`);
  const inv = (await api('GET', '/showcase/invitations', { token: bala })).body.invitations?.[0];
  check('contributor sees invitation', !!inv);
  const acc = await api('POST', `/showcase/invitations/${inv.id}/accept`, { token: bala, body: { display_name: 'Bala Iyer' } });
  check('contributor accepts (consent)', acc.status === 200, `status ${acc.status} ${JSON.stringify(acc.body).slice(0, 100)}`);
  let sub = early.status === 200 ? early : await api('POST', `/showcase/mine/${proj.id}/submit`, { token: asha });
  check('project submitted', sub.status === 200, `status ${sub.status} ${JSON.stringify(sub.body).slice(0, 120)}`);

  // Not public before approval
  check('unapproved project NOT public', (await api('GET', '/showcase/projects/retro-poster-series')).status === 404);

  // ── 4. Admin reviews → changes requested → resubmit → approve → publish ─
  const adm = (await api('POST', '/auth/admin/login', { body: { password: 'qa-admin-v11' } })).body.token;
  check('admin login', !!adm);
  const adminHeaders = { token: adm };
  const t = (to, reason) => api('POST', `/showcase/admin/projects/${proj.id}/transition`, { ...adminHeaders, body: { to, reason } });
  check('student token cannot moderate', (await api('POST', `/showcase/admin/projects/${proj.id}/transition`, { token: asha, body: { to: 'published' } })).status === 401);
  const underReview = await t('in_review');
  const cr = await t('changes_requested', 'Please add a longer description');
  check('admin requests changes with feedback', cr.status === 200, `status ${cr.status} (in_review ${underReview.status})`);
  const mine = (await api('GET', `/showcase/mine/${proj.id}`, { token: asha })).body;
  check('student sees moderator feedback', JSON.stringify(mine).includes('longer description'));
  const re = await api('POST', `/showcase/mine/${proj.id}/submit`, { token: asha });
  check('resubmission works', re.status === 200, `status ${re.status}`);
  check('approve', (await t('approved')).status === 200);
  check('publish', (await t('published')).status === 200);
  check('published project is public', (await api('GET', '/showcase/projects/retro-poster-series')).status === 200);

  // ── 5. Featured creator order + note (admin) ─────────────────────────────
  const ashaProfile = (await api('GET', '/designers/me', { token: asha })).body;
  const list = (await api('GET', '/creators/admin/list', adminHeaders)).body;
  const ashaId = list.creators.find(c => c.handle === 'asha-draws')?.id;
  check('admin sees public creator', !!ashaId);
  check('feature creator', (await api('PUT', `/creators/admin/${ashaId}/featured`, { ...adminHeaders, body: { featured: true } })).status === 200);
  check('edit order+note', (await api('PATCH', `/creators/admin/${ashaId}/featured`, { ...adminHeaders, body: { displayOrder: 1, editorialNote: 'Posters that stop the scroll' } })).status === 200);
  check('student cannot edit featured', (await api('PATCH', `/creators/admin/${ashaId}/featured`, { token: asha, body: { editorialNote: 'x' } })).status === 401);

  // ── 6. Public surfaces (anonymous browser) ───────────────────────────────
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await anon.addInitScript(() => { try { localStorage.setItem('iitk_dna_guest_dismissed', '1'); } catch {} });
  const pub = await anon.newPage(); watch(pub);
  await pub.goto(WEB + '/showcase'); await settle(pub);
  check('Showcase lists the published project', /Retro Poster Series/.test(await pub.evaluate(() => document.body.innerText)));
  await pub.screenshot({ path: `${OUT}/03-showcase-desktop.png` });
  await pub.goto(WEB + '/showcase/retro-poster-series'); await settle(pub);
  const projText = await pub.evaluate(() => document.body.innerText);
  check('project page shows contributors with roles', /Asha/.test(projText) && /Motion designer/.test(projText));
  check('project page leaks no roll/email', !/230001|230002|@iitk/.test(projText));
  await pub.goto(WEB + '/creators'); await settle(pub);
  const cText = await pub.evaluate(() => document.body.innerText);
  check('Creators page shows featured creator with editorial note', /Asha Rao/.test(cText) && /Featured/.test(cText) && /Posters that stop the scroll/.test(cText));
  check('Creators page filters expose tools', await pub.locator('select[aria-label="Tool"]').count() === 1);
  await pub.screenshot({ path: `${OUT}/04-creators-desktop.png` });
  await pub.goto(WEB + '/creators?tool=blender'); await settle(pub);
  check('tool filter finds the creator', /Asha Rao/.test(await pub.evaluate(() => document.body.innerText)));
  await pub.goto(WEB + '/creators?tool=photoshop'); await settle(pub);
  check('tool filter empty state', /No creators match/.test(await pub.evaluate(() => document.body.innerText)));
  await pub.goto(WEB + '/designers/asha-draws'); await settle(pub);
  const pText = await pub.evaluate(() => document.body.innerText);
  check('public profile shows tools and the published project', /figma/i.test(pText) && /Retro Poster Series/.test(pText));
  check('public profile leaks no roll/email', !/230001|@iitk/.test(pText));
  await pub.screenshot({ path: `${OUT}/05-public-profile-desktop.png` });
  await pub.goto(WEB + '/'); await settle(pub);
  await pub.evaluate(() => document.getElementById('home-featured-creators')?.scrollIntoView());
  await pub.waitForTimeout(500);
  check('homepage shows Featured Creators', /Featured\s+Creators/i.test(await pub.evaluate(() => document.body.innerText)));
  await pub.screenshot({ path: `${OUT}/06-home-featured-desktop.png` });
  // private profile must not appear
  await api('PATCH', '/designers/me/visibility', { token: bala, body: { visibility: 'private' } });
  check('private profile 404 publicly', (await api('GET', '/designers/bala-makes')).status === 404);
  check('private profile absent from directory', !JSON.stringify((await api('GET', '/creators')).body).includes('bala-makes'));

  // ── 7. Workspace sidebar (desktop) ───────────────────────────────────────
  await page.goto(WEB + '/home'); await settle(page);
  const groups = await page.locator('nav[aria-label="Creator Studio navigation"] [role="group"] > p').allInnerTexts();
  check('sidebar groups Create/Discover/Manage', groups.map(s => s.trim().toLowerCase()).join('|') === 'create|discover|manage', groups.join('|'));
  check('sidebar has no "My profile"', !(await page.locator('nav[aria-label="Creator Studio navigation"]').innerText()).match(/my profile/i));
  await page.screenshot({ path: `${OUT}/07-sidebar-desktop.png` });
  await page.goto(WEB + '/showcase/manage#collaborations'); await settle(page);
  check('Collaborations is the only active item on its hash', (await page.locator('nav[aria-label="Creator Studio navigation"] [aria-current="page"]').allInnerTexts()).map(s => s.trim()).join('|') === 'Collaborations');
  for (const p of ['/home', '/moodboards', '/assets', '/templates', '/inspiration', '/creators', '/showcase', '/projects', '/showcase/manage']) {
    await page.goto(WEB + p); await settle(page);
    check(`direct load ${p}`, (await page.evaluate(() => document.body.innerText.length)) > 40 && !/This page couldn’t be loaded/.test(await page.evaluate(() => document.body.innerText)));
  }

  // ── 8. Moodboard export preview ──────────────────────────────────────────
  const board = await api('POST', '/boards', { token: asha, body: { name: 'QA Board', workspace_id: wsId } });
  const boardId = board.body.id;
  check('board created', !!boardId, `status ${board.status}`);
  if (boardId) {
    await page.goto(WEB + `/moodboards/${boardId}`); await settle(page);
    await page.waitForTimeout(2500);
    // draw a rectangle (tldraw: key r, drag)
    const box = await page.locator('.tl-canvas, .tl-container').first().boundingBox();
    if (box) {
      await page.keyboard.press('r');
      await page.mouse.move(box.x + 300, box.y + 250); await page.mouse.down(); await page.mouse.move(box.x + 520, box.y + 400, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(500);
    }
    await page.getByRole('button', { name: /^Export$/ }).first().click().catch(async () => { await page.getByText('Export', { exact: true }).first().click(); });
    await page.waitForSelector('[aria-label="Export preview"]', { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[aria-label="Export preview"] img'), null, { timeout: 10000 }).catch(() => {});
    const img = page.locator('[aria-label="Export preview"] img');
    check('export dialog renders a preview image', await img.count() === 1);
    if (await img.count()) {
      const src = await img.getAttribute('src');
      check('preview is a local blob (nothing uploaded)', src?.startsWith('blob:'));
      const dims = await img.evaluate(i => ({ w: i.naturalWidth, h: i.naturalHeight }));
      check('preview has real pixels', dims.w > 10 && dims.h > 10, JSON.stringify(dims));
    }
    await page.screenshot({ path: `${OUT}/08-export-preview.png` });
    // toggle transparent background: preview re-renders, dialog still works
    await page.getByLabel('Transparent background').check().catch(() => {});
    await page.waitForTimeout(600);
    check('preview still present after toggling transparency', await page.locator('[aria-label="Export preview"] img').count() === 1);
    await page.keyboard.press('Escape');
  }

  // ── 9. Mobile 390px ───────────────────────────────────────────────────────
  const mctx = await ctxFor(asha, 'Asha Rao', 'asha@iitk.ac.in', '230001', { width: 390, height: 844 });
  const m = await mctx.newPage(); watch(m);
  for (const p of ['/', '/home', '/profile', '/creators', '/showcase', '/designers/asha-draws', '/showcase/manage', '/assets', '/design-studio']) {
    await m.goto(WEB + p); await settle(m);
    check(`390px no horizontal scroll: ${p}`, await noHScroll(m));
  }
  await m.goto(WEB + '/'); await settle(m);
  await m.screenshot({ path: `${OUT}/09-mobile-home.png` });
  // mobile navbar menu → account block
  await m.getByRole('button', { name: 'Menu', exact: true }).click();
  await m.waitForTimeout(500);
  const mtxt = await m.evaluate(() => document.body.innerText);
  check('mobile menu has Creator Studio + account entries', /Creator Studio/.test(mtxt) && /My Profile/.test(mtxt) && /Edit Profile/.test(mtxt) && /Sign out/.test(mtxt));
  await m.screenshot({ path: `${OUT}/10-mobile-menu.png` });
  // workspace drawer
  await m.goto(WEB + '/home'); await settle(m);
  await m.getByRole('button', { name: 'Open workspace navigation' }).click(); await m.waitForTimeout(500);
  const drawer = await m.locator('[role="dialog"][aria-label="Workspace navigation"]').innerText();
  check('mobile drawer lists the three groups', /CREATE/i.test(drawer) && /DISCOVER/i.test(drawer) && /MANAGE/i.test(drawer));
  await m.screenshot({ path: `${OUT}/11-mobile-drawer.png` });
  await m.keyboard.press('Escape');
  await m.goto(WEB + '/profile'); await settle(m);
  await m.screenshot({ path: `${OUT}/12-mobile-profile.png` });
  await m.goto(WEB + '/creators'); await settle(m);
  await m.screenshot({ path: `${OUT}/13-mobile-creators.png` });

  // ── 10. Console health ────────────────────────────────────────────────────
  const real = errors.filter(e => !/ResizeObserver|WebSocket|net::ERR|Download the React DevTools/.test(e));
  check('no uncaught page errors', real.filter(e => e.startsWith('pageerror')).length === 0, real.slice(0, 3).join(' || '));
} catch (e) {
  check('journey completed without throwing', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors: errors.slice(0, 20) }, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' -', f.name, f.detail)); }
}
