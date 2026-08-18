#!/usr/bin/env node
/* ============================================================
   7Solve — VERIFIER PARITY TEST
   ------------------------------------------------------------
   The verification engine exists twice: as JavaScript inside
   index.html (what the website runs) and as PHP in verify.php
   (what /v1/solve runs). Two copies of a rule drift. When THIS
   checker drifts, the failure is not a crash — it is the API
   calling an answer verified while the site calls the same
   answer disputed, which is worse than either being wrong,
   because a customer cannot tell which one to believe.

   This script is the thing that stops that. It drives BOTH
   engines over one shared corpus and fails loudly on any
   disagreement. Run it before every deploy:

       node parity.js

   Exit code 0 = the two engines agree. Non-zero = they do not,
   and the offending cases are printed with both verdicts.

   It reads the JS straight out of index.html rather than a
   copy, so it always tests what actually ships.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vm = require('vm');

const HERE = __dirname;
const PHP = process.env.PHP_BIN || 'php';

/* ---------- the corpus ----------
   Grouped by what each case is defending. Anything that has ever been a
   real bug in this engine belongs here permanently — that is what stops it
   coming back in one language while staying fixed in the other. */
const EXPRS = [
  // plain arithmetic and precedence
  '2+3*4', '(2+3)*4', '2^3^2', '-2^2', '10/4', '7-3-2', '2*(3+4)/7',
  // implicit multiplication — the rule that makes "3xy" mean 3·x·y
  '3xy', '2x', 'x y', '2(3)', '(x+1)(x-1)', '3x^2',
  // unary and nesting
  '--3', '-(-3)', '-x', '2*-3',
  // surds — the exact-form answers that used to fail to parse entirely
  'sqrt(9)', '√9', '30√7', '82-30√7', '√25200', '2√3/3', '(594+22√3)/9',
  // superscripts and unicode operators
  'x²+y²', '3²', '5−2', '6×7', '8÷2',
  // named functions and constants
  'abs(-5)', 'floor(2.7)', 'ceil(2.1)', 'round(2.5)', 'exp(0)', 'ln(1)',
  'log(100)', 'log2(8)', 'cbrt(27)', 'cbrt(-8)', 'pi', 'e',
  // domain edges that must agree on NaN rather than differ
  'sqrt(-1)', 'ln(0)', 'ln(-1)', 'log(0)', '1/0', '0/0', 'asin(2)', 'acos(-3)',
  // things the tokeniser must REFUSE (null on both sides)
  'x2', '2..3', 'foo$bar', '', '   ', '2+', '(2+3', '2+3)', 'sqrt', 'sqrt 9',
];

const ENVS = [
  {}, { x: 2 }, { x: 2, y: 3 }, { x: 5, y: 3 }, { x: -1, y: 0.5 },
  { x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 5 },
];

const EQUATIONS = [
  ['x^2+y^2+1=3xy', [{ x: 5, y: 3 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 13, y: 5 }]],
  ['x^2-4=0', [{ x: 2 }, { x: -2 }, { x: 3 }]],
  ['x+y=10', [{ x: 4, y: 6 }, { x: 4, y: 7 }]],
  ['(x-3)(x-4)=0', [{ x: 3 }, { x: 4 }, { x: 5 }]],
  ['x^2+4x+6=0', [{ x: -2 }, { x: 0 }]],
  ['4/36=1/9', [{}]],
  ['4/36=1/8', [{}]],
  ['a=b=c', [{ a: 1, b: 1, c: 1 }]],          // must refuse: two '='
  ['sqrt(x)=3', [{ x: 9 }, { x: 4 }]],
  ['x^3-9x^2+24x=20', [{ x: 2 }, { x: 5 }, { x: 4 }]],
  /* NEAR MISSES — these exist to pin the TOLERANCE, not the algebra.
     holdsAt accepts a relative error of 1e-9. Loosening that constant in one
     file and not the other is a silent, plausible edit, and without a case
     landing between the old and new threshold the harness sails straight
     past it. Each binding below is deliberately wrong by a margin that a
     sloppier tolerance would forgive. */
  ['x^2=2', [{ x: 1.4142135623730951 }, { x: 1.41421356 }, { x: 1.4142 }, { x: 1.414 }]],
  ['x=1', [{ x: 1 }, { x: 1.0000000001 }, { x: 1.000001 }, { x: 1.001 }]],
  ['x*y=1', [{ x: 3, y: 0.3333333333333333 }, { x: 3, y: 0.333333 }, { x: 3, y: 0.333 }]],
];

