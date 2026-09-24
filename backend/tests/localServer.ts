import http from 'http';
import type { AddressInfo } from 'net';
import type { RequestListener } from 'http';
import supertest from 'supertest';
import { beforeAll, afterAll } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────
// One loopback HTTP server per test file, for supertest.
//
// Why: supertest's request(app) starts a throwaway server per request with
// app.listen(0) — a WILDCARD (::) bind — and then connects to 127.0.0.1.
// macOS allows that wildcard bind even when another process (an Electron
// app, an IDE language server, …) already holds the same port on
// 127.0.0.1 specifically; the request then reaches THAT process and the
// test sees a foreign 404/400 or hangs until it times out. Proven during
// the V3.0 investigation; CI never saw it because its runners have no such
// listeners.
//
// Binding 127.0.0.1 explicitly makes the collision impossible: the OS will
// not hand out a port another process already holds on that address.
//
// The bind with an explicit host is asynchronous (Node resolves the host
// first), so the server is started in beforeAll and awaited until it is
// actually listening; supertest is then given the already-listening server
// and connects to 127.0.0.1:<its port> without starting or closing servers
// of its own. The server is closed in afterAll. Nothing is shared between
// test files — each file registers its own hooks.
//
// Usage (drop-in for `import request from 'supertest'`):
//   const app = createApp();
//   const request = localRequest(app);
//   ... request(app).get('/api/...')
// ─────────────────────────────────────────────────────────────────────────

export const LOOPBACK_HOST = '127.0.0.1';

export function localRequest(app: RequestListener): (target: RequestListener) => ReturnType<typeof supertest> {
  let server: http.Server | null = null;

  beforeAll(async () => {
    const s = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(0, LOOPBACK_HOST, () => {
        s.off('error', reject);
        resolve();
      });
    });
    const address = s.address() as AddressInfo | null;
    if (!address || address.address !== LOOPBACK_HOST) {
      s.close();
      throw new Error(`Test server must bind ${LOOPBACK_HOST}, got ${JSON.stringify(address)}`);
    }
    server = s;
  });

  afterAll(async () => {
    const s = server;
    server = null;
    if (!s) return;
    await new Promise<void>((resolve, reject) => {
      s.close(err => (err ? reject(err) : resolve()));
      // Keep-alive sockets from supertest's requests would otherwise hold
      // close() open until they time out.
      s.closeIdleConnections();
    });
  });

  return (target: RequestListener) => {
    if (target !== app) throw new Error('localRequest: request() was called with a different app than the one it serves');
    if (!server) throw new Error('localRequest: the test server is not listening (request() used outside a test)');
    return supertest(server);
  };
}
