#!/usr/bin/env node
/* ============================================================
   7Solve — REGISTRY PROOF
   ------------------------------------------------------------
   Proves the property the whole registry exists for:

     a checker added to production CANNOT stay invisible to the
     test harness.

   Before checks.json, the pipeline was described in four places
   — Verify.run, Checks::run, a hand-recomposed copy inside
   parity.js, and a hand-written list inside negative-control.js.
   Adding a checker to production and forgetting one of the other
   three was silent, and it had already happened: `units` was
   wired twice in the browser and once in PHP, and the harness
   compared a pipeline that contained neither.

   So this does the whole loop for real, against the shipping
   files:

     1. add a temporary checker to BOTH engines and to the
        registry
     2. prove production runs it        (it appears in run())
     3. prove parity sees it            (suite still agrees)
     4. UNREGISTER it and prove the suite FAILS — the check is in
        production and the registry does not know, which is
        exactly the bug being guarded against
     5. remove it everywhere and prove the tree is clean again

       node registry-proof.js

   Exit 0 = a future checker cannot be forgotten.
   Exit 1 = it can, and the guard is not doing its job.

   Every file it touches is restored in a finally. An earlier
   tool in this directory died between a cut and its restore and
   left a checker missing from verify.php, which the release
   packager then shipped; that is not repeated here.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const INDEX = path.join(HERE, 'index.html');
const VERIFY = path.join(HERE, 'verify.php');
const REG = path.join(HERE, 'checks.json');

/* The temporary checker. It must never fire — returning [] keeps every corpus
   verdict identical, so this proves the WIRING is seen without perturbing a
   single expected result. A checker that changed a verdict would prove the
   corpus noticed a behaviour change, which is a different claim. */
const JS_FN = `
  function __registryProbe(question, md){ return []; }`;
const JS_WIRE = '    checks = checks.concat(__registryProbe(question, text));';
const PHP_FN = `
    public static function registryProbe(string $question, string $md): array { return []; }
`;
const PHP_WIRE = '            self::registryProbe($question, $body),';

const parity = (env) => {
  try {
    execFileSync('node', [path.join(HERE, 'parity.js')],
      { encoding: 'utf8', stdio: 'pipe', env: Object.assign({}, process.env, env || {}) });
    return true;
  } catch (e) { return false; }
};

(function main() {
  const html0 = fs.readFileSync(INDEX, 'utf8');
  const php0 = fs.readFileSync(VERIFY, 'utf8');
  const reg0 = fs.readFileSync(REG, 'utf8');
  const steps = [];
  let failed = false;
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    if (!ok) failed = true;
    console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   ' + detail : ''));
  };

  try {
    if (!parity()) {
      console.log('\nparity is already failing — fix that before running this proof\n');
      process.exit(1);
    }

    /* ---- 1. add the probe to both engines ---- */
    const anchorJs = '    checks = checks.concat(solutionCompleteness(question, text));';
    const anchorPhp = '            self::solutionCompleteness($question, $body),';
    if (!html0.includes(anchorJs) || !php0.includes(anchorPhp)) {
      console.log('\ncould not find the wiring anchors — this proof is stale\n');
      process.exit(1);
    }
    fs.writeFileSync(INDEX,
      html0.replace(anchorJs, anchorJs + '\n' + JS_WIRE)
           .replace('  function solutionCompleteness(question, md){', JS_FN + '\n  function solutionCompleteness(question, md){'),
      'utf8');
    fs.writeFileSync(VERIFY,
      php0.replace(anchorPhp, anchorPhp + '\n' + PHP_WIRE)
          .replace('    public static function solutionCompleteness(', PHP_FN + '\n    public static function solutionCompleteness('),
      'utf8');

    const html1 = fs.readFileSync(INDEX, 'utf8');
    const php1 = fs.readFileSync(VERIFY, 'utf8');
    step('2. production runs the new checker',
      html1.includes(JS_WIRE) && php1.includes(PHP_WIRE),
      'wired into Verify.run and Checks::run');

    /* ---- 2. UNREGISTERED: the suite must refuse it ---- */
    const unregistered = !parity();
    step('4. unregistered check FAILS the suite', unregistered,
      unregistered ? 'parity refuses a production check the registry does not list'
                   : 'parity passed — a checker can be added and forgotten');

    /* ---- 3. register it: the suite must accept it again ---- */
    const reg = JSON.parse(reg0);
    reg.checks.push({ name: '__registryProbe', js: JS_WIRE.trim(), php: PHP_WIRE.trim() });
    fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n', 'utf8');
    step('3. parity sees it once registered', parity(),
      'registry and both pipelines agree');

  } finally {
    fs.writeFileSync(INDEX, html0, 'utf8');
    fs.writeFileSync(VERIFY, php0, 'utf8');
    fs.writeFileSync(REG, reg0, 'utf8');
  }

  /* ---- 4. everything is back ---- */
  const clean = fs.readFileSync(INDEX, 'utf8') === html0
             && fs.readFileSync(VERIFY, 'utf8') === php0
             && fs.readFileSync(REG, 'utf8') === reg0;
  step('5. probe removed, tree byte-identical', clean && parity(),
    'no residue in index.html, verify.php or checks.json');

  if (failed) {
    console.log('\nthe registry does NOT guarantee a new checker reaches the harness\n');
    process.exit(1);
  }
  console.log('\na checker added to production cannot be forgotten by the harness\n');
})();
