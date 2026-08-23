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

   CORRECTED 2026-08-23. This file first claimed that changing one
   emoji in the prompt would silently unbadge every student. That
   was wrong, and measuring it is what showed so: claimZone falls
   back to `String(md).slice(0, 400)` when no heading matches, so
   the engine verifies an answer with NO headings at all, with
   prose only, and with a completely alien format. Breaking
   claimZone outright moved none of the verdicts here.

   The real exposure is narrower and worth stating exactly: the
   claim must appear inside the fallback window. An answer whose
   value sits past the first 400 characters with no recognised
   ✅ or 🎯 heading returns `plain` — a correct answer with no
   badge. The live format opens with "## 📌 Understood as" before
   the answer, so the margin is real but not large: grow that
   preamble, move the answer below Method and Verification, and
   lose heading recognition, and badges go.

   So this gate does three honest things rather than one
   overstated one: it holds the prompt to the markers the readers
   use, it proves an answer in the prompt's own shape verifies,
   and it pins the shape production ACTUALLY sends — which is not
   the shape the prompt asks for.

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

/* The section headings the prompt instructs, in the order it lists them.
   These were once written "## ✅ <Final Answer>", where the angle brackets meant
   "put the heading here". Nothing said so, and models split three ways: copy the
   brackets literally, translate the name, or paraphrase it — all three turned up
   in real production answers on 2026-08-23. The prompt now names the heading
   verbatim, so this reads it verbatim too. */
const promised = [...prompt.matchAll(/"##\s*([^\s"]+)\s+([^"]+)"/g)]
  .map((m) => ({ marker: m[1], name: m[2].trim() }));

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

/* ---- 4. THE FORMAT THE MODEL ACTUALLY EMITS ------------------------
   Everything above composes answers from buildSystemPrompt's template. A
   real signed-in answer captured from production on 2026-08-23 does NOT
   match that template:

     prompt says            model sent
     ## ✅ Final Answer      ## ✅ Answer
     ## 📖 Step-by-Step …    ## 📝 Steps
     ## 🧭 Method            (absent)
     ## 🔍 Verification      (absent)
                            ## 📌 Understood as   (extra, leads the answer)

   It still verifies, because the engine keys on the EMOJI rather than the
   heading words and hasSteps accepts 📝 alongside 📖. That is luck holding
   it up, not a test — so the real thing is pinned here as a fixture. If a
   future prompt or model change breaks the shape students actually receive,
   this fails even when the template above still passes.

   Captured verbatim. Do not tidy the headings to match the prompt: the
   whole point is that they do not match. */
const LIVE = '## 📌 Understood as\n3x - 6 = 0\n\n' +
  '## ✅ Answer\n**x = 2**\n\n' +
  '## 📝 Steps\n' +
  '1. The equation is linear in x: **3x + -6 = 0**.\n' +
  '2. Move the constant across: 3x = 6.\n' +
  '3. Divide both sides by 3: **x = 2**.\n' +
  '4. Check: substituting back gives 0 = 0.\n\n' +
  '## 🎯 Final Result\nx = 2\n';
cases.push(['LIVE production answer', 'Solve 3x - 6 = 0', LIVE, 'verified']);
/* the same real shape carrying a wrong value must still be caught */
cases.push(['LIVE shape, wrong value', 'Solve 3x - 6 = 0',
  LIVE.replace(/x = 2/g, 'x = 5').replace('gives 0 = 0', 'gives 9 = 0'), 'disputed']);

/* ---- 5. THE FALLBACK WINDOW, which is the exposure that is real ----
   claimZone reads ✅/🎯 and otherwise falls back to the first 400 characters.
   That fallback is why format drift is survivable — and it is also the whole
   of the remaining risk, because it is a WINDOW. Push the claim past it with
   no recognised heading and a correct answer silently loses its badge.

   These two cases pin both sides of that edge. If someone lengthens the
   preamble the prompt asks for, or moves the answer below Method and
   Verification, the second one starts failing and says why. */
const PREAMBLE = 'First, let us restate and understand the problem carefully. ';
const bare = (pad, val) => pad + '\n\nThe answer is ' + val + '.\n';
cases.push(['claim inside fallback window', 'Solve 3x - 6 = 0',
  bare(PREAMBLE.repeat(2), 'x = 2'), 'verified']);
cases.push(['claim past fallback, no heading', 'Solve 3x - 6 = 0',
  bare(PREAMBLE.repeat(9), 'x = 2'), 'unverified']);
/* …and a recognised heading rescues exactly that case, which is what the
   headings are actually FOR */
cases.push(['heading rescues a long preamble', 'Solve 3x - 6 = 0',
  PREAMBLE.repeat(9) + '\n\n## ' + mAnswer + ' Answer\n**x = 2**\n', 'verified']);

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
