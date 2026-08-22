#!/usr/bin/env node
/* ============================================================
   7Solve — RELEASE B SUITE
   ------------------------------------------------------------
   Five confirmed false negatives, plus the photo-question
   provenance cap. Every one of them was REPRODUCED against the
   .2 baseline before a line was changed; the failing forms are
   the ones students are actually taught, which is why they
   mattered.

   Each fix carries three things, and the suite fails if any is
   missing:

     POSITIVE  the correct answer is now certified
     CONTROL   the corresponding WRONG answer is still caught
     PARITY    JS and PHP agree on both

   The CONTROLS are the point. Every change here widens what the
   engine will look at, and widening what a verifier accepts is
   exactly how a wrong answer starts passing. A positive without
   its control is not a fix, it is a liability, so `node
   parity-release-b.js` refuses to report success unless every
   positive has one.

       node parity-release-b.js
       node parity-release-b.js --js-only

   Exit 0 = every gap closed and every forgery still refused.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const PHP = process.env.PHP_BIN || 'php';
const JS_ONLY = process.argv.indexOf('--js-only') >= 0;

/* ---------- load the shipping JS engine ---------- */
function loadJs() {
  const h = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  const dS = h.indexOf('var Deriv = (function(){'), dE = h.indexOf('\nwindow.Deriv = Deriv;', dS);
  const dlS = h.indexOf('function deLatex(md){'), dlE = h.indexOf('\nwindow.deLatex7 = deLatex;', dlS);
  const vS = h.indexOf('var Verify = (function(){'), vE = h.indexOf('\n})();', vS);
  const pS = h.indexOf('var Prov = (function(){'), pE = h.indexOf('window.Prov7 = Prov;', pS);
  if (dS < 0 || vS < 0 || pS < 0) throw new Error('could not locate the engine in index.html');
  const sb = { window: {}, console: { log() {} }, $: () => null, state: {}, Math, parseFloat,
               parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON };
  vm.createContext(sb);
  vm.runInContext(
    h.slice(dS, dE) + '\nwindow.Deriv=Deriv;\n' +
    h.slice(dlS, dlE) + '\nwindow.deLatex7=deLatex;\n' +
    h.slice(vS, vE + 6) + '\nthis.__V=Verify;\n' +
    h.slice(pS, pE) + '\nthis.__P=Prov;', sb, { timeout: 10000 });
  return { V: sb.__V, P: sb.__P };
}

