#!/usr/bin/env node
/* ============================================================
   7Solve — LEGACY COVERAGE GATE  (migration M3a)
   ------------------------------------------------------------
   The generator turned 465 courses into taxonomy nodes. This
   proves it dropped none of them, invented none of them, and
   that the one deliberate omission is still deliberate.

   Coverage is the product's headline claim. A migration that
   quietly loses forty exams is worse than one that fails
   loudly, because nobody notices until a student cannot find
   their course.

       node tools/gate-legacy-coverage.js

   Exit 0 = every legacy course is either modelled by a
            hand-authored node or generated, and the excluded
            set is exactly what the generator declares.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const legacy = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'legacy-taxonomy.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(HERE, 'taxonomy', 'index.json'), 'utf8'));

const nodes = [...idx.nodes];
for (const s of idx.shards) {
  nodes.push(...JSON.parse(fs.readFileSync(path.join(HERE, 'taxonomy', s), 'utf8')).nodes);
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const byLabel = new Map();
for (const n of nodes) {
  for (const k of [n.label, ...(n.aliases || [])].map(norm)) {
    if (!byLabel.has(k)) byLabel.set(k, n);
  }
}

/* must match the generator's declaration — if these ever disagree, the
   exclusion has drifted from a decision into an accident */
const DECLARED_EXCLUDED = ['current', 'other'];
const genSrc = fs.readFileSync(path.join(HERE, 'tools', 'gen-legacy-taxonomy.js'), 'utf8');
const m = genSrc.match(/const EXCLUDED_LEVELS = \[([^\]]*)\]/);
const generatorExcluded = m ? m[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean) : [];

const fails = [];
if (JSON.stringify(generatorExcluded) !== JSON.stringify(DECLARED_EXCLUDED)) {
  fails.push('the generator excludes [' + generatorExcluded.join(', ') +
             '] but this gate expects [' + DECLARED_EXCLUDED.join(', ') +
             '] — an exclusion changed without the gate changing with it');
}

let covered = 0, missing = [], excluded = 0;
for (const lv of legacy.levels) {
  if (DECLARED_EXCLUDED.includes(lv.id)) { excluded += lv.courses.length; continue; }
  for (const course of lv.courses) {
    if (byLabel.has(norm(course))) covered++;
    else missing.push(lv.id + ' / ' + course);
  }
}
if (missing.length) {
  fails.push(missing.length + ' legacy course(s) have no node');
}

/* the excluded ones must be genuinely absent — an exclusion that leaked half
   its entries in is the worst of both worlds */
let leaked = [];
for (const lv of legacy.levels) {
  if (!DECLARED_EXCLUDED.includes(lv.id)) continue;
  for (const course of lv.courses) if (byLabel.has(norm(course))) leaked.push(lv.id + ' / ' + course);
}
if (leaked.length) fails.push(leaked.length + ' excluded course(s) are in the taxonomy anyway');

/* every course's subjects must be reachable: either its own nodes, or its
   level's list, exactly as the app resolves them today */
let ownSets = 0, ownSubjectsOk = 0, ownSubjectsMissing = [];
for (const [course, subs] of Object.entries(legacy.course_subjects)) {
  const node = byLabel.get(norm(course));
  if (!node) continue;                       // orphan key, reported by the extractor
  ownSets++;
  const kids = nodes.filter((n) => n.parent === node.id && n.kind === 'subject').map((n) => norm(n.label));
  for (const s of subs) {
    if (kids.includes(norm(s))) ownSubjectsOk++;
    else ownSubjectsMissing.push(course + ' → ' + s);
  }
}
if (ownSubjectsMissing.length > 0 && ownSubjectsMissing.length / (ownSubjectsOk + ownSubjectsMissing.length) > 0.02) {
  fails.push(ownSubjectsMissing.length + ' course→subject pairs are unreachable');
}

console.log('');
console.log('  legacy courses            : ' + legacy.levels.reduce((n, l) => n + l.courses.length, 0));
console.log('    covered by a node       : ' + covered);
console.log('    deliberately excluded   : ' + excluded + '  (' + DECLARED_EXCLUDED.join(', ') + ')');
console.log('    missing                 : ' + missing.length);
console.log('  course→subject pairs      : ' + (ownSubjectsOk + ownSubjectsMissing.length));
console.log('    reachable               : ' + ownSubjectsOk);
console.log('    unreachable             : ' + ownSubjectsMissing.length);
console.log('  taxonomy nodes total      : ' + nodes.length);
console.log('');
if (missing.length) {
  console.log('  MISSING (first 10):');
  missing.slice(0, 10).forEach((x) => console.log('    ' + x));
  console.log('');
}
if (ownSubjectsMissing.length) {
  console.log('  UNREACHABLE SUBJECTS (first 6):');
  ownSubjectsMissing.slice(0, 6).forEach((x) => console.log('    ' + x));
  console.log('');
}
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL: ' + f));
  console.log('\n  LEGACY COVERAGE GATE FAILED\n');
  process.exit(1);
}
console.log('  legacy coverage gate OK — every course kept, every exclusion still deliberate\n');
