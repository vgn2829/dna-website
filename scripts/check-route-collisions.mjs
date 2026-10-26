// Post-build guard (run after `vite build`): no top-level client route may
// share its name with a file or directory in the built site root. Vercel
// serves real files/directories before the SPA rewrite to index.html, so a
// collision makes a refresh of that route return the file instead of the
// app — /assets once served a JS chunk from dist/assets/ this way.
// src/app/deepLinkRoutes.test.ts checks the config; this checks the output.
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.resolve(root, process.argv[2] ?? 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`check-route-collisions: no build at ${dist} — run vite build first`);
  process.exit(1);
}
const routes = [...fs.readFileSync(path.join(root, 'src/app/routes.tsx'), 'utf8').matchAll(/path:\s*'([^']+)'/g)]
  .map(m => m[1].replace(/^\//, '').split('/')[0])
  .filter(seg => seg && !seg.startsWith(':'));
if (!routes.includes('assets')) {
  console.error('check-route-collisions: route list looks wrong (no "assets") — update the parser');
  process.exit(1);
}
const entries = new Set(fs.readdirSync(dist));
const collisions = [...new Set(routes)].filter(r => entries.has(r));
if (collisions.length) {
  console.error(`check-route-collisions: built output shadows client routes: ${collisions.map(c => `/${c}`).join(', ')}`);
  process.exit(1);
}
console.log(`check-route-collisions: ${new Set(routes).size} routes, ${entries.size} root entries, no collisions`);
