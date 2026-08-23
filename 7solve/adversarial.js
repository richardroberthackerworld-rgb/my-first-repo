#!/usr/bin/env node
/* ============================================================
   7Solve — ADVERSARIAL REGRESSION SUITE
   ------------------------------------------------------------
   parity.js asks "do the two engines agree?".
   negative-control.js asks "is each check actually wired?".
   This asks the only question a student cares about:

       IS THE VERDICT RIGHT?

   and it asks it with cases built to be wrong in the specific
   ways this engine has actually been wrong, or could plausibly
   be wrong tomorrow. Every case here is an attack. A suite of
   answers that ought to pass proves nothing, because a checker
   that certifies everything passes it perfectly — so each family
   carries its own control: an honest answer of the same shape,
   which must survive untouched.

       node adversarial.js

   Exit 0 = every attack was caught and every honest answer
            survived.
   Exit 1 = at least one attack got through, and the case is
            printed with what it should have said.

   THE FAMILIES, and the real failure behind each:

   1  NOTATION INTEGRITY   3^(x+y) read as 3x+y. The reported
                           bug, and it entered through the
                           CLIPBOARD, not the solver.
   2  SHREDDED PASTE       what the clipboard actually delivers
                           when you copy rendered mathematics.
   3  DOMAIN               "positive integers" answered -2, which
                           used to earn a green badge.
   4  COMPLETENESS         found is not all: three verified pairs
                           of an equation with infinitely many.
   5  DESCENT              "by Vieta jumping all solutions
                           follow" is a sentence, not a proof.
   6  FALSE PATTERNS       1, 1, 2, 5, 13 are all Fibonacci
                           numbers and are not the Fibonacci
                           sequence.
   7  ONE-WAY STEPS        squaring manufactures roots that only
                           substitution can catch.
   8  THE GROWTH LEMMA     the inequality every completeness
                           proof here rests on, re-checked in
                           exact integers by this file rather
                           than trusted from the code that
                           produced it.
   9  THE JS-ONLY CHECKS   the ones parity cannot see, by
                           construction.

   Every verdict case states what it demands in CANONICAL terms —
   verified / disputed / unverified — because the browser's finer
   states (worked, explained, plain, partial) describe what was
   looked at rather than making a claim, and pinning them here
   would make this file break on a wording change instead of on a
   mathematical one.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

/* ---------- load the SHIPPING modules, not copies ---------- */
function cut(startMark, endMark, what) {
  const s = html.indexOf(startMark);
  const e = html.indexOf(endMark, s);
  if (s < 0 || e < s) throw new Error('could not find ' + what + ' in index.html');
  return html.slice(s, e);
}
function load() {
  const deriv = cut('var Deriv = (function(){', '\nwindow.Deriv = Deriv;', 'the Deriv module');
  const delat = cut('function deLatex(md){', '\nwindow.deLatex7 = deLatex;', 'deLatex');
  const paste = cut('var MathPaste = (function(){', '\nwindow.MathPaste = MathPaste;', 'the MathPaste module');
  const ingest = cut('var Ingest = (function(){', '\nwindow.Ingest = Ingest;', 'the Ingest module');
  const resume = cut('function resumePoint(text){', '\n}', 'resumePoint') + '\n}';
  const shape = 'var DOC_QUESTION_MAX = 6000;\n' +
    cut('function looksLikeQuestions(t){', '\n}', 'looksLikeQuestions') + '\n}';
  const verify = cut('var Verify = (function(){', '\n})();', 'the Verify module') + '\n})();';
  const sandbox = {
    window: {}, console, W: {}, $: () => null, state: {},
    Math, parseFloat, parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON, BigInt,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    deriv + '\nwindow.Deriv = Deriv;\n' +
    delat + '\nwindow.deLatex7 = deLatex;\n' +
    paste + '\nwindow.MathPaste = MathPaste;\n' +
    verify + '\nwindow.Verify = Verify;\n' +
    ingest + '\nwindow.Ingest = Ingest;\n' + resume + '\n' + shape + '\n' +
    'this.__V = Verify; this.__A = Verify.Algebra; this.__P = MathPaste; this.__L = deLatex; this.__I = Ingest; this.__R = resumePoint; this.__Q = looksLikeQuestions;',
    sandbox, { timeout: 15000 });
  if (!sandbox.__V || !sandbox.__P || !sandbox.__I) throw new Error('the modules did not load');
  if (typeof sandbox.__R !== 'function') throw new Error('resumePoint did not load');
  if (typeof sandbox.__Q !== 'function') throw new Error('looksLikeQuestions did not load');
  return { V: sandbox.__V, A: sandbox.__A, P: sandbox.__P, deLatex: sandbox.__L, I: sandbox.__I,
           R: sandbox.__R, Q: sandbox.__Q };
}
const { V, A, P, deLatex, I, R, Q } = load();

/* Canonical outcome, per VERIFICATION-CONTRACT.md. */
const CANON = {
  checked: 'verified',
  disputed: 'disputed', stepfail: 'disputed', invalid_question: 'disputed',
  worked: 'unverified', explained: 'unverified', plain: 'unverified',
  partial: 'unverified', unverified: 'unverified',
};

const bad = [];
let ran = 0;
function check(family, name, got, want, extra) {
  ran++;
  if (got === want) return;
  bad.push('[' + family + '] ' + name + '\n      wanted ' + want + ', got ' + got +
           (extra ? '\n      ' + extra : ''));
}
function verdict(q, a) {
  const r = V.run(q, a);
  return { canon: CANON[r.state] || ('UNMAPPED:' + r.state), state: r.state,
           sig: (r.checks || []).map((c) => c.kind + (c.ok ? '+' : '-')).join(',') };
}

/* ============================================================
   1. NOTATION INTEGRITY
   ------------------------------------------------------------
   The pairs from the bug report, each of which a careless reader
   collapses into the other. Checked at the PARSER rather than
   through prose: two expressions that mean different things must
   never evaluate the same, and the one the question wrote must be
   the one that survives normalisation.
   ============================================================ */
const NOTATION = [
  ['3^{x+y} is not 3x+y',        '3^{x+y}',      '3x+y'],
  ['3^{x+y} is not 3(x+y)',      '3^{x+y}',      '3*(x+y)'],
  ['x+y is not x-y',             'x+y',          'x-y'],
  ['x^2 is not 2x',              'x^{2}',        '2x'],
  ['xy is not x+y',              'xy',           'x+y'],
  ['sqrt(x+y) is not sqrt(x)+y', '\\sqrt{x+y}',  '\\sqrt{x}+y'],
  ['(x+y)^2 is not x^2+y^2',     '(x+y)^{2}',    'x^{2}+y^{2}'],
  ['x/y is not x over nothing',  '\\frac{x}{y}', 'x'],
];
const NOTATION_ENVS = [{ x: 2, y: 3 }, { x: 5, y: 1 }, { x: 1, y: 7 }, { x: 4, y: 4 }];
for (const [name, a, b] of NOTATION) {
  const pa = A.parse(deLatex(a)), pb = A.parse(deLatex(b));
  if (!pa || !pb) {
    check('notation', name, 'unparseable', 'parsed',
          'deLatex gave ' + deLatex(a) + ' and ' + deLatex(b));
    continue;
  }
  let differs = false;
  for (const env of NOTATION_ENVS) {
    if (!(Math.abs(A.evalAt(pa, env) - A.evalAt(pb, env)) < 1e-9)) { differs = true; break; }
  }
  check('notation', name, differs ? 'different' : 'IDENTICAL', 'different',
        'deLatex gave ' + deLatex(a) + ' and ' + deLatex(b));
}

/* The exponent must survive deLatex as a GROUP. Stripping those braces is the
   single edit that turns the reported question into the reported bug. */
check('notation', '3^{x+y} keeps its grouping through deLatex',
      /3\^\(x\+y\)/.test(deLatex('3^{x+y}')) ? 'grouped' : 'UNGROUPED', 'grouped',
      'deLatex gave ' + deLatex('3^{x+y}'));

/* Superscript digits above 4 must tokenise. deLatex EMITS them — ^7 becomes a
   superscript seven — so a gap here is one half of the pipeline refusing what
   the other half produces, which is how x^7 + 1 = 0 became invisible to every
   check in the engine. */
for (let d = 0; d <= 9; d++) {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹'[d];
  const ast = A.parse('2' + sup);
  check('notation', 'the superscript for ' + d + ' tokenises', ast ? A.evalAt(ast, {}) : null,
        Math.pow(2, d));
}
check('notation', 'a two-digit superscript is one exponent, not two',
      A.evalAt(A.parse('2¹²'), {}), 4096);

/* And the equation scanner must SPAN what the tokeniser can read. */
for (const q of ['Solve x^{5}+1=0', 'Solve x^{7}+1=0', 'Solve x^{9}=512']) {
  check('notation', 'findEquation spans ' + q,
        V.findEquation(deLatex(q)) ? 'found' : 'MISSED', 'found');
}

/* ============================================================
   2. SHREDDED PASTE
   ------------------------------------------------------------
   What the clipboard delivers when a student copies rendered
   mathematics, and — just as important — what must be left alone.
   A repair that fires on ordinary multi-line text invents a
   question nobody asked, which is the same failure pointed the
   other way.
   ============================================================ */
