import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ExternalLink, FileText, FolderPlus, ImagePlus, Link2, MoreHorizontal, Pencil, Trash2, EyeOff, Check } from 'lucide-react';
import type { InspirationCollection, InspirationItem } from '../../lib/api';
import {
  categoryLabel, itemOpenHref, itemPreviewSrc, itemSourceLabel, moodboardPlan,
} from '../../lib/inspiration';

// ─────────────────────────────────────────────────────────────────────────
// One saved reference. Picture first (visual browsing); the source line
// says plainly whether it is a library asset or an external link, and an
// asset the viewer can no longer use shows as unavailable — with no picture
// or address at all.
// ─────────────────────────────────────────────────────────────────────────

function Media({ item }: { item: InspirationItem }) {
  const src = itemPreviewSrc(item);
  const [failed, setFailed] = useState(false);
  const known = item.asset?.width && item.asset?.height ? `${item.asset.width} / ${item.asset.height}` : null;
  const ratio = src && !failed ? (known ?? '4 / 3') : '4 / 3';
  return (
    <div style={{ width: '100%', aspectRatio: ratio, maxHeight: 420, overflow: 'hidden', background: 'var(--color-canvas)', position: 'relative' }}>
      {src && !failed ? (
        <img
          src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--color-ink-muted)', padding: 12, textAlign: 'center' }}>
          {item.unavailable ? <EyeOff size={26} aria-hidden="true" /> : item.kind === 'link' ? <Link2 size={26} aria-hidden="true" /> : <FileText size={26} aria-hidden="true" />}
          <span className="type-caption">
            {item.unavailable ? 'No longer available' : item.kind === 'link' ? (src && failed ? 'Cover image didn’t load' : 'Link') : 'No preview'}
          </span>
        </div>
      )}
    </div>
  );
}

export function InspirationCard({ item, collections, onEdit, onRemove, onToggleCollection, onAddToMoodboard, onTagClick }: {
  item: InspirationItem;
  collections: InspirationCollection[];
  onEdit: (item: InspirationItem) => void;
  onRemove: (item: InspirationItem) => void;
  onToggleCollection: (item: InspirationItem, collection: InspirationCollection, on: boolean) => void;
  onAddToMoodboard: (item: InspirationItem) => void;
  onTagClick: (tag: string) => void;
}) {
  const href = itemOpenHref(item);
  const plan = moodboardPlan(item);
  const source = itemSourceLabel(item);
  const cat = categoryLabel(item.category);
  const media = <Media item={item} />;

  return (
    <article
      aria-label={`${item.title}, ${item.kind === 'link' ? 'external link' : 'Asset Library'}`}
      className="asset-card"
      style={{
        position: 'relative', breakInside: 'avoid', marginBottom: 16, display: 'flex', flexDirection: 'column',
        border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', overflow: 'hidden',
      }}
    >
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title}`} style={{ display: 'block' }}>{media}</a>
      ) : media}

      <span
        className="type-micro"
        style={{
          position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
          borderRadius: 'var(--radius-pill)', background: 'rgba(17,17,16,0.72)', color: '#fff', backdropFilter: 'blur(6px)', maxWidth: '70%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {item.kind === 'link' ? <ExternalLink size={11} aria-hidden="true" /> : <ImagePlus size={11} aria-hidden="true" />}
        {source}
      </span>

      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className="asset-card-actions touch-target"
          aria-label={`Actions for ${item.title}`}
          style={{
            position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 'var(--radius-full)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(17,17,16,0.72)',
            backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', cursor: 'pointer',
          }}
        >
          <MoreHorizontal size={16} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dna-menu" align="end" sideOffset={6} collisionPadding={12} style={{ zIndex: 9100 }}>
            {href && (
              <DropdownMenu.Item className="dna-menu-item" asChild>
                <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> {item.kind === 'link' ? 'Open link' : 'Open'}</a>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className="dna-menu-item" onSelect={() => onEdit(item)}><Pencil size={15} /> Edit details</DropdownMenu.Item>
            <DropdownMenu.Item className="dna-menu-item" disabled={!plan} onSelect={() => onAddToMoodboard(item)}
              title={plan ? undefined : item.unavailable ? 'This asset is no longer available' : item.kind === 'link' ? 'Add a cover image to this link to place it on a board' : 'Only images can be placed on a board'}>
              <ImagePlus size={15} /> Add to Moodboard
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="dna-menu-sep" />
            <DropdownMenu.Label className="type-micro" style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FolderPlus size={13} aria-hidden="true" /> Collections
            </DropdownMenu.Label>
            {collections.length === 0 && <div className="type-micro" style={{ padding: '4px 10px 8px' }}>No collections yet</div>}
            {collections.map(c => {
              const on = item.collection_ids.includes(c.id);
              return (
                <DropdownMenu.CheckboxItem key={c.id} className="dna-menu-item" checked={on}
                  onSelect={e => { e.preventDefault(); onToggleCollection(item, c, !on); }}>
                  <span style={{ width: 15, display: 'inline-flex' }}>{on && <Check size={14} aria-hidden="true" />}</span> {c.name}
                </DropdownMenu.CheckboxItem>
              );
            })}
            <DropdownMenu.Separator className="dna-menu-sep" />
            <DropdownMenu.Item className="dna-menu-item" data-danger="true" onSelect={() => onRemove(item)}><Trash2 size={15} /> Remove</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div style={{ padding: '10px 12px 12px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p className="type-body-sm" title={item.title} style={{ margin: 0, color: 'var(--color-ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>{item.title}</p>
        {cat && <p className="type-caption" style={{ margin: 0 }}>{cat}</p>}
        {item.description && (
          <p className="type-caption" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</p>
        )}
        {item.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {item.tags.slice(0, 5).map(t => (
              <button key={t} type="button" onClick={() => onTagClick(t)} className="type-micro"
                aria-label={`Filter by tag ${t}`}
                style={{ padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', background: 'transparent', color: 'var(--color-ink-muted)', cursor: 'pointer' }}>
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
