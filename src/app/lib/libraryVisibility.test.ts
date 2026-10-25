import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assetPublishedMessage, canRemoveIncomingShare, communityAvailable, shareDialogMode, isLibraryOwner, libraryAttribution, matchesLibraryScope, visibilityHint, VISIBILITY_LABEL } from './libraryVisibility';

// Shared Creative Library — client helpers, plus static guards that the
// owner-only controls stay owner-only in the UI (the server enforces the
// same rules; see backend/tests/library-visibility.test.ts). Frontend tests
// run in node, so rendered behavior is covered by browser QA.

const mine = { owner_roll: 'ME', owner_name: 'Me', visibility: 'personal' as const };
const myShared = { ...mine, visibility: 'community' as const };
const theirs = { owner_roll: 'THEM', owner_name: 'Venu', visibility: 'community' as const };
const theirPrivate = { ...theirs, visibility: 'personal' as const };

describe('matchesLibraryScope mirrors the server scopes', () => {
  it('all = my items plus other members’ community items, never their personal ones', () => {
    expect([mine, myShared, theirs, theirPrivate].map(i => matchesLibraryScope(i, 'all', 'ME'))).toEqual([true, true, true, false]);
  });
  it('mine = owned by me, either visibility', () => {
    expect([mine, myShared, theirs, theirPrivate].map(i => matchesLibraryScope(i, 'mine', 'ME'))).toEqual([true, true, false, false]);
  });
  it('community = community items, mine included', () => {
    expect([mine, myShared, theirs, theirPrivate].map(i => matchesLibraryScope(i, 'community', 'ME'))).toEqual([false, true, true, false]);
  });
});

describe('ownership and attribution', () => {
  it('only the owner is the owner — no session means no owner', () => {
    expect(isLibraryOwner(mine, 'ME')).toBe(true);
    expect(isLibraryOwner(theirs, 'ME')).toBe(false);
    expect(isLibraryOwner(mine, null)).toBe(false);
    expect(isLibraryOwner(mine, '')).toBe(false);
  });
  it('credits the creator, or "you"', () => {
    expect(libraryAttribution(theirs, 'ME')).toBe('by Venu');
    expect(libraryAttribution(myShared, 'ME')).toBe('by you');
    expect(libraryAttribution({ ...theirs, owner_name: null }, 'ME')).toBe('by a workspace member');
    expect(libraryAttribution({ ...theirs, owner_name: '  ' }, 'ME')).toBe('by a workspace member');
  });
});

