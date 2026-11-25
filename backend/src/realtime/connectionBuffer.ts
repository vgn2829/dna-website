import type { RawData, WebSocket } from 'ws';

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION BUFFER (V2.5 Phase 0b) — closes a real, pre-existing race in
// the realtime handshake. Read this before touching connectionHandler.ts's
// ordering, and read it again before "simplifying" the replay below.
//
// THE RACE (reproduced on both the V2.5 branch and the V2.3 baseline, so
// it predates every V2 phase — this is V1 infrastructure):
//
//   server.ts calls wss.handleUpgrade(...), and the socket is LIVE the
//   instant that callback runs. connectionHandler.ts then performs two
//   awaited round-trips to Postgres before anything installs a 'message'
//   listener:
//     1. checkRoomAccess(roomId, token)
//     2. roomManager.join(...) -> getOrCreateRoom -> persistence.load(...)
//   Only after BOTH does RoomManager construct the room socket gate, and
//   only the gate's construction installs a 'message' listener (see
//   roomSocketGate.ts, which does realSocket.addEventListener('message')).
//
//   A `ws` socket with no 'message' listener does not queue, buffer, or
//   error on incoming frames — EventEmitter simply discards them. And
//   @tldraw/sync's client sends its `connect` message immediately on
//   socket `open`, so it lands squarely inside that window and vanishes.
//   The client then waits forever for a `connect` response that will
//   never come.
//
//   Measured, same board/room/handshake, only the send delay varied:
//     0ms    -> no response, connect silently dropped
//     1500ms -> normal handshake
//
//   It is a RACE, not a guaranteed failure: with a warm pool and a small
//   canvas_data payload both queries can land inside the same tick the
//   client's connect is still in flight, which is why it survived manual
//   production verification for so long.
//
// THE FIX — buffer, then replay through the SAME path:
//
//   Attach a temporary 'message' listener the moment the socket is live,
//   before any await. It does nothing but record raw frames in arrival
//   order. Once (and only once) authorization has succeeded AND the room
//   has been joined AND the real gate is installed, detach the temporary
//   listener and re-emit each buffered frame.
//
//   Replay deliberately uses `ws.emit('message', data, isBinary)` — the
//   exact emitter call `ws` itself makes internally when a frame arrives
//   (verified against node_modules/ws/lib/event-target.js: its
//   addEventListener('message', h) wrapper is `onMessage(data, isBinary)`,
//   which builds the MessageEvent and calls the handler). Re-emitting the
//   untouched (data, isBinary) pair therefore reconstructs a byte-identical
//   MessageEvent for every listener installed by then — the gate's, and
//   through it TLSocketRoom's. That is why this file contains NO protocol
//   parsing, NO chunk handling, NO JSON, and no second copy of anything in
//   roomSocketGate.ts: a replayed frame is indistinguishable from one that
//   arrived a few milliseconds later, and it takes exactly the same route
//   (gate -> classification -> write check -> TLSocketRoom).
//
// WHAT BUFFERING IS NOT:
//
//   Buffering is NOT authorization. A frame sitting in this buffer has had
//   nothing done to it — not read, not parsed, not classified, not
//   forwarded. If authorization fails, if room load/join fails, or if the
//   socket closes mid-initialization, `discard()` drops the buffer on the
//   floor and nothing is ever replayed. An unauthorized client can fill
//   this buffer to its limit and still have precisely zero of its frames
//   reach TLSocketRoom. See connectionHandler.ts, where every failure path
//   calls discard() before returning, and tests/realtime-connection-buffer
//   .test.ts, which asserts exactly this.
// ─────────────────────────────────────────────────────────────────────────

// Conservative caps on what a not-yet-authorized client can make the
// server hold. The initialization window is two DB queries — realistically
// single-digit milliseconds, during which a well-behaved tldraw client
// sends exactly ONE frame (`connect`), or a small handful of chunk
// fragments if its schema blob is large enough for @tldraw/sync-core's
// chunk() to split it. 64 frames / 8 MiB is therefore orders of magnitude
// above any legitimate need, while still being a hard bound: the point is
// that an abusive client cannot grow this without limit, not that the
// limit is tight enough to ever be felt by a real one.
//
// 8 MiB matches the practical ceiling a single legitimate `connect`
// carrying a full serialized schema could occupy across its fragments,
// with generous headroom.
export const MAX_BUFFERED_MESSAGES = 64;
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

