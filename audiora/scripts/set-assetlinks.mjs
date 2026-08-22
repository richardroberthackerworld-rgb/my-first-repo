/**
 * Writes the Android signing fingerprints into public/.well-known/assetlinks.json.
 *
 *   node scripts/set-assetlinks.mjs <SHA-256> [more SHA-256 …]
 *   node scripts/set-assetlinks.mjs --show
 *
 * Why a script rather than editing the JSON by hand: a fingerprint is 32 hex
 * pairs and a single wrong character produces a file that looks completely
 * correct and silently fails — the app ships with a browser address bar and
 * nothing anywhere says why. This validates the format strictly before writing.
 *
 * WHICH FINGERPRINT
 *
 * If you use Play App Signing — and you almost certainly should — Google
 * re-signs your bundle with its own key. The fingerprint that matters is
 * therefore GOOGLE'S, not your upload key's:
 *
 *   Play Console → your app → Setup → App integrity
 *     → App signing key certificate → SHA-256 certificate fingerprint
 *
 * Using the upload key's fingerprint instead is the single commonest reason a
 * TWA ships with the URL bar visible.
 *
 * You can pass BOTH. Listing the upload key as well means a build you install
 * directly (an APK from `gradlew assembleRelease`, or a closed test track that
 * serves your upload-signed artifact) also verifies. That is normal practice
 * and there is no downside to it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'public', '.well-known', 'assetlinks.json');
const PACKAGE = 'in.sevenby.audio';

const PLACEHOLDER = 'REPLACE_WITH_YOUR_SIGNING_CERTIFICATE_SHA256_FINGERPRINT';

/** 32 uppercase hex pairs separated by colons — exactly what keytool prints. */
const SHAPE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function normalise(input) {
  // Accept what people actually paste: lowercase, spaces, stray whitespace.
  const cleaned = String(input).trim().toUpperCase().replace(/\s+/g, '');
  // Also accept a bare 64-char hex string with no separators.
  if (/^[0-9A-F]{64}$/.test(cleaned)) return cleaned.match(/../g).join(':');
  return cleaned;
}

function describe(value) {
  const pairs = value.split(':');
  if (!value.includes(':')) return 'no colon separators, and not 64 plain hex characters';
  if (pairs.length !== 32) return `${pairs.length} groups — a SHA-256 fingerprint has exactly 32`;
  const bad = pairs.find((p) => !/^[0-9A-F]{2}$/.test(p));
  if (bad) return `"${bad}" is not a two-digit hex pair`;
  return 'unrecognised';
}

/* ------------------------------------------------------------------ show -- */

if (process.argv.includes('--show') || process.argv.length < 3) {
  if (!fs.existsSync(FILE)) {
    console.error('assetlinks.json does not exist at ' + FILE);
    process.exit(1);
  }
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const prints = current[0]?.target?.sha256_cert_fingerprints ?? [];

  console.log('\n' + FILE);
  console.log('  package: ' + (current[0]?.target?.package_name ?? '(none)'));
  console.log('  fingerprints:');
  for (const f of prints) {
    const placeholder = f.includes('REPLACE_WITH');
    console.log(`    ${placeholder ? '✗ PLACEHOLDER' : '✓ ' + (SHAPE.test(f) ? 'valid  ' : 'MALFORMED')}  ${f}`);
  }

  if (prints.some((f) => f.includes('REPLACE_WITH'))) {
    console.log('\n  The Android app will show a browser address bar until this is set.');
    console.log('  Get the value from Play Console → Setup → App integrity, then run:');
    console.log('    node scripts/set-assetlinks.mjs <SHA-256>\n');
  }
  process.exit(0);
}

/* ----------------------------------------------------------------- write -- */

const inputs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fingerprints = [];

for (const raw of inputs) {
  const value = normalise(raw);
  if (value === PLACEHOLDER) {
    console.error('That is the placeholder, not a fingerprint.');
    process.exit(1);
  }
  if (!SHAPE.test(value)) {
    console.error(`\nNot a valid SHA-256 fingerprint:\n  ${raw}\n  ${describe(value)}\n`);
    console.error('Expected 32 colon-separated hex pairs, for example:');
    console.error('  58:59:C5:B3:6C:A1:76:2C:BC:BB:54:9F:37:94:56:E5:69:C1:7C:13:6C:41:4A:9B:A1:87:B7:23:69:21:E4:C0\n');
    process.exit(1);
  }
  if (fingerprints.includes(value)) {
    console.error('The same fingerprint was given twice.');
    process.exit(1);
  }
  fingerprints.push(value);
}

const doc = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PACKAGE,
      sha256_cert_fingerprints: fingerprints,
    },
  },
];

fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');

console.log(`\nWrote ${fingerprints.length} fingerprint${fingerprints.length === 1 ? '' : 's'} for ${PACKAGE}:`);
for (const f of fingerprints) console.log('  ' + f);
console.log(`\n  ${FILE}`);
console.log('\nNow rebuild so it reaches the site:');
console.log('  .\\make-7audio-zip.ps1');
console.log('\nAfter deploying, confirm it is served correctly:');
console.log('  curl -i https://7audio.7by.in/.well-known/assetlinks.json\n');
