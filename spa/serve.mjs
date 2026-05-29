#!/usr/bin/env node
/** Minimal static file server for local preview of the SPA.
 *  Run from spa/: node serve.mjs   then open http://localhost:8765
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8765;
const ROOT = __dirname;                          // spa/
const PROJECT_ROOT = path.resolve(__dirname, '..'); // repo root (for /docs/*)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    // /docs/* is served from the repo root (mirrors the deployed bundle where the
    // deploy workflow copies docs/ into the site). Everything else from spa/.
    let base = ROOT, rel = urlPath;
    if (urlPath === '/docs' || urlPath.startsWith('/docs/')) base = PROJECT_ROOT;
    const safe = path.normalize(path.join(base, rel));
    if (!safe.startsWith(base)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await fs.readFile(safe);
    const ext = path.extname(safe);
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 ' + e.message);
  }
});

server.listen(PORT, () => console.log(`Serving SPA on http://localhost:${PORT}`));
