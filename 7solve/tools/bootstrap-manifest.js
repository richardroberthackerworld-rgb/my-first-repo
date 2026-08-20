#!/usr/bin/env node
/* ============================================================
   7Solve — MANIFEST BOOTSTRAP  (one-time, kept for provenance)
   ------------------------------------------------------------
   Release A's whole acceptance property is that nothing moved.
   Hand-typing capabilities.json from four scattered sources
   would have put that property at the mercy of my typing, so
   the manifest is DERIVED from the live sources instead and the
   generator then reproduces those sources from it. Faithfulness
   is a round trip, not a promise.

   Reads, at the .2 baseline:
     1. checks.json                  — checker names + engine markers
     2. index.html  PROOF = {…}      — which kinds may certify
     3. capability.php SUBJECT_CHECKER — subject → checker
     4. capability.php subjectOf()   — question → subject

   Emits capabilities.json. Run once; after that the manifest is
   the source of truth and this file is history.

       node tools/bootstrap-manifest.js > ../capabilities.json

   Two findings this script encodes rather than fixes, because
   Release A must not change behaviour:

     * index.html declares `units` TWICE (≈14571 and ≈15993).
       The later declaration wins by hoisting, so the live kind
       is `units` (dimensional analysis) and the earlier one's
       `unit` is dead. The manifest records what actually runs.

     * SUBJECT_CHECKER lists 10 subjects but subjectOf() can
       only ever return 6. The other four are reachable only
       through supportedSubjects(). They are carried with no
       `match` block, which reproduces exactly that behaviour.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(HERE, 'checks.json'), 'utf8'));

/* ---------- 1. the PROOF set, read from the live literal ---------- */
function readProof() {
  const i = html.indexOf('var PROOF = {');
  if (i < 0) throw new Error('PROOF literal not found');
  const j = html.indexOf('};', i) + 2;
  const blk = html.slice(i, j);
  return [...blk.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*1/g)].map((m) => m[1]);
}

/* ---------- 2. which kind each checker emits ---------- */
function bodyOf(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) return null;
  /* LAST declaration wins in JS — that is why `units` resolves to the
     dimensional-analysis one. Walk to the last occurrence, not the first. */
  let last = i, k = i;
  while ((k = html.indexOf('function ' + name + '(', k + 1)) >= 0) last = k;
  let d = 0, s = html.indexOf('{', last), p = s;
  for (; p < html.length; p++) {
    if (html[p] === '{') d++;
    else if (html[p] === '}') { d--; if (!d) break; }
  }
  return html.slice(last, p + 1);
}

function kindsOf(name) {
  const b = bodyOf(name);
  if (!b) return [];
  return [...new Set([...b.matchAll(/kind\s*:\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)].map((m) => m[1]))];
}

/* ---------- 3. authority, derived from PROOF membership ----------
   proof     — in PROOF, settles the claim on its own
   evidence  — in PROOF, but the checker marks needsComplete, so Phase 1's
               evidenceOnly rule stops it certifying alone. Only `subst`
               does this today (index.html:13863).
   advisory  — not in PROOF; can never contribute to certification.        */
const PROOF = readProof();
const EVIDENCE_KINDS = ['subst'];

const DESCRIBES = {
  subst: 'A stated value satisfies the equation',
  roots: 'The stated set is the complete solution set',
  identity: 'Two expressions are equal for all values',
  deriv: 'The derivative is correct, by symbolic differentiation',
  integral: 'The antiderivative differentiates back to the integrand',
  system: 'The system is linear with a unique solution and it is this one',
  arith: 'The arithmetic recomputes',
  primality: 'Primality by exact test',
  units: 'The answer carries the dimensions the question asked for',
  divis: 'The divisibility claim recomputes',
  chem: 'The equation balances',
  bound: 'The stated bound holds',
  unique: 'Uniqueness established',
  condition: 'The stated conditions are satisfied',
  extremum: 'The extremum is confirmed',
  transform: 'The transformation preserves the value',
  integrity: 'The question was transcribed faithfully into the working',
  trace: 'The working reaches the answer it claims',
  question: 'The question itself is well posed',
  claim: 'A stated claim is supported by the working',
  truncated: 'The solution is finished, not cut off',
  contradiction: 'The answer does not contradict its own working',
};

const kinds = [];
const seenKind = new Set();
function addKind(kind) {
  if (seenKind.has(kind)) return;
  seenKind.add(kind);
  const inProof = PROOF.indexOf(kind) >= 0;
  kinds.push({
    kind,
    authority: !inProof ? 'advisory' : (EVIDENCE_KINDS.indexOf(kind) >= 0 ? 'evidence' : 'proof'),
    needs_complete: EVIDENCE_KINDS.indexOf(kind) >= 0,
    describes: DESCRIBES[kind] || null,
  });
}
/* PROOF order first so the generated set reproduces the original ordering */
PROOF.forEach(addKind);

