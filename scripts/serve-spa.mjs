#!/usr/bin/env node
// Tiny static server for the production SPA build:
//   - serves static assets from dist/spa/browser/
//   - SPA fallback (index.html) for any unknown non-asset path
//
// After FEAT-003 T-032 there is no BFF, so no proxy is needed. The SPA calls
// the orchestrator directly via the base URL baked into environment.prod.ts.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 4200);
const ROOT = resolve(process.env.SPA_DIR ?? 'dist/spa/browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function tryFile(path) {
  try {
    const s = await stat(path);
    if (s.isFile()) return path;
  } catch { /* not found */ }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const safe = normalize(url.pathname).replace(/^\/+/, '');
    const direct = await tryFile(join(ROOT, safe));
    // SPA fallback: only return index.html for paths that look like routes
    // (no file extension). Returning HTML for an asset request like
    // /runs/abc/chunk-X.js triggers Chrome's strict MIME check and kills
    // the bootstrap — script tag refuses to execute, no FCP.
    const looksLikeAsset = /\.[a-z0-9]+$/i.test(url.pathname);
    const filePath = direct ?? (looksLikeAsset ? null : await tryFile(join(ROOT, 'index.html')));
    if (!filePath) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`Server error: ${String(err)}`);
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

process.on('uncaughtException', (err) => console.error('[spa] uncaught:', err));
process.on('unhandledRejection', (err) => console.error('[spa] unhandled:', err));

server.listen(PORT, () => console.log(`[spa] serving ${ROOT} on :${PORT}`));
