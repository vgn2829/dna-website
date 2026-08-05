import type { WebSocket } from 'ws';
import type { WebSocketMinimal } from '@tldraw/sync-core';

// ─────────────────────────────────────────────────────────────────────────
// ROOM SOCKET GATE (Commit 7) — the ONLY file in this codebase that knows
// anything about @tldraw/sync-core's client→server wire framing. Read this
// before touching it; read it again before touching anything ELSE in
// realtime/ that might tempt you to duplicate what's here.
//
// WHY THIS EXISTS (see roomAccess.ts's "COMMIT 7" comment for the product-
// level context — this is the mechanism):
//
// @tldraw/sync-core 2.4.4's TLSocketRoom has no built-in way to reject a
// write from a specific session. Verified directly against its source
// (not assumed):
//   - TLSocketRoom.handleSocketConnect() installs its OWN 'message'
//     listener on whatever socket it's given, and that listener always
//     ends by calling `this.room.handleMessage(sessionId, data)` — the
//     one call that actually mutates the document — UNCONDITIONALLY.
//   - opts.onAfterReceiveMessage (the only per-message hook the
//     constructor accepts) fires with the fully-parsed message, but its
//     return value is discarded and nothing checks whether it threw
//     before proceeding to call room.handleMessage() anyway. It cannot
//     block a write; it can only observe one after the fact.
//   - There is no exported "readonly session" or "permission" concept
//     anywhere in the package.
//
// The one thing TLSocketRoom DOES accept, and was explicitly designed by
// tldraw to accept, is an arbitrary WebSocketMinimal — a small, `@public`,
// purely structural interface (addEventListener?, removeEventListener?,
// send, close, readyState) documented as "compatible with the standard
// WebSocket interface... the 'ws' interface... Bun.serve" — i.e. built
// for wrapping whatever transport you hand it. That's the real, sanctioned
// extension point, and it's what this file implements: a thin proxy
// sitting between the real `ws` socket and TLSocketRoom, which decides
// PER SESSION (via canWriteCanvas, evaluated once at connect time) which
// incoming messages TLSocketRoom is even allowed to see.
//
// WHAT THIS FILE DOES NOT DO, on purpose:
//   - It does NOT parse a push message's diff, presence patch, or any
//     document content. It reads exactly one thing: the top-level
//     `"type"` field of a fully-formed JSON message, using the same
//     trivial detection @tldraw/sync-core's own JsonChunkAssembler uses
//     internally (a message either starts with `{` — a complete,
//     unchunked JSON object — or it's a `<digits>_<payload>` chunk
//     fragment; see @tldraw/sync-core's exported `chunk()` encoder, which
//     produces exactly this format — this file only ever reads that
//     format, it does not reimplement chunk REASSEMBLY, multi-chunk
//     buffering, or anything semantic about what's inside a push).
//   - It does NOT reject chunked messages by inspecting their content —
//     it can't (a mid-stream chunk fragment has no `type` field to read).
//     Instead, in case a write-incapable session's message arrives as a
//     chunk fragment, the fragments are provisionally buffered here (see
//     ChunkClassifier below) using the same chunk-count bookkeeping
//     `chunk()`'s own format implies (a leading `<remaining>_` prefix per
//     fragment), solely to recover the `type` field once all fragments
//     have arrived, before forwarding each ORIGINAL, UNMODIFIED fragment
//     (never a re-encoded version) on to TLSocketRoom's own listener.
//     This still never touches document semantics; it is bookkeeping
//     equivalent to what JsonChunkAssembler already does, applied here
//     only for classification, not consumed as the actual message
//     content TLSocketRoom operates on — TLSocketRoom still does its own,
//     completely independent reassembly of the same fragments.
//   - It does NOT retry, rewrite, or "fix" a rejected message. A dropped
//     push is simply never forwarded — and, importantly, this gate never
//     sends anything back over the document-sync socket in response.
//     Verified directly against @tldraw/sync-core's TLSyncClient source:
//     its handleServerEvent switches on the parsed message's `type` and
//     calls exhaustiveSwitchError() (which THROWS) in its default case —
//     any message with a `type` the client doesn't already recognize
//     would crash the client's own message-handling loop, not be safely
//     ignored. There is no safe way to piggyback a custom notice on this
//     particular socket. The client instead learns about a denial two
//     ways: (1) primarily, the REST pre-check in routes/realtime.ts,
//     called before the socket is even opened; (2) for a permission
//     REVOKED mid-session, TldrawCanvasSync.tsx polls that same REST
//     endpoint on an interval while connected — see that file's own
//     comment on why polling, not an in-band push, is the safe choice
//     here.
//
// FUTURE REMOVAL: if a future @tldraw/sync-core version adds a real
// server-side permission hook (a return value on onAfterReceiveMessage
// that can cancel the pending room.handleMessage call, or a documented
// "readonly session" flag), this file's classify/gate logic becomes
// unnecessary — RoomManager.join() would pass the raw socket straight
// through again and this file would be deleted. Nothing outside this file
// depends on ITS internals (only on the small wrap() function below), so
// that removal is a one-file change.
// ─────────────────────────────────────────────────────────────────────────