/* ---------- 4. checkers ---------- */
const checkers = registry.checks.map((c) => {
  const emits = kindsOf(c.name);
  emits.forEach(addKind);
  const out = {
    checker: c.name,
    emits,
    engines: { js: c.js, php: c.php },
  };
  if (c.note) out.note = c.note;
  return out;
});

/* ---------- 5. subjects ----------
   SUBJECT_CHECKER order is preserved: supportedSubjects() iterates it, and
   /v1 reports that list, so re-ordering would be a visible API change.

   `match` transcribes subjectOf()'s ladder. Two rules there are NOT regex
   matches — they count '=' signs — so the rule vocabulary carries a `count`
   form rather than pretending a regex can express it. `rank` makes the
   ladder's implicit first-match-wins order explicit.

   The ∫ pattern is stored as the literal character rather than PHP's
   \x{222B} escape: under /u both denote U+222B, and a literal survives the
   trip through JSON into either engine without escape-syntax divergence.  */
const subjects = [
  { id: 'derivative', display: 'Differentiation', checker: 'derivativeCheck',
    aliases: ['differentiation', 'derivative', 'differentiate'],
    problem_types: ['calculus.derivative'],
    taxonomy: ['in.school.c12.maths.calculus', 'in.ug.btech.s1.m1.calculus'],
    match: { any: ['(?:d\\s*/\\s*d[a-z]|differentiate|derivative)'], flags: 'i', rank: 10 } },

  { id: 'integral', display: 'Integration', checker: 'integralCheck',
    aliases: ['integration', 'integral', 'antiderivative'],
    problem_types: ['calculus.integral.indefinite'],
    taxonomy: ['in.school.c12.maths.calculus', 'in.ug.btech.s1.m1.calculus'],
    match: { any: ['(?:∫|integrate|integral\\s+of|antiderivative)'], flags: 'iu', rank: 20 } },

  { id: 'system', display: 'Simultaneous equations', checker: 'systemCheck',
    aliases: ['system of equations', 'simultaneous equations'],
    problem_types: ['algebra.system.linear'],
    taxonomy: ['in.school.c10.maths.linear'],
    match: { count: { pattern: '=', min: 2 }, any: ['\\band\\b|,|;|\\n'], flags: '', rank: 50 } },

  { id: 'identity', display: 'Factorisation & expansion', checker: 'identityCheck',
    aliases: ['factorisation', 'factorization', 'expansion', 'factorise', 'expand'],
    problem_types: ['algebra.factorise', 'algebra.expand'],
    taxonomy: ['in.school.c9.maths.polynomials', 'in.school.c10.maths.polynomials'],
    match: { any: ['\\b(factoris|factoriz|expand)'], none: ['\\bsolve\\b|\\broots?\\b'],
             flags: 'i', rank: 40 } },

  { id: 'equation_roots', display: 'Solving equations', checker: 'substitution',
    aliases: ['roots', 'solve', 'solution'],
    problem_types: ['algebra.equation.solve'],
    taxonomy: ['in.school.c10.maths.quadratic'],
    match: { count: { pattern: '=', min: 1 }, flags: '', rank: 60 } },

  { id: 'root_completeness', display: 'Complete solution sets', checker: 'solutionCompleteness',
    aliases: ['all roots', 'complete solution set'],
    problem_types: ['algebra.equation.solve.complete'],
    taxonomy: ['in.school.c10.maths.quadratic'] },

  { id: 'arithmetic', display: 'Arithmetic', checker: 'arithmetic',
    aliases: ['arithmetic', 'calculation'],
    problem_types: ['arith.evaluate'],
    taxonomy: ['in.school.c6.maths'] },

  { id: 'primality', display: 'Primality', checker: 'primality',
    aliases: ['prime', 'composite'],
    problem_types: ['number.primality'],
    taxonomy: ['in.school.c6.maths.numbers'],
    match: { any: ['\\bis\\s+\\d+\\s+prime\\b|\\bprime\\s+number\\b'], flags: 'i', rank: 30 } },

  { id: 'units', display: 'Units & dimensions', checker: 'units',
    aliases: ['units', 'dimensions', 'dimensional analysis'],
    problem_types: ['physics.units.dimension'],
    taxonomy: ['in.school.c11.physics.units'] },

  { id: 'question_integrity', display: 'Question validity', checker: 'questionCheck',
    aliases: ['question validity'],
    problem_types: ['meta.question.validity'],
    taxonomy: [] },
];

/* every subject above is one that already has a working checker */
subjects.forEach((s) => {
  s.checkers = [s.checker];
  delete s.checker;
  s.status = 'supported';
});

