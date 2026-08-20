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
];

console.log('');
let bad = 0;
for (const [name, which, mutate] of CASES) {
  let caught = false, err = null;
  try {
    mutate();
    caught = gateFails(which);
  } catch (e) {
    err = e.message;
  } finally {
    restore();
  }
  if (err) { console.log('  ERROR    ' + name + ' — ' + err); bad++; continue; }
  console.log('  ' + (caught ? 'caught  ' : 'MISSED  ') + name);
  if (!caught) bad++;
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
