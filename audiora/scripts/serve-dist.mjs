/**
 * Serves dist/ the way the production host does.
 *
 *   node scripts/serve-dist.mjs [port]
 *
 * `vite preview` is NOT a substitute for this. It answers every path with the
 * root index.html, so the pre-rendered per-route pages are never served and
 * every page appears to have the same title — which hides exactly the bug this
 * is here to catch.
 *
 * The resolution order below is the one public/.htaccess produces on Apache:
 *
 *   1. A real file           → serve it.
 *   2. A directory with an   → serve that (DirectoryIndex).
 *      index.html
 *   3. Anything else         → serve /index.html so the SPA router can handle
 *                              the URL.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const port = Number(process.argv[2] ?? 4173);

/* Articles that moved, mirroring the .htaccess rule. */
const MOVED = new Map([['blog/why-your-audio-should-never-be-uploaded', '/blog/keeping-your-audio-private-online']]);

/* The short tool URLs public/.htaccess 301s to /tools/<id>. Mirrored here so
   the redirect can be tested rather than assumed. */
const SHORT_TOOL_PATHS = new Set([
    "vocal-remover",
    "stem-splitter",
    "noise-remover",
    "audio-cutter",
    "song-joiner",
    "pitch-shifter",
    "audio-converter"
  ]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  const short = url.pathname.replace(/^\/|\/$/g, '');

  if (MOVED.has(short)) {
    res.writeHead(301, { Location: MOVED.get(short) });
    res.end();
    return;
  }

  if (SHORT_TOOL_PATHS.has(short)) {
    res.writeHead(301, { Location: `/tools/${short}` });
    res.end();
    return;
  }

  // normalize() collapses any ../ before it can escape dist/.
  const requested = join(dist, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));

  let file = null;
  if (existsSync(requested) && statSync(requested).isFile()) {
    file = requested;
  } else if (existsSync(join(requested, 'index.html'))) {
    file = join(requested, 'index.html');
  } else {
    file = join(dist, 'index.html');
  }

  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    // Cross-origin isolation, matching public/.htaccess. Without these two the
    // separation engine silently falls back to a single thread here, so a local
    // check would not be testing what production runs.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    // Matches the .htaccess rule: a service worker must never be cached.
    'Cache-Control': file.endsWith('sw.js') ? 'no-cache, no-store, must-revalidate' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`serving dist/ like Apache on http://localhost:${port}`);
});
