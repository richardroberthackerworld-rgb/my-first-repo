/**
 * Copies the ffmpeg.wasm runtime out of node_modules into public/ffmpeg/.
 *
 * WHY THIS EXISTS
 *
 * The tools that export FLAC, M4A, OGG and AAC load ffmpeg by URL at runtime,
 * so its files have to sit in public/ and be served from our own origin — we
 * cannot rely on a CDN, because a cross-origin script would have to satisfy
 * COEP (see public/.htaccess) and would put a third party in the middle of
 * every export.
 *
 * But they are a byte-for-byte copy of two npm packages, and ffmpeg-core.wasm
 * alone is 31 MB — larger than the entire rest of this repository's history.
 * Committing it would permanently bloat every clone with something `npm ci`
 * can reproduce exactly. So public/ffmpeg/ is gitignored and rebuilt here.
 *
 * Note the ESM builds, not the UMD ones: the app loads ffmpeg-core.js as a
 * module, and the UMD file resolves the .wasm through document.currentScript,
 * which is undefined inside a worker.
 *
 * Runs automatically before every build. Safe to run by hand at any time.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modules = join(root, 'node_modules');
const target = join(root, 'public', 'ffmpeg');

/* source → destination, relative to node_modules and public/ffmpeg. */
const FILES = [
  ['@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg-core.js'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core.wasm'],
  ['@ffmpeg/ffmpeg/dist/esm/classes.js', 'esm/classes.js'],
  ['@ffmpeg/ffmpeg/dist/esm/const.js', 'esm/const.js'],
  ['@ffmpeg/ffmpeg/dist/esm/errors.js', 'esm/errors.js'],
  ['@ffmpeg/ffmpeg/dist/esm/index.js', 'esm/index.js'],
  ['@ffmpeg/ffmpeg/dist/esm/types.js', 'esm/types.js'],
  ['@ffmpeg/ffmpeg/dist/esm/utils.js', 'esm/utils.js'],
  ['@ffmpeg/ffmpeg/dist/esm/worker.js', 'esm/worker.js'],
];

if (!existsSync(modules)) {
  console.error('sync-ffmpeg-core: no node_modules — run `npm ci` first.');
  process.exit(1);
}

let copied = 0;
let current = 0;

for (const [from, to] of FILES) {
  const src = join(modules, from);
  const dst = join(target, to);

  if (!existsSync(src)) {
    console.error(`sync-ffmpeg-core: missing ${from}`);
    console.error('  The @ffmpeg packages are not installed as expected. Run `npm ci`.');
    process.exit(1);
  }

  // Skip identical files so a rebuild does not rewrite 31 MB for nothing.
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
    current += 1;
    continue;
  }

  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied += 1;
}

const total = FILES.length;
console.log(
  copied === 0
    ? `sync-ffmpeg-core: ${total} files already current`
    : `sync-ffmpeg-core: copied ${copied}, ${current} already current`,
);
