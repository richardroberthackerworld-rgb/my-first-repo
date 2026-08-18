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

  /* PHYSICS — dimensional analysis lives in two files (units.php and the
     U_* block in index.html) and is therefore the newest place the engines
     can drift. Without cases here the harness would be blind to it in
     exactly the way it was blind to the LaTeX divergence that reached
     production: green suite, broken product. */
  ['Find the acceleration of the block.',  '## ✅ Answer\na = 25 N'],
  ['Find the acceleration of the block.',  '## ✅ Answer\na = 9.8 m/s²'],
  ['Calculate the force on the mass.',     '## ✅ Answer\nF = 50 N'],
  ['Calculate the force on the mass.',     '## ✅ Answer\nF = 50 J'],
  ['What is the kinetic energy of the mass?', '## ✅ Answer\nKE = 200 J'],
  ['What is the kinetic energy?',          '## ✅ Answer\nKE = 200 W'],
  ['Find the momentum of the ball.',       '## ✅ Answer\np = 12 kg m/s'],
  ['Find the pressure at the base.',       '## ✅ Answer\nP = 101325 N'],
  ['What is the resistance of the wire?',  '## ✅ Answer\nR = 12 ohm'],
  ['Determine the power of the motor.',    '## ✅ Answer\nP = 750 W'],
  /* must stay silent — the two engines must agree on the silences too */
  ['Find the force and the acceleration.', '## ✅ Answer\nF = 5 N'],
  ['Find the velocity.',                   '## ✅ Answer\nv = 5'],
  ['Find the velocity.',                   '## ✅ Answer\nIt is quite fast.'],
  ['The mass is 5 kg. Solve for x.',       '## ✅ Answer\nx = 3'],

  /* QUESTION INTEGRITY — whether the problem being solved is the problem
     that was set. A misread question makes every other check below it a
     verdict about something else entirely, so this layer is compared here
     too rather than trusted to stay in step on its own. */
  ['Solve 3x+y = 7',   '## ✅ Answer\nWe have 3(x+y) = 7, so ...'],
  ['Solve 3x+y = 7',   '## ✅ Answer\nGiven 3x + y = 7, we get y = 7 - 3x.'],
  ['Solve 3x+y = 7',   '## ✅ Answer\nGiven 6x + 2y = 14, ...'],
  ['Given ab+c = 10',  '## ✅ Answer\nStarting from a(b+c) = 10 ...'],
  ['Solve 2x+3 = 11',  '## ✅ Answer\nWe solve 2(x+3) = 11.'],
  ['Solve 5x-2 = 8',   '## ✅ Answer\nGiven 5(x-2) = 8.'],
  /* must not cry wolf */
  ['Solve x^2-4=0',    '## ✅ Answer\nx² - 4 = 0, so x² = 4, so x = ±2.'],
  ['Solve 2x+3 = 11',  '## ✅ Answer\nx = 4'],
  /* the trailing full stop that used to hide an equation from every check */
  ['Solve x^2-4 = 0.', '## ✅ Answer\nx = 2 and x = -2'],
  ['Solve x^2-4 = 0.', '## ✅ Answer\nx = 2 and x = 3'],

  /* THE ACCEPTANCE TEST: 3^(x+y) must never be solved as 3(x+y), and
     3(x+y) — when genuinely asked — must never be flagged as 3^(x+y).
     Together they prove the detector compares mathematical structure and
     not strings. */
  ['Find positive integers x,y with x^2 + xy + y^2 = 3^(x+y)',
   '## 📌 Understood as\nx^2 + xy + y^2 = 3(x+y)\n\n## ✅ Answer\n(x,y) = (2,2)'],
  ['Find positive integers x,y with x^2 + xy + y^2 = 3(x+y)',
   '## 📌 Understood as\nx^2 + xy + y^2 = 3(x+y)\n\n## ✅ Answer\n(x,y) = (2,2)'],
  ['Find positive integers x,y with x^2 + xy + y^2 = 3(x+y)',
   '## 📌 Understood as\nx^2 + xy + y^2 = 3^(x+y)\n\n## ✅ Answer\n(x,y) = (1,1)'],
  /* formatting is not a mathematical difference */
  ['Solve x^2 = 3^(x+y)',  '## 📌 Understood as\nx² = 3^{x+y}\n\n## ✅ Answer\n(1,1)'],
  ['Solve x^{2} = 3^{x+y}','## 📌 Understood as\nx^2 = 3^(x+y)\n\n## ✅ Answer\n(1,1)'],

  /* SOLUTION-TO-FINAL TRACE — does the stated answer follow from the working
     that was shown? Newest layer, so the newest place the two can drift. */
  ['Solve 3x - 6 = 0', '## ✅ Answer\nx = 4\n\n## 📝 Steps\n1. 3x = 6\n2. so x = 2.'],
  ['Solve 3x - 6 = 0', '## ✅ Answer\nx = 2\n\n## 📝 Steps\n1. 3x = 6\n2. so x = 2.'],
  ['Solve 3x - 6 = 0', '## ✅ Answer\nx = 2\n\n## 📝 Steps\n1. Divide both sides by 3.'],
  ['Solve 3x - 6 = 0', '## ✅ Answer\nx = 2'],
  ['Solve x^2-4=0',    '## ✅ Answer\nx = 2 and x = -2\n\n## 📝 Steps\n1. x² = 4 so x = ±2.'],

  /* A REPORTED FALSE POSITIVE, kept permanently. The model boxed a faithful
     restatement and then wrote an identity as its next step; \boxed survived
     deLatex so the restatement was unreadable, the scan fell through to the
     identity, and a completely correct answer was told it had solved a
     different question. Both halves — the wrapper and the identity — are
     pinned here. */
  ['Find all positive integers x,y satisfying x^2 + xy + y^2 = 3^{x+y+1}.',
   'The original equation is\n\n\\[ \\boxed{x^2 + xy + y^2 = 3^{x+y+1}} \\]\n\nand it must be solved exactly as written.\n\nLet\n\n\\[ s = x + y. \\]\n\nThen\n\n\\[ x^2 + xy + y^2 = s^2 - xy. \\]'],
  ['Find all positive integers x,y satisfying x^2 + xy + y^2 = 3^{x+y+1}.',
   '## 📌 Understood as\nx^2 + xy + y^2 = 3(x+y+1)\n\n## ✅ Answer\n(1,1)'],
  ['Find all positive integers x,y satisfying x^2 + xy + y^2 = 3^{x+y+1}.',
   '## 📌 Understood as\nx^2 + xy + y^2 = 3^{x+y+1}\n\n## ✅ Answer\n(1,1)'],
  /* an identity written as a step must never be read as a restatement */
  ['Solve x^2-4=0',
   '## 📌 Understood as\nx^2 - 4 = 0\n\n## 📝 Steps\n1. x^2 - 4 = (x-2)(x+2)'],

  /* REPORTED: integer division read as exact division. A page of correct
     remainder working came back as five failed checks — and the ±0.5
     tolerance an integer earns let "59 ÷ 2 = 29" PASS while its four
     siblings failed, which is the checker contradicting itself in public.
     Both the silences and the surviving failures are pinned. */
  ['Find the largest number below 60 leaving a remainder with 2,3,4,5,6',
   '## ✅ Answer\n59\n\n## 📝 Steps\n1. 59 ÷ 2 = 29 remainder 1\n2. 59 ÷ 3 = 19 remainder 2\n3. 59 ÷ 4 = 14 remainder 3\n4. 59 ÷ 5 = 11 remainder 4\n5. 59 ÷ 6 = 9 remainder 5'],
  ['Divide',  '## 📝 Steps\n59 ÷ 3 = 19'],     // integer division → silent
  ['Divide',  '## 📝 Steps\n7 ÷ 2 = 3'],       // integer division → silent
  ['Divide',  '## 📝 Steps\n59 ÷ 3 = 20'],     // wrong on both readings → fail
  ['Divide',  '## 📝 Steps\n7 ÷ 2 = 4'],       // wrong on both readings → fail
  ['Divide',  '## 📝 Steps\n10 ÷ 4 = 3'],      // wrong on both readings → fail
  ['Divide',  '## 📝 Steps\n20 ÷ 4 = 5'],      // exact and correct → pass
  ['Divide',  '## 📝 Steps\n10 ÷ 4 = 2.5'],    // exact decimal → pass
  ['Round',   '## 📝 Steps\n1/3 = 0.33'],      // rounding is still forgiven

  /* SELF-CORRECTION LEAKAGE — correct mathematics, poor presentation. It must
     never make an answer read as wrong, and must never be silent either: the
     prompt forbidding it is a request, and a request is not a guarantee. */
  ['Solve 3x-6=0', '## 📌 Understood as\n3x - 6 = 0\n\n## ✅ Answer\nx = 2\n\n## 📝 Steps\n1. 3x = 6\n2. Wait, let me re-check. Yes, x = 2.'],
  ['Solve 3x-6=0', '## 📌 Understood as\n3x - 6 = 0\n\n## ✅ Answer\nx = 2\n\n## 📝 Steps\n1. 3x = 6 so x = 2.'],
  ['Solve 3x-6=0', '## ✅ Answer\nx = 5\n\n## 📝 Steps\nHmm, actually x = 5.'],
  ['Wait time',    '## ✅ Answer\nThe waiting time is 5 minutes.'],
  ['Code',         '## ✅ Answer\n```py\n# wait for input\nx = 2\n```'],

  /* PERMANENT REGRESSION: a² + b² + c² = 3abc.
     Every tuple an answer puts forward is a claim, wherever on the page it is
     written. PHP read only the claim zone, so an answer listing its solutions
     in the WORKING had just the first one checked — and reported
     FULLY_VERIFIED while (5,1,1) gives 27 ≠ 15. The JS read the whole answer
     all along; nothing in the corpus placed tuples outside the claim zone, so
     the drift was invisible. These cases hold both engines to it. */
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which solutions is a+b+c prime?',
   '## 📌 Understood as\na^2+b^2+c^2=3abc\n\n## ✅ Answer\nOnly (1,1,1) gives a prime sum.\n\n## 📝 Steps\n1. The solutions are (1,1,1), (1,1,2), (1,2,5), (1,5,13), and (5,1,1).\n2. For (1,5,13) the sum is 1+5+13 = 19.\n3. Since the sequence grows without bound, there are infinitely many prime sums.'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   '## ✅ Answer\nThe solutions are (1,1,1), (1,1,2), (1,2,5) and (1,5,13).'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   '## ✅ Answer\nThe solutions include (5,1,1).'],

  /* UNPROVED CLAIMS. Four correct substitutions are evidence, not a proof of
     infinitude, and the engine used to call the gap FULLY_VERIFIED. A theorem
     NAME is a citation, not an argument — a checker that accepts one accepts
     any. The honest refusal must NOT be penalised: flagging it would teach the
     solver that hedging costs as much as overclaiming, exactly backwards. */
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which is a+b+c prime?',
   '## ✅ Answer\nThere are infinitely many solutions for which a+b+c is prime.\n\n## 📝 Steps\n1. Solutions: (1,1,1), (1,1,2), (1,2,5), (1,5,13).\n2. By Dirichlet\'s Theorem or by observing the density of primes, we can conclude there are infinitely many n such that S_n is prime.'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which is a+b+c prime?',
   '## ✅ Answer\nThere are infinitely many prime values because the sequence grows exponentially.'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which is a+b+c prime?',
   '## ✅ Answer\nInfinitely many prime sums, by Dirichlet.'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which is a+b+c prime?',
   '## ✅ Answer\nOnly (1,1,1) has a prime sum.'],
  /* the honest refusal — must stay unpenalised */
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which is a+b+c prime?',
   '## ✅ Answer\nExamples such as 3 and 19 show that prime sums occur, but the argument provided does not establish that infinitely many such prime sums exist.'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc. For which is a+b+c prime?',
   '## ✅ Answer\nPrime sums occur, but we cannot prove that infinitely many exist.'],
  /* a real argument passes */
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   '## ✅ Answer\nAll solutions arise from (1,1,1).\n\n## 📝 Steps\n1. By Vieta jumping and infinite descent every solution reduces to (1,1,1).'],

  /* QUESTION VALIDITY — the newest layer, and the one that lived in PHP alone
     for a while. Three replies to an impossible question used to receive
     identical verdicts; these pin the distinction in BOTH engines. */
  ['A positive integer N<1000 leaves remainder 1 when divided by 2, remainder 2 when divided by 3, remainder 4 when divided by 5, remainder 6 when divided by 7, and remainder 10 when divided by 11. What is the largest possible value of N?',
   '## ✅ Answer\nNo positive integer N < 1000 satisfies all the conditions.'],
  ['A positive integer N<1000 leaves remainder 1 when divided by 2, remainder 2 when divided by 3, remainder 4 when divided by 5, remainder 6 when divided by 7, and remainder 10 when divided by 11. What is the largest possible value of N?',
   '## ✅ Answer\nN = 2309'],
  ['A positive integer N<1000 leaves remainder 1 when divided by 2, remainder 2 when divided by 3, remainder 4 when divided by 5, remainder 6 when divided by 7, and remainder 10 when divided by 11. What is the largest possible value of N?',
   '## ✅ Answer\nN = 209'],
  /* the solvable control: a false "impossible" is the heaviest wrong claim here */
  ['Find the largest positive integer N < 100 that leaves remainder 1 when divided by 2 and remainder 2 when divided by 3.',
   '## ✅ Answer\nN = 95'],
  ['Find the largest positive integer N < 100 that leaves remainder 1 when divided by 2 and remainder 2 when divided by 3.',
   '## ✅ Answer\nN = 94'],
  ['Find the largest positive integer N < 100 that leaves remainder 1 when divided by 2 and remainder 2 when divided by 3.',
   '## ✅ Answer\nN = 5'],
  ['Find the largest positive integer N < 100 that leaves remainder 1 when divided by 2 and remainder 2 when divided by 3.',
   '## ✅ Answer\nNo such N exists.'],
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
  /* An impossible question is its own outcome, and it outranks every verdict
     about the answer — if the problem has no solution, "is the answer right"
     is not the question being asked. */
  if (checks.some((c) => c.invalidQuestion)) return 'invalid_question';
  const failed = checks.filter((c) => !c.ok && !c.soft);
  const passed = checks.filter((c) => c.ok);
  /* Answer-level kinds, matching $answerLevel in Checks::run. A wrong
     dimension condemns the answer, not merely a step. */
  const ANSWER = { subst: 1, units: 1, integrity: 1, question: 1, claim: 1, primality: 1, truncated: 1 };
  if (failed.some((c) => ANSWER[c.kind])) return 'disputed';
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
        /* A signature of WHICH checks ran and how each landed. Comparing only
           the state and a count let a real divergence through: both engines
           can report invalid_question with one check while disagreeing about
           whether that check PASSED — which is the difference between telling
           a student their answer was right and telling them it was wrong. */
        $sig = [];
        foreach ($r['checks'] as $ck) $sig[] = $ck['kind'] . ($ck['ok'] ? '+' : '-');
        sort($sig);
        $out['verdicts'][] = ['state' => $r['state'], 'n' => $r['checked'],
                              'sig' => implode(',', $sig)];
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
    /* Must assemble the SAME set of checks Checks::run assembles on the PHP
       side. Adding a check to one engine and forgetting it here produces a
       harness that reports a divergence it created itself. */
    const checks = [].concat(
      V.substitution(c.q, c.a) || [],
      V.arithmetic(c.a) || [],
      V.units(c.q, c.a) || [],
      V.integrity(c.q, c.a) || [],
      V.trace(c.q, c.a) || [],
      V.questionCheck(c.q, c.a) || [],
      V.presentation(c.a) || [],
      V.unproved(c.a) || [],
      V.primality(c.a) || [],
      V.completeness(c.a) || []);
    const sig = checks.map((x) => x.kind + (x.ok ? '+' : '-')).sort().join(',');
    const js = { state: verdictOf(checks), n: checks.length, sig };
    const ph = php.verdicts[i];
    if (js.state !== ph.state || js.n !== ph.n || js.sig !== ph.sig) {
      bad.push('verdict ' + JSON.stringify(c.q.slice(0, 70)) +
               '\n            answer ' + JSON.stringify(c.a.replace(/\n/g, ' ').slice(0, 70)) +
               '\n            js =' + js.state + '(' + js.n + ') [' + js.sig + ']' +
               '\n            php=' + ph.state + '(' + ph.n + ') [' + ph.sig + ']');
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