// The only two message types this file ever needs to distinguish. Every
// other client→server type (`ping`) is harmless to forward regardless of
// role — it never touches the document. Mirrors TLSocketClientSentEvent's
// own `type` field (public, exported from @tldraw/sync-core) — this is
// not an invented classification, it's reading the real field name.
type ClassifiedType = 'push' | 'other';

function classifyCompleteMessage(json: string): ClassifiedType {
  // Cheap substring check before a full JSON.parse — a push is by far the
  // highest-frequency message type in normal use (every shape drag/edit),
  // so this avoids parsing the (potentially large) diff payload just to
  // read one field on the hot path. Falls through to a real parse only to
  // confirm, never trusting the substring check alone for the actual
  // gate decision (a `"type":"push"` substring appearing inside, say, a
  // connect message's schema blob is not realistically possible given
  // the schema's own shape, but the code does not rely on that
  // assumption — see the parse fallback below).
  if (!json.includes('"push"')) return 'other';
  try {
    const parsed = JSON.parse(json) as { type?: unknown };
    return parsed.type === 'push' ? 'push' : 'other';
  } catch {
    // Malformed JSON — not this file's problem to diagnose; forward it
    // unchanged and let TLSocketRoom's own error handling (which already
    // sends a typed `type: 'error'` event and closes the socket on a
    // parse failure) do what it already does today. Gating is a strict
    // narrowing of what gets through, never a stricter validator than
    // TLSocketRoom's own.
    return 'other';
  }
}

// Reassembles ONLY enough to classify a chunked message's type, using the
// exact fragment format @tldraw/sync-core's exported chunk() function
// produces (`"<remainingChunks>_<payload>"`, first chunk seen last since
// chunk() unshifts). This exists purely because a single chunk fragment
// has no readable `type` field on its own — a write-incapable session's
// message might legitimately be a large `connect` (which carries the
// full schema) rather than a `push`, and both must still work. Buffers
// per-session; cleared on completion or on a malformed sequence (mirrors
// JsonChunkAssembler's own reset-to-idle behavior on error, but this
// class does not implement retry/redelivery — a malformed chunk sequence
// here is treated as 'other' and forwarded as-is, exactly like the parse
// fallback above, since TLSocketRoom's own assembler will independently
// re-derive the same malformed-sequence error when it processes the
// unmodified fragments itself).
class ChunkClassifier {
  private chunksReceived: string[] = [];
  private totalChunks = 0;

  // Returns the classified type once a complete message has been seen
  // (single-frame OR the final chunk of a multi-frame message), or null
  // if more chunks are still expected.
  observe(raw: string): ClassifiedType | null {
    if (raw.startsWith('{')) {
      this.reset();
      return classifyCompleteMessage(raw);
    }

    const match = /^(\d+)_(.*)$/.exec(raw);
    if (!match) {
      this.reset();
      return 'other';
    }
    const remaining = Number(match[1]);
    const payload = match[2];

    if (this.chunksReceived.length === 0) {
      this.totalChunks = remaining + 1;
    }
    this.chunksReceived.push(payload);

    if (remaining !== this.totalChunks - this.chunksReceived.length) {
      // Out-of-order/malformed sequence — same detection JsonChunkAssembler
      // itself uses. Forward as 'other' (see class-level comment) and let
      // TLSocketRoom's own assembler independently reject it.
      this.reset();
      return 'other';
    }

    if (this.chunksReceived.length === this.totalChunks) {
      const joined = this.chunksReceived.join('');
      this.reset();
      try {
        return classifyCompleteMessage(joined);
      } catch {
        return 'other';
      }
    }

    return null;
  }

  private reset(): void {
    this.chunksReceived = [];
    this.totalChunks = 0;
  }
}

