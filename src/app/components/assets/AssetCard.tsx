import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { MoreHorizontal, Download, ExternalLink, Trash2, ImagePlus, FolderInput, Pencil, Copy, Layers } from 'lucide-react';
import type { Asset } from '../../lib/api';
import { assetMetaLine, displayUrl, FAMILY_LABEL, fileFamily } from '../../lib/assetLibrary';
import { usePortalContainer } from '../PortalContainer';
import { AssetPreview } from './AssetPreview';

// ─────────────────────────────────────────────────────────────────────────
// One library item. The preview area is the card's primary action:
//   image → insert onto the board when the library is open from a board
//           (onInsert), otherwise open the full image
//   file  → download (asset.url is already a download URL for files)
//   link  → open the external URL in a new tab (noopener/noreferrer)
// Everything else lives in the "⋯" menu (Radix — keyboard accessible, and
// portalled so it isn't clipped by the card's overflow:hidden; that
// escape is intentional).
// ─────────────────────────────────────────────────────────────────────────

export function AssetCard({
  asset,
  collectionName,
  onInsert,
  onMove,
  onRename,
  onDelete,
}: {
  asset: Asset;
  // Shown as a chip when set (the browser omits it while already filtered
  // to that collection).
  collectionName?: string | null;
  onInsert?: (asset: Asset) => void;
  onMove: (asset: Asset) => void;
  onRename: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
}) {
  const portalContainer = usePortalContainer();
  const canInsert = asset.kind === 'image' && !!onInsert;
  const typeLabel = asset.kind === 'image' ? 'Image' : asset.kind === 'link' ? 'Link' : FAMILY_LABEL[fileFamily(asset.extension)];
  const href = asset.kind === 'link' ? asset.link_url : asset.url;

  const primaryLabel = canInsert
    ? `Insert ${asset.filename} onto the board`
    : asset.kind === 'image' ? `Open ${asset.filename}`
    : asset.kind === 'link' ? `Open link ${asset.filename}`
    : `Download ${asset.filename}`;

  // Images: the preview already says "image" — lead with format/size.
  const metaLine = asset.kind === 'link'
    ? displayUrl(asset.link_url) || 'Link'
    : asset.kind === 'image'
      ? assetMetaLine(asset) || typeLabel
      : [typeLabel, assetMetaLine(asset)].filter(Boolean).join(' · ');

  const copyLink = async () => {
    if (!asset.link_url) return;
    try {
      await navigator.clipboard.writeText(asset.link_url);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn’t copy the link');
    }
  };

  const previewInner = (
    <div style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', background: 'var(--color-canvas)' }}>
      <AssetPreview asset={asset} />
    </div>
  );

  return (
    <article
      className="asset-card"
      aria-label={`${asset.filename}, ${typeLabel}`}
      style={{
        position: 'relative', minWidth: 0,
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-1)', overflow: 'hidden',
      }}
    >
      {canInsert ? (
        <button
          type="button"
          onClick={() => onInsert!(asset)}
          aria-label={primaryLabel}
          title={`Insert ${asset.filename}`}
          style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'copy' }}
        >
          {previewInner}
        </button>
      ) : href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={primaryLabel} title={primaryLabel} style={{ display: 'block' }}>
          {previewInner}
        </a>
      ) : previewInner}

      <div style={{ padding: '10px 12px 12px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <p
          title={asset.filename}
          style={{
            margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.13px',
            fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {asset.filename}
        </p>
        <p
          title={asset.kind === 'link' ? asset.link_url ?? undefined : undefined}
          style={{
            margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {metaLine}
        </p>
        {collectionName && (
          <span style={{
            alignSelf: 'flex-start', maxWidth: '100%', marginTop: 4,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 'var(--radius-pill)',
            background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)',
            fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-body)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            <Layers size={11} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{collectionName}</span>
          </span>
        )}
      </div>

      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className="asset-card-actions touch-target"
          aria-label={`Actions for ${asset.filename}`}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 30, height: 30, borderRadius: 'var(--radius-full)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(17,17,16,0.72)', backdropFilter: 'blur(6px)',
            border: '1px solid rgba(255,255,255,0.14)', color: '#fff', cursor: 'pointer',
          }}
        >
          <MoreHorizontal size={16} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={portalContainer}>
          <DropdownMenu.Content className="dna-menu" align="end" sideOffset={6} collisionPadding={12}>
            {canInsert && (
              <DropdownMenu.Item className="dna-menu-item" onSelect={() => onInsert!(asset)}>
                <ImagePlus size={15} /> Insert on board
              </DropdownMenu.Item>
            )}
            {href && (
              <DropdownMenu.Item className="dna-menu-item" asChild>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {asset.kind === 'file' ? <><Download size={15} /> Download</>
                    : asset.kind === 'link' ? <><ExternalLink size={15} /> Open link</>
                    : <><ExternalLink size={15} /> Open image</>}
                </a>
              </DropdownMenu.Item>
            )}
            {asset.kind === 'link' && (
              <DropdownMenu.Item className="dna-menu-item" onSelect={copyLink}>
                <Copy size={15} /> Copy URL
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className="dna-menu-item" onSelect={() => onMove(asset)}>
              <FolderInput size={15} /> Move to collection…
            </DropdownMenu.Item>
            <DropdownMenu.Item className="dna-menu-item" onSelect={() => onRename(asset)}>
              <Pencil size={15} /> Rename…
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="dna-menu-sep" />
            <DropdownMenu.Item className="dna-menu-item" data-danger="true" onSelect={() => onDelete(asset)}>
              <Trash2 size={15} /> Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </article>
  );
}
