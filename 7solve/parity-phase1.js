#!/usr/bin/env node
/* ============================================================
   7Solve — PHASE 1 JS/PHP PARITY
   ------------------------------------------------------------
   parity.js proves the two engines agree on a shared corpus. This
   proves the specific thing Phase 1 promised: that the checkers
   ported to PHP behave identically to the JavaScript, down to the
   sample points they choose.

   Three layers, in the order a failure would matter:

     1. GOLDEN VECTORS — both engines against sample-vectors.json,
        not against each other, so a shared misreading of the
        algorithm cannot cancel out. Byte equality, not tolerance:
        the points feed a hash, and a hash has no near-misses.

     2. DERIV STRINGS — expr and result are part of the sample
        KEY, so a serialiser that renders "6 x" where the other
        renders "6x" changes the points and can change the verdict
        on an answer both engines agree about. String equality.

     3. CHECKER VERDICTS — the four ported checkers over correct,
        wrong, adversarial, incomplete, malformed, domain-limited
        and AI-prose inputs.

       node parity-phase1.js

   Exit 0 = the API verifies exactly what the website verifies.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const PHP = process.env.PHP_BIN || 'php';

function loadJs() {
  const h = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  const dS = h.indexOf('var Deriv = (function(){'), dE = h.indexOf('\nwindow.Deriv = Deriv;', dS);
  const dlS = h.indexOf('function deLatex(md){'), dlE = h.indexOf('\nwindow.deLatex7 = deLatex;', dlS);
  const vS = h.indexOf('var Verify = (function(){'), vE = h.indexOf('\n})();', vS);
  const sPos = h.indexOf('function sampleSeed(s){');
  if (dS < 0 || vS < 0 || sPos < 0) throw new Error('could not locate the JS modules in index.html');
  const sb = { window: {}, console, $: () => null, state: {}, Math, parseFloat, parseInt,
    isFinite, isNaN, String, Number, Object, Array, RegExp, JSON };
  vm.createContext(sb);
  vm.runInContext(h.slice(dS, dE) + '\nwindow.Deriv=Deriv;\n' + h.slice(dlS, dlE) +
    '\nwindow.deLatex7=deLatex;\n' + h.slice(vS, vE + 6) +
    '\nthis.__V=Verify; this.__D=Deriv;', sb, { timeout: 8000 });
  /* samplePoints lives inside the Verify closure; it is exported for exactly
     this reason — a golden-vector test that re-implements the sampler proves
     nothing about the sampler that ships. */
  return { V: sb.__V, D: sb.__D, P: sb.__V.samplePoints };
}

function php(script, input) {
  const out = execFileSync(PHP, ['-d', 'error_reporting=E_ALL', '-r', script],
    { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1 << 24 });
  const at = out.indexOf('[');
  if (at < 0) throw new Error('PHP produced no JSON:\n' + out.slice(0, 900));
  return JSON.parse(out.slice(at));
}
/* require_once: verify.php now pulls in deriv.php and the Phase 1 checkers
   itself, so a plain require would redeclare the classes. */
const req = (f) => 'require_once ' + JSON.stringify(path.join(HERE, f)) + ';';

/* ---------- the corpus ---------- */
const AI = '\n\n## 🔍 Verification\n✓ Verified. Correct. Confirmed by AI.';
const A = (s) => '## ✅ Answer\n**' + s + '**';
const oldDerivGrid = []; for (let k = 0; k < 8; k++) oldDerivGrid.push((0.83 + k * 1.19).toFixed(2));
const oldIdGrid = []; for (let k = 0; k < 12; k++) oldIdGrid.push((k % 2 ? 1 : -1) * (0.7 + k * 0.61));