describe('visibility copy', () => {
  it('labels are words, not colors', () => {
    expect(VISIBILITY_LABEL).toEqual({ personal: 'Personal', community: 'Community' });
  });
  it('explains each choice; template community is its workspace, and unavailable in a personal one', () => {
    expect(visibilityHint('personal', 'template', 'Design Team', false)).toBe('Only you can use this template.');
    expect(visibilityHint('community', 'template', 'Design Team', false)).toMatch(/^Anyone in Design Team can discover and use this template\. Only you can edit or delete it\.$/);
    expect(visibilityHint('personal', 'template', 'Personal', true)).toMatch(/Community sharing is available in team workspaces/);
    expect(communityAvailable('template', true)).toBe(false);
    expect(communityAvailable('template', false)).toBe(true);
  });
  it('share dialog: manage-only once the owner left the workspace, regardless of visibility', () => {
    expect(shareDialogMode(true, true)).toBe('share');
    expect(shareDialogMode(true, false)).toBe('publish-first');
    expect(shareDialogMode(false, true)).toBe('manage-only');
    expect(shareDialogMode(false, false)).toBe('manage-only');
  });
  it('only a workspace owner/admin may remove an asset shared into it, never their own', () => {
    const incoming = { workspace_id: 'source', owner_roll: 'OWNER' };
    expect(canRemoveIncomingShare(incoming, 'team', 'ADMIN', 'admin')).toBe(true);
    expect(canRemoveIncomingShare(incoming, 'team', 'BOSS', 'owner')).toBe(true);
    expect(canRemoveIncomingShare(incoming, 'team', 'MEMBER', 'member')).toBe(false);
    expect(canRemoveIncomingShare(incoming, 'team', 'X', undefined)).toBe(false);
    // Not shared in: it lives here.
    expect(canRemoveIncomingShare({ workspace_id: 'team', owner_roll: 'OWNER' }, 'team', 'ADMIN', 'admin')).toBe(false);
    // Their own asset: they manage it from Share with workspace… instead.
    expect(canRemoveIncomingShare({ workspace_id: 'source', owner_roll: 'ADMIN' }, 'team', 'ADMIN', 'admin')).toBe(false);
  });
  it('asset community is always available; its copy never promises reach a personal workspace lacks', () => {
    for (const personalWs of [true, false]) {
      expect(communityAvailable('asset', personalWs)).toBe(true);
      expect(visibilityHint('personal', 'asset', 'Personal', personalWs)).toBe('Only you can use this asset.');
    }
    expect(visibilityHint('community', 'asset', 'Personal', true)).toBe('Only workspaces you share it with can use it — choose Share with workspace… from its ⋯ menu. Only you can edit or delete it.');
    expect(visibilityHint('community', 'asset', 'Design Team', false)).toBe('Anyone in Design Team can discover and use this asset, plus any workspace you share it with. Only you can edit or delete it.');
    expect(assetPublishedMessage('Personal', true)).toBe('Published to Community — share it with a workspace so others can use it');
    expect(assetPublishedMessage('Design Team', false)).toBe('Published to Community — everyone in Design Team can use it');
  });
});

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('owner-only controls (static)', () => {
  it('Templates: the ⋮ management menu renders only for the owner; Use Template is for everyone', () => {
    const src = read('pages/TemplatesPage.tsx');
    expect(src).toMatch(/\{isOwner && \(\n\s*<button[\s\S]{0,200}setMenuTemplate\(template\)/);
    expect(src).toMatch(/Publish to Community/);
    expect(src).toMatch(/Make Personal/);
    // Use Template is not gated on ownership.
    expect(src).toMatch(/\{!template\.is_archived && \(\n\s*<button\n\s*onClick=\{\(\) => openUse\(template\)\}/);
  });
  it('Assets: rename, publish/unpublish and delete sit inside the owner-only block', () => {
    const src = read('components/assets/AssetCard.tsx');
    const block = src.slice(src.indexOf('{isOwner && (<>'), src.indexOf('</>)}'));
    for (const action of ['Rename…', 'Make Personal', 'Publish to Community', 'Delete']) expect(block).toContain(action);
    expect(src.slice(0, src.indexOf('{isOwner && (<>'))).not.toMatch(/onDelete\(asset\)|onRename\(asset\)/);
  });
  it('save/upload flows default to Personal and use the shared segmented control', () => {
    expect(read('pages/BoardPage.tsx')).toMatch(/useState<\{ name: string; description: string; visibility: LibraryVisibility \}>\(\{ name: '', description: '', visibility: 'personal' \}\)/);
    expect(read('components/assets/AddAssetDialog.tsx')).toMatch(/useState<LibraryVisibility>\('personal'\)/);
    const picker = read('components/library/LibraryVisibility.tsx');
    expect(picker).toMatch(/className="segmented is-block"/);
    expect(picker).toMatch(/aria-pressed=\{value === option\}/);
  });
  it('the Save as Template dialog is an accessible modal (name, Escape/focus via useModalA11y)', () => {
    const board = read('pages/BoardPage.tsx');
    expect(board).toMatch(/ref=\{saveTemplateDialogRef\}\n\s*role="dialog"\n\s*aria-modal="true"\n\s*aria-label="Save as Template"/);
    expect(board).toMatch(/useModalA11y\(showSaveAsTemplate/);
  });
});

describe('admin moderation UI + upload limit (static)', () => {
  it('the Admin panel registers Assets and Templates tabs backed by the admin endpoints only', () => {
    const admin = read('pages/AdminPage.tsx');
    expect(admin).toMatch(/\{ id: 'assets',\s+label: 'Assets'/);
    expect(admin).toMatch(/\{ id: 'templates',\s+label: 'Templates'/);
    expect(admin).toMatch(/<LibraryModerationTab kind="assets" \/>/);
    expect(admin).toMatch(/<LibraryModerationTab kind="templates" \/>/);
    const tab = read('components/admin/LibraryModerationTab.tsx');
    expect(tab).toMatch(/api\.assets\.adminList/);
    expect(tab).toMatch(/api\.templates\.adminUpdate/);
    expect(tab).not.toMatch(/api\.(assets|templates)\.(list|update|delete)\(/);
    expect(tab).toMatch(/if \(!confirm\(/); // Hide asks first
  });
  it('upload copy and validation read the shared 300 MB constant', () => {
    expect(read('components/assets/AddAssetDialog.tsx')).toMatch(/Files up to \{MAX_UPLOAD_LABEL\}/);
    const admin = read('pages/AdminPage.tsx');
    expect(admin).toMatch(/Maximum file size: \{MAX_UPLOAD_LABEL\}/);
    expect(admin).not.toMatch(/MAX_MB|max 50 MB/);
    expect(read('lib/uploadLimits.ts')).toMatch(/export \* from '\.\.\/\.\.\/\.\.\/backend\/src\/lib\/uploadLimits'/);
  });
});

describe('asset upload + moderation wiring (static)', () => {
  it('the Add Asset queue plans files up front, sends an idempotency key, reports progress, and offers Retry', () => {
    const dialog = read('components/assets/AddAssetDialog.tsx');
    expect(dialog).toMatch(/planUploadBatch\(files\)/);
    expect(dialog).toMatch(/clientUploadId: next\.clientUploadId/);
    expect(dialog).toMatch(/onProgress: fraction =>/);
    expect(dialog).toMatch(/role="progressbar"/);
    expect(dialog).toMatch(/onClick=\{\(\) => retry\(item\.key\)\}/);
    // A failure shows the classified reason, never the raw exception text alone.
    expect(dialog).toMatch(/err instanceof UploadError/);
    // A server rate limit pauses the queue for Retry-After, then resumes.
    expect(dialog).toMatch(/if \(failure\.retryAfterSeconds\) \{[\s\S]*?await pause\(failure\.retryAfterSeconds \* 1000\);[\s\S]*?continue;/);
    const api = read('lib/api.ts');
    expect(api).toMatch(/formData\.append\('client_upload_id', opts\.clientUploadId\)/);
    expect(api).toMatch(/xhr\.onerror = \(\) => reject\(new UploadError\(describeUploadFailure\(\{ type: 'network' \}\)\)\)/);
  });
  it('a broken image shows a genuine error tile; files keep their type tile', () => {
    const preview = read('components/assets/AssetPreview.tsx');
    expect(preview).toMatch(/aria-label="Image couldn't load"/);
    expect(preview).toMatch(/else setFailed\(true\)/);
  });
  it('admins delete assets through the admin endpoint, after a confirm', () => {
    const tab = read('components/admin/LibraryModerationTab.tsx');
    expect(tab).toMatch(/api\.assets\.adminDelete\(row\.id\)/);
    expect(tab.slice(tab.indexOf('const remove'), tab.indexOf('const hide'))).toMatch(/if \(!confirm\(/);
  });
  it('a community asset from another workspace can be used but not filed into this workspace\'s collections', () => {
    expect(read('components/assets/AssetBrowser.tsx')).toMatch(/canMove=\{asset\.workspace_id === workspaceId && asset\.owner_roll === roll\}/);
    expect(read('components/assets/AssetCard.tsx')).toMatch(/\{canMove && <DropdownMenu\.Item/);
  });
});
