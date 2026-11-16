import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, FolderPlus } from 'lucide-react';
import { api, UploadError } from '../../lib/api';
import { newClientUploadId } from '../../lib/assetLibrary';
import { useStudent } from '../../context/StudentContext';
import {
  TOOL_ASSET_VISIBILITY, TOOL_OUTPUT_MESSAGE, checkToolOutput, pickTargetWorkspace, toolAssetFilename, type ToolId,
} from '../../lib/toolAssets';

// "Save to Assets" for a creative tool's result. The result is uploaded to the
// signed-in student's OWN personal workspace as a PRIVATE asset — the same
// POST /api/assets every other library upload uses, so ownership, workspace
// membership, size limits and file validation are all enforced by the server.
// Nothing here shares or publishes anything; that stays an explicit action in
// the Asset Library. No file URL is ever shown by this component.

type Phase = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  tool: ToolId;
  /** Source image name (without needing an extension) used to name the asset. */
  baseName: string;
  /** Produces the exact result to save. May return null when nothing is ready. */
  getBlob: () => Promise<Blob | null>;
  disabled?: boolean;
  className?: string;
}

export function SaveToAssetsButton({ tool, baseName, getBlob, disabled, className = 'btn-translucent is-grow' }: Props) {
  const { studentSession, openRollModal } = useStudent();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  // A retry of a FAILED save of the same result reuses its idempotency key, so
  // a save whose response was lost is never stored twice.
  const lastAttempt = useRef<{ id: string; size: number; type: string; failed: boolean } | null>(null);
  const busy = useRef(false);

  const save = useCallback(async () => {
    if (busy.current) return;
    if (!studentSession) { openRollModal(); return; }
    busy.current = true;
    setPhase('saving'); setMessage('');
    try {
      const blob = await getBlob();
      if (!blob) throw new Error(TOOL_OUTPUT_MESSAGE.empty);
      const problem = checkToolOutput(blob);
      if (problem) throw new Error(TOOL_OUTPUT_MESSAGE[problem]);

      const roll = studentSession.rollNumber;
      const workspaceId = pickTargetWorkspace(await api.workspaces.list(roll));
      if (!workspaceId) throw new Error('Your personal workspace could not be found. Open the Asset Library once, then try again.');

      const prior = lastAttempt.current;
      const reuse = prior && prior.failed && prior.size === blob.size && prior.type === blob.type;
      const attempt = reuse ? prior : { id: newClientUploadId(), size: blob.size, type: blob.type, failed: false };
      lastAttempt.current = attempt;

      const file = new File([blob], toolAssetFilename(baseName, tool, blob.type), { type: blob.type });
      try {
        await api.assets.upload(workspaceId, file, { visibility: TOOL_ASSET_VISIBILITY, clientUploadId: attempt.id });
      } catch (err) {
        attempt.failed = true;
        throw err;
      }
      lastAttempt.current = null;
      setPhase('saved');
      setMessage('Saved privately to your Asset Library.');
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof UploadError ? err.failure.message : err instanceof Error ? err.message : 'Could not save to the Asset Library.');
    } finally {
      busy.current = false;
    }
  }, [studentSession, openRollModal, getBlob, baseName, tool]);

  return (
    <div className="save-to-assets" style={{ display: 'contents' }}>
      <button type="button" className={className} onClick={save} disabled={disabled || phase === 'saving'}
        title="Save this result to your private Asset Library">
        {phase === 'saving'
          ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Saving…</>
          : <><FolderPlus size={16} aria-hidden="true" /> Save to Assets</>}
      </button>
      <p role="status" aria-live="polite" className="save-to-assets-status"
        style={{ flexBasis: '100%', margin: message ? '6px 0 0' : 0, fontSize: 12.5, color: phase === 'error' ? 'var(--color-danger, #c0392b)' : 'var(--color-ink-muted)' }}>
        {message}
        {phase === 'saved' && <> <Link to="/assets" style={{ textDecoration: 'underline' }}>Open Asset Library</Link></>}
      </p>
    </div>
  );
}
