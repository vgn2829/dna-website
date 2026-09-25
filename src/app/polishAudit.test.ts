import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Source guards for the fourth UI remediation batch. The frontend suite runs in
// node, so these read component source; browser behaviour is covered by QA.
const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('M8: accent colours tint, they do not colour text', () => {
  it('Team designations, Resources tags/levels, Academy difficulty and Gallery domain chips use ink text', () => {
    // Decorative glyphs (the avatar initial, the resource type icon) keep their accent.
    expect(src('pages/TeamPage.tsx')).not.toMatch(/style=\{\{ color: member\.color, fontWeight: 600/);
    const resources = src('pages/ResourcesPage.tsx');
    expect(resources).not.toMatch(/glass"\s*style=\{\{ color: resource\.color \}\}/);
    expect(resources).not.toMatch(/color:\s*levelColors\[/);
    expect(src('pages/AcademyPage.tsx')).not.toMatch(/color:\s*DIFF_COLORS\[/);
    expect(src('pages/GalleryPage.tsx')).not.toMatch(/color:\s*domainColor\b/);
  });

  it('the Resources and Team CTAs are primary pills, not blue→purple gradients', () => {
    for (const f of ['pages/ResourcesPage.tsx', 'pages/TeamPage.tsx']) {
      expect(src(f)).not.toMatch(/linear-gradient\(135deg,\s*#007AFF/);
    }
    expect(src('pages/ResourcesPage.tsx')).toMatch(/className="btn-primary[^"]*">\s*Submit a Resource/);
    expect(src('pages/TeamPage.tsx')).toMatch(/className="btn-primary"[\s\S]{0,200}Apply Now/);
  });
});

describe('M10: empty and stalled states', () => {
  it('Home Resources renders an explicit empty state when no domains are published', () => {
    const s = src('components/ResourcesPreview.tsx');
    expect(s).toMatch(/domainList\.length === 0 \?/);
    expect(s).toContain('Learning tracks are on their way');
  });

  it('a first connect stuck in loading offers Retry after CONNECT_STALL_MS', () => {
    const s = src('pages/TldrawCanvasSync.tsx');
    expect(s).toMatch(/export const CONNECT_STALL_MS = 20_000;/);
    expect(s).toMatch(/return !hasEverConnected && status === 'loading' && elapsedMs >= CONNECT_STALL_MS;/);
    expect(s).toMatch(/\{stalled && \([\s\S]{0,400}onClick=\{onRetry\}/);
    expect(s).not.toMatch(/background: 'var\(--color-brand\)', color: '#fff',\s*border: 'none'/); // old inline Retry
  });
});

describe('search fields share one primitive', () => {
  it('.search-field positions a leading icon and pads the input for it', () => {
    const css = src('../styles/theme.css');
    expect(css).toMatch(/\.search-field \{ position: relative; display: block; \}/);
    expect(css).toMatch(/\.search-field > \.input-base \{ padding-left: 30px; font-size: 13px; \}/);
  });

  it('Moodboards and Assets use it without per-page size/radius overrides', () => {
    const mood = src('pages/MoodboardsPage.tsx');
    const assets = src('components/assets/AssetBrowser.tsx');
    expect(mood).toContain('className="search-field"');
    expect(assets).toContain('className="search-field"');
    expect(mood).not.toMatch(/paddingLeft: 30, fontSize: 13/);
    expect(assets).not.toMatch(/paddingLeft: 36, fontSize: 14, borderRadius: 'var\(--radius-pill\)'/);
  });

  it('the Moodboards sort select keeps its Batch 3 sizing (its width drives the toolbar group)', () => {
    expect(src('pages/MoodboardsPage.tsx')).toMatch(/aria-label="Sort boards"\s*style=\{\{ fontSize: 13, padding: '8px 10px', cursor: 'pointer' \}\}/);
  });
});

describe('typography and home consistency', () => {
  it('the Design Studio page title uses the display-lg token', () => {
    expect(src('pages/DesignStudioPage.tsx')).toMatch(/<h1 className="type-display-lg"/);
  });

  it('Hero and Stats read the same live member count', () => {
    expect(src('components/Stats.tsx')).toMatch(/export function useMemberCount\(\)/);
    const hero = src('components/Hero.tsx');
    expect(hero).toContain('useMemberCount()');
    expect(hero).not.toContain("value: '250+'");
  });
});
