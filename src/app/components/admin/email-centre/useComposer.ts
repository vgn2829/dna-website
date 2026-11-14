import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EcError, buildDraftPayload, emailApi, hasContent, newComposer, stateFromDraft,
  type ComposerState,
} from '../../../lib/emailCentre';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

const AUTOSAVE_MS = 1500;

/**
 * Composer state + debounced autosave.
 *
 * Autosave only ever creates/updates a DRAFT (PATCH /drafts/:id) — the server
 * refuses to touch a message once it has been sent — and the server skips the
 * write when nothing changed, so a quiet editor never hits the database.
 */
export function useComposer() {
  const [state, setStateRaw] = useState<ComposerState>(newComposer);
  const stateRef = useRef(state);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [contentKey, setContentKey] = useState(0); // bump to remount the editor with new content

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const paused = useRef(false);
  const failed = useRef(false);

  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) { await inflight.current; if (!dirty.current) return; }
    if (!dirty.current || paused.current) return;
    const run = (async () => {
      dirty.current = false;
      setStatus('saving');
      try {
        const s = stateRef.current;
        if (!hasContent(s) && !s.draftId) { setStatus('idle'); return; }
        if (!s.draftId) {
          const r = await emailApi.createDraft(buildDraftPayload(s));
          stateRef.current = { ...stateRef.current, draftId: r.id, revision: r.revision };
          setStateRaw(stateRef.current);
        } else {
          const r = await emailApi.saveDraft(s.draftId, s.revision, buildDraftPayload(s));
          stateRef.current = { ...stateRef.current, revision: r.revision };
          setStateRaw(stateRef.current);
        }
        setSavedAt(new Date()); setError('');
        setStatus(dirty.current ? 'unsaved' : 'saved');
      } catch (e) {
        if (e instanceof EcError && e.status === 409 && typeof e.body.revision === 'number') {
          // Another tab saved this draft — adopt its revision and save again (last write wins).
          stateRef.current = { ...stateRef.current, revision: e.body.revision as number };
          setStateRaw(stateRef.current);
          dirty.current = true;
        } else {
          // Keep the edits marked unsaved, but don't hammer the server: the next edit (or the
          // Save draft button) retries.
          dirty.current = true;
          failed.current = true;
          setError(e instanceof Error ? e.message : 'Could not save');
          setStatus('error');
        }
      }
    })();
    inflight.current = run;
    try { await run; } finally { inflight.current = null; }
    if (dirty.current && !failed.current && !paused.current) schedule();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, AUTOSAVE_MS);
  }, [save]);

  /** Edit the composer; marks it for autosave. */
  const setState = useCallback((fn: (s: ComposerState) => ComposerState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setStateRaw(next);
    if (paused.current) return;
    dirty.current = true;
    failed.current = false;
    setStatus('unsaved');
    schedule();
  }, [schedule]);

  /** Server-owned changes (attachment list, ids): update state without scheduling a save. */
  const setSilently = useCallback((fn: (s: ComposerState) => ComposerState) => {
    stateRef.current = fn(stateRef.current);
    setStateRaw(stateRef.current);
  }, []);

  /** Save right now (before sending / leaving). */
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    failed.current = false;
    await save();
  }, [save]);

  /** Make sure a draft row exists (attachments are stored against it). */
  const ensureDraft = useCallback(async (): Promise<string> => {
    if (stateRef.current.draftId) return stateRef.current.draftId;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    // An otherwise-empty composer still needs a row to attach files to.
    const r = await emailApi.createDraft(buildDraftPayload(stateRef.current));
    stateRef.current = { ...stateRef.current, draftId: r.id, revision: r.revision };
    setStateRaw(stateRef.current);
    dirty.current = false;
    setStatus('saved'); setSavedAt(new Date());
    return r.id;
  }, []);

  const reset = useCallback((next?: ComposerState) => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    stateRef.current = next ?? newComposer();
    setStateRaw(stateRef.current);
    setStatus('idle'); setError(''); setContentKey(k => k + 1);
  }, []);

  const loadDraft = useCallback(async (id: string) => {
    const d = await emailApi.getDraft(id);
    const s = stateFromDraft(d);
    if (s.groups.length) {
      try {
        const all = await emailApi.groups();
        s.groups = s.groups.map(g => ({ id: g.id, name: all.groups.find(x => x.id === g.id)?.name ?? g.id }));
      } catch { /* names are cosmetic */ }
    }
    reset(s);
    setStatus('saved'); setSavedAt(new Date(d.updatedAt));
  }, [reset]);

  const pause = useCallback((p: boolean) => { paused.current = p; if (p && timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); if (timer.current) clearTimeout(timer.current); };
  }, []);

  return { state, setState, setSilently, status, savedAt, error, flush, ensureDraft, reset, loadDraft, pause, contentKey };
}
