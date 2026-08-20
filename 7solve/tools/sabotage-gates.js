#!/usr/bin/env node
/* ============================================================
   7Solve — GATE SABOTAGE PROOF
   ------------------------------------------------------------
   A gate that has never failed is a gate nobody has tested. This
   breaks one thing at a time and demands the gate notice.

   Every mutation is reverted in a `finally`. An earlier tool in
   this repo died between a cut and its restore and left a
   checker missing from verify.php, which the release packager
   then shipped — so nothing here is left to chance: the files
   are snapshotted up front, restored after every case, and
   verified byte-identical at the end before exit.

       node tools/sabotage-gates.js

   Exit 0 = every sabotage was caught.
   Exit 1 = a gate is decorative.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.join(__dirname, '..');
const P = (f) => path.join(HERE, f);
const FILES = ['capabilities.json', 'checks.json', 'index.html',
               'taxonomy/index.json', 'taxonomy/in/school.json', 'taxonomy/in/bba-mba.json'];

const snapshot = {};
FILES.forEach((f) => { snapshot[f] = fs.readFileSync(P(f)); });
function restore() { FILES.forEach((f) => fs.writeFileSync(P(f), snapshot[f])); }

function gateFails(which) {
  const tool = which === 'taxonomy' ? 'tools/gate-taxonomy.js' : 'tools/gate-capabilities.js';
  try {
    execFileSync(process.execPath, [P(tool)], { cwd: HERE, encoding: 'utf8', stdio: 'pipe' });
    return false;                                  // exit 0 — gate did NOT notice
  } catch (e) {
    return true;                                   // non-zero — gate bit
  }
}

/* ------------------------------------------------------------------
   Behavioural probe, for the cases where the point is NOT that a gate
   fires but that NOTHING HAPPENS.

   Requirement 8 is "adding taxonomy entries cannot accidentally create
   certification authority". A gate that rejects a malformed shard is
   only half of that. The other half is that a shard which is perfectly
   well-formed and lying as hard as it can — an MBA topic claiming every
   certifying problem type in the manifest — still moves no verdict.
   That cannot be shown by an exit code; it has to be run.
   ------------------------------------------------------------------ */
function verdicts() {
  const vm = require('vm');
  const h = fs.readFileSync(P('index.html'), 'utf8');
  const dS = h.indexOf('var Deriv = (function(){'), dE = h.indexOf('\nwindow.Deriv = Deriv;', dS);
  const dlS = h.indexOf('function deLatex(md){'), dlE = h.indexOf('\nwindow.deLatex7 = deLatex;', dlS);
  const vS = h.indexOf('var Verify = (function(){'), vE = h.indexOf('\n})();', vS);
  const sb = { window: {}, console: { log() {} }, $: () => null, state: {}, Math, parseFloat,
               parseInt, isFinite, isNaN, String, Number, Object, Array, RegExp, JSON };
  vm.createContext(sb);
  vm.runInContext(h.slice(dS, dE) + '\nwindow.Deriv=Deriv;\n' + h.slice(dlS, dlE) +
    '\nwindow.deLatex7=deLatex;\n' + h.slice(vS, vE + 6) + '\nthis.__V=Verify;', sb, { timeout: 8000 });
  const A = (s) => '## ✅ Answer\n**' + s + '**';
  const probe = [
    ['Differentiate 3x^2 sin x', A('6x sin x + 3x^2 cos x')],
    ['Differentiate 3x^2 sin x', A('9x sin x + 3x^2 cos x')],
    ['Solve x + y = 5 and x - y = 1', A('x = 3, y = 2')],
    ['Solve x^2 - 5x + 6 = 0', A('x = 2, x = 3')],
    ['Solve x^2 - 5x + 6 = 0', A('x = 2')],
    /* the Band D questions the sabotage tries to promote */
    ['Discuss segmentation, targeting and positioning', A('Segment by demographics, then target.')],
    ['Write an essay on the causes of the French Revolution', A('Financial crisis and famine.')],
    ['Explain the theories of motivation', A('Maslow, Herzberg, McClelland.')],
    ['What is the time complexity of merge sort?', A('O(n log n)')],
  ];
  return probe.map(([q, a]) => {
    const r = sb.__V.run(q, a);
    return r.state + '|' + (r.checks || []).map((c) => c.kind + (c.ok === true ? '+' : '-')).sort().join(',');
  }).join('\n');
}