const CASES = [
  // correct
  ['correct', 'differentiate 3x² sin x', A('6x sin x + 3x² cos x')],
  ['correct', '∫ x^2 dx', A('x³/3 + C')],
  ['correct', 'Solve x + y = 10 and x - y = 2', A('x = 6, y = 4')],
  ['correct', 'Factorise x^2 - 7x + 12', '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 12'],
  ['correct', 'integrate 5', A('5x + C')],
  ['correct', 'Solve x + y + z = 6, x - y + z = 2, x + y - z = 0', A('x = 1, y = 2, z = 3')],
  // wrong
  ['wrong', 'differentiate 3x² sin x', A('9x sin x + 3x² cos x')],
  ['wrong', '∫ x^2 dx', A('x³ + C')],
  ['wrong', 'Solve x + y = 10 and x - y = 2', A('x = 5, y = 5')],
  ['wrong', 'Factorise x^2 - 7x + 12', '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 99'],
  ['wrong', 'Solve x + y = 10 and x + y = 12', A('x = 6, y = 4')],
  // adversarial — built against the grids that used to be public
  ['adversarial', 'differentiate x^2', A('2x + ' + oldDerivGrid.map((p) => '(x - ' + p + ')').join('*'))],
  ['adversarial', 'Factorise x^2 - 7x + 12',
   '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 12 + ' + oldIdGrid.map((p) => '(x - (' + p + '))').join('*')],
  ['adversarial', 'Solve x + y + x*(x-1)*(x-2)*(x-6) = 10 and x - y = 2', A('x = 6, y = 4')],
  // incomplete / uncertain
  ['incomplete', 'Solve xy = 6 and x + y = 5', A('x = 2, y = 3')],
  ['incomplete', 'Solve x^2 + y^2 = 25 and x + y = 7', A('x = 3, y = 4')],
  ['incomplete', 'Solve x + y = 10 and 2x + 2y = 20', A('x = 6, y = 4')],
  ['incomplete', 'Solve x + y = 10 and x - y = 2', A('x = 6')],
  // unsupported subject for these checkers
  ['unsupported', 'What is photosynthesis?', '## ✅ Answer\nIt converts light into sugar.'],
  ['unsupported', 'Find lim x->0 of sin(x)/x', A('The limit is 1.')],
  ['unsupported', 'Evaluate ∫_0^1 x^2 dx', A('1/3')],
  // malformed
  ['malformed', 'differentiate 3x² sin x', A('the derivative')],
  ['malformed', 'Solve x + = 10 and x - y = 2', A('x = 6, y = 4')],
  ['malformed', '∫ x^2 dx', '## ✅ Answer\nx cubed over three'],
  ['malformed', 'Factorise', '## ✅ Answer\n= = ='],
  // domain restrictions
  ['domain', 'differentiate sqrt(x)', A('1/(2 sqrt(x))')],
  ['domain', 'differentiate ln(x)', A('1/x')],
  ['domain', '∫ 1/x dx', A('ln(x) + C')],
  ['domain', '∫ 1/x dx', A('ln|x| + C')],
  ['domain', '∫ sqrt(x) dx', A('2*x^(3/2)/3 + C')],
  // AI prose must not move any verdict
  ['ai-prose', 'differentiate 3x² sin x', A('9x sin x + 3x² cos x') + AI],
  ['ai-prose', '∫ x^2 dx', A('x³ + C') + AI],
  ['ai-prose', 'Solve x + y = 10 and x - y = 2', A('x = 5, y = 5') + AI],
  ['ai-prose', 'Solve xy = 6 and x + y = 5', A('x = 2, y = 3') + AI],
  ['ai-prose', 'Factorise x^2 - 7x + 12', '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 99' + AI],
];

const DERIV_EXPRS = ['x^2', 'x^3', '2x', '5x^2 + 3x + 7', 'sin(x)', 'cos(x)', 'tan(x)', 'ln(x)',
  'exp(x)', 'sqrt(x)', 'x*sin(x)', 'x^3*sin(x)', 'sin(x^2)', 'exp(x^2)', 'x^3 sin x', '1/x',
  'x/(x+1)', 'x^2*exp(x)', 'sqrt(x^2+1)', 'x*ln(x)', '-x^2', '0.5*x^2', 'x^x', 'x*y', 'floor(x)'];

