import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import wsPkg from 'ws';

const { Server: WebSocketServer } = wsPkg; // ws v7 (transitive dep) names it Server

const require = createRequire(import.meta.url);
const PROTOCOL_JSON = readFileSync(require.resolve('chrome-remote-interface/lib/protocol.json'));

// Minimal in-process CDP endpoint: an HTTP server serving /json/protocol
// (chrome-remote-interface fetches it from the wsUrl's host:port before
// opening the WebSocket) plus a WebSocket that replies to every
// {id, method, params} frame with a canned per-method result.
export async function startFakeCdp({ responses = {} } = {}) {
  const httpServer = createServer((req, res) => {
    if (req.url === '/json/protocol') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(PROTOCOL_JSON);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  const connections = [];
  const messages = [];

  wss.on('connection', (ws) => {
    connections.push(ws);
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      messages.push(msg);
      const handler = responses[msg.method];
      Promise.resolve()
        .then(() => (handler ? handler(msg.params ?? {}, msg) : {}))
        .then((result) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: msg.id, result: result ?? {} }));
        })
        .catch((error) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ id: msg.id, error: { message: String(error?.message ?? error) } }));
          }
        });
    });
  });

  await new Promise((res) => httpServer.listen(0, '127.0.0.1', res));
  const port = httpServer.address().port;

  return {
    url: `ws://127.0.0.1:${port}/devtools/page/fake-target-1`,
    messages,
    connections,
    closeAll() { for (const ws of connections) { try { ws.close(); } catch {} } },
    stop() {
      return new Promise((res) => {
        for (const ws of connections) { try { ws.terminate(); } catch {} }
        wss.close(() => httpServer.close(() => res()));
      });
    },
  };
}
