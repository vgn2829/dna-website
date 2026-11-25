import { describe, it, expect, vi } from 'vitest';
import { WebSocketServer, WebSocket as WsClient, type WebSocket as WsServerSocket } from 'ws';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createTLSchema } from '@tldraw/tlschema';
import type { RoomSnapshot } from '@tldraw/sync-core';
import {
  bufferMessagesDuringInit,
  MAX_BUFFERED_MESSAGES,
  BUFFER_OVERFLOW_CLOSE_CODE,
} from '../src/realtime/connectionBuffer';
import { RoomManager } from '../src/realtime/rooms';
import type { RoomPersistence } from '../src/realtime/roomPersistence';
import { LOOPBACK_HOST } from './localServer';

// ─────────────────────────────────────────────────────────────────────────
// REGRESSION SUITE FOR THE REALTIME HANDSHAKE RACE (V2.5 Phase 0b).
//
// The race, reproduced identically on the V2.3 baseline and therefore
// pre-existing V1 infrastructure (see connectionBuffer.ts's header for the
// full mechanism): server.ts's wss.handleUpgrade makes the socket live
// immediately, connectionHandler.ts then awaits two Postgres round-trips
// (checkRoomAccess, then roomManager.join -> persistence.load) before
// anything installs a 'message' listener, and a `ws` socket with no
// 'message' listener silently DISCARDS incoming frames. A real tldraw
// client sends `connect` the instant the socket opens, so it lands in
// that window and disappears — measured at 0ms delay: no handshake; at
// 1500ms delay: normal handshake.
//
// Unlike tests/room-socket-gate.test.ts and tests/realtime-rooms.test.ts —
// which deliberately avoid hand-constructing a real tldraw wire message,
// since the gate only ever reads `type` and a fake payload is sufficient
// there — the decisive test in THIS file uses the REAL protocol end to
// end: a real `connect` carrying createTLSchema().serialize(), a real
// TLSocketRoom (via the real RoomManager and the real room socket gate),
// and a real `ws` socket pair over loopback TCP. That matters here
// specifically because the bug was never about message CONTENT; it was
// about listener TIMING on a real socket, and a fake socket that queues
// events would not have the defect at all. Reproducing it requires the
// real `ws` EventEmitter discard behavior.
//
// A genuine tldraw `connect` response proves the whole chain worked:
// frame buffered -> init completed -> replayed through the gate ->
// reassembled and validated by TLSocketRoom -> schema accepted (a
// malformed/empty schema yields `incompatibility_error` instead, which is
// how the original V2.4 diagnosis went wrong, so this assertion is
// deliberately strict about getting `connect` back).
// ─────────────────────────────────────────────────────────────────────────

class FakePersistence implements RoomPersistence {
  public snapshots = new Map<string, RoomSnapshot>();
  async load(roomId: string): Promise<RoomSnapshot | null> {
    return this.snapshots.get(roomId) ?? null;
  }
  async save(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    this.snapshots.set(roomId, snapshot);
  }
}

function realConnectMessage(): string {
  return JSON.stringify({
    type: 'connect',
    connectRequestId: 'req-race-1',
    lastServerClock: 0,
    protocolVersion: 6,
    schema: createTLSchema().serialize(),
  });
}

// Spins up a real HTTP server + WebSocketServer on an ephemeral port and
// hands the test a server-side `ws` socket plus a connected client, so the
// real EventEmitter frame-discard behavior is in play (see header).
interface Harness {
  clientSocket: WsClient;
  serverSocket: WsServerSocket;
  close: () => Promise<void>;
}

