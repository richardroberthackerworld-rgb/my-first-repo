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
  /* The P0.5 cubic, each root verified on its own — this is where "is 1 really
     a root?" is answered, separately from "is {1} the whole solution?". The
     three non-roots are here for the same reason the near-misses below are:
     a checker that accepts everything proves nothing. */
  ['x^3-6x^2+11x-6=0', [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 0 }, { x: -1 }]],
  ['(x-2)^2=0', [{ x: 2 }, { x: 3 }, { x: 0 }]],
  ['x^2+1=0', [{ x: 1 }, { x: -1 }, { x: 0 }]],
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
  /* SOLUTION COMPLETENESS lives in two files as well, and it is the newest
     place the engines can drift. Recovering coefficients by finite differences
     then deflating rational roots is a long enough procedure that a float
     tolerance edited in one file and not the other would go unnoticed without
     these — and the disagreement would be the API calling a partial answer
     verified while the site disputes it. */
  ['Solve x^3-6x^2+11x-6=0', '## ✅ Answer\nx = 1, x = 2, x = 3'],
  ['Solve x^3-6x^2+11x-6=0', '## ✅ Answer\nx = 1, x = 2'],
  ['Solve x^3-6x^2+11x-6=0', '## ✅ Answer\nx = 1'],
  ['Solve x^3-6x^2+11x-6=0', '## ✅ Answer\nx = 4'],
  ['Solve (x-2)^2 = 0',      '## ✅ Answer\nx = 2'],
  ['Solve x^2+1=0',          '## ✅ Answer\nThere are no real solutions.'],
  ['Solve x^2+1=0',          '## ✅ Answer\nx = i and x = -i'],
  ['Solve 2x-10=0',          '## ✅ Answer\nx = 5'],
  ['Solve x^3-x=0',          '## ✅ Answer\nx = 0, x = 1, x = -1'],
  ['Solve x^3-x=0',          '## ✅ Answer\nx = 0, x = 1'],
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
  /* CONTRADICTION — a solution that disagrees with its own working. Neither
     trace nor substitution catches this alone: trace only asks whether the
     final value appears, and substitution reports "7 is wrong" without ever
     noticing the working already said 5. */
  ['Solve 2x + 4 = 14', '## ✅ Answer\nx = 7\n\n## 📝 Steps\n1. 2x + 4 = 14\n2. 2x = 10\n3. x = 5'],
  ['Solve 2x + 4 = 14', '## ✅ Answer\nx = 5\n\n## 📝 Steps\n1. 2x + 4 = 14\n2. 2x = 10\n3. x = 5'],
  ['Solve 2x + 4 = 14', '## ✅ Answer\nx = 5\n\n## 📝 Steps\n1. 2x = 10\n2. so x = 9'],
  ['Solve 2x + 4 = 14', '## ✅ Answer\nx = 5'],
  ['Solve x + y = 10',  '## ✅ Answer\n(4,6)\n\n## 📝 Steps\n1. x = 4'],

  /* MARKDOWN EMPHASIS must never reach the value reader. LocalSolve writes
     "x = **82 + 30√7**"; the tokeniser turns ** into ^, the tail failed to
     parse, and the word-eating fallback harvested the fragment 82 — which
     satisfies nothing. A CORRECT answer was shown to a student as
     "Verification failed" while its own steps said 0 = 0.

     THE INVARIANT: a solution whose every claimed root substitutes to zero
     must never be disputed. All three input forms are pinned. */
  ['Solve x² − 164x + 424 = 0',
   '## ✅ Answer\n**x = 82 + 30√7  or  x = 82 − 30√7**\n\n## 📝 Steps\n1. **1x² + (-164)x + 424 = 0**, so a = 1, b = -164, c = 424.\n2. **D = 25200**.\n3. x = **82 + 30√7** and x = **82 − 30√7**'],
  ['Solve x ² − 164x + 424 = 0',
   '## ✅ Answer\n**x = 82 + 30√7  or  x = 82 − 30√7**\n\n## 📝 Steps\n1. a = 1, b = -164, c = 424.\n2. x = **82 + 30√7** and x = **82 − 30√7**'],
  ['Solve x^2 - 164x + 424 = 0',
   '## ✅ Answer\n**x = 82 + 30√7  or  x = 82 − 30√7**\n\n## 📝 Steps\n1. a = 1, b = -164, c = 424.\n2. x = **82 + 30√7** and x = **82 − 30√7**'],
  /* emphasis on a WRONG answer must still be caught — the fix strips
     presentation, it does not soften the mathematics */
  ['Solve x^2 - 4 = 0', '## ✅ Answer\n**x = 5**'],
  ['Solve x^2 - 4 = 0', '## ✅ Answer\n**x = 2** and **x = 3**'],

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

  /* CLAIM TAXONOMY (§5). Two statements no solver is entitled to make and no
     engine here can confirm: what mathematics currently knows, and a precise
     proportion of an infinite family. Neither is called false — both are
     "the system could not establish this". */
  ['a^2+b^2+c^2=3abc: are infinitely many a+b+c prime?',
   '## ✅ It is currently an open conjecture.\nProving infinitely many are prime is a deep unsolved problem.\n\n## 📖 Steps\n2. If all are even, the equation holds. Thus, exactly one-third of all Markov triples have an odd sum.\n3. (1, 1, 1) → Sum 3 (Prime)\n   (1, 5, 13) → Sum 19 (Prime)\n   (1, 13, 34) → Sum 48'],
  ['Markov', '## ✅ Answer\nExactly 25% of solutions are odd.'],
  ['Markov', '## ✅ Answer\nPrecisely 40 percent are prime.'],
  /* must stay silent — naming an equation is not a status claim */
  ['Markov', '## ✅ Answer\nThis is the famous Markov Equation.'],
  ['Cake',   '## ✅ Answer\nOne third of the cake is 120 g.'],
  /* primality claims, computed */
  ['Primes', '## ✅ Answer\nIt seems 5779 is prime, 36 is prime, and 467 is prime.'],
  /* truncation */
  ['Markov', '## ✅ Answer\nSolutions found.\n\n## 📝 Steps\n1. If a, b, c are all odd: a² + b² + c² is'],

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
  /* Deriv too: LocalSolve answers derivatives with no model at all, so its
     output is checked against known results rather than engine-to-engine.

     This used to look for "W.Deriv = Deriv;" and fall back to `var Deriv =
     null` when it could not find it. Build .38 renamed that export to
     window.Deriv — so the marker stopped matching, D became null, and
     `if (D)` quietly skipped all eighteen derivative cases while still
     counting them in the total. The suite reported a larger number and
     tested less. Never soft-fail on a missing marker: if the module cannot
     be located the harness is not testing what it claims to be. */
  const dvS = html.indexOf('var Deriv = (function(){');
  const dvE = html.indexOf('\nwindow.Deriv = Deriv;', dvS);
  if (dvS < 0 || dvE < dvS) throw new Error('could not find the Deriv module in index.html');
  const dvSrc = html.slice(dvS, dvE);

  /* Deriv FIRST, and on window: derivativeCheck reads window.Deriv at call
     time, so loading it after Verify leaves the check alive but toothless. */
  vm.runInContext(
    dvSrc + '\nwindow.Deriv = Deriv;\n' +
    dlSrc + '\nwindow.deLatex7 = deLatex;\n' + src +
    '\nwindow.Verify = Verify;\n' +
    '\nthis.__A = Verify.Algebra; this.__V = Verify; this.__D = Deriv;',
    sandbox, { timeout: 5000 });
  if (!sandbox.__A) throw new Error('Verify.Algebra was not exported');
  if (typeof sandbox.window.deLatex7 !== 'function') throw new Error('deLatex7 did not attach');

  /* The markdown renderer, for the synthetic-division layout. It sits in a
     different script block and leans on a few page helpers, so it gets its own
     small sandbox with those stubbed rather than being dragged into this one. */
  const mS = html.indexOf('/* ============================================================\n   SYNTHETIC DIVISION');
  const mE = html.indexOf('\n/* ================= exports =================');
  if (mS < 0 || mE < mS) throw new Error('could not find the synthetic-division renderer in index.html');
  const mdBox = {
    console, String, Number, Object, Array, RegExp, JSON, Math,
    parseInt, parseFloat, isNaN, isFinite, window: {},
    escapeHtml: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    unescapeHtml: (x) => String(x).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    sanitizeSvg: () => null,
  };
  vm.createContext(mdBox);
  vm.runInContext(html.slice(mS, mE) + '\nthis.__M = mdToHtml;', mdBox, { timeout: 5000 });
  if (typeof mdBox.__M !== 'function') throw new Error('mdToHtml did not load');

  return { A: sandbox.__A, V: sandbox.__V, D: sandbox.__D, M: mdBox.__M };
}

