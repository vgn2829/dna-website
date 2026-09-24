import { FileText, FileArchive, FileImage, FileVideo, FileAudio, Presentation, PenTool, Type, File as FileIcon } from 'lucide-react';
import type { Asset } from '../../lib/api';
import { fileFamily, type FileFamily } from '../../lib/assetLibrary';

// ─────────────────────────────────────────────────────────────────────────
// The visual block of an asset — a real preview for images, a file-type
// tile for everything else (PSD/AI/PDF/ZIP/... are never parsed or
// rendered; the tile is built purely from the stored extension). Fills
// its parent, which owns the size/aspect-ratio and clipping. Shared by
// AssetCard and Home's "Recent Assets" strip.
// ─────────────────────────────────────────────────────────────────────────

const FAMILY_ICON: Record<FileFamily, typeof FileIcon> = {
  design: PenTool, document: FileText, slides: Presentation, archive: FileArchive,
  image: FileImage, video: FileVideo, audio: FileAudio, font: Type, other: FileIcon,
};

export function AssetPreview({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  if (asset.kind === 'image' && asset.url) {
    return (
      <img
        src={asset.url}
        alt=""
        loading="lazy"
        draggable={false}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  const Icon = FAMILY_ICON[fileFamily(asset.extension)];
  return (
    <div
      aria-hidden="true"
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: compact ? 6 : 10, background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)',
      }}
    >
      <Icon size={compact ? 18 : 24} strokeWidth={1.75} />
      {asset.extension && (
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 600,
          fontSize: compact ? 13 : 22, letterSpacing: compact ? '-0.2px' : '-0.6px',
          color: 'var(--color-ink)', lineHeight: 1,
          maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          .{asset.extension.toUpperCase()}
        </span>
      )}
    </div>
  );
}
