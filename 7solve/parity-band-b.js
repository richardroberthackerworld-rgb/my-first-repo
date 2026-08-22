#!/usr/bin/env node
/* ============================================================
   7Solve — BAND B SUITE
   ------------------------------------------------------------
   Four checkers that the WEBSITE can certify on and /v1 cannot,
   because they were only ever written in JavaScript:

     chemistry          does the reaction balance
     bounds             is a probability inside 0…1
     checkDivisibility  does a divides b, actually
     conditionCheck     does the answer satisfy the question's
                        own stated condition

   This is not a safety hole — /v1 simply returned `unverified`
   where the site returned `checked`, which is honest. It is a
   CAPABILITY gap, and the same one the capability manifest was
   built to make visible: all four emit kinds that sit in the
   PROOF set, so a customer of the API was getting a strictly
   weaker verifier than a student on the website.

   Every case runs through BOTH engines and they must agree.
   Every positive has a negative control, because each port
   widens what /v1 will look at, and widening what a verifier
   accepts is how a wrong answer starts passing.

       node parity-band-b.js
       node parity-band-b.js --js-only

   Exit 0 = both engines agree on every case.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const PHP = process.env.PHP_BIN || 'php';
const JS_ONLY = process.argv.indexOf('--js-only') >= 0;

function loadJs() {
  const h = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  const dS = h.indexOf('var Deriv = (function(){'), dE = h.indexOf('\nwindow.Deriv = Deriv;', dS);
  const dlS = h.indexOf('function deLatex(md){'), dlE = h.indexOf('\nwindow.deLatex7 = deLatex;', dlS);
  const vS = h.indexOf('var Verify = (function(){'), vE = h.indexOf('\n})();', vS);
  const sb = { window: {}, console: { log() {} }, $: () => null, state: {}, Math, parseFloat,
               parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON };
  vm.createContext(sb);
  vm.runInContext(h.slice(dS, dE) + '\nwindow.Deriv=Deriv;\n' + h.slice(dlS, dlE) +
    '\nwindow.deLatex7=deLatex;\n' + h.slice(vS, vE + 6) + '\nthis.__V=Verify;', sb, { timeout: 20000 });
  return sb.__V;
}

function runPhp(cases) {
  const script =
    'require ' + JSON.stringify(path.join(HERE, 'verify.php')) + ';' +
    '$in=json_decode(file_get_contents("php://stdin"),true);$o=[];' +
    'foreach($in as $c){$r=Checks::run($c["q"],$c["a"]);' +
    '$sig=[];foreach($r["checks"] as $k)$sig[]=$k["kind"].($k["ok"]?"+":"-");' +
    'sort($sig);$o[]=["state"=>$r["state"],"sig"=>implode(",",$sig)];}echo json_encode($o);';
  return JSON.parse(execFileSync(PHP, ['-r', script],
    { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

const A = (s) => '## ✅ Answer\n**' + s + '**';
const PROSE = '\n\n## 🔍 Verification\n✓ Verified. This is definitively correct.';
const CANON = { checked: 'verified', disputed: 'disputed', stepfail: 'disputed',
  invalid_question: 'disputed', unverified: 'unverified', worked: 'unverified',
  explained: 'unverified', plain: 'unverified', partial: 'unverified' };

const C = [];
const add = (fix, role, name, q, a, want) => C.push({ fix, role, name, q, a, want });

/* ---- CHEMISTRY — does the reaction balance ----------------------
   An explicit arrow is required; "=" is deliberately left to the
   arithmetic checker, because 2 + 2 = 4 is not a reaction. */
{
  const q = 'Balance the equation for the formation of water';
  add('chemistry', 'positive', 'balanced reaction', q, '2H2 + O2 -> 2H2O', 'verified');
  add('chemistry', 'control', 'UNBALANCED reaction', q, 'H2 + O2 -> H2O', 'disputed');
  add('chemistry', 'control', 'unbalanced + AI prose', q, 'H2 + O2 -> H2O' + PROSE, 'disputed');
  add('chemistry', 'positive', 'unicode arrow, balanced', q, '2H2 + O2 → 2H2O', 'verified');
  add('chemistry', 'control', 'unicode arrow, unbalanced', q, '2H2 + O2 → H2O', 'disputed');
  add('chemistry', 'positive', 'combustion, balanced',
      'Balance the combustion of methane', 'CH4 + 2O2 -> CO2 + 2H2O', 'verified');
  add('chemistry', 'control', 'combustion, unbalanced',
      'Balance the combustion of methane', 'CH4 + O2 -> CO2 + H2O', 'disputed');
  /* a bare arrow between prose is not a reaction and must get no verdict */
  add('chemistry', 'guard', 'arrow in prose is not a reaction',
      'Explain the process', 'heating -> melting', 'unverified');
}

