import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/venugopal/Downloads/dna-v1.1-qa/backend/package.json');
const jwt = require('jsonwebtoken'); const sharp = require('sharp');
const API = 'http://localhost:4100/api';
const tok = jwt.sign({ typ: 'student', roll: '230001', identityVerified: true }, 'qa-secret-v11-not-for-production-0123456789', { expiresIn: '2h' });
const H = { Authorization: `Bearer ${tok}` };
const j = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { ...H, ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const ws = (await j('GET', '/workspaces')).b; const wsId = (ws.find(w => w.is_personal) ?? ws[0]).id;
const board = (await j('POST', '/boards', { name: 'Stress board (60 images)', workspace_id: wsId })).b;
const urls = [];
for (let i = 0; i < 12; i++) {
  // photographic-ish noise so files are realistically heavy
  const raw = Buffer.alloc(1600 * 1200 * 3); for (let k = 0; k < raw.length; k++) raw[k] = (Math.random() * 255) | 0;
  const png = await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
  const fd = new FormData(); fd.append('fileId', `qa-${i}-${Date.now()}`); fd.append('file', new Blob([png], { type: 'image/jpeg' }), `ref-${i}.jpg`);
  const r = await fetch(`${API}/boards/${board.id}/canvas-files`, { method: 'POST', headers: H, body: fd });
  const out = await r.json(); urls.push(out.url);
}
fs.writeFileSync(new URL('./stress.json', import.meta.url), JSON.stringify({ boardId: board.id, wsId, urls }));
console.log(JSON.stringify({ boardId: board.id, count: urls.length, sample: urls[0] }));
