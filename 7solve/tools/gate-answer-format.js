#!/usr/bin/env node
/* ============================================================
   7Solve — ANSWER FORMAT CONTRACT
   ------------------------------------------------------------
   There is a contract between the system prompt and the
   verification engine, and until now nothing enforced it.

   buildSystemPrompt() tells the model to reply in sections
   headed "## ✅", "## 📖", "## 🎯". Every checker then finds the
   answer by looking for exactly those markers: claimZone() reads
   withHead(md,'✅') and withHead(md,'🎯'), the state machine
   decides `hasSteps` from "## 📖" or "## 📝", and claimedRootsOf
   strips the ** emphasis the prompt asks for.

   Change one emoji in the prompt and NOTHING FAILS. Every suite
   in this repo supplies its own answer text, so they all stay
   green while live answers quietly stop matching and every
   student sees "Unable to verify" on work that is perfectly
   correct. The engine would be fine; the pipe between the model
   and the engine would be cut.

   That gap was found by trying to run the real solve flow on
   production and being stopped by the sign-in gate — the one
   link no test in this repo has ever exercised, because every
   test starts after the model has already replied.

   This closes the half that needs no credentials: it reads the
   FORMAT OUT OF THE PROMPT, builds an answer in exactly that
   shape, and demands the engine verify it. If the prompt drifts,
   the synthesised answer drifts with it and the verdict falls
   over — loudly, at build time.

       node tools/gate-answer-format.js

   Exit 0 = an answer written the way the prompt demands is one
            the engine can actually read.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

/* ---- 1. what does the prompt promise? ---------------------------- */
const pStart = html.indexOf('function buildSystemPrompt');
if (pStart < 0) { console.error('\n  buildSystemPrompt not found in index.html\n'); process.exit(1); }
let depth = 0, i = html.indexOf('{', pStart), p = i;
for (; p < html.length; p++) {
  if (html[p] === '{') depth++;
  else if (html[p] === '}') { depth--; if (!depth) break; }
}
const prompt = html.slice(pStart, p + 1);

/* the section headings the prompt instructs, in the order it lists them */
const promised = [...prompt.matchAll(/"##\s*([^\s"<]+)\s*<([^>]+)>"/g)]
  .map((m) => ({ marker: m[1], name: m[2] }));

/* ---- 2. what does the ENGINE actually look for? ------------------ */
const needed = [
  { marker: '✅', why: "claimZone() and section(md,'✅') — where every checker looks for the answer" },
  { marker: '🎯', why: 'claimZone() folds the restated result in, so a value stated only there is still read' },
  { marker: '📖', why: "the state machine's hasSteps test, which separates `worked` from `plain`" },
];
const fails = [];
for (const n of needed) {
  if (!promised.some((s) => s.marker === n.marker)) {
    fails.push('the prompt no longer instructs "## ' + n.marker + '" — ' + n.why);
  }
}

/* the emphasis contract: the prompt asks for ** and the readers strip it */
if (!/\*\*/.test(prompt)) {
  fails.push('the prompt no longer asks for ** emphasis, which claimedRootsOf and identityCheck strip');
}

/* ---- 3. THE EXECUTABLE HALF ---------------------------------------
   Build an answer in exactly the shape the prompt demands — using the
   markers read out of the prompt itself, not ones typed here — and put
   it through the shipping engine. */
function loadEngine() {
  const dS = html.indexOf('var Deriv = (function(){'), dE = html.indexOf('\nwindow.Deriv = Deriv;', dS);
  const dlS = html.indexOf('function deLatex(md){'), dlE = html.indexOf('\nwindow.deLatex7 = deLatex;', dlS);
  const vS = html.indexOf('var Verify = (function(){'), vE = html.indexOf('\n})();', vS);
  const sb = { window: {}, console: { log() {} }, $: () => null, state: {}, Math, parseFloat,
               parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON };
  vm.createContext(sb);
  vm.runInContext(html.slice(dS, dE) + '\nwindow.Deriv=Deriv;\n' + html.slice(dlS, dlE) +
    '\nwindow.deLatex7=deLatex;\n' + html.slice(vS, vE + 6) + '\nthis.__V=Verify;', sb, { timeout: 15000 });
  return sb.__V;
}

