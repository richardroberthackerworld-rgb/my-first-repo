#!/usr/bin/env node
/* ============================================================
   7Solve — MONOTONICITY SOUNDNESS
   ------------------------------------------------------------
   The monotonicity argument lets `roots` certify equations
   polyOf cannot reconstruct: a strictly monotone function
   crosses zero at most once, so one verified root is the whole
   solution set.

   That is a certification path, which means a bug in it is a
   WRONG GREEN BADGE — the worst failure this product has. A
   missing badge disappoints a student; a wrong one lies to them.
   So the prover is checked here four ways, and each one is
   capable of failing on its own:

     1. Every expression it CLAIMS is strictly monotone is
        verified numerically over a dense grid. A claim that
        folds anywhere is a soundness failure.

     2. Every claimed-monotone function is checked for a
        CONNECTED domain. "At most one root" is a claim about a
        single interval — two branches can hide two roots, and
        sampling alone would not show it, because a gap in the
        samples looks like a gap in the domain.

     3. The JS and PHP provers are compared expression by
        expression. index.html decides the badge and verify.php
        decides /v1; a divergence would mean the website and the
        API disagree about what is proved.

     4. The whitelist is asserted against the function table.
        Adding `sin` to MONO_FN is a one-word edit that would
        certify sin(x)=0 as having exactly one root. It must not
        be possible to make that edit quietly.

       node monotone-soundness.js

   Requires php on PATH for part 3.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

/* ---- load the shipping JS engine, exposing only what this suite reads ---- */
const dS = html.indexOf('var Deriv = (function(){'), dE = html.indexOf('\nwindow.Deriv = Deriv;', dS);
const dlS = html.indexOf('function deLatex(md){'), dlE = html.indexOf('\nwindow.deLatex7 = deLatex;', dlS);
const vS = html.indexOf('var Verify = (function(){'), vE = html.indexOf('\n})();', vS);
if (dS < 0 || vS < 0) { console.error('\n  could not locate the engine in index.html\n'); process.exit(1); }

const vsrc = html.slice(vS, vE + 6).replace('  return { run:run,',
  '  return { __mono:monotone, __find:findEquation, __eval:evalAt, run:run,');
if (!/__mono:monotone/.test(vsrc)) {
  console.error('\n  could not reach monotone() — has the Verify export line changed?\n'); process.exit(1);
}
const sb = { window: {}, console: { log() {} }, $: () => null, state: {}, Math, parseFloat,
  parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON };
vm.createContext(sb);
vm.runInContext(html.slice(dS, dE) + '\nwindow.Deriv=Deriv;\n' + html.slice(dlS, dlE) +
  '\nwindow.deLatex7=deLatex;\n' + vsrc + '\nthis.__V=Verify;', sb, { timeout: 20000 });
const V = sb.__V;

const fails = [];

/* ---- the corpus. Deliberately full of things that must be refused. ---- */
const ATOM = ['x', '2*x', '-3*x', 'x^3', 'x^5', 'exp(x)', 'ln(x)', 'sqrt(x)', 'cbrt(x)',
  '2^x', '0.5^x', 'atan(x)', 'x^2', 'abs(x)', 'sin(x)', 'cos(x)', 'tan(x)', '1/x',
  'x*x', 'exp(-x)', '-x', '7', 'pi', 'floor(x)', 'x^4', 'sqrt(x)*x', 'ln(x^3)',
  'exp(x^2)', 'atan(x^3)', '2^(x^2)', 'sqrt(exp(x))', '1/(x-1)', 'x^(-1)', 'x^0.5',
  'ln(x-2)', 'sqrt(x-3)', 'exp(1/x)', 'ln(1/x)', 'round(x)', 'x^6', 'cos(x)*x'];
const OPS = ['+', '-', '*', '/'];
const corpus = [];
const seen = Object.create(null);
const add = (e) => { if (!seen[e]) { seen[e] = 1; corpus.push(e); } };
ATOM.forEach(add);
for (const a of ATOM) for (const b of ATOM) for (const op of OPS) add(a + ' ' + op + ' ' + b);

/* ---- run the JS prover over the corpus ---- */
const jsDir = Object.create(null);
const parsed = [];
for (const e of corpus) {
  const f = V.__find(e + ' = 0');
  if (!f || !f.eq || f.eq.vars.length !== 1) { jsDir[e] = 'noeq'; continue; }
  const v = f.eq.vars[0];
  const d = V.__mono({ t: 'b', op: '-', a: f.eq.L, b: f.eq.R }, v);
  jsDir[e] = (d === null ? null : d);
  parsed.push([e, f, v, d]);
}

/* ---- 1. numeric soundness ---- */
let claimed = 0, unsound = 0;
for (const [e, f, v, d] of parsed) {
  if (d !== 1 && d !== -1) continue;
  claimed++;
  const pts = [];
  for (let t = -40; t <= 40; t += 0.05) {
    const env = {}; env[v] = t;
    const y = V.__eval(f.eq.L, env) - V.__eval(f.eq.R, env);
    if (typeof y === 'number' && isFinite(y)) pts.push([t, y]);
  }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] - pts[i - 1][0] > 0.2) continue;          /* a hole, not a reversal */
    const dy = pts[i][1] - pts[i - 1][1];
    if (Math.abs(dy) < 1e-12) continue;
    if (Math.sign(dy) !== d) {
      unsound++;
      fails.push('claimed strictly ' + (d > 0 ? 'increasing' : 'decreasing') + ' but reverses near x=' +
        pts[i - 1][0].toFixed(2) + ':  ' + e);
      break;
    }
  }
}

