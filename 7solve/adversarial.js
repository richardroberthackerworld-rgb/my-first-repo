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
  const complain = cut('var RESOLVE_GUIDANCE = {', '/* ================= Solve flow ================= */', 'resolveComplaint');
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
    ingest + '\nwindow.Ingest = Ingest;\n' + resume + '\n' + shape + '\n' + complain + '\n' +
    'this.__V = Verify; this.__A = Verify.Algebra; this.__P = MathPaste; this.__L = deLatex; this.__I = Ingest; this.__R = resumePoint; this.__Q = looksLikeQuestions; this.__C = resolveComplaint;',
    sandbox, { timeout: 15000 });
  if (!sandbox.__V || !sandbox.__P || !sandbox.__I) throw new Error('the modules did not load');
  if (typeof sandbox.__R !== 'function') throw new Error('resumePoint did not load');
  if (typeof sandbox.__Q !== 'function') throw new Error('looksLikeQuestions did not load');
  if (typeof sandbox.__C !== 'function') throw new Error('resolveComplaint did not load');
  return { V: sandbox.__V, A: sandbox.__A, P: sandbox.__P, deLatex: sandbox.__L, I: sandbox.__I,
           R: sandbox.__R, Q: sandbox.__Q, C: sandbox.__C };
}
const { V, A, P, deLatex, I, R, Q, C } = load();

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

  /* ---- 5. DESCENT: named is not proved ----
     THESE TWO CASES CHANGED VERDICT WHEN descentCheck LANDED, and the change is
     the point of it rather than a weakening.

     Both expectations were written when the only thing the engine could do with
     a descent was read the words. "By Vieta jumping all solutions follow" was
     disputed because the four obligations were unstated, and the answer that
     stated them was merely left alone — the engine had no way to tell whether
     the descent it described was the right one.

     It can now. descentCheck computes the Vieta partner, substitutes it back,
     proves the box every terminal lies in and enumerates it: for
     x²+y²+z²=3xyz the only terminal is (1,1,1), so the solution set really is
     its orbit and both answers really are correct.

     Holding them red for not spelling out a proof the engine has already done
     would be marking the write-up, not the mathematics. The prose complaint
     survives as an advisory note — see 'method' in the receipt — so a student
     is still told the three lines are missing. It just no longer decides the
     badge. The wrong version of the same answer is one case below, and it is
     still disputed. */
  ['descent', '"by Vieta jumping" is now checked instead of taken on trust',
   'Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Final Answer\nAll solutions arise from (1,1,1) by Vieta jumping.\n\n' +
   '## 📖 Step-by-Step Solution\n1. By Vieta jumping all solutions follow.', 'verified'],
  ['descent', 'and the same claim built on a NON-solution is still refused',
   'Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Final Answer\nAll solutions arise from (1,2,3) by Vieta jumping.\n\n' +
   '## 📖 Step-by-Step Solution\n1. By Vieta jumping all solutions follow.', 'disputed'],
  ['descent', 'a descent that states its obligations is accepted',
   'Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
   '## ✅ Final Answer\nAll solutions arise from (1,1,1).\n\n' +
   '## 📖 Step-by-Step Solution\n' +
   '1. Fix y and z. The equation is a quadratic in x whose roots sum to 3yz, so the second ' +
   'root 3yz - x is an integer.\n' +
   '2. If x is the largest of the three, that second root is positive and strictly smaller.\n' +
   '3. A strictly decreasing sequence of positive integers is finite, so the descent ' +
   'terminates; the base case is (1,1,1).', 'verified'],
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

/* ============================================================
   A FAMILY CAN BE RIGHT AND STILL NOT BE ALL OF THEM
   ------------------------------------------------------------
   x² + y² + z² = xyz came back answered with the family

       (3, aₙ, aₙ₊₁),  a₀ = a₁ = 3,  aₙ₊₂ = 3aₙ₊₁ − aₙ

   — every listed triple correct, the recurrence right, and a
   descent argued in fifteen steps. It is still incomplete.
   (6, 15, 87) gives 7830 = 7830 and contains no 3 at all, so it
   is in no permutation of that family. The Markov tree branches;
   the family is one branch.

   The slip is between two of its own steps: "the minimal entry
   is at least 3" becomes "set x = 3".

   A generative answer must NOT be refuted by a bigger solution —
   that may simply be its next term. It may be refuted by one
   INSIDE the range it has already reached, which is not a next
   term but a hole. That distinction is the whole rule.
   ============================================================ */
{
  const q = 'Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz.';
  const fam = '## ✅ Answer\nAll positive integer solutions are the permutations of the infinite family (3, an, an+1) where an+2 = 3an+1 - an.\nThe first few triples are (3,3,3), (3,3,6), (3,6,15), (3,15,39), (3,39,102), …';
  const out = V.exhaustion(q, fam);
  const hit = out.find((c) => c.kind === 'exhaust' && !c.ok);
  check('witness', 'an incomplete family is refuted', !!hit, true,
        JSON.stringify(out.map((c) => c.text.slice(0, 70))));
  if (hit) {
    check('witness', 'it names the branch that was missed',
          hit.text.indexOf('(6,15,87)') >= 0 ? 'named' : 'NOT NAMED', 'named', hit.text.slice(0, 150));
    check('witness', 'it says why this is not simply the next term',
          /inside the range it claims to cover/.test(hit.text) ? 'explained' : 'UNEXPLAINED',
          'explained', hit.text.slice(0, 150));
  }
  /* every triple the answer listed really is a solution — the family is not
     wrong, it is incomplete, and the receipt must not suggest otherwise */
  const r = V.run(q, fam);
  check('witness', 'the listed triples all still substitute',
        r.checks.filter((c) => c.kind === 'subst' && c.ok).length >= 5, true,
        r.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(','));
}

/* A GENERATIVE ANSWER IS NEVER REFUTED BY ITS OWN NEXT TERM. These families
   are all correct as far as they go, and every solution inside the range
   each has reached is listed — so the engine must stay silent on all of
   them. This is the control that stops the rule above from becoming a
   machine for punishing answers that stopped writing. */
