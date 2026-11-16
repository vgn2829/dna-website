import type { Asset } from '../../lib/api';
import { LibraryDialog } from '../assets/LibraryDialog';
import { AssetBrowser } from '../assets/AssetBrowser';

// The Asset Library as a picker for showcase images (same browser and chrome
// AssetLibrary uses, with showcase wording). Picking only reports the asset;
// the server verifies the caller OWNS it before attaching it.
export function ShowcaseAssetPicker({ workspaceId, workspaceName, isPersonalWorkspace, workspaceRole, roll, onClose, onSelect }: {
  workspaceId: string; workspaceName: string; isPersonalWorkspace: boolean; workspaceRole?: 'owner' | 'admin' | 'member' | null;
  roll: string; onClose: () => void; onSelect: (asset: Asset) => void;
}) {
  return (
    <LibraryDialog title="Add an image" subtitle={`${workspaceName} · click one of your PNG, JPG or WebP images`} onClose={onClose} maxWidth={920}>
      <AssetBrowser workspaceId={workspaceId} workspaceName={workspaceName} roll={roll} onInsert={onSelect} initialTab="image" isPersonalWorkspace={isPersonalWorkspace} workspaceRole={workspaceRole} />
    </LibraryDialog>
  );
}