/* End-to-end verdicts, not just arithmetic. This second corpus exists because
   the first one did not save us: Algebra agreed perfectly in both engines
   while `substitution` disagreed completely, because only the PHP side
   deLatexed the question. "x^{2}+y^{2}+1=3xy" then had its squares dropped by
   findEquation — EQ_CHARS has no braces — and a CORRECT answer was reported
   as disputed on production.

   A harness that only checks the layer underneath the bug is a harness that
   passes while the product is broken. Every case here is a full
   question-and-answer pair judged the way a student's answer is judged. */
const VERDICTS = [
  ['x^2+y^2+1=3xy',        '## ✅ Answer\nThe smallest solution is (5,3).'],
  ['x^2+y^2+1=3xy',        '## ✅ Answer\nThe smallest solution is (1,1).'],
  ['x^{2}+y^{2}+1=3xy',    '## ✅ Answer\nThe smallest solution is (5,3).'],
  ['x^{2}+y^{2}+1=3xy',    '## ✅ Answer\nThe smallest solution is (1,1).'],
  ['\\[ x^{2} - 4 = 0 \\]', '## ✅ Answer\nx = 2 and x = -2'],
  ['Solve x^2-4=0',        '## ✅ Answer\nx = 2 and x = -2'],
  ['Solve x^2-4=0',        '## ✅ Answer\nx = 2 and x = 3'],
  ['Solve x^2-4=0',        '## ✅ Answer\nx = 2, -2'],
  ['Solve x^2+4x+6=0',     '## ✅ Answer\nx = -2'],
  ['Solve x^2+4x+6=0',     '## ✅ Answer\nx = -2 ± i√2'],
  ['Solve x^2-164x+424=0', '## ✅ Answer\nx = 82 ± 30√7'],
  ['Solve x^2-164x+424=0', '## ✅ Answer\nx = 88 - 30√7'],
  ['Solve x^2-164x+424=0', '## ✅ Answer\nx = 82 - 30√7 (x = 82 + 30√7 is extraneous)'],
  ['What is photosynthesis?', '## ✅ Answer\nIt converts light into sugar.'],
  ['Simplify 2/3 + 1/3',   '## ✅ Answer\n2/3 + 1/3 = 1'],
  ['Simplify 2/3 + 1/3',   '## ✅ Answer\n2/3 + 1/3 = 2'],
  ['Find P',               '## ✅ Answer\nP = 4/36 = 1/9'],
  ['Find P',               '## ✅ Answer\nP = 4/36 = 1/8'],
  ['Simplify',             '## ✅ Answer\n2√3/3 + 1/3 = 13/3'],
];

/* ---------- side A: the JavaScript that actually ships ---------- */
function loadJs() {
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

  /* deLatex lives in an earlier script block than Verify and is reached
     through window.deLatex7 at runtime. Pull it in the same way, or the
     sandbox silently tests a build that cannot strip LaTeX — which is exactly
     the divergence this corpus is here to catch. */
  const dlStart = html.indexOf('function deLatex(md){');
  const dlEnd = html.indexOf('\nwindow.deLatex7 = deLatex;', dlStart);
  if (dlStart < 0 || dlEnd < 0) throw new Error('could not find deLatex in index.html');
  const dlSrc = html.slice(dlStart, dlEnd);

  const start = html.indexOf('var Verify = (function(){');
  if (start < 0) throw new Error('could not find the Verify module in index.html');
  const endMark = '\n})();';
  const end = html.indexOf(endMark, start);
  if (end < 0) throw new Error('could not find the end of the Verify module');
  const src = html.slice(start, end + endMark.length);

  const sandbox = {
    window: {}, document: undefined, console,
    W: {}, $: () => null, state: {},
    Math, parseFloat, parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    dlSrc + '\nwindow.deLatex7 = deLatex;\n' + src +
    '\nthis.__A = Verify.Algebra; this.__V = Verify;',
    sandbox, { timeout: 5000 });
  if (!sandbox.__A) throw new Error('Verify.Algebra was not exported');
  if (typeof sandbox.window.deLatex7 !== 'function') throw new Error('deLatex7 did not attach');
  return { A: sandbox.__A, V: sandbox.__V };
}

/* The same collapse from checks to a state that Checks::run performs. Kept
   here rather than read off the page so the two sides are compared on the
   rule, not on one side's implementation of it. */
function verdictOf(checks) {
  const failed = checks.filter((c) => !c.ok);
  const passed = checks.filter((c) => c.ok);
  if (failed.some((c) => c.kind === 'subst')) return 'disputed';
  if (failed.length) return 'stepfail';
  if (passed.length) return 'checked';
  return 'unverified';
}

