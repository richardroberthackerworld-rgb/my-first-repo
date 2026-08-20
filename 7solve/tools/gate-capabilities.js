#!/usr/bin/env node
/* ============================================================
   7Solve — CAPABILITY CONSISTENCY GATE   (C1 … C10 + S1 S2)
   ------------------------------------------------------------
   capabilities.json is the single source of truth. This fails
   the build the moment anything on disk disagrees with it.

   The failure it exists for is not hypothetical. Release .2
   shipped an identity checker that was wired, correct and
   certifying in BOTH engines while capability.php had no branch
   that could ever name it — so /v1 answered `unknown_subject`
   about questions it had just verified. Four hand-kept lists,
   one forgotten. C3 catches that directly; C8 catches it from
   the other side.

       node tools/gate-capabilities.js
       node tools/gate-capabilities.js --sabotage   prove it bites

   Exit 0 = no artifact on disk disagrees with the manifest.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.join(__dirname, '..');
const P = (f) => path.join(HERE, f);
const PHP = process.env.PHP_BIN || 'php';

const fail = [];
const pass = [];
const ok = (id, what) => pass.push('  ' + id.padEnd(5) + what);
const bad = (id, what) => fail.push('  ' + id.padEnd(5) + what);

const m = JSON.parse(fs.readFileSync(P('capabilities.json'), 'utf8'));
const html = fs.readFileSync(P('index.html'), 'utf8');

const kindNames = new Set(m.kinds.map((k) => k.kind));
const checkerNames = new Set(m.checkers.map((c) => c.checker));

/* ---------- C1 / C2 / C9 / C10 — the generator ---------- */
function gen(args) {
  return execFileSync(process.execPath, [P('tools/gen-capabilities.js')].concat(args || []),
    { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let c1ok = true;
try {
  execFileSync(process.execPath, [P('tools/gen-capabilities.js'), '--check'],
    { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { c1ok = false; }
if (c1ok) ok('C1', 'generated artifacts match the manifest');
else bad('C1', 'a generated artifact was hand-edited or is stale — run tools/gen-capabilities.js');

/* C10 — idempotence. Regenerate twice into copies and compare. Done by
   snapshotting, running, comparing, restoring; nothing is left changed. */
{
  const before = { checks: fs.readFileSync(P('checks.json')), index: fs.readFileSync(P('index.html')) };
  try {
    gen();
    const one = { checks: fs.readFileSync(P('checks.json')), index: fs.readFileSync(P('index.html')) };
    gen();
    const two = { checks: fs.readFileSync(P('checks.json')), index: fs.readFileSync(P('index.html')) };
    if (one.checks.equals(two.checks) && one.index.equals(two.index))
      ok('C10', 'generator is idempotent (two runs, zero diff)');
    else bad('C10', 'generator is NOT idempotent — the faithfulness proof would be meaningless');
  } finally {
    fs.writeFileSync(P('checks.json'), before.checks);
    fs.writeFileSync(P('index.html'), before.index);
  }
}

/* C9 — the fence hash actually describes the block it fences */
{
  const crypto = require('crypto');
  const open = html.indexOf('/* @generated:PROOF');
  const close = html.indexOf('/* @end:PROOF */');
  if (open < 0 || close < 0) bad('C9', 'PROOF fence markers are missing');
  else if (html.indexOf('/* @generated:PROOF', open + 1) >= 0 ||
           html.indexOf('/* @end:PROOF */', close + 1) >= 0)
    bad('C9', 'PROOF fence appears more than once');
  else {
    const stated = (html.slice(open, close).match(/sha256:([0-9a-f]{16})/) || [])[1];
    const declStart = html.indexOf('var PROOF = {', open);
    const declEnd = html.indexOf('};', declStart) + 2;
    const lineStart = html.lastIndexOf('\n', declStart) + 1;
    const decl = html.slice(lineStart, declEnd);
    const actual = crypto.createHash('sha256').update(decl).digest('hex').slice(0, 16);
    if (stated === actual) ok('C9', 'PROOF fence hash matches the fenced block');
    else bad('C9', 'PROOF fence hash ' + stated + ' does not match the block (' + actual + ')');
  }
}

/* ---------- C2 / C3 — manifest ↔ shipping source, both directions ---------- */
{
  const php = fs.readFileSync(P('verify.php'), 'utf8') +
              fs.readFileSync(P('checkers-phase1.php'), 'utf8') +
              fs.readFileSync(P('calculus-phase1.php'), 'utf8');
  let missing = 0;
  for (const c of m.checkers) {
    if (c.engines.js && html.indexOf(c.engines.js) < 0) {
      bad('C2', 'JS marker for ' + c.checker + ' is not in index.html'); missing++;
    }
    if (c.engines.php && php.indexOf(c.engines.php) < 0) {
      bad('C2', 'PHP marker for ' + c.checker + ' is not in the PHP engine'); missing++;
    }
  }
  if (!missing) ok('C2', 'every manifest engine marker resolves in the shipping source');
}

/* C3 — the reverse direction: a checker in production with no manifest entry.
   This is the .2 bug class. checks.json is generated from the manifest, so
   comparing against it would be circular — read the PIPELINE instead. */
{
  const runStart = html.indexOf('function run(');
  const runEnd = html.indexOf('\n    }', runStart);
  const pipeline = runStart >= 0 ? html.slice(runStart, runEnd) : '';
  const called = new Set();
  for (const mm of pipeline.matchAll(/\b([a-z][A-Za-z0-9]*)\s*\(\s*(?:question|text|md)\b/g))
    called.add(mm[1]);
  const unknown = [...called].filter((n) => !checkerNames.has(n) &&
    /Check$|^substitution$|^integrity$|^arithmetic$|^units$|^trace$|^primality$|^completeness$|^taxonomy$|^contradiction$|^presentation$|^unproved$|^consistency$|^uniqueness$|^optimality$|^quantifier$|^bounds$|^chemistry$/.test(n));
  if (!unknown.length) ok('C3', 'no checker runs in production without a manifest entry');
  else bad('C3', 'checker(s) in the pipeline with no manifest entry: ' + unknown.join(', '));
}

/* ---------- C4 / C5 / C6 / C7 / C8 — internal coherence ---------- */
{
  let n = 0;
  for (const s of m.subjects) for (const ck of (s.checkers || []))
    if (!checkerNames.has(ck)) { bad('C4', 'subject ' + s.id + ' names unknown checker ' + ck); n++; }
  if (!n) ok('C4', 'every subject checker exists');
}
{
  let n = 0;
  for (const c of m.checkers) for (const k of (c.emits || []))
    if (!kindNames.has(k)) { bad('C5', 'checker ' + c.checker + ' emits unknown kind ' + k); n++; }
  if (!n) ok('C5', 'every emitted kind is declared');
}
{
  const seen = new Map();
  let n = 0;
  for (const s of m.subjects) {
    if (!s.match) continue;
    const r = s.match.rank;
    if (r === undefined) { bad('C6', 'subject ' + s.id + ' has a match rule but no rank'); n++; continue; }
    if (seen.has(r)) { bad('C6', 'rank ' + r + ' shared by ' + seen.get(r) + ' and ' + s.id); n++; }
    seen.set(r, s.id);
  }
  if (!n) ok('C6', 'every match rule has a unique rank (' + seen.size + ' rules)');
}
{
  /* C7 — taxonomy references resolve, and problem types are declared */
  const nodes = new Set();
  const problemTypes = new Set();
  const idx = JSON.parse(fs.readFileSync(P('taxonomy/index.json'), 'utf8'));
  const shards = [idx].concat(idx.shards.map((s) =>
    JSON.parse(fs.readFileSync(P('taxonomy/' + s), 'utf8'))));
  for (const sh of shards) for (const nd of sh.nodes) {
    nodes.add(nd.id);
    (nd.problem_types || []).forEach((p) => problemTypes.add(p));
  }
  let n = 0;
  for (const s of m.subjects) for (const t of (s.taxonomy || []))
    if (!nodes.has(t)) { bad('C7', 'subject ' + s.id + ' maps to unknown taxonomy node ' + t); n++; }
  const declared = new Set();
  m.subjects.forEach((s) => (s.problem_types || []).forEach((p) => declared.add(p)));
  for (const p of problemTypes)
    if (!declared.has(p)) { bad('C7', 'taxonomy names problem type ' + p + ' that no subject declares'); n++; }
  if (!n) ok('C7', 'taxonomy refs resolve both ways (' + nodes.size + ' nodes, ' +
                   problemTypes.size + ' problem types)');
}
{
  /* C8 — a subject cannot claim `supported` without a certifying checker.
     This is the .2 bug seen from the other side. */
  const certifying = new Set(m.kinds.filter((k) => k.authority !== 'advisory').map((k) => k.kind));
  const byName = new Map(m.checkers.map((c) => [c.checker, c]));
  let n = 0;
  for (const s of m.subjects) {
    if ((s.status || 'supported') !== 'supported') continue;
    const canCertify = (s.checkers || []).some((ck) =>
      ((byName.get(ck) || {}).emits || []).some((k) => certifying.has(k)));
    if (!canCertify) { bad('C8', 'subject ' + s.id + ' claims supported but no checker of its emits a certifying kind'); n++; }
  }
  if (!n) ok('C8', 'every supported subject has a certifying checker');
}

/* ---------- S1 / S2 — subject detection against the frozen .2 golden ---------- */
{
  const corpus = JSON.parse(fs.readFileSync(P('tools/subject-corpus.json'), 'utf8'));
  const script =
    'require ' + JSON.stringify(P('capability.php')) + ';' +
    '$c=json_decode(file_get_contents(' + JSON.stringify(P('tools/subject-corpus.json')) + '),true);' +
    '$o=[];foreach($c["questions"] as $q)$o[]=Capability::subjectOf($q);echo json_encode($o);';
  let got;
  try {
    got = JSON.parse(execFileSync(PHP, ['-r', script], { encoding: 'utf8' }));
  } catch (e) {
    bad('S1', 'could not run subjectOf through PHP: ' + String(e.message).slice(0, 120));
    got = null;
  }
  if (got) {
    const covered = new Set(m.subjects
      .filter((s) => (s.status || 'supported') === 'covered_not_verifiable').map((s) => s.id));
    let strict = 0, added = 0, broke = 0;
    corpus.questions.forEach((q, i) => {
      const was = corpus.expect[i], now = got[i];
      if (was !== null) {
        if (now === was) strict++;
        else { broke++; bad('S1', 'subject CHANGED for ' + JSON.stringify(q.slice(0, 46)) +
                            ': .2 said ' + was + ', now ' + now); }
      } else if (now === null) strict++;
      else if (covered.has(now)) added++;
      else { broke++; bad('S1', 'previously-unknown ' + JSON.stringify(q.slice(0, 46)) +
                          ' now resolves to ' + now + ', which is NOT covered_not_verifiable'); }
    });
    if (!broke) ok('S1', 'subject detection matches .2 on all ' + strict +
                         ' frozen answers (+' + added + ' newly covered, all Band D)');
  }
}
{
  /* S2 — none of the new states can reach certification. A covered subject
     must have no checker at all; if it had one, the state machine could
     produce `checked` for it and the whole distinction would collapse. */
  let n = 0;
  for (const s of m.subjects) {
    if ((s.status || 'supported') === 'supported') continue;
    if ((s.checkers || []).length) {
      bad('S2', 'non-supported subject ' + s.id + ' declares checkers — it could reach checked'); n++;
    }
  }
  if (!n) ok('S2', 'no covered_not_verifiable subject can reach certification');
}

/* ---------- report ---------- */
console.log('');
pass.forEach((p) => console.log(p));
if (fail.length) {
  console.log('');
  fail.forEach((f) => console.log(f));
  console.log('\n  CAPABILITY GATE FAILED — ' + fail.length + ' problem(s)\n');
  process.exit(1);
}
console.log('\n  capability gate OK — ' + pass.length + ' checks, nothing on disk disagrees with the manifest\n');