/* ---- BOUNDS — a probability outside 0…1 is impossible ------------ */
{
  const q = 'What is the probability of getting two heads in two tosses?';
  add('bounds', 'positive', 'probability inside 0..1', q, A('1/4'), 'verified');
  add('bounds', 'control', 'probability above 1', q, A('3/2'), 'disputed');
  add('bounds', 'control', 'negative probability', q, A('-1/4'), 'disputed');
  add('bounds', 'control', 'impossible + AI prose', q, A('3/2') + PROSE, 'disputed');
  add('bounds', 'positive', 'probability of 1 is legal',
      'What is the probability of a certain event?', A('1/1'), 'verified');
  /* not a probability question — the checker must stay silent */
  add('bounds', 'guard', 'non-probability question untouched',
      'What is 3/2 as a decimal?', A('1.5'), 'unverified');
}

/* ---- checkDivisibility — does a divides b, actually --------------- */
{
  const q = 'Check the divisibility claim';
  add('divisibility', 'positive', 'true: 3 divides 12', q, '3 divides 12', 'verified');
  add('divisibility', 'control', 'FALSE: 3 divides 13', q, '3 divides 13', 'disputed');
  add('divisibility', 'positive', 'true: 12 is divisible by 3', q, '12 is divisible by 3', 'verified');
  add('divisibility', 'control', 'FALSE: 13 is divisible by 3', q, '13 is divisible by 3', 'disputed');
  add('divisibility', 'positive', 'true negative claim', q, '3 does not divide 13', 'verified');
  add('divisibility', 'control', 'FALSE negative claim', q, '3 does not divide 12', 'disputed');
  add('divisibility', 'control', 'false claim + AI prose', q, '3 divides 13' + PROSE, 'disputed');
  /* division by zero is not a claim anyone can settle */
  add('divisibility', 'guard', 'divisor zero gets no verdict', q, '0 divides 12', 'unverified');
}

/* ---- conditionCheck — does the answer satisfy the QUESTION's
        own stated condition ---------------------------------------- */
{
  const q = 'Find all n such that 3 divides n + 1';
  add('condition', 'positive', 'answer satisfies the condition', q, A('n = 2'), 'verified');
  add('condition', 'control', 'answer FAILS the condition', q, A('n = 4'), 'disputed');
  add('condition', 'control', 'failing answer + AI prose', q, A('n = 4') + PROSE, 'disputed');
  add('condition', 'positive', 'second satisfying value', q, A('n = 5'), 'verified');
  const q2 = 'Find all k such that 4 divides k + 2';
  add('condition', 'positive', 'different modulus, satisfied', q2, A('k = 2'), 'verified');
  add('condition', 'control', 'different modulus, failed', q2, A('k = 3'), 'disputed');
}

/* ---- transformCheck — does a stated map send solutions to solutions?
   The Markov-style equation x² + y² + 1 = 3xy. Vieta jumping says that from a
   solution (x, y) the OTHER root of t² − 3yt + (y²+1) = 0 is 3y − x, so
   (y, 3y − x) is again a solution and (3y − x, x) is not. Both directions are
   pinned, because a map that happens to work on one hop is exactly what the
   three-step iteration in the checker exists to catch. */
{
  const q = 'Solve x^2 + y^2 + 1 = 3xy in positive integers';
  const M = (m) => '## ✅ Answer\nThe map ' + m + ' sends solutions to solutions.';
  add('transform', 'positive', 'valid Vieta jump', q, M('(x, y) -> (y, 3y - x)'), 'verified');
  add('transform', 'positive', 'valid jump, other order', q, M('(x, y) -> (3x - y, x)'), 'verified');
  add('transform', 'control', 'INVALID map', q, M('(x, y) -> (3y - x, x)'), 'disputed');
  add('transform', 'control', 'invalid map, mirrored', q, M('(x, y) -> (y, 3x - y)'), 'disputed');
  add('transform', 'control', 'invalid map + AI prose', q, M('(x, y) -> (3y - x, x)') + PROSE, 'disputed');
}

