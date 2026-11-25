import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Editor } from 'tldraw';
import { LibraryDialog } from './assets/LibraryDialog';
import {
  describeExportTarget,
  exportBoardImage,
  planBoardExport,
  renderBoardPreview,
  type ExportFormat,
  type ExportScope,
} from '../lib/tldrawBoardTools';
import { EXPORT_SCALES } from '../lib/boardLayout';

// ─────────────────────────────────────────────────────────────────────────
// Export dialog for a Moodboard. Renders with tldraw's own exporter (so the
// file matches what is on the canvas, aspect ratios and layout included) and
// shows the exact output size up front. Boards too big for a browser canvas
// are exported at a reduced scale instead of failing — the dialog says so.
// Lazy-loaded from BoardPage: it pulls in tldraw.
// ─────────────────────────────────────────────────────────────────────────

const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string }> = [
  { id: 'png', label: 'PNG' },
  { id: 'jpeg', label: 'JPG' },
  { id: 'svg', label: 'SVG' },
];

export default function ExportBoardDialog({
  editor,
  boardName,
  onClose,
}: {
  editor: Editor;
  boardName: string;
  onClose: () => void;
}) {
  // Selection is read once, when the dialog opens: clicking inside the
  // dialog must not change what "Selection" means.
  const selectionCount = useMemo(() => editor.getSelectedShapeIds().length, [editor]);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scope, setScope] = useState<ExportScope>(selectionCount > 0 ? 'selection' : 'board');
  const [scale, setScale] = useState<number>(2);
  const [background, setBackground] = useState(true);
  const [busy, setBusy] = useState(false);

  const target = useMemo(() => describeExportTarget(editor, scope), [editor, scope]);
  const plan = target ? planBoardExport(target, scale) : null;
  const raster = format !== 'svg';

  // Preview of exactly what the file will contain. Re-rendered (debounced) when
  // the area, format or background changes; stale renders are dropped and every
  // object URL is revoked so reopening the dialog never leaks memory.
  const [preview, setPreview] = useState<{ url: string; forKey: string } | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const previewKey = `${scope}|${format}|${background}`;
  useEffect(() => {
    if (!target) { setPreview(null); return; }
    let live = true;
    let made: string | null = null;
    setPreviewState('loading');
    const t = setTimeout(() => {
      renderBoardPreview(editor, { scope, format, background })
        .then(blob => {
          if (!live) return;
          if (!blob || blob.size === 0) { setPreview(null); setPreviewState('failed'); return; }
          made = URL.createObjectURL(blob);
          setPreview({ url: made, forKey: previewKey });
          setPreviewState('ready');
        })
        .catch(() => { if (live) { setPreview(null); setPreviewState('failed'); } });
    }, 150);
    return () => { live = false; clearTimeout(t); if (made) URL.revokeObjectURL(made); };
  }, [editor, scope, format, background, previewKey, target]);

  const run = async () => {
    setBusy(true);
    try {
      const { plan: done, fileName } = await exportBoardImage(editor, { format, scope, scale, background, boardName });
      toast.success(
        done.reduced && format !== 'svg'
          ? `Exported ${fileName} at ${done.width}×${done.height}px (scaled down to fit)`
          : `Exported ${fileName}`,
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error && err.message === 'Nothing to export'
        ? 'This board is empty — add something to export it'
        : 'Export failed. Try a smaller scale or fewer images.';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const group = (label: string, children: React.ReactNode) => (
    <div>
      <p className="type-caption" style={{ margin: '0 0 6px' }}>{label}</p>
      {children}
    </div>
  );

  return (
    <LibraryDialog
      title="Export board"
      subtitle={boardName}
      onClose={onClose}
      maxWidth={440}
      footer={
        <>
          <button type="button" className="btn-translucent" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || !target} onClick={run}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          aria-label="Export preview"
          style={{
            minHeight: 140, maxHeight: 260, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, boxSizing: 'border-box',
            // Checkerboard shows transparency honestly.
            backgroundColor: 'var(--color-surface-1)',
            backgroundImage: !background && format !== 'jpeg'
              ? 'conic-gradient(#8883 25%, transparent 0 50%, #8883 0 75%, transparent 0)' : undefined,
            backgroundSize: '16px 16px',
          }}
        >
          {preview && previewState !== 'failed' && (
            <img src={preview.url} alt="Preview of the exported image" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain', opacity: previewState === 'loading' ? 0.5 : 1, transition: 'opacity 0.15s' }} />
          )}
          {!preview && previewState === 'loading' && target && <span className="type-micro" role="status">Rendering preview…</span>}
          {!target && <span className="type-micro">Nothing to preview — this board is empty.</span>}
          {previewState === 'failed' && target && <span className="type-micro" role="status">Preview unavailable — you can still export.</span>}
        </div>

        {group('Format', (
          <div className="segmented is-block" role="group" aria-label="Format">
            {FORMATS.map(f => (
              <button key={f.id} type="button" className="segmented-item" aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        ))}

        {group('Area', (
          <div className="segmented is-block" role="group" aria-label="Area">
            <button type="button" className="segmented-item" aria-pressed={scope === 'board'} onClick={() => setScope('board')}>
              Whole board
            </button>
            <button
              type="button" className="segmented-item" aria-pressed={scope === 'selection'}
              disabled={selectionCount === 0} onClick={() => setScope('selection')}
              title={selectionCount === 0 ? 'Select items on the board first' : undefined}
            >
              Selection{selectionCount > 0 ? ` (${selectionCount})` : ''}
            </button>
          </div>
        ))}

        {raster && group('Scale', (
          <div className="segmented is-block" role="group" aria-label="Scale">
            {EXPORT_SCALES.map(s => (
              <button key={s} type="button" className="segmented-item" aria-pressed={scale === s} onClick={() => setScale(s)}>
                {s}×
              </button>
            ))}
          </div>
        ))}

        {format !== 'jpeg' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={!background} onChange={e => setBackground(!e.target.checked)} />
            Transparent background
          </label>
        )}

        <p className="type-micro" role="status" style={{ margin: 0 }}>
          {!target && 'Nothing to export yet — this board is empty.'}
          {target && plan && !raster && 'Vector file — scales to any size.'}
          {target && plan && raster && plan.ok && (
            <>
              Output: {plan.width} × {plan.height} px
              {plan.reduced && ' — scaled down to fit browser limits for very large boards.'}
            </>
          )}
        </p>
      </div>
    </LibraryDialog>
  );
}
