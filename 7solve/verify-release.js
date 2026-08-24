#!/usr/bin/env node
/* ============================================================
   7Solve — RELEASE VERIFICATION for a single build
   ------------------------------------------------------------
   Not a test suite. The suites prove the engine behaves; this
   proves that THE BYTES SERVED TO STUDENTS are the ones the
   suites ran against, and that both engines say the same thing
   about the cases this release exists for.

   It loads the JS engine out of a file fetched from PRODUCTION
   rather than out of the working tree, so a green result here
   cannot come from a local build that was never deployed.

       curl -s https://7solve.7by.in/ -o live.html
       node verify-release.js 2026-08-24.4 live.html

   Exit 0 = the release is what it claims to be.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const BUILD = process.argv[2];
const LIVE = process.argv[3];
const PHP = process.env.PHP_BIN || 'php';
if (!BUILD || !LIVE) {
  console.error('usage: node verify-release.js <expected-build> <live-html>');
  process.exit(2);
}

const fails = [];
const notes = [];
function ok(label, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label +
              (detail && !cond ? '\n          ' + detail : ''));
  if (!cond) fails.push(label + (detail ? ' — ' + detail : ''));
}

/* ---------- the shipped bytes ---------- */
const live = fs.readFileSync(LIVE, 'utf8');
const local = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

console.log('\n1. THE BYTES BEING SERVED');
const stamp = (live.match(/<meta name="7solve-build" content="([^"]+)"/) || [])[1];
ok('production reports build ' + BUILD, stamp === BUILD, 'live says ' + stamp);
ok('production is byte-identical to the reviewed source', live === local,
   'live ' + live.length + ' bytes, source ' + local.length);

/* ---------- load the LIVE engine ----------
   The same marks the adversarial and parity harnesses use, so the modules load
   exactly as they do everywhere else — but from bytes fetched off production. */
function cut(startMark, endMark, what) {
  const i = live.indexOf(startMark);
  const j = live.indexOf(endMark, i);
  if (i < 0 || j < i) throw new Error('could not find ' + what + ' in the live page');
  return live.slice(i, j);
}
const NL = String.fromCharCode(10);
const sandbox = {
  window: {}, console, W: {}, $: () => null, state: {},
  Math, parseFloat, parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON, BigInt,
};
vm.createContext(sandbox);
vm.runInContext(
  cut('var Deriv = (function(){', NL + 'window.Deriv = Deriv;', 'Deriv') +
    NL + 'window.Deriv = Deriv;' + NL +
  cut('function deLatex(md){', NL + 'window.deLatex7 = deLatex;', 'deLatex') +
    NL + 'window.deLatex7 = deLatex;' + NL +
  cut('var MathPaste = (function(){', NL + 'window.MathPaste = MathPaste;', 'MathPaste') +
    NL + 'window.MathPaste = MathPaste;' + NL +
  cut('var Verify = (function(){', NL + '})();', 'Verify') +
    NL + '})();' + NL + 'window.Verify = Verify;' + NL +
  cut('var RESOLVE_GUIDANCE = {', '/* ================= Solve flow ================= */', 'resolveComplaint') +
    NL + 'this.V = Verify; this.C = resolveComplaint; this.dl = deLatex;',
  sandbox, { timeout: 20000 });
const V = sandbox.V, C = sandbox.C;
if (typeof C !== 'function') throw new Error('resolveComplaint did not load from the live page');
ok('the live engine loads and exposes run() and the re-solve complaint',
   typeof V.run === 'function' && typeof C === 'function');

/* ---------- the cases this release is about ---------- */
const SLIP_Q = 'Find all positive integers x, y with x^2 + y^2 - 5xy = 25';
const SLIP_A =
  '## ✅ Final Answer\n' +
  'All positive integer solutions of x^2 + y^2 - 5xy = 25 are obtained by repeatedly applying ' +
  'the Vieta-jump to the three minimal solutions (1,8), (3,16), (5,25).\n' +
  'The first few are (1,8), (3,16), (5,25), (8,39), (16,77), (25,120), (39,187), (77,368), (120,575), and so on.\n' +
  '\n## 📖 Steps\n1. As a quadratic in x: x^2 - 5yx + (y^2 - 25) = 0, so the other root is 5y - x.\n' +
  '2. Jumping the larger coordinate strictly decreases it, so the descent terminates.\n' +
  '3. The minimal pairs are (1,8), (3,16), (5,25), and every solution descends to one of them.';

