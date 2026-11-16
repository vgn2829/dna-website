import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Download, ImagePlus } from 'lucide-react';
import { api, type Asset, type Board } from '../../lib/api';
import { assetMetaLine, FAMILY_LABEL, fileFamily } from '../../lib/assetLibrary';
import {
  ADD_TO_MOODBOARD_ERROR, assetDownloadHref, assetPreviewMode, canAddToMoodboard, classifyAddToMoodboardError,
  moodboardBlocker, orderMoodboardTargets,
} from '../../lib/assetPreview';
import { libraryAttribution, VISIBILITY_LABEL } from '../../lib/libraryVisibility';
import { useOptionalWorkspace } from '../../context/WorkspaceContext';
import { useStudent } from '../../context/StudentContext';
import { ArtworkLightbox, ZoomImage, useIsNarrowViewport } from '../ArtworkLightbox';
import { SaveToMoodboardDialog } from '../SaveToMoodboardDialog';
import { VisibilityBadge } from '../library/LibraryVisibility';
import { AssetPreview } from './AssetPreview';

// ─────────────────────────────────────────────────────────────────────────
// Assets preview — what clicking an image or file in the library opens, in
// the Gallery's artwork lightbox (ArtworkLightbox). Two explicit actions:
//
//   Download        — the original via the asset's own download URL (the
//                     same stored object and URL scheme as before; nothing
//                     is proxied or re-signed).
//   Add to Moodboard— images only (the canvas places images). Opens the
//                     Gallery's board picker; the chosen board receives the
//                     asset as a pending board item through the existing
//                     board_items path, which the canvas places on its next
//                     load. The server re-checks the board is writable and
//                     the asset usable in the board's workspace, and never
//                     changes the asset's visibility.
//
// Media: images preview at full quality with zoom; PDFs (desktop, ≤ 25 MB)
// in the browser's own PDF viewer from a fetched copy — never a third-party
// viewer; everything else, and any preview that fails, shows the file-type
// tile with Download still available. See lib/assetPreview.ts.
// ─────────────────────────────────────────────────────────────────────────

const PICKER_Z = 10_002;
const LIGHTBOX_Z = 10_001; // above LibraryDialog (10000) when opened from it