// 1009 = "Message Too Big" in the RFC 6455 close-code registry, which is
// the closest standard code for "you sent more than we will hold for you".
// Reusing a standard code rather than inventing one in the 4000+ range
// keeps this consistent with the rest of realtime/, where every close
// already uses either a standard code or checkRoomAccess's own
// deliberately-chosen ones (see roomAccess.ts).
export const BUFFER_OVERFLOW_CLOSE_CODE = 1009;
export const BUFFER_OVERFLOW_CLOSE_REASON = 'Too many messages before initialization';

interface BufferedFrame {
  data: RawData;
  isBinary: boolean;
}

export interface ConnectionBuffer {
  // Detaches the temporary listener and re-emits every buffered frame, in
  // arrival order, through the socket's own emitter — so they reach
  // whatever listeners exist by now (the gate, and through it
  // TLSocketRoom). Call ONLY after authorization succeeded and the room
  // socket gate is installed.
  replayAndDetach: () => void;
  // Detaches the temporary listener and throws the buffer away without
  // replaying anything. Every failure path must call this.
  discard: () => void;
  // True once the socket closed or overflowed — the caller uses this to
  // abandon an initialization whose socket is already gone, rather than
  // joining a room for a dead connection.
  isAborted: () => boolean;
  // Test/diagnostic accessor; not read in production code.
  bufferedCount: () => number;
}

// Byte size of one raw frame, for the aggregate cap. `ws` hands us a
// Buffer, an ArrayBuffer, or an array of Buffers (RawData) depending on
// how the frame arrived; this measures all three without copying or
// decoding any of them.
function frameByteLength(data: RawData): number {
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.length, 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  return 0;
}

// Installs the temporary listener. MUST be called synchronously, before
// the first await in the connection setup path — that is the entire point
// (see this file's header comment).
export function bufferMessagesDuringInit(ws: WebSocket): ConnectionBuffer {
  let frames: BufferedFrame[] = [];
  let bufferedBytes = 0;
  let aborted = false;
  let detached = false;

  const onMessage = (data: RawData, isBinary: boolean): void => {
    if (aborted) return;

    const size = frameByteLength(data);
    if (frames.length + 1 > MAX_BUFFERED_MESSAGES || bufferedBytes + size > MAX_BUFFERED_BYTES) {
      // Over the cap before initialization finished. Drop everything
      // buffered (it is NOT replayed — see header) and close cleanly.
      // Marking aborted first means an in-flight initialization that
      // completes a moment later sees isAborted() and abandons the join
      // rather than adding a session for a socket we just closed.
      aborted = true;
      frames = [];
      bufferedBytes = 0;
      detach();
      try {
        ws.close(BUFFER_OVERFLOW_CLOSE_CODE, BUFFER_OVERFLOW_CLOSE_REASON);
      } catch {
        // Already closing/closed — nothing further to do.
      }
      return;
    }

    frames.push({ data, isBinary });
    bufferedBytes += size;
  };

  // If the client goes away mid-initialization there is nothing to replay
  // to, and the awaited work still in flight must not go on to join a room
  // for a dead socket.
  const onClose = (): void => {
    aborted = true;
    frames = [];
    bufferedBytes = 0;
    detach();
  };

  function detach(): void {
    if (detached) return;
    detached = true;
    ws.off('message', onMessage);
    ws.off('close', onClose);
    ws.off('error', onClose);
  }

  // `on`, not addEventListener: this listens to the raw emitter event so
  // the (data, isBinary) pair can be captured and later re-emitted
  // verbatim. addEventListener would hand us an already-constructed
  // MessageEvent with the payload stringified, which could not be
  // re-emitted without reconstructing it — exactly the kind of
  // re-implementation this file exists to avoid.
  ws.on('message', onMessage);
  ws.on('close', onClose);
  ws.on('error', onClose);

  return {
    replayAndDetach(): void {
      detach();
      if (aborted) {
        // Socket died or overflowed during init — never replay.
        frames = [];
        bufferedBytes = 0;
        return;
      }
      const pending = frames;
      frames = [];
      bufferedBytes = 0;
      for (const frame of pending) {
        // Same emitter call `ws` makes for a live frame, so every listener
        // installed by now (the gate's, hence TLSocketRoom's) receives an
        // identical MessageEvent. Order is preserved by construction.
        ws.emit('message', frame.data, frame.isBinary);
      }
    },
    discard(): void {
      detach();
      frames = [];
      bufferedBytes = 0;
    },
    isAborted(): boolean {
      return aborted;
    },
    bufferedCount(): number {
      return frames.length;
    },
  };
}