const BROKEN_Q = 'Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.';
const BROKEN_A = '## ✅ Answer\nAll solutions arise from (1,2,3) by Vieta jumping.';

const FALSE_Q = 'x^2+y^2+z^2=xyz';
const FALSE_A = '## ✅ Final Answer\n(x, y, z) = (3, 3, 3)\n\n' +
  '## 📖 Steps\n4. Hence z ≤ xy ≤ 3z. Write xy = kz with integer k in 1,2,3.\n' +
  '12. Conclusion – The only positive integer triple satisfying the original equation is (3,3,3).';

const GOOD_Q = 'Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz';
const GOOD_A = '## ✅ Answer\nEvery solution is obtained from (3,3,3) by the jumps; ' +
  'for example (3,3,6), (3,6,15), (6,15,87). The family continues forever.';

function jsRun(q, a) {
  const r = V.run(q, a);
  const checks = r.checks || [];
  const d = checks.filter((c) => c.kind === 'descent')[0] || null;
  return {
    state: r.state,
    sig: checks.map((x) => x.kind + (x.ok ? '+' : '-') +
      (x.kind === 'descent' && /slip in one number/.test(String(x.text)) ? ':slip' : ''))
      .sort().join(','),
    /* The same composite PHP reports, so the pair the badge will SHOW is what
       gets compared and not merely that a correction exists. */
    correction: r.correction
      ? String(r.correction.slipOf) + ' > ' + String(r.correction.slipTo)
      : null,
    badgeLine: r.correction
      ? 'Verified with one correction: ' + r.correction.slipOf + ' should be ' +
        (r.correction.slipTo || 'the value the jump gives') + '. Your method is sound.'
      : null,
    descent: d ? String(d.text) : '',
    fix: d && d.fix ? String(d.fix) : '',
    complaint: C(r, q),
  };
}

console.log('\n2. THE CORRECTED (77,368) → (77,369) CASE');
const slip = jsRun(SLIP_Q, SLIP_A);
ok('the wrong pair is refused', slip.state === 'disputed', 'state=' + slip.state);
ok('the value that was meant is named as (77,369)', /\(77,369\)/.test(slip.descent),
   slip.descent.slice(0, 160));
ok('and the arithmetic behind that correction is right', (function () {
  const f = (x, y) => x * x + y * y - 5 * x * y;
  return f(77, 368) === -327 && f(77, 369) === 25 && 5 * 77 - 16 === 369;
})(), 'the jump from (16,77) must give 369');

console.log('\n3. THE DIAGNOSIS IS A SLIP, NOT A BROKEN METHOD');
ok('it is called a slip in one number',
   /slip in one number, not a fault in the construction/.test(slip.descent));
ok('the method is explicitly cleared', /the method is sound/.test(slip.descent));
ok('the jump map is NOT blamed', !/jump map/.test(slip.descent), slip.descent.slice(0, 200));
ok('the repair asks for one number and nothing else',
   /should be \(x,y\) = \(77,369\)/.test(slip.fix) && /change nothing else/.test(slip.fix),
   slip.fix.slice(0, 200));
ok('and it says not to rebuild the families', /Do not re-derive the families/.test(slip.fix));
ok('the re-solve message carries that repair verbatim', slip.complaint.indexOf(slip.fix) >= 0);

console.log('\n4. A GENUINELY BROKEN CONSTRUCTION STILL GETS THE HARSH DIAGNOSIS');
const broken = jsRun(BROKEN_Q, BROKEN_A);
ok('a family built on a non-solution is refused', broken.state === 'disputed',
   'state=' + broken.state);
ok('the jump map IS blamed there', /which usually means the jump map/.test(broken.descent),
   broken.descent.slice(0, 160));
