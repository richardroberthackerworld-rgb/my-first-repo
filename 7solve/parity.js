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
  /* DOMAIN, COMPLETENESS AND SEQUENCE IDENTIFICATION — added 2026-08-23 with the
     checkers themselves. Each of these was a wrong verdict before them:

       "positive integers" answered −2          reached `checked`
       three verified pairs of a Markov-type    reached `checked` on
         equation with infinitely many          substitution alone
       1, 1, 2, 5, 13 called "Fibonacci"        was never read at all

     They live here rather than only in adversarial.js because these three
     checkers exist in BOTH engines, and a rule ported to one and not the other
     is the divergence this corpus is for. */
  ['Find all positive integers n with n^2-4=0.', '## ✅ Answer\nn = 2 and n = -2'],
  ['Find all positive integers n with n^2-4=0.', '## ✅ Answer\nn = 2'],
  ['Find all integers n with n^2-4=0.',          '## ✅ Answer\nn = 2 and n = -2'],
  ['Find all non-negative integers n with n^2-n=0.', '## ✅ Answer\nn = 0 and n = 1'],
  ['Find all distinct positive integers x,y with x+y=4.', '## ✅ Answer\n(2,2)'],
  ['Find all primes p with p^2-4=0.',            '## ✅ Answer\np = 2'],
  ['Find all primes p with p^2-4=0.',            '## ✅ Answer\np = 2 and p = -2'],
  ['Find all primes p with p^2-4p+3=0.',         '## ✅ Answer\np = 3'],
  ['Find all primes p with p^2-4p+3=0.',         '## ✅ Answer\np = 1 and p = 3'],
  ['Find all positive integers x,y with x > y and x+y=10.', '## ✅ Answer\n(3,7)'],
  ['Find all positive integers x,y with x > y and x+y=10.', '## ✅ Answer\n(7,3)'],
  /* COUNTEREXAMPLES AND THE TWO NEW COMPLETENESS ROUTES — added with the
     checkers. A universal claim refuted by one value, a Diophantine equation
     killed by a modular obstruction, and a range the question itself stated. */
  ['Is n^2+n+41 always prime?', '## ✅ Answer\nn^2 + n + 41 is prime for every n.'],
  ['Show the inequality holds.', '## ✅ Answer\nFor all n, n^2 > 2n.'],
  ['Show the inequality holds.', '## ✅ Answer\nFor all n, n^2 + 1 > n.'],
  ['Is the expression positive?', '## ✅ Answer\nThe expression x^2 - 4 is always positive.'],
  ['Is the expression positive?', '## ✅ Answer\nThe expression x^2 + 1 is always positive.'],
  ['Solve x + e^x = 0',          '## ✅ Answer\nNo real solution, because e^x is always positive.'],
  ['Find all integers x,y with x^2-3y^2=2.', '## ✅ Answer\nThere are no integer solutions.'],
  ['Find all integers x,y with x^2-3y^2=2.', '## ✅ Answer\nThe solutions are (2,1) and (5,3).'],
  ['Find all integers x,y with x^2-3y^2=1.', '## ✅ Answer\n(1,0) and (2,1)'],
  ['Find all positive integers n with 1 <= n <= 100 such that n^2-9=0.', '## ✅ Answer\nn = 3'],
  ['Find all positive integers n with n <= 100 such that n^2-5n+6=0.',   '## ✅ Answer\nn = 2'],
  ['Find all positive integers n with n <= 100 such that n^2-5n+6=0.',   '## ✅ Answer\nn = 2 and n = 3'],

  /* CLOSED-FORM ARITHMETIC, THE DERIVATION CHAIN, AND AN EQUATION THAT BOUNDS
     ITS OWN VARIABLES. All three live in both engines, so a rule ported to one
     and not the other is exactly the divergence this corpus exists to catch. */
  ['What is 2^10?',            '## ✅ Answer\n2^10 = 1024'],
  ['What is 2^10?',            '## ✅ Answer\n2^10 = 1000'],
  ['Simplify √144',            '## ✅ Answer\n√144 = 12'],
  ['Simplify √144',            '## ✅ Answer\n√144 = 14'],
  ['Evaluate (3+4)²',          '## ✅ Answer\n(3+4)² = 49'],
  ['Evaluate (3+4)²',          '## ✅ Answer\n(3+4)² = 25'],
  ['What is 15% of 200?',      '## ✅ Answer\n15% of 200 = 30'],
  ['What is 15% of 200?',      '## ✅ Answer\n15% of 200 = 35'],
  ['Solve 2x^2 = 6x',          '## ✅ Answer\nx = 3\n\n## 📖 Steps\n1. Start from 2x^2 = 6x.\n2. Divide both sides by x: 2x = 6.\n3. So x = 3.'],
  ['Solve 2x^2 = 6x',          '## ✅ Answer\nx = 0 and x = 3\n\n## 📖 Steps\n1. Either x = 0, or dividing by x gives 2x = 6.\n2. So x = 0 or x = 3.'],
  ['Solve 2(x+3) - 4 = 10',    '## ✅ Answer\nx = 4\n\n## 📖 Steps\n1. 2(x+3) - 4 = 10\n2. 2x + 6 - 4 = 10\n3. 2x + 2 = 10\n4. 2x = 8\n5. x = 4'],
  ['Find all positive integers x,y with 3x + 5y = 31.', '## ✅ Answer\n(7,2) and (2,5)'],
  ['Find all positive integers x,y with 3x + 5y = 31.', '## ✅ Answer\n(7,2)'],
  ['Find all positive integers x,y with x^2 + y^2 = 25.', '## ✅ Answer\n(3,4) and (4,3)'],

  /* DOUBLE ENTRY, in both engines. Accounting was the largest unverifiable
     subject in the manifest and the one this product's audience is named
     after; the law it rests on is arithmetic and belongs in the corpus. */
  ['Pass the journal entry.', '## ✅ Answer\nCash A/c Dr. 50,000\n    To Sales A/c 50,000'],
  ['Pass the journal entry.', '## ✅ Answer\nCash A/c Dr. 50,000\n    To Sales A/c 45,000'],
  ['Pass the journal entry.', '## ✅ Answer\nCash A/c Dr. 30,000\nDebtors A/c Dr. 20,000\n    To Sales A/c 50,000'],
  ['Prepare the balance sheet.', '## ✅ Answer\nTotal Assets 8,50,000\nTotal Liabilities and Capital 8,50,000'],
  ['Prepare the balance sheet.', '## ✅ Answer\nTotal Assets 8,50,000\nTotal Liabilities and Capital 8,00,000'],
  ['Is it always true?', '## ✅ Answer\nFor all x, y, z, x^2 + y^2 + z^2 > 2xyz.'],
  ['Is it always true?', '## ✅ Answer\nFor all x, y, z, x^2 + y^2 + z^2 >= 0.'],
  ['Find all positive integers x,y with xy = 12.', '## ✅ Answer\n(1,12), (2,6), (3,4), (4,3), (6,2) and (12,1)'],
  ['Find all non-negative integers x,y with xy = 12.', '## ✅ Answer\n(1,12)'],

  /* UNIT ARITHMETIC. The dimensional analyser knows km and m are both lengths
     and deliberately not how many of one make the other, so a wrong conversion
     and a unit that does not follow from the working were both invisible. Both
     engines carry the new table, so both must read these the same way. */
  ['Find the force.',   '## ✅ Answer\nF = 5 kg × 2 m/s² = 10 N'],
  ['Find the force.',   '## ✅ Answer\nF = 5 kg × 2 m/s² = 10 J'],
  ['Find the force.',   '## ✅ Answer\nF = 5 kg × 2 m/s² = 20 N'],
  ['Convert to m/s.',   '## ✅ Answer\n60 km/h = 16.67 m/s'],
  ['Convert to m/s.',   '## ✅ Answer\n60 km/h = 21 m/s'],
  ['Convert to metres.','## ✅ Answer\n2.5 km = 2500 m'],
  ['Convert to metres.','## ✅ Answer\n2.5 km = 250 m'],
  ['Convert to kelvin.','## ✅ Answer\n25 °C = 298 K'],
  ['Convert to kelvin.','## ✅ Answer\n25 °C = 25 K'],
  ['Find the work done.','## ✅ Answer\nW = 5 N × 3 m = 15 J'],
  ['Find the work done.','## ✅ Answer\nW = 5 N × 3 m = 15 N'],
  ['Find the power.',   '## ✅ Answer\nP = 12 V × 2 A = 24 W'],
  ['Find the power.',   '## ✅ Answer\nP = 12 V × 2 A = 24 J'],
  ['Find the concentration.', '## ✅ Answer\nc = 0.5 mol / 2 L = 0.25 mol/L'],
  ['Find the concentration.', '## ✅ Answer\nc = 0.5 mol / 2 L = 0.5 mol/L'],

  /* Self-talk written as bullets. The line-start anchor in LEAK_RE did not
     survive the "*   " in between, so the loudest leak this engine has ever
     seen went unreported — in both languages, which is why it belongs here. */
  ['Solve it.', '## ✅ Answer\nx = 3\n\n## 📖 Steps\n    *   Wait, the previous message used x^2.\n    *   Let me recheck that.'],
  ['Solve it.', '## ✅ Answer\nx = 3\n\n## 📖 Steps\n1. Add 6 to both sides.\n2. Divide by 3.'],

  /* A CLAIM OF COMPLETENESS REFUTED BY ONE WITNESS. Both engines run the
     search, so both must find the same solution the answer left out — and
     both must stay silent on an answer that describes a process instead of a
     closed list. */
  ['Find all positive integers x,y,z satisfying x^2+y^2+z^2=xyz.', '## ✅ Answer\nThe only positive integer triple is (3, 3, 3).'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc.', '## ✅ Answer\nAll solutions arise from (1,1,1) by the Vieta jump.'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc.', '## ✅ Answer\nThere are infinitely many; the first are (1,1,1), (1,1,2), (1,2,5).'],

  /* A family that is right and still not all of them. Both engines run the
     high-water-mark rule, so both must find (6,15,87) — and both must stay
     silent on a family whose prefix is complete as far as it goes. */
  ['Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz.',
   '## ✅ Answer\nAll positive integer solutions are the permutations of the infinite family (3, an, an+1) where an+2 = 3an+1 - an.\nThe first few triples are (3,3,3), (3,3,6), (3,6,15), (3,15,39), (3,39,102), …'],
  ['Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   '## ✅ Answer\nThe recurrence generates (1,1,1), (1,1,2), (1,2,5), (1,5,13), (2,5,29).'],

  /* THE SAME FALSE ANSWER UNDER FOUR PHRASINGS. Two of them used to earn a
     green badge, because every completeness gate read "find all" out of the
     QUESTION while the claim was being made by the ANSWER. Both engines now
     read the answer's own claim, so both must agree on all four. */
  ['Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz.', '## ✅ Answer\nThe only positive integer triple (x, y, z) satisfying x^2 + y^2 + z^2 = xyz is (3, 3, 3).'],
  ['Solve x^2 + y^2 + z^2 = xyz in positive integers.',              '## ✅ Answer\nThe only positive integer triple (x, y, z) satisfying x^2 + y^2 + z^2 = xyz is (3, 3, 3).'],
  ['Find all x, y, z with x^2 + y^2 + z^2 = xyz.',                   '## ✅ Answer\nThe only positive integer triple (x, y, z) satisfying x^2 + y^2 + z^2 = xyz is (3, 3, 3).'],
  ['x^2 + y^2 + z^2 = xyz',                                          '## ✅ Answer\nThe only positive integer triple (x, y, z) satisfying x^2 + y^2 + z^2 = xyz is (3, 3, 3).'],
  /* and the control: examples offered, nothing claimed */
  ['Solve x^2 + y^2 + z^2 = xyz in positive integers.',
   '## ✅ Answer\nHere are some solutions: (3,3,3) and (3,3,6).'],
  /* A list that is right as far as the search reaches, with completeness
     still unproved: (577,408) is outside the box, so no witness exists and
     needsComplete is the only thing holding the badge back. */
  ['Solve x^2 - 2y^2 = 1 in positive integers.', '## ✅ Answer\nThe only solutions are (3,2), (17,12) and (99,70).\n\n## 📖 Steps\n1. By induction, with base case (3,2), no others exist.'],
  ['Find all positive integers x,y with x^2 + y^2 = 25.', '## ✅ Answer\n(3,4) and (4,3)'],

  /* DOUBLE ENTRY, in both engines. Accounting was the largest unverifiable
     subject in the manifest and the one this product's audience is named
     after; the law it rests on is arithmetic and belongs in the corpus. */
  ['Pass the journal entry.', '## ✅ Answer\nCash A/c Dr. 50,000\n    To Sales A/c 50,000'],
  ['Pass the journal entry.', '## ✅ Answer\nCash A/c Dr. 50,000\n    To Sales A/c 45,000'],
  ['Pass the journal entry.', '## ✅ Answer\nCash A/c Dr. 30,000\nDebtors A/c Dr. 20,000\n    To Sales A/c 50,000'],
  ['Prepare the balance sheet.', '## ✅ Answer\nTotal Assets 8,50,000\nTotal Liabilities and Capital 8,50,000'],
  ['Prepare the balance sheet.', '## ✅ Answer\nTotal Assets 8,50,000\nTotal Liabilities and Capital 8,00,000'],
  ['Is it always true?', '## ✅ Answer\nFor all x, y, z, x^2 + y^2 + z^2 > 2xyz.'],
  ['Is it always true?', '## ✅ Answer\nFor all x, y, z, x^2 + y^2 + z^2 >= 0.'],
  ['Find all positive integers n with n^2=2^n.', '## ✅ Answer\nn = 2 and n = 4'],
  ['Find all positive integers n with n^2=2^n.', '## ✅ Answer\nn = 2'],
  ['Find all positive integers x,y satisfying x^2+xy+y^2=3^{x+y}.',
   '## ✅ Answer\nThere are no positive integer solutions.'],
  ['Find all positive integers x,y satisfying x^2+xy+y^2=3^{x+y}.',
   '## ✅ Answer\nThe solutions are (1,2) and (2,1).'],
  ['Find all positive integers x,y with x^2+y^2+1=3xy.',
   '## ✅ Answer\nThe solutions are (1,1), (2,5) and (5,13).'],
  ['What sequence is this?', '## ✅ Answer\nIt is the Fibonacci sequence 1, 1, 2, 5, 13, 34.'],
  ['What sequence is this?', '## ✅ Answer\nIt is the Fibonacci sequence 1, 1, 2, 3, 5, 8, 13.'],
  ['What sequence is this?', '## ✅ Answer\nIt is an arithmetic progression 2, 5, 8, 11, 15.'],
  ['What sequence is this?', '## ✅ Answer\nIt is a geometric sequence 3, 6, 12, 24, 49.'],
  ['What sequence is this?', '## ✅ Answer\nThey are the triangular numbers 1, 3, 6, 15.'],
  /* Descent named without its obligations, and descent with them. */
  ['Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Answer\nAll solutions arise from (1,1,1) by Vieta jumping.'],
  ['Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Answer\nAll solutions arise from (1,1,1).\n\n## 📝 Steps\n1. The second root x\' = 3yz - x is an integer.\n2. It is strictly smaller when x is largest.\n3. The descent terminates; the base case is (1,1,1).'],
  /* THE DESCENT AND PELL ENGINES. Both classify an INFINITE solution set,
     which nothing else in either engine does, and both are new in two
     languages at once — so every branch of both is driven from here.
     A three-family equation, a two-family Pell equation, a proved-empty one,
     a claimed non-solution, and the shapes each engine must DECLINE. */
  ['Find all positive integers x,y with x^2+y^2-5xy=25.',
   '## ✅ Answer\nStarting from (1,8) and jumping, all solutions are (1,8), (8,39), (39,187), and so on.'],
  ['Find all positive integers x,y with x^2+y^2-5xy=25.',
   '## ✅ Answer\nThere are three families, from (1,8), (3,16) and (5,25); each generates the rest by the jump.'],
  ['Find all positive integers x,y,z with x^2+y^2+z^2=xyz.',
   '## ✅ Answer\nThe only positive integer triple is (3,3,3).'],
  ['Find all positive integers x,y,z with x^2+y^2+z^2=xyz.',
   '## ✅ Answer\nEvery solution is obtained from (3,3,3) by the jumps; for example (3,3,6), (3,6,15), (6,15,87).'],
  ['Find all positive integers x,y,z with x^2+y^2+z^2=5xyz.',
   '## ✅ Answer\nThere are no positive integer solutions.'],
  ['Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Answer\nAll solutions arise from (1,2,3) by Vieta jumping.'],
  ['Find all positive integers x,y with x^2-2y^2=7.',
   '## ✅ Answer\nThe solutions are obtained from (3,1) by the fundamental unit: (3,1), (13,9), (75,53), and so on.'],
  ['Find all positive integers x,y with x^2-2y^2=7.',
   '## ✅ Answer\nThere are two families, obtained from (3,1) and (5,3) by the fundamental unit, and so on.'],
  ['Find all positive integers x,y with x^2-2y^2=1.',
   '## ✅ Answer\nThe only solutions are (3,2), (17,12) and (99,70).'],
  ['Find all positive integers x,y with x^2-4y^2=9.',
   '## ✅ Answer\nThe only solution is (5,2), obtained from the unit and so on.'],
  ['Find all positive integers x,y with 2x^2+3y^2=5xy+1.',
   '## ✅ Answer\nAll solutions arise from (1,1) by jumping.'],
  ['Find all positive integers x,y,z with x^2+y^2+z^2=xyz.',
   '## ✅ Answer\nThe solutions are (3,3,3) and (3,3,6). The next one is'],
  /* SUPERSCRIPT LETTERS AND SIGNS. Decoded in deLatex, which exists in both
     engines — an equation the site can read and the API cannot is exactly the
     disagreement this file exists to stop. */
  ['Solve 2\u207f\u207a\u00b9 = 8 for n.', '## ✅ Answer\nn = 2'],
  ['Solve 2\u207f\u207a\u00b9 = 8 for n.', '## ✅ Answer\nn = 3'],
  ['Find all positive integers x,y satisfying x\u00b2+xy+y\u00b2=3\u02e3\u207a\u02b8.',
   '## ✅ Answer\nThere are no positive integer solutions.'],
  ['Find all positive integers x,y satisfying x\u00b2+xy+y\u00b2=3\u02e3\u207a\u02b8.',
   '## ✅ Answer\nThe solutions are (1,2) and (2,1).'],
  ['Solve 10\u207b\u00b3 \u00d7 x = 5', '## ✅ Answer\nx = 5000'],
  /* THE CONCLUSION IN THE WORKING. The ✅ section names a triple and claims
     nothing; step 12 claims it is the only one. Both engines must read the
     claim from the same place or the API and the site disagree on a false
     answer, which is the worst shape this corpus exists to catch. */
  ['Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz',
   '## ✅ Final Answer\n' +
   '**(x, y, z) = (3, 3, 3)**\n' +
   '\n## 📖 Step-by-Step Solution\n' +
   '1. Because the equation is symmetric, let x ≤ y ≤ z.\n' +
   '2. From x²+y²+z² = xyz we have z² ≤ xyz, so xy ≥ z.\n' +
   '3. Also xyz = x²+y²+z² ≤ 3z², so xy ≤ 3z.\n' +
   '4. Hence z ≤ xy ≤ 3z. Write xy = kz with integer k in 1,2,3.\n' +
   '5. Case k=1: x² + y² = 0, impossible for positive integers.\n' +
   '6. Case k=2: x²y² = 4(x² + y²), which has no positive integer solutions.\n' +
   '7. Case k=3: 2x²y² = 9(x² + y²), so 1/x² + 1/y² = 2/9.\n' +
   '9. Try x = 3: 1/9 + 1/y² = 2/9, so y = 3.\n' +
   '11. With x = y = 3 and xy = 3z, we get 9 = 3z so z = 3.\n' +
   '12. Conclusion – The only positive integer triple satisfying the original equation is (3,3,3).\n' +
   '\n## 🔍 Verification\nLHS: 3² + 3² + 3² = 27. RHS: 3 · 3 · 3 = 27.\n' +
   '\n## 🎯 Final Result\n(x, y, z) = (3, 3, 3)'
  ],
  ['x^2+y^2+z^2=xyz',
   '## ✅ Final Answer\n' +
   '**(x, y, z) = (3, 3, 3)**\n' +
   '\n## 📖 Step-by-Step Solution\n' +
   '1. Because the equation is symmetric, let x ≤ y ≤ z.\n' +
   '2. From x²+y²+z² = xyz we have z² ≤ xyz, so xy ≥ z.\n' +
   '3. Also xyz = x²+y²+z² ≤ 3z², so xy ≤ 3z.\n' +
   '4. Hence z ≤ xy ≤ 3z. Write xy = kz with integer k in 1,2,3.\n' +
   '5. Case k=1: x² + y² = 0, impossible for positive integers.\n' +
   '6. Case k=2: x²y² = 4(x² + y²), which has no positive integer solutions.\n' +
   '7. Case k=3: 2x²y² = 9(x² + y²), so 1/x² + 1/y² = 2/9.\n' +
   '9. Try x = 3: 1/9 + 1/y² = 2/9, so y = 3.\n' +
   '11. With x = y = 3 and xy = 3z, we get 9 = 3z so z = 3.\n' +
   '12. Conclusion – The only positive integer triple satisfying the original equation is (3,3,3).\n' +
   '\n## 🔍 Verification\nLHS: 3² + 3² + 3² = 27. RHS: 3 · 3 · 3 = 27.\n' +
   '\n## 🎯 Final Result\n(x, y, z) = (3, 3, 3)'
  ],
  ['Solve x^2-5x+6=0',
   '## ✅ Final Answer\nx = 2\n\n## 📖 Steps\n1. Case x > 0: the only solution is x = 2.'],
  /* A correct classification with one mistyped pair. Both engines must reach
     the same verdict AND the same diagnosis — an API that calls the method
     broken while the site calls it a typo is the disagreement that matters. */
  ['Find all positive integers x, y with x^2 + y^2 - 5xy = 25',
      '## ✅ Final Answer\n' +
      'All positive integer solutions of x^2 + y^2 - 5xy = 25 are obtained by repeatedly applying ' +
      'the Vieta-jump to the three minimal solutions (1,8), (3,16), (5,25).\n' +
      'The first few are (1,8), (3,16), (5,25), (8,39), (16,77), (25,120), (39,187), (77,368), (120,575), and so on.\n' +
      '\n## 📖 Steps\n1. As a quadratic in x: x^2 - 5yx + (y^2 - 25) = 0, so the other root is 5y - x.\n' +
      '2. Jumping the larger coordinate strictly decreases it, so the descent terminates.\n' +
      '3. The minimal pairs are (1,8), (3,16), (5,25), and every solution descends to one of them.'
  ],
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
        /* descent carries one more thing worth comparing: WHICH fault it found.
           "one listed value is a typo, the method is sound" and "the jump map
           itself is probably wrong" are the same kind, the same ok, and opposite
           instructions to a student — one says change a digit, the other says
           rebuild the proof. A PHP that drifted between them was invisible here
           until this went in. */
        $sig = [];
        foreach ($r['checks'] as $ck) {
            $mark = $ck['kind'] . ($ck['ok'] ? '+' : '-');
            if ($ck['kind'] === 'descent' && strpos((string)$ck['text'], 'slip in one number') !== false)
                $mark .= ':slip';
            $sig[] = $mark;
        }
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

  /* --- P0: the fixed-sample-grid forgery ---
     Equivalence is decided by agreeing at sample points. While that set was a
     fixed public grid — 0.83 + k·1.19 — it was forgeable: a claim of

         2x + (x−0.83)(x−2.02)…(x−9.16)

     equals 2x at every sampled point and is wrong by −1849 at x = 1.5, and it
     earned a green "Verified by 7Solve". WRONG became checked, which is the one
     thing this architecture exists to prevent.

     The grid is now hashed from the question AND the claim, so building a
     polynomial that vanishes on it requires knowing the grid, which requires
     already having written the polynomial. These rows pin the old public grid
     forever: whatever the sampling becomes, a claim crafted against 0.83+k·1.19
     must never verify again. The scaled variant is here because multiplying the
     forgery by a constant is the cheapest way to dodge a literal-string fix. */
  ['grid forgery', 'differentiate x^2',
   '## ✅ Answer\n**2x + (x - 0.83)*(x - 2.02)*(x - 3.21)*(x - 4.40)*(x - 5.59)*(x - 6.78)*(x - 7.97)*(x - 9.16)**', 'disputed'],
  ['grid forgery', 'differentiate x^2',
   '## ✅ Answer\n**2x + 0.5*(x - 0.83)*(x - 2.02)*(x - 3.21)*(x - 4.40)*(x - 5.59)*(x - 6.78)*(x - 7.97)*(x - 9.16)**', 'disputed'],
  /* a second, independently built forgery on the same grid */
  ['grid forgery', 'differentiate x^3',
   '## ✅ Answer\n**3x² + (x - 0.83)*(x - 2.02)*(x - 3.21)*(x - 4.40)*(x - 5.59)*(x - 6.78)*(x - 7.97)*(x - 9.16)**', 'disputed'],
  ['grid forgery', 'differentiate sin(x)',
   '## ✅ Answer\n**cos(x) + (x - 0.83)*(x - 2.02)*(x - 3.21)*(x - 4.40)*(x - 5.59)*(x - 6.78)*(x - 7.97)*(x - 9.16)**', 'disputed'],
  /* the integral checker samples a different public grid; pin that one too */
  ['grid forgery', 'integrate x^2',
   '## ✅ Answer\n**x³/3 + (x - 0.70)*(x - 1.23)*(x - 1.76)*(x - 2.29)*(x - 2.82)*(x - 3.35)*(x - 3.88)*(x - 4.41) + C**', 'disputed'],
  /* the hardening must not cost a single correct answer — these are the forms
     most likely to break if sampling moved into a bad domain */
  ['grid ok',      'differentiate sqrt(x)', '## ✅ Answer\n**1/(2 sqrt(x))**', 'checked'],
  ['grid ok',      'differentiate ln(x)',   '## ✅ Answer\n**1/x**',          'checked'],
  ['grid ok',      'integrate 1/x^2',       '## ✅ Answer\n**-1/x + C**',     'checked'],

  /* --- P0: 3x² sin x, reported from production ---
     The site returned 9x sin x + 3x² cos x. Its own steps computed u' = 6x and
     applied the product rule correctly; a later "simplification" turned 6x into
     9x, and the answer was not disputed.

     The cause was NOT this expression and NOT the maths — Deriv returns
     6 x sin(x) + 3 x² cos(x) correctly, and the plain "differentiate 3x² sin x"
     phrasing was already caught. The hole was in which QUESTIONS the checker
     recognised: a question that names its function rather than its expression.
     "Differentiate y = 3x² sin x" handed Deriv the string "y = 3x² sin x",
     which has an '=' and does not parse, so truth came back null and the check
     returned no verdict at all; "f(x) = …, find f'(x)" never matched the
     trigger in the first place. A wrong derivative then reached the student
     without a dispute, which is the one outcome this checker exists to prevent.

     So these pin the class, not the case: every ordinary way a student writes a
     derivative question, with a wrong answer that must be disputed and a right
     one that must still verify. */
  ['P0 wrong', 'differentiate 3x² sin x',        '## ✅ Answer\n**9x sin x + 3x² cos x**', 'disputed'],
  ['P0 wrong', 'Differentiate y = 3x² sin x',    '## ✅ Answer\n**9x sin x + 3x² cos x**', 'disputed'],
  ['P0 wrong', "f(x) = 3x² sin x, find f'(x)",   '## ✅ Answer\n**9x sin x + 3x² cos x**', 'disputed'],
  ['P0 wrong', 'y = 3x² sin x, find dy/dx',      '## ✅ Answer\n**9x sin x + 3x² cos x**', 'disputed'],
  ['P0 wrong', "If y = 3x^2 sin x find y'",      '## ✅ Answer\n**9x sin x + 3x² cos x**', 'disputed'],
  /* the reported shape exactly: correct working, wrong final line */
  ['P0 wrong', 'differentiate 3x² sin x',
   '## ✅ Answer\n**9x sin x + 3x² cos x**\n\n## 📝 Steps\n1. u = 3x², v = sin x\n' +
   "2. u' = 6x, v' = cos x\n3. Product rule: 6x sin x + 3x² cos x\n" +
   '4. Simplifying: 9x sin x + 3x² cos x', 'disputed'],

  ['P0 right', 'differentiate 3x² sin x',        '## ✅ Answer\n**6x sin x + 3x² cos x**', 'checked'],
  ['P0 right', 'Differentiate y = 3x² sin x',    '## ✅ Answer\n**6x sin x + 3x² cos x**', 'checked'],
  ['P0 right', "f(x) = 3x² sin x, find f'(x)",   '## ✅ Answer\n**6x sin x + 3x² cos x**', 'checked'],
  ['P0 right', "If y = 3x^2 sin x find y'",      '## ✅ Answer\n**6x sin x + 3x² cos x**', 'checked'],
  /* algebraically equivalent forms must all verify — the checker compares
     VALUES at scattered points, so factored and reordered forms are the same
     derivative and a student is not marked wrong for tidying their answer */
  ['P0 equiv', 'differentiate 3x² sin x',        '## ✅ Answer\n**6x sin(x) + 3x² cos(x)**', 'checked'],
  ['P0 equiv', 'differentiate 3x² sin x',        '## ✅ Answer\n**3x(2 sin(x) + x cos(x))**', 'checked'],
  ['P0 equiv', 'differentiate 3x² sin x',        '## ✅ Answer\n**3x²cos(x) + 6x sin(x)**', 'checked'],

  /* --- INDEFINITE INTEGRALS ---
     Before integralCheck existed, EVERY integral answer came back `plain` —
     correct and wrong alike ran zero checks, so a wrong antiderivative was
     never disputed and a right one never verified. There is still no
     integrator: an antiderivative is checked by differentiating it and
     comparing with the integrand, which is why none of these is special-cased.

     Two properties fall out of that and are pinned here rather than assumed.
     The constant is free — d/dx of C is 0, so "+ C", "+ 91" and no constant at
     all verify identically. And the FORM is free: the 9x integrand's
     antiderivative looks nothing like the tidy one, and needs no technique to
     confirm. */
  ['∫ correct', 'integrate 6x sin x + 3x^2 cos x',  '## ✅ Answer\n**3x² sin x + C**', 'checked'],
  ['∫ correct', 'Integrate 9x sin x + 3x^2 cos x',
   '## ✅ Answer\n**3x² sin x - 3x cos x + 3 sin x + C**', 'checked'],
  ['∫ const',   'integrate 2x',                     '## ✅ Answer\n**x² + C**',       'checked'],
  ['∫ const',   'integrate 2x',                     '## ✅ Answer\n**x² + 91**',      'checked'],
  ['∫ const',   'integrate 2x',                     '## ✅ Answer\n**x²**',           'checked'],
  ['∫ correct', '∫ x^2 dx',                         '## ✅ Answer\n**x³/3 + C**',     'checked'],
  ['∫ correct', '∫ cos x dx',                       '## ✅ Answer\n**sin x + C**',    'checked'],
  ['∫ correct', '∫ 1/x dx',                         '## ✅ Answer\n**ln(x) + C**',    'checked'],
  ['∫ correct', 'integrate exp(x)',                 '## ✅ Answer\n**exp(x) + C**',   'checked'],
  /* wrong antiderivatives must be disputed, not merely unverified */
  ['∫ wrong',   'integrate 6x sin x + 3x^2 cos x',  '## ✅ Answer\n**5x² sin x + C**', 'disputed'],
  ['∫ wrong',   '∫ x^2 dx',                         '## ✅ Answer\n**x³ + C**',       'disputed'],
  ['∫ wrong',   '∫ cos x dx',                       '## ✅ Answer\n**-sin x + C**',   'disputed'],
  ['∫ wrong',   'integrate 2x',                     '## ✅ Answer\n**x³ + C**',       'disputed'],
  /* the antiderivative of a DIFFERENT integrand must not be accepted */
  ['∫ wrong',   'Integrate 9x sin x + 3x^2 cos x',  '## ✅ Answer\n**3x² sin x + C**', 'disputed'],
  ['∫ wrong',   '∫ x^2 dx',                         '## ✅ Answer\n**x²/3 + C**',     'disputed'],
  ['∫ wrong',   '∫ sin x dx',                       '## ✅ Answer\n**cos x + C**',    'disputed'],
  ['∫ wrong',   'integrate 2x',                     '## ✅ Answer\n**2x² + C**',      'disputed'],
  ['∫ wrong',   '∫ 1/x dx',                         '## ✅ Answer\n**x + C**',        'disputed'],
  /* more correct forms: constant integrand, chain rule, reordered, factored */
  ['∫ correct', 'integrate 5',                      '## ✅ Answer\n**5x + C**',       'checked'],
  ['∫ correct', '∫ x^3 dx',                         '## ✅ Answer\n**x⁴/4 + C**',     'checked'],
  ['∫ correct', '∫ (2x + 3) dx',                    '## ✅ Answer\n**x² + 3x + C**',  'checked'],
  ['∫ correct', '∫ (2x + 3) dx',                    '## ✅ Answer\n**3x + x² + C**',  'checked'],
  ['∫ correct', 'integrate 2 cos(2x)',              '## ✅ Answer\n**sin(2x) + C**',  'checked'],
  ['∫ correct', 'integrate 2*exp(2x)',              '## ✅ Answer\n**exp(2x) + C**',  'checked'],
  ['∫ correct', '∫ 1/x^2 dx',                       '## ✅ Answer\n**-1/x + C**',     'checked'],
  ['∫ correct', 'integrate 6x sin x + 3x^2 cos x',  '## ✅ Answer\n**3x(x sin x) + C**', 'checked'],
  ['∫ const',   'integrate 2x',                     '## ✅ Answer\n**x² - 7**',       'checked'],
  ['∫ const',   'integrate 2x',                     '## ✅ Answer\n**x² + K**',       'checked'],

  /* SAFETY: an answer the engine cannot READ must never be disputed. A checker
     that treats "cannot parse" as "wrong" marks correct work incorrect, and a
     student who is failed once for writing prose stops trusting every badge
     after it. Rule 1: no verdict beats a wrong verdict. */
  ['∫ silent',  '∫ x^2 dx', '## ✅ Answer\nthe integral is x cubed over three plus a constant', 'plain'],
  ['∫ silent',  '∫ x^2 dx', '## ✅ Answer\nSee the working above.',        'plain'],
  /* PROMOTED in Release B. −ln|cos x| is a correct antiderivative of tan x, and
     it sat here as "silent" only because the absolute-value bars did not
     tokenise. They do now, so a correct textbook answer is certified instead of
     being passed over. */
  ['∫ silent',  'integrate tan(x)',   '## ✅ Answer\n**-ln|cos x| + C**',  'checked'],
  ['∫ silent',  'integrate sec(x)^2', '## ✅ Answer\n**tan(x) + C**',      'plain'],
  /* several variables is a partial-derivative question in disguise — no verdict */
  ['∫ silent',  'integrate x*y',      '## ✅ Answer\n**x²y/2 + C**',       'plain'],
  ['∫ silent',  '∫ (x + y) dx',       '## ✅ Answer\n**x²/2 + xy + C**',   'plain'],

  /* DEFINITE integrals are NOT covered by this checker and must not be
     verified by it. A number is not an antiderivative, so nothing fires — the
     failure mode to prevent is a definite answer inheriting a green badge from
     the indefinite machinery. The wrong value is pinned too: it must not be
     verified, and it is honest for it to be unverified rather than disputed,
     because this engine did not evaluate it. */
  ['∫ definite','∫ from 0 to 1 x^2 dx',   '## ✅ Answer\n**1/3**', 'plain'],
  ['∫ definite','Evaluate ∫_0^1 x^2 dx',  '## ✅ Answer\n**1/3**', 'plain'],
  ['∫ definite','integrate x^2 from 0 to 1','## ✅ Answer\n**1/3**', 'plain'],
  ['∫ definite','∫_0^1 x^2 dx',           '## ✅ Answer\n**1/2**', 'plain'],

  /* CLOSED IN RELEASE B. These were pinned as known limits with the note that
     "when Deriv learns either, these rows fail and get promoted to 'checked'
     rather than the gap sitting unnoticed". That is exactly what happened: the
     rows failed the moment the parser learned absolute-value bars and rational
     exponents, and the promotion is recorded here rather than the suite being
     quietly re-baselined.

     Both are the form a textbook actually prints, which is why they mattered:
     every student writing the standard answer to the standard question was
     going unverified. The forged versions are covered in parity-release-b.js —
     ln|x^2| (which differentiates to 2/x) and 3x^(3/2)/2 are both still
     disputed. */
  ['∫ limit',   '∫ 1/x dx',       '## ✅ Answer\n**ln|x| + C**',            'checked'],
  ['∫ limit',   '∫ sqrt(x) dx',   '## ✅ Answer\n**2*x^(3/2)/3 + C**',      'checked'],

  /* ---- SYSTEMS OF EQUATIONS ----
     Checking one equation of a system does not merely under-verify, it
     CONFIRMS a wrong answer: x = 5, y = 5 satisfies x + y = 10 perfectly and
     fails x − y = 2. findEquation is singular by design and never saw the
     second equation, so every one of these came back plain before systemCheck.

     The row that matters most is 'sys only-first'. If anyone ever changes the
     checker to stop at the first equation, that case flips to checked and the
     suite fails — which is the whole reason the check exists. */
  ['sys correct',    'Solve x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  ['sys only-first', 'Solve x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 5, y = 5**', 'disputed'],
  ['sys both-wrong', 'Solve x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 1, y = 2**', 'disputed'],
  ['sys reordered',  'Solve x + y = 10 and x - y = 2', '## ✅ Answer\n**y = 4, x = 6**', 'checked'],
  ['sys "and"',      'Solve x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 6 and y = 4**', 'checked'],
  ['sys 3x3',        'Solve x + y + z = 6, x - y + z = 2, x + y - z = 0', '## ✅ Answer\n**x = 1, y = 2, z = 3**', 'checked'],
  ['sys 3x3 wrong',  'Solve x + y + z = 6, x - y + z = 2, x + y - z = 0', '## ✅ Answer\n**x = 2, y = 2, z = 2**', 'disputed'],
  /* first two equations hold, the third does not — the multi-equation analogue
     of the only-first trap */
  ['sys third-fails','Solve x + y = 5, x - y = 1, x + 2y = 8', '## ✅ Answer\n**x = 3, y = 2**', 'disputed'],
  /* an inconsistent system has no solution: nothing may verify against it */
  ['sys inconsistent','Solve x + y = 10 and x + y = 12', '## ✅ Answer\n**x = 6, y = 4**', 'disputed'],
  /* a dependent system has infinitely many: satisfying every equation is TRUE
     but is not "the solution", so it must not go green */
  ['sys dependent',  'Solve x + y = 10 and 2x + 2y = 20', '## ✅ Answer\n**x = 6, y = 4**', 'plain'],
  /* safety: a partial assignment must never be certified */
  ['sys partial',    'Solve x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 6**', 'plain'],
  ['sys malformed',  'Solve x + = 10 and x - y = 2',   '## ✅ Answer\n**x = 6, y = 4**', 'plain'],
  ['sys prose',      'Solve x + y = 10 and x - y = 2', '## ✅ Answer\nThe values are six and four.', 'plain'],
  /* textbook wording — the lead-in words are prose, not variables */
  ['sys wording',    'Solve the simultaneous equations x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  ['sys wording',    'Find x and y: 2x + y = 7, x - y = 2', '## ✅ Answer\n**x = 3, y = 1**', 'checked'],
  ['sys wording',    'Determine x and y where x + 2y = 8 and 3x - y = 3', '## ✅ Answer\n**x = 2, y = 3**', 'checked'],
  ['sys wording',    'Find the values of x and y satisfying x + y = 7 and x - y = 1', '## ✅ Answer\n**x = 4, y = 3**', 'checked'],
  ['sys wording-',   'Find x and y: 2x + y = 7, x - y = 2', '## ✅ Answer\n**x = 3, y = 2**', 'disputed'],
  /* formatting variants of the same system */
  ['sys tight',      'Solve 2x+y=7 and x-y=2',          '## ✅ Answer\n**x = 3, y = 1**', 'checked'],
  ['sys zero-form',  'Solve 2x + y - 7 = 0 and x - y - 2 = 0', '## ✅ Answer\n**x = 3, y = 1**', 'checked'],
  ['sys newlines',   'Solve\nx + y = 10\nx - y = 2',    '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  /* a leading minus is part of the equation, not punctuation to be stripped */
  ['sys negatives',  'Solve -x + y = 1 and x + y = 5',  '## ✅ Answer\n**x = 2, y = 3**', 'checked'],
  ['sys negatives-', 'Solve -x + y = 1 and x + y = 5',  '## ✅ Answer\n**x = 3, y = 2**', 'disputed'],
  ['sys decimals',   'Solve 0.5x + y = 4 and x - y = 2','## ✅ Answer\n**x = 4, y = 2**', 'checked'],
  ['sys fractions',  'Solve x/2 + y = 4 and x - y = 2', '## ✅ Answer\n**x = 4, y = 2**', 'checked'],
  /* a repeated equation is one equation, and must not mask a failing one */
  ['sys duplicate',  'Solve x + y = 10, x + y = 10, x - y = 2', '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  ['sys duplicate-', 'Solve x + y = 10, x + y = 10, x - y = 2', '## ✅ Answer\n**x = 5, y = 5**', 'disputed'],
  /* AI prose asserting verification must not move the verdict */
  ['sys ai-prose',   'Solve x + y = 10 and x - y = 2',
   '## ✅ Answer\n**x = 5, y = 5**\n\n## 🔍 Verification\n✓ Verified. Both equations are satisfied. Correct.', 'disputed'],

  /* --- P0: verified VALUES are not a verified SOLUTION SET ---
     Substitution proves each claimed root satisfies the equation. For a
     "solve this" question that is evidence, not an answer. The degree-8 case
     below is the one that reached production: x = 1, 2, 3 all check out, five
     further roots go unmentioned, polyOf correctly declines to establish the
     root set — and the badge still read "✓ Verified by 7Solve", because
     substitution alone was enough to reach `checked`.

     The rule is now that substitution of claimed roots cannot BY ITSELF carry
     the green badge; something must have established completeness. The
     substitution results stay in the receipt, so a student still learns their
     values are genuine — they simply no longer imply a whole answer.

     Cases D and F pin the honest cost of that rule: an equation whose root set
     this engine cannot establish now reads "unable to verify" instead of
     green, even when every value offered is right. That is the contract, not
     an oversight — "your values are correct" and "this is the full solution"
     are different claims and only the second earns certification. */
  ['A forged completeness', 'Solve x^3-6x^2+11x-6 + x*(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)*(x-7) = 0',
   '## ✅ Answer\n**x = 1, x = 2, x = 3**', 'plain'],
  ['B complete cubic',   'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 2, x = 3**', 'checked'],
  ['C incomplete cubic', 'Solve x^3-6x^2+11x-6=0', '## ✅ Answer\n**x = 1, x = 2**',        'disputed'],
  /* D and F were frozen as `plain` because completeness could only run on a
     polynomial. The monotonicity argument reaches them: a strictly monotone
     function crosses zero at most once, which settles the solution set without
     a root count. Both are now certified on mathematics, not on evidence —
     subst+ AND roots+, so evidenceOnly is satisfied honestly. */
  ['D monotone',         'Solve exp(x) - 1 = 0',   '## ✅ Answer\n**x = 0**',               'checked'],
  ['E false root',       'Solve x^2-5x+6=0',       '## ✅ Answer\n**x = 2, x = 4**',        'disputed'],
  ['F monotone',         'Solve sqrt(x) = 3',      '## ✅ Answer\n**x = 9**',               'checked'],
  /* still `plain`, and deliberately: 1/(x−2) has a pole, and "at most one
     root" is a claim about ONE interval. The prover refuses division by
     anything containing the variable rather than reason about branches. */
  ['F pole refused',     'Solve 1/(x-2) = 1',      '## ✅ Answer\n**x = 3**',               'plain'],
  /* THE evidenceOnly HOLE, found in a real production answer on 2026-08-23.
     The bare answer above was always refused. A FULL answer was not: its
     worked steps produce passing `arith` and `integrity` checks, and the old
     rule only blocked certification when EVERY passed proof needed
     completeness. Those two do not, so they defeated the guard and this
     equation — whose solution set the engine explicitly declines to
     establish, because a pole splits the domain — came back `checked`.

     "Your arithmetic is right" and "the value satisfies the equation" are not
     a completeness proof. The rule is now `some`: if ANY passed proof needed
     completeness and completeness was not established, nothing certifies.
     Keep this case worked, with arithmetic in it, or it stops testing the
     thing that broke. */
  /* CURRENCY. Found 2026-08-23 by a real CA answer: a merchant's profit was
     arithmetically perfect and NOTHING was checked, because every figure was
     priced. "Rs" reads as letters to the algebra guard, and ₹ breaks the
     expression match outright — so the arithmetic checker was blind across the
     entire commerce syllabus, which is a core 7Solve audience. Keep a wrong
     one beside each right one, or this only proves the scanner runs. */
  ['J rupee prefix',    'A merchant buys 10 bags at Rs 1200 each.',
   '## ✅ Final Answer\n**23400**\n\n## 📖 Steps\n1. Rs 12000 + Rs 11400 = Rs 23400', 'checked'],
  ['J rupee sign',      'A merchant buys 10 bags at Rs 1200 each.',
   '## ✅ Final Answer\n**23400**\n\n## 📖 Steps\n1. ₹12,000 + ₹11,400 = ₹23,400', 'checked'],
  ['J rupee wrong',     'A merchant buys 10 bags at Rs 1200 each.',
   '## ✅ Final Answer\n**23400**\n\n## 📖 Steps\n1. Rs 12000 + Rs 11400 = Rs 23500', 'stepfail'],
  /* the strip must not manufacture arithmetic out of algebra */
  ['J not a currency',  'Solve for R in R = 5x + 3',
   '## ✅ Final Answer\n**R = 5x + 3**\n\n## 📖 Steps\n1. Rate R is 5x + 3.', 'worked'],
  /* A dollar AMOUNT is not a maths delimiter. Three $ is an odd count and was
     read as "an unclosed $…$ formula", DISPUTING a correct answer — the second
     worst thing this engine can do, and US CMA / CPA / CFA / ACCA all price in
     dollars. The unclosed-LaTeX case below it must keep failing, or the fix has
     simply switched the guard off. */
  ['J dollar amounts',  'A CMA candidate values inventory.',
   '## ✅ Final Answer\n**23400**\n\n## 📖 Steps\n1. $12,000 + $11,400 = $23,400', 'checked'],
  ['J dollar wrong',    'A CMA candidate values inventory.',
   '## ✅ Final Answer\n**23400**\n\n## 📖 Steps\n1. $12,000 + $11,400 = $23,500', 'stepfail'],
  ['J latex still caught', 'A CMA candidate values inventory.',
   '## ✅ Final Answer\n**23400**\n\n## 📖 Steps\n1. The value is $x + y = 5 and we continue', 'disputed'],

  /* CORROBORATING KINDS CANNOT CERTIFY. Found 2026-08-23 in a real production
     answer: the model claimed "x + eˣ = 0 has no real solution", which is
     FALSE — the root is −0.567143, and the same model found it on another
     attempt. Nothing in the answer could be checked except `integrity` ("the
     answer restates the same relation as the question"), which passed, and
     integrity could certify on its own. So a mathematically false answer wore
     "✓ Verified by 7Solve".

     integrity, question, truncated, trace and contradiction are now
     authority:corroborating in capabilities.json — emitted as PROOF[kind] === 2
     — and may never certify alone. They still dispute when they FAIL, which
     the case below this one covers. */
  ['I false no-solution',  'Solve x + e^x = 0',
   '## ✅ No real solution\n\n## 📖 Steps\n1. e^x is always positive.\n' +
   '2. So x + e^x can never be zero.\n\n## 🎯 Final Result\nNo real solution exists.', 'explained'],
  ['I corroborating alone', 'Solve 3x + y = 7',
   '## ✅ Answer\nGiven 3x + y = 7, we get y = 7 - 3x.', 'plain'],

  ['F pole, worked answer', 'Solve 1/(x-2) = 1',
   '## ✅ Answer\n**x = 3**\n\n## 📖 Steps\n1. Multiply both sides by (x-2).\n' +
   '2. So x = 1+2 = 3.\n3. Check: 1/(3-2) = 1/1 = 1.\n\n## 🎯 Final Result\nx = 3', 'worked'],
  /* G: prose cannot promote "unable to verify" into a green badge */
  ['G prose promotion',  'Solve x^3-6x^2+11x-6 + x*(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)*(x-7) = 0',
   '## ✅ Answer\n**x = 1, x = 2, x = 3**\n\n## 🔍 Verification\n✓ Verified. All solutions are correct and complete.', 'plain'],
  /* This case used to ask exp(x)−1=0, which the monotonicity argument now
     certifies on its own merits — so the question was replaced rather than the
     expectation flipped. Flipping it to `checked` would have retired a guard
     while appearing to update a test: the point here is that PROSE cannot
     promote, and proving that needs an equation the engine still refuses.
     1/(x−2)=1 is exactly that, and it now guards the pole refusal too. */
  ['G prose promotion',  'Solve 1/(x-2) = 1',
   '## ✅ Answer\n**x = 3**\n\n## 🔍 Verification\n✓ Verified by AI. Confirmed correct.', 'plain'],
  /* prose cannot promote a monotone-REFUSED equation either, even when the
     value offered really is a root */
  ['G prose vs refused', 'Solve sin(x) = 0',
   '## ✅ Answer\n**x = 0**\n\n## 🔍 Verification\n✓ Verified. Complete and correct.', 'plain'],
  /* the monotone path must still dispute a wrong answer, and must not certify
     an equation whose difference folds */
  ['H monotone wrong',   'Solve exp(x) - 1 = 0',   '## ✅ Answer\n**x = 1**',               'disputed'],
  ['H fold refused',     'Solve x^2 = 4',          '## ✅ Answer\n**x = 2**',               'disputed'],
  ['H monotone log',     'Solve ln(x) = 0',        '## ✅ Answer\n**x = 1**',               'checked'],
  ['H monotone pow',     'Solve 2^x = 8',          '## ✅ Answer\n**x = 3**',               'checked'],
  /* the rule must not touch questions that never claimed a complete set —
     a tuple answering "find the smallest solution" is not a completeness claim */
  ['tuple exempt',  'x^2+y^2+1=3xy', '## ✅ Answer\nThe smallest solution is (1,1).', 'checked'],

  /* --- P0: forged IDENTITY (the fourth fixed-grid exploit) ---
     identityCheck sampled a published grid, (k%2?1:-1)*(0.7 + k*0.61 + vi*1.37),
     so a false factorisation could be made to agree at all twelve points:

         (x-3)(x-4) = x^2 - 7x + 12 + PROD(x - p_i)

     is wrong at every other value of x and took a green "Verified by 7Solve".
     Its points now come from samplePoints keyed on the claim line. These rows
     pin the old grid forever, at several targets, because a fix that only
     recognises one forgery is a special case. */
  ['forged identity', 'Factorise x^2 - 7x + 12',
   '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 12 + (x - (-0.7))*(x - 1.31)*(x - (-1.92))*(x - 2.53)*(x - (-3.14))*(x - 3.75)*(x - (-4.36))*(x - 4.97)*(x - (-5.58))*(x - 6.19)*(x - (-6.8))*(x - 7.41)', 'stepfail'],
  ['forged identity', 'Expand (x + 1)^2',
   '## ✅ Answer\n(x + 1)^2 = x^2 + 2x + 1 + (x - (-0.7))*(x - 1.31)*(x - (-1.92))*(x - 2.53)*(x - (-3.14))*(x - 3.75)*(x - (-4.36))*(x - 4.97)*(x - (-5.58))*(x - 6.19)*(x - (-6.8))*(x - 7.41)', 'stepfail'],
  /* true identities must still certify, in several shapes */
  ['identity ok',  'Factorise x^2 - 7x + 12', '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 12', 'checked'],
  ['identity ok',  'Expand (x + 1)^2',        '## ✅ Answer\n(x + 1)^2 = x^2 + 2x + 1',      'checked'],
  ['identity ok',  'Factorise x^2 + 5x + 6',  '## ✅ Answer\n(x+2)(x+3) = x^2 + 5x + 6',     'checked'],
  ['identity ok',  'Factorise x^2 - 9',       '## ✅ Answer\n(x - 3)(x + 3) = x^2 - 9',       'checked'],
  /* false identities must still be caught */
  ['identity bad', 'Factorise x^2 - 7x + 12', '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 99', 'stepfail'],
  ['identity bad', 'Expand (x + 1)^2',        '## ✅ Answer\n(x + 1)^2 = x^2 + 2x + 5',       'stepfail'],
  ['identity bad', 'Factorise x^2 - 9',       '## ✅ Answer\n(x - 3)(x + 3) = x^2 + 9',       'stepfail'],
  /* multivariable identity: each variable must get a DIFFERENT value, or
     a = b collapses a false claim into 0 = 0 and it passes */
  ['identity multi', 'Factorise a^3 - b^3',
   '## ✅ Answer\n(a - b)(a^2 + a*b + b^2) = a^3 - b^3', 'checked'],
  ['identity multi', 'Factorise a^3 - b^3',
   '## ✅ Answer\n(a - b)(a^2 - a*b + b^2) = a^3 - b^3', 'stepfail'],
  /* AI prose claiming verification must not move an identity verdict */
  ['identity prose', 'Factorise x^2 - 7x + 12',
   '## ✅ Answer\n(x - 3)(x - 4) = x^2 - 7x + 99\n\n## 🔍 Verification\n✓ Verified. This factorisation is correct.', 'stepfail'],

  /* --- P0: forged linearity ---
     systemShape probed linearity at the fixed points 0, 1 and 2, and that was
     forgeable exactly as the derivative grid was. x·(x−1)·(x−2)·(x−k) is zero
     at all three probes AND at the claimed x = k, so the system below probed
     as the linear x + y = 10, was declared to have a unique solution, and took
     a green "Verified by 7Solve" — while being genuinely non-linear with other
     solutions. Certifying uniqueness there is simply wrong.

     The probes are now hashed from the equations and the variables, and the
     test compares SLOPES so it does not depend on their spacing. These rows
     pin the old probe positions forever: whatever the probing becomes, a term
     built to vanish at 0, 1, 2 must never certify again. Several k values,
     because a fix that only recognises one of them is a special case. */
  ['forged linearity', 'Solve x + y + x*(x-1)*(x-2)*(x-6) = 10 and x - y = 2',
   '## ✅ Answer\n**x = 6, y = 4**', 'plain'],
  ['forged linearity', 'Solve x + y + x*(x-1)*(x-2)*(x-5) = 8 and x - y = 2',
   '## ✅ Answer\n**x = 5, y = 3**', 'plain'],
  ['forged linearity', 'Solve x + y + 2*x*(x-1)*(x-2)*(x-4) = 6 and x - y = 2',
   '## ✅ Answer\n**x = 4, y = 2**', 'plain'],
  ['forged linearity', 'Solve x + y + x*(x-1)*(x-2)*(x-7)*(x+1) = 12 and x - y = 2',
   '## ✅ Answer\n**x = 7, y = 5**', 'plain'],
  /* a forged-linear system whose claimed point does NOT satisfy it is still
     decidably wrong, and must stay disputed rather than falling silent */
  ['forged linearity-', 'Solve x + y + x*(x-1)*(x-2)*(x-6) = 10 and x - y = 2',
   '## ✅ Answer\n**x = 5, y = 3**', 'disputed'],
  /* higher-degree ordinary nonlinear systems, valid points, must not certify */
  ['nonlinear deg3', 'Solve x^3 + y = 9 and x + y = 3',  '## ✅ Answer\n**x = 2, y = 1**', 'plain'],
  ['nonlinear deg3', 'Solve x^2*y = 12 and x + y = 5',   '## ✅ Answer\n**x = 2, y = 3**', 'plain'],
  ['nonlinear deg3', 'Solve x*y^2 = 12 and x + y = 5',   '## ✅ Answer\n**x = 3, y = 2**', 'plain'],
  /* the probe change must not cost a linear system its badge */
  ['probe ok', 'Solve 0.5x + y = 4 and x - y = 2', '## ✅ Answer\n**x = 4, y = 2**', 'checked'],
  ['probe ok', 'Solve x/2 + y = 4 and x - y = 2',  '## ✅ Answer\n**x = 4, y = 2**', 'checked'],

  /* --- extraction traps found by the adversarial review ---
     "xy" is a product of two variables and an English word by shape. The
     lead-in stripper ate it, left "= 6", failed to parse, and dropped the
     equation from the system — the check then went quiet on a question it
     could answer. Keeping the DEEPEST strip that still parses is what tells
     "Solve" from "xy", and stripping one token at a time is what lets the
     good candidate be seen at all. */
  /* NONLINEAR: satisfaction is not uniqueness, and only uniqueness earns green.
     (2,3) does satisfy xy = 6 and x + y = 5 — and so, for xy = 6 alone, does
     every other pair on the hyperbola. This engine has no uniqueness proof for
     a non-linear system, so it does not certify one. The answer may well be
     right; it is simply not verified, and saying so is the honest outcome.
     A false green is worse than no badge, because the badge is the thing
     students are being taught to rely on.

     The failure path is deliberately untouched: a point that demonstrably does
     NOT satisfy an equation is still disputed, because that much is decidable
     without knowing anything about uniqueness. */
  ['sys nonlinear',  'Solve xy = 6 and x + y = 5',      '## ✅ Answer\n**x = 2, y = 3**', 'plain'],
  ['sys nonlinear-', 'Solve xy = 6 and x + y = 5',      '## ✅ Answer\n**x = 2, y = 4**', 'disputed'],
  ['sys nonlinear',  'Solve x^2 + y^2 = 25 and x + y = 7', '## ✅ Answer\n**x = 3, y = 4**', 'plain'],
  ['sys nonlinear-', 'Solve x^2 + y^2 = 25 and x + y = 7', '## ✅ Answer\n**x = 3, y = 5**', 'disputed'],
  ['sys nonlinear',  'Solve xy + x = 6 and x + y = 4',  '## ✅ Answer\n**x = 2, y = 2**', 'plain'],
  ['sys nonlinear-', 'Solve xy + x = 6 and x + y = 4',  '## ✅ Answer\n**x = 1, y = 3**', 'disputed'],
  ['sys nonlinear',  'Solve x^2 + y^2 = 10 and x - y = 2', '## ✅ Answer\n**x = 3, y = 1**', 'plain'],
  ['sys nonlinear-', 'Solve x^2 + y^2 = 10 and x - y = 2', '## ✅ Answer\n**x = 3, y = 2**', 'disputed'],
  /* the extraction traps these nonlinear cases exposed, pinned so they stay fixed:
     "xy" must not be eaten as an English word, and "xy + x = 6" must not be
     stripped to "+ x = 6" — which parses as x = 6 and disputed correct work */
  ['sys xy-term',    'Solve xy + x = 6 and x + y = 4',  '## ✅ Answer\n**x = 2, y = 2**', 'plain'],
  ['sys unary-minus','Solve -x - y = -5 and x - y = 1', '## ✅ Answer\n**x = 3, y = 2**', 'checked'],
  /* other single-letter variable names must work the same as x and y */
  ['sys ab',         'Solve a + b = 7 and a - b = 1',   '## ✅ Answer\n**a = 4, b = 3**', 'checked'],
  ['sys ab-',        'Solve a + b = 7 and a - b = 1',   '## ✅ Answer\n**a = 5, b = 2**', 'disputed'],
  ['sys ab wording', 'Determine a and b where 2a + b = 8 and a - b = 1', '## ✅ Answer\n**a = 3, b = 2**', 'checked'],
  /* more wordings, each with a wrong twin so the wording cannot verify by itself */
  ['sys wording',    'Given x + y = 10 and x - y = 2, solve', '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  ['sys wording-',   'Given x + y = 10 and x - y = 2, solve', '## ✅ Answer\n**x = 5, y = 5**', 'disputed'],
  ['sys wording',    'Find the values of x and y for which x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  ['sys wording-',   'Find the values of x and y for which x + y = 10 and x - y = 2', '## ✅ Answer\n**x = 5, y = 5**', 'disputed'],
  ['sys semicolon',  'Solve x+y=10; x-y=2',             '## ✅ Answer\n**x = 6, y = 4**', 'checked'],
  ['sys parens-neg', 'Solve x + (-y) = 3 and x + y = 7','## ✅ Answer\n**x = 5, y = 2**', 'checked'],
  ['sys neg-both',   'Solve -x - y = -5 and x - y = 1', '## ✅ Answer\n**x = 3, y = 2**', 'checked'],
  ['sys neg-both-',  'Solve -x - y = -5 and x - y = 1', '## ✅ Answer\n**x = 2, y = 3**', 'disputed'],

  /* FALSE POSITIVES: the checker must not invent a system out of prose that
     merely contains "=" or numbers. Each must reach no system verdict. */
  ['sys not-a-system', 'Explain why E = mc^2 matters', '## ✅ Answer\nEnergy and mass are equivalent.', 'plain'],
  ['sys not-a-system', 'In 2020 profit = 100 and in 2021 profit = 120. Find the growth.', '## ✅ Answer\nGrowth is 20%.', 'plain'],
  ['sys not-a-system', 'A train travels at 60 km/h. How far in 2 hours?', '## ✅ Answer\nDistance = 120 km', 'plain'],

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

/* ---------- BADGE / WIRING CONTRACT ----------
   Unit-testing derivativeCheck is not enough, and this file has the scar to
   prove it: while chasing the 3x² sin x report I set state.lastQuestion and the
   badge came back "⚠ Unable to verify" on an answer Verify.run called disputed.
   The product was fine — paintVerif reads state.lastQ, and my probe wrote a
   field nothing reads. But that is EXACTLY the production failure this
   architecture exists to prevent, and nothing would have caught it for real:

     rename state.lastQ, and verification silently runs against an empty
     question. Every check goes quiet, every answer becomes "Unable to
     verify", and a WRONG answer is never disputed again. Every unit test
     still passes, because every checker still works.

   So this pins the two joints between a correct verdict and what a student
   actually sees:

     1. the field paintVerif reads is a field the solve path writes
     2. the green "Verified" badge is reachable ONLY from state `checked`

   Static, but it guards the wiring rather than the mathematics. */
function checkBadgeContract(html) {
  const bad = [];
  const pv = html.indexOf('function paintVerif(md){');
  if (pv < 0) return ['badge: paintVerif not found in index.html'];
  const body = html.slice(pv, pv + 4000);

  /* 1. the question field the renderer verifies against */
  const read = body.match(/Verify\.run\(\s*W\.state\s*&&\s*W\.state\.([A-Za-z_$][\w$]*)/);
  if (!read) {
    bad.push('badge: could not see which state field paintVerif verifies against — ' +
             'this guard is stale and must be repaired, not deleted');
  } else {
    const field = read[1];
    const written = new RegExp('\\bstate\\.' + field + '\\s*=' ).test(html);
    if (!written) {
      bad.push(`badge: paintVerif verifies against state.${field}, but nothing in ` +
               'index.html ever assigns it — verification would run on an empty ' +
               'question and no wrong answer could ever be disputed');
    }
  }

  /* 2. green is reachable only from `checked` */
  /* Tolerate a comment between the branch and its label — the guard used to
     require them adjacent, so adding a comment above `label =` made it report
     "no branch maps checked to the green badge" when the mapping was intact.
     A guard that fails on a comment gets deleted by the next person; keep it
     matching the code, not the whitespace. */
  const branches = [...body.matchAll(/r\.state === '([a-z_]+)'\)\{[\s\S]{0,400}?label = '([^']*)'; cls = '([^']*)'/g)]
    .map((m) => ({ state: m[1], label: m[2], cls: m[3] }));
  if (branches.length < 4) {
    bad.push('badge: could not read the state-to-badge branches — guard is stale');
  }
  for (const b of branches) {
    const green = b.cls.trim() === 'verif';
    if (green && b.state !== 'checked') {
      bad.push(`badge: state "${b.state}" renders the green verified badge ` +
               `("${b.label}") — only "checked" may claim verification`);
    }
    if (b.state === 'checked' && !green) {
      bad.push(`badge: state "checked" no longer renders the green badge (cls "${b.cls}")`);
    }
  }
  if (branches.length && !branches.some((b) => b.state === 'checked' && b.cls.trim() === 'verif')) {
    bad.push('badge: no branch maps `checked` to the green verified badge');
  }
  return bad;
}

/* ---------- WHO MAY SAY "VERIFIED" ----------
   The model writes its own "🔍 Verification" section, ends it with a tick, and
   says the answer is correct. That is fine — the substitutions in it are worth
   reading. What was NOT fine is that the renderer promoted that prose into a
   card titled "Verification", the same word the engine's badge uses, so a
   WRONG answer carried an apparently authoritative verification section
   directly under a red "Verification failed" verdict. The product was dressing
   the model's claim as certification; the model never asked for that.

   Two rules, both structural:
     1. no model-authored section may be TITLED with the certification word —
        "Verification steps" is a description of content, "Verification" is a
        claim about truth
     2. the authoritative badge must name its authority, so that the one place
        entitled to the word is distinguishable from prose that uses it

   Prose still cannot move the verdict: nothing here touches Verify.run, and
   `agree` — the only check that reads wording at all — is Tier 3 advisory. */
function loadNbKind(html) {
  const s = html.indexOf('const NB_KINDS = [');
  const e = html.indexOf('const nbKind =', s);
  const eol = html.indexOf('\n', e);
  if (s < 0 || e < s || eol < e) return null;
  const box = { console, String, Number, Object, Array, RegExp, JSON };
  vm.createContext(box);
  vm.runInContext(html.slice(s, eol) + '\nthis.__k = nbKind;', box, { timeout: 3000 });
  return box.__k;
}

const AUTHORITY_HEADINGS = [
  '🔍 Verification',
  'Verification',
  'Verification Result',
  '✓ Verified',
  'Verified',
  'Checking the answer',
];

function checkVerificationAuthority(html) {
  const bad = [];

  /* 1. no model section may be titled with the bare certification word */
  for (const m of html.matchAll(/hd:\s*'([^']*)'/g)) {
    const t = m[1].trim().toLowerCase();
    if (t === 'verification' || /\bverified\b/.test(t)) {
      bad.push(`authority: a model-authored section is titled "${m[1]}" — that is the ` +
               'engine\'s word. Title it with what the section CONTAINS ' +
               '("Verification steps"), not with a claim about truth');
    }
  }

  /* 2. every heading a model might use routes to the demoted card */
  const nbKind = loadNbKind(html);
  if (!nbKind) {
    bad.push('authority: could not load NB_KINDS from index.html — this guard is stale');
  } else {
    for (const head of AUTHORITY_HEADINGS) {
      const k = nbKind(head);
      if (!k) {
        bad.push(`authority: the heading "${head}" is not classified at all, so it renders ` +
                 'as a bare authoritative heading');
      } else if (k.cls !== 'nb-verify' || /^verification$|\bverified\b/i.test(k.hd.trim())) {
        bad.push(`authority: the heading "${head}" renders as "${k.hd}" (${k.cls}) — ` +
                 'a model section must not present itself as the verification verdict');
      }
    }
  }

  /* 3. the authoritative badge names its authority */
  const pv = html.indexOf('function paintVerif(md){');
  if (pv >= 0) {
    const body = html.slice(pv, pv + 4000);
    const green = body.match(/r\.state === 'checked'\)\{[\s\S]{0,300}?label = '([^']*)'; cls = '([^']*)'/);
    if (!green) {
      bad.push('authority: could not read the checked-state badge label — guard is stale');
    } else if (!/7solve/i.test(green[1])) {
      bad.push(`authority: the verified badge reads "${green[1]}" and does not name 7Solve — ` +
               'an AI answer writes the word "verified" about itself, so the badge must say ' +
               'who is making the claim');
    }
  }
  return bad;
}

/* ---------- SAMPLING MECHANISM ----------
   The corpus pins the one historical forgery — a claim built against the old
   public grid 0.83 + k·1.19. That is necessary but not sufficient, and
   sabotage proved it: pinning the seed to a constant, or dropping the claim
   out of the hash, left every corpus case passing. Those changes reintroduce
   exactly the vulnerability that was just fixed — a fixed, discoverable grid —
   without breaking a single verdict.

   So the mechanism is asserted directly. What makes the forgery hard is not
   which points are chosen but that the choice DEPENDS ON THE CLAIM: to build a
   polynomial vanishing on the grid you must know the grid, and the grid is a
   hash of the polynomial you have not written yet. If that property ever
   silently disappears, this fails rather than the maths. */
function checkSampling(V) {
  const bad = [];
  const P = V.samplePoints;
  if (typeof P !== 'function') return ['sampling: samplePoints is not exported — guard is stale'];

  const a = P('d|x^2|2x');
  const b = P('d|x^2|2x + 0');          // same maths, different text
  const c = P('d|x^3|2x');              // different question
  const again = P('d|x^2|2x');

  if (!Array.isArray(a) || a.length < 12) {
    bad.push(`sampling: only ${a && a.length} points — a forgery needs one factor per point, ` +
             'so too few points makes the polynomial cheap to build');
  }
  if (JSON.stringify(a) === JSON.stringify(b)) {
    bad.push('sampling: the grid does not depend on the CLAIM — that is what makes a forgery ' +
             'hard, because the attacker would have to know the points before writing the ' +
             'expression whose text chooses them');
  }
  if (JSON.stringify(a) === JSON.stringify(c)) {
    bad.push('sampling: the grid does not depend on the QUESTION');
  }
  if (JSON.stringify(a) !== JSON.stringify(again)) {
    bad.push('sampling: not deterministic — the same question and claim must always give the ' +
             'same points, or a failing verdict cannot be reproduced');
  }
  /* the legacy public grid must never come back */
  const legacy = []; for (let k = 0; k < 8; k++) legacy.push(0.83 + k * 1.19);
  if (legacy.every((p, i) => Math.abs((a[i] || 0) - p) < 1e-9)) {
    bad.push('sampling: the old fixed public grid 0.83 + k*1.19 is back');
  }
  /* every point must be strictly positive, or sqrt and ln lose all their
     samples and the check falls silent on correct work */
  for (const p of a.concat(b)) {
    if (!(p > 0) || !isFinite(p)) { bad.push(`sampling: non-positive or non-finite point ${p}`); break; }
  }

  /* ---- no certification checker may roll its own grid ----
     This is the architectural half, and it is the point of the whole exercise.
     Four checkers were exploited in turn — derivative, integral, systemShape,
     identity — and a fifth (polyOf) was found by inspection. They were not four
     unrelated bugs. They were one vulnerability written four times, because
     every checker chose its own evaluation points.

     So a checker that samples must take its points from samplePoints. This
     scans each PROOF-capable function for an assignment into an environment
     whose value contains a numeric literal, and fails if that function is not
     drawing from the central sampler. Sampling at the STUDENT'S OWN claimed
     values — substitution, transformCheck, uniqueness — is a different thing
     and is exempt: those points are not a grid an attacker can aim at, they
     are the answer being tested. */
  {
    const idx = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
    const vS = idx.indexOf('var Verify = (function(){');
    const vE = idx.indexOf('\n})();', vS);
    const lines = idx.slice(vS, vE).split('\n');
    /* points taken from the claim, not from a grid — nothing to forge */
    const CLAIM_DRIVEN = { substitution: 1, transformCheck: 1, uniqueness: 1,
      conditionCheck: 1, checkDivisibility: 1, systemCheck: 1, chemistry: 1 };
    let fn = '(top)';
    const offenders = {};
    for (const L of lines) {
      const m = L.match(/^\s*function ([A-Za-z_$][\w$]*)\s*\(/);
      if (m) fn = m[1];
      if (CLAIM_DRIVEN[fn]) continue;
      const asn = L.match(/\benv\d*\[[^\]]*\]\s*=\s*(.+?);/);
      if (!asn) continue;
      const rhs = asn[1];
      const via = rhs.match(/\b(PTS|PB|IPTS|VP)\b/);
      if (via) {
        /* Naming an array PTS does not make it central. It must actually be
           assigned from samplePoints, or a checker can bypass the sampler by
           declaring `var IPTS = [1,2,3,…]` and keep this guard happy. */
        const decl = new RegExp('\\b' + via[1] + '\\s*=\\s*([^;]+);');
        const d = (idx.slice(idx.indexOf('function ' + fn + '('), idx.indexOf('function ' + fn + '(') + 8000)).match(decl);
        if (d && /samplePoints/.test(d[1])) continue;                          // genuinely central
        (offenders[fn] = offenders[fn] || []).push(
          via[1] + ' is not assigned from samplePoints: ' + (d ? d[1].trim().slice(0, 50) : '(not found)'));
        continue;
      }
      if (/samplePoints/.test(rhs)) continue;
      if (!/\d/.test(rhs)) continue;                                            // no literal
      if (/^\s*(i|k|n|q)\s*$/.test(rhs)) continue;                              // plain loop index
      (offenders[fn] = offenders[fn] || []).push(L.trim().slice(0, 70));
    }
    for (const f of Object.keys(offenders)) {
      bad.push(`sampling: ${f} builds its own evaluation grid instead of using ` +
               `samplePoints — a fixed grid is discoverable and therefore forgeable, ` +
               `which is exactly how derivative, integral, systemShape and identity ` +
               `were each exploited in turn\n            ${offenders[f][0]}`);
    }
  }

  /* The CALL SITES must pass the claim too. Testing samplePoints alone is not
     enough and sabotage showed why: changing the call to hash only the
     question left this guard perfectly happy while restoring a grid an
     attacker can compute in advance. A property of a helper is not a property
     of the code that uses it. */
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  for (const [name, fn, claimVar] of [['derivativeCheck', 'derivativeCheck', 'line'],
    ['integralCheck', 'integralCheck', 'line'],
    ['identityCheck', 'identityCheck', 'line'],
    ['polyOf', 'polyOf', 'ints']]) {
    const at = html.indexOf('function ' + fn + '(');
    if (at < 0) { bad.push(`sampling: ${name} not found — guard is stale`); continue; }
    const body = html.slice(at, at + 6000);
    const call = body.match(/samplePoints\(([^)]*)\)/);
    if (!call) { bad.push(`sampling: ${name} does not call samplePoints`); continue; }
    if (!new RegExp('\\b' + claimVar + '\\b').test(call[1])) {
      bad.push(`sampling: ${name} derives its grid from ${call[1].trim()} — the CLAIM (${claimVar}) ` +
               'is not in the key, so the points can be computed before the answer is written');
    }
  }
  return bad;
}

/* ---------- NO FALSE CERTIFICATION ----------
   Some failures cannot be seen in the final state. polyOf recovers a
   polynomial from finite differences at the integers 0…7, and adding
   x(x-1)…(x-7) to a cubic is invisible there — so a degree-11 equation was
   read as the cubic and its root set certified COMPLETE, while the real
   equation has further roots off the integers. The overall verdict stayed
   `checked` either way, because the three claimed roots really are roots; what
   was false was the CLAIM OF COMPLETENESS.

   Finite differences need equal spacing, so unlike the other checkers this one
   cannot simply move to random points — the recovery maths depends on the
   spacing. It keeps the grid and verifies its own answer instead: the
   recovered polynomial is compared against the original expression at
   claim-derived points, and anything that is not really that polynomial gets
   no verdict. These cases assert the KIND is absent, which is the only place
   the difference shows. */
const NO_CERT = [
  ['polyOf forgery', 'Solve x^3-6x^2+11x-6 + x*(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)*(x-7) = 0',
   '## ✅ Answer\n**x = 1, x = 2, x = 3**', 'roots'],
  ['polyOf forgery', 'Solve x^2-5x+6 + x*(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)*(x-7) = 0',
   '## ✅ Answer\n**x = 2, x = 3**', 'roots'],
];

function checkNoFalseCertification(V) {
  const bad = [];
  for (const [name, q, a, kind] of NO_CERT) {
    let r;
    try { r = V.run(q, a); } catch (e) { bad.push(`${name} THREW ${e.message}`); continue; }
    const hit = (r.checks || []).filter((c) => c.kind === kind && c.ok === true);
    if (hit.length) {
      bad.push(`no-cert [${name}]: "${kind}" certified this as complete, but the equation is ` +
               `not the polynomial it was read as — the extra term vanishes on the sampling ` +
               `grid and the real root set is larger\n            ${hit[0].text}`);
    }
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
    const sig = checks.map((x) => x.kind + (x.ok ? '+' : '-') +
      (x.kind === 'descent' && /slip in one number/.test(String(x.text)) ? ':slip' : ''))
      .sort().join(',');
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

  /* no checker may certify a claim it cannot actually establish */
  bad.push(...checkNoFalseCertification(V));

  /* the sampling mechanism itself: claim-dependent, deterministic, enough points */
  bad.push(...checkSampling(V));

  /* only the engine may certify: model prose must not be titled as the verdict */
  bad.push(...checkVerificationAuthority(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')));

  /* the wiring between a verdict and the badge a student actually sees */
  bad.push(...checkBadgeContract(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')));

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
                SYNDIV.length + SYNDIV_EQUIV.length + AUTHORITY_HEADINGS.length + 6 + NO_CERT.length + contractPairs.length +
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
