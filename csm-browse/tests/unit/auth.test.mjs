import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { connect as netConnect, createServer as netServer } from 'node:net';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

// csm-browse modules read CSM_BROWSE_SESSIONS_ROOT at import time, so they
// are loaded dynamically AFTER the fresh root is pinned (same pattern as the
// other unit tests).
const root = await freshSessionsRoot('csm-browse-auth-');
const { spawnGate } = await import('../../lib/docker.mjs');
const { setExecLayerForTests } = await import('./helpers/exec-layer.mjs');
const { generateToken, rotateToken, revokeToken, withToken, cdpEndpoint } = await import('../../lib/session.mjs');
const { checkRequestLine, createGate } = await import('../../scripts/cdp-gate.mjs');
const WebSocket = (await import('ws')).default; // ws v7 CJS: module.exports is the WebSocket class
const { startFakeCdp } = await import('./helpers/fake-cdp-server.mjs');

after(async () => {
  setExecLayerForTests();
  await removeRoot(root);
});

// ── helpers ────────────────────────────────────────────────────────────

// A raw TCP backend the gate can tunnel into (no Docker): the gate's
// default openTunnel is stubbed to `execLayer.spawnExecTunnel`, which the
// tests replace with a connected duplex socket dressed as a spawn() child.
function startRawBackend() {
  const sockets = [];
  const server = netServer((sock) => {
    sockets.push(sock);
    // Consume data so the socket is in flowing mode and 'end' (FIN from the
    // gate's tunnel) is delivered — a paused socket may never emit 'end'.
    sock.on('data', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      sockets,
      close() {
        return new Promise((r) => {
          for (const s of sockets) { try { s.destroy(); } catch {} }
          server.close(() => r());
        });
      },
    }));
  });
}

// Sync child-like tunnel: a connected socket with stdin/stdout aliases and
// the events the gate listens for, mirroring `docker exec -i ... socat -`.
function tunnelTo(port, tunnels) {
  const sock = netConnect(port, '127.0.0.1');
  tunnels.push(sock);
  return {
    stdin: sock,
    stdout: sock,
    stderr: null,
    pid: 4242,
    kill: () => sock.destroy(),
    on: (...a) => sock.on(...a),
    once: (...a) => sock.once(...a),
  };
}

function startGate(token, backendPort, tunnels = [], port = 0) {
  return createGate({
    port,
    internalPort: 9224,
    containerName: 'chromium-vnc',
    token,
    openTunnel: () => tunnelTo(backendPort, tunnels),
  });
}

// Minimal HTTP client over a raw socket: send a request, collect the
// response until the status line arrives (deny responses and relayed
// discovery), then close. Waiting for FIN would hang on keep-alive backends.
function httpRequest(port, request) {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, '127.0.0.1');
    let data = '';
    let responded = false;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('httpRequest timed out')); }, 5000);
    const finish = (err) => {
      if (responded) return;
      responded = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(data);
    };
    sock.on('connect', () => sock.write(request));
    sock.on('data', (d) => {
      data += d;
      if (!responded && /^HTTP\/1\.1 \d{3}/m.test(data)) finish();
    });
    sock.on('error', (e) => finish(e));
    sock.on('close', () => finish(new Error('connection closed before response')));
  });
}

// Send a raw request and wait until `tunnels.length` reaches the expected
// count (proves the gate opened a backend tunnel for an accepted token).
function sendAndWaitTunnels(port, request, n, tunnels, ms = 2500) {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, '127.0.0.1');
    sock.on('connect', () => sock.write(request));
    sock.on('error', reject);
    waitFor(() => tunnels.length >= n, ms)
      .then(() => { sock.destroy(); resolve(); })
      .catch((e) => { sock.destroy(); reject(e); });
  });
}

function waitFor(fn, ms = 3000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const v = await fn();
      if (v) resolve(v);
      else if (Date.now() - start > ms) reject(new Error('waitFor timed out'));
      else setTimeout(tick, 25);
    };
    tick();
  });
}

// ── request-line gate (pure) ───────────────────────────────────────────

test('checkRequestLine: correct token opens any path; no token opens only the static schema', () => {
  const token = 'tok-A'.padEnd(32, 'x');
  assert.equal(checkRequestLine(`GET /json/version?token=${token} HTTP/1.1`, token).ok, true);
  assert.equal(checkRequestLine(`GET /devtools/browser/abc?token=${token} HTTP/1.1`, token).ok, true);
  // no token -> only /json/protocol (static schema, no commands)
  assert.equal(checkRequestLine('GET /json/protocol HTTP/1.1', token).ok, true);
  assert.equal(checkRequestLine('GET /json/version HTTP/1.1', token).ok, false);
  assert.equal(checkRequestLine(`GET /json/version?token=wrong HTTP/1.1`, token).ok, false);
  // wrong token is rejected even on /json/protocol
  assert.equal(checkRequestLine(`GET /json/protocol?token=wrong HTTP/1.1`, token).ok, false);
  // garbage / non-http first lines never pass
  for (const line of ['', 'BOGUS', 'GET /x', 'GET /x HTTP/1.1\x00', 'not a url', '\u0000\u0000']) {
    assert.equal(checkRequestLine(line, token).ok, false, `line: ${JSON.stringify(line)}`);
  }
});

