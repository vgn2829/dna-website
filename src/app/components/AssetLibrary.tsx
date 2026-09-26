import type { Asset } from '../lib/api';
import { AssetBrowser } from './assets/AssetBrowser';
import { LibraryDialog } from './assets/LibraryDialog';

// ─────────────────────────────────────────────────────────────────────────
// Asset library as a MODAL — the board's "Assets" picker (BoardPage.tsx).
// Same props and same contract as before: onSelect is called with the
// chosen asset and BoardPage's existing handleInsertAsset inserts it via
// insertImageAsset(..., asset.id) (meta.sourceAssetId) — nothing about
// that path changed. Only images are insertable; files and links are
// library resources (download/open), so a picker opens on the Images tab.
//
// The library itself lives in assets/AssetBrowser.tsx, shared with the
// full-page /assets route (AssetsPage.tsx).
// ─────────────────────────────────────────────────────────────────────────

export function AssetLibrary({
  workspaceId,
  workspaceName,
  roll,
  onClose,
  onSelect,
  isPersonalWorkspace = false,
}: {
  workspaceId: string;
  workspaceName: string;
  roll: string;
  isPersonalWorkspace?: boolean;
  onClose: () => void;
  onSelect?: (asset: Asset) => void;
}) {
  return (
    <LibraryDialog
      title="Asset Library"
      subtitle={onSelect ? `${workspaceName} · click an image to add it to the board` : workspaceName}
      onClose={onClose}
      maxWidth={920}
    >
      <AssetBrowser
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        roll={roll}
        onInsert={onSelect}
        initialTab={onSelect ? 'image' : 'all'}
        isPersonalWorkspace={isPersonalWorkspace}
      />
    </LibraryDialog>
  );
}
