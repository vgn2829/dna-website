import { describe, it, expect, vi } from 'vitest';
import { createRoomSocketGate } from '../src/realtime/roomSocketGate';

// ─────────────────────────────────────────────────────────────────────────
// Unit tests for the gate ITSELF, in isolation from TLSocketRoom — same
// reasoning tests/realtime-rooms.test.ts's own comment gives for never
// hand-constructing a real tldraw `connect` wire message in a test
// (getTlsyncProtocolVersion/createTLSchema are excluded from the
// package's public types; depending on their exact shape from a test
// would mean depending on tldraw's private wire protocol). This suite
// avoids that entirely: it only ever sends literal `{"type":"push",...}`
// / `{"type":"connect",...}` / `{"type":"ping"}` strings, which ARE the
// public, exported TLPushRequest/TLConnectRequest/TLPingRequest shapes
// (see @tldraw/sync-core's protocol.ts) — the gate only reads `type`, so
// the rest of each payload here is deliberately minimal/fake, not a real
// diff — that's fine, since the gate never looks past `type`.
//
// What's being verified end-to-end (per the spec's explicit test list):
//   - a push from a write-incapable session is dropped BEFORE the
//     downstream listener (standing in for TLSocketRoom's own internal
//     'message' listener) ever sees it — proving it can't reach
//     room.handleMessage, and therefore can't mutate/broadcast/persist/
//     affect version history, all of which only happen downstream of
//     that call.
//   - a push from a write-capable session is forwarded completely
//     unchanged (same event object) — proving the gate is a pure pass-
//     through for allowed writes, not a rewriting proxy.
//   - connect/ping always forward regardless of role.
//   - a chunked message (tldraw's own chunk() wire format) is still
//     correctly classified once fully reassembled, for both the allowed
//     and denied cases — proving the gate doesn't accidentally let a
//     chunked push slip through unclassified, and doesn't break a large
//     legitimate connect message (which IS chunked in practice, since it
//     carries the full schema).
//   - canWriteCanvas() is re-evaluated per message, not cached — proving
//     a live permission downgrade takes effect on the very next message
//     without needing to reconnect.
// ─────────────────────────────────────────────────────────────────────────

// Minimal WebSocketMinimal-ish fake — only what createRoomSocketGate
// actually calls on the real socket (addEventListener/removeEventListener
// for 'message'/'close'/'error', send, close, readyState/OPEN).
class FakeRealSocket {
  readyState = 1; // OPEN
  OPEN = 1;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emitMessage(data: string): void {
    this.listeners.get('message')?.forEach(l => l({ data }));
  }
  emitBinaryMessage(data: ArrayBuffer): void {
    this.listeners.get('message')?.forEach(l => l({ data }));
  }
  emit(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach(l => l(event));
  }
}

function pushMessage(clientClock = 1): string {
  return JSON.stringify({ type: 'push', clientClock, diff: { 'shape:fake': ['put', { id: 'shape:fake' }] } });
}

function connectMessage(): string {
  return JSON.stringify({ type: 'connect', connectRequestId: 'req-1', lastServerClock: 0, protocolVersion: 6, schema: {} });
}

function pingMessage(): string {
  return JSON.stringify({ type: 'ping' });
}

