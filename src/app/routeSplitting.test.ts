import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// V3.2.6 — route-level code splitting guard. Walks the *static* import graph
// from the Vite entry (src/main.tsx) — the modules that end up in the entry
// chunk — and checks that route-exclusive pages and heavy route-only
// packages are not reachable from it. `import type` and dynamic `import()`
// don't pull code into the entry chunk, so they are not followed.

const SRC = path.resolve(__dirname, '..');
const ENTRY = path.join(SRC, 'main.tsx');
const EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

// Matches `import X from '…'`, `import '…'`, `export … from '…'` — but not
// `import type …` / `export type …`.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function staticGraph() {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (spec.startsWith('.')) {
        const target = resolve(file, spec);
        if (target) queue.push(target);
      } else {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
  }
  return { files: [...files].map(f => path.relative(SRC, f)), packages };
}

describe('route-level code splitting', () => {
  const graph = staticGraph();

  it('walks the real app graph (sanity)', () => {
    expect(graph.files).toContain('app/routes.tsx');
    expect(graph.files).toContain('app/pages/MoodboardsPage.tsx');
    expect(graph.files.length).toBeGreaterThan(50);
  });

  it('keeps Admin, Design Studio and Palette out of the entry chunk', () => {
    for (const mod of ['app/pages/AdminPage.tsx', 'app/pages/DesignStudioPage.tsx', 'app/pages/PalettePage.tsx']) {
      expect(graph.files, mod).not.toContain(mod);
    }
    expect(graph.files.filter(f => /PaletteStudio|HalftoneStudio|ImageCropper/.test(f))).toEqual([]);
  });

  it('keeps route-only packages out of the entry chunk', () => {
    for (const pkg of ['recharts', 'browser-image-compression', 'react-image-crop', 'tldraw', '@tldraw/sync']) {
      expect(graph.packages.has(pkg), pkg).toBe(false);
    }
  });

  it('keeps the board canvas lazy', () => {
    expect(graph.files.filter(f => /TldrawCanvas|tldrawCanvasShared/.test(f))).toEqual([]);
  });

  it('still routes to each split page through a dynamic import', () => {
    const routes = fs.readFileSync(path.join(SRC, 'app/routes.tsx'), 'utf8');
    for (const page of ['AdminPage', 'DesignStudioPage', 'PalettePage']) {
      expect(routes, page).toContain(`import('./pages/${page}')`);
    }
  });
});