test('checkRequestLine: /json/protocol is a static verdict and length-mismatched tokens do not throw', () => {
  const token = 'tok-A'.padEnd(32, 'x');
  // The protocol carve-out is served by the gate, never tunneled.
  const v = checkRequestLine('GET /json/protocol HTTP/1.1', token);
  assert.equal(v.ok, true);
  assert.equal(v.static, true, 'tokenless /json/protocol must be flagged as static');
  // A valid token on /json/protocol is also served statically (never a tunnel).
  const v2 = checkRequestLine(`GET /json/protocol?token=${token} HTTP/1.1`, token);
  assert.equal(v2.ok, true);
  assert.equal(v2.static, true, 'tokenized /json/protocol must still be static');
  // A wrong token on /json/protocol is rejected.
  assert.equal(checkRequestLine('GET /json/protocol?token=wrong HTTP/1.1', token).ok, false);
  // Timing-safe compare must not throw on length mismatch (short vs long).
  assert.equal(checkRequestLine(`GET /json/version?token=${'a'.repeat(5)} HTTP/1.1`, token).ok, false);
  assert.equal(checkRequestLine(`GET /json/version?token=${'z'.repeat(200)} HTTP/1.1`, token).ok, false);
  assert.equal(checkRequestLine(`GET /json/version?token=${token} HTTP/1.1`, token).ok, true);
});

// ── rejection-before-command (Docker-free, execLayer DI) ───────────────

test('unauthenticated clients are rejected before any byte reaches the backend', async () => {
  const token = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();

  try {
    // HTTP discovery without a token -> 403, and no tunnel was ever opened.
    const r1 = await httpRequest(port, 'GET /json/version HTTP/1.1\r\nHost: x\r\n\r\n');
    assert.match(r1, /^HTTP\/1\.1 403/);
    assert.equal(tunnels.length, 0, 'denied request must not open a tunnel');

    // Wrong token -> 403, no tunnel.
    const r2 = await httpRequest(port, `GET /json/version?token=WRONG HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(r2, /^HTTP\/1\.1 403/);
    assert.equal(tunnels.length, 0, 'wrong-token request must not open a tunnel');

    // WebSocket upgrade without a token -> 403, no tunnel (cannot command).
    const r3 = await httpRequest(port, `GET /devtools/page/t? HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
    assert.match(r3, /^HTTP\/1\.1 403/);
    assert.equal(tunnels.length, 0, 'unauthenticated upgrade must not open a tunnel');
  } finally {
    await gate.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.close();
  }
});

test('an authenticated client can execute a browser command through the gate', async () => {
  const token = generateToken();
  const backend = await startFakeCdp({ token, responses: {
    'Target.getTargets': () => ({ targetInfos: [{ type: 'page', targetId: 'p1', url: 'http://x/' }] }),
  } });
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/fake-target-1?token=${token}`);
    const opened = await new Promise((res, rej) => { ws.on('open', () => res(true)); ws.on('error', rej); });
    assert.ok(opened, 'authenticated ws upgrade through the gate must open');

    const reply = await new Promise((res, rej) => {
      ws.on('message', (d) => res(String(d)));
      ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets', params: {} }));
      setTimeout(() => rej(new Error('no command reply')), 3000);
    });
    const parsed = JSON.parse(reply);
    assert.equal(parsed.id, 1);
    assert.equal(parsed.result.targetInfos[0].targetId, 'p1');
    assert.equal(backend.messages.some((m) => m.method === 'Target.getTargets'), true,
      'command must reach the backend');

    // HTTP discovery with the token is relayed too (fake serves /json/protocol).
    const proto = await httpRequest(port, `GET /json/protocol HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(proto, /^HTTP\/1\.1 200/);
    ws.close();
  } finally {
    await gate.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.stop();
  }
});

// ── static protocol + pipelined-bypass regression (T001 fix) ─────────────