/* The same collapse from checks to a state that Checks::run performs. Kept
   here rather than read off the page so the two sides are compared on the
   rule, not on one side's implementation of it. */
/* ---------- what the two engines have in common ----------
   The browser runs 25 checkers; verify.php runs 13 of them. That is not drift,
   it is the design — a dozen checks (derivatives, divisibility, optimality,
   quantifiers) exist only where there is a student to show them to. Comparing
   a superset against a subset can never agree, which is why the old harness
   quietly recomposed only the thirteen shared checkers and never noticed that
   `units` was wired twice on the JS side.

   So the comparison is restricted to kinds a SHARED checker can produce, and
   that set is discovered by running the registry's checkers over the corpus
   rather than written down. Add a JS-only checker and its kinds are excluded
   automatically; its behaviour is still pinned by the ABSOLUTE corpus, which
   asserts real verdicts rather than engine agreement. Nothing here is a list
   anyone has to remember to update. */
function kindsOf(V, entries, cases) {
  const out = {};
  for (const e of entries) {
    const fn = V[e.name];
    if (typeof fn !== 'function') continue;
    /* Checkers take either (question, answer) or just (answer) — calling the
       one-argument kind with (q, a) silently analyses the QUESTION and returns
       nothing, which is how `agree` escaped this sweep and looked like a
       cross-engine divergence. Both shapes are tried and the kinds unioned;
       an over-broad sweep here costs nothing, a missed kind costs a false
       parity failure. */
    for (const c of cases) {
      for (const args of [[c.q, c.a], [c.a]]) {
        let r;
        try { r = fn.apply(null, args) || []; } catch (err) { continue; }
        for (const x of r) if (x && x.kind) out[x.kind] = 1;
      }
    }
  }
  return out;
}
function jsOnlyKinds(V, registry, cases) {
  const shared = kindsOf(V, registry.checks.filter((c) => c.php), cases);
  const only = kindsOf(V, registry.checks.filter((c) => !c.php), cases);
  /* a kind BOTH a shared and a JS-only checker can emit still has to match */
  Object.keys(shared).forEach((k) => { delete only[k]; });
  return only;
}

