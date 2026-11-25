import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────
// Deep links must reach the app. A refresh, a typed URL or a new tab sends
// the path to the static host first; only when NO file or directory of that
// name exists does the host fall back to index.html (vercel.json rewrite,
// nginx try_files). So no top-level client route may share its name with
// anything the build writes to the site root:
//   - Vite's assets directory (build.assetsDir, default "assets"), and
//   - everything in public/ (copied to the root as-is).
// /assets used to collide with Vite's default assets directory: Vercel
// resolved the directory and served a vendor chunk whose name starts with
// "index." (index.es-*.js) as /assets — refreshing the Asset Library showed
// raw JavaScript, while in-app navigation (no request to the host) worked.
// ─────────────────────────────────────────────────────────────────────────

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function topLevelRouteSegments(): string[] {
  const routes = read('src/app/routes.tsx');
  return [...routes.matchAll(/path:\s*'([^']+)'/g)]
    .map(m => m[1].replace(/^\//, '').split('/')[0])
    .filter(seg => seg && !seg.startsWith(':'));
}

function buildAssetsDir(): string {
  const config = read('vite.config.ts');
  return config.match(/assetsDir:\s*'([^']+)'/)?.[1] ?? 'assets'; // Vite's default
}

describe('deep links are served by the app, not shadowed by build output', () => {
  const routes = topLevelRouteSegments();

  it('finds the workspace routes this guards', () => {
    expect(routes).toEqual(expect.arrayContaining(['assets', 'templates', 'home', 'moodboards', 'projects', 'events', 'gallery', 'admin']));
  });

  it("no route shares its name with Vite's assets directory", () => {
    const assetsDir = buildAssetsDir().split('/')[0];
    expect(routes).not.toContain(assetsDir);
  });

  it('no route shares its name with anything in public/', () => {
    const publicEntries = fs.readdirSync(path.join(root, 'public'));
    expect(routes.filter(r => publicEntries.includes(r))).toEqual([]);
  });
});
