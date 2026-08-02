import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '../fixtures');

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
    const abs = join(FIXTURES_DIR, filePath);
    const data = await readFile(abs);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8090, '0.0.0.0', () => {
  console.log('fixture server on http://0.0.0.0:8090');
  process.stdout.write('READY\n');
});
