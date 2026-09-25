import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards for the workspace design-system remediation (audit H4 + H5): the
// workspace pages and dialogs use the shared button/segmented primitives and
// the type-* scale instead of inline one-offs. Static — frontend tests run
// in node (vitest.config.mts); the rendered result is covered by browser QA.
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const WORKSPACE_FILES = [
  'pages/MoodboardsPage.tsx', 'pages/AssetsPage.tsx', 'pages/ProjectsPage.tsx', 'pages/ProjectDetailPage.tsx',
  'pages/TemplatesPage.tsx', 'pages/HomeShellPage.tsx', 'pages/BoardPage.tsx',
  'components/ShareBoardDialog.tsx', 'components/WorkspacesPanel.tsx', 'components/WorkspaceSettingsModal.tsx',
  'components/VersionHistoryPanel.tsx', 'components/CommentThreadPanel.tsx', 'components/BoardCard.tsx',
  'components/assets/AssetBrowser.tsx', 'components/assets/AddAssetDialog.tsx', 'components/assets/LibraryDialog.tsx',
];

// Opening tags of every <button> / <motion.button> / Radix trigger, braces balanced.
function buttonTags(src: string): string[] {
  const out: string[] = [];
  const re = /<(button|motion\.button|DropdownMenu\.Trigger)\b/g;
  for (let m; (m = re.exec(src));) {
    let depth = 0, j = m.index;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, j + 1));
  }
  return out;
}

describe('workspace buttons use the product button language (H4)', () => {
  for (const f of WORKSPACE_FILES) {
    it(`${f}: no bordered ghost buttons and no pink-filled buttons`, () => {
      for (const tag of buttonTags(read(f))) {
        const ghost = /background: 'none'[^>]*border: ['`]1px (solid|dashed)/s.test(tag) || /border: ['`]1px (solid|dashed)[^>]*background: 'none'/s.test(tag);
        expect(ghost, `bordered ghost button in ${f}:\n${tag.slice(0, 200)}`).toBe(false);
        // the brand accent is for selected/active state (aria-pressed via CSS), never a button fill
        expect(/background: (?:[^,]*\? )?'var\(--color-brand\)'/.test(tag), `pink-filled button in ${f}:\n${tag.slice(0, 200)}`).toBe(false);
      }
    });
  }

  it('board header: actions are compact lifted pills, Share is the primary, Delete is a separated destructive icon control', () => {
    const board = read('pages/BoardPage.tsx');
    expect(board).toMatch(/onClick=\{\(\) => setShowShare\(true\)\}\n\s*className="btn-primary btn-sm touch-target"/);
    for (const h of ['setShowAssetLibrary(true)', 'setShowVersionHistory(true)']) {
      expect(board).toContain(`onClick={() => ${h}}\n                  title=`);
    }
    expect(board).toMatch(/aria-label="Delete board"\n\s*title="Delete board"\n\s*className="btn-translucent btn-icon btn-sm is-danger touch-target"/);
    expect(board.match(/className="btn-translucent btn-sm touch-target"/g)?.length).toBe(3); // Assets, History, Save as Template
  });

  it('Share dialog: Private/Shared and edit-mode are segmented toggles; Add/Copy/Remove are pills', () => {
    const share = read('components/ShareBoardDialog.tsx');
    expect(share.match(/className="segmented is-block"/g)?.length).toBe(2);
    expect(share).toMatch(/onClick=\{handleAddMember\}[\s\S]{0,120}className="btn-primary"/);
    expect(share).toMatch(/aria-label="Copy board link"\n\s*className="btn-translucent"/);
    expect(share).toMatch(/className="btn-translucent btn-sm is-danger touch-target"\n\s*>\n\s*Remove/);
  });
});

describe('workspace typography uses the type scale (H5)', () => {
  it('every workspace page title is display-md', () => {
    for (const f of ['pages/MoodboardsPage.tsx', 'pages/AssetsPage.tsx', 'pages/ProjectsPage.tsx', 'pages/ProjectDetailPage.tsx', 'pages/TemplatesPage.tsx', 'pages/HomeShellPage.tsx']) {
      const h1s = read(f).match(/<h1\b[^>]*>/g) ?? [];
      expect(h1s.length, f).toBeGreaterThan(0);
      for (const h of h1s) expect(h, f).toMatch(/className="type-display-md"/);
    }
  });

  it('no workspace page title keeps fixed px sizes or tracking (85/52/42px, -4.25/-2/-1.5px)', () => {
    for (const f of WORKSPACE_FILES) expect(read(f), f).not.toMatch(/<h1 style=\{\{[^}]*fontSize/);
  });

  it('dialog and panel titles use the headline tier (same as the sign-in dialog)', () => {
    for (const f of ['components/ShareBoardDialog.tsx', 'components/WorkspacesPanel.tsx', 'components/VersionHistoryPanel.tsx', 'components/CommentThreadPanel.tsx', 'components/assets/LibraryDialog.tsx']) {
      const h3s = read(f).match(/<h3\b[^>]*>/g) ?? [];
      expect(h3s.length, f).toBeGreaterThan(0);
      for (const h of h3s) expect(h, f).toMatch(/className="type-headline"/);
    }
  });

  it('no uppercase, positively-tracked labels remain in workspace dialogs and cards', () => {
    // BoardPage is excluded: its remaining instance is the visibility badge in
    // the breadcrumb, which is board navigation and out of scope.
    for (const f of WORKSPACE_FILES.filter(f => f !== 'pages/BoardPage.tsx')) {
      expect(read(f), f).not.toMatch(/letterSpacing: '0\.0[46]em',?\s*textTransform: 'uppercase'|textTransform: 'uppercase'[^}]*letterSpacing: '0\.0[46]em'/);
    }
  });

  it('comment text and composer are on the body tier, not 12.5px', () => {
    const c = read('components/CommentThreadPanel.tsx');
    expect(c).not.toMatch(/fontSize: 12\.5/);
    expect(c.match(/className="type-body"\n\s*style=\{textareaStyle\}/g)?.length).toBe(2);
  });

  it('card titles are body-sm (the spec template-card type), not 15/600', () => {
    for (const f of ['components/BoardCard.tsx', 'pages/ProjectsPage.tsx', 'pages/TemplatesPage.tsx', 'pages/HomeShellPage.tsx', 'components/assets/AssetCard.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/className="type-body-sm"/);
      expect(src, f).not.toMatch(/fontSize: 15, fontWeight: 600/);
    }
  });
});