ok('and it is NOT excused as a slip', !/slip in one number/.test(broken.descent));

console.log('\n   the two verdicts the rest of this release rests on:');
const wrong = jsRun(FALSE_Q, FALSE_A);
ok('the false (3,3,3) answer is refused with no "find all" in the question',
   wrong.state === 'disputed', 'state=' + wrong.state);
const good = jsRun(GOOD_Q, GOOD_A);
ok('the correct classification is certified', good.state === 'checked', 'state=' + good.state);

console.log('\n5. THE TWO ENGINES SAY THE SAME THING');
const cases = [
  ['slip', SLIP_Q, SLIP_A], ['broken', BROKEN_Q, BROKEN_A],
  ['false', FALSE_Q, FALSE_A], ['good', GOOD_Q, GOOD_A],
];
const script = [
  "require '" + path.join(__dirname, 'verify.php').replace(/\\/g, '/') + "';",
  '$in = json_decode(file_get_contents("php://stdin"), true);',
  '$out = [];',
  'foreach ($in as $c) {',
  '    $r = Checks::run($c[1], $c[2]);',
  '    $sig = [];',
  '    foreach ($r["checks"] as $ck) {',
  '        $m = $ck["kind"] . ($ck["ok"] ? "+" : "-");',
  '        if ($ck["kind"] === "descent" && strpos((string)$ck["text"], "slip in one number") !== false) $m .= ":slip";',
  '        $sig[] = $m;',
  '    }',
  '    sort($sig);',
  '    $d = "";',
  '    foreach ($r["checks"] as $ck) if ($ck["kind"] === "descent") $d = (string)$ck["text"];',
  '    $leak = "";',
  '    foreach ($r["checks"] as $ck) if (array_key_exists("slipOf", $ck)) $leak = "LEAKED";',
  '    $out[] = ["state" => $r["state"], "sig" => implode(",", $sig), "descent" => $d,',
  '              "correction" => $r["correction"], "leak" => $leak];',
  '}',
  'echo json_encode($out);',
].join('\n');

let php = null;
try {
  php = JSON.parse(execFileSync(PHP, ['-d', 'error_reporting=E_ALL', '-r', script],
    { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 1 << 24 }));
} catch (e) {
  ok('the PHP engine ran without error', false, String(e.message).slice(0, 300));
}
const COLLAPSE = { checked: 'verified', disputed: 'disputed' };
if (php) {
  ok('the PHP engine ran without error or warning', true);
  cases.forEach((c, i) => {
    const j = jsRun(c[1], c[2]), p = php[i];
    const jS = COLLAPSE[j.state] || 'unverified', pS = COLLAPSE[p.state] || 'unverified';
    ok(c[0] + ': same verdict', jS === pS, 'js=' + j.state + '  php=' + p.state);
    ok(c[0] + ': same parity signature', j.sig === p.sig,
       'js=[' + j.sig + ']  php=[' + p.sig + ']');
    ok(c[0] + ': same badge tier', (j.correction || null) === (p.correction || null),
       'js=' + j.correction + '  php=' + p.correction);
    ok(c[0] + ': same diagnosis', j.descent === p.descent,
       'js=' + j.descent.slice(0, 90) + '  ||  php=' + p.descent.slice(0, 90));
  });
  notes.push('The REPAIR INSTRUCTION (the `fix` field and resolveComplaint) is browser-only by ' +
             'design: /v1 returns a verdict and never re-solves, so there is no second attempt for ' +
             'it to steer. Both engines carry the same diagnosis, which is what an API caller sees.');
}

console.log('\n6. THE THIRD BADGE');
ok('the slip is marked as a correction',
   String(slip.correction) === '(x,y) = (77,368) > (x,y) = (77,369)',
   'correction=' + slip.correction);
ok('and its VERDICT is still disputed — the tier is presentation only',
   slip.state === 'disputed', 'state=' + slip.state);
ok('a broken construction is never softened to a correction', broken.correction === null,
   'correction=' + broken.correction);
ok('a false completeness claim is never softened either', wrong.correction === null,
   'correction=' + wrong.correction);
