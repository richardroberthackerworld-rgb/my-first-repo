#!/usr/bin/env node
/* ============================================================
   7Solve — CAPABILITY ARTIFACT GENERATOR
   ------------------------------------------------------------
   capabilities.json is canonical. This writes the artifacts that
   used to be maintained by hand:

     checks.json          the wiring registry registry-proof.js
                          vandalises. Kept dumb on purpose.
     index.html PROOF     which check kinds may certify, inside
                          a fenced region with an integrity hash.

   capability.php is NOT generated — it reads the manifest at
   runtime. Generating PHP would leave a second copy of the same
   facts on disk, which is the thing this whole exercise removes.

       node tools/gen-capabilities.js            write
       node tools/gen-capabilities.js --check    exit 1 on drift

   DETERMINISM IS A REQUIREMENT, NOT A NICETY. Running twice must
   produce a zero-byte diff, because the gate proves faithfulness
   by regenerating and diffing — a generator that varied would
   make that proof meaningless. Nothing here reads the clock, the
   filesystem order, or a hash seed.

   checks.json is written CRLF because the .2 file is CRLF and
   Release A's acceptance property is byte identity. That is
   recorded in the manifest (_generated) rather than assumed.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = path.join(__dirname, '..');
const MANIFEST = path.join(HERE, 'capabilities.json');
const CHECKS = path.join(HERE, 'checks.json');
const INDEX = path.join(HERE, 'index.html');

const CHECK_ONLY = process.argv.indexOf('--check') >= 0;

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/* ------------------------------------------------------------------
   1. checks.json — the wiring registry
   ------------------------------------------------------------------ */
function buildChecks() {
  const spec = (m._generated && m._generated['checks.json']) || {};
  const out = {
    _: spec.header,
    checks: m.checkers.map((c) => {
      /* key order is name, js, php, note — the .2 order. An object literal
         preserves insertion order for string keys, so this is stable. */
      const e = { name: c.checker, js: c.engines.js, php: c.engines.php };
      if (c.note) e.note = c.note;
      return e;
    }),
    _limits: spec.limits,
  };
  let text = JSON.stringify(out, null, 2);
  if (spec.eol === 'crlf') text = text.replace(/\n/g, '\r\n') + '\r\n';
  else text += '\n';
  return text;
}

/* ------------------------------------------------------------------
   2. the PROOF set inside index.html
   ------------------------------------------------------------------
   Membership is authority !== 'advisory'.

   `evidence` kinds ARE members. That is not a loophole: Phase 1 puts
   `subst` in PROOF and then stops it certifying alone through the
   evidenceOnly rule, which reads needsComplete off the emitted check.
   Dropping evidence kinds out of PROOF here would change behaviour,
   and Release A changes none.                                        */
function proofKinds() {
  return m.kinds.filter((k) => k.authority !== 'advisory').map((k) => k.kind);
}

function buildProofBlock(indent) {
  const keys = proofKinds();
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 13);
  /* wrap at a fixed column so the emitted text is a pure function of the
     key list — no terminal width, no locale */
  const lines = [];
  let line = '';
  keys.forEach((k, i) => {
    const piece = k + ':1' + (i === keys.length - 1 ? '' : ', ');
    if (line.length + piece.length > 74) { lines.push(line.replace(/\s+$/, '')); line = ''; }
    line += piece;
  });
  if (line) lines.push(line.replace(/\s+$/, ''));

  const body = lines.map((l, i) => (i === 0 ? '' : inner) + l).join('\n');
  const decl = pad + 'var PROOF = {' + body + '};';
  const hash = crypto.createHash('sha256').update(decl).digest('hex').slice(0, 16);
  return {
    text: pad + '/* @generated:PROOF from capabilities.json — do not edit by hand.\n' +
          pad + '   sha256:' + hash + '  regenerate: node tools/gen-capabilities.js */\n' +
          decl + '\n' +
          pad + '/* @end:PROOF */',
    hash,
    keys,
  };
}

/* Locate the PROOF region: the fence if it is already there, otherwise the
   bare literal (first run). Refuses anything ambiguous rather than guessing. */
function locateProof(html) {
  const fenceOpen = '/* @generated:PROOF';
  const fenceClose = '/* @end:PROOF */';
  const opens = [...html.matchAll(/\/\* @generated:PROOF/g)];
  const closes = [...html.matchAll(/\/\* @end:PROOF \*\//g)];
  if (opens.length > 1 || closes.length > 1)
    throw new Error('PROOF fence appears more than once — refusing to guess which is live');
  if (opens.length === 1 && closes.length === 1) {
    const s = opens[0].index, e = closes[0].index + fenceClose.length;
    if (e <= s) throw new Error('PROOF fence is inverted or nested');
    /* include the leading indentation of the line the fence opens on */
    const ls = html.lastIndexOf('\n', s) + 1;
    return { start: ls, end: e, indent: s - ls, fenced: true };
  }
  if (opens.length !== closes.length)
    throw new Error('PROOF fence is half-present — one marker without the other');

  const lit = html.indexOf('var PROOF = {');
  if (lit < 0) throw new Error('no PROOF fence and no PROOF literal — nothing to generate into');
  if (html.indexOf('var PROOF = {', lit + 1) >= 0)
    throw new Error('more than one PROOF literal — refusing to guess which is live');
  const end = html.indexOf('};', lit) + 2;
  const ls = html.lastIndexOf('\n', lit) + 1;
  return { start: ls, end, indent: lit - ls, fenced: false };
}

/* ------------------------------------------------------------------
   run
   ------------------------------------------------------------------ */
const checksText = buildChecks();
const html = fs.readFileSync(INDEX, 'utf8');
const loc = locateProof(html);
const proof = buildProofBlock(loc.indent);
const nextHtml = html.slice(0, loc.start) + proof.text + html.slice(loc.end);

if (CHECK_ONLY) {
  const bad = [];
  if (fs.readFileSync(CHECKS, 'utf8') !== checksText)
    bad.push('checks.json differs from what the manifest generates');
  if (html !== nextHtml)
    bad.push('the PROOF region in index.html differs from what the manifest generates');
  if (bad.length) {
    console.error('\n  GENERATED ARTIFACTS ARE STALE\n');
    bad.forEach((b) => console.error('    ' + b));
    console.error('\n  Run: node tools/gen-capabilities.js\n');
    process.exit(1);
  }
  console.log('  generated artifacts match the manifest');
  process.exit(0);
}

fs.writeFileSync(CHECKS, checksText, 'utf8');
fs.writeFileSync(INDEX, nextHtml, 'utf8');
console.log('  checks.json  ' + m.checkers.length + ' checkers');
console.log('  PROOF        ' + proof.keys.length + ' kinds, sha256:' + proof.hash);