/* ---------- side B: the PHP that /v1/solve will run ---------- */
function runPhp(payload) {
  const inFile = path.join(HERE, '.parity-in.json');
  fs.writeFileSync(inFile, JSON.stringify(payload), 'utf8');
  const script = `
    require ${JSON.stringify(path.join(HERE, 'verify.php'))};
    $in = json_decode(file_get_contents(${JSON.stringify(inFile)}), true);
    $out = ['eval' => [], 'holds' => [], 'vars' => [], 'verdicts' => []];
    foreach ($in['eval'] as $c) {
        $ast = Algebra::parse($c['src']);
        if ($ast === null) { $out['eval'][] = null; continue; }
        $v = Algebra::evalAt($ast, $c['env']);
        $out['eval'][] = is_finite($v) ? round($v, 9) : 'NaN';
    }
    foreach ($in['holds'] as $c) {
        $eq = Algebra::parseEquation($c['src']);
        if ($eq === null) { $out['holds'][] = 'REFUSED'; continue; }
        $r = Algebra::holdsAt($eq, $c['env']);
        $out['holds'][] = $r === null ? 'NOVERDICT' : ($r ? 'TRUE' : 'FALSE');
    }
    foreach ($in['vars'] as $src) {
        $eq = Algebra::parseEquation($src);
        $out['vars'][] = $eq === null ? null : $eq['vars'];
    }
    foreach ($in['verdicts'] as $c) {
        $r = Checks::run($c['q'], $c['a']);
        $out['verdicts'][] = ['state' => $r['state'], 'n' => $r['checked']];
    }
    echo json_encode($out);
  `;
  try {
    const raw = execFileSync(PHP, ['-d', 'error_reporting=E_ALL', '-r', script], {
      encoding: 'utf8', maxBuffer: 1 << 24,
    });
    return JSON.parse(raw);
  } finally {
    try { fs.unlinkSync(inFile); } catch (_) { /* best effort */ }
  }
}

/* ---------- compare ---------- */
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : 'NaN';
  return v;
}

(function main() {
  const { A, V } = loadJs();

  const evalCases = [];
  for (const src of EXPRS) for (const env of ENVS) evalCases.push({ src, env });

  const holdCases = [];
  for (const [src, envs] of EQUATIONS) for (const env of envs) holdCases.push({ src, env });

  const varCases = EQUATIONS.map(([src]) => src);

  const verdictCases = VERDICTS.map(([q, a]) => ({ q, a }));

  const php = runPhp({ eval: evalCases, holds: holdCases, vars: varCases, verdicts: verdictCases });

  const bad = [];

  evalCases.forEach((c, i) => {
    const ast = A.parse(c.src);
    const js = ast === null ? null : norm(A.evalAt(ast, c.env));
    const ph = norm(php.eval[i]);
    if (JSON.stringify(js) !== JSON.stringify(ph)) {
      bad.push(`eval   ${JSON.stringify(c.src)} @ ${JSON.stringify(c.env)}  js=${JSON.stringify(js)}  php=${JSON.stringify(ph)}`);
    }
  });

  holdCases.forEach((c, i) => {
    const eq = A.parseEquation(c.src);
    let js;
    if (!eq) js = 'REFUSED';
    else { const r = A.holdsAt(eq, c.env); js = r === null ? 'NOVERDICT' : (r ? 'TRUE' : 'FALSE'); }
    if (js !== php.holds[i]) {
      bad.push(`holds  ${JSON.stringify(c.src)} @ ${JSON.stringify(c.env)}  js=${js}  php=${php.holds[i]}`);
    }
  });

  varCases.forEach((src, i) => {
    const eq = A.parseEquation(src);
    const js = eq ? eq.vars : null;
    const ph = php.vars[i];
    if (JSON.stringify(js) !== JSON.stringify(ph)) {
      bad.push(`vars   ${JSON.stringify(src)}  js=${JSON.stringify(js)}  php=${JSON.stringify(ph)}`);
    }
  });

  /* The layer the first corpus could not see. */
  verdictCases.forEach((c, i) => {
    const checks = [].concat(V.substitution(c.q, c.a) || [], V.arithmetic(c.a) || []);
    const js = { state: verdictOf(checks), n: checks.length };
    const ph = php.verdicts[i];
    if (js.state !== ph.state || js.n !== ph.n) {
      bad.push('verdict ' + JSON.stringify(c.q) +
               '\n            answer ' + JSON.stringify(c.a.replace(/\n/g, ' ')) +
               '\n            js=' + js.state + '(' + js.n + ' checks)' +
               '  php=' + ph.state + '(' + ph.n + ' checks)');
    }
  });

  const total = evalCases.length + holdCases.length + varCases.length + verdictCases.length;
  if (bad.length) {
    console.log(`\nPARITY FAILED — ${bad.length} of ${total} cases disagree\n`);
    bad.slice(0, 40).forEach((b) => console.log('  ' + b));
    if (bad.length > 40) console.log(`  ...and ${bad.length - 40} more`);
    console.log('\nThe two engines must agree before this ships.\n');
    process.exit(1);
  }
  console.log(`parity OK — ${total} cases, JS and PHP agree on every one`);
})();