const FAMILY_OK = [
  ['only the base triple listed', 'All solutions arise from (1,1,1) by the Vieta jump.'],
  ['infinitude stated outright', 'There are infinitely many; the first are (1,1,1), (1,1,2), (1,2,5).'],
  ['a trailing ellipsis', '(1,1,1), (1,1,2), (1,2,5), (1,5,13), …'],
  ['a recurrence with a correct prefix',
   'The recurrence generates (1,1,1), (1,1,2), (1,2,5), (1,5,13), (2,5,29).'],
];
for (const [name, ans] of FAMILY_OK) {
  const out = V.exhaustion('Find all positive integers a,b,c with a^2+b^2+c^2=3abc.',
                           '## ✅ Answer\n' + ans);
  check('witness', 'no witness against ' + name,
        out.some((c) => c.kind === 'exhaust' && !c.ok), false,
        JSON.stringify(out.map((c) => c.text.slice(0, 80))));
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

/* ============================================================
   17. THE PHRASING OF THE QUESTION MUST NOT DECIDE THE VERDICT
   ------------------------------------------------------------
   The same false answer — "the only positive integer triple is
   (3,3,3)", which (3,3,6) refutes — was caught or waved through
   purely on how the student happened to word the ask:

     "Find all positive integers x,y,z with x²+y²+z²=xyz"  disputed
     "Solve x²+y²+z²=xyz in positive integers"             VERIFIED
     "x²+y²+z²=xyz"                                        VERIFIED

   Two of those three put a green badge on a false answer, which
   is the worst outcome this engine has. Every completeness gate
   was reading ALL_ASKED out of the QUESTION, and the answer had
   said "the ONLY triple" in all three.

   Found by running the LIVE site against a student's report, not
   by the suite — which is why every phrasing is pinned here now.
   ============================================================ */
{
  const md = '## ✅ Final Answer\n**The only positive integer triple (x, y, z) satisfying x² + y² + z² = xyz is (3, 3, 3).**\n\n## 📖 Steps\n1. Vieta jumping descent.\n\n## 🎯 Final Result\n(x,y,z) = (3,3,3)';
  const PHRASINGS = [
    'Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz.',
    'Solve x^2 + y^2 + z^2 = xyz in positive integers.',
    'Find all x, y, z with x^2 + y^2 + z^2 = xyz.',
    'x^2 + y^2 + z^2 = xyz',
    'Solve x^2 + y^2 + z^2 = xyz',
    'Determine every positive integer triple with x^2 + y^2 + z^2 = xyz.',
  ];
  for (const q of PHRASINGS) {
    const r = V.run(q, md);
    check('phrasing', 'a false completeness claim is caught however the question is worded: ' + q.slice(0, 44),
          CANON[r.state], 'disputed', 'state=' + r.state + ' [' + r.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
  }
}

/* The detector has to be tight, because it now decides whether an answer is
   held to a completeness standard at all. A claim about a METHOD is not a
   claim about a solution set. */
const CLAIMS = [
  ['the only positive integer triple is (3,3,3)', true],
  ['(3,3,3) is the only solution', true],
  ['there is no other solution', true],
  ['these are all the solutions', true],
  ['the unique pair is (2,3)', true],
  ['the only way to solve this is by substitution', false],
  ['the only method that works here is descent', false],
  ['here are some solutions: (3,3,3) and (3,3,6)', false],
  ['a few examples are (1,1) and (2,5)', false],
  ['the only difficulty is the algebra', false],
];
for (const [t, want] of CLAIMS) {
  check('phrasing', 'claimsAll: ' + JSON.stringify(t).slice(0, 50), V.claimsAll(t), want);
}

/* THE HALF THE WITNESS ROUTE CANNOT COVER. When the claimed list happens to
   be right as far as the search reaches, no witness exists to find — and the
   completeness claim is still unproved. x² − 2y² = 1 has (3,2), (17,12),
   (99,70) and then (577,408), which is outside the 300-wide box, so the
   search comes back empty and every substitution passes.

   What stopped a green badge there was needsComplete: a claim of completeness
   means passing substitutions are evidence, not a verdict. Nothing else in the
   engine was holding that line, so it is still asserted on its own below.

   THE VERDICT ITSELF IS NOW STRONGER. pellCheck does not search a box — it
   takes the fundamental unit (3,2) from the continued fraction of √2 and
   climbs, so (577,408) is two multiplications away rather than outside a
   window. The claim is not merely unproved any more; it is refuted, with the
   solution that refutes it named. Disputed is a better answer than silence
   and this expectation was raised to it deliberately. */
{
  const r = V.run('Solve x^2 - 2y^2 = 1 in positive integers.', '## ✅ Answer\nThe only solutions are (3,2), (17,12) and (99,70).\n\n## 📖 Steps\n1. By induction, with base case (3,2), no others exist.');
  check('phrasing', 'a correct-so-far list claiming completeness is now REFUTED, not just unproved',
        CANON[r.state], 'disputed',
        'state=' + r.state + ' [' + r.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
  check('phrasing', 'and the refutation names the solution that breaks it',
        r.checks.some((c) => c.kind === 'pell' && !c.ok && /577/.test(c.text)), true,
        (r.checks.filter((c) => c.kind === 'pell')[0] || {}).text || 'no pell finding');
  check('phrasing', 'and its substitutions carry the completeness flag',
        r.checks.some((c) => c.kind === 'subst' && c.ok && c.needsComplete === true), true,
        'without the flag, three passing substitutions would certify the claim');
}

/* AND THE CONTROLS. An answer that claims nothing must not be dragged into a
   completeness standard it never invoked — offering examples is not the same
   as saying they are everything. */
const NO_CLAIM = [
  ['examples offered, nothing claimed', 'Solve x^2 + y^2 + z^2 = xyz in positive integers.',
   'Here are some solutions: (3,3,3) and (3,3,6).'],
  ['a single solution asked for', 'Find a positive integer solution of x^2+y^2+z^2=xyz.',
   '(3,3,3) works.'],
  ['"only" about the method, not the answer', 'Solve x^2 - 5x + 6 = 0',
   'The only way to solve this is by factorising. x = 2 and x = 3.'],
];
for (const [name, q, ans] of NO_CLAIM) {
  const r = V.run(q, '## ✅ Answer\n' + ans);
  check('phrasing', 'not held to completeness: ' + name,
        r.checks.some((c) => c.kind === 'exhaust' && !c.ok), false,
        'state=' + r.state + ' [' + r.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
}

/* ============================================================
   18. TELLING THE MODEL WHAT KIND OF THING IT GOT WRONG
   ------------------------------------------------------------
   The re-solve instruction was one paragraph written for one
   failure — a wrong VALUE: "substitute it back and show the
   substitution; if a value fails, do not present it."

   That is the wrong thing to say about a completeness failure.
   "The only positive integer triple satisfying x²+y²+z²=xyz is
   (3,3,3)" substitutes back perfectly — (3,3,3) IS a solution.
   Told to check its values again, the model checked them, found
   them correct, and returned the same answer. Repeatedly. The
   instruction was the reason.
   ============================================================ */
const COMPLAINTS = [
  ['a completeness failure', 'exhaust',
   'the answer presents its list as complete, but (x,y,z) = (3,3,6) also satisfies it',
   [/Your LIST is incomplete/, /Do not re-verify the solutions you already gave/,
    /AT LEAST some value/, /\(3,3,6\)/]],
  ['a domain failure', 'domain', 'n = -2 is not positive',
   [/not the DOMAIN the question set/, /The arithmetic was never the issue/]],
  ['a refuted universal', 'counter', 'n = 40 gives 1681 = 41 x 41, which is not prime',
   [/One counterexample settles it/]],
  ['a broken step', 'step', 'the derivation breaks at step 2',
   [/LINE OF THE WORKING/, /loses a solution/]],
  ['an unbalanced entry', 'books', 'debits come to 50,000 and credits to 45,000',
   [/debits exactly what it credits/]],
  ['a unit that does not follow', 'unitconv', 'the units do not follow',
   [/SI base units/, /273\.15/]],
  ['a misnamed sequence', 'sequence', 'the terms do not satisfy a\(n\) = a\(n-1\) + a\(n-2\)',
   [/check the indexing/]],
];
for (const [name, kind, text, wanted] of COMPLAINTS) {
  const msg = C({ failed: [{ kind: kind, text: text }] }, 'Q?');
  for (const re of wanted) {
    check('resolve', name + ' → complaint says ' + String(re).slice(0, 38),
          re.test(msg) ? 'said' : 'NOT SAID', 'said', msg.slice(0, 200));
  }
  check('resolve', name + ' → the failure text itself is included',
        msg.indexOf(text.replace(/\\/g, '')) >= 0 || msg.indexOf(text) >= 0, true, msg.slice(0, 160));
}

/* And the solve path must actually USE it. The cases above call
   resolveComplaint directly, so replacing the call site with a hard-coded
   string leaves them all green — the third time that hole has appeared in
   this suite, after stepChain, sigfigs and bookkeeping. Static, because the
   call sits in the solve flow behind a live model call. */
{
  const q = String.fromCharCode(39);
  const at = html.indexOf('report.state === ' + q + 'disputed' + q);
  const body = at >= 0 ? html.slice(at, at + 2500) : '';
  check('resolve', 'the re-solve calls resolveComplaint',
        /const complaint = resolveComplaint\(report, qForCheck\);/.test(body) ? 'wired' : 'NOT WIRED',
        'wired', 'the kind-aware complaint is built but never sent');
  check('resolve', 'and the complaint is what gets re-asked',
        /getAnswer\(complaint,/.test(body) ? 'sent' : 'NOT SENT', 'sent');
}

/* A WRONG VALUE still gets the original advice — that paragraph was never
   wrong, it was only ever wrong as the ONLY thing the engine could say. */
{
  const msg = C({ failed: [{ kind: 'subst', text: 'x = 5 put back into 3x - 6 = 0 gives 9 != 0' }] }, 'Solve 3x - 6 = 0');
  check('resolve', 'a wrong value still gets the substitution advice',
        /substitute it back into the original equation/.test(msg) ? 'said' : 'NOT SAID', 'said');
  check('resolve', 'and not the completeness advice',
        /Your LIST is incomplete/.test(msg) ? 'WRONG ADVICE' : 'correct', 'correct');
}

/* The most specific diagnosis leads. An answer can fail several checks at
   once, and being told to re-substitute when the real fault is an incomplete
   list is what produced the same wrong answer three times over. */
{
  const msg = C({ failed: [
    { kind: 'subst', text: 'something about a value' },
    { kind: 'exhaust', text: '(3,3,6) is missing' },
  ] }, 'Q?');
  check('resolve', 'completeness guidance outranks the generic advice',
        /Your LIST is incomplete/.test(msg) ? 'leads' : 'BURIED', 'leads', msg.slice(0, 200));
}

/* ============================================================
   19. THE FAMILY THE DESCENT NEVER REACHES
   ------------------------------------------------------------
   Three complaints, one gap. Every completeness route in the engine
   worked by finding a finite region and enumerating it, so none of them
   could touch a question whose answer is infinite — and those are the
   ones that go wrong:

     Vieta jumping        the leap inside it was never checked
     "find all"           the list was where the descent stopped
     Pell / recurrence    one branch of a tree with several

   The third is the worst, because the answer is not wrong anywhere a
   substitution can reach. x² + y² − 5xy = 25 has THREE families, rooted
   at (1,8), (3,16) and (5,25). An answer that jumps from (1,8) and
   writes out its ladder is correct in every single line and has found a
   third of the solutions.
   ============================================================ */

/* ---- the three-family equation ---- */
{
  const Q = 'Find all positive integers x,y with x^2+y^2-5xy=25.';
  const one = V.run(Q, '## ✅ Answer\nStarting from (1,8) and jumping, all solutions are (1,8), (8,39), (39,187), and so on.');
  check('family', 'one correct ladder out of three is not every solution',
        CANON[one.state], 'disputed', 'state=' + one.state);
  const f = (one.checks || []).filter((c) => c.kind === 'descent')[0];
  check('family', 'and the finding says how many families there are',
        !!f && /3 families/.test(f.text), true, f ? f.text.slice(0, 160) : 'no descent finding');
  check('family', 'and names one the answer never reaches',
        !!f && /\(3,16\)|\(5,25\)/.test(f.text), true, f ? f.text.slice(0, 220) : '');
  check('family', 'and does not accuse it of arithmetic it got right',
        !!f && !/does not satisfy/.test(f.text), true, f ? f.text.slice(0, 160) : '');

  const all = V.run(Q, '## ✅ Answer\nThere are three families, from (1,8), (3,16) and (5,25); each generates the rest by the jump.');
  check('family', 'all three families IS every solution',
        CANON[all.state], 'verified', 'state=' + all.state +
        ' [' + all.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
}

/* ---- the reported question, both ways round ---- */
{
  const Q = 'Find all positive integers x,y,z with x^2+y^2+z^2=xyz.';
  const stop = V.run(Q, '## ✅ Answer\nThe only positive integer triple is (3,3,3).');
  check('family', 'the terminal of the descent is not the solution set',
        CANON[stop.state], 'disputed', 'state=' + stop.state);
  const d = (stop.checks || []).filter((c) => c.kind === 'descent')[0];
  check('family', 'and the finding says WHICH mistake that is',
        !!d && /where the descent STOPS/.test(d.text), true, d ? d.text.slice(0, 200) : 'no descent finding');

  const orbit = V.run(Q, '## ✅ Answer\nEvery solution is obtained from (3,3,3) by the jumps; for example (3,3,6), (3,6,15), (6,15,87).');
  check('family', 'the orbit of (3,3,3) IS the solution set, and is certified',
        CANON[orbit.state], 'verified', 'state=' + orbit.state +
        ' [' + orbit.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
  const p = (orbit.checks || []).filter((c) => c.kind === 'descent' && c.ok)[0];
  check('family', 'and the proof states the bound it actually proved',
        !!p && /F\(x\) = /.test(p.text) && /x ≤ 3/.test(p.text), true, p ? p.text.slice(0, 300) : '');
  check('family', 'and says the empty strips were cleared, not skipped',
        !!p && /discriminant there is negative/.test(p.text), true, p ? p.text.slice(0, 340) : '');
}

/* A DESCENT WITH NOTHING TO LAND ON. x²+y²+z²=5xyz has no terminal at all,
   and a solution set whose every member descends to a terminal that does not
   exist is empty. That is a proof of emptiness, not a failed search. */
{
  const Q = 'Find all positive integers x,y,z with x^2+y^2+z^2=5xyz.';
  const none = V.run(Q, '## ✅ Answer\nThere are no positive integer solutions.');
  check('family', 'no terminal means no solutions, and saying so is right',
        CANON[none.state], 'verified', 'state=' + none.state);
  const bad = V.run(Q, '## ✅ Answer\nThe solutions are (1,1,1) and (1,2,3).');
  check('family', 'and inventing solutions for it is refused',
        CANON[bad.state], 'disputed', 'state=' + bad.state);
}

/* THE JUMP MAP IS AUDITED BY ITS OUTPUT. An answer that writes the wrong
   partner formula is caught because the triples it then lists are not in the
   orbit — the same error, found arithmetically instead of by reading the
   formula back out of the prose. */
{
  const r = V.run('Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
                  '## ✅ Answer\nAll solutions arise from (1,2,3) by Vieta jumping.');
  check('family', 'a family built on a triple that is not a solution',
        CANON[r.state], 'disputed', 'state=' + r.state);
}

/* ---- Pell: the ladder the fundamental unit cannot climb onto ---- */
{
  const Q = 'Find all positive integers x,y with x^2-2y^2=7.';
  const one = V.run(Q, '## ✅ Answer\nThe solutions are obtained from (3,1) by the fundamental unit: (3,1), (13,9), (75,53), and so on.');
  check('family', 'one Pell ladder out of two is not every solution',
        CANON[one.state], 'disputed', 'state=' + one.state);
  const f = (one.checks || []).filter((c) => c.kind === 'pell')[0];
  check('family', 'and it names the family that was missed',
        !!f && /\(5, 3\)/.test(f.text), true, f ? f.text.slice(0, 220) : 'no pell finding');
  check('family', 'and says why iterating one solution cannot find it',
        !!f && /climbs its own family/.test(f.text), true, f ? f.text.slice(0, 260) : '');

  const both = V.run(Q, '## ✅ Answer\nThere are two families, obtained from (3,1) and (5,3) by the fundamental unit, and so on.');
  check('family', 'both ladders IS every solution',
        CANON[both.state], 'verified', 'state=' + both.state +
        ' [' + both.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
}

/* THE FUNDAMENTAL UNIT IS COMPUTED, NOT LOOKED UP. x² − 61y² = 1 has the
   famous fundamental solution 1766319049, which is past the point where
   these engines can stay exact — so they decline rather than answer with a
   number that lost precision. Declining is a verdict this suite pins,
   because an engine that quietly rounded here would be worse than one that
   said nothing. */
{
  const r = V.run('Find all positive integers x,y with x^2-61y^2=1.',
                  '## ✅ Answer\nThe only solution is (1766319049, 226153980).');
  check('family', 'a fundamental solution past the exact range is declined',
        (r.checks || []).some((c) => c.kind === 'pell'), false,
        'state=' + r.state + ' [' + r.checks.map((c) => c.kind).join(',') + ']');
}

/* ---- what these two must REFUSE to look at ---- */
{
  /* no cross term: the partner of x is -x and there is nothing to jump */
  const pell = V.run('Find all positive integers x,y with x^2-2y^2=1.',
                     '## ✅ Answer\nAll solutions arise from (3,2) and so on.');
  check('family', 'the descent engine leaves Pell to the Pell engine',
        (pell.checks || []).some((c) => c.kind === 'descent'), false,
        '[' + pell.checks.map((c) => c.kind).join(',') + ']');
  /* D a perfect square: x^2 - 4y^2 = 9 factorises, it is not a Pell equation */
  const sq = V.run('Find all positive integers x,y with x^2-4y^2=9.',
                   '## ✅ Answer\nThe only solution is (5,2), obtained from the unit and so on.');
  check('family', 'a square D is not a Pell equation and is declined',
        (sq.checks || []).some((c) => c.kind === 'pell'), false,
        '[' + sq.checks.map((c) => c.kind).join(',') + ']');
  /* not symmetric: the ordering x1 <= ... <= xk is what makes the bound legal */
  const asym = V.run('Find all positive integers x,y with 2x^2+3y^2=5xy+1.',
                     '## ✅ Answer\nAll solutions arise from (1,1) by jumping.');
  check('family', 'an equation with no symmetry gets no terminal bound',
        (asym.checks || []).some((c) => c.kind === 'descent'), false,
        '[' + asym.checks.map((c) => c.kind).join(',') + ']');
  /* a reply cut off mid-list has not put a solution set forward at all */
  const cut = V.run('Find all positive integers x,y,z with x^2+y^2+z^2=xyz.',
                    '## ✅ Answer\nThe solutions are (3,3,3) and (3,3,6). The next one is');
  check('family', 'a truncated answer is not judged on completeness',
        (cut.checks || []).some((c) => c.kind === 'descent'), false,
        '[' + cut.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
  check('family', 'it is judged on having stopped early, which is the useful thing to say',
        (cut.checks || []).some((c) => c.kind === 'truncated' && !c.ok), true,
        '[' + cut.checks.map((c) => c.kind).join(',') + ']');
}

/* ---- THE STRIP ARGUMENT, TESTED ON THE PROOF AND NOT ON ITS SENTENCE ----
   The terminal bound F(x) < 0 only confines x where the leading coefficient of
   Q(x, ·) in y is negative. Where it is not, the strip is UNBOUNDED in y and
   the bound says nothing about it at all — for x²+y²+z²=xyz that is x = 1 and
   x = 2, and they are closed by a second argument: the discriminant of P in z
   is negative for every y, so no real z exists, let alone an integer one.

   Without that second argument the box is not proved and the certification is
   worth nothing. But removing it changes no VERDICT on any equation this suite
   otherwise covers — the enumeration finds the same terminals either way — so
   a test reading only the badge cannot see it go. That is precisely the shape
   of hole that has bitten this file three times, so the proof is checked
   directly, the way positiveBound and growthBound already are.

   x²+y²+z²+3(xy+yz+zx)=xyz is the control: its strip at x = 1 genuinely
   cannot be cleared, and an engine that pretended otherwise would be
   certifying over a region it never bounded. */
{
  const markov = {'e2,0,0':1,'e0,2,0':1,'e0,0,2':1,'e1,1,1':-1};
  const hard   = {'e2,0,0':1,'e0,2,0':1,'e0,0,2':1,
                  'e1,1,0':3,'e0,1,1':3,'e1,0,1':3,'e1,1,1':-1};
  const b = V.terminalBox(markov, 3);
  check('family', 'the terminal box for x²+y²+z²=xyz is x ≤ 3, y ≤ 3',
        b ? b.his.join(',') : 'NONE', '3,3');
  check('family', 'and it names the polynomial that proves it',
        !!b && /F\(x\) = -1x\^3\+3x\^2/.test(b.why), true, b ? b.why : '');
  check('family', 'x = 1 and x = 2 are the strips the bound does not reach',
        b ? b.open.join(',') : 'NONE', '1,2',
        'the leading coefficient in y is not negative there, so F says nothing');
  check('family', 'the strip x = 1 is proved empty, not assumed empty',
        V.stripHasNothing(markov, 3, 1), true);
  check('family', 'and so is x = 2',
        V.stripHasNothing(markov, 3, 2), true);

  const hb = V.terminalBox(hard, 3);
  check('family', 'the control equation also leaves strips open',
        !!hb && hb.open.length > 0, true, hb ? JSON.stringify(hb.open) : 'no box');
  check('family', 'but its strip at x = 1 CANNOT be cleared',
        V.stripHasNothing(hard, 3, 1), false,
        'an engine that cleared this one would be certifying over an unbounded region');
  check('family', 'so descentCheck must decline that equation outright',
        (V.run('Find all positive integers x,y,z with x^2+y^2+z^2+3*(x*y+y*z+z*x)=x*y*z.',
               '## ✅ Answer\nAll solutions arise from (1,1,1) by Vieta jumping, and so on.').checks || [])
          .some((c) => c.kind === 'descent'), false);
  check('family', 'and the clearing is wired into the checker, not merely present',
        /if\(!stripHasNothing\(P, k, box\.open\[i\]\)\) return \[\];/.test(html) ? 'wired' : 'NOT WIRED',
        'wired', 'the box would then be asserted rather than proved');
}

/* THE SOLVE PATH MUST ACTUALLY CALL THEM. Every case above goes through
   V.run, so this one is about the manifest: a checker registered but not
   wired is the hole that hid stepChain, sigfigs and bookkeeping. */
{
  check('family', 'descentCheck is wired into Verify.run',
        /checks = checks\.concat\(descentCheck\(question, text\)\);/.test(html) ? 'wired' : 'NOT WIRED', 'wired');
  check('family', 'pellCheck is wired into Verify.run',
        /checks = checks\.concat\(pellCheck\(question, text\)\);/.test(html) ? 'wired' : 'NOT WIRED', 'wired');
  check('family', 'and both may discharge the completeness flag',
        /c\.kind === 'descent' \|\| c\.kind === 'pell'/.test(html) ? 'yes' : 'NO', 'yes',
        'without this a proved classification still reads unverified');
}

/* ============================================================
   20. THE PASTE THAT ARRIVES AS A DIFFERENT QUESTION
   ------------------------------------------------------------
   MathPaste was built for one shape of this — an equation shredded into
   stacked lines by the clipboard. Three more were still getting through.

   1. SUPERSCRIPTS THAT ARE NOT DIGITS. x² and x⁴ parse. 2ⁿ⁺¹, 3ˣ⁺ʸ and 10⁻³
      never did, so the equation was dropped entirely — no integrity check, no
      substitution, no completeness, and nothing on the page saying the
      question had not been read. Fixed in deLatex rather than in the paste
      handler, because a shared link, an OCR read and the API all reach the
      tokeniser without passing the clipboard.

   2. THE CLIPBOARD BUTTON HAD ITS OWN PATH, AND IT WAS THE RAW ONE. Ctrl+V
      went through MathPaste; the button assigned the clipboard straight to
      the box. Same clipboard, two different questions depending on which the
      student used — and the button is the one on the screen, so it is the one
      a phone user reaches for.

   3. THE FLATTENING THAT CANNOT BE REPAIRED. "x2 + xy + y2 = 3x+y" has no
      structure left to recover from. Rewriting it would invent a problem the
      student never set, so it is REPORTED instead — and the report is narrow
      enough that a sequence question is never dragged into it.
   ============================================================ */

/* ---- 1. superscript letters and signs ---- */
for (const [src, want] of [
  ['2\u207f\u207a\u00b9 = 8',            '2^(n+1) = 8'],
  ['3\u02e3\u207a\u02b8 = 9',            '3^(x+y) = 9'],
  ['10\u207b\u00b3',                  '10^(-3)'],
  ['x\u00b2 + xy + y\u00b2 = 3\u02e3\u207a\u02b8', 'x\u00b2 + xy + y\u00b2 = 3^(x+y)'],
  /* digits alone already parse, so they are left exactly as pasted */
  ['x\u00b2 + y\u00b2 = 25',              'x\u00b2 + y\u00b2 = 25'],
  ['x\u2074 = 16',                    'x\u2074 = 16'],
]) {
  check('paste', 'deLatex reads ' + JSON.stringify(src),
        deLatex(src), want);
}
{
  /* the point of decoding it: the equation becomes visible to the engine */
  const e = V.findEquation(deLatex('2\u207f\u207a\u00b9 = 8'));
  check('paste', 'and the equation is then actually found',
        e && e.eq ? e.eq.vars.join(',') : 'NOT PARSED', 'n');
  const before = V.findEquation('2\u207f\u207a\u00b9 = 8');
  check('paste', 'where the raw superscript form finds nothing at all',
        before && before.eq ? 'parsed' : 'nothing', 'nothing',
        'this is what the decoding is for');
  /* the reported question, end to end */
  const rep = V.findEquation(deLatex('x\u00b2 + xy + y\u00b2 = 3\u02e3\u207a\u02b8'));
  check('paste', 'the reported question survives the clipboard',
        rep && rep.eq ? rep.eq.vars.join(',') : 'NOT PARSED', 'x,y');
}

/* ---- 2. MathPaste applies the same decoding on every route in ---- */
for (const [name, src, want] of [
  ['a plain paste',   '2\u207f\u207a\u00b9 = 8',        '2^(n+1) = 8'],
  ['a stacked paste', 'x\n2\n+xy+y\n2\n=3\nx+y\n.', 'x^(2)+xy+y^(2)=3^(x+y).'],
]) {
  const r = P.read(src, '');
  check('paste', name + ' comes out readable', r.text, want);
  check('paste', name + ' is announced', r.changed, true,
        'a repair the student cannot see is the same failure as the shredding');
}
{
  const r = P.read('x\u00b2 + y\u00b2 = 25', '');
  check('paste', 'a paste needing nothing is not announced', r.changed, false,
        'a notice on every paste teaches students to ignore the notice');
}

/* ---- 3. the flattening it can only report ---- */
for (const [src, want] of [
  ['x2 + xy + y2 = 3x+y',  'x2 and y2'],
  ['p2 + q2 = pq + 1',     'p2 and q2'],
  /* a sequence question must NEVER be dragged into this: `a` never appears
     on its own, so a1 a2 a3 are subscripts and the answer is silence */
  ['a1 + a2 + a3 = 6',     null],
  ['x2 + y2 = 25',         null],
  ['n2 = 2n',              null],
  /* an exponent survived, so nothing was lost */
  ['x\u00b2 + xy + y\u00b2 = 3x+y', null],
  ['x^2 + xy + y2 = 3x+y', null],
  /* no equation at all */
  ['see figure 2 and figure 3', null],
]) {
  check('paste', 'flattened ' + JSON.stringify(src),
        P.flattened(src), want);
}

/* ---- the wiring, because both paste routes are behind a DOM event ---- */
{
  check('paste', 'the clipboard button reads through MathPaste',
        /got = MathPaste\.read\(txt, ''\);/.test(html) ? 'wired' : 'NOT WIRED', 'wired',
        'it used to assign the clipboard straight to the box');
  check('paste', 'and Ctrl+V reports a flattening it cannot repair',
        /MathPaste\.flattened\(plain\)/.test(html) ? 'wired' : 'NOT WIRED', 'wired');
  check('paste', 'the decoder is INSIDE deLatex, where the harness can see it',
        /function deLatex\(md\)\{[\s\S]{0,4000}?UNI_SUPER/.test(html) ? 'nested' : 'OUTSIDE', 'nested',
        'a sibling helper is cut away by the sandbox and the tests would pass against nothing');
}

/* ============================================================
   21. THE CONCLUSION THE ENGINE WAS NOT READING
   ------------------------------------------------------------
   Reported from the live site. The answer is the same false one as ever —
   "the only positive integer triple is (3,3,3)", refuted by (3,3,6) giving
   54 = 54 — but it reached GREEN through a door none of the earlier fixes
   had closed.

   Its ✅ Final Answer section is just:  (x, y, z) = (3, 3, 3)

   That names a triple and claims nothing. The claim is in step 12 of the
   working, under 📖 — and claimZone is the ✅ and 🎯 sections only, so
   CLAIMS_ALL never saw it. With a question that did not say "find all"
   either, no completeness gate engaged at all, and three passing
   substitutions certified the answer outright.

   This is the phrasing bug one door along: first it was decided by how the
   QUESTION was worded, then by which SECTION of the answer the model happened
   to put its conclusion in. The claim is now read from the conclusion
   wherever it sits.

   THE MATHEMATICS, for the record, breaks at step 4. z ≤ xy ≤ 3z does NOT
   make xy an integer multiple of z — xy/z is a rational in [1,3]. For
   (3,3,6) it is 9/6 = 3/2, which is in none of the three cases the answer
   then works through, so the whole case split misses it.
   ============================================================ */
{
  const REPORTED =
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
  ;
  for (const q of [
    'Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz',
    'Solve x^2+y^2+z^2=xyz in positive integers',
    'x^2+y^2+z^2=xyz',
    'Find all x, y, z with x^2+y^2+z^2=xyz',
  ]) {
    const r = V.run(q, REPORTED);
    check('conclusion', 'a claim in the working still counts: ' + JSON.stringify(q.slice(0, 40)),
          CANON[r.state], 'disputed',
          'state=' + r.state + ' [' + r.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
  }
  const r = V.run('x^2+y^2+z^2=xyz', REPORTED);
  check('conclusion', 'and the refutation names the triple it left out',
        (r.checks || []).some((c) => !c.ok && /\(3,3,6\)/.test(c.text)), true,
        (r.checks || []).filter((c) => !c.ok).map((c) => c.text.slice(0, 90)).join(' | '));
  check('conclusion', 'the domain comes from the conclusion too, since nothing else states it',
        /positive integers/.test(String(V.domainOf(V.answerClaimZone(REPORTED)) &&
                                        V.domainOf(V.answerClaimZone(REPORTED)).label)), true,
        'a completeness gate with no domain has nothing to enumerate over');
}

/* A CLAIM ABOUT A SUB-CASE IS NOT A CLAIM ABOUT THE PROBLEM. This is the
   control, and it matters more than the case above: an answer that shows its
   working case by case must not be dragged into a completeness standard by a
   sentence that was only ever about one branch. Disputing correct work for
   the crime of being thorough would be a worse bug than the one being fixed. */
for (const [name, line, counts] of [
  ['a bare conclusion',        '12. Conclusion – The only solutions are x = 1 and x = 2.', true],
  ['scoped by a case',         'Case k=1: the only solution is x = 1.',                    false],
  ['scoped by an if',          'If k = 1 then the only solution is x = 1.',                false],
  ['scoped by a supposition',  'Suppose x > y. Then the only solution is x = 1.',          false],
  ['scoped by a range',        'For x ≥ 4 the only solutions are x = 1 and x = 2.',        false],
  ['scoped by an assumption',  'Assume z is even; the only pairs are (1,2) and (3,4).',    false],
]) {
  const md = '## ✅ Final Answer\nx = 1\n\n## 📖 Steps\n' + line;
  check('conclusion', name + ' → read as a claim about the whole problem',
        V.claimsAll(V.answerClaimZone(md)), counts, JSON.stringify(line));
}
{
  /* and the widening must not disturb an answer that made no such claim */
  const plain = '## ✅ Final Answer\nx = 2\n\n## 📖 Steps\n1. Divide by 3.\n2. So x = 2.';
  check('conclusion', 'an answer claiming nothing is left claiming nothing',
        V.claimsAll(V.answerClaimZone(plain)), false);
  check('conclusion', 'and the widened zone is wired into the completeness gate',
        /var dom = domainOf\(question\) \|\| domainOf\(answerClaimZone\(md\)\);/.test(html) ? 'wired' : 'NOT WIRED',
        'wired');
}

/* ============================================================
   22. TELLING THE SOLVER THE ANSWER INSTEAD OF TELLING IT TO TRY AGAIN
   ------------------------------------------------------------
   The badge was right and the same false answer still came back, four times.
   That is not a verification failure — it is what happens when the only thing
   the engine says to a wrong answer is that it is wrong.

       "Your LIST is incomplete: find the ones you left out."

   is a request to re-derive a classification the model has already failed at,
   using the tools that failed. It re-ran the same case split and reached the
   same conclusion, as it would every time.

   By the time descentCheck refutes, it has PROVED the classification: the
   terminals, the jump, the orbit. Handing that over turns the re-solve from
   another attempt at a hard problem into writing up a result — the verifier
   supplying ground truth to the solver, which is the direction this engine is
   built to run in.

   None of the cases above would notice if the handover disappeared: they read
   the badge, and the badge is already right. It is checked here directly. */
{
  const q = 'Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz';
  const r = V.run(q, '## ✅ Final Answer\n(x, y, z) = (3, 3, 3)\n\n' +
                     '## 📖 Steps\n4. Hence z ≤ xy ≤ 3z. Write xy = kz with integer k in 1,2,3.\n' +
                     '12. Conclusion – The only positive integer triple is (3,3,3).');
  check('handover', 'the reported answer is still refused', CANON[r.state], 'disputed');

  const d = (r.checks || []).filter((c) => c.kind === 'descent')[0];
  check('handover', 'the descent finding carries the answer it proved',
        !!d && typeof d.fix === 'string' && d.fix.length > 80, true,
        'without fix the complaint can only say "try again"');

  const msg = C(r, q);
  for (const [what, re] of [
    ['it says the engine already has the answer', /HAS ALREADY COMPUTED THE ANSWER/],
    ['it names the orbit and its root',           /orbit of \(x,y,z\) = \(3,3,3\)/],
    ['it lists real members of that orbit',       /\(3, 3, 6\)[\s\S]*\(3, 6, 15\)/],
    ['it says the set does not terminate',        /continues forever/],
    ['it asks for a write-up, not a re-derivation', /Write THAT up[\s\S]*not re-derive it/],
    ['it says not to re-check what was right',    /do not re-check the solutions you already had right/],
  ]) {
    check('handover', what, re.test(msg) ? 'said' : 'NOT SAID', 'said', msg.slice(0, 300));
  }

  /* the specific fallacy this answer keeps making, named */
  check('handover', 'and the ratio fallacy in its step 4 is named',
        /does NOT make xy\/z an integer/.test(msg) ? 'named' : 'NOT NAMED', 'named',
        'z ≤ xy ≤ 3z bounds a RATIO; 9/6 = 3/2 is in range and in none of its three cases');
}

/* PELL HANDS OVER TOO, and its answer is a recurrence rather than an orbit. */
{
  const q = 'Find all positive integers x, y with x^2 - 2y^2 = 7';
  const r = V.run(q, '## ✅ Answer\nThe solutions are (3,1), (13,9) and (75,53).');
  const p = (r.checks || []).filter((c) => c.kind === 'pell')[0];
  check('handover', 'the pell finding carries its classification',
        !!p && typeof p.fix === 'string' && p.fix.length > 80, true);
  const msg = C(r, q);
  check('handover', 'and the complaint gives both families',
        /\(3, 1\)/.test(msg) && /\(5, 3\)/.test(msg), true, msg.slice(0, 300));
  check('handover', 'and the rule for climbing them',
        /fundamental unit \(3, 2\)/.test(msg) ? 'given' : 'NOT GIVEN', 'given');
}

/* descent and pell must LEAD the guidance. They are the only two that arrive
   with the answer attached, and the default paragraph — "substitute your values
   back into the original equation" — is exactly the wrong thing to say to an
   answer whose values were right all along. That was the bug for exhaust and it
   would have been the bug again here. */
{
  const msg = C({ failed: [
    { kind: 'subst',   text: 'something about a value' },
    { kind: 'descent', text: 'the classification is wrong', fix: 'THE PROVED ANSWER' },
  ] }, 'Q?');
  check('handover', 'descent guidance outranks the substitution advice',
        /Your VALUES are right and your CLASSIFICATION is wrong/.test(msg) ? 'leads' : 'BURIED',
        'leads', msg.slice(0, 240));
  check('handover', 'and the handover is carried through verbatim',
        msg.indexOf('THE PROVED ANSWER') >= 0, true);
  const bare = C({ failed: [{ kind: 'subst', text: 'x = 5 put back gives 9 != 0' }] }, 'Q?');
  check('handover', 'a wrong VALUE still gets the substitution advice',
        /substitute it back into the original equation/.test(bare) ? 'said' : 'NOT SAID', 'said');
  check('handover', 'and no handover is invented when nothing proved one',
        /HAS ALREADY COMPUTED THE ANSWER/.test(bare) ? 'INVENTED' : 'silent', 'silent');
}

/* ============================================================
   23. A TYPO IS NOT A BROKEN METHOD
   ------------------------------------------------------------
   Reported from the live site, and the badge was right. The answer classified
   x² + y² − 5xy = 25 completely and correctly: all three families, the jump
   map x' = 5y − x exactly right, the descent argued properly, and eight of its
   nine listed pairs genuine. Then it wrote (77,368) where the jump gives
   (77,369). One digit. 5929 + 135424 − 141680 = −327.

   Red is the right badge — a wrong pair in a list of solutions is something a
   student copies down. What was wrong was the REASON:

       "...which usually means the jump map itself is wrong, not the
        arithmetic that followed it"

   That is the diagnosis for an answer whose whole construction is broken, and
   this construction was perfect. Telling a student their correct method is
   suspect because of a typo sends them back to rebuild something that was
   already right.

   The two are told apart by what the rest of the answer did, and the engine
   has the orbit — so it can name the value that was meant instead of only the
   one that is wrong.
   ============================================================ */
{
  const q = 'Find all positive integers x, y with x^2 + y^2 - 5xy = 25';
  const r = V.run(q,
    '## ✅ Final Answer\n' +
    'All positive integer solutions of x^2 + y^2 - 5xy = 25 are obtained by repeatedly applying ' +
    'the Vieta-jump to the three minimal solutions (1,8), (3,16), (5,25).\n' +
    'The first few are (1,8), (3,16), (5,25), (8,39), (16,77), (25,120), (39,187), (77,368), (120,575), and so on.\n' +
    '\n## 📖 Steps\n1. As a quadratic in x: x^2 - 5yx + (y^2 - 25) = 0, so the other root is 5y - x.\n' +
    '2. Jumping the larger coordinate strictly decreases it, so the descent terminates.\n' +
    '3. The minimal pairs are (1,8), (3,16), (5,25), and every solution descends to one of them.'
  );
  check('slip', 'a wrong pair in the list is still refused', CANON[r.state], 'disputed');
  const d = (r.checks || []).filter((c) => c.kind === 'descent')[0];
  check('slip', 'and it is called a slip, not a broken construction',
        !!d && /slip in one number, not a fault in the construction/.test(d.text), true,
        d ? d.text.slice(0, 200) : 'no descent finding');
  check('slip', 'and the method is explicitly cleared',
        !!d && /the method is sound/.test(d.text), true, d ? d.text.slice(0, 200) : '');
  check('slip', 'and the jump map is NOT blamed',
        !!d && /jump map/.test(d.text) ? 'BLAMED' : 'not blamed', 'not blamed',
        d ? d.text.slice(0, 200) : '');
  check('slip', 'and the value that was meant is named',
        !!d && /\(77,369\)/.test(d.text), true, d ? d.text.slice(0, 240) : '');
  const msg = C(r, q);
  check('slip', 'the re-solve asks for one number to change and nothing else',
        /should be \(x,y\) = \(77,369\)[\s\S]*change nothing else/.test(msg), true, msg.slice(0, 300));
  check('slip', 'and tells it not to rebuild the families',
        /Do not re-derive the families/.test(msg), true);
}

/* THE CONTROL, and it is the whole reason the two are separated. An answer
   whose construction really IS broken must still get the harsher diagnosis —
   otherwise this softening would excuse exactly the failures the descent engine
   was built to catch. Here the family is built on a triple that is not a
   solution at all, so nothing else in the answer stands to clear the method. */
{
  const r = V.run('Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
                  '## ✅ Answer\nAll solutions arise from (1,2,3) by Vieta jumping.');
  const d = (r.checks || []).filter((c) => c.kind === 'descent')[0];
  check('slip', 'a family built on a non-solution is still a broken construction',
        !!d && /which usually means the jump map/.test(d.text), true,
        d ? d.text.slice(0, 200) : 'no descent finding');
  check('slip', 'and it is NOT excused as a slip',
        !!d && /slip in one number/.test(d.text) ? 'EXCUSED' : 'not excused', 'not excused');
}

/* ============================================================
   24. THE ONE TIER BETWEEN VERIFIED AND FAILED
   ------------------------------------------------------------
   A correct method with a mistyped value wore the same red badge as an answer
   that is wrong from its first line, and the same words: "7Solve checked this
   answer and it did not hold." It did hold. One number was typed wrong.

   The tier is PRESENTATION. state stays disputed, the receipt is unchanged,
   /v1 returns what it always returned, and no verification rule moved. What
   moved is which of three things the badge says.

   Everything below is about what it REFUSES to soften, because a tier that
   let a wrong answer look nearly right would be worse than the red badge it
   replaces.
   ============================================================ */
const SLIP_Q = 'Find all positive integers x, y with x^2 + y^2 - 5xy = 25';
const SLIP_A =
  '## ✅ Final Answer\n' +
  'All positive integer solutions of x^2 + y^2 - 5xy = 25 are obtained by repeatedly applying ' +
  'the Vieta-jump to the three minimal solutions (1,8), (3,16), (5,25).\n' +
  'The first few are (1,8), (3,16), (5,25), (8,39), (16,77), (25,120), (39,187), (77,368), (120,575), and so on.\n' +
  '\n## 📖 Steps\n1. As a quadratic in x: x^2 - 5yx + (y^2 - 25) = 0, so the other root is 5y - x.\n' +
  '2. The minimal pairs are (1,8), (3,16), (5,25).';

/* ---- the four verdicts the tier has to keep apart ---- */
{
  /* 1. a genuine slip → YELLOW */
  const slip = V.run(SLIP_Q, SLIP_A);
  check('tier', 'a genuine slip keeps the disputed VERDICT', slip.state, 'disputed',
        'the tier is presentation; the answer still must not be copied as written');
  check('tier', 'and is marked as a correction', !!slip.correction, true);
  check('tier', 'naming the value that slipped',
        slip.correction ? slip.correction.slipOf : 'NONE', '(x,y) = (77,368)');

  /* 2. a genuinely broken method → RED, never yellow */
  const broken = V.run('Find all positive integers x,y,z with x^2+y^2+z^2=3xyz.',
                       '## ✅ Answer\nAll solutions arise from (1,2,3) by Vieta jumping.');
  check('tier', 'a broken construction stays disputed', broken.state, 'disputed');
  check('tier', 'and is NEVER softened to a correction', broken.correction, null,
        'this is the failure the descent engine exists to catch');

  /* 3. a fully correct answer → GREEN, and the tier does not touch it */
  const good = V.run('Find all positive integers x, y, z with x^2 + y^2 + z^2 = xyz',
                     '## ✅ Answer\nEvery solution is obtained from (3,3,3) by the jumps; ' +
                     'for example (3,3,6), (3,6,15), (6,15,87). The family continues forever.');
  check('tier', 'a correct classification is still verified', good.state, 'checked');
  check('tier', 'and carries no correction', good.correction, null,
        'nothing needs fixing, so nothing may be offered as needing fixing');

  /* 4. a false completeness claim → RED */
  const wrong = V.run('x^2+y^2+z^2=xyz',
                      '## ✅ Final Answer\n(x, y, z) = (3, 3, 3)\n\n## 📖 Steps\n' +
                      '12. Conclusion – The only positive integer triple satisfying the original equation is (3,3,3).');
  check('tier', 'a false claim of completeness stays disputed', wrong.state, 'disputed');
  check('tier', 'and is NEVER softened to a correction', wrong.correction, null);
}

/* WHAT THE TIER REFUSES, WHICH IS THE WHOLE DESIGN.
   correctionOnly needs a descent finding that already carried the slip
   diagnosis — which itself needs a sound construction, most of the answer
   inside the proved orbit, and a near member to correct TO — AND every other
   failing check must be the substitution of that same value. One unrelated
   failure of any kind and the badge is red again. These drive that guard
   directly, because a tier that leaked would be worse than the red badge it
   replaces. */
{
  const C_ = (report) => report.correction;

  /* a second, unrelated wrong value alongside the slip */
  const two = V.run(SLIP_Q, SLIP_A.replace('(120,575), and so on', '(120,575), (7,7), and so on'));
  check('tier', 'a SECOND wrong value is not a correction', C_(two), null,
        'state=' + two.state + ' [' + two.checks.filter((c) => !c.ok).map((c) => c.kind).join(',') + ']');

  /* an unrelated failing check of another kind, on an otherwise slipping answer */
  const hand = { state: 'disputed', checks: [
    { kind: 'descent', ok: false, slipOf: '(x,y) = (77,368)', text: 'slip in one number' },
    { kind: 'subst',   ok: false, text: '(x,y) = (77,368) in ... gives -327 ≠ 25' },
  ] };
  check('tier', 'the shape the tier is built for is recognised',
        !!V.correctionOnly(hand.checks), true);
  for (const extra of [
    { kind: 'units',     ok: false, text: 'the answer is in newtons' },
    { kind: 'integrity', ok: false, text: 'the working restates the question wrongly' },
    { kind: 'arith',     ok: false, text: '2 + 2 = 5' },
    { kind: 'subst',     ok: false, text: '(x,y) = (8,39) in ... gives 0 ≠ 25' },
    { kind: 'roots',     ok: false, text: 'a root is missing' },
  ]) {
    check('tier', 'a failing ' + extra.kind + ' alongside the slip forces red',
          V.correctionOnly(hand.checks.concat([extra])), null, JSON.stringify(extra.text));
  }
  /* an ADVISORY failure must not force red — it never decides a verdict anywhere else */
  check('tier', 'a soft advisory note alongside the slip is tolerated',
        !!V.correctionOnly(hand.checks.concat([{ kind: 'method', ok: false, soft: true, text: 'note' }])),
        true, 'advisory notes are context, not verdicts');
  /* a descent failure WITHOUT the slip marker is a broken method, not a slip */
  check('tier', 'a descent failure with no slipOf is not a correction',
        V.correctionOnly([{ kind: 'descent', ok: false, text: 'the jump map is wrong' }]), null);
}

/* THE BADGE ITSELF. paintVerif is DOM code and cannot run in this sandbox, so
   the branch is pinned against the source — the same way the solve-path wiring
   is, and for the same reason: an engine that computes the tier and a badge
   that never reads it would pass every case above. */
{
  const pv = html.indexOf('function paintVerif(md){');
  const body = pv >= 0 ? html.slice(pv, pv + 12000) : '';
  check('tier', 'the badge reads the tier the engine computed',
        /var corrected = r\.correction \|\| null;/.test(body) ? 'wired' : 'NOT WIRED', 'wired');
  check('tier', 'and renders its own class, not the red one',
        /label = '⚠ Verified with one correction'; cls = 'verif corrected';/.test(body) ? 'yes' : 'NO', 'yes');
  check('tier', 'and says the method is sound',
        /Your method is sound\./.test(body) ? 'yes' : 'NO', 'yes');
  check('tier', 'and names both the wrong value and the right one',
        /corrected\.slipOf \+ ' should be '/.test(body) ? 'yes' : 'NO', 'yes');
  check('tier', 'the corrected class exists in the stylesheet',
        /\.verif\.corrected\{/.test(html) ? 'yes' : 'NO', 'yes');
  check('tier', 'and it is NOT the green class',
        /\.verif\.corrected\{[^}]*background:var\(--ok-tint\)/.test(html) ? 'GREEN' : 'not green', 'not green',
        'only a checked answer may look verified');
  check('tier', 'the tier never reaches a non-disputed state',
        /if\(state === 'disputed'\) correction = correctionOnly\(checks\);/.test(html) ? 'guarded' : 'UNGUARDED',
        'guarded', 'a green or unchecked answer must never acquire a correction');
}

/* ============================================================
   25. THE WORKING IS NOT A LIST OF CLAIMS
   ------------------------------------------------------------
   Every number pair in brackets was read as a solution the answer was putting
   forward. A reported answer solved x²+y²−5xy=25 the standard way — treat it
   as a quadratic in x, require the discriminant 21y²+100 to be a square, solve
   the Pell equation k²−21y²=100 — and wrote

       (k₀,y₀) = (11,1)     the base of that Pell equation
       (55,12)              the fundamental unit of u²−21v²=1

   Both were harvested as claimed (x,y) solutions and both were disputed:
   11²+1²−5·11·1 is 67, not 25. Neither was ever offered as a solution. They
   are the working, and auxiliary variables are how half of number theory is
   written — so this fired on CORRECT answers, which is the worst kind of false
   positive this engine has.

   Two rules, and the second carries it. A tuple is not a claim when it is
   LABELLED with variables that are not the question's, or when it SOLVES an
   equation the answer itself states over different variables. The second needs
   no vocabulary and survives rephrasing.

   AND A COINCIDENCE MUST NOT COST A CLAIM, which is where the first attempt
   broke: (25,5) solves the question AND the Pell equation, so skipping every
   tuple that satisfied the machinery threw away a real solution and with it a
   whole family. A pair that answers the question is a claim whatever else it
   satisfies.
   ============================================================ */
{
  const eq = V.findEquation('x^2 + y^2 - 5xy = 25').eq;
  const T = (md) => V.claimedTuples(md, 2, ['x', 'y'], eq).map((t) => t.join(','));
  for (const [name, md, want] of [
    ['a labelled auxiliary pair',   '(k0,y0)=(11,1)',                                 []],
    ['the same pair in prose',      'k^2-21y^2=100 ... Starting from (11,1) again',   []],
    ['a fundamental unit',          'u^2-21v^2=1 has fundamental unit (55,12) which', []],
    ['a labelled CLAIM',            '(x,y) = (1,8)',                                  ['1,8']],
    ['an unlabelled claim',         'the solutions are (1,8) and (3,16)',             ['1,8', '3,16']],
    ['a claim beside the machinery','k^2-21y^2=100 and the solutions are (1,8)',      ['1,8']],
    ['a wrong value stays a claim', 'k^2-21y^2=100 gives (121,25)',                   ['121,25']],
    /* the coincidence: (25,5) solves BOTH the question and k²−21y²=100 */
    ['a solution that also solves the machinery',
                                    'k^2-21y^2=100 and the solutions include (25,5)', ['25,5']],
  ]) {
    check('working', name, T(md).join(' | '), want.join(' | '), JSON.stringify(md));
  }
}

/* END TO END: the reported answer. The auxiliary pairs must vanish and every
   genuine solution must survive — including (25,5), which is the one the first
   attempt at this lost. */
{
  const Q = 'Find all positive integers x, y with x^2 + y^2 - 5xy = 25';
  const A_ =
      '## ✅ Final Answer\n' +
      'All positive integer solutions of x^2+y^2-5xy=25 are generated by the Vieta jump from the ' +
      'three minimal solutions. The first few are (1,8), (3,16), (5,25), (8,39), (16,77), (25,120).\n' +
      '\n## 📖 Steps\n' +
      '1. As a quadratic in x: x^2-5yx+(y^2-25)=0, so the discriminant is 21y^2+100.\n' +
      '2. Require it to be a square: k^2-21y^2=100. Trying y=1 gives (k0,y0)=(11,1).\n' +
      '3. The equation u^2-21v^2=1 has fundamental unit (55,12), since 3025-3024=1.\n' +
      '4. Starting from (11,1) and iterating by the unit generates the rest.'
  ;
  const r = V.run(Q, A_);
  const disputed = (r.checks || []).filter((c) => !c.ok && c.kind === 'subst')
                                   .map((c) => String(c.text).slice(0, 24));
  check('working', 'no auxiliary pair is disputed as a solution', disputed.join(' | '), '',
        'the working is not a list of claims');
  check('working', 'and the answer is accepted', CANON[r.state], 'verified',
        'state=' + r.state + ' [' + r.checks.map((c) => c.kind + (c.ok ? '+' : '-')).join(',') + ']');
}

/* THE GUARD THIS MUST NOT BREAK. A wrong value in the answer is still a wrong
   value — the rule withdraws a dispute only when the answer supplied the
   equation that explains the pair. */
{
  const Q = 'Find all positive integers x, y with x^2 + y^2 - 5xy = 25';
  const bad = V.run(Q,
    '## ✅ Answer\nBy the Pell equation k^2-21y^2=100 with (k0,y0)=(11,1), the solutions are ' +
    '(1,8), (3,16), (5,25) and (121,25).');
  check('working', 'a genuinely wrong pair is still disputed',
        (bad.checks || []).some((c) => !c.ok && /\(121,25\)/.test(c.text)), true,
        'state=' + bad.state);
  check('working', 'and the auxiliary base beside it is not',
        (bad.checks || []).some((c) => !c.ok && /\(11,1\)/.test(c.text)), false);
}

/* ---------- report ---------- */
if (bad.length) {
  console.log('\nADVERSARIAL FAILED — ' + bad.length + ' of ' + ran + ' attacks got through\n');
  bad.forEach((b) => console.log('  ' + b + '\n'));
  console.log('An answer that is wrong and unmarked is the worst thing this engine can produce.\n');
  process.exit(1);
}
console.log('adversarial OK — ' + ran + ' cases, every attack caught and every honest answer survived');
