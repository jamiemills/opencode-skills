#!/usr/bin/env node
// cdp-gate.mjs — host-side token gate for a session's CDP endpoint (T001).
//
// Listens on 127.0.0.1:<publicPort> and validates ?token= on the FIRST
// request line of every connection (HTTP discovery + WebSocket upgrade).
// A missing or wrong token is answered with HTTP 403 before any byte reaches
// chromium; a valid token opens a `docker exec -i <container> socat -
// TCP:127.0.0.1:<internalPort>` stdio tunnel and the connection is then
// relayed byte-exact, both directions, with teardown on either half-close.
//
// GET /json/protocol is served STATICALLY by the gate itself (the schema is
// cached from the chrome-remote-interface package) and the connection is
// closed — chrome-remote-interface fetches it without a token, and no tunnel
// is ever opened for it. This closes the pipelined-bypass: an unauthenticated
// client that pipelines a second request on the same connection (e.g. a
// websocket upgrade) after /json/protocol can never reach chromium, because
// the remaining bytes are dropped with the connection, not relayed.
//
// The token arrives via CSM_CDP_GATE_TOKEN (process env), never argv — argv
// is visible in ps output. It is minted/rotated by ensure-browser.mjs and
// stored in 0600 state.json.
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, timingSafeEqual } from "node:crypto";
import { sessionDir } from "../lib/session.mjs";
import { secureAppend } from "../lib/security.mjs";
import { spawnExecTunnel } from "../lib/docker.mjs";

const LINE_TIMEOUT_MS = 10000;
const MAX_LINE_BYTES = 16384;
const TUNNEL_KILL_GRACE_MS = 2000;
const STATIC_CLOSE_GRACE_MS = 5000;

const require = createRequire(import.meta.url);
const PROTOCOL_JSON = (() => {
  try {
    return readFileSync(require.resolve("chrome-remote-interface/lib/protocol.json"), "utf-8");
  } catch {
    return null;
  }
})();