describe('createRoomSocketGate', () => {
  it('drops a push from a write-incapable session — the downstream listener never sees it', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];
    let canWrite = false;

    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => canWrite });
    gate.addEventListener!('message', (event) => received.push(event));

    real.emitMessage(pushMessage());

    expect(received).toHaveLength(0);
  });

  it('forwards a push unchanged from a write-capable session', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];

    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => true });
    gate.addEventListener!('message', (event) => received.push(event));

    const msg = pushMessage();
    real.emitMessage(msg);

    expect(received).toHaveLength(1);
    expect((received[0] as { data: string }).data).toBe(msg);
  });

  it('always forwards connect and ping, regardless of write capability', () => {
    const real = new FakeRealSocket();
    const received: string[] = [];

    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => false });
    gate.addEventListener!('message', (event) => received.push((event as { data: string }).data));

    real.emitMessage(connectMessage());
    real.emitMessage(pingMessage());

    expect(received).toHaveLength(2);
  });

  it('re-evaluates canWriteCanvas per message — a live downgrade applies to the very next push, no reconnect needed', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];
    let canWrite = true;

    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => canWrite });
    gate.addEventListener!('message', (event) => received.push(event));

    real.emitMessage(pushMessage(1));
    expect(received).toHaveLength(1); // allowed while canWrite was true

    canWrite = false; // simulates RoomManager.updateSessionWriteAccess
    real.emitMessage(pushMessage(2));
    expect(received).toHaveLength(1); // still 1 — the second push was dropped

    canWrite = true; // simulates access being restored
    real.emitMessage(pushMessage(3));
    expect(received).toHaveLength(2); // forwarded again
  });

  it('calls onWriteRejected exactly once per socket, not once per dropped message', () => {
    const real = new FakeRealSocket();
    const onWriteRejected = vi.fn();
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => false, onWriteRejected });
    gate.addEventListener!('message', () => {});

    real.emitMessage(pushMessage(1));
    real.emitMessage(pushMessage(2));
    real.emitMessage(pushMessage(3));

    expect(onWriteRejected).toHaveBeenCalledTimes(1);
  });

  it('never sends anything back over the real socket in response to a dropped push', () => {
    // Regression coverage for a real design flaw caught and fixed during
    // this commit's own review: an earlier version of this gate sent a
    // custom `{ type: 'permission_denied_notice', ... }` message back
    // over this exact socket. @tldraw/sync-core's TLSyncClient throws
    // (exhaustiveSwitchError) on any message type it doesn't recognize —
    // verified directly against its source — so that would have crashed
    // the client's message-handling loop instead of being safely ignored.
    // The gate must stay completely silent on the wire.
    const real = new FakeRealSocket();
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => false });
    gate.addEventListener!('message', () => {});

    real.emitMessage(pushMessage());

    expect(real.sent).toHaveLength(0);
  });

  it('correctly classifies a chunked push once fully reassembled, and drops it for a write-incapable session', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => false });
    gate.addEventListener!('message', (event) => received.push(event));

    // Mirrors @tldraw/sync-core's own exported chunk() format: each
    // fragment is "<remainingChunksAfterThisOne>_<payload>", first chunk
    // sent last (chunk() builds the array via unshift). Splitting the
    // literal push JSON into three fragments here.
    const full = pushMessage();
    const third = Math.ceil(full.length / 3);
    const part0 = full.slice(0, third);
    const part1 = full.slice(third, third * 2);
    const part2 = full.slice(third * 2);

    real.emitMessage(`2_${part0}`);
    real.emitMessage(`1_${part1}`);
    real.emitMessage(`0_${part2}`);

    expect(received).toHaveLength(0);
  });

  it('correctly classifies and forwards a chunked push for a write-capable session', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => true });
    gate.addEventListener!('message', (event) => received.push(event));

    const full = pushMessage();
    const third = Math.ceil(full.length / 3);
    real.emitMessage(`2_${full.slice(0, third)}`);
    real.emitMessage(`1_${full.slice(third, third * 2)}`);
    real.emitMessage(`0_${full.slice(third * 2)}`);

    expect(received).toHaveLength(3); // each fragment is forwarded individually, unmodified
  });

  it('forwards a chunked connect message regardless of write capability (a large connect must still work for a read-only session)', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => false });
    gate.addEventListener!('message', (event) => received.push(event));

    const full = connectMessage();
    const half = Math.ceil(full.length / 2);
    real.emitMessage(`1_${full.slice(0, half)}`);
    real.emitMessage(`0_${full.slice(half)}`);

    expect(received).toHaveLength(2);
  });

  it('forwards binary frames unchanged, regardless of write capability (not part of the client wire protocol)', () => {
    const real = new FakeRealSocket();
    const received: unknown[] = [];
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => false });
    gate.addEventListener!('message', (event) => received.push(event));

    real.emitBinaryMessage(new ArrayBuffer(4));

    expect(received).toHaveLength(1);
  });

  it('close/error listeners pass straight through to the real socket, untouched by the gate', () => {
    const real = new FakeRealSocket();
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => true });

    const closeListener = vi.fn();
    gate.addEventListener!('close', closeListener);
    real.emit('close', {});

    expect(closeListener).toHaveBeenCalledTimes(1);
  });

  it('send/close/readyState proxy directly to the real socket', () => {
    const real = new FakeRealSocket();
    const gate = createRoomSocketGate(real as any, { canWriteCanvas: () => true });

    gate.send('hello');
    expect(real.sent).toEqual(['hello']);

    expect(gate.readyState).toBe(1);
    gate.close();
    expect(real.readyState).toBe(3);
    expect(gate.readyState).toBe(3);
  });
});
