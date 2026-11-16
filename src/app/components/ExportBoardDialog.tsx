import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Editor } from 'tldraw';
import { LibraryDialog } from './assets/LibraryDialog';
import {
  describeExportTarget,
  exportBoardImage,
  planBoardExport,
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