const M = (name) => {
  const s = promised.find((x) => new RegExp(name, 'i').test(x.name));
  return s ? s.marker : null;
};
const mAnswer = M('final answer') || '✅';
const mSteps = M('step') || '📖';
const mVerify = M('verification') || '🔍';
const mResult = M('final result') || '🎯';

/* the exact template the prompt describes: answer first, bolded, then the
   difficulty line it mandates, then the sections in order */
function compose(answer, steps) {
  return '## ' + mAnswer + ' Final Answer\n' +
         '**' + answer + '**\n' +
         '**Difficulty:** Easy\n\n' +
         '## ' + mSteps + ' Step-by-Step Solution\n' + steps + '\n\n' +
         '## ' + mVerify + ' Verification\n' +
         'Substituting back into the original equation gives a true statement.\n\n' +
         '## ' + mResult + ' Final Result\n' + answer + '\n';
}

const V = loadEngine();
const CANON = { checked: 'verified', disputed: 'disputed', stepfail: 'disputed',
  invalid_question: 'disputed', unverified: 'unverified', worked: 'unverified',
  explained: 'unverified', plain: 'unverified', partial: 'unverified' };

const cases = [
  ['correct root, prompt format', 'Solve 3x - 6 = 0', compose('x = 2', '1. 3x = 6\n2. x = 2'), 'verified'],
  ['both roots, prompt format', 'Solve x^2 - 5x + 6 = 0',
    compose('x = 2, x = 3', '1. Factorise: (x-2)(x-3) = 0\n2. x = 2 or x = 3'), 'verified'],
  ['derivative, prompt format', 'Differentiate 3x^2 sin x',
    compose('6x sin x + 3x^2 cos x', '1. Product rule.\n2. Combine.'), 'verified'],
  /* the control: a WRONG answer in the same shape must still be caught, or the
     format check has proved only that the engine reads headings */
  ['wrong root, prompt format', 'Solve 3x - 6 = 0', compose('x = 5', '1. 3x = 6\n2. x = 5'), 'disputed'],
  ['wrong derivative, prompt format', 'Differentiate 3x^2 sin x',
    compose('9x sin x + 3x^2 cos x', '1. Product rule.'), 'disputed'],
];

const results = [];
for (const [name, q, a, want] of cases) {
  let r;
  try { r = V.run(q, a); } catch (e) { fails.push(name + ' THREW ' + e.message); continue; }
  const got = CANON[r.state];
  results.push('  ' + name.padEnd(32) + String(r.state).padEnd(11) + String(got).padEnd(11) +
               ((r.checks || []).map((c) => c.kind + (c.ok === true ? '+' : '-')).join(',') || '—'));
  if (got !== want) {
    fails.push(name + ': the prompt\'s own format produced ' + got + ' (' + r.state + '), expected ' + want +
               ' — the model and the engine have drifted apart');
  }
}

console.log('');
console.log('  sections the prompt instructs : ' + promised.length);
promised.forEach((s) => console.log('    ## ' + s.marker + '  ' + s.name));
console.log('');
console.log('  answers composed from that format, through the shipping engine:');
results.forEach((r) => console.log(r));
console.log('');
if (fails.length) {
  console.log('  ANSWER FORMAT CONTRACT BROKEN — ' + fails.length + '\n');
  fails.forEach((f) => console.log('    ' + f));
  console.log('\n  The engine is probably fine. The pipe between the model and the engine is not.\n');
  process.exit(1);
}
console.log('  answer format OK — an answer written the way the prompt demands is one the engine reads\n');