export interface RoomSocketGateOptions {
  // Evaluated once per forwarded message (not cached at construction) so
  // a live role downgrade (see RoomManager's periodic re-validation) takes
  // effect on the very next message, without needing to reconstruct the
  // gate or the underlying TLSocketRoom session.
  canWriteCanvas: () => boolean;
  // Called once, the first time a push is actually dropped for this
  // socket — not on every dropped message — so a client that keeps
  // trying (or one with a stuck retry loop) doesn't get spammed. The
  // caller (RoomManager) uses this to log/count, not to close the
  // socket — closing is a policy decision left to the caller, this
  // module's only job is the gate itself.
  onWriteRejected?: () => void;
}

// Wraps a real `ws` WebSocket in a WebSocketMinimal-compatible proxy that
// TLSocketRoom.handleSocketConnect can be handed directly in place of the
// real socket. See this file's own header comment for the full mechanism.
export function createRoomSocketGate(realSocket: WebSocket, opts: RoomSocketGateOptions): WebSocketMinimal {
  const classifier = new ChunkClassifier();
  let hasNotifiedRejection = false;

  // A chunked message's intermediate fragments (classification === null,
  // "still waiting on more chunks") must NOT be forwarded to TLSocketRoom
  // as they arrive — TLSocketRoom does its own, completely independent
  // chunk reassembly on whatever raw frames it sees, so forwarding
  // fragment 1 and 2 of a 3-fragment push immediately (before this gate
  // even knows the complete message is a push) would let TLSocketRoom
  // reassemble and apply the write from ITS OWN copy of those fragments
  // regardless of what this gate decides once fragment 3 arrives — the
  // gate would be "too late" by design. This buffer holds every raw
  // fragment of the message currently being classified; once
  // classifier.observe() returns a real answer (not null), the whole
  // buffered sequence is either flushed (forwarded in original order,
  // unmodified) or dropped as a single unit. This was caught by this
  // commit's own test suite (room-socket-gate.test.ts) failing on first
  // write, not assumed correct — see that test file's own comment on the
  // specific scenario that exposed it.
  let pendingFragments: unknown[] = [];

  const messageListeners = new Set<(event: { data: unknown }) => void>();

  const flush = (events: unknown[]): void => {
    for (const event of events) {
      for (const listener of messageListeners) listener(event as { data: unknown });
    }
  };

  realSocket.addEventListener('message', (event) => {
    const raw = event.data;
    const asString = typeof raw === 'string' ? raw : null;

    if (asString === null) {
      // Binary frames are not part of @tldraw/sync-core's client wire
      // protocol at all (see JsonChunkAssembler.handleMessage, which
      // always TextDecoder.decode()s non-string input before treating it
      // as JSON/chunk text) — forward unchanged and let TLSocketRoom's
      // own handling apply exactly as it would with no gate present.
      flush([event]);
      return;
    }

    pendingFragments.push(event);
    const classification = classifier.observe(asString);

    if (classification === null) {
      // Still waiting on more chunks of this same message — held in
      // pendingFragments, not forwarded yet (see this function's own
      // comment above on why).
      return;
    }

    const fragments = pendingFragments;
    pendingFragments = [];

    if (classification === 'push' && !opts.canWriteCanvas()) {
      if (!hasNotifiedRejection) {
        hasNotifiedRejection = true;
        opts.onWriteRejected?.();
      }
      // Every buffered fragment of this message is dropped as a unit —
      // TLSocketRoom's own 'message' listener never runs for any of them,
      // so room.handleMessage() is never called for this push, so it can
      // never mutate `this.room`, never broadcast, never persist, and
      // never fire onDataChange (so it can't affect version history
      // either). Deliberately silent on the wire — see this file's own
      // header comment on why nothing is sent back over this particular
      // socket in response.
      return;
    }

    flush(fragments);
  });

  const proxy: WebSocketMinimal = {
    addEventListener: (type, listener) => {
      if (type === 'message') {
        messageListeners.add(listener as (event: { data: unknown }) => void);
        return;
      }
      // close/error pass straight through — this gate has no opinion
      // about connection lifecycle, only about message content.
      realSocket.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') {
        messageListeners.delete(listener as (event: { data: unknown }) => void);
        return;
      }
      realSocket.removeEventListener(type, listener);
    },
    send: (data: string) => realSocket.send(data),
    close: () => realSocket.close(),
    get readyState() {
      return realSocket.readyState;
    },
  };

  return proxy;
}