/* THE SENTENCE A STUDENT ACTUALLY READS. Everything else here proved the badge
   was WIRED, and the badge was wired — it shipped in .6 reading
   "(77,368) should be ?", because it recovered the corrected value out of the
   diagnosis with a regex that stops at a comma, and the value contains one.
   Nothing that reads the source can see that, so the sentence is assembled here
   from the served fields and read back. Plain string tests on purpose: the
   thing being checked is prose, and a regex over prose is how the bug happened. */
{
  const line = String(slip.badgeLine || '');
  ok('the badge sentence names the value that is wrong',
     line.indexOf('(x,y) = (77,368) should be') >= 0, line);
  ok('and the value it should be',
     line.indexOf('should be (x,y) = (77,369).') >= 0, line);
  ok('and it tells the student their method is sound',
     line.indexOf('Your method is sound.') >= 0, line);
  for (const junk of ['?', 'undefined', 'null', 'the value the jump gives', 'NaN']) {
    ok('and no placeholder survives into it: ' + JSON.stringify(junk),
       line.indexOf(junk) < 0, line);
  }
}
ok('a fully correct answer carries no correction', good.correction === null,
   'correction=' + good.correction);
{
  const pv = live.indexOf('function paintVerif(md){');
  const body = pv >= 0 ? live.slice(pv, pv + 12000) : '';
  ok('the served badge reads the tier the engine computed',
     /var corrected = r\.correction \|\| null;/.test(body));
  ok('and renders its own class rather than the red one',
     /label = '⚠ Verified with one correction'; cls = 'verif corrected';/.test(body));
  ok('and tells the student their method is sound', /Your method is sound\./.test(body));
  ok('the corrected style is served and is not the green one',
     /\.verif\.corrected\{/.test(live) &&
     !/\.verif\.corrected\{[^}]*background:var\(--ok-tint\)/.test(live));
  ok('only a checked answer may still claim verification',
     !/cls = 'verif';/.test(body.slice(body.indexOf('corrected'), body.indexOf('} else if(cutOff)'))));
}

console.log('\n7. /v1 IS UNCHANGED BY THIS RELEASE');
{
  const v1 = fs.readFileSync(path.join(__dirname, 'v1.php'), 'utf8');
  const at = v1.indexOf('ok_out([');
  const outBlock = at >= 0 ? v1.slice(at, v1.indexOf(']);', at)) : '';
  ok('the response field list does not mention the new tier',
     outBlock.length > 0 && !/correction/.test(outBlock),
     'a presentation tier must not leak into a published contract');
  if (php) php.forEach((p, i) => {
    ok(cases[i][0] + ': no slipOf reaches the response', p.leak !== 'LEAKED',
       'Checks::run must strip it before /v1 serialises the checks');
  });
}

console.log('\n8. NOTHING FAILS SILENTLY');
let threw = 0;
const probes = cases.concat([
  ['empty', '', ''], ['junk', '???', 'x'],
  ['long', 'Solve ' + 'x'.repeat(400) + ' = 1', 'y = 2'],
  ['unicode', '2ⁿ⁺¹ = 8', '## ✅ Answer\nn = 2'],
]);
for (const [name, q, a] of probes) {
  try { V.run(q, a); } catch (e) { threw++; console.log('          THREW on ' + name + ': ' + e.message); }
}
ok('Verify.run throws on none of the probe inputs', threw === 0, threw + ' threw');
const newCode = cut('  function descentCheck(question, md){', '  /* ============', 'descentCheck');
ok('no debug logging left in the new checkers', !/console\.(log|debug|warn)\(/.test(newCode));
ok('no TODO or FIXME left in the new checkers', !/\b(TODO|FIXME|XXX)\b/.test(newCode));

console.log('\n' + (fails.length
  ? 'RELEASE VERIFICATION FAILED — ' + fails.length + ' problem(s)'
  : 'RELEASE VERIFICATION PASSED — build ' + BUILD + ' is what it claims to be'));
notes.forEach((n) => console.log('\nnote: ' + n));
process.exit(fails.length ? 1 : 0);