(function main() {
  const bad = [];
  const { V, D, P } = loadJs();
  const A_ = V.Algebra;

  /* ---- 1. golden vectors ---- */
  const G = JSON.parse(fs.readFileSync(path.join(HERE, 'sample-vectors.json'), 'utf8'));
  const keys = G.vectors.map((v) => v.key);
  const pv = php(req('sampling.php') +
    '$in=json_decode(file_get_contents("php://stdin"),true);$o=[];' +
    'foreach($in as $k){ $o[]=["seed"=>sample_seed($k),"points"=>sample_points($k)]; }' +
    'echo json_encode($o);', keys);
  let vecOk = 0;
  G.vectors.forEach((v, i) => {
    const jsPts = P(v.key);
    if (JSON.stringify(jsPts) !== JSON.stringify(v.points))
      bad.push(`golden: the SHIPPED JS no longer reproduces sample-vectors.json for key ${JSON.stringify(v.key.slice(0, 30))} — the sampling contract changed`);
    if (pv[i].seed !== v.seed)
      bad.push(`golden: PHP seed ${pv[i].seed} != ${v.seed} for key ${JSON.stringify(v.key.slice(0, 30))}`);
    for (let j = 0; j < v.points.length; j++) {
      if (pv[i].points[j] !== v.points[j]) {
        bad.push(`golden: PHP point ${j} differs for key ${JSON.stringify(v.key.slice(0, 30))} — js ${v.points[j]} php ${pv[i].points[j]}`);
        break;
      }
    }
    vecOk++;
  });

  /* ---- 2. Deriv string equality (the sample key depends on it) ---- */
  const dphp = php(req('verify.php') + req('deriv.php') +
    '$in=json_decode(file_get_contents("php://stdin"),true);$o=[];' +
    'foreach($in as $e){ $r=Deriv::of($e,null); $o[]= $r===null?"NULL":implode("|",[$r["expr"],$r["result"],implode("+",$r["rules"]),$r["variable"]]); }' +
    'echo json_encode($o);', DERIV_EXPRS);
  DERIV_EXPRS.forEach((e, i) => {
    let r = null;
    try { r = D.of(A_, e, null); } catch (x) { r = null; }
    const js = r ? [r.expr, r.result, r.rules.join('+'), r.variable].join('|') : 'NULL';
    if (js !== dphp[i]) {
      bad.push(`deriv string: ${e}\n            js  ${js}\n            php ${dphp[i]}` +
               '\n            (expr and result feed the sample key — a different string is different points)');
    }
  });

  /* ---- 3. checker verdicts ---- */
  const cphp = php(req('verify.php') + req('checkers-phase1.php') + req('calculus-phase1.php') +
    '$in=json_decode(file_get_contents("php://stdin"),true);$o=[];' +
    'foreach($in as $c){ $all=array_merge(' +
    'Phase1::systemCheck($c[0],$c[1]), Phase1::identityCheck($c[1]),' +
    'Phase1Calculus::derivativeCheck($c[0],$c[1]), Phase1Calculus::integralCheck($c[0],$c[1]));' +
    '$k=[]; foreach($all as $x) $k[]=$x["kind"].":".($x["ok"]?"ok":(isset($x["soft"])&&$x["soft"]?"soft":"fail"));' +
    'sort($k); $o[]=count($k)?implode(",",$k):"-"; }' +
    'echo json_encode($o);', CASES.map((c) => [c[1], c[2]]));
  const tally = {};
  CASES.forEach(([group, q, md], i) => {
    const all = [].concat(V.systemCheck(q, md) || [], V.identityCheck(md) || [],
      V.derivativeCheck(q, md) || [], V.integralCheck(q, md) || []);
    const js = all.map((c) => c.kind + ':' + (c.ok ? 'ok' : (c.soft ? 'soft' : 'fail'))).sort().join(',') || '-';
    tally[group] = tally[group] || { n: 0, bad: 0 };
    tally[group].n++;
    if (js !== cphp[i]) {
      tally[group].bad++;
      bad.push(`verdict [${group}] ${JSON.stringify(q.slice(0, 54))}\n            js  ${js}\n            php ${cphp[i]}`);
    }
  });

  const total = G.vectors.length + DERIV_EXPRS.length + CASES.length;
  console.log('  golden vectors : ' + vecOk + '   (' + (vecOk * 16) + ' points, byte equality)');
  console.log('  deriv strings  : ' + DERIV_EXPRS.length);
  console.log('  checker cases  : ' + CASES.length);
  for (const g of Object.keys(tally).sort())
    console.log('      ' + g.padEnd(13) + tally[g].n + ' cases, ' + tally[g].bad + ' differing');

  if (bad.length) {
    console.log('\nPHASE 1 PARITY FAILED — ' + bad.length + ' of ' + total + '\n');
    bad.slice(0, 25).forEach((b) => console.log('  ' + b));
    if (bad.length > 25) console.log('  …and ' + (bad.length - 25) + ' more');
    console.log('\nThe API must verify exactly what the website verifies.\n');
    process.exit(1);
  }
  console.log('\nphase 1 parity OK — ' + total + ' checks, JS and PHP agree on every one\n');
})();