/* ---------- the PHP engine, one process for the whole corpus ---------- */
function runPhp(cases) {
  const script =
    'require ' + JSON.stringify(path.join(HERE, 'verify.php')) + ';' +
    'require ' + JSON.stringify(path.join(HERE, 'provenance.php')) + ';' +
    '$in=json_decode(file_get_contents("php://stdin"),true);$o=[];' +
    'foreach($in as $c){' +
    '  $r=Checks::run($c["q"],$c["a"]);' +
    '  $s=$r["state"];' +
    '  if(isset($c["prov"])){$p=Provenance::of($c["prov"]);$s=Provenance::cap($s,$p);}' +
    '  $sig=[];foreach($r["checks"] as $k)$sig[]=$k["kind"].($k["ok"]?"+":"-");' +
    '  sort($sig);$o[]=["state"=>$s,"sig"=>implode(",",$sig)];' +
    '}echo json_encode($o);';
  const out = execFileSync(PHP, ['-r', script],
    { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}

const A = (s) => '## ✅ Answer\n**' + s + '**';
const BARE = (s) => '## ✅ Answer\n' + s;
const PROSE = '\n\n## 🔍 Verification\n✓ Verified. This is definitively correct.';

/* Canonical classes — the same map parity.js uses. PHP collapses four
   not-verified states into `unverified`; both are canonically unverified. */
const CANON = { checked: 'verified', disputed: 'disputed', stepfail: 'disputed',
  invalid_question: 'disputed', unverified: 'unverified', worked: 'unverified',
  explained: 'unverified', plain: 'unverified', partial: 'unverified' };

/* ------------------------------------------------------------------
   THE CASES.  want: 'verified' | 'disputed' | 'unverified'
   role: 'positive' (the gap being closed) | 'control' (the forgery that
   must still be refused) | 'guard' (a neighbouring form that must not move)
   ------------------------------------------------------------------ */
const C = [];
const add = (fix, role, name, q, a, want, prov) => C.push({ fix, role, name, q, a, want, prov });

/* ---- FIX 1 — bold-wrapped identities -------------------------------
   identityCheck stripped LEADING [*>-] but not trailing, so the app's own
   answer format (** … **) never parsed. The forms below are what the
   product itself emits, which is why this mattered more than it looked. */
{
  const q = 'Factorise x^2 - 7x + 12';
  add(1, 'positive', 'bold identity, correct', q, A('(x - 3)(x - 4) = x^2 - 7x + 12'), 'verified');
  add(1, 'control', 'bold identity, FORGED', q, A('(x - 3)(x - 5) = x^2 - 7x + 12'), 'disputed');
  add(1, 'control', 'bold identity, forged + AI prose', q,
      A('(x - 3)(x - 5) = x^2 - 7x + 12') + PROSE, 'disputed');
  add(1, 'positive', 'bold identity, reversed sides', q, A('x^2 - 7x + 12 = (x - 3)(x - 4)'), 'verified');
  add(1, 'control', 'bold identity, reversed FORGED', q, A('x^2 - 7x + 12 = (x - 3)(x - 5)'), 'disputed');
  add(1, 'positive', 'underscore-bold identity', q, BARE('__(x - 3)(x - 4) = x^2 - 7x + 12__'), 'verified');
  add(1, 'control', 'underscore-bold FORGED', q, BARE('__(x - 3)(x - 5) = x^2 - 7x + 12__'), 'disputed');
  add(1, 'guard', 'unbolded identity still works', q, BARE('(x - 3)(x - 4) = x^2 - 7x + 12'), 'verified');
  add(1, 'guard', 'unbolded forgery still caught', q, BARE('(x - 3)(x - 5) = x^2 - 7x + 12'), 'disputed');
  const qe = 'Expand (x+2)(x+3)';
  add(1, 'positive', 'bold expansion, correct', qe, A('(x+2)(x+3) = x^2 + 5x + 6'), 'verified');
  add(1, 'control', 'bold expansion, FORGED', qe, A('(x+2)(x+3) = x^2 + 6x + 6'), 'disputed');
}

/* ---- FIX 2 — polynomial degree cap ---------------------------------
   polyOf capped at MAXD = 6, so a degree-8 factored product reconstructed
   as nothing and completeness could not run. */
{
  const q8 = 'Solve (x-1)(x-2)(x-3)(x-4)(x-5)(x-6)(x-7)(x-8) = 0';
  add(2, 'positive', 'degree 8, all roots', q8, A('x = 1, 2, 3, 4, 5, 6, 7, 8'), 'verified');
  add(2, 'control', 'degree 8, seven of eight', q8, A('x = 1, 2, 3, 4, 5, 6, 7'), 'disputed');
  add(2, 'control', 'degree 8, one root wrong', q8, A('x = 1, 2, 3, 4, 5, 6, 7, 9'), 'disputed');
  add(2, 'control', 'degree 8, subset + AI prose', q8, A('x = 1, 2, 3, 4') + PROSE, 'disputed');
  const q7 = 'Solve (x-1)(x-2)(x-3)(x-4)(x-5)(x-6)(x-7) = 0';
  add(2, 'positive', 'degree 7, all roots', q7, A('x = 1, 2, 3, 4, 5, 6, 7'), 'verified');
  add(2, 'control', 'degree 7, missing one', q7, A('x = 1, 2, 3, 4, 5, 6'), 'disputed');
  add(2, 'guard', 'degree 3 unchanged', 'Solve x^3-6x^2+11x-6 = 0', A('x = 1, x = 2, x = 3'), 'verified');
  add(2, 'guard', 'degree 3 incomplete still caught', 'Solve x^3-6x^2+11x-6 = 0', A('x = 1, x = 2'), 'disputed');
  add(2, 'guard', 'quadratic unchanged', 'Solve x^2 - 5x + 6 = 0', A('x = 2, x = 3'), 'verified');
}

/* ---- FIX 3 — textbook algebra forms --------------------------------
   ln|x| failed on the absolute-value bars; x^(3/2) failed on a
   parenthesised rational exponent; log and e^x were unsupported. In every
   case the form that failed is the one a textbook prints. */
{
  add(3, 'positive', 'integral 1/x -> ln|x|', 'Integrate 1/x', A('ln|x| + C'), 'verified');
  add(3, 'control', 'integral 1/x -> WRONG', 'Integrate 1/x', A('1/x^2 + C'), 'disputed');
  /* ln|2x| is CORRECT: ln(2x) = ln2 + ln|x|, and the constant is absorbed
     into C. This started life as a negative control on the assumption it was
     a forgery; the engine certified it and the engine was right. Kept as a
     positive precisely because it is the kind of answer a marker would
     wrongly reject — the family, not the representative, is the antiderivative. */
  add(3, 'positive', 'integral 1/x -> ln|2x| (also correct)', 'Integrate 1/x', A('ln|2x| + C'), 'verified');
  add(3, 'control', 'integral 1/x -> ln|x^2| (WRONG, gives 2/x)', 'Integrate 1/x', A('ln|x^2| + C'), 'disputed');
  add(3, 'positive', 'integral sqrt(x) -> 2x^(3/2)/3', 'Integrate sqrt(x)', A('2*x^(3/2)/3 + C'), 'verified');
  add(3, 'control', 'integral sqrt(x) -> WRONG coefficient', 'Integrate sqrt(x)', A('3*x^(3/2)/2 + C'), 'disputed');
  add(3, 'positive', 'integral x^(1/2) form', 'Integrate x^(1/2)', A('2*x^(3/2)/3 + C'), 'verified');
  add(3, 'positive', 'derivative of ln(x)', 'Differentiate ln(x)', A('1/x'), 'verified');
  add(3, 'control', 'derivative of ln(x) WRONG', 'Differentiate ln(x)', A('x'), 'disputed');
  add(3, 'positive', 'derivative of e^x', 'Differentiate e^x', A('e^x'), 'verified');
  add(3, 'control', 'derivative of e^x WRONG', 'Differentiate e^x', A('x*e^x'), 'disputed');
  add(3, 'positive', 'integral e^x', 'Integrate e^x', A('e^x + C'), 'verified');
  add(3, 'control', 'integral e^x WRONG', 'Integrate e^x', A('e^x/2 + C'), 'disputed');
  add(3, 'positive', 'derivative of x^(3/2)', 'Differentiate x^(3/2)', A('(3/2)*x^(1/2)'), 'verified');
  add(3, 'control', 'derivative of x^(3/2) WRONG', 'Differentiate x^(3/2)', A('(2/3)*x^(1/2)'), 'disputed');
  add(3, 'guard', 'decimal exponent still works', 'Integrate sqrt(x)', A('(2/3)*x^1.5 + C'), 'verified');
  add(3, 'guard', 'plain polynomial integral unchanged', 'Integrate x^2', A('x^3/3 + C'), 'verified');
  add(3, 'guard', 'plain polynomial integral wrong', 'Integrate x^2', A('x^3 + C'), 'disputed');
}

/* ---- FIX 4 — factorisation-form primality claims -------------------
   The old regex only matched "N is prime/composite" phrasing, so
   "No, 5779 = 7 x 826" — a factorisation CLAIM — reached no checker at
   all. Note 7 x 826 = 5782, so the claim is arithmetically false on its
   own terms, independent of whether 5779 is prime. */
{
  const q = 'Is 5779 prime?';
  add(4, 'positive', 'false factorisation claim caught', q, A('No, 5779 = 7 × 826'), 'disputed');
  add(4, 'positive', 'false factorisation, ASCII x', q, A('No, 5779 = 7 x 826'), 'disputed');
  add(4, 'positive', 'false factorisation, asterisk', q, A('No, 5779 = 7 * 826'), 'disputed');
  add(4, 'control', 'TRUE factorisation must not be disputed', 'Is 5781 prime?',
      A('No, 5781 = 3 × 41 × 47'), 'verified');
  add(4, 'control', 'true two-factor claim', 'Is 91 prime?', A('No, 91 = 7 × 13'), 'verified');
  add(4, 'positive', 'wrong product, true compositeness', 'Is 91 prime?', A('No, 91 = 7 × 14'), 'disputed');
  add(4, 'guard', 'phrasing form still works', 'Is 7 prime?', A('7 is prime'), 'verified');
  add(4, 'guard', 'phrasing form wrong still caught', 'Is 7 prime?', A('7 is not prime'), 'disputed');
  add(4, 'guard', 'ordinary arithmetic not misread as factorisation',
      'What is 2 + 3?', A('2 + 3 = 5'), 'verified');
}

/* ---- FIX 5 — declared numerical precision policy --------------------
   holdsAt applied a universal relative 1e-9 to every substitution, so a
   correct root stated to 3 s.f. was DISPUTED. The replacement is not a
   looser epsilon: a decimal claim denotes an interval, and it is
   certified only if a genuine root is proved to lie inside it. */
{
  /* These are `unverified`, not `verified`, and that is the whole point.

     Before the fix they were DISPUTED — the engine told a student their
     correct three-decimal answer was wrong. Now substitution passes, and the
     answer settles at unverified because COMPLETENESS cannot run: x + eˣ = 0
     is not a polynomial, so the engine cannot enumerate its roots and cannot
     know whether one value is the whole solution set. (It is — 1 + eˣ > 0
     everywhere so the function is strictly increasing — but that is a
     monotonicity argument this engine does not make.)

     Phase 1's evidenceOnly rule then correctly refuses the badge: substituting
     a value proves it is A root, never THE solution set. Certifying here would
     mean weakening that rule, which Release B does not do. Moving a correct
     answer from "you are wrong" to "not checked" is the honest gain. */
  add(5, 'positive', 'transcendental root to 3 s.f. — no longer disputed',
      'Solve x + e^x = 0', A('x = -0.567'), 'unverified');
  add(5, 'positive', 'quintic root to 5 s.f. — no longer disputed',
      'Solve x^5 - x + 1 = 0', A('x = -1.1673'), 'unverified');
  /* BOUNDARY PAIR. -0.567 denotes [-0.5675, -0.5665] and the root
     -0.56714… is inside. -0.568 denotes [-0.5685, -0.5675] and it is not. */
  add(5, 'control', 'boundary: one ulp low is refused', 'Solve x + e^x = 0', A('x = -0.568'), 'disputed');
  add(5, 'control', 'boundary: one ulp high is refused', 'Solve x + e^x = 0', A('x = -0.566'), 'disputed');
  add(5, 'control', 'two ulp out is refused', 'Solve x + e^x = 0', A('x = -0.569'), 'disputed');
  add(5, 'positive', 'coarser precision, honestly stated', 'Solve x + e^x = 0', A('x = -0.57'), 'unverified');
  add(5, 'control', 'coarser precision, wrong', 'Solve x + e^x = 0', A('x = -0.58'), 'disputed');
  add(5, 'control', 'plainly wrong root', 'Solve x + e^x = 0', A('x = 1.5'), 'disputed');
  add(5, 'guard', 'exact integer root unchanged', 'Solve 3x - 6 = 0', A('x = 2'), 'verified');
  add(5, 'guard', 'near-miss integer still refused', 'Solve 3x - 6 = 0', A('x = 2.0001'), 'disputed');
  add(5, 'guard', 'exact rational root unchanged', 'Solve 2x - 3 = 0', A('x = 3/2'), 'verified');
  add(5, 'guard', 'quadratic exact roots unchanged', 'Solve x^2 - 5x + 6 = 0', A('x = 2, x = 3'), 'verified');
  add(5, 'guard', 'quadratic wrong root still caught', 'Solve x^2 - 5x + 6 = 0', A('x = 2, x = 4'), 'disputed');
}

/* ---- FIX 6 — the photo-question provenance cap ---------------------
   A photographed question with no typed text reaches the verifier as a
   placeholder. Most checks then find nothing, but ARITHMETIC reads only
   the answer, so a self-contained correct calculation could be certified
   without the question ever being read. The arithmetic is genuinely
   right; the badge is not earned. The cap declines to certify without
   claiming the answer is wrong. */
{
  const photo = { question: { origin: 'transcribed', confidence: 0 } };
  const good = { question: { origin: 'transcribed', confidence: 1, round_trip: true } };
  add(6, 'positive', 'photo question cannot certify arithmetic', '(photo question)',
      A('2/3 + 1/3 = 1'), 'unverified', photo);
  add(6, 'control', 'photo cap does NOT invent disputed', '(photo question)',
      A('2/3 + 1/3 = 1'), 'unverified', photo);
  add(6, 'control', 'photo question with a WRONG answer stays disputed',
      'Solve 3x - 6 = 0', A('x = 5'), 'disputed', photo);
  add(6, 'positive', 'high-confidence transcription may still certify',
      'Solve 3x - 6 = 0', A('x = 2'), 'verified', good);
  add(6, 'guard', 'typed question unaffected', 'Solve 3x - 6 = 0', A('x = 2'), 'verified',
      { question: { origin: 'typed' } });
  add(6, 'guard', 'no provenance at all unaffected', 'Solve 3x - 6 = 0', A('x = 2'), 'verified');
}

/* ------------------------------------------------------------------ */
const { V, P } = loadJs();

const jsOut = C.map((c) => {
  let r;
  try { r = V.run(c.q, c.a); } catch (e) { return { state: 'THREW', sig: e.message }; }
  let state = r.state;
  if (c.prov) state = P.cap(state, P.of(c.prov));
  const sig = (r.checks || []).map((k) => k.kind + (k.ok === true ? '+' : '-')).sort().join(',');
  return { state, sig };
});

let phpOut = null;
if (!JS_ONLY) {
  try {
    phpOut = runPhp(C.map((c) => ({ q: c.q, a: c.a, prov: c.prov || null })));
  } catch (e) {
    console.error('\n  PHP engine could not be run: ' + String(e.message).slice(0, 300) + '\n');
    process.exit(2);
  }
}

const fails = [];
const byFix = {};
C.forEach((c, i) => {
  const j = jsOut[i];
  const p = phpOut ? phpOut[i] : null;
  const b = (byFix[c.fix] = byFix[c.fix] || { pass: 0, fail: 0, positives: 0, controls: 0 });
  if (c.role === 'positive') b.positives++;
  if (c.role === 'control') b.controls++;

  const jsCanon = CANON[j.state];
  let bad = null;
  if (!jsCanon) bad = 'JS state "' + j.state + '" is not in the canonical map';
  else if (jsCanon !== c.want) bad = 'JS ' + jsCanon + ' (' + j.state + ') expected ' + c.want +
                                     (j.sig ? '  [' + j.sig + ']' : '  [no checks]');
  if (!bad && p) {
    const phpCanon = CANON[p.state];
    if (!phpCanon) bad = 'PHP state "' + p.state + '" is not in the canonical map';
    else if (phpCanon !== jsCanon) bad = 'PARITY: JS ' + jsCanon + ' (' + j.state + ') vs PHP ' +
                                          phpCanon + ' (' + p.state + ')';
    else if (p.sig !== j.sig) bad = 'PARITY: check signatures differ — JS [' + j.sig +
                                     '] vs PHP [' + p.sig + ']';
  }
  if (bad) { b.fail++; fails.push('fix ' + c.fix + '  ' + c.name + ': ' + bad); }
  else b.pass++;
});

console.log('');
console.log('  fix                                        cases  pos  ctrl  result');
const TITLE = { 1: 'bold-wrapped identities', 2: 'polynomial degree cap',
  3: 'textbook algebra forms', 4: 'factorisation-form primality',
  5: 'declared numeric precision', 6: 'photo-question provenance cap' };
let missingControl = 0;
Object.keys(byFix).sort().forEach((k) => {
  const b = byFix[k];
  if (b.controls === 0) missingControl++;
  console.log('  ' + (k + ' ' + TITLE[k]).padEnd(42) +
    String(b.pass + b.fail).padStart(5) + String(b.positives).padStart(5) +
    String(b.controls).padStart(6) + '  ' + (b.fail ? 'FAIL (' + b.fail + ')' : 'pass'));
});

console.log('');
if (missingControl) {
  console.log('  REFUSING TO PASS — ' + missingControl + ' fix(es) have no negative control.');
  console.log('  A positive without a control is not a fix, it is a liability.\n');
  process.exit(1);
}
if (fails.length) {
  console.log('  RELEASE B SUITE FAILED — ' + fails.length + ' of ' + C.length + '\n');
  fails.forEach((f) => console.log('    ' + f));
  console.log('');
  process.exit(1);
}
console.log('  release B OK — ' + C.length + ' cases' + (phpOut ? ', JS and PHP agree on every one' : ' (JS only)'));
console.log('  every gap closed; every forgery still refused\n');