/* edit helpers that fail loudly rather than silently no-op */
function editJson(file, fn) {
  const j = JSON.parse(fs.readFileSync(P(file), 'utf8'));
  fn(j);
  fs.writeFileSync(P(file), JSON.stringify(j, null, 2) + '\n', 'utf8');
}
function editText(file, from, to) {
  const s = fs.readFileSync(P(file), 'utf8');
  if (s.indexOf(from) < 0) throw new Error('sabotage pattern not found in ' + file + ': ' + from);
  fs.writeFileSync(P(file), s.replace(from, to), 'utf8');
}

const CASES = [
  ['C1  hand-edit a generated artifact', 'capabilities',
   () => editText('checks.json', '"name": "identityCheck"', '"name": "identityCheque"')],

  ['C9  hand-edit inside the PROOF fence', 'capabilities',
   () => editText('index.html', 'var PROOF = {subst:1', 'var PROOF = {subst:1, sneaky:1')],

  ['C2  point a checker at a marker that does not exist', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.checkers.find((c) => c.checker === 'identityCheck').engines.php = 'Phase1::nope($q),';
   })],

  ['C3  delete a checker\'s manifest entry (the .2 bug)', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.checkers = m.checkers.filter((c) => c.checker !== 'identityCheck');
   })],

  ['C4  subject names a checker that does not exist', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.subjects.find((s) => s.id === 'identity').checkers = ['ghostCheck'];
   })],

  ['C5  checker emits an undeclared kind', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.checkers.find((c) => c.checker === 'identityCheck').emits = ['phantom'];
   })],

  ['C6  two subjects share a rank', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.subjects.find((s) => s.id === 'identity').match.rank =
       m.subjects.find((s) => s.id === 'derivative').match.rank;
   })],

  ['C7  subject maps to a taxonomy node that does not exist', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.subjects.find((s) => s.id === 'identity').taxonomy = ['in.nowhere.at.all'];
   })],

  ['C8  supported subject with no certifying checker', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.kinds.find((k) => k.kind === 'identity').authority = 'advisory';
   })],

  ['S1  change a subject rule so a .2 answer moves', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     /* drop the solve/roots exclusion — "Solve … by factorising" would
        become identity again, which is exactly the .2-era mistake */
     delete m.subjects.find((s) => s.id === 'identity').match.none;
   })],

  ['S1b covered rule outranks a real subject', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.subjects.find((s) => s.id === 'humanities').match.rank = 5;
     m.subjects.find((s) => s.id === 'humanities').match.any = ['.'];
   })],

  ['S2  give a covered_not_verifiable subject a checker', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.subjects.find((s) => s.id === 'management').checkers = ['identityCheck'];
   })],

  ['T1  taxonomy node with an unresolvable parent', 'taxonomy',
   () => editJson('taxonomy/in/school.json', (t) => {
     t.nodes.find((n) => n.id === 'in.school.c10').parent = 'in.school.nonexistent';
   })],

  ['T2  taxonomy cycle', 'taxonomy',
   () => editJson('taxonomy/in/school.json', (t) => {
     t.nodes.find((n) => n.id === 'in.school.c10').parent = 'in.school.c10.maths.quadratic';
   })],

  ['T3  duplicate node id', 'taxonomy',
   () => editJson('taxonomy/in/bba-mba.json', (t) => {
     t.nodes.push({ id: 'in.school.c10', kind: 'class', parent: 'in.school', label: 'Dupe' });
   })],

  ['T4  shard declares an unknown schema', 'taxonomy',
   () => editJson('taxonomy/in/school.json', (t) => { t.schema = '7solve.taxonomy/99'; })],

  ['T5  shard listed in the index but missing a required field', 'taxonomy',
   () => editJson('taxonomy/in/school.json', (t) => { delete t.nodes[0].kind; })],

  /* ---- REQUIREMENT 8: a taxonomy entry may not create certification ---- */

  ['T6  taxonomy INVENTS a problem type nobody declared', 'taxonomy',
   () => editJson('taxonomy/in/bba-mba.json', (t) => {
     t.nodes.find((n) => n.id === 'in.pg.mba.marketing.s2.mm.stp')
      .problem_types = ['mgmt.marketing.provably.correct'];
   })],

  ['T7  problem types hung on a node kind that must not carry them', 'taxonomy',
   () => editJson('taxonomy/in/bba-mba.json', (t) => {
     t.nodes.find((n) => n.id === 'in.pg.mba').problem_types = ['calculus.derivative'];
   })],

  ['T8  Band D topic claims EVERY certifying problem type', 'inert',
   () => editJson('taxonomy/in/bba-mba.json', (t) => {
     const man = JSON.parse(fs.readFileSync(P('capabilities.json'), 'utf8'));
     const certifying = new Set(man.kinds.filter((k) => k.authority !== 'advisory').map((k) => k.kind));
     const byName = new Map(man.checkers.map((c) => [c.checker, c]));
     const all = [];
     for (const s of man.subjects) {
       const can = (s.checkers || []).some((ck) =>
         ((byName.get(ck) || {}).emits || []).some((k) => certifying.has(k)));
       if (can) all.push(...(s.problem_types || []));
     }
     /* a well-formed shard, lying as hard as the schema permits */
     t.nodes.find((n) => n.id === 'in.pg.mba.marketing.s2.mm.stp').problem_types = all;
     t.nodes.find((n) => n.id === 'in.pg.mba.hr.s2.ob.motivation').problem_types = all;
   })],

  ['T9  Band D subject rewritten to status supported', 'capabilities',
   () => editJson('capabilities.json', (m) => {
     m.subjects.find((s) => s.id === 'management').status = 'supported';
   })],
];