test('pipelined second request on an unauthenticated connection never reaches the backend', async () => {
  const token = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();

  try {
    // One TCP write, TWO requests: the unauthenticated /json/protocol followed
    // by a pipelined websocket upgrade. The old carve-out relayed both into a
    // tunnel; the gate must now answer the schema itself and close, so the
    // pipelined upgrade never reaches chromium.
    const req = 'GET /json/protocol HTTP/1.1\r\nHost: x\r\n\r\n' +
      'GET /devtools/browser/attacker HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n';

    const resp = await new Promise((resolve, reject) => {
      const sock = netConnect(port, '127.0.0.1');
      let data = '';
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sock.destroy();
        if (err) reject(err); else resolve(data);
      };
      const timer = setTimeout(() => finish(new Error('timed out waiting for the static protocol response')), 5000);
      sock.on('connect', () => sock.write(req));
      sock.on('data', (d) => { data += d; });
      sock.on('error', (e) => finish(e));
      sock.on('close', () => finish());
    });

    assert.match(resp, /^HTTP\/1\.1 200/, `protocol must be served statically: ${resp.substring(0, 60)}`);
    assert.match(resp, /Content-Length: \d+/, 'static response must carry a Content-Length');
    assert.ok(resp.trimEnd().endsWith('}'), 'static response must include the JSON schema body');

    // Settle event-driven instead of a fixed sleep: wait until the gate has
    // fully torn the connection down (no live sockets), then prove no tunnel
    // was ever opened. A buggy relay would open its tunnel synchronously
    // while processing the pipelined bytes — before the connection closes.
    await waitFor(async () => {
      const n = await new Promise((resolve) => gate.server.getConnections((err, count) => resolve(err ? null : count)));
      return n === 0;
    });
    assert.equal(tunnels.length, 0, 'no tunnel may be opened for the unauthenticated protocol path');
    assert.equal(backend.sockets.length, 0, 'a pipelined second request must never reach the backend');
  } finally {
    await gate.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.close();
  }
});

test('deny responses carry per-status reason phrases', async () => {
  const token = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();

  try {
    const r403 = await httpRequest(port, 'GET /json/version HTTP/1.1\r\nHost: x\r\n\r\n');
    assert.match(r403, /^HTTP\/1\.1 403 Forbidden/, `got: ${r403}`);

    // A first line longer than MAX_LINE_BYTES with no newline -> 413.
    const r413 = await httpRequest(port, 'GET /' + 'a'.repeat(20000) + ' HTTP/1.1');
    assert.match(r413, /^HTTP\/1\.1 413 Payload Too Large/, `got: ${r413.substring(0, 60)}`);

    assert.equal(tunnels.length, 0, 'no tunnel may be opened by denied requests');
  } finally {
    await gate.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.close();
  }
});

// ── rotation ───────────────────────────────────────────────────────────

test('token rotation invalidates the old token at the gate', async () => {
  const oldToken = generateToken();
  const newToken = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });

  // Gate on the old credential.
  const g1 = startGate(oldToken, backend.port, tunnels);
  const port = await g1.listen();
  try {
    await sendAndWaitTunnels(port, `GET /json/version?token=${oldToken} HTTP/1.1\r\nHost: x\r\n\r\n`, 1, tunnels);
  } finally {
    await g1.close();
  }

  // Rotation = new gate rebinding the SAME public port with a fresh token.
  const g2 = startGate(newToken, backend.port, tunnels, port);
  assert.equal(await g2.listen(), port, 'rotation must rebind the same public port');
  try {
    const stale = await httpRequest(port, `GET /json/version?token=${oldToken} HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(stale, /^HTTP\/1\.1 403/, 'rotated-out token must be rejected');
    assert.equal(tunnels.length, 1, 'stale token must not open a tunnel on the new gate');
    await sendAndWaitTunnels(port, `GET /json/version?token=${newToken} HTTP/1.1\r\nHost: x\r\n\r\n`, 2, tunnels);
  } finally {
    await g2.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.close();
  }
});

test('rotateToken bumps the generation and rewrites the URLs consistently', async () => {
  const state = {
    sid: 'rt-1',
    token: generateToken(),
    tokenGeneration: 1,
    wsUrl: withToken('ws://127.0.0.1:9225/devtools/browser/x', generateToken()),
    cdpUrl: withToken('http://127.0.0.1:9225', generateToken()),
  };
  const before = { token: state.token, ws: state.wsUrl, cdp: state.cdpUrl };
  rotateToken(state);
  assert.notEqual(state.token, before.token, 'token must change');
  assert.equal(state.tokenGeneration, 2);
  assert.equal(new URL(state.wsUrl).searchParams.get('token'), state.token);
  assert.equal(new URL(state.cdpUrl).searchParams.get('token'), state.token);
  assert.notEqual(state.wsUrl, before.ws);
  assert.notEqual(state.cdpUrl, before.cdp);
  assert.equal(before.token !== null, true);
});

// ── revocation ─────────────────────────────────────────────────────────

test('revocation blocks reuse: a closed gate never accepts the old token again', async () => {
  const token = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();
  await gate.close(); // session close/cleanup revokes the gate

  await assert.rejects(
    httpRequest(port, `GET /json/version?token=${token} HTTP/1.1\r\nHost: x\r\n\r\n`),
    /ECONNREFUSED|closed before response|timed out/,
    'a revoked token must not be reusable'
  );
  assert.equal(tunnels.length, 0, 'no tunnel may be opened after revocation');
  await backend.close();
});

test('revokeToken strips the token from state and its URLs', () => {
  const state = {
    sid: 'rv-1',
    token: generateToken(),
    tokenGeneration: 3,
    wsUrl: withToken('ws://127.0.0.1:9225/devtools/browser/x', generateToken()),
    cdpUrl: withToken('http://127.0.0.1:9225', generateToken()),
  };
  revokeToken(state);
  assert.equal(state.token, undefined);
  assert.equal(state.tokenGeneration, undefined);
  assert.equal(new URL(state.wsUrl).searchParams.get('token'), null);
  assert.equal(new URL(state.cdpUrl).searchParams.get('token'), null);
});

// ── URL building correctness ───────────────────────────────────────────

test('cdpEndpoint builds discovery URLs safely once cdpUrl carries a query', () => {
  const token = generateToken();
  const cdpUrl = withToken('http://127.0.0.1:9225', token);
  const version = cdpEndpoint(cdpUrl, '/json/version');
  assert.equal(version, `http://127.0.0.1:9225/json/version?token=${encodeURIComponent(token)}`);
  // The naive concat that used to work now breaks — the helper is mandatory.
  assert.notEqual(`${cdpUrl}/json/version`, version);
});