async function createSocketPair(
  onServerSocket: (ws: WsServerSocket) => void
): Promise<Harness> {
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  const serverSocketPromise = new Promise<WsServerSocket>((resolve) => {
    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Mirrors server.ts exactly: the socket is live HERE, and the
        // handler that follows may await before attaching listeners.
        onServerSocket(ws);
        resolve(ws);
      });
    });
  });

  // Explicit loopback bind (the client below connects to 127.0.0.1) — a
  // wildcard bind can share a port with another process's 127.0.0.1
  // listener on macOS; see tests/localServer.ts.
  await new Promise<void>((resolve) => httpServer.listen(0, LOOPBACK_HOST, resolve));
  const { port } = httpServer.address() as AddressInfo;

  const clientSocket = new WsClient(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    clientSocket.once('open', () => resolve());
    clientSocket.once('error', reject);
  });

  const serverSocket = await serverSocketPromise;

  return {
    clientSocket,
    serverSocket,
    close: async () => {
      try { clientSocket.close(); } catch { /* already closed */ }
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('realtime connection buffer — handshake race regression', () => {
  // ───────────────────────────────────────────────────────────────────
  // (1)-(7) THE DECISIVE TEST: the exact race, with the real protocol.
  // ───────────────────────────────────────────────────────────────────
  it('buffers a real tldraw connect sent at 0ms during a delayed init, replays it, and completes the handshake', async () => {
    const persistence = new FakePersistence();
    const roomManager = new RoomManager<{ roll: string; role: string }>(persistence);
    const roomId = 'room-race-1';

    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;

    // (1) socket becomes live; buffer installed synchronously, exactly as
    // createConnectionHandler does before its first await.
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    const responses: string[] = [];
    harness.clientSocket.on('message', (data) => responses.push(data.toString()));

    // (3) client sends a REAL connect immediately — this is the frame that
    // was silently dropped before the fix.
    harness.clientSocket.send(realConnectMessage());

    // (2) initialization is intentionally delayed, standing in for the two
    // Postgres round-trips (checkRoomAccess + persistence.load).
    await tick(250);

    // (4) the frame was buffered, not dropped.
    expect(buffer!.bufferedCount()).toBe(1);
    // ...and nothing has been delivered to any room yet.
    expect(roomManager.getActiveRoomCount()).toBe(0);

    // (5) initialization completes: real join, real gate, real TLSocketRoom.
    await roomManager.join(
      roomId, 'session-race-1', harness.serverSocket,
      { roll: '230437', role: 'owner' },
      true
    );

    // (6) buffered connect is replayed through the socket's own emitter.
    buffer!.replayAndDetach();

    // (7) normal handshake succeeds — a real TLSocketRoom connect response.
    await vi.waitFor(() => {
      expect(responses.length).toBeGreaterThan(0);
    }, { timeout: 4000 });

    const parsed = JSON.parse(responses[0]) as { type: string; connectRequestId?: string; protocolVersion?: number };
    expect(parsed.type).toBe('connect');
    expect(parsed.connectRequestId).toBe('req-race-1');
    expect(parsed.protocolVersion).toBe(6);

    await harness.close();
  }, 15000);

  // ───────────────────────────────────────────────────────────────────
  // (8) Ordering.
  // ───────────────────────────────────────────────────────────────────
  it('preserves exact arrival order of multiple messages received during initialization', async () => {
    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    const sent = ['first', 'second', 'third', 'fourth', 'fifth'];
    for (const msg of sent) harness.clientSocket.send(msg);

    await vi.waitFor(() => {
      expect(buffer!.bufferedCount()).toBe(sent.length);
    }, { timeout: 4000 });

    // Attach the "real" listener only now — as the room socket gate would
    // once init finished — then replay.
    const received: string[] = [];
    harness.serverSocket.on('message', (data) => received.push(data.toString()));
    buffer!.replayAndDetach();

    expect(received).toEqual(sent);

    await harness.close();
  }, 15000);

  // ───────────────────────────────────────────────────────────────────
  // (9) Authorization failure must not replay. THE SECURITY PROPERTY.
  // ───────────────────────────────────────────────────────────────────
  it('does not replay buffered messages when authorization fails', async () => {
    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    // An unauthorized client sends arbitrary frames — including a real,
    // well-formed connect and a push — during the init window.
    harness.clientSocket.send(realConnectMessage());
    harness.clientSocket.send(JSON.stringify({ type: 'push', clientClock: 1, diff: {} }));

    await vi.waitFor(() => {
      expect(buffer!.bufferedCount()).toBe(2);
    }, { timeout: 4000 });

    // Stand-in for the room socket gate's listener. If ANY buffered frame
    // reached it, authorization would have been bypassed.
    const reachedRoom: string[] = [];
    harness.serverSocket.on('message', (data) => reachedRoom.push(data.toString()));

    // Authorization fails -> discard, never replay (mirrors the
    // `if (!access.ok)` branch in connectionHandler.ts).
    buffer!.discard();
    await tick(100);

    expect(reachedRoom).toEqual([]);
    expect(buffer!.bufferedCount()).toBe(0);

    await harness.close();
  }, 15000);

  it('never reaches a real TLSocketRoom when authorization fails, even after a full init window', async () => {
    // The end-to-end version of the security property: a real room, a real
    // gate, a real push — and an authorization failure in between. If
    // buffering were an authorization shortcut, the push would land in the
    // document. It must not.
    const persistence = new FakePersistence();
    const roomManager = new RoomManager<{ roll: string; role: string }>(persistence);

    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    harness.clientSocket.send(realConnectMessage());
    harness.clientSocket.send(JSON.stringify({
      type: 'push', clientClock: 1,
      diff: { 'shape:unauthorized': ['put', { id: 'shape:unauthorized', typeName: 'shape' }] },
    }));
    await vi.waitFor(() => {
      expect(buffer!.bufferedCount()).toBe(2);
    }, { timeout: 4000 });

    // Authorization fails — connectionHandler.ts discards and closes, and
    // crucially never calls roomManager.join, so no room is ever created.
    buffer!.discard();
    await tick(200);

    expect(roomManager.getActiveRoomCount()).toBe(0);
    expect(roomManager.getCurrentSnapshot('room-unauthorized')).toBeNull();
    expect(buffer!.bufferedCount()).toBe(0);

    await harness.close();
  }, 15000);

  // ───────────────────────────────────────────────────────────────────
  // (10) Close during initialization.
  // ───────────────────────────────────────────────────────────────────
  it('cleans up safely and never replays when the socket closes during initialization', async () => {
    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    // `ws` installs internal listeners of its own at handleUpgrade time
    // (notably one 'close'), so "no dangling listeners" means "back to the
    // counts that existed before the buffer was installed", not zero.
    // Captured here rather than hardcoded so this stays correct across ws
    // upgrades. Note message === 0 at this point is itself the root cause
    // of the race this suite exists for.
    const baseline = { message: 0, close: 0, error: 0 };
    const harness = await createSocketPair((ws) => {
      baseline.message = ws.listenerCount('message');
      baseline.close = ws.listenerCount('close');
      baseline.error = ws.listenerCount('error');
      buffer = bufferMessagesDuringInit(ws);
    });
    expect(baseline.message).toBe(0);

    harness.clientSocket.send(realConnectMessage());
    await vi.waitFor(() => {
      expect(buffer!.bufferedCount()).toBe(1);
    }, { timeout: 4000 });

    // Client goes away mid-init.
    harness.clientSocket.close();
    await vi.waitFor(() => {
      expect(buffer!.isAborted()).toBe(true);
    }, { timeout: 4000 });

    // Buffer was emptied on close, and a late replay is a safe no-op.
    expect(buffer!.bufferedCount()).toBe(0);
    const received: string[] = [];
    harness.serverSocket.on('message', (data) => received.push(data.toString()));
    expect(() => buffer!.replayAndDetach()).not.toThrow();
    expect(received).toEqual([]);

    // No dangling listeners left behind by the buffer — every count is
    // back to its pre-install baseline (the +1 on 'message' is the test's
    // own listener attached just above).
    expect(harness.serverSocket.listenerCount('message')).toBe(baseline.message + 1);
    expect(harness.serverSocket.listenerCount('close')).toBe(baseline.close);
    expect(harness.serverSocket.listenerCount('error')).toBe(baseline.error);

    await harness.close();
  }, 15000);

  // ───────────────────────────────────────────────────────────────────
  // (11) Buffer limit enforcement.
  // ───────────────────────────────────────────────────────────────────
  it('enforces the message-count limit by closing the socket and dropping the buffer', async () => {
    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    const closeInfo: Array<{ code: number }> = [];
    harness.clientSocket.on('close', (code) => closeInfo.push({ code }));

    // One more than the cap.
    for (let i = 0; i < MAX_BUFFERED_MESSAGES + 1; i++) {
      harness.clientSocket.send(`flood-${i}`);
    }

    await vi.waitFor(() => {
      expect(buffer!.isAborted()).toBe(true);
    }, { timeout: 4000 });

    // Nothing retained, nothing replayable.
    expect(buffer!.bufferedCount()).toBe(0);
    const received: string[] = [];
    harness.serverSocket.on('message', (data) => received.push(data.toString()));
    buffer!.replayAndDetach();
    expect(received).toEqual([]);

    // Closed cleanly with the documented code; server still alive.
    await vi.waitFor(() => {
      expect(closeInfo.length).toBe(1);
    }, { timeout: 4000 });
    expect(closeInfo[0].code).toBe(BUFFER_OVERFLOW_CLOSE_CODE);

    await harness.close();
  }, 15000);

  it('enforces the aggregate byte limit independently of the message count', async () => {
    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    const closeInfo: Array<{ code: number }> = [];
    harness.clientSocket.on('close', (code) => closeInfo.push({ code }));

    // Well under MAX_BUFFERED_MESSAGES frames, but over MAX_BUFFERED_BYTES
    // in aggregate — proving the two caps are enforced independently and a
    // few very large frames cannot evade the count-based limit.
    const oneMiB = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 10; i++) harness.clientSocket.send(oneMiB);

    await vi.waitFor(() => {
      expect(buffer!.isAborted()).toBe(true);
    }, { timeout: 6000 });

    expect(buffer!.bufferedCount()).toBe(0);
    await vi.waitFor(() => {
      expect(closeInfo.length).toBe(1);
    }, { timeout: 4000 });
    expect(closeInfo[0].code).toBe(BUFFER_OVERFLOW_CLOSE_CODE);

    await harness.close();
  }, 20000);

  it('reports aborted after overflow so an in-flight initialization abandons the join', async () => {
    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    for (let i = 0; i < MAX_BUFFERED_MESSAGES + 1; i++) {
      harness.clientSocket.send(`flood-${i}`);
    }
    await vi.waitFor(() => {
      expect(buffer!.isAborted()).toBe(true);
    }, { timeout: 4000 });

    // This is the exact guard connectionHandler.ts applies after
    // checkRoomAccess resolves: an aborted buffer means do not join, so no
    // dangling room membership is created for a socket already closed.
    const persistence = new FakePersistence();
    const roomManager = new RoomManager<{ roll: string }>(persistence);
    if (!buffer!.isAborted()) {
      await roomManager.join('room-x', 's1', harness.serverSocket, { roll: '230437' }, true);
    }
    expect(roomManager.getActiveRoomCount()).toBe(0);

    await harness.close();
  }, 15000);

  // ───────────────────────────────────────────────────────────────────
  // (12) The buffer does not weaken the existing gate/authorization path.
  // ───────────────────────────────────────────────────────────────────
  it('replayed frames still pass through the room socket gate, so an unauthorized write is still dropped', async () => {
    const persistence = new FakePersistence();
    const roomManager = new RoomManager<{ roll: string; role: string }>(persistence);

    let buffer: ReturnType<typeof bufferMessagesDuringInit> | null = null;
    const harness = await createSocketPair((ws) => {
      buffer = bufferMessagesDuringInit(ws);
    });

    const responses: string[] = [];
    harness.clientSocket.on('message', (data) => responses.push(data.toString()));

    // A read-only session sends connect + push during init.
    harness.clientSocket.send(realConnectMessage());
    harness.clientSocket.send(JSON.stringify({
      type: 'push', clientClock: 1,
      diff: { 'shape:evil': ['put', { id: 'shape:evil', typeName: 'shape' }] },
    }));

    await vi.waitFor(() => {
      expect(buffer!.bufferedCount()).toBe(2);
    }, { timeout: 4000 });

    // Join with canWriteCanvas = false — the gate is installed read-only.
    await roomManager.join(
      'room-readonly', 'session-ro', harness.serverSocket,
      { roll: '240280', role: 'viewer' },
      false
    );
    buffer!.replayAndDetach();

    // The connect is honoured (reads are allowed)...
    await vi.waitFor(() => {
      expect(responses.length).toBeGreaterThan(0);
    }, { timeout: 4000 });
    expect(JSON.parse(responses[0]).type).toBe('connect');

    // ...but the replayed push was dropped by the gate, so it never
    // mutated the document. Replay is not an authorization bypass: it
    // re-enters the SAME gate every live frame goes through.
    await tick(300);
    const snapshot = roomManager.getCurrentSnapshot('room-readonly');
    const hasEvilShape = (snapshot?.documents ?? []).some(
      (d) => (d.state as { id?: string }).id === 'shape:evil'
    );
    expect(hasEvilShape).toBe(false);

    await harness.close();
  }, 15000);
});