export function AssetPreviewModal({ asset, roll, onClose }: { asset: Asset; roll: string; onClose: () => void }) {
  const isMobile = useIsNarrowViewport();
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  const pdfViewerEnabled = typeof navigator !== 'undefined' && (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
  const mode = pdfFailed ? 'fallback' : assetPreviewMode(asset, { isMobile, pdfViewerEnabled });
  const downloadHref = assetDownloadHref(asset);
  const typeLabel = asset.kind === 'image' ? (asset.extension?.toUpperCase() ?? 'Image') : FAMILY_LABEL[fileFamily(asset.extension)];
  const meta = assetMetaLine(asset);

  const moodboard = useAddToMoodboard(asset, roll);

  const media = mode === 'image' ? (
    <ZoomImage src={asset.url!} alt={asset.filename} onAspectRatio={setAspectRatio} />
  ) : mode === 'pdf' ? (
    <PdfPreview url={asset.url!} title={asset.filename} height={isMobile ? 400 : 600} onFail={() => setPdfFailed(true)} />
  ) : (
    <FilePreviewFallback asset={asset} failed={pdfFailed} />
  );

  const actions = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {canAddToMoodboard(asset) && (
          <button type="button" className="btn-primary" onClick={moodboard.open} style={{ minHeight: 40, flex: isMobile ? '1 1 160px' : undefined }}>
            <ImagePlus size={15} /> Add to Moodboard
          </button>
        )}
        {downloadHref && (
          // An attachment URL downloads in place; without one (an older
          // API), open the original in a new tab rather than leave the app.
          <a href={downloadHref} download={asset.filename} {...(asset.download_url ? {} : { target: '_blank' })} rel="noopener noreferrer" className="btn-secondary" style={{ minHeight: 40, flex: isMobile ? '1 1 140px' : undefined }}>
            <Download size={15} /> Download
          </a>
        )}
      </div>
      {!canAddToMoodboard(asset) && (
        <p className="type-caption" style={{ margin: 0 }}>Only images can be added to a moodboard.</p>
      )}
    </div>
  );

  const heading = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="type-micro px-2 py-0.5 rounded-full uppercase" style={{ background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)' }}>{typeLabel}</span>
        <VisibilityBadge visibility={asset.visibility} />
      </div>
      <h2 className={isMobile ? undefined : 'type-headline leading-tight'} style={isMobile
        ? { fontSize: 20, fontWeight: 700, color: 'var(--color-ink)', margin: 0, lineHeight: 1.3, overflowWrap: 'anywhere' }
        : { margin: 0, overflowWrap: 'anywhere' }}>
        {asset.filename}
      </h2>
      <p className="type-caption" style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>
        {[libraryAttribution(asset, roll), meta].filter(Boolean).join(' · ')}
      </p>
    </>
  );

  const details = <AssetDetails asset={asset} typeLabel={typeLabel} />;

  return (
    <>
      <ArtworkLightbox
        label={asset.filename}
        isMobile={isMobile}
        onClose={onClose}
        media={media}
        mediaLayout={mode === 'pdf' ? 'document' : 'media'}
        aspectRatio={mode === 'image' ? aspectRatio : null}
        heading={heading}
        headingExtra={actions}
        zIndex={LIGHTBOX_Z}
      >
        {isMobile ? (
          <>
            <div style={{ padding: 16, borderBottom: '1px solid var(--color-hairline-soft)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>{heading}</div>
              {actions}
            </div>
            <div style={{ padding: 16, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>{details}</div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">{details}</div>
        )}
      </ArtworkLightbox>

      <AnimatePresence>
        {moodboard.picking && (
          <SaveToMoodboardDialog
            title="Add to Moodboard"
            description={moodboard.description}
            boards={moodboard.boards}
            loadError={moodboard.loadError}
            onRetry={moodboard.load}
            pendingBoardId={moodboard.pendingBoardId}
            boardNote={moodboard.boardNote}
            disabledReason={moodboard.disabledReason}
            onSelect={moodboard.add}
            onClose={moodboard.close}
            zIndex={PICKER_Z}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// Board loading, eligibility and the add itself. One request at a time —
// a second click while one is in flight is ignored (the server also
// collapses a repeat add of a still-pending item into the existing one).
function useAddToMoodboard(asset: Asset, roll: string) {
  const navigate = useNavigate();
  const { openRollModal } = useStudent();
  const workspaceCtx = useOptionalWorkspace();
  const [picking, setPicking] = useState(false);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pendingBoardId, setPendingBoardId] = useState<string | null>(null);
  const [denied, setDenied] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);
  const loadSeq = useRef(0);

  const workspaceName = useCallback((id: string) => {
    const ws = workspaceCtx?.workspaces.find(w => w.id === id);
    return ws ? (ws.is_personal ? 'Personal' : ws.name) : null;
  }, [workspaceCtx]);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setBoards(null);
    setLoadError(false);
    api.boards.getMyBoards(roll)
      .then(list => { if (seq === loadSeq.current) setBoards(list); })
      .catch(err => {
        if (seq !== loadSeq.current) return;
        if (err instanceof Error && err.message === 'SESSION_EXPIRED') {
          setPicking(false);
          toast.error(ADD_TO_MOODBOARD_ERROR.session);
          openRollModal();
          return;
        }
        setBoards([]);
        setLoadError(true);
      });
  }, [roll, openRollModal]);

  const open = useCallback(() => { setPicking(true); load(); }, [load]);
  const close = useCallback(() => { if (!inFlight.current) setPicking(false); }, []);

  const add = useCallback(async (board: Board) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingBoardId(board.id);
    try {
      const item = await api.boards.addAssetItem(board.id, roll, asset.id, `${window.location.origin}/assets`);
      setPicking(false);
      toast.success(item.duplicate ? `Already added to “${board.name}”` : `Added to “${board.name}”`, {
        description: 'It appears on the board the next time it opens.',
        action: { label: 'Open board', onClick: () => navigate(`/moodboards/${board.id}`) },
      });
    } catch (err) {
      const failure = classifyAddToMoodboardError(err);
      toast.error(ADD_TO_MOODBOARD_ERROR[failure]);
      if (failure === 'session') { setPicking(false); openRollModal(); }
      if (failure === 'no-edit') setDenied(prev => new Set(prev).add(board.id));
    } finally {
      inFlight.current = false;
      setPendingBoardId(null);
    }
  }, [asset.id, roll, navigate, openRollModal]);

  // Reset when a different asset is previewed.
  useEffect(() => { setPicking(false); setDenied(new Set()); }, [asset.id]);

  const homeName = workspaceName(asset.workspace_id) ?? 'its own workspace';
  const ordered = useMemo(() => (boards ? orderMoodboardTargets(asset, boards) : null), [asset, boards]);

  return {
    picking,
    boards: ordered,
    loadError,
    pendingBoardId,
    open,
    close,
    load,
    add,
    description: asset.visibility === 'personal'
      ? `“${asset.filename}” is Personal, so it can only go on boards in ${homeName}.`
      : `Choose a board for “${asset.filename}”.`,
    boardNote: (board: Board) => workspaceName(board.workspace_id),
    disabledReason: (board: Board) =>
      denied.has(board.id) ? 'View only — you can’t add to this board'
      : moodboardBlocker(asset, board) ? `Not available — this asset is Personal to ${homeName}`
      : null,
  };
}

// The browser's own PDF viewer over a fetched copy: the stored object is
// an octet-stream download, so pointing an iframe at it would just
// download it. Only real PDFs (checked by their header) are shown.
function PdfPreview({ url, title, height, onFail }: { url: string; title: string; height: number; onFail: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const onFailRef = useRef(onFail);
  useEffect(() => { onFailRef.current = onFail; });

  useEffect(() => {
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if ((await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('Not a PDF');
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setSrc(objectUrl);
      } catch {
        if (!ctrl.signal.aborted) onFailRef.current();
      }
    })();
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!src) {
    return (
      <div role="status" aria-label="Loading PDF preview" style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2.5px solid var(--color-hairline)', borderTopColor: 'var(--color-ink-muted)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title={`Preview of ${title}`}
      width="100%"
      height={height}
      style={{ border: 'none', borderRadius: 'var(--radius-sm)', display: 'block', minHeight: height, background: 'var(--color-surface-2)' }}
    />
  );
}

// No inline preview: the library's own file-type tile, and why.
function FilePreviewFallback({ asset, failed }: { asset: Asset; failed: boolean }) {
  const ext = asset.extension ? `.${asset.extension.toUpperCase()}` : 'this file';
  return (
    <div style={{ width: '100%', height: '100%', minHeight: 240, display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AssetPreview asset={asset} />
      </div>
      <p className="type-caption" role={failed ? 'alert' : undefined} style={{ margin: 0, padding: '10px 12px', textAlign: 'center', background: 'var(--color-surface-2)' }}>
        {failed ? 'The preview couldn’t load — you can still download it.' : `No preview for ${ext} — download it to open.`}
      </p>
    </div>
  );
}

function AssetDetails({ asset, typeLabel }: { asset: Asset; typeLabel: string }) {
  const rows: Array<[string, string]> = [
    ['Type', typeLabel],
    ['Visibility', VISIBILITY_LABEL[asset.visibility]],
    ['Added', formatDate(asset.created_at)],
  ];
  if (asset.width && asset.height) rows.splice(1, 0, ['Dimensions', `${asset.width} × ${asset.height}`]);
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 16, rowGap: 8 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt className="type-caption" style={{ margin: 0 }}>{k}</dt>
          <dd className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
