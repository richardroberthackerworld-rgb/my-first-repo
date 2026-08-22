/**
 * Finishes dist/sw.js after `vite build`.
 *
 *   node scripts/make-sw.mjs
 *
 * public/sw.js is copied to dist/ verbatim by Vite, with two placeholders it
 * cannot fill in itself:
 *
 *   __BUILD_VERSION__  — a hash of the built output. It changes whenever the
 *                        app changes, and only then, so returning visitors are
 *                        not handed a new cache for an identical build.
 *   __PRECACHE_URLS__  — the actual filenames Vite emitted this time. Hardcoding
 *                        a list would rot the moment a chunk is renamed.
 *
 * Run it after the build, never before.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('make-sw: dist/ does not exist. Run the build first.');
  process.exit(1);
}

/** Every file under dist/, as paths relative to dist/ with forward slashes. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(dist, full).split('\\').join('/'));
  }
  return out;
}

const files = walk(dist);

/**
 * What goes in the precache.
 *
 * The build output, so repeat visits paint immediately, plus connection.html
 * for the one case where the network cannot be reached at all.
 * Deliberately excluded —
 *   · the audio encoder core in ffmpeg/ (tens of MB, and only some visitors
 *     ever export to FLAC/M4A/OGG/AAC),
 *   · the separation workers, which pull a 181 MB model of their own,
 *   · sitemap.xml, robots.txt and the source maps, which no visitor loads.
 * All of those are still cached on first use by the runtime strategies.
 */
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/connection.html',
  '/brand/favicon.svg',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/maskable-192.png',
  '/brand/maskable-512.png',
  ...files
    .filter((f) => f.startsWith('assets/'))
    .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
    .map((f) => `/${f}`),
];

// Anything listed must actually exist, or the install logs a warning for a
// file that was never going to be there.
const missing = PRECACHE.filter((url) => url !== '/' && !files.includes(url.slice(1)));
if (missing.length) {
  console.error('make-sw: these precache entries are not in dist/:\n  ' + missing.join('\n  '));
  process.exit(1);
}

/* The version tracks the CONTENT of the shell, so an unchanged rebuild keeps
   the same caches and returning visitors are not asked to reload for nothing. */
const hash = createHash('sha256');
for (const url of PRECACHE.slice().sort()) {
  if (url === '/') continue;
  hash.update(url);
  hash.update(readFileSync(join(dist, url.slice(1))));
}
const version = hash.digest('hex').slice(0, 12);

const swPath = join(dist, 'sw.js');
let sw = readFileSync(swPath, 'utf8');

if (!sw.includes('__BUILD_VERSION__') || !sw.includes('__PRECACHE_URLS__')) {
  console.error('make-sw: dist/sw.js has no placeholders. Was it already processed?');
  process.exit(1);
}

sw = sw
  .replace('__BUILD_VERSION__', version)
  .replace('__PRECACHE_URLS__', JSON.stringify(PRECACHE, null, 2));

writeFileSync(swPath, sw);

console.log(`make-sw: version ${version}, ${PRECACHE.length} files precached`);