const SHRED_REPAIRED = [
  ['the reported paste, verbatim',
   'Find all positive integers x,y satisfying\n\nx\n2\n+xy+y\n2\n=3\nx+y\n.\n\n' +
   'Then determine the sum of all possible values of x+y.',
   'x^(2)+xy+y^(2)=3^(x+y).'],
  ['a bare quadratic', 'x\n2\n+1=0', 'x^(2)+1=0'],
  ['an exponent that is a sum', '2\nn+1\n=32', '2^(n+1)=32'],
];
for (const [name, src, want] of SHRED_REPAIRED) {
  const got = P.shredded(src);
  check('paste', name, got && got.indexOf(want) >= 0 ? 'repaired' : 'NOT REPAIRED', 'repaired',
        'got ' + JSON.stringify(got));
}

const SHRED_LEFT_ALONE = [
  ['ordinary one-line algebra', 'Solve x^2 - 5x + 6 = 0'],
  ['a numbered list of questions', '1. Solve x+1=0\n2. Solve x+2=0'],
  ['a system written one per line', 'a = 1\nb = 2\nc = 3'],
  ['a column of numbers', '2\n4\n6\n8'],
  ['prose across two lines', 'Find x\nand then find y'],
  ['a table of values', 'x: 1, 2, 3\ny: 2, 4, 6'],
];
for (const [name, src] of SHRED_LEFT_ALONE) {
  check('paste', name + ' is left alone', P.shredded(src) === null ? 'untouched' : 'REWRITTEN',
        'untouched', 'became ' + JSON.stringify(P.shredded(src)));
}

/* End to end: the repaired question is one the verifier can read, and the
   unrepaired one really does read as the wrong problem — which is the whole
   claim this module rests on, so it is asserted rather than assumed. */
{
  const shred = 'Find all positive integers x,y satisfying\n\nx\n2\n+xy+y\n2\n=3\nx+y\n.';
  const fixed = P.shredded(shred);
  const eq = V.findEquation(deLatex(fixed || ''));
  check('paste', 'the repaired question parses with its exponent intact',
        eq && /3\^\(x\+y\)/.test(eq.src) ? 'exponent intact' : 'EXPONENT LOST', 'exponent intact',
        'findEquation read ' + (eq ? eq.src : 'nothing'));
  const corrupt = V.findEquation(shred.replace(/\n+/g, ' '));
  check('paste', 'the UNrepaired question really does read as the wrong problem',
        corrupt && /3 x\+y/.test(corrupt.src) ? 'corrupt as expected' : 'unexpected',
        'corrupt as expected', 'findEquation read ' + (corrupt ? corrupt.src : 'nothing'));
}

/* ============================================================
   3-7. VERDICTS
   ------------------------------------------------------------
   [family, name, question, answer, canonical verdict demanded]
   ============================================================ */
