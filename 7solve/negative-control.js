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
/* Survives a kill; `finally` does not. See the pre-flight below. */
const RESTORE = path.join(HERE, '.negative-control-restore.json');

/* The checks to remove come from checks.json — the canonical registry, which
   parity.js also holds to both shipped pipelines. That is what makes coverage
   automatic rather than remembered: registering a checker is what puts it
   under negative control, and parity fails until a checker wired into
   production is registered. This list used to be maintained here by hand, one
   more place to forget.

   Not every registered check can be PROVEN load-bearing — a checker whose
   kinds the corpus never exercises will not break anything when removed. Those
   are reported as uncovered rather than passed, because "removing it changed
   nothing" is exactly what a dead check looks like. */
const WIRED = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'checks.json'), 'utf8')
).checks.map((c) => ({ name: c.name, js: c.js, php: c.php }));



function parityPasses() {
  try {
    execFileSync('node', [path.join(HERE, 'parity.js')],
      { encoding: 'utf8', stdio: 'pipe',
        /* registry conformance OFF: we are cutting a wiring line deliberately,
           and that check would fail for that reason alone, making every check
           look load-bearing. Caught here must mean the CORPUS noticed. */
        env: Object.assign({}, process.env, { PARITY_NO_REGISTRY: '1' }) });
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
  /* Pre-flight 0: did an earlier run get KILLED mid-cut? Its sidecar is then
     still on disk with the originals in it. Put them back before doing
     anything else, and say so loudly — a silently repaired tree teaches nobody
     that this tool needs watching. */
  if (fs.existsSync(RESTORE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(RESTORE, 'utf8'));
      const hurtPhp = fs.readFileSync(VERIFY, 'utf8') !== saved.verify;
      const hurtJs = fs.readFileSync(INDEX, 'utf8') !== saved.index;
      if (hurtPhp) fs.writeFileSync(VERIFY, saved.verify, 'utf8');
      if (hurtJs) fs.writeFileSync(INDEX, saved.index, 'utf8');
      fs.unlinkSync(RESTORE);
      if (hurtPhp || hurtJs) {
        console.log('\n  RECOVERED: a previous run was killed mid-cut and left ' +
          [hurtPhp ? 'verify.php' : null, hurtJs ? 'index.html' : null].filter(Boolean).join(' and ') +
          ' damaged.\n  The originals have been restored from the sidecar. Check `git diff` before ' +
          'trusting anything built since.\n');
      }
    } catch (e) {
      console.log('\n  A restore sidecar exists but could not be read: ' + e.message);
      console.log('  Refusing to cut anything into a tree of unknown state.\n');
      process.exit(1);
    }
  }

  /* Pre-flight: is every checker still wired BEFORE we start cutting? An
     interrupted earlier run can leave one removed, and then "parity is
     failing" is a true but useless message — it does not say that a checker
     is missing from a shipping file. Name it. */
  const missing = [];
  const phpNow = fs.readFileSync(VERIFY, 'utf8');
  const jsNow = fs.readFileSync(INDEX, 'utf8');
  for (const c of WIRED) {
    if (c.php !== null && !phpNow.includes(c.php)) missing.push(c.name + ' (verify.php)');
    if (!jsNow.includes(c.js)) missing.push(c.name + ' (index.html)');
  }
  if (missing.length) {
    console.log('\nWIRING MISSING — these checks are not in the pipeline right now:\n');
    missing.forEach((m) => console.log('  - ' + m));
    console.log('\nMost likely an earlier run of this tool was interrupted mid-cut.' +
                '\nRestore them (git diff will show the hole) before shipping anything.\n');
    process.exit(1);
  }

  if (!parityPasses()) {
    console.log('\nparity is already failing — fix that before running the negative control\n');
    process.exit(1);
  }

  const bad = [];
  console.log('  each check is removed from the pipeline; the harness must then FAIL\n');

  for (const c of WIRED) {
    const phpBefore = fs.readFileSync(VERIFY, 'utf8');
    const jsBefore = fs.readFileSync(INDEX, 'utf8');

    /* A SIDECAR, because `finally` does not run when the process is KILLED.
       The pre-flight above catches a tree that was already damaged and the
       finally below catches a thrown error, but neither survives the run being
       killed outright — and that has now happened twice, once leaving
       `function presentation(md){` cut out of index.html and once
       `function integrity(question, md){`. Both were noticed only because a
       parse check happened to run afterwards.

       So the originals go to disk BEFORE the cut, and the next run puts them
       back and says so, whatever killed this one. */
    fs.writeFileSync(RESTORE, JSON.stringify({ verify: phpBefore, index: jsBefore }), 'utf8');

    /* The restore MUST be unconditional. This tool deletes a checker from a
       production file and puts it back a moment later; when a run died between
       those two moments it left `self::taxonomy($body),` cut out of verify.php,
       and the next thing to touch the tree was the release packager. A test
       that silently disables a safety check is worse than no test. Anything
       that can throw belongs inside the try, and only the reporting after it. */
    let caught = false, note = '';
    try {
      const okPhp = c.php === null ? true : cut(VERIFY, c.php) !== null;
      const okJs = cut(INDEX, c.js) !== null;
      if (!okPhp || !okJs) {
        note = 'wiring text not found (' + (!okPhp ? 'php' : 'js') + ') — this control is stale';
      } else {
        caught = !parityPasses();
        if (!caught) note = 'removing it changed nothing — the harness is not testing this';
      }
    } finally {
      fs.writeFileSync(VERIFY, phpBefore, 'utf8');
      fs.writeFileSync(INDEX, jsBefore, 'utf8');
      try { fs.unlinkSync(RESTORE); } catch (e) { /* already gone */ }
    }

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