/* ---- 2. connected domain ---- */
let split = 0;
for (const [e, f, v, d] of parsed) {
  if (d !== 1 && d !== -1) continue;
  let intervals = 0, inside = false;
  for (let t = -60; t <= 60; t += 0.01) {
    const env = {}; env[v] = t;
    const y = V.__eval(f.eq.L, env) - V.__eval(f.eq.R, env);
    const def = (typeof y === 'number' && isFinite(y));
    if (def && !inside) { intervals++; inside = true; } else if (!def) { inside = false; }
  }
  if (intervals > 1) {
    split++;
    fails.push('claimed monotone but its domain is ' + intervals + ' separate intervals, so two roots ' +
      'could hide in two branches:  ' + e);
  }
}

/* ---- 3. the two engines must agree, expression by expression ---- */
let phpChecked = 0, phpDiff = 0, phpNote = '';
const probe = path.join(HERE, '.monotone-probe.php');
try {
  fs.writeFileSync(probe,
    "<?php\nrequire __DIR__ . '/verify.php';\n" +
    "$in = json_decode(file_get_contents('php://stdin'), true);\n$out = [];\n" +
    "foreach ($in as $e) {\n" +
    "  $f = Checks::findEquation($e . ' = 0');\n" +
    "  if ($f === null || count($f['eq']['vars']) !== 1) { $out[$e] = 'noeq'; continue; }\n" +
    "  $v = $f['eq']['vars'][0];\n" +
    "  $out[$e] = Algebra::monotone(['t'=>'b','op'=>'-','a'=>$f['eq']['L'],'b'=>$f['eq']['R']], $v);\n" +
    "}\necho json_encode($out);\n", 'utf8');
  const r = spawnSync('php', [probe], { input: JSON.stringify(corpus), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) {
    phpNote = 'could not run php (' + ((r.error && r.error.code) || ('exit ' + r.status)) + ')';
  } else {
    const phpDirRaw = JSON.parse(r.stdout);
    for (const e of corpus) {
      const a = jsDir[e], b = (e in phpDirRaw) ? phpDirRaw[e] : 'missing';
      phpChecked++;
      const norm = (x) => (x === null ? 'null' : String(x));
      if (norm(a) !== norm(b)) {
        phpDiff++;
        fails.push('the engines disagree about "' + e + '": index.html says ' + norm(a) +
          ', verify.php says ' + norm(b) + ' — the badge and /v1 would not match');
      }
    }
  }
} finally { try { fs.unlinkSync(probe); } catch (e) { /* nothing to clean */ } }

/* ---- 4. the whitelist must contain nothing that folds ---- */
const FOLDS = ['sin', 'cos', 'tan', 'abs', 'asin', 'acos', 'floor', 'ceil', 'round'];
const jsList = (html.match(/var MONO_FN = \{([^}]*)\}/) || [])[1] || '';
const phpSrc = fs.readFileSync(path.join(HERE, 'verify.php'), 'utf8');
const phpList = (phpSrc.match(/MONO_FN = \[([^\]]*)\]/) || [])[1] || '';
if (!jsList) fails.push('MONO_FN not found in index.html — the whitelist cannot be audited');
if (!phpList) fails.push('MONO_FN not found in verify.php — the whitelist cannot be audited');
for (const f of FOLDS) {
  const re = new RegExp('\\b' + f + '\\b');
  if (re.test(jsList)) fails.push('index.html MONO_FN contains "' + f + '", which is not strictly monotone — ' +
    'this would certify a folding equation as having exactly one root');
  if (re.test(phpList)) fails.push('verify.php MONO_FN contains "' + f + '", which is not strictly monotone');
}
/* and the two whitelists must be the same set */
/* split on anything that is not part of a name — keeping digits, or log10 and
   log2 would both reduce to "log" and the two engines could differ unnoticed */
const setOf = (s) => (s.match(/[a-z][a-z0-9_]*/gi) || []).sort().join(',');
if (jsList && phpList && setOf(jsList) !== setOf(phpList)) {
  fails.push('the whitelists differ — index.html has [' + setOf(jsList) + '] and verify.php has [' +
    setOf(phpList) + ']');
}

/* ---- report ---- */
console.log('');
console.log('  expressions             : ' + corpus.length);
console.log('  refused (cannot tell)   : ' + (parsed.length - claimed) + '  (' +
  (100 * (parsed.length - claimed) / Math.max(1, parsed.length)).toFixed(0) + '% of parseable)');
console.log('  claimed strictly monotone: ' + claimed);
console.log('');
console.log('  1. numeric soundness    : ' + (unsound ? unsound + ' UNSOUND' : 'all claims held'));
console.log('  2. connected domain     : ' + (split ? split + ' SPLIT' : 'all single-interval'));
console.log('  3. JS vs PHP prover     : ' + (phpNote || (phpChecked + ' compared, ' + phpDiff + ' disagree')));
console.log('  4. whitelist            : js[' + setOf(jsList) + ']');
console.log('');

if (phpNote) fails.push(phpNote + ' — the cross-engine comparison did not run, and a silent skip is not a pass');

if (fails.length) {
  console.log('  MONOTONICITY SOUNDNESS FAILED — ' + fails.length + '\n');
  fails.slice(0, 20).forEach((f) => console.log('    ' + f));
  if (fails.length > 20) console.log('    … and ' + (fails.length - 20) + ' more');
  console.log('\n  A bug here is a wrong green badge. Nothing ships until this passes.\n');
  process.exit(1);
}
console.log('  monotonicity is sound in both engines\n');