const VERDICTS = [
  /* ---- 3. DOMAIN: the constraint the question set ---- */
  ['domain', 'a negative root offered to a positive-integer question',
   'Find all positive integers n with n^2-4=0.',
   '## ✅ Final Answer\nn = 2 and n = -2', 'disputed'],
  ['domain', 'the same question answered correctly is NOT punished for it',
   'Find all positive integers n with n^2-4=0.',
   '## ✅ Final Answer\nn = 2', 'verified'],
  ['domain', 'without the restriction, both roots are right',
   'Solve x^2-4=0',
   '## ✅ Final Answer\nx = 2 and x = -2', 'verified'],
  ['domain', 'integers means integers: -2 is allowed',
   'Find all integers n with n^2-4=0.',
   '## ✅ Final Answer\nn = 2 and n = -2', 'verified'],
  ['domain', 'a repeated value against "distinct"',
   'Find all distinct positive integers x,y with x+y=4.',
   '## ✅ Final Answer\n(2,2)', 'disputed'],
  ['domain', 'zero offered to a positive-integer question',
   'Find all positive integers n with n^2-n=0.',
   '## ✅ Final Answer\nn = 0 and n = 1', 'disputed'],
  ['domain', 'a composite offered to a question about primes',
   'Find all primes p with p^2-4p+3=0.',
   '## ✅ Final Answer\np = 1 and p = 3', 'disputed'],
  ['domain', 'the prime question answered with only the prime root',
   'Find all primes p with p^2-4p+3=0.',
   '## ✅ Final Answer\np = 3', 'verified'],
  ['domain', 'a negative offered to a question about primes',
   'Find all primes p with p^2-4=0.',
   '## ✅ Final Answer\np = 2 and p = -2', 'disputed'],
  ['domain', 'a pair the wrong way round for "x > y"',
   'Find all positive integers x,y with x > y and x+y=10.',
   '## ✅ Final Answer\n(3,7)', 'disputed'],

  /* ---- 4. COMPLETENESS: found is not all ---- */
  /* Was 'unverified' until the witness route existed. It is not that the engine
     cannot tell — (1,2) gives 1 + 4 + 1 = 6 = 3·1·2 — it is that the engine used
     to need a PROVED bound before it would speak. Refuting needs no bound. */
  ['complete', 'three verified pairs of an equation with infinitely many',
   'Find all positive integers x,y with x^2+y^2+1=3xy.',
   '## ✅ Final Answer\nThe solutions are (1,1), (2,5) and (5,13).', 'disputed'],
  ['complete', 'four verified triples of the Markov equation',
   'Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   '## ✅ Final Answer\nThe solutions are (1,1,1), (1,1,2), (1,2,5) and (1,5,13).', 'disputed'],
  ['complete', 'the reported question, answered correctly',
   'Find all positive integers x,y satisfying x^2+xy+y^2=3^{x+y}.',
   '## ✅ Final Answer\nThere are no positive integer solutions.', 'verified'],
  ['complete', 'the reported question, answered with invented solutions',
   'Find all positive integers x,y satisfying x^2+xy+y^2=3^{x+y}.',
   '## ✅ Final Answer\nThe solutions are (1,2) and (2,1).', 'disputed'],
  ['complete', 'a bounded exponential question answered in full',
   'Find all positive integers n with n^2=2^n.',
   '## ✅ Final Answer\nn = 2 and n = 4', 'verified'],
  ['complete', 'the same question with a solution left out',
   'Find all positive integers n with n^2=2^n.',
   '## ✅ Final Answer\nn = 2', 'disputed'],
  ['complete', 'a cubic answered with all three of its roots',
   'Solve x^3-6x^2+11x-6=0',
   '## ✅ Final Answer\nx = 1, x = 2, x = 3', 'verified'],
  ['complete', 'the same cubic missing a root',
   'Solve x^3-6x^2+11x-6=0',
   '## ✅ Final Answer\nx = 1, x = 2', 'disputed'],

  /* ---- 5. DESCENT: named is not proved ---- */
  ['descent', '"by Vieta jumping all solutions follow"',
   'Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Final Answer\nAll solutions arise from (1,1,1) by Vieta jumping.\n\n' +
   '## 📖 Step-by-Step Solution\n1. By Vieta jumping all solutions follow.', 'disputed'],
  ['descent', 'a descent that states its obligations is accepted',
   'Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Final Answer\nAll solutions arise from (1,1,1).\n\n' +
   '## 📖 Step-by-Step Solution\n' +
   '1. Fix y and z. The equation is a quadratic in x whose roots sum to 3yz, so the second ' +
   'root 3yz - x is an integer.\n' +
   '2. If x is the largest of the three, that second root is positive and strictly smaller.\n' +
   '3. A strictly decreasing sequence of positive integers is finite, so the descent ' +
   'terminates; the base case is (1,1,1).', 'unverified'],
  ['descent', '"continuing this pattern gives the rest"',
   'Find all positive integer solutions.',
   '## ✅ Final Answer\nContinuing this pattern gives all solutions.', 'disputed'],
  ['descent', 'a recurrence asserted to generate everything',
   'Find all solutions.',
   '## ✅ Final Answer\nThis recurrence generates all solutions: a(n) = 3a(n-1) - a(n-2).',
   'disputed'],

  /* ---- 6. FALSE PATTERNS ---- */
  ['pattern', 'every other Fibonacci number called the Fibonacci sequence',
   'What sequence do the Markov triples give?',
   '## ✅ Final Answer\nThey are the Fibonacci sequence 1, 1, 2, 5, 13, 34.', 'disputed'],
  ['pattern', 'the real Fibonacci sequence is not punished',
   'What is this sequence?',
   '## ✅ Final Answer\nIt is the Fibonacci sequence 1, 1, 2, 3, 5, 8, 13.', 'verified'],
  ['pattern', 'a near-arithmetic sequence called arithmetic',
   'What is this sequence?',
   '## ✅ Final Answer\nIt is an arithmetic progression 2, 5, 8, 11, 15.', 'disputed'],
  ['pattern', 'a real arithmetic progression is not punished',
   'What is this sequence?',
   '## ✅ Final Answer\nIt is an arithmetic progression 2, 5, 8, 11, 14.', 'verified'],
  ['pattern', 'a near-geometric sequence called geometric',
   'What is this sequence?',
   '## ✅ Final Answer\nIt is a geometric sequence 3, 6, 12, 24, 49.', 'disputed'],
  ['pattern', 'triangular numbers that are not consecutive',
   'What is this sequence?',
   '## ✅ Final Answer\nThey are the triangular numbers 1, 3, 6, 15.', 'disputed'],

  /* ---- 7. ONE-WAY STEPS AND EXTRANEOUS ROOTS ---- */
  ['oneway', 'an extraneous root kept after squaring',
   'Solve sqrt(x+6) = x',
   '## ✅ Final Answer\nx = 3 and x = -2\n\n## 📖 Step-by-Step Solution\n' +
   '1. Squaring both sides gives x+6 = x^2.\n2. x^2 - x - 6 = 0, so x = 3 or x = -2.', 'disputed'],
  ['oneway', 'the extraneous root correctly rejected',
   'Solve sqrt(x+6) = x',
   '## ✅ Final Answer\nx = 3\n\n## 📖 Step-by-Step Solution\n' +
   '1. Squaring both sides gives x+6 = x^2, so x = 3 or x = -2.\n' +
   '2. Substituting back into the original equation, x = -2 is extraneous.', 'unverified'],

  /* ---- 10. COUNTEREXAMPLES: a universal claim is refuted by one value ---- */
  ['counter', "Euler's polynomial, prime for n = 0…39 and composite at 40",
   'Is n^2+n+41 always prime?',
   '## ✅ Final Answer\nn^2 + n + 41 is prime for every n.', 'disputed'],
  ['counter', 'a false universal inequality',
   'Show that n^2 > 2n.',
   '## ✅ Final Answer\nFor all n, n^2 > 2n.', 'disputed'],
  ['counter', 'a false sign claim',
   'Is it positive?',
   '## ✅ Final Answer\nThe expression x^2 - 4 is always positive.', 'disputed'],
  ['counter', 'a false parity claim',
   'Is it even?',
   '## ✅ Final Answer\nn^2 + n + 1 is always even.', 'disputed'],

  /* ---- 11. THE TWO OTHER COMPLETENESS ROUTES ---- */
  ['complete', 'a modular obstruction proves emptiness over the whole integers',
   'Find all integers x,y with x^2-3y^2=2.',
   '## ✅ Final Answer\nThere are no integer solutions.', 'verified'],
  ['complete', 'the same equation answered with invented solutions',
   'Find all integers x,y with x^2-3y^2=2.',
   '## ✅ Final Answer\nThe solutions are (2,1) and (5,3).', 'disputed'],
  ['complete', 'a Pell equation with infinitely many solutions claims nothing',
   'Find all integers x,y with x^2-3y^2=1.',
   '## ✅ Final Answer\n(1,0) and (2,1)', 'unverified'],
  ['complete', 'a range the question itself stated makes enumeration a proof',
   'Find all positive integers n with 1 <= n <= 100 such that n^2-9=0.',
   '## ✅ Final Answer\nn = 3', 'verified'],
  ['complete', 'the same stated range with a solution left out',
   'Find all positive integers n with n <= 100 such that n^2-5n+6=0.',
   '## ✅ Final Answer\nn = 2', 'disputed'],

  /* ---- 12. ARITHMETIC A CALCULATOR CAN DO EXACTLY ----
     evalFlat reads digits and four operators. Everything else — powers,
     roots, brackets, percentages — went unchecked, and those are exactly
     the ones a language model gets wrong. */
  ['calc', 'a wrong power', 'What is 2^10?',
   '## ✅ Final Answer\n2^10 = 1000', 'disputed'],
  ['calc', 'the right power', 'What is 2^10?',
   '## ✅ Final Answer\n2^10 = 1024', 'verified'],
  ['calc', 'a wrong root', 'Simplify √144',
   '## ✅ Final Answer\n√144 = 14', 'disputed'],
  ['calc', 'a wrong bracketed square', 'Evaluate (3+4)²',
   '## ✅ Final Answer\n(3+4)² = 25', 'disputed'],
  ['calc', 'a wrong percentage', 'What is 15% of 200?',
   '## ✅ Final Answer\n15% of 200 = 35', 'disputed'],
  ['calc', 'the right percentage', 'What is 15% of 200?',
   '## ✅ Final Answer\n15% of 200 = 30', 'verified'],

  /* ---- 13. THE DERIVATION CHAIN ---- */
  ['chain', 'dividing by x loses a root, and every later line is still true',
   'Solve 2x^2 = 6x',
   '## ✅ Final Answer\nx = 3\n\n## 📖 Step-by-Step Solution\n1. Start from 2x^2 = 6x.\n2. Divide both sides by x: 2x = 6.\n3. So x = 3.', 'disputed'],
  ['chain', 'the same question with the case split handled',
   'Solve 2x^2 = 6x',
   '## ✅ Final Answer\nx = 0 and x = 3\n\n## 📖 Step-by-Step Solution\n1. Either x = 0, or dividing by x gives 2x = 6.\n2. So x = 0 or x = 3.', 'verified'],

  /* ---- 14. AN EQUATION THAT BOUNDS ITS OWN VARIABLES ---- */
  ['complete', 'a linear Diophantine, answered in full',
   'Find all positive integers x,y with 3x + 5y = 31.',
   '## ✅ Final Answer\n(7,2) and (2,5)', 'verified'],
  ['complete', 'the same one with a pair left out',
   'Find all positive integers x,y with 3x + 5y = 31.',
   '## ✅ Final Answer\n(7,2)', 'disputed'],
  ['complete', 'a sum of two squares, answered in full',
   'Find all positive integers x,y with x^2 + y^2 = 25.',
   '## ✅ Final Answer\n(3,4) and (4,3)', 'verified'],
  ['complete', 'a product, answered in full',
   'Find all positive integers x,y with xy = 12.',
   '## ✅ Final Answer\n(1,12), (2,6), (3,4), (4,3), (6,2) and (12,1)', 'verified'],

  /* ---- 15. UNITS, WITH MAGNITUDE ----
     The dimensional analyser knows km and m are both lengths and refuses to
     know how many of one make the other. That is right for what it does and
     blind to the two errors a physics answer actually makes. */
  ['units', 'F = ma must produce newtons, not joules', 'Find the force.',
   '## ✅ Final Answer\nF = 5 kg × 2 m/s² = 10 J', 'disputed'],
  ['units', 'and newtons are accepted', 'Find the force.',
   '## ✅ Final Answer\nF = 5 kg × 2 m/s² = 10 N', 'verified'],
  ['units', 'the right unit with the wrong number', 'Find the force.',
   '## ✅ Final Answer\nF = 5 kg × 2 m/s² = 20 N', 'disputed'],
  ['units', 'a conversion done wrong', 'Convert to m/s.',
   '## ✅ Final Answer\n60 km/h = 21 m/s', 'disputed'],
  ['units', 'the same conversion done right', 'Convert to m/s.',
   '## ✅ Final Answer\n60 km/h = 16.67 m/s', 'verified'],
  ['units', 'celsius treated as a scale factor instead of an offset', 'Convert to kelvin.',
   '## ✅ Final Answer\n25 °C = 25 K', 'disputed'],
  ['units', 'the offset applied correctly', 'Convert to kelvin.',
   '## ✅ Final Answer\n25 °C = 298 K', 'verified'],
  ['units', 'work in newtons instead of joules', 'Find the work done.',
   '## ✅ Final Answer\nW = 5 N × 3 m = 15 N', 'disputed'],
  ['units', 'a concentration divided wrongly', 'Find the concentration.',
   '## ✅ Final Answer\nc = 0.5 mol / 2 L = 0.5 mol/L', 'disputed'],

  /* ---- the verification gate itself ----
     Inject a value that is simply not a solution and demand rejection. If any
     of these ever passes, nothing else in this file means anything. */
  ['gate', 'a wrong root of a linear equation', 'Solve 3x - 6 = 0',
   '## ✅ Final Answer\nx = 5', 'disputed'],
  ['gate', 'a wrong root of a quadratic', 'Solve x^2 - 5x + 6 = 0',
   '## ✅ Final Answer\nx = 2 and x = 4', 'disputed'],
  ['gate', 'a wrong pair for a two-variable equation',
   'Find positive integers x,y with x^2+y^2+1=3xy.',
   '## ✅ Final Answer\n(2,3)', 'disputed'],
  ['gate', 'a wrong derivative', 'differentiate x^3 sin x',
   '## ✅ Final Answer\n**3x² sin(x)**', 'disputed'],
  ['gate', 'the right derivative', 'differentiate x^3 sin x',
   '## ✅ Final Answer\n**3x² sin(x) + x³ cos(x)**', 'verified'],
];

for (const [family, name, q, a, want] of VERDICTS) {
  const r = verdict(q, a);
  check(family, name, r.canon, want, 'state=' + r.state + ' checks=[' + r.sig + ']');
}

/* ============================================================
   8. THE GROWTH LEMMA ITSELF
   ------------------------------------------------------------
   Every completeness proof above rests on one inequality, so it is
   tested directly and not only through its consequences. Section 8
   of the brief: an asymptotic statement is not a proof over a
   domain. What growthBound returns is the S0 from which induction
   carries the inequality forward forever, and both halves of that
   induction are re-checked here in exact integers, independently
   of the code that produced them.
   ============================================================ */
const BOUNDS = [
  /* the reported question: M = 3, d = 2, c = 3 — 3^s > 3s^2 first holds at 4 */
  [3, 2, 3, 4],
  /* n^2 = 2^n: M = 1, d = 2, c = 2 — 2^s > s^2 first holds at 5 */
  [1, 2, 2, 5],
];
const pw = (b, e) => { let r = 1n; for (let i = 0; i < e; i++) r *= b; return r; };
for (const [M, d, c, wantS0] of BOUNDS) {
  const g = V.growthBound(M, d, c);
  if (!g) {
    check('growth', c + '^s > ' + M + 's^' + d + ' has a bound', 'none', 'S0=' + wantS0);
    continue;
  }
  check('growth', c + '^s > ' + M + 's^' + d + ' first holds at', g.S0, wantS0);
  const Mb = BigInt(M), cb = BigInt(c);
  check('growth', 'base case at S0 for c=' + c,
        pw(cb, g.S0) > Mb * pw(BigInt(g.S0), d) ? 'holds' : 'FAILS', 'holds');
  let stepOk = true;
  for (let s = g.s1; s <= g.S0 + 60; s++) {
    if (!(pw(BigInt(s + 1), d) <= cb * pw(BigInt(s), d))) stepOk = false;
  }
  check('growth', 'inductive step from s1 for c=' + c, stepOk ? 'holds' : 'FAILS', 'holds');
  let conclusion = true;
  for (let s = g.S0; s <= g.S0 + 60; s++) {
    if (!(pw(cb, s) > Mb * pw(BigInt(s), d))) conclusion = false;
  }
  check('growth', 'the inequality really does hold past S0 for c=' + c,
        conclusion ? 'holds' : 'FAILS', 'holds');
  /* S0 must be the FIRST such s. Too large only enumerates more than needed;
     too small would leave solutions outside the region and call the list
     complete anyway, which is the failure this whole module exists to stop. */
  if (g.S0 > 1) {
    check('growth', 'S0 is minimal for c=' + c,
          pw(cb, g.S0 - 1) > Mb * pw(BigInt(g.S0 - 1), d) ? 'NOT MINIMAL' : 'minimal', 'minimal');
  }
}

/* The two other completeness routes, exercised directly. A modular
   obstruction is an exhaustive residue sweep, so it is re-derived here
   rather than trusted: if the checker says nothing is 0 mod m, this file
   checks that for itself. */
const OBSTRUCTIONS = [
  ['x^2-3y^2=2 has no integer solutions', 'x^2-3y^2=2', true],
  ['x^2+y^2=3z^2 beyond the origin', 'x^2-3y^2=2', true],
  ['x^2-3y^2=1 is a Pell equation and has plenty', 'x^2-3y^2=1', false],
  ['x+y=10 obviously has solutions', 'x+y=10', false],
];
for (const [name, src, wantObst] of OBSTRUCTIONS) {
  const eq = A.parseEquation(src);
  const got = V.modulusObstruction(eq, eq.vars, src);
  check('growth', name, got ? 'obstructed' : 'none', wantObst ? 'obstructed' : 'none');
  if (got) {
    /* re-derive the sweep: nothing in (Z/m)^k may satisfy it */
    const m = got.m, k = eq.vars.length;
    let anyZero = false;
    const xs = new Array(k).fill(0);
    (function rec(i) {
      if (anyZero) return;
      if (i === k) {
        const env = {};
        eq.vars.forEach((v, j) => { env[v] = xs[j]; });
        const d = A.evalAt(eq.L, env) - A.evalAt(eq.R, env);
        if (((Math.round(d) % m) + m) % m === 0) anyZero = true;
        return;
      }
      for (let v = 0; v < m && !anyZero; v++) { xs[i] = v; rec(i + 1); }
    })(0);
    check('growth', name + ': the sweep really is empty mod ' + m,
          anyZero ? 'A RESIDUE WORKS' : 'empty', 'empty');
  }
}

const STATED = [
  ['1 <= n <= 100', 'Find all positive integers n with 1 <= n <= 100', 1, 100],
  ['n <= 50', 'Find all positive integers n with n <= 50', 1, 50],
  ['n < 50', 'Find all positive integers n with n < 50', 1, 49],
  ['between 5 and 20', 'Find all positive integers n between 5 and 20', 5, 20],
  ['two-digit', 'Find all two-digit positive integers n', 10, 99],
  ['at most 30', 'Find all positive integers n at most 30', 1, 30],
  ['no bound at all', 'Find all positive integers n', null, null],
];
for (const [name, q, lo, hi] of STATED) {
  const b = V.statedBound(q, ['n'], V.domainOf(q) || { low: 1 });
  check('growth', 'statedBound reads ' + name, b ? b.lo + '..' + b.hi : null,
        lo === null ? null : lo + '..' + hi);
}
/* Two variables must NEVER take a stated bound: "x <= 100" might bound one
   variable or both, and guessing generously means missing a solution and then
   calling the list complete. */
check('growth', 'a stated bound is refused for two variables',
      V.statedBound('Find all positive integers x,y with x <= 100', ['x', 'y'], { low: 1 }),
      null);

/* A bound must NOT be claimed where the argument does not apply. */
const NO_BOUND = [
  ['a polynomial on both sides', 'Find all positive integers x,y with x^2+y^2+1=3xy.'],
  ['integers with no lower bound', 'Find all integers x,y with x^2+xy+y^2=3^(x+y).'],
];
for (const [name, q] of NO_BOUND) {
  const out = V.exhaustion(q, '## ✅ Final Answer\n(1,1)');
  /* CLAIMED, not merely spoken. A failing `exhaust` is a counterexample — one
     solution the answer left out — and needs no bound at all. What must never
     happen without a proved region is the PASS: "these are all of them". */
  check('growth', 'no completeness is CERTIFIED for ' + name,
        out.some((c) => c.kind === 'exhaust' && c.ok) ? 'CERTIFIED' : 'silent', 'silent');
}

/* ============================================================
   9. THE JS-ONLY CHECKERS, DIRECTLY
   ------------------------------------------------------------
   parity.js cannot cover these. Its comparison excludes any kind
   only one engine can emit — that is what makes it a parity test
   rather than a feature test — so a JS-only checker could be
   gutted and parity would still be green. negative-control does
   catch its wiring being cut, but only through the registry
   conformance check, which proves the LINE is present and not
   that the checker does anything. So the behaviour is pinned
   here, where it is actually exercised.
   ============================================================ */
const DIRECTION = [
  ['squaring, with no substitution back',
   'Squaring both sides gives x = 4. So x = 4.', true],
  ['squaring, with the roots checked',
   'Squaring both sides gives x = 4. Substituting back into the original equation confirms it.', false],
  ['squaring, with an extraneous root named',
   'Squaring both sides gives x = 3 or x = -2; x = -2 is extraneous.', false],
  ['clearing a denominator', 'Cross-multiplying gives x = 4.', true],
  ['dividing by an expression', 'Dividing both sides by (x-1) gives x = 4.', true],
  ['dividing by a constant is an equivalence', 'Dividing both sides by 2 gives x = 4.', false],
  ['multiplying by a constant is an equivalence', 'Multiplying both sides by 3 gives 3x = 12.', false],
  ['exponentiating a logarithm', 'Exponentiating both sides gives x = e^2.', true],
  ['ordinary working is not flagged', 'Adding 6 to both sides gives x = 10.', false],
];
for (const [name, md, wantFlag] of DIRECTION) {
  const out = V.directionCheck('', md);
  check('oneway', 'direction: ' + name, out.length > 0 ? 'flagged' : 'silent',
        wantFlag ? 'flagged' : 'silent', out.length ? out[0].text.slice(0, 90) : '');
  if (out.length) {
    check('oneway', 'direction: ' + name + ' stays advisory',
          out[0].soft === true && out[0].ok === false ? 'advisory' : 'NOT ADVISORY', 'advisory',
          'a check that reads prose must never decide the badge');
  }
}

/* The counterexample engine, directly. A verdict case cannot isolate it —
   `claim` disputes an unargued universal whatever this engine finds — so what
   must be asserted here is the thing only this engine decides: does it produce
   a counterexample, and is the counterexample real?

   The controls matter more than the attacks. A hunter that fires on true
   claims is worse than no hunter, because it teaches a student to ignore the
   one check that can settle a proof outright. */
const COUNTER = [
  ['Euler: prime for n = 0…39, composite at 40', 'n^2 + n + 41 is prime for every n.', 'n', 40],
  ['a false universal inequality', 'For all n, n^2 > 2n.', 'n', 1],
  ['a false sign claim', 'The expression x^2 - 4 is always positive.', 'x', 1],
  ['a false parity claim', 'n^2 + n + 1 is always even.', 'n', 1],
  ['a true universal inequality', 'For all n, n^2 + 1 > n.', null, null],
  ['a true sign claim', 'The expression x^2 + 1 is always positive.', null, null],
  ['a true parity claim', 'n^2 + n is always even.', null, null],
  ['e^x is always positive — true, and small enough to trip a naive > 0 test',
   'No real solution, because e^x is always positive.', null, null],
  ['a claim the answer already qualified', 'n^2 + n + 41 is prime for every n except n = 40.', null, null],
  ['a claim with no universal quantifier at all', 'Here n^2 - 4 is positive.', null, null],
  ['trigonometry is declined, not guessed at', 'For all x, sin(x) + 2 > 0.', null, null],
];
for (const [name, md, wantVar, wantVal] of COUNTER) {
  const out = V.counterexample('', md);
  check('counter', name, out.length ? 'refuted' : 'silent', wantVar ? 'refuted' : 'silent',
        out.length ? out[0].text.slice(0, 110) : '');
  if (wantVar && out.length) {
    check('counter', name + ': names the value that refutes it',
          out[0].text.indexOf(wantVar + ' = ' + wantVal) >= 0 ? 'named' : 'NOT NAMED', 'named',
          out[0].text.slice(0, 110));
  }
  if (out.length) {
    check('counter', name + ': can only ever fail',
          out.every((c) => c.ok === false) ? 'fails only' : 'CLAIMED A PASS', 'fails only',
          'a clean search is not a proof and must never be reported as one');
  }
}

/* The domain reader, directly: every constraint verdict rests on it. */
const DOMAINS = [
  ['Find all positive integers x,y', 1, 'positive integers'],
  ['Find all natural numbers n', 1, 'positive integers'],
  ['Find all non-negative integers n', 0, 'non-negative integers'],
  ['Find all nonnegative integers n', 0, 'non-negative integers'],
  ['Find all whole numbers n', 0, 'non-negative integers'],
  ['Find all integers n', null, 'integers'],
  ['Find all primes p', 2, 'primes'],
  ['Find all prime numbers p', 2, 'primes'],
  ['Solve x^2 = 4', null, null],
  ['Find the value of x', null, null],
];
for (const [q, low, label] of DOMAINS) {
  const d = V.domainOf(q);
  check('domain', 'domainOf reads ' + JSON.stringify(q), d ? d.label : null, label);
  if (d && label) check('domain', 'domainOf bounds ' + JSON.stringify(q), d.low, low);
}
check('domain', 'domainOf sees "distinct"',
      V.domainOf('Find all distinct positive integers').distinct, true);
check('domain', 'domainOf reads an ordering between two variables',
      JSON.stringify((V.domainOf('Find all positive integers x,y with x > y') || {}).order),
      JSON.stringify({ a: 'x', op: '>', b: 'y' }));

/* ============================================================
   10. THE INGESTION INVARIANT
   ------------------------------------------------------------
       original problem ≡ parsed problem ≡ solved problem

   Held before the model is asked, because a wrong reading of the
   question is the one error no later check can catch: every later
   check compares the answer against the question, so a corrupt
   question is one the answer agrees with.

   Three outcomes, and the third is the one that matters. CLEAN is
   solved as typed. REPAIRED is repaired, shown, then solved. FATAL
   is not solved at all — and the controls below matter more than
   the attacks, because an ingest layer that refuses ordinary
   questions is a product nobody can use.
   ============================================================ */
const INGEST_FATAL = [
  ['an OCR that could not read part of the question', 'Solve x^2 + [unclear]x + 6 = 0', 'unreadable'],
  ['an illegible marker', 'Find x where 3x + [illegible] = 12', 'unreadable'],
  ['a run of question marks where a term should be', 'Solve x^2 + ??? = 0', 'unreadable'],
  ['a bracket that never closes', 'Solve (x+2(x-3) = 0', 'brackets'],
  ['a bracket that closes twice', 'Solve (x+2)) = 0', 'brackets'],
];
for (const [name, q, code] of INGEST_FATAL) {
  const r = I.read(q);
  check('ingest', name + ' stops the solve', r.fatal ? r.fatal.code : 'ALLOWED', code,
        r.fatal ? '' : 'this would have been solved as if it were readable');
}

const INGEST_CLEAN = [
  ['ordinary algebra', 'Solve x^2 - 5x + 6 = 0'],
  ['a word problem', 'A train travels 60 km in 45 minutes. Find its speed.'],
  ['prose with an unclosed bracket is not maths', 'Explain photosynthesis (briefly'],
  ['a question with balanced nesting', 'Simplify ((x+1)(x-1))/(x^2-1)'],
  ['an inequality', 'Solve 2x + 3 > 11'],
  ['a chemistry question', 'Balance the equation for the combustion of methane'],
];
for (const [name, q] of INGEST_CLEAN) {
  const r = I.read(q);
  check('ingest', name + ' is solved as typed', (r.fatal ? 'STOPPED' : (r.changed ? 'REWRITTEN' : 'clean')),
        'clean', r.fatal ? r.fatal.say : (r.changed ? 'became ' + r.text : ''));
}

const INGEST_REPAIRED = [
  ['the reported paste',
   'Find all positive integers x,y satisfying\nx\n2\n+xy+y\n2\n=3\nx+y\n.',
   '3^(x+y)'],
  ['LaTeX from a textbook', 'Solve \\frac{x}{2} + 1 = 5', '(x)/2'],
  ['a braced exponent', 'Solve x^{2} - 4 = 0', 'x² - 4'],
];
for (const [name, q, want] of INGEST_REPAIRED) {
  const r = I.read(q);
  check('ingest', name + ' is repaired', r.fatal ? 'STOPPED' : (r.changed ? 'repaired' : 'UNTOUCHED'),
        'repaired', 'got ' + JSON.stringify(r.text));
  check('ingest', name + ': the repair says what it did',
        r.text.indexOf(want) >= 0 ? 'right reading' : 'WRONG READING', 'right reading',
        'wanted ' + want + ' in ' + JSON.stringify(r.text));
  check('ingest', name + ': the reading is shown, not hidden',
        (r.notes.length > 0 && I.reading(r).length > 0) ? 'shown' : 'SILENT', 'shown',
        'a repair a student cannot see is the same failure as the corruption');
}

/* And the invariant itself: what comes out of Ingest is what the verifier
   will read. If those two ever disagree the student is shown one question
   and graded against another. */
for (const q of ['Solve x^{2} - 4 = 0', 'Find all positive integers x,y with x^2+xy+y^2=3^{x+y}']) {
  const r = I.read(q);
  const mine = r.equation;
  const theirs = V.findEquation(deLatex(r.text));
  check('ingest', 'the reading shown is the equation the verifier uses, for ' + q,
        mine, theirs ? String(theirs.src).trim() : null);
}

/* ============================================================
   11. THE PIECES, DIRECTLY
   ------------------------------------------------------------
   A verdict case cannot isolate a checker that shares a kind with
   another, and Calc runs before the model rather than after it, so
   no verdict reaches it at all. Both are pinned here.
   ============================================================ */

/* The closed-form arithmetic pass, and what it must NOT read. */
const CLOSED = [
  ['a power', '2^10 = 1024', true, true],
  ['a wrong power', '2^10 = 1000', true, false],
  ['a root', '√144 = 12', true, true],
  ['a bracketed square', '(3+4)² = 49', true, true],
  ['a sum of fractions', '3/4 + 1/8 = 7/8', true, true],
  ['a percentage', '15% of 200 = 30', true, true],
  ['algebra is not arithmetic', 'x² - 4 = 0', false, null],
  ['a chemical equation is not arithmetic', '2H2 + O2 = 2H2O', false, null],
  ['a value with a unit is not arithmetic', 'The speed is 25 m/s', false, null],
  ['a bare assignment is not arithmetic', 'n = 2', false, null],
];
for (const [name, line, fires, ok] of CLOSED) {
  const r = V.arithmetic(line);
  check('calc', 'closed form: ' + name, r.length > 0 ? 'read' : 'silent', fires ? 'read' : 'silent',
        JSON.stringify(r.map((c) => (c.ok ? '+' : '-') + c.text)));
  if (fires && r.length) {
    check('calc', 'closed form: ' + name + ' gets the right verdict', r[0].ok, ok);
    check('calc', 'closed form: ' + name + ' shows the line as written',
          r[0].text.indexOf('/100') < 0 ? 'as written' : 'REWRITTEN', 'as written',
          'the percent rewrite is for the parser, not for the student');
  }
}

/* The derivation chain. */
const CHAIN = [
  ['dividing by x loses x = 0', 'Solve 2x^2 = 6x',
   '## ✅ Answer\nx = 3\n\n## 📖 Steps\n1. Start from 2x^2 = 6x.\n2. Divide both sides by x: 2x = 6.\n3. So x = 3.', 'breaks'],
  ['a case split is not an error', 'Solve 2x^2 = 6x',
   '## ✅ Answer\nx = 0 and x = 3\n\n## 📖 Steps\n1. Either x = 0, or dividing by x gives 2x = 6.\n2. So x = 0 or x = 3.', 'silent'],
  ['an arithmetic slip mid-derivation', 'Solve 3x + 6 = 12',
   '## ✅ Answer\nx = 3\n\n## 📖 Steps\n1. 3x + 6 = 12\n2. 3x = 9\n3. x = 3', 'breaks'],
  ['a sound derivation', 'Solve 2(x+3) - 4 = 10',
   '## ✅ Answer\nx = 4\n\n## 📖 Steps\n1. 2(x+3) - 4 = 10\n2. 2x + 6 - 4 = 10\n3. 2x + 2 = 10\n4. 2x = 8\n5. x = 4', 'holds'],
  ['squaring GAINS a root and must not be flagged', 'Solve sqrt(x+6) = x',
   '## ✅ Answer\nx = 3\n\n## 📖 Steps\n1. Squaring: x + 6 = x^2.\n2. x^2 - x - 6 = 0.\n3. x = 3 or x = -2; x = -2 is extraneous.', 'silent'],
  ['a root outside the stated domain was never lost',
   'Find all positive integers n with n^2 - 4 = 0',
   '## ✅ Answer\nn = 2\n\n## 📖 Steps\n1. n^2 - 4 = 0\n2. n^2 = 4', 'silent'],
];
/* And the checker must be IN the pipeline, not merely present in the file.
   The verdict cases above cannot prove that: `roots` disputes the lost-root
   answer on its own, so unwiring stepChain leaves them green. This asserts the
   kind actually reaches a report. */
{
  const r = V.run('Solve 2x^2 = 6x',
    '## ✅ Answer\nx = 3\n\n## 📖 Steps\n1. Start from 2x^2 = 6x.\n2. Divide both sides by x: 2x = 6.\n3. So x = 3.');
  check('chain', 'stepChain is wired into Verify.run',
        r.checks.some((c) => c.kind === 'step') ? 'wired' : 'NOT WIRED', 'wired',
        'checks were [' + r.checks.map((c) => c.kind).join(',') + ']');
}

for (const [name, q, md, want] of CHAIN) {
  const r = V.stepChain(q, md);
  const got = !r.length ? 'silent' : (r[0].ok ? 'holds' : 'breaks');
  check('chain', name, got, want, r.length ? r[0].text.slice(0, 120) : '');
  if (got === 'breaks') {
    check('chain', name + ': names the step', /step \d/.test(r[0].text) ? 'named' : 'NOT NAMED',
          'named', r[0].text.slice(0, 120));
  }
}

/* The positivity bound: an equation that pins its own variables. */
const POSBOUND = [
  ['3x + 5y = 31', '3x + 5y = 31', 1, [10, 6]],
  ['x^2 + y^2 = 25', 'x^2 + y^2 = 25', 1, [5, 5]],
  ['xy = 12', 'xy = 12', 1, [12, 12]],
  ['x - y = 3 has a negative term', 'x - y = 3', 1, null],
  ['x + y = 0 has nothing to bound', 'x + y = 0', 1, null],
];
for (const [name, src, low, want] of POSBOUND) {
  const eq = A.parseEquation(src);
  const diff = V.polyExpand({ t: 'b', op: '-', a: eq.L, b: eq.R }, eq.vars);
  const pb = diff ? V.positiveBound(diff, eq.vars, { low: low, label: 'positive integers' }) : null;
  check('growth', 'positiveBound on ' + name, pb ? pb.hi.join(',') : null,
        want ? want.join(',') : null);
}
check('growth', 'a non-negative domain is refused — xy = 12 puts no bound on x when y may be 0',
      (function () {
        const eq = A.parseEquation('xy = 12');
        const diff = V.polyExpand({ t: 'b', op: '-', a: eq.L, b: eq.R }, eq.vars);
        return V.positiveBound(diff, eq.vars, { low: 0, label: 'non-negative integers' });
      })(), null);

/* ============================================================
   12. THE QUANTITY ENGINE
   ------------------------------------------------------------
   Magnitude, dimension and offset, tested directly — and the
   invariant that stops the two unit tables drifting apart.
   ============================================================ */
const UNITMATH = [
  ['mass times acceleration is a force', 'F = 5 kg × 2 m/s² = 10 N', true],
  ['mass times acceleration is not an energy', 'F = 5 kg × 2 m/s² = 10 J', false],
  ['the right unit, the wrong number', 'F = 5 kg × 2 m/s² = 20 N', false],
  ['force times distance is work', 'W = 5 N × 3 m = 15 J', true],
  ['force times distance is not a force', 'W = 5 N × 3 m = 15 N', false],
  ['volts times amps is watts', 'P = 12 V × 2 A = 24 W', true],
  ['volts times amps is not joules', 'P = 12 V × 2 A = 24 J', false],
  ['km/h to m/s', '60 km/h = 16.67 m/s', true],
  ['km/h to m/s, wrong', '60 km/h = 21 m/s', false],
  ['km to m', '2.5 km = 2500 m', true],
  ['km to m, wrong', '2.5 km = 250 m', false],
  ['g to kg', '500 g = 0.5 kg', true],
  ['celsius is an offset, not a factor', '25 °C = 298 K', true],
  ['celsius treated as a factor', '25 °C = 25 K', false],
  ['a distance over a time', 'v = 120 km / 2 h = 60 km/h', true],
  ['a concentration', 'c = 0.5 mol / 2 L = 0.25 mol/L', true],
  ['a concentration divided wrongly', 'c = 0.5 mol / 2 L = 0.5 mol/L', false],
  ['a bare number is not a quantity', '2 + 3 = 5', null],
  ['algebra is not a quantity', 'x^2 - 4 = 0', null],
  ['a unit it does not know is refused', '5 furlongs = 1 km', null],
  ['only one side carries a unit', 'x = 5 m', null],
];
for (const [name, line, want] of UNITMATH) {
  const r = V.unitmath('', line);
  const got = !r.length ? null : r[0].ok;
  check('units', 'unitmath: ' + name, got, want, r.length ? r[0].text.slice(0, 110) : '(silent)');
}

/* Scientific notation is ONE number, and its × is not a multiplication:
   reading it as one turns the speed of light into 3 metres times a hundred
   million. */
const SCI = [
  ['3.0 × 10^8 m/s', 3e8],
  ['1.6 × 10^-19 C', 1.6e-19],
  ['6.02 × 10²³ mol', 6.02e23],
  ['9.8 m/s²', 9.8],
];
for (const [text, si] of SCI) {
  const q = V.qOne(text);
  check('units', 'scientific notation: ' + text, q ? Math.abs(q.si / si - 1) < 1e-9 : null, true,
        q ? 'read as ' + q.si : 'not read at all');
}

/* Significant figures — advisory, and conservative on purpose. */
const SIGFIG = [
  ['nine figures from data measured to one',
   'A car travels 12 m in 5 s. Find its speed.', 'The speed is 2.40000000 m/s', true],
  ['a sensibly rounded answer',
   'A car travels 12 m in 5 s. Find its speed.', 'The speed is 2.4 m/s', false],
  ['precise data earns a precise answer',
   'A car travels 12.0000 m in 5.0000 s.', 'The speed is 2.400000 m/s', false],
  ['a coefficient is not a measurement',
   'Solve x^2 - 5x + 6 = 0', 'x = 2.0000000000 and x = 3', false],
  ['no units, nothing to say', 'What is 22/7?', '3.142857142857', false],
];
for (const [name, q, a, want] of SIGFIG) {
  const r = V.sigfigs(q, '## ✅ Answer\n' + a);
  check('units', 'sigfigs: ' + name, r.length > 0, want, r.length ? r[0].text.slice(0, 100) : '');
  if (r.length) {
    check('units', 'sigfigs: ' + name + ' stays advisory',
          r[0].soft === true ? 'advisory' : 'NOT ADVISORY', 'advisory',
          'how the question was written must never decide the badge');
  }
}

/* Both unit checkers must be IN the pipeline, not merely present in the file.
   The verdict cases cannot prove it for sigfigs at all — it is advisory, so it
   never changes a state — and the direct assertions call the function rather
   than the report. */
{
  const r1 = V.run('Find the force.', '## ✅ Answer\nF = 5 kg × 2 m/s² = 10 N');
  check('units', 'unitmath is wired into Verify.run',
        r1.checks.some((c) => c.kind === 'unitconv') ? 'wired' : 'NOT WIRED', 'wired',
        'checks were [' + r1.checks.map((c) => c.kind).join(',') + ']');
  const r2 = V.run('A car travels 12 m in 5 s. Find its speed.',
                   '## ✅ Answer\nThe speed is 2.40000000 m/s');
  check('units', 'sigfigs is wired into Verify.run',
        r2.checks.some((c) => c.kind === 'sigfig') ? 'wired' : 'NOT WIRED', 'wired',
        'checks were [' + r2.checks.map((c) => c.kind).join(',') + ']');
}

/* THE PREFIX INVARIANT. A table of eighty units written by hand will contain a
   typo, and a wrong factor here is a wrong verdict on a student's physics.
   Every prefixed unit must agree with its base about BOTH dimension and
   factor: kJ is a thousand J and nothing else. This is what makes the table
   safe to hand-maintain. */
{
  const q = V.Q_UNITS;
  const PREFIX = { k: 1e3, M: 1e6, G: 1e9, m: 1e-3, 'µ': 1e-6, u: 1e-6, n: 1e-9, c: 1e-2, d: 1e-1 };
  /* "min" is a minute, not a milli-inch. It is the only name in the table
     where the prefix reading is a coincidence. */
  const NOT_PREFIXED = { min: 1 };
  let checkedPairs = 0;
  for (const name of Object.keys(q)) {
    if (NOT_PREFIXED[name]) continue;
    const p = name[0], base = name.slice(1);
    if (!(p in PREFIX) || !base || !q[base]) continue;
    checkedPairs++;
    check('units', name + ' has the same dimension as ' + base,
          q[name].d.join(','), q[base].d.join(','));
    const want = q[base].f * PREFIX[p];
    const got = q[name].f;
    check('units', name + ' is ' + PREFIX[p] + ' × ' + base,
          Math.abs(got / want - 1) < 1e-9, true, name + ' = ' + got + ', expected ' + want);
  }
  check('units', 'the prefix invariant actually covers the table',
        checkedPairs >= 20, true, 'checked ' + checkedPairs + ' prefixed units');
}

/* THE INVARIANT THAT KEEPS THE TWO UNIT TABLES HONEST.
   U_DIM is a frozen five-slot contract that /v1 has published for months;
   Q_UNITS is a six-slot table with factors and offsets. Two tables of the
   same facts drift, so every unit named in both must agree about its
   dimension. This is the test that makes the duplication safe. */
{
  const q = V.Q_UNITS, u = V.U_DIM;
  let compared = 0;
  for (const name of Object.keys(q)) {
    const old = u[name.toLowerCase()];
    if (!old) continue;
    /* the frozen table is [M,L,T,I,K]; the new one adds amount as a sixth */
    const padded = old.concat([0]);
    const mine = q[name].d;
    compared++;
    check('units', 'the two unit tables agree about ' + name,
          mine.join(','), padded.join(','),
          'a unit that means two things in one engine is a unit nobody can trust');
  }
  check('units', 'the tables actually overlap enough to be worth comparing',
        compared >= 15, true, 'compared ' + compared + ' units');
}

/* ============================================================
   13. A CUT-OFF ANSWER IS NOT A WRONG ANSWER
   ------------------------------------------------------------
   An answer to x² + y² + z² = xyz arrived with every solution
   correct, the Vieta descent argued properly and six
   substitutions passing — and a red "Verification failed"
   badge, because the reply had been truncated mid-formula.

   Four things were wrong and all four are pinned here: the
   badge said the mathematics failed when it had not; the
   continuation prompt let the model narrate itself into the
   answer; the two halves were spliced mid-token, which is what
   unbalanced the delimiters; and the leak detector could not
   see self-talk written as bullet points.
   ============================================================ */

/* The engine's own verdict on that answer: the mathematics is FINE and the
   only failure is that it stops early. */
{
  const q = 'Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz.';
  const cut = '## ✅ Answer\nAll solutions come from (3, 3, 3) by the jump (x,y,z) → (yz - x, y, z)$.\n\n- (3, 3, 3)\n- (6, 3, 3)\n- (15, 6, 3)\n- (39, 15, 3)\n- (87, 15, 6)\n\n## 📖 Steps\n1. The second root w = yz - x is a positive integer.\n2. It is strictly smaller, so the descent terminates at the base case.\n3. (b) $w < x ⇔ (';
  const r = V.run(q, cut);
  const kinds = r.checks.map((c) => c.kind + (c.ok ? '+' : '-'));
  check('cutoff', 'every claimed triple still substitutes',
        r.checks.filter((c) => c.kind === 'subst' && c.ok).length >= 5, true, kinds.join(','));
  check('cutoff', 'the ONLY failure is that it stops early',
        r.failed.map((c) => c.kind).join(','), 'truncated', kinds.join(','));
  /* and if the mathematics is wrong TOO, the answer really is wrong and the
     softer wording must not apply */
  const alsoWrong = cut.replace('- (6, 3, 3)', '- (6, 3, 4)');
  const r2 = V.run(q, alsoWrong);
  check('cutoff', 'a wrong AND cut-off answer still fails on the mathematics',
        r2.failed.some((c) => c.kind === 'subst'), true,
        r2.failed.map((c) => c.kind).join(','));
}

/* THE BADGE WORDING. Read out of paintVerif rather than asserted from
   memory: a student who is told their mathematics did not hold, when it did,
   learns to stop reading the badge. */
{
  const pv = html.indexOf('function paintVerif(md){');
  const body = html.slice(pv, pv + 4000);
  check('cutoff', 'paintVerif has a separate wording for a cut-off answer',
        /cutOff[\s\S]{0,200}label = '⚠ This answer is cut off'/.test(body) ? 'present' : 'MISSING',
        'present');
  check('cutoff', 'it applies only when NOTHING else failed',
        /r\.failed\.every\(function\(c\)\{ return c\.kind === 'truncated'; \}\)/.test(body)
          ? 'guarded' : 'UNGUARDED', 'guarded',
        'an answer that is both wrong and cut off must still read as wrong');
  check('cutoff', 'the cut-off badge is not green',
        /label = '⚠ This answer is cut off'; cls = 'verif unchecked'/.test(body) ? 'amber' : 'NOT AMBER',
        'amber');
}

/* NEVER RESUME MID-TOKEN. A reply cut at "x^" continued with "2 - 4(y²…"
   and glued straight on split the formula down the middle — which is what
   unbalanced the $ and got the finished answer rejected. */
const RESUME = [
  ['cut mid-formula',  'line one\n2. (b) $x < x ⇔ x^', 'trim'],
  ['cut mid-bracket',  'line one\n3. Since (y² + z²', 'trim'],
  ['cut after an operator', 'line one\n4. So x = 3 +', 'trim'],
  ['a complete last line', 'line one\n5. Therefore x = 3.', 'keep'],
  ['already at a boundary', 'line one\nline two\n', 'keep'],
  ['one line and nothing safe to trim to', 'just one incomplete $line', 'keep'],
];
for (const [name, text, want] of RESUME) {
  const got = R(text) === text ? 'keep' : 'trim';
  check('cutoff', 'resumePoint: ' + name, got, want, JSON.stringify(R(text).slice(-30)));
}

/* THE CONTINUATION PROMPT must forbid the narration that reached production:
   "Wait, the user said Continue EXACTLY from where your previous message
   stopped." — written into a student's answer. */
{
  const m = html.match(/const CONTINUE_MSG = ([\s\S]{0,700}?);\n/);
  const msg = m ? m[1] : '';
  check('cutoff', 'the continuation prompt exists', !!msg, true);
  check('cutoff', 'it forbids narrating the instruction itself',
        /never a word about this instruction/i.test(msg) ? 'forbidden' : 'NOT FORBIDDEN', 'forbidden');
  check('cutoff', 'it names the words that actually leaked',
        /No "Wait"/.test(msg) && /notes to yourself/.test(msg) ? 'named' : 'NOT NAMED', 'named');
}

/* A LIST MARKER MUST NOT HIDE SELF-TALK. This is the one that would have
   turned the whole incident into a plain presentation warning. */
const LEAKS = [
  ['a bullet-prefixed Wait', 'Some working.\n\n    *   Wait, the previous message used x^2.', true],
  ['a numbered Actually', 'Some working.\n2. Actually, let me redo that.', true],
  ['a dashed Let me re-check', 'Some working.\n- Let me recheck that.', true],
  ['a bare Wait at a line start', 'Some working.\nWait, that is wrong.', true],
  ['ordinary numbered steps', '1. Add 6 to both sides.\n2. Divide by 3.', false],
  ['the word waiting inside a sentence', 'The waiting time is 5 minutes.', false],
  ['a bulleted step that is not self-talk', '- Substitute x = 3 into the equation.', false],
];
for (const [name, md, want] of LEAKS) {
  check('cutoff', 'leaks: ' + name, V.leaks(md).length > 0, want, JSON.stringify(V.leaks(md)));
}

/* ============================================================
   14. A WITNESS REFUTES; ONLY A BOUND CAN PROVE
   ------------------------------------------------------------
   x² + y² + z² = xyz came back answered "the only positive
   integer triple is (3, 3, 3)" — a clean Vieta descent, a
   correct verification of (3,3,3), every check passing, and a
   badge reading "not checked". (3, 3, 6) gives 9 + 9 + 36 = 54
   and 3·3·6 = 54. The engine had everything it needed and said
   nothing, because `exhaust` would only speak once it could
   PROVE a bound.

   Proving a set complete needs a proved region. Refuting a
   claim of completeness needs one solution the answer left out.
   The second is the cheaper half and it was missing.
   ============================================================ */
const WITNESS = [
  ['the (3,3,3) claim', 'Find all positive integers x,y,z satisfying x^2+y^2+z^2=xyz.',
   'The only positive integer triple is (3, 3, 3).', '(3,3,6)'],
  ['a Markov list that stops early', 'Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   'The solutions are (1,1,1), (1,1,2), (1,2,5) and (1,5,13).', '(1,13,34)'],
  ['a two-variable list that stops early', 'Find all positive integers x,y with x^2+y^2+1=3xy.',
   'The solutions are (1,1), (2,5) and (5,13).', '(1,2)'],
];
for (const [name, q, ans, wantTuple] of WITNESS) {
  const out = V.exhaustion(q, '## ✅ Answer\n' + ans);
  const hit = out.find((c) => c.kind === 'exhaust' && !c.ok);
  check('witness', name + ' is refuted', !!hit, true, JSON.stringify(out.map((c) => c.text.slice(0, 60))));
  if (hit) {
    check('witness', name + ': names the solution that was left out',
          hit.text.indexOf(wantTuple) >= 0 ? 'named' : 'NOT NAMED', 'named', hit.text.slice(0, 130));
    check('witness', name + ': calls itself a counterexample, not a proof',
          /counterexample, not a search/.test(hit.text) ? 'honest' : 'OVERCLAIMS', 'honest',
          'a bounded search must never be worded as if it had proved the rest');
  }
}

/* The controls, which matter more. A witness that fires on an answer
   describing a PROCESS is answering something the answer never said. */
const NO_WITNESS = [
  ['a generative claim', 'Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   'All solutions arise from (1,1,1) by the Vieta jump.'],
  ['an explicit infinitude', 'Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   'There are infinitely many; the first are (1,1,1), (1,1,2), (1,2,5).'],
  ['an ellipsis meaning more', 'Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   '(1,1,1), (1,1,2), (1,2,5), (1,5,13), …'],
  ['a recurrence named', 'Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
   'The recurrence gives (1,1,1), (1,1,2), (1,2,5).'],
  ['a genuinely complete list', 'Find all positive integers x,y with 3x + 5y = 31.', '(7,2) and (2,5)'],
  ['a complete list on a symmetric equation', 'Find all positive integers x,y with x^2 + y^2 = 25.',
   '(3,4) and (4,3)'],
];
for (const [name, q, ans] of NO_WITNESS) {
  const out = V.exhaustion(q, '## ✅ Answer\n' + ans);
  const hit = out.find((c) => c.kind === 'exhaust' && !c.ok);
  check('witness', 'no witness against ' + name, !!hit, false, hit ? hit.text.slice(0, 120) : '');
}

/* Symmetry is a PROPERTY, tested, not a phrase read out of the prose —
   offering (1,2,1) against an answer that already listed (1,1,2) is pedantry,
   and a student shown that would be right to ignore the badge afterwards. */
const SYM = [
  ['x^2+y^2+z^2=xyz', true], ['x^2+y^2+1=3xy', true], ['x^2+y^2=25', true],
  ['3x+5y=31', false], ['x-y=3', false],
];
for (const [src, want] of SYM) {
  const eq = A.parseEquation(src);
  check('witness', 'symmetry of ' + src, V.isSymmetric(eq, eq.vars), want);
}

/* ============================================================
   15. DOUBLE ENTRY
   ------------------------------------------------------------
   Accounting was covered_not_verifiable while CA and CMA are the
   audience this product names first — its largest group of
   students got the same "unable to verify" a broken parse gets.

   Most of the subject is not checkable here. The law it rests on
   is: every entry debits exactly what it credits.
   ============================================================ */
const BOOKS = [
  ['a balanced prose entry',
   'Cash A/c                Dr.   50,000\n    To Sales A/c                  50,000', true],
  ['an entry that does not balance',
   'Cash A/c                Dr.   50,000\n    To Sales A/c                  45,000', false],
  ['a balanced compound entry',
   'Cash A/c        Dr.  30,000\nDebtors A/c     Dr.  20,000\n    To Sales A/c        50,000', true],
  ['a compound entry out by 5,000',
   'Cash A/c        Dr.  30,000\nDebtors A/c     Dr.  20,000\n    To Sales A/c        45,000', false],
  ['a balanced Debit/Credit table',
   '| Particulars | Debit (₹) | Credit (₹) |\n|---|---|---|\n| Cash A/c Dr. | 50,000 | |\n| To Sales A/c | | 50,000 |', true],
  ['a balance sheet that balances',
   'Balance Sheet as at 31 March\nTotal Assets 8,50,000\nTotal Liabilities and Capital 8,50,000', true],
  ['a balance sheet that does not',
   'Balance Sheet as at 31 March\nTotal Assets 8,50,000\nTotal Liabilities and Capital 8,00,000', false],
];
for (const [name, md, want] of BOOKS) {
  const r = V.bookkeeping('Pass the journal entry.', md);
  check('books', name, r.length ? r[0].ok : null, want, JSON.stringify(r.map((c) => c.text.slice(0, 70))));
}

/* A TOTAL is a claim, not an entry — an answer that adds its own column up
   wrongly is a different fault from one whose entries do not balance, and
   summing the total row in with the entries would hide both. */
{
  const md = '| Particulars | Debit (₹) | Credit (₹) |' + '\n' + '|---|---|---|' + '\n' +
    '| Cash A/c Dr. | 30,000 | |' + '\n' + '| Debtors A/c Dr. | 20,000 | |' + '\n' +
    '| To Sales A/c | | 50,000 |' + '\n' + '| Total | 60,000 | 50,000 |';
  const r = V.bookkeeping('Pass the journal entry.', md);
  check('books', 'the entries still balance despite the bad total',
        r[0] && r[0].ok, true, JSON.stringify(r.map((c) => c.text.slice(0, 70))));
  check('books', 'and the wrong total is reported separately',
        r.some((c) => !c.ok && /totalled as/.test(c.text)), true,
        JSON.stringify(r.map((c) => c.text.slice(0, 70))));
}

/* And the checker must be IN the pipeline. The cases above call bookkeeping()
   directly, so unwiring it from Verify.run leaves them all green — the same
   hole that hid stepChain and sigfigs until each got an assertion like this. */
{
  const r = V.run('Pass the journal entry.',
    '## ✅ Answer\nCash A/c Dr. 50,000\n    To Sales A/c 45,000');
  check('books', 'bookkeeping is wired into Verify.run',
        r.checks.some((c) => c.kind === 'books') ? 'wired' : 'NOT WIRED', 'wired',
        'checks were [' + r.checks.map((c) => c.kind).join(',') + ']');
  check('books', 'an unbalanced entry disputes the answer',
        r.state, 'disputed', 'state was ' + r.state);
}

/* The controls: a page that merely contains the word credit is not a ledger. */
const NOT_BOOKS = [
  ['a physics answer using the word credit', 'The speed is 25 m/s and the credit for that is Newton.'],
  ['accounting words with no figures', 'Debit the receiver, credit the giver.'],
  ['ordinary algebra', 'Solve x^2 - 5x + 6 = 0, giving x = 2 and x = 3.'],
];
for (const [name, md] of NOT_BOOKS) {
  check('books', 'silent on ' + name, V.bookkeeping('', md).length, 0,
        JSON.stringify(V.bookkeeping('', md).map((c) => c.text.slice(0, 60))));
}

/* ============================================================
   16. THE GAPS CLOSED WITH IT
   ============================================================ */

/* A universal claim over THREE variables used to be refused outright. */
check('counter', 'a false claim in three variables is refuted',
      V.counterexample('', 'For all x, y, z, x^2 + y^2 + z^2 > 2xyz.').length > 0, true);
check('counter', 'a true claim in three variables is left alone',
      V.counterexample('', 'For all x, y, z, x^2 + y^2 + z^2 >= 0.').length, 0);

/* A PDF is judged by SHAPE, not length: a worksheet of eight questions is
   longer than any character cap and is still a question paper. */
const DOCSHAPE = [
  ['a worksheet', '1. Solve x^2-4=0.\n2. Find the area of a circle of radius 3.\n3. Prove that n^2+n is even.', true],
  ['one question with a marks scheme', 'Q1. Solve for x. (5 marks)', true],
  ['a chapter', 'Photosynthesis is the process by which plants convert light energy into chemical energy. '.repeat(30), false],
  ['prose with no questions', 'The mitochondrion is the powerhouse of the cell. It generates ATP.', false],
  ['too long to be a paper', '1. Solve. 2. Find. '.repeat(700), false],
];
for (const [name, t, want] of DOCSHAPE) {
  check('books', 'document shape: ' + name, Q(t), want);
}

/* AND THE ESCAPING BUG THAT SHIPPED FOR ONE COMMIT. The first version of
   looksLikeQuestions was written through a template literal that ate every
   backslash, so its marks test became a character class matching almost any
   text and EVERY document went to the solver. A regex whose backslashes have
   been eaten still runs, still returns a boolean, and is wrong about
   everything — so the source itself is asserted, not just the behaviour. */
{
  const i = html.indexOf('function looksLikeQuestions(t){');
  const body = html.slice(i, html.indexOf('\n}', i));
  check('books', 'looksLikeQuestions kept its backslashes',
        /\\d\{1,2\}/.test(body) && /\\s\*/.test(body) ? 'escaped' : 'BACKSLASHES EATEN', 'escaped',
        body.slice(0, 160));
}

/* ---------- report ---------- */
if (bad.length) {
  console.log('\nADVERSARIAL FAILED — ' + bad.length + ' of ' + ran + ' attacks got through\n');
  bad.forEach((b) => console.log('  ' + b + '\n'));
  console.log('An answer that is wrong and unmarked is the worst thing this engine can produce.\n');
  process.exit(1);
}
console.log('adversarial OK — ' + ran + ' cases, every attack caught and every honest answer survived');
