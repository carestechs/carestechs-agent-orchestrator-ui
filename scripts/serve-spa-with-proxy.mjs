#!/usr/bin/env node
// Tiny static server for the production SPA build that combines:
//   - static asset serving from dist/spa/browser/
//   - proxy of /api/* and /auth/* to the BFF on :4000
//   - SPA fallback (index.html) for any other unknown path
//
// http-server has --proxy fallback OR static, but not "proxy /api + SPA
// fallback for everything else". `serve -s` does SPA fallback but no proxy.
// We need both for Lighthouse to load /runs/:id off the production build,
// so this is the simplest path that doesn't pull in another dep.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 4200);
const ROOT = resolve(process.env.SPA_DIR ?? 'dist/spa/browser');
const BFF = process.env.BFF_URL ?? 'http://localhost:4000';

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

async function proxy(req, res, target) {
  const upstream = new URL(req.url, target);
  const headers = { ...req.headers };
  delete headers.host;
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    init.body = Buffer.concat(chunks);
  }
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, init);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Upstream unreachable: ${String(err)}`);
    return;
  }
  const respHeaders = {};
  upstreamRes.headers.forEach((v, k) => { respHeaders[k] = v; });
  res.writeHead(upstreamRes.status, respHeaders);
  if (upstreamRes.body) {
    const reader = upstreamRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      await proxy(req, res, BFF);
      return;
    }
    const safe = normalize(url.pathname).replace(/^\/+/, '');
    const direct = await tryFile(join(ROOT, safe));
    const filePath = direct ?? (await tryFile(join(ROOT, 'index.html')));
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
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`Server error: ${String(err)}`);
  }
});

server.listen(PORT, () => console.log(`[spa] serving ${ROOT} on :${PORT}, /api & /auth → ${BFF}`));