/* ---------- the one place the two engines are allowed to differ ----------
   Every state that means "a verdict was reached" must match exactly. The
   engines genuinely disagree on what to CALL the outcome when no verdict was
   reached: the browser distinguishes worked / explained / plain / partial so
   the badge can say what it did look at, while verify.php collapses all four
   into `unverified`. None of them claims verification, so an answer is never
   verified on one side and not the other — but the site and the API do label
   the same unverified answer differently, and that is a real API-contract
   difference a customer could trip over.

   This was invisible while the harness reimplemented the JS state machine
   with PHP's names. It is surfaced here rather than hidden, and deliberately
   NOT fixed inside either engine: renaming in the browser changes the badge,
   renaming in PHP changes a published API field, and that is a product call,
   not a test-harness one. Anything outside this family is a hard failure. */
const NOT_VERIFIED = { plain: 1, partial: 1, worked: 1, explained: 1, unverified: 1 };
function sameVerdict(jsState, phpState) {
  if (jsState === phpState) return true;
  return !!(NOT_VERIFIED[jsState] && NOT_VERIFIED[phpState]);
}

/* ---------- THE STATE CONTRACT ----------
   See VERIFICATION-CONTRACT.md. Every state either engine can produce maps to
   exactly one of three canonical outcomes, and the invariant is:

     no answer is ever `verified` in one engine and `disputed` or
     `unverified` in the other.

   The engines may disagree about how to DESCRIBE a not-verified answer — the
   browser splits it four ways so the badge can say what it looked at, PHP
   collapses it to one public `unverified`. They may never disagree about
   whether the mathematics was proved. That is the difference between a
   wording difference and telling a student their correct answer is wrong
   while telling an API customer it is right.

   A state missing from this table is a HARD failure, not a default: a state
   nobody has classified is a state nobody can reason about, and silently
   treating it as unverified is how a new `verified` synonym would slip
   through this test unnoticed. */
const CANONICAL = {
  checked: 'verified',
  disputed: 'disputed',
  stepfail: 'disputed',
  invalid_question: 'disputed',
  unverified: 'unverified',
  worked: 'unverified',
  explained: 'unverified',
  plain: 'unverified',
  partial: 'unverified',
};

function stateContract(pairs) {
  const bad = [];
  for (const p of pairs) {
    const j = CANONICAL[p.js], h = CANONICAL[p.php];
    if (!j) { bad.push(`contract: JS produced the unclassified state "${p.js}" — add it to ` +
                       'CANONICAL in parity.js and to VERIFICATION-CONTRACT.md'); continue; }
    if (!h) { bad.push(`contract: PHP produced the unclassified state "${p.php}" — add it to ` +
                       'CANONICAL in parity.js and to VERIFICATION-CONTRACT.md'); continue; }
    if (j === h) continue;
    bad.push('contract VIOLATION — ' + JSON.stringify(p.q.slice(0, 60)) +
             '\n            answer ' + JSON.stringify(p.a.replace(/\n/g, ' ').slice(0, 60)) +
             `\n            site says ${j} (${p.js}), api says ${h} (${p.php})` +
             '\n            an answer may never be verified on one surface and not the other');
  }
  return bad;
}

let REGISTRY = null, JS_ONLY = {};
/* the shipped answer-level list, parsed from index.html so there is one copy */
let ANSWER_LEVEL = null;
function loadAnswerLevel(html) {
  const m = html.match(/var ANSWER_LEVEL = {([^}]*)}/);
  if (!m) throw new Error("could not find ANSWER_LEVEL in index.html");
  const out = {};
  m[1].split(",").forEach((p) => {
    const kv = p.split(":");
    if (kv.length === 2 && kv[1].trim() === "1") out[kv[0].trim()] = 1;
  });
  if (!Object.keys(out).length) throw new Error("ANSWER_LEVEL parsed empty");
  return out;
}

