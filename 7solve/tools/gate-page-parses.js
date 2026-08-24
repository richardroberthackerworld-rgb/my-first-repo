#!/usr/bin/env node
/* ============================================================
   7Solve — DOES THE PAGE ACTUALLY PARSE?
   ------------------------------------------------------------
   Build 2026-08-24.7 shipped a syntax error and went live with
   verification completely dead. The page rendered, the build
   banner logged, and every question came back with no badge at
   all, because one unterminated comment killed the script block
   that defines Verify:

       SyntaxError: Unexpected identifier 'CORRECTED'

   EVERY SUITE PASSED. adversarial, parity, the negative control
   and thirteen gates all cut the modules they test out of
   index.html — `var Verify = (function(){` … `})();` — and run
   those in a sandbox. The modules were perfect. The file around
   them was not, and nothing was reading the file around them.

   That is the whole gap this closes. It parses every <script>
   block in the shipping page, as a browser would, and asks for
   nothing else. It is the cheapest check here and it is the only
   one that would have caught the worst regression in this
   project's history.

       node tools/gate-page-parses.js

   A syntax error anywhere in index.html fails the build.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

const bad = [];
let blocks = 0, bytes = 0;

/* <script> with no src. A block with src is a file, not inline code. */
const OPEN = /<script(\s[^>]*)?>/gi;
let m;
while ((m = OPEN.exec(html)) !== null) {
  const attrs = m[1] || '';
  if (/\ssrc\s*=/i.test(attrs)) continue;
  if (/\stype\s*=\s*["']?(?!text\/javascript|application\/javascript|module)/i.test(attrs)) continue;
  const start = m.index + m[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) { bad.push('a <script> at offset ' + m.index + ' is never closed'); break; }
  const body = html.slice(start, end);
  blocks++;
  bytes += body.length;
  if (!body.trim()) continue;
  try {
    new vm.Script(body, { filename: 'index.html:script[' + blocks + ']' });
  } catch (e) {
    /* Point at the line IN THE FILE, not in the fragment — a line number the
       reader cannot find is barely better than no line number. */
    const before = html.slice(0, start).split('\n').length;
    const at = (String(e.stack || '').match(/script\[\d+\]:(\d+)/) || [])[1];
    bad.push('script block ' + blocks +
             (at ? ' (index.html line ' + (before + Number(at) - 1) + ')' : '') +
             ': ' + e.message);
  }
  OPEN.lastIndex = end;
}

if (!blocks) bad.push('no inline script blocks found at all — this guard is reading the wrong file');

console.log();
if (bad.length) {
  for (const b of bad) console.log('  ' + b);
  console.log('\n  PAGE PARSE GATE FAILED — index.html would not run in a browser');
  process.exit(1);
}
console.log('  page parse gate OK — ' + blocks + ' inline script blocks, ' +
            Math.round(bytes / 1024) + 'KB, every one parses');
console.log();
