#!/usr/bin/env node
/* ============================================================
   7Solve — TAXONOMY CAPABILITY COVERAGE
   ------------------------------------------------------------
   The taxonomy has 1,695 nodes. Only the ones carrying
   `problem_types` can answer the question the whole tier exists
   to answer: "can 7Solve actually verify work in this subject?"
   Every other node returns capability `unknown`, which
   taxonomy.php words honestly as "Coverage is not capability."

   That ratio was nowhere on record. Nothing measured it and
   nothing stopped it from getting quietly worse — bulk-importing
   another 500 courses would grow the tree while shrinking the
   share of it that can say anything true, and every gate would
   stay green.

   This gate does three things:

     1. Reports the ratio, per shard, so the number is a fact
        rather than an impression.
     2. Pins a FLOOR on the count of capability-bearing nodes, so
        the tree can gain honesty but never lose it.
     3. Asserts the generated shards stay empty of problem_types.
        gen-legacy-taxonomy.js owns those files and does not emit
        capability; a hand-edit there would be silently destroyed
        on the next regeneration, so it must fail here instead.

       node tools/gate-taxonomy-capability.js

   Raising the floor is the point. Lowering it needs a reason in
   the commit message.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const TAX = path.join(HERE, 'taxonomy');

/* ---- the floor. Raise it when capability data is added. ---- */
const FLOOR = 31;

const idx = JSON.parse(fs.readFileSync(path.join(TAX, 'index.json'), 'utf8'));
const caps = JSON.parse(fs.readFileSync(path.join(HERE, 'capabilities.json'), 'utf8'));

/* every problem type the manifest knows, and whether it can certify */
const known = {};
for (const s of caps.subjects || []) {
  for (const t of s.problem_types || []) known[t] = s.status;
}

let nodes = (idx.nodes || []).map((n) => ({ n, shard: 'index.json' }));
for (const s of idx.shards) {
  const j = JSON.parse(fs.readFileSync(path.join(TAX, s), 'utf8'));
  for (const n of j.nodes || []) nodes.push({ n, shard: s });
}

const fails = [];
const perShard = {};
let bearing = 0;

for (const { n, shard } of nodes) {
  const row = (perShard[shard] = perShard[shard] || { n: 0, t: 0, generated: /legacy-/.test(shard) });
  row.n++;
  const types = n.problem_types || [];
  if (!types.length) continue;
  row.t++;
  bearing++;

  /* 3. generated shards must not carry capability */
  if (row.generated) {
    fails.push(shard + ' is GENERATED but node ' + n.id + ' carries problem_types — ' +
      'gen-legacy-taxonomy.js would destroy this on the next run; put it in a hand-authored shard');
  }
  /* every referenced type must exist in the manifest */
  for (const t of types) {
    if (!(t in known)) {
      fails.push(n.id + ' names problem type "' + t + '", which capabilities.json does not declare');
    }
  }
}

/* ---- report ---- */
const pct = (bearing / nodes.length * 100).toFixed(1);
console.log('');
console.log('  shard                          nodes    capability-bearing');
console.log('  ' + '-'.repeat(62));
Object.keys(perShard).sort().forEach((s) => {
  const r = perShard[s];
  console.log('    ' + s.padEnd(28) + String(r.n).padStart(5) + String(r.t).padStart(14) +
    (r.generated ? '   (generated)' : ''));
});
console.log('  ' + '-'.repeat(62));
console.log('    ' + 'TOTAL'.padEnd(28) + String(nodes.length).padStart(5) + String(bearing).padStart(14) +
  '   = ' + pct + '%');
console.log('');
console.log('  ' + (nodes.length - bearing) + ' nodes answer capability "unknown" — honestly, but they answer nothing else.');
console.log('  floor: ' + FLOOR + ' capability-bearing nodes required, ' + bearing + ' present');
console.log('');

if (bearing < FLOOR) {
  fails.push('capability-bearing nodes fell from ' + FLOOR + ' to ' + bearing +
    ' — the taxonomy got less able to answer for itself');
}

if (fails.length) {
  console.log('  TAXONOMY CAPABILITY GATE FAILED — ' + fails.length + '\n');
  fails.forEach((f) => console.log('    ' + f));
  console.log('');
  process.exit(1);
}
console.log('  taxonomy capability OK\n');