function verdictOf(checks) {
  /* An impossible question is its own outcome, and it outranks every verdict
     about the answer — if the problem has no solution, "is the answer right"
     is not the question being asked. */
  if (checks.some((c) => c.invalidQuestion)) return 'invalid_question';
  const failed = checks.filter((c) => !c.ok && !c.soft);
  const passed = checks.filter((c) => c.ok);
  /* Answer-level kinds are READ OUT OF index.html, never listed here. This
     used to be a hand-kept copy — a third one, after the JS and the PHP — and
     it drifted the moment a new answer-level check was added: `roots` failed,
     the shipped engine called it disputed, and this harness called it stepfail
     and blamed PHP for the difference. A list that must match two other lists
     is a list that will not. */
  const ANSWER = ANSWER_LEVEL;
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

/* ---------- symbolic differentiation ----------
   LocalSolve answers these with no model, so its output is not compared
   between engines — it is compared against KNOWN RESULTS. A deterministic
   solver that is quietly wrong is more dangerous than an AI that hedges,
   because nothing downstream doubts it.

   Every bug found while building this lives here permanently. The bracket
   case is the one that matters most: a trailing \)? in the trigger regex
   turned sin(x) into "sin(x", the parse failed, and the whole path returned
   null in silence. It must never come back. */
const DERIVATIVES = [
  // core rules
  ['x^2',            '2 x'],
  ['x^3',            '3 x²'],
  ['x^4',            '4 x³'],
  ['5x^2 + 3x + 7',  '10 x + 3'],
  ['3x^5 - 2x^2',    '15 x⁴ − 4 x'],
  ['sin(x)',         'cos(x)'],
  ['cos(x)',         '−sin(x)'],
  ['ln(x)',          '1 / x'],
  // product, quotient, chain
  ['x*sin(x)',       'sin(x) + x cos(x)'],
  ['x*cos(x)',       'cos(x) − x sin(x)'],
  ['x^3*sin(x)',     '3 x² sin(x) + x³ cos(x)'],
  ['sin(x^2)',       'cos(x²) · 2 x'],
  ['exp(x^2)',       'exp(x²) · 2 x'],
  // REGRESSION: the trigger regex ate the closing bracket of sin(x)
  ['x^3 sin x',      '3 x² sin(x) + x³ cos(x)'],
  ['sin x',          'cos(x)'],
  // refusals — a wrong derivative that looks right is the worst outcome here
  ['x^x',            null],
  ['x*y',            null],
  ['floor(x)',       null],
];

/* ---------- ABSOLUTE VERDICTS (JS only) ----------

   VERDICTS above asks "do the two engines agree?". These cases ask the
   different question "is the verdict RIGHT?" — and they are JS-only on
   purpose: verify.php has no symbolic differentiator, so a derivative
   verdict has no PHP counterpart to be compared against. Running them
   through the parity corpus would only prove the two engines are equally
   silent.

   The tier cases are the ones that matter most. `agree` is a Tier 3 prose
   hint that once outranked mathematics: a correct derivative came back
   "partially verified" because the summary wording differed from the answer
   wording. If a refactor ever makes `agree` authoritative again, CASE A
   fails here rather than on a student's screen. */
const ABSOLUTE = [
  /* --- tier architecture --- */
  // CASE A  Tier 1 PASS + Tier 3 agree FAIL  => still VERIFIED
  ['tierA', 'Solve x^2-164x+424=0',
   '## ✅ Answer\n**x = 82 ± 30√7**\n\n## Summary\nThe roots are 82 + 30√7 and 82 − 30√7.',
   'checked'],
  // CASE B  Tier 1 FAIL => never verified, whatever else passes
  ['tierB', 'Solve x^2-164x+424=0', '## ✅ Answer\n**x = 88 - 30√7**', 'disputed'],
  // CASE C  all three tiers pass
  ['tierC', 'Solve x^2-4=0', '## ✅ Answer\nx = 2 and x = -2', 'checked'],
  // CASE D  Tier 1 FAIL + Tier 3 PASS => NOT verified
  ['tierD', 'Solve x^2-4=0',
   '## ✅ Answer\nx = 2 and x = 3\n\n## Summary\nx = 2 and x = 3', 'disputed'],

  /* --- derivatives: correct claims must reach VERIFIED --- */
  ['d+', 'differentiate x^3 sin x',  '## ✅ Answer\n**3x² sin(x) + x³ cos(x)**', 'checked'],
  ['d+', 'differentiate x^3*sin(x)', '## ✅ Answer\n**3x² sin(x) + x³ cos(x)**', 'checked'],
  ['d+', 'd/dx sin x',               '## ✅ Answer\n**cos(x)**',                 'checked'],
  ['d+', 'd/dx cos x',               '## ✅ Answer\n**-sin(x)**',                'checked'],
  ['d+', 'differentiate x*cos(x)',   '## ✅ Answer\n**cos(x) - x sin(x)**',      'checked'],
  ['d+', 'differentiate ln(x)',      '## ✅ Answer\n**1/x**',                    'checked'],
  ['d+', 'differentiate sqrt(x)',    '## ✅ Answer\n**1/(2 sqrt(x))**',          'checked'],
  ['d+', 'differentiate sin(x^2)',   '## ✅ Answer\n**2x cos(x^2)**',            'checked'],

  /* --- derivatives: wrong claims must be DISPUTED, not merely unverified ---
     These are hand-written answers in a shape LocalSolve never emits. The
     verifier must judge the mathematical claim, not recognise its own
     handwriting — a wrong derivative that merely goes unchecked is a wrong
     derivative shown to a student without a warning. */
  ['d-', 'differentiate x^3 sin x', '## ✅ Answer\n**3x² sin(x)**', 'disputed'],
  ['d-', 'differentiate x^3 sin x', '## ✅ Answer\n**x³ cos(x)**',  'disputed'],
  ['d-', 'd/dx sin x',              '## ✅ Answer\n**-cos(x)**',    'disputed'],

  /* --- the cubic, with all three roots verified individually ---
     x³ − 6x² + 11x − 6 factors as (x−1)(x−2)(x−3). Each root is pinned on its
     own as well as together, so a substitution regression that only breaks one
     of them cannot hide inside a combined answer. */
  ['cubic', 'Solve x^3 - 6x^2 + 11x - 6 = 0',
   '## ✅ Answer\n**x = 1, x = 2, x = 3**\n\n## 📝 Steps\n' +
   '1. Try x = 1: 1 − 6 + 11 − 6 = 0 ✓\n2. Divide by (x − 1) to get x² − 5x + 6\n' +
   '3. Factor: (x − 2)(x − 3)\n4. So x = 1, 2, 3', 'checked'],
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 2, x = 3**', 'checked'],
  /* Each root on its own is now INCOMPLETE, not verified — P0.5 changed this
     deliberately, and these three rows are the record of that change. Their
     original job, proving each of 1, 2 and 3 is genuinely a root, moved down
     to the EQUATIONS corpus where it is checked at the algebra layer in both
     engines; asserting it through a full answer verdict conflated "is this a
     root" with "is this the whole answer", which is the exact conflation P0.5
     exists to undo. */
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1**',               'disputed'],
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 2**',               'disputed'],
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 3**',               'disputed'],
  /* a root that is not a root must be caught, at each position */
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 2, x = 4**', 'disputed'],
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 0, x = 2, x = 3**', 'disputed'],
  ['cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = -1**',              'disputed'],

  /* KNOWN GAP, pinned deliberately — this asserts what the code DOES, not
     what it SHOULD do. A cubic answered with only two of its three roots is
     currently reported verified: every root offered does satisfy the
     equation, and nothing counts them against the degree. That is wrong for a
     student, who loses the mark for the missing root. It is pinned so the day
     someone adds a root-count check this line fails loudly and gets corrected
     to 'disputed', rather than the gap sitting unnoticed. Do not read this row
     as approval. */
  /* --- P0.5 solution completeness ---
     The gap that used to be pinned here is now closed: "x = 1, x = 2" on the
     cubic was reported verified, because both roots are genuine and nothing
     counted them against the degree. substitution answers "is every root
     offered real?"; this answers "are these all of them?".

     Note what is NOT being tested: a value count. (x−2)² = 0 has ONE distinct
     root with multiplicity two and must verify from "x = 2" alone, and
     x² + 1 = 0 has none at all over the reals. */
  ['complete',   'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 2, x = 3**', 'checked'],
  ['incomplete', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 2**',        'disputed'],
  ['incomplete', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 3**',        'disputed'],
  ['incomplete', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 2, x = 3**',        'disputed'],
  ['incomplete', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1**',               'disputed'],
  ['incomplete', 'Solve x^2-5x+6=0',       '## ✅ Answer\n**x = 2**',               'disputed'],
  ['incomplete', 'Solve x^2-4=0',          '## ✅ Answer\n**x = 2**',               'disputed'],
  /* multiplicity: one distinct value, and it must NOT be required twice */
  ['multiplicity', 'Solve (x-2)^2 = 0',    '## ✅ Answer\n**x = 2**',               'checked'],
  ['multiplicity', 'Solve x^2-4x+4=0',     '## ✅ Answer\n**x = 2**',               'checked'],
  /* a single-root equation must still verify from one value */
  ['one root',   'Solve 2x-10=0',          '## ✅ Answer\n**x = 5**',               'checked'],
  /* no real solutions is a COMPLETE answer, not an empty one */
  ['no real',    'Solve x^2+1=0',   '## ✅ Answer\nThere are no real solutions.',   'checked'],
  ['no real',    'Solve x^2+4=0',   '## ✅ Answer\nThis equation has no real roots.', 'checked'],
  /* irrational pair, both sides of the ± present: complete */
  ['irrational', 'Solve x^2-164x+424=0',   '## ✅ Answer\n**x = 82 ± 30√7**',       'checked'],
];

/* ---------- SYNTHETIC DIVISION RENDERER ----------
   Alignment is the method here: which product sits under which coefficient is
   the whole content. Unfenced, these lines used to take the paragraph branch,
   the runs of spaces collapsed, and the layout was destroyed.

   The last two cases are the important ones. The renderer re-derives the
   arithmetic from the root and the top row, and anything that does not
   reconcile stays preformatted — a wrong computation must never be handed the
   authority of a clean table. */
const SYNDIV = [
  ['classic',        '2 | 1  -6  11  -6\n  |    2  -8    6\n------------------\n    1  -4   3    0', true],
  ['box drawing',    '1 │  1  -6  11  -6\n  │      1  -5   6\n  ├───────────────\n     1  -5   6   0', true],
  ['no products row','3 | 1  -6  11  -6\n----------------\n  1  -3   2   0', true],
  ['negative root',  '-1 | 1  1  -4  -4\n   |   -1   0   4\n-----------------\n     1  0  -4   0', true],
  ['wrong result',   '2 | 1  -6  11  -6\n  |    2  -8    6\n------------------\n    1  -4   3    5', false],
  ['wrong product',  '2 | 1  -6  11  -6\n  |    2  -9    6\n------------------\n    1  -4   3    0', false],
  ['not a division', '1 | 2\n  | 3', false],

  /* LaTeX array form — the same division, written the other way models write
     it. This leaked to a student's screen as raw "r|rrrr … \hline" on a
     flagship cubic answer. deLatex strips the \begin{array}{…} wrapper but
     leaves the column spec on its own line, and sometimes eats the backslash
     off \hline too, so all three spellings are pinned here.

     These go through the SAME reconciliation gate as the ASCII form: the LaTeX
     path converts to the ASCII layout and hands it to synDivParse rather than
     re-implementing the arithmetic check. A wrong LaTeX block must fall back
     to preformatted text exactly as a wrong ASCII block does — a polished
     table is a claim of correctness, and it is never made on unchecked
     numbers. */
  ['latex correct',    '\\begin{array}{r|rrrr}\n1 & 1 & -6 & 11 & -6 \\\\\n  &   & 1 & -5 & 6 \\\\\n\\hline\n  & 1 & -5 & 6 & 0\n\\end{array}', true],
  ['latex remnant',    'r|rrrr\n1 & 1 & -6 & 11 & -6\n& & 1 & -5 & 6\n\\hline\n& 1 & -5 & 6 & 0', true],
  ['latex no backslash', 'r|rrrr\n1 & 1 & -6 & 11 & -6\n& & 1 & -5 & 6\nhline\n& 1 & -5 & 6 & 0', true],
  ['latex negative',   'r|rrrr\n-1 & 1 & 1 & -4 & -4\n& & -1 & 0 & 4\n\\hline\n& 1 & 0 & -4 & 0', true],
  ['latex multi-digit','r|rrrr\n12 & 1 & -20 & 115 & -156\n& & 12 & -96 & 228\n\\hline\n& 1 & -8 & 19 & 72', true],
  ['latex wrong middle', 'r|rrrr\n1 & 1 & -6 & 11 & -6\n& & 1 & -9 & 6\n\\hline\n& 1 & -5 & 6 & 0', false],
  ['latex wrong bottom', 'r|rrrr\n1 & 1 & -6 & 11 & -6\n& & 1 & -5 & 6\n\\hline\n& 1 & -5 & 6 & 7', false],
  /* an ordinary array must stay an ordinary array */
  ['latex plain matrix', '\\begin{array}{cc}\n1 & 2 \\\\\n3 & 4\n\\end{array}', false],
  ['latex data table',  '\\begin{array}{r|rr}\nx & y & z \\\\\n\\hline\n1 & 2 & 3\n\\end{array}', false],
  ['latex too few coeffs', 'r|rr\n1 & 1 & -1\n\\hline\n& 1 & 0', false],
];

/* The two spellings of one division must render to the same HTML. Without
   this, the LaTeX path could drift into a second layout that merely looks
   similar, and the divergence would only show up on a student's screen. */
const SYNDIV_EQUIV = [
  ['1 | 1  -6  11  -6\n  |    1  -5    6\n------------------\n    1  -5   6    0',
   'r|rrrr\n1 & 1 & -6 & 11 & -6\n& & 1 & -5 & 6\n\\hline\n& 1 & -5 & 6 & 0'],
  ['-1 | 1  1  -4  -4\n   |   -1   0   4\n-----------------\n     1  0  -4   0',
   'r|rrrr\n-1 & 1 & 1 & -4 & -4\n& & -1 & 0 & 4\n\\hline\n& 1 & 0 & -4 & 0'],
];

/* ---------- REGISTRY CONFORMANCE ----------
   checks.json is the canonical list of production checkers. This asserts it
   against the two shipped pipelines in BOTH directions:

     registry → pipeline   a registered check must still be wired, or the
                           registry is describing a checker that no longer runs
     pipeline → registry   a checker wired into production must be registered,
                           or it silently escapes negative-control coverage

   The second direction is the one that matters, and it is the whole point of
   this exercise: before it existed, a new checker could be added to run() in
   both engines, ship, and never be removal-tested — the exact wiring bug the
   negative controls are for. Now the suite fails until it is registered.

   This reads the composition block of each run(), not arbitrary source: the
   registry holds the shared definition, and this only confirms nothing has
   appeared in production that the registry has not been told about. */
function checkRegistry(registry, html, php) {
  const bad = [];
  const rs = html.indexOf('var checks = [];', html.indexOf('var Verify = (function(){'));
  const rend = html.indexOf('var PROOF = {', rs);
  const ps = php.indexOf('$checks = array_merge(');
  const pend = php.indexOf('\n        );', ps);
  if (rs < 0 || rend < rs) return ['registry: could not locate Verify.run in index.html'];
  if (ps < 0 || pend < ps) return ['registry: could not locate Checks::run in verify.php'];
  const jsBody = html.slice(rs, rend), phpBody = php.slice(ps, pend);

  const names = new Set();
  for (const c of registry.checks) {
    if (names.has(c.name)) bad.push(`registry: "${c.name}" is listed twice`);
    names.add(c.name);
    if (!jsBody.includes(c.js))
      bad.push(`registry: "${c.name}" is registered but its JS wiring is not in Verify.run`);
    if (c.php && !phpBody.includes(c.php))
      bad.push(`registry: "${c.name}" is registered but its PHP wiring is not in Checks::run`);
  }

  /* pipeline → registry: every checker invoked in either composition */
  /* A checker is a call whose RESULT reaches `checks`. Scanning every call in
     the body instead swept up uParse, uRender and the other local helpers and
     demanded they be registered as checkers, which would have made the
     registry a list of everything rather than a list of checks. Two shapes
     count: a result concatenated directly, and a result parked in a local that
     is concatenated afterwards (extremumCheck does exactly that). */
  const jsCalled = [];
  for (const L of jsBody.split('\n')) {
    if (!L.includes('checks')) continue;
    for (const m of L.matchAll(/(?:concat\(|=\s*)([A-Za-z_$][\w$]*)\s*\(/g))
      if (m[1] !== 'checks' && m[1] !== 'concat') jsCalled.push(m[1]);
  }
  for (const m of jsBody.matchAll(/checks\s*=\s*checks\.concat\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const via = jsBody.match(new RegExp('\\b(?:var|let|const)\\s+' + m[1] + '\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\('));
    if (via) jsCalled.push(via[1]);
  }
  for (const n of new Set(jsCalled)) {
    if (!names.has(n))
      bad.push(`registry: Verify.run calls "${n}" but checks.json does not list it — ` +
               'register it so it gets negative-control coverage');
  }
  const phpCalled = [...phpBody.matchAll(/(?:self|[A-Za-z]+)::([A-Za-z_]\w*)\s*\(/g)].map((m) => m[0]);
  for (const call of new Set(phpCalled)) {
    if (!registry.checks.some((c) => c.php && c.php.includes(call)))
      bad.push(`registry: Checks::run calls "${call}" but checks.json does not list it — ` +
               'register it so it gets negative-control coverage');
  }
  return bad;
}

function checkSynDiv(mdToHtml) {
  const bad = [];
  for (const [name, src, wantTable] of SYNDIV) {
    let got;
    try { got = /table class="sd"/.test(mdToHtml(src)); }
    catch (e) { bad.push(`syndiv ${name} THREW ${e.message}`); continue; }
    if (got !== wantTable) {
      bad.push(`syndiv ${name}\n            got  ${got ? 'table' : 'fallback'}` +
               `\n            want ${wantTable ? 'table' : 'fallback'}`);
    }
  }
  for (const [ascii, latex] of SYNDIV_EQUIV) {
    let a, l;
    try { a = mdToHtml(ascii); l = mdToHtml(latex); }
    catch (e) { bad.push('syndiv equivalence THREW ' + e.message); continue; }
    if (a !== l) {
      bad.push('syndiv equivalence: the ASCII and LaTeX spellings of one division ' +
               'render differently\n            ascii ' + a.slice(0, 90) +
               '\n            latex ' + l.slice(0, 90));
    }
  }
  return bad;
}

function checkAbsolute(V, verdictOf) {
  const bad = [];
  for (const [tag, q, a, want] of ABSOLUTE) {
    let got;
    try { got = V.run(q, a).state; } catch (e) { got = 'THREW: ' + e.message; }
    if (got !== want) {
      bad.push(`verdict[${tag}] ${JSON.stringify(q)}\n            answer ${JSON.stringify(a.replace(/\n/g, ' ').slice(0, 60))}` +
               `\n            got  ${got}\n            want ${want}`);
    }
  }
  return bad;
}

function checkDerivatives(D, A) {
  const bad = [];
  for (const [src, want] of DERIVATIVES) {
    let got = null;
    try { const r = D.of(A, src, null); got = r ? r.result : null; } catch (e) { got = 'THREW: ' + e.message; }
    if (got !== want) {
      bad.push(`deriv  d/dx ${JSON.stringify(src)}\n            got  ${JSON.stringify(got)}\n            want ${JSON.stringify(want)}`);
    }
  }
  return bad;
}

/* ---------- LOAD ORDER ----------
   `var W = window` is declared partway down the page. A TOP-LEVEL `W.x = …`
   in any earlier script block throws ReferenceError at load and aborts the
   rest of that block — silently, because nothing catches it and the page
   still paints.

   That is exactly what broke the Solve button in .36: three exports added at
   the bottom of a new module ran before W existed, and everything after them
   in that block — including the answer pipeline — never executed.

   Syntax checks cannot see this. A parser is happy with W.x; only the running
   order makes it wrong. So the shape is checked here instead: statements at
   column 0 execute at load, statements inside a function do not. */
function checkLoadOrder(html) {
  const bad = [];
  const marks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].map((m) => m.index);
  const blockOf = (i) => marks.filter((x) => x < i).length;
  const wDecl = html.search(/(?:^|\n)\s*var\s+W\s*=\s*window/);
  if (wDecl < 0) return ['load-order: `var W = window` not found — this guard is stale'];
  const wBlock = blockOf(wDecl);

  const lines = html.split('\n');
  let offset = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    /* Column 0 means it runs when the block does. Indented code is inside
       something, and by the time that something is CALLED, W exists. */
    if (/^W\./.test(line) && blockOf(offset) < wBlock) {
      bad.push(`load-order: line ${n + 1} runs "W." at load, before W exists (block ` +
               `${blockOf(offset)} < ${wBlock}) — use window.* there`);
    }
    offset += line.length + 1;
  }
  return bad;
}

/* ---------- compare ---------- */
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : 'NaN';
  return v;
}

(function main() {
  ANSWER_LEVEL = loadAnswerLevel(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8'));
  REGISTRY = JSON.parse(fs.readFileSync(path.join(HERE, 'checks.json'), 'utf8'));
  const { A, V, D, M } = loadJs();

  const evalCases = [];
  for (const src of EXPRS) for (const env of ENVS) evalCases.push({ src, env });

  const holdCases = [];
  for (const [src, envs] of EQUATIONS) for (const env of envs) holdCases.push({ src, env });

  const varCases = EQUATIONS.map(([src]) => src);

  const verdictCases = VERDICTS.map(([q, a]) => ({ q, a }));
  JS_ONLY = jsOnlyKinds(V, REGISTRY, verdictCases);
  const contractPairs = [];

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
    /* BOTH sides call their own production run(). This used to recompose the
       pipeline by hand on the JS side while PHP called run() — thirteen
       checkers listed in a fourteenth place, so a checker added to production
       and forgotten here made the harness compare two different pipelines and
       pass. There is now nothing to forget: whatever run() composes is what
       gets compared, in both languages. */
    const r = V.run(c.q, c.a);
    const checks = (r.checks || []).filter((x) => !JS_ONLY[x.kind]);
    const sig = checks.map((x) => x.kind + (x.ok ? '+' : '-')).sort().join(',');
    const js = { state: r.state, n: checks.length, sig };
    const ph = php.verdicts[i];
    contractPairs.push({ q: c.q, a: c.a, js: js.state, php: ph.state });
    if (!sameVerdict(js.state, ph.state) || js.n !== ph.n || js.sig !== ph.sig) {
      bad.push('verdict ' + JSON.stringify(c.q.slice(0, 70)) +
               '\n            answer ' + JSON.stringify(c.a.replace(/\n/g, ' ').slice(0, 70)) +
               '\n            js =' + js.state + '(' + js.n + ') [' + js.sig + ']' +
               '\n            php=' + ph.state + '(' + ph.n + ') [' + ph.sig + ']');
    }
  });

  /* the JS/PHP state contract: never verified here and not-verified there */
  bad.push(...stateContract(contractPairs));

  /* load order: a top-level W.* before W exists kills the rest of its block */
  bad.push(...checkLoadOrder(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')));

  /* derivatives: checked against known results, not engine-to-engine */
  if (D) bad.push(...checkDerivatives(D, A));

  /* absolute verdicts: is it RIGHT, not merely is it the same on both sides */
  bad.push(...checkAbsolute(V, verdictOf));

  /* the synthetic-division layout: structural, not engine-to-engine */
  bad.push(...checkSynDiv(M));

  /* the canonical registry must match both shipped pipelines, both ways */
  bad.push(...checkRegistry(REGISTRY,
    fs.readFileSync(path.join(HERE, 'index.html'), 'utf8'),
    fs.readFileSync(path.join(HERE, 'verify.php'), 'utf8')));

  const total = evalCases.length + holdCases.length + varCases.length +
                verdictCases.length + DERIVATIVES.length + ABSOLUTE.length +
                SYNDIV.length + SYNDIV_EQUIV.length + contractPairs.length +
                (process.env.PARITY_NO_REGISTRY === '1' ? 0 : REGISTRY.checks.length);
  if (bad.length) {
    console.log(`\nPARITY FAILED — ${bad.length} of ${total} cases disagree\n`);
    bad.slice(0, 40).forEach((b) => console.log('  ' + b));
    if (bad.length > 40) console.log(`  ...and ${bad.length - 40} more`);
    console.log('\nThe two engines must agree before this ships.\n');
    process.exit(1);
  }
  console.log(`parity OK — ${total} cases, JS and PHP agree on every one`);
})();
