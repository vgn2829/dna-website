import { FileText, FileArchive, FileImage, FileVideo, FileAudio, Presentation, PenTool, Type, File as FileIcon, Link2 } from 'lucide-react';
import type { Asset } from '../../lib/api';
import { assetPreviewFallback, assetPreviewSrc, fileFamily, linkDomain, linkSource, type FileFamily } from '../../lib/assetLibrary';

// ─────────────────────────────────────────────────────────────────────────
// The visual block of an asset — a real preview for images (its t512
// thumbnail when the server has one ready, else the original), a file-type
// tile for files (PSD/AI/PDF/ZIP/... are never parsed or rendered; the
// tile is built purely from the stored extension), and a link tile for
// external links (source + domain from the URL itself — no remote
// thumbnail is fetched). Fills its parent, which owns the size/aspect
// ratio and clipping. Shared by AssetCard and Home's "Recent Assets".
// ─────────────────────────────────────────────────────────────────────────

const FAMILY_ICON: Record<FileFamily, typeof FileIcon> = {
  design: PenTool, document: FileText, slides: Presentation, archive: FileArchive,
  image: FileImage, video: FileVideo, audio: FileAudio, font: Type, other: FileIcon,
};

export function AssetPreview({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  const previewSrc = assetPreviewSrc(asset);
  if (asset.kind === 'image' && previewSrc) {
    return (
      <img
        src={previewSrc}
        // A ready thumbnail that fails to load (e.g. its object went
        // missing) falls back to the original, once.
        onError={e => {
          const fallback = assetPreviewFallback(asset, e.currentTarget.getAttribute('src') ?? '');
          if (fallback) e.currentTarget.src = fallback;
        }}
        alt=""
        loading="lazy"
        draggable={false}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  if (asset.kind === 'link') {
    const source = linkSource(asset.link_url);
    const domain = linkDomain(asset.link_url);
    return (
      <div
        aria-hidden="true"
        style={{
          width: '100%', height: '100%', padding: compact ? 8 : 12,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: compact ? 6 : 8, background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', textAlign: 'center',
        }}
      >
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: compact ? 28 : 36, height: compact ? 28 : 36, borderRadius: 'var(--radius-full)',
          background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink)',
        }}>
          <Link2 size={compact ? 14 : 18} strokeWidth={2} />
        </span>
        {!compact && source && (
          <span style={{
            // flexShrink 0: overflow:hidden would otherwise let the column
            // squeeze these lines and clip descenders in short tiles.
            flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.4px',
            color: 'var(--color-ink)', lineHeight: 1.3, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {source}
          </span>
        )}
        {!compact && domain && domain !== source && (
          <span style={{ flexShrink: 0, fontSize: 12, lineHeight: 1.3, fontFamily: 'var(--font-body)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {domain}
          </span>
        )}
      </div>
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
          color: 'var(--color-ink)', lineHeight: 1.15, flexShrink: 0,
          maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          .{asset.extension.toUpperCase()}
        </span>
      )}
    </div>
  );
}