test('withToken sets/overwrites the token param without touching the path', () => {
  const a = withToken('ws://127.0.0.1:9225/devtools/browser/x', 'AAA');
  const b = withToken(a, 'BBB');
  const u = new URL(b);
  assert.equal(u.searchParams.get('token'), 'BBB');
  assert.equal(u.pathname, '/devtools/browser/x');
});

// ── teardown: half-close, both directions ─────────────────────────────

test('gate relays half-close from client to backend (client FIN -> tunnel EOF)', async () => {
  const token = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();

  const client = netConnect(port, '127.0.0.1');
  try {
    await new Promise((res, rej) => { client.on('connect', res); client.on('error', rej); });
    client.write(`GET /json/version?token=${token} HTTP/1.1\r\nHost: x\r\n\r\n`);

    // Wait for the request to arrive at the backend's server-side socket.
    const backendSock = await waitFor(() => backend.sockets.length ? backend.sockets[0] : null);
    await waitFor(() => backendSock.bytesRead > 0);

    client.end(); // client half-close

    const ended = await waitFor(() => (backendSock.readableEnded || backendSock.destroyed) || null);
    assert.ok(ended, 'backend tunnel must see the client FIN');
  } finally {
    client.destroy();
    await gate.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.close();
  }
});

test('gate relays half-close from backend to client (backend EOF -> client end)', async () => {
  const token = generateToken();
  const backend = await startRawBackend();
  const tunnels = [];
  setExecLayerForTests({ spawnExecTunnel: (_c, _p) => tunnelTo(backend.port, tunnels) });
  const gate = startGate(token, backend.port, tunnels);
  const port = await gate.listen();

  const client = netConnect(port, '127.0.0.1');
  let clientEnded = false;
  client.on('end', () => { clientEnded = true; });
  try {
    await new Promise((res, rej) => { client.on('connect', res); client.on('error', rej); });
    client.write(`GET /json/version?token=${token} HTTP/1.1\r\nHost: x\r\n\r\n`);

    const backendSock = await waitFor(() => backend.sockets.length ? backend.sockets[0] : null);
    await waitFor(() => backendSock.bytesRead > 0);

    backendSock.end(); // backend half-close

    assert.ok(await waitFor(() => clientEnded || null), 'client socket must see the backend FIN');
  } finally {
    client.destroy();
    await gate.close();
    for (const s of tunnels) { try { s.destroy(); } catch {} }
    await backend.close();
  }
});

// ── execLayer DI seam surface ──────────────────────────────────────────

test('spawnGate dispatches through the DI seam so orchestration is stubbable', async () => {
  const calls = [];
  setExecLayerForTests({ spawnGate: (opts) => { calls.push(opts); return 999; } });
  const pid = spawnGate({ sid: 'di-1', publicPort: 9225, internalPort: 9224, containerName: 'chromium-vnc', token: 'tok' });
  assert.equal(pid, 999);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sid, 'di-1');
  assert.equal(calls[0].token, 'tok');
  assert.equal('argv' in calls[0], false);
});