// Timing-safe token comparison. Both sides are hashed to a fixed 32 bytes so
// a length mismatch neither throws (timingSafeEqual) nor leaks the token
// length via an early return.
function tokenEquals(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

const REASON_PHRASES = {
  400: "Bad Request",
  403: "Forbidden",
  413: "Payload Too Large",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

// Pure request-line gate: correct token opens anything; /json/protocol is
// served statically by the gate itself (never tunneled); a wrong token opens
// nothing.
export function checkRequestLine(line, expectedToken) {
  if (typeof line !== "string") return { ok: false };
  const parts = line.split(/\s+/);
  if (parts.length < 2) return { ok: false };
  let target;
  try {
    target = new URL(parts[1], "http://localhost");
  } catch {
    return { ok: false };
  }
  const token = target.searchParams.get("token");
  if (target.pathname === "/json/protocol") {
    // Static schema — no commands, no session data. A wrong token is still
    // rejected; a valid (or absent) token is answered statically. Never a
    // tunnel, so pipelined bytes after this line can never reach the backend.
    if (token !== null && !tokenEquals(token, expectedToken)) return { ok: false };
    return { ok: true, static: true, target: parts[1] };
  }
  if (token !== null && tokenEquals(token, expectedToken)) return { ok: true, target: parts[1] };
  return { ok: false };
}

function deny(socket, status) {
  const reason = REASON_PHRASES[status] || "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  // F-017: half-close is not enough — a hostile client that never reads can
  // hold the socket half-open forever (fd/memory exhaustion). Force it down
  // after the same grace serveStaticProtocol uses; the tracked Set in
  // createGate drops the socket on its 'close' event.
  const killTimer = setTimeout(() => {
    try {
      socket.destroy();
    } catch {}
  }, STATIC_CLOSE_GRACE_MS);
  if (killTimer.unref) killTimer.unref();
}

function serveStaticProtocol(socket, log) {
  if (PROTOCOL_JSON === null) {
    log("static protocol schema unavailable");
    deny(socket, 503);
    return;
  }
  socket.end(
    [
      "HTTP/1.1 200 OK",
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(PROTOCOL_JSON)}`,
      "Connection: close",
      "",
      PROTOCOL_JSON,
    ].join("\r\n"),
  );
  // Hostile clients may never half-close; force the socket down so no orphan
  // lingers (and so pipelined bytes buffered client-side are never replayable).
  const killTimer = setTimeout(() => {
    try {
      socket.destroy();
    } catch {}
  }, STATIC_CLOSE_GRACE_MS);
  if (killTimer.unref) killTimer.unref();
}

function handleConnection(socket, ctx) {
  const { expectedToken, openTunnel, log } = ctx;
  let buf = "";
  let lineDone = false;
  let accepted = false;
  let denied = false;
  let staticServed = false;
  let tunnel = null;
  let wroteBackend = false;
  let closed = false;

  const teardown = () => {
    if (closed) return;
    closed = true;
    try {
      socket.destroy();
    } catch {}
    if (tunnel) {
      try {
        tunnel.kill("SIGTERM");
      } catch {}
    }
  };

  const lineTimer = setTimeout(() => {
    if (!accepted && !denied) {
      denied = true;
      deny(socket, 400);
    }
  }, LINE_TIMEOUT_MS);
  if (lineTimer.unref) lineTimer.unref();

  // F-017: an unhandled 'error' on a denied/static socket (RST, EPIPE) would
  // crash the whole gate process; swallow it — teardown handles the child.
  socket.on("error", () => {});

  socket.on("data", (chunk) => {
    if (denied || closed || staticServed) return;
    if (accepted && tunnel) {
      if (!tunnel.stdin.write(chunk)) socket.pause();
      return;
    }
    buf += chunk;
    if (!accepted) {
      if (!lineDone) {
        if (buf.length > MAX_LINE_BYTES && buf.indexOf("\n") === -1) {
          denied = true;
          clearTimeout(lineTimer);
          deny(socket, 413);
          return;
        }
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        lineDone = true;
        const verdict = checkRequestLine(buf.slice(0, nl).replace(/\r$/, ""), expectedToken);
        if (!verdict.ok) {
          denied = true;
          clearTimeout(lineTimer);
          deny(socket, 403);
          return;
        }
        clearTimeout(lineTimer);
        if (verdict.static) {
          // Serve the schema and close. No tunnel is opened, so any pipelined
          // bytes already buffered here (or still in flight) can never reach
          // the backend.
          staticServed = true;
          serveStaticProtocol(socket, log);
          return;
        }
        accepted = true;
        openTunnelAsync();
      }
    }
  });

  function openTunnelAsync() {
    let child;
    try {
      child = openTunnel();
    } catch (err) {
      log(`tunnel spawn failed: ${err.message}`);
      if (!closed) {
        denied = true;
        deny(socket, 502);
      }
      return;
    }
    if (!child || !child.stdin || !child.stdout) {
      log("tunnel returned an unusable child");
      if (!closed) {
        denied = true;
        deny(socket, 502);
      }
      return;
    }
    if (socket.destroyed) {
      try {
        child.kill("SIGTERM");
      } catch {}
      return;
    }
    tunnel = child;
    let stderr = "";
    if (child.stderr)
      child.stderr.on("data", (d) => {
        stderr += d;
        if (stderr.length > 2048) stderr = stderr.slice(-2048);
      });

    child.stdout.on("data", (d) => {
      wroteBackend = true;
      if (!socket.write(d)) child.stdout.pause();
    });
    child.stdout.on("end", () => {
      try {
        socket.end();
      } catch {}
    });
    child.on("error", (err) => {
      log(`tunnel error: ${err.message}`);
      if (!closed && !wroteBackend && !denied) deny(socket, 502);
      else teardown();
    });
    child.on("close", (code) => {
      if (stderr.trim())
        log(`tunnel exit ${code}: ${stderr.trim().split("\n").slice(0, 3).join(" ")}`);
      if (!closed) {
        if (!wroteBackend && !denied) deny(socket, 502);
        try {
          socket.end();
        } catch {}
      }
    });

    // Flush any bytes buffered while the tunnel spun up (headers, first frame).
    const pending = buf;
    buf = "";
    if (pending.length) child.stdin.write(pending);

    // Backpressure, both directions.
    child.stdin.on("drain", () => {
      try {
        socket.resume();
      } catch {}
    });
    socket.on("drain", () => {
      try {
        child.stdout.resume();
      } catch {}
    });
    socket.on("end", () => {
      try {
        child.stdin.end();
      } catch {}
    });
    socket.on("error", () => teardown());
    socket.on("close", () => {
      // Client fully gone: give the backend a grace to flush, then kill the
      // docker exec child so no orphan socat lingers.
      try {
        child.stdin.end();
      } catch {}
      const killTimer = setTimeout(() => {
        if (!child.exitCode && !child.signalCode) {
          try {
            child.kill("SIGTERM");
          } catch {}
        }
      }, TUNNEL_KILL_GRACE_MS);
      if (killTimer.unref) killTimer.unref();
    });
  }
}

export function createGate({
  port = 0,
  internalPort,
  containerName,
  token,
  openTunnel,
  log = () => {},
}) {
  const server = createServer((socket) =>
    handleConnection(socket, {
      expectedToken: token,
      openTunnel: openTunnel || (() => spawnExecTunnel(containerName, internalPort)),
      log,
    }),
  );
  // Track live sockets so close() can force-tear them down; a stuck client
  // must never block gate shutdown (and leave an orphan docker exec behind).
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (err) => {
          server.removeListener("listening", onListen);
          reject(err);
        };
        const onListen = () => {
          server.removeListener("error", onError);
          resolve(server.address().port);
        };
        server.once("error", onError);
        server.once("listening", onListen);
        server.listen(port, "127.0.0.1");
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        for (const s of sockets) {
          try {
            s.destroy();
          } catch {}
        }
      });
    },
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const args = process.argv.slice(2);
  let sid = null,
    port = null,
    internal = null,
    containerName = null,
    logPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sid" && i + 1 < args.length) sid = args[++i];
    else if (args[i] === "--port" && i + 1 < args.length) port = parseInt(args[++i], 10);
    else if (args[i] === "--internal" && i + 1 < args.length) internal = parseInt(args[++i], 10);
    else if (args[i] === "--container" && i + 1 < args.length) containerName = args[++i];
    else if (args[i] === "--log" && i + 1 < args.length) logPath = args[++i];
  }
  const token = process.env.CSM_CDP_GATE_TOKEN;
  if (!Number.isInteger(port) || !Number.isInteger(internal) || !containerName) {
    console.error(
      "Usage: cdp-gate.mjs --sid <sid> --port <pub> --internal <int> --container <name> [--log <path>]  (token via CSM_CDP_GATE_TOKEN)",
    );
    process.exit(1);
  }
  if (!token) {
    console.error("cdp-gate: CSM_CDP_GATE_TOKEN not set");
    process.exit(1);
  }

  // --log (used by the shared 9222 funnel) overrides the per-session log
  // path; --sid stays optional then (it is only used to derive the default
  // gate.log location under the session dir).
  const gateLogPath =
    logPath ||
    (sid
      ? (() => {
          try {
            return join(sessionDir(sid), "gate.log");
          } catch {
            return null;
          }
        })()
      : null);
  const log = (msg) => {
    if (gateLogPath) {
      secureAppend(gateLogPath, `${new Date().toISOString()} cdp-gate: ${msg}\n`).catch(() => {});
    }
  };

  const gate = createGate({ port, internalPort: internal, containerName, token, log });
  gate
    .listen()
    .then(() => log(`listening on 127.0.0.1:${port} -> ${containerName}:${internal}`))
    .catch((err) => {
      log(`listen failed: ${err.message}`);
      process.exit(1);
    });

  const shutdown = () => {
    gate.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