console.log('');
const BASELINE = verdicts();
let bad = 0;
for (const [name, which, mutate] of CASES) {
  let ok = false, err = null, note = '';
  try {
    mutate();
    if (which === 'inert') {
      /* the point is that nothing moves: every verdict identical, and the
         shard still passes its own gate because it is well formed */
      const after = verdicts();
      const gateStillPasses = !gateFails('taxonomy');
      ok = (after === BASELINE) && gateStillPasses;
      note = after === BASELINE
        ? (gateStillPasses ? ' (verdicts unchanged; shard is legal and inert)'
                           : ' — verdicts unchanged but the gate rejected a legal shard')
        : ' — A VERDICT MOVED';
    } else {
      ok = gateFails(which);
    }
  } catch (e) {
    err = e.message;
  } finally {
    restore();
  }
  if (err) { console.log('  ERROR    ' + name + ' — ' + err); bad++; continue; }
  const label = which === 'inert' ? (ok ? 'inert   ' : 'MOVED   ') : (ok ? 'caught  ' : 'MISSED  ');
  console.log('  ' + label + name + note);
  if (!ok) bad++;
}

/* the probe itself must be meaningful — if it returned the same string for
   everything it would pass T8 while proving nothing */
if (new Set(BASELINE.split('\n')).size < 4) {
  console.log('  ERROR    the behavioural probe is not discriminating; T8 proves nothing');
  bad++;
}

/* the tree must be exactly as it was */
let dirty = 0;
FILES.forEach((f) => { if (!fs.readFileSync(P(f)).equals(snapshot[f])) { dirty++;
  console.log('  NOT RESTORED: ' + f); } });

console.log('');
if (bad || dirty) {
  console.log('  SABOTAGE PROOF FAILED — ' + bad + ' uncaught, ' + dirty + ' file(s) left modified\n');
  process.exit(1);
}
console.log('  all ' + CASES.length + ' sabotages caught; every file restored byte-for-byte\n');