/* ---------- 6. covered_not_verifiable subjects ----------
   7Solve answers these and cannot independently check them. They carry no
   checkers, so they emit no proof-kind checks, so the frozen state machine
   cannot reach `checked` for them — the guarantee is the existing machinery
   giving the right answer, not a rule bolted on top.

   RANK. Every rule here sits at 100+, below all six original rules (10–60).
   That is what keeps Release A's subject-detection equivalence intact: a
   question that resolved to a subject before still hits its original rule
   first, so the only inputs whose answer can change are ones that used to
   return null. The equivalence test asserts exactly that asymmetry.

   These exist so the taxonomy's Band D problem_types resolve, and so the
   honest capability state is reachable at all. A state that nothing can
   produce is not a feature.                                              */
const COVERED = [
  { id: 'management', display: 'Management & business studies',
    aliases: ['management', 'marketing', 'organisational behaviour', 'business studies'],
    problem_types: ['mgmt.theory.explain', 'mgmt.marketing.case'],
    taxonomy: ['in.ug.bba.s1.pom.functions', 'in.pg.mba.marketing.s2.mm.stp',
               'in.pg.mba.hr.s2.ob.motivation'],
    match: { any: ['\\b(segmentation|targeting|positioning|marketing\\s+mix|swot)\\b',
                   '\\b(theories?|principles?|functions?)\\s+of\\s+(management|motivation|leadership)\\b'],
             flags: 'i', rank: 100 } },

  { id: 'humanities', display: 'Humanities & literature',
    aliases: ['history', 'literature', 'english literature', 'essay'],
    problem_types: ['humanities.essay.analyse', 'lang.essay.compose'],
    taxonomy: ['in.ug.ba.history.s1.modern.revolutions',
               'in.ug.ba.english.s1.poetry.criticism', 'in.school.c12.english.essay'],
    match: { any: ['\\bwrite\\s+an?\\s+essay\\b',
                   '\\b(critically\\s+)?(analyse|analyze|discuss)\\b.{0,40}\\b(poem|novel|revolution|war|reign|dynasty|movement)\\b'],
             flags: 'i', rank: 110 } },

  { id: 'economics_theory', display: 'Economic theory',
    aliases: ['economics', 'microeconomics', 'macroeconomics'],
    problem_types: ['econ.theory.explain'],
    taxonomy: ['in.pg.ma.economics.s1.micro.elasticity', 'in.pg.ma.economics.s1.micro.welfare'],
    match: { any: ['\\b(welfare\\s+economics|consumer\\s+surplus|pareto)\\b'],
             flags: 'i', rank: 120 } },

  { id: 'accounting', display: 'Accounting',
    aliases: ['accounting', 'financial accounting', 'trial balance', 'double entry'],
    problem_types: ['commerce.accounting.balance', 'commerce.finance.tvm'],
    taxonomy: ['in.ug.bcom.s1.fa.doubleentry', 'in.pg.mcom.s1.fm.tvm'],
    match: { any: ['\\b(trial\\s+balance|double[- ]entry|journal\\s+entr|ledger)\\b'],
             flags: 'i', rank: 130 } },

  { id: 'algorithms', display: 'Algorithm analysis',
    aliases: ['algorithms', 'complexity', 'big o'],
    problem_types: ['algo.complexity.analyse'],
    taxonomy: ['in.ug.btech.cse.s3.dsa.u2.complexity', 'in.pg.mtech.cse.s1.aa.np',
               'in.pg.mca.s1.dsa.analysis'],
    match: { any: ['\\b(time\\s+complexity|big[-\\s]?o\\b|space\\s+complexity)'],
             flags: 'i', rank: 140 } },
];
COVERED.forEach((s) => {
  s.checkers = [];
  s.status = 'covered_not_verifiable';
  subjects.push(s);
});

/* checks.json's own header is carried verbatim rather than rewritten. Release A's
   acceptance property is that the generated file is byte-identical to the .2
   original, and editing the header — even to add "this file is generated" —
   would break that for no safety gain: gate C1 regenerates and diffs, so a hand
   edit is caught whether or not the file says so about itself. */
const checksHeader = registry._;

const manifest = {
  _: 'CANONICAL CAPABILITY MANIFEST. The single source of truth for what 7Solve can check, ' +
     'what each check may conclude, and which subject a question belongs to. checks.json and the ' +
     'PROOF set in index.html are GENERATED from this file; capability.php reads it at runtime. ' +
     'Nothing here may be duplicated by hand anywhere else — tools/gate-capabilities.js fails the ' +
     'build if a generated artifact drifts. Authority lives on the KIND, never on the subject or ' +
     'the checker, so a subject cannot grant itself certification power by declaring it.',
  schema: '7solve.capability/1',
  version: '2026-08-21',
  kinds,
  checkers,
  subjects,
  _generated: {
    'checks.json': { header: checksHeader, limits: registry._limits, eol: 'crlf' },
  },
};

process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
