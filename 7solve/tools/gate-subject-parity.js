#!/usr/bin/env node
/* ============================================================
   7Solve — SUBJECT DETECTION PARITY (JS vs PHP)
   ------------------------------------------------------------
   capability.php and index.html now both decide which subject a
   question belongs to. Two implementations of one rule ladder is
   exactly the shape that produced the .2 bug, so it only stays
   safe while something forces them to agree.

   Both are driven by the SAME generated rules — capability.php
   reads capabilities.json, index.html carries the fenced
   SUBJECT_RULES block generated from it — so a divergence here
   means the two INTERPRETERS disagree, not the data. That is a
   real risk: PHP and JavaScript differ on regex flags, on what
   \b means next to Unicode, and on how a pattern that fails to
   compile behaves.

   The corpus is the frozen one the capability gate already uses,
   so every question here has a recorded .2 answer and the two
   gates cannot drift apart.

       node tools/gate-subject-parity.js

   Exit 0 = the browser and the API name the same subject for
            every question in the corpus.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HERE = path.join(__dirname, '..');
const PHP = process.env.PHP_BIN || 'php';

const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'subject-corpus.json'), 'utf8'));

/* ---- the browser's answer, from the shipping file ---- */
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const s = html.indexOf('/* @generated:SUBJECTS');
const e = html.indexOf('W.subjectOf7 = subjectOf7;');
if (s < 0 || e < 0) {
  console.error('\n  could not find the SUBJECTS block or subjectOf7 in index.html\n');
  process.exit(1);
}
const sb = { window: {}, W: {}, console, String, RegExp, Object, Array, JSON };
vm.createContext(sb);
vm.runInContext(html.slice(s, e) + '\nthis.__f = subjectOf7;\nthis.__rules = SUBJECT_RULES;',
  sb, { timeout: 5000 });
const jsSubject = (q) => { const r = sb.__f(q); return r ? r.id : null; };

/* ---- the API's answer ---- */
const script =
  'require ' + JSON.stringify(path.join(HERE, 'capability.php')) + ';' +
  '$q=json_decode(file_get_contents("php://stdin"),true);$o=[];' +
  'foreach($q as $x)$o[]=Capability::subjectOf($x);echo json_encode($o);';
let phpOut;
try {
  phpOut = JSON.parse(execFileSync(PHP, ['-r', script],
    { input: JSON.stringify(corpus.questions), encoding: 'utf8' }));
} catch (err) {
  console.error('\n  could not run capability.php: ' + String(err.message).slice(0, 200) + '\n');
  process.exit(2);
}

/* ---- compare ---- */
const fails = [];
let agreed = 0;
corpus.questions.forEach((q, i) => {
  const a = jsSubject(q);
  const b = phpOut[i];
  if (a === b) { agreed++; return; }
  fails.push('  ' + JSON.stringify(q.slice(0, 52)) + '\n      JS  ' + String(a) +
             '\n      PHP ' + String(b));
});

/* the rules the browser carries must be the rules the manifest holds */
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'capabilities.json'), 'utf8'));
const wantRules = manifest.subjects.filter((x) => x.match).length;
if (sb.__rules.length !== wantRules) {
  fails.push('  the browser carries ' + sb.__rules.length + ' rules, the manifest has ' +
             wantRules + ' — regenerate with tools/gen-capabilities.js');
}
const coveredInManifest = manifest.subjects
  .filter((x) => x.match && (x.status || 'supported') === 'covered_not_verifiable').length;
const coveredInBrowser = sb.__rules.filter((x) => x.status === 'covered_not_verifiable').length;
if (coveredInManifest !== coveredInBrowser) {
  fails.push('  covered_not_verifiable rules: browser ' + coveredInBrowser +
             ', manifest ' + coveredInManifest);
}

/* THE PROMOTION GUARD.

   The covered_not_verifiable label is applied after the state machine, and the
   only thing stopping it touching a VERIFIED badge is one condition. If that
   condition is ever removed the branch could rewrite "✓ Verified by 7Solve",
   which is the one string in this product that must never be written by
   anything except the state machine reaching `checked`. Asserting the guard
   exists in the shipping source is cheap; discovering its absence from a
   screenshot is not. */
{
  /* Anchor on the BADGE TEXT, not on the first mention of the status: the
     generated SUBJECT_RULES block is full of "covered_not_verifiable" and
     searching backwards from the first hit inspected the wrong code entirely —
     the assertion failed on a clean tree and would have been "fixed" by
     loosening it. */
  const at = html.indexOf('AI answer — not verified');
  if (at < 0) {
    fails.push('  the covered_not_verifiable badge label is not in index.html');
  }
  const branch = at >= 0 ? html.slice(Math.max(0, at - 900), at) : '';
  if (at >= 0 && !/if\s*\(\s*cls\s*!==\s*'verif'\s*\)/.test(branch)) {
    fails.push("  the covered_not_verifiable badge branch is not guarded by cls !== 'verif' — " +
               'it could overwrite the verified badge');
  }
  const bare = (html.match(/cls = 'verif'/g) || []).length;
  if (bare !== 1) {
    fails.push('  index.html has ' + bare + " bare cls = 'verif' assignments, expected exactly 1");
  }
}

console.log('');
console.log('  questions compared : ' + corpus.questions.length);
console.log('  agreed             : ' + agreed);
console.log('  rules in browser   : ' + sb.__rules.length + '  (' + coveredInBrowser + ' covered_not_verifiable)');
console.log('');
if (fails.length) {
  console.log('  SUBJECT PARITY FAILED — ' + fails.length + '\n');
  fails.forEach((f) => console.log(f));
  console.log('');
  process.exit(1);
}
console.log('  subject parity OK — the browser and the API name the same subject every time\n');
