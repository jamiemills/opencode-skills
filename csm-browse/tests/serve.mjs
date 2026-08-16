import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const FIXTURES_DIR = resolve(join(fileURLToPath(import.meta.url), '../fixtures'));

// Bind host: the docker bridge gateway, so the in-container browser can reach
// the fixtures. Env base (CSM_BROWSE_FIXTURE_BASE) may pin host and port.
function bridgeHost() {
  const envBase = process.env.CSM_BROWSE_FIXTURE_BASE;
  if (envBase) {
    const m = envBase.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^\/:?]+)/);
    if (m) return m[1];
  }
  try {
    const routes = execFileSync('ip', ['route'], { timeout: 2000, encoding: 'utf-8' });
    const m = routes.match(/dev\s+docker0\b.*\bsrc\s+(\d+\.\d+\.\d+\.\d+)/);
    if (m) return m[1];
  } catch {}
  return '172.17.0.1';
}

// Port: explicit in the env base, else ephemeral (0).
function fixturePort() {
  const envBase = process.env.CSM_BROWSE_FIXTURE_BASE || '';
  const m = envBase.match(/:(\d+)(?:\/|$)/);
  return m ? parseInt(m[1], 10) : 0;
}

const HOST = bridgeHost();

const MIME_TYPES = {
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    let filePath = req.url === '/' ? '/page1.html' : req.url;
    filePath = filePath.split('?')[0];

    // Traversal guard: reject any path containing '..' in raw or decoded form.
    let decoded = filePath;
    try { decoded = decodeURIComponent(filePath); } catch {}
    if (filePath.includes('..') || decoded.includes('..')) {
      res.writeHead(403);
      res.end();
      return;
    }

    const abs = resolve(join(FIXTURES_DIR, decoded));
    if (abs !== FIXTURES_DIR && !abs.startsWith(FIXTURES_DIR + sep)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const data = await readFile(abs);
    const ext = extname(abs);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

server.listen(fixturePort(), HOST, () => {
  const { port } = server.address();
  console.log(`fixture server on http://${HOST}:${port} (fixtures: ${FIXTURES_DIR})`);
  process.stdout.write(`READY ${port}\n`);
});
