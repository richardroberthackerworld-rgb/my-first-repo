#!/usr/bin/env node
/* ============================================================
   7Solve — TAXONOMY INTEGRITY GATE
   ------------------------------------------------------------
   The taxonomy is contributor-facing: us, future developers,
   trusted contributors, and eventually an import pipeline. That
   is only safe if a bad shard is rejected mechanically rather
   than noticed later by a student.

   The load-bearing property is the one at the bottom: a
   contributor CANNOT grant a capability from a taxonomy file.
   Naming a problem type no subject declares is an error, not a
   promotion — coverage never authorises verification.

       node tools/gate-taxonomy.js

   Exit 0 = the taxonomy is well formed and claims nothing.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const P = (f) => path.join(HERE, f);
const SCHEMA = '7solve.taxonomy/1';
const KINDS = ['country', 'level', 'program', 'branch', 'year', 'semester',
               'class', 'subject', 'unit', 'topic', 'exam'];

const fail = [];
const bad = (s) => fail.push('  ' + s);

const idx = JSON.parse(fs.readFileSync(P('taxonomy/index.json'), 'utf8'));
if (idx.schema !== SCHEMA) bad('taxonomy/index.json declares schema ' + idx.schema + ', expected ' + SCHEMA);

const shards = [{ file: 'taxonomy/index.json', doc: idx }];
for (const s of (idx.shards || [])) {
  const f = 'taxonomy/' + s;
  if (!fs.existsSync(P(f))) { bad('index lists ' + s + ' but the file does not exist'); continue; }
  shards.push({ file: f, doc: JSON.parse(fs.readFileSync(P(f), 'utf8')) });
}

/* ---------- shard-level ---------- */
for (const { file, doc } of shards) {
  if (doc.schema !== SCHEMA) bad(file + ' declares schema ' + doc.schema + ', expected ' + SCHEMA);
  if (!doc.version) bad(file + ' has no version');
  if (!doc.source) bad(file + ' has no source (provenance is required so a bad import can be pulled)');
  if (!Array.isArray(doc.nodes)) bad(file + ' has no nodes array');
}

/* ---------- node-level ---------- */
const byId = new Map();
const nodes = [];
for (const { file, doc } of shards) {
  for (const n of (doc.nodes || [])) {
    if (!n.id) { bad(file + ' has a node with no id'); continue; }
    if (!n.kind) { bad(file + ': node ' + n.id + ' has no kind'); continue; }
    if (KINDS.indexOf(n.kind) < 0) bad(file + ': node ' + n.id + ' has unknown kind "' + n.kind + '"');
    if (!n.label) bad(file + ': node ' + n.id + ' has no label');
    if (byId.has(n.id)) bad('duplicate node id ' + n.id + ' (' + byId.get(n.id).file + ' and ' + file + ')');
    else byId.set(n.id, { node: n, file });
    nodes.push(n);
  }
}

/* parents resolve */
for (const [id, { node }] of byId) {
  if (node.parent === null || node.parent === undefined) continue;
  if (!byId.has(node.parent)) bad('node ' + id + ' has unresolvable parent ' + node.parent);
}

/* no cycles */
for (const [id] of byId) {
  const seen = new Set();
  let cur = id, depth = 0;
  while (cur !== null && cur !== undefined) {
    if (seen.has(cur)) { bad('cycle in the taxonomy at ' + id + ' (revisits ' + cur + ')'); break; }
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    cur = rec.node.parent;
    if (++depth > 64) { bad('node ' + id + ' is more than 64 tiers deep — almost certainly a cycle'); break; }
  }
}

/* aliases: non-empty strings, no duplicates within a node */
for (const [id, { node }] of byId) {
  const a = node.aliases;
  if (a === undefined) continue;
  if (!Array.isArray(a)) { bad('node ' + id + ' has a non-array aliases field'); continue; }
  const low = a.map((x) => String(x).toLowerCase());
  if (new Set(low).size !== low.length) bad('node ' + id + ' repeats an alias');
  if (a.some((x) => typeof x !== 'string' || !x.trim())) bad('node ' + id + ' has an empty alias');
}

/* match patterns must compile */
for (const [id, { node }] of byId) {
  for (const p of (node.match || [])) {
    try { new RegExp(p); } catch (e) { bad('node ' + id + ' has an invalid match pattern: ' + p); }
  }
}

/* ------------------------------------------------------------------
   THE LOAD-BEARING RULE.

   A topic may NAME a problem type. It may not INVENT one. Every
   problem_type in the taxonomy must already be declared by a subject in
   capabilities.json, where its capability status — and therefore whether
   anything about it can ever be certified — is decided.

   Without this, a contributor could add a shard naming problem types that
   resolve to nothing, and the honest answer for that topic would silently
   become "unknown" rather than "covered but not verifiable". Worse, a
   future lookup keyed on problem_type could match nothing and fall through
   to a default. Coverage must never be able to reach into capability.
   ------------------------------------------------------------------ */
const manifest = JSON.parse(fs.readFileSync(P('capabilities.json'), 'utf8'));
const declared = new Set();
manifest.subjects.forEach((s) => (s.problem_types || []).forEach((p) => declared.add(p)));
for (const [id, { node }] of byId) {
  for (const p of (node.problem_types || [])) {
    if (!declared.has(p))
      bad('node ' + id + ' names problem type "' + p + '" that no subject in capabilities.json declares');
  }
}

/* only leaf-ish kinds should carry problem types */
for (const [id, { node }] of byId) {
  if (!node.problem_types) continue;
  if (['topic', 'subject', 'unit'].indexOf(node.kind) < 0)
    bad('node ' + id + ' is a ' + node.kind + ' but carries problem_types — put them on a subject, unit or topic');
}

/* ---------- report ---------- */
console.log('');
if (fail.length) {
  fail.forEach((f) => console.log(f));
  console.log('\n  TAXONOMY GATE FAILED — ' + fail.length + ' problem(s)\n');
  process.exit(1);
}
const counts = {};
nodes.forEach((n) => { counts[n.kind] = (counts[n.kind] || 0) + 1; });
const withPt = nodes.filter((n) => n.problem_types).length;
console.log('  taxonomy gate OK — ' + byId.size + ' nodes across ' + shards.length + ' shards');
console.log('    ' + Object.entries(counts).map(([k, v]) => k + ':' + v).join('  '));
console.log('    ' + withPt + ' nodes carry problem types, all declared in capabilities.json');
console.log('    ' + declared.size + ' problem types declared, ' +
  manifest.subjects.filter((s) => (s.status || 'supported') === 'covered_not_verifiable').length +
  ' subjects are covered_not_verifiable\n');
