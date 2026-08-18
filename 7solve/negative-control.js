#!/usr/bin/env node
/* ============================================================
   7Solve — NEGATIVE CONTROL
   ------------------------------------------------------------
   parity.js answers "does this check work?".
   This answers the harder question: "is it actually WIRED?"

   Those are not the same, and this codebase has already produced
   two checks that were wired and dead — a call to a `validate`
   that did not exist in scope, and a bracketing rewrite that
   never ran because the parse it was meant to rescue always
   succeeded. Both passed their own unit tests. Both did nothing
   in production.

   So for every critical check, this removes it from the
   pipeline, runs the full harness, and DEMANDS a failure. A
   check whose removal changes nothing was never protecting
   anybody.

       node negative-control.js

   Exit 0 = every check is genuinely load-bearing.
   Exit 1 = at least one could be deleted without the suite
            noticing, which means the suite is not testing it.

   Run this whenever the answer pipeline is refactored. That is
   exactly when a checker gets silently unhooked.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.join(__dirname);
const PHP = process.env.PHP_BIN || 'php';
const VERIFY = path.join(HERE, 'verify.php');
const INDEX = path.join(HERE, 'index.html');

/* Each entry names one check and the exact text that wires it into the
   pipeline in each engine. Removing that text must break the harness. */
const WIRED = [
  { name: 'contradiction',
    php: 'self::contradiction($question, $answer)',
    js:  'checks = checks.concat(contradiction(question, text));' },
  { name: 'substitution',
    php: 'self::substitution($question, $body),',
    js:  'checks = checks.concat(substitution(question, text));' },
  { name: 'units',
    php: 'Units::check($question, $body),',
    js:  'checks = checks.concat(units(question, text));' },
  { name: 'integrity',
    php: 'self::integrity($question, $answer),',
    js:  'checks = integrity(question, full).concat(checks);' },
  { name: 'question validity',
    php: 'QuestionCheck::check($question, $body),',
    js:  'checks = questionCheck(question, text).concat(checks);' },
  { name: 'unproved claims',
    php: 'self::unproved($body),',
    js:  'checks = checks.concat(unproved(text));' },
  { name: 'primality',
    php: 'self::primality($body),',
    js:  'checks = checks.concat(primality(text));' },
  { name: 'truncation',
    php: 'self::completeness($answer),',
    js:  'checks = checks.concat(completeness(full));' },
  { name: 'trace',
    php: 'self::trace($question, $body),',
    js:  'checks = checks.concat(trace(question, text));' },
  { name: 'taxonomy',
    php: 'self::taxonomy($body),',
    js:  'checks = checks.concat(taxonomy(text));' },
];

function parityPasses() {
  try {
    execFileSync('node', [path.join(HERE, 'parity.js')],
      { encoding: 'utf8', env: process.env, stdio: 'pipe' });
    return true;
  } catch (e) { return false; }
}

function cut(file, needle) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(needle)) return null;          // wiring text not found at all
  fs.writeFileSync(file, src.replace(needle, ''), 'utf8');
  return src;
}

(function main() {
  if (!parityPasses()) {
    console.log('\nparity is already failing — fix that before running the negative control\n');
    process.exit(1);
  }

  const bad = [];
  console.log('  each check is removed from the pipeline; the harness must then FAIL\n');

  for (const c of WIRED) {
    const phpBefore = fs.readFileSync(VERIFY, 'utf8');
    const jsBefore = fs.readFileSync(INDEX, 'utf8');
    const okPhp = cut(VERIFY, c.php) !== null;
    const okJs = cut(INDEX, c.js) !== null;

    let caught = false, note = '';
    if (!okPhp || !okJs) {
      note = 'wiring text not found (' + (!okPhp ? 'php' : 'js') + ') — this control is stale';
    } else {
      caught = !parityPasses();
      if (!caught) note = 'removing it changed nothing — the harness is not testing this';
    }

    fs.writeFileSync(VERIFY, phpBefore, 'utf8');
    fs.writeFileSync(INDEX, jsBefore, 'utf8');

    console.log('  ' + (caught ? 'PASS  caught  ' : 'FAIL  missed  ') +
                c.name.padEnd(18) + note);
    if (!caught) bad.push(c.name + (note ? ' — ' + note : ''));
  }

  if (!parityPasses()) {
    console.log('\nparity is failing AFTER restore — the files did not come back cleanly\n');
    process.exit(1);
  }

  if (bad.length) {
    console.log('\n' + bad.length + ' check(s) can be deleted without the suite noticing:\n');
    bad.forEach((b) => console.log('  - ' + b));
    console.log('\nThe harness proves those work. It does not prove they run.\n');
    process.exit(1);
  }
  console.log('\nall ' + WIRED.length + ' checks are load-bearing — removing any one breaks the suite\n');
})();