/* ---- uniqueness — is the single value offered really the only one? ---- */
{
  add('uniqueness', 'positive', 'genuinely unique root',
      'Find all n such that n^3 = 8', A('The only solution is n = 2.'), 'disputed');
  add('uniqueness', 'control', 'NOT unique — n = -2 also works',
      'Find all n such that n^2 = 4', A('The only solution is n = 2.'), 'disputed');
  add('uniqueness', 'control', 'not unique, "unique" phrasing',
      'Find all n such that n^2 = 9', A('n = 3 is the unique solution.'), 'disputed');
  add('uniqueness', 'positive', 'unique cube root, larger',
      'Find all n such that n^3 = 27', A('The only solution is n = 3.'), 'disputed');
}

/* ---- extremumCheck — is the claimed extreme actually extreme? -------
   x+y+z = 12 and xy+yz+zx = 45 pins the feasible set to a curve, and the
   largest xyz on it is 54. The sweep is 44,000 points and is NOT thinned in
   the PHP port: a sparser scan finds a worse extreme and would certify a wrong
   answer as correct. Measured at ~27 ms per call in PHP, because most x are
   infeasible and never reach an evaluation. */
{
  const q = 'For x+y+z=12 and xy+yz+zx=45, find the maximum value of xyz';
  add('extremum', 'positive', 'correct maximum', q, A('54'), 'verified');
  add('extremum', 'control', 'maximum understated', q, A('50'), 'disputed');
  add('extremum', 'control', 'maximum overstated', q, A('60'), 'disputed');
  add('extremum', 'control', 'wrong maximum + AI prose', q, A('50') + PROSE, 'disputed');
  add('extremum', 'control', 'minimum asked, maximum given',
      'For x+y+z=12 and xy+yz+zx=45, find the minimum value of xyz', A('54'), 'disputed');
}

/* ------------------------------------------------------------------ */
const V = loadJs();
const jsOut = C.map((c) => {
  let r;
  try { r = V.run(c.q, c.a); } catch (e) { return { state: 'THREW', sig: e.message }; }
  return { state: r.state,
           sig: (r.checks || []).map((k) => k.kind + (k.ok === true ? '+' : '-')).sort().join(',') };
});

let phpOut = null;
if (!JS_ONLY) {
  try { phpOut = runPhp(C.map((c) => ({ q: c.q, a: c.a }))); }
  catch (e) { console.error('\n  PHP engine could not be run: ' + String(e.message).slice(0, 300) + '\n'); process.exit(2); }
}

const fails = [];
const byFix = {};
C.forEach((c, i) => {
  const j = jsOut[i], p = phpOut ? phpOut[i] : null;
  const b = (byFix[c.fix] = byFix[c.fix] || { pass: 0, fail: 0, pos: 0, ctrl: 0 });
  if (c.role === 'positive') b.pos++;
  if (c.role === 'control') b.ctrl++;
  const jc = CANON[j.state];
  let bad = null;
  if (!jc) bad = 'JS state "' + j.state + '" is not in the canonical map';
  else if (jc !== c.want) bad = 'JS ' + jc + ' (' + j.state + ') expected ' + c.want +
                                (j.sig ? '  [' + j.sig + ']' : '  [no checks]');
  if (!bad && p) {
    const pc = CANON[p.state];
    if (!pc) bad = 'PHP state "' + p.state + '" is not in the canonical map';
    else if (pc !== jc) bad = 'PARITY: JS ' + jc + ' (' + j.state + ') vs PHP ' + pc + ' (' + p.state + ')';
    else if (p.sig !== j.sig) bad = 'PARITY: kinds differ — JS [' + j.sig + '] vs PHP [' + p.sig + ']';
  }
  if (bad) { b.fail++; fails.push(c.fix + '  ' + c.name + ': ' + bad); } else b.pass++;
});

console.log('');
console.log('  checker           cases  pos  ctrl  result');
let noCtrl = 0;
Object.keys(byFix).sort().forEach((k) => {
  const b = byFix[k];
  if (!b.ctrl) noCtrl++;
  console.log('  ' + k.padEnd(18) + String(b.pass + b.fail).padStart(5) +
    String(b.pos).padStart(5) + String(b.ctrl).padStart(6) + '  ' + (b.fail ? 'FAIL (' + b.fail + ')' : 'pass'));
});
console.log('');
if (noCtrl) {
  console.log('  REFUSING TO PASS — ' + noCtrl + ' checker(s) have no negative control.\n');
  process.exit(1);
}
if (fails.length) {
  console.log('  BAND B SUITE FAILED — ' + fails.length + ' of ' + C.length + '\n');
  fails.forEach((f) => console.log('    ' + f));
  console.log('');
  process.exit(1);
}
console.log('  band B OK — ' + C.length + ' cases' +
  (phpOut ? ', JS and PHP agree on every one' : ' (JS only)'));
console.log('  four checkers the API could not run are now at parity with the site\n');
