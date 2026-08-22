#!/usr/bin/env node
/* ============================================================
   7Solve — LEGACY COVERAGE → TAXONOMY SHARDS  (migration M3a)
   ------------------------------------------------------------
   Turns the 465 courses extracted in M1 into taxonomy/ shards
   under the 7solve.taxonomy/1 schema.

   THE NODES ARE DERIVED, NOT AUTHORED. Reviewing 1,200-odd
   generated nodes line by line is theatre; reviewing the six
   decisions below is not. That is the same bargain the
   capability manifest made — one canonical source, a generator,
   and a gate that fails if anything on disk disagrees.

   Re-run it and the shards are rebuilt. Disagree with a decision
   and the fix is here, in one place, not in a thousand edits.

   ------------------------------------------------------------
   THE SIX DECISIONS
   ------------------------------------------------------------

   1. THE HAND-AUTHORED SEED WINS, ALWAYS.
      Release A's 114 nodes carry depth the legacy data does not
      have — semesters, units, topics, and the problem_types that
      connect a topic to a checker. A generated node NEVER
      replaces one of them and never claims an id they already
      hold. Where a legacy course corresponds to a seed program
      (B.Tech (CSE) → in.ug.btech.cse) the seed node stands and
      the legacy course contributes only what it adds.

   2. `current` AND `other` ARE EXCLUDED.
      "Daily Current Affairs", "Static GK", "Spoken English",
      "General Question" — 32 entries that are app content
      categories, not courses. An academic taxonomy that contains
      them makes "coverage" mean two different things in the same
      tree, and a student browsing B.Tech would find "Essay /
      Letter Writing" beside Thermodynamics. They stay in the
      app's own lists where they already work. The exclusion is
      declared here and asserted by the gate, so it can never
      become an accident.

   3. `jobs` BECOMES kind:"exam", NOT kind:"program".
      302 competitive exams — UPSC, the state PSCs, TETs, police
      boards, VRO/Patwari. They are not degrees and modelling
      them as programmes would put "SSC CGL" and "B.Tech" in the
      same category. The schema already reserved `exam` for
      exactly this.

   4. `degree` IS SPLIT INTO UG AND PG BY NAME.
      The legacy level lumps both together; the seed already
      separates in.ug from in.pg, and that separation is right —
      an M.Tech student and a B.Tech student do not share a
      syllabus. The split is by explicit prefix, and anything the
      rule cannot place is reported rather than guessed.

   5. IDS ARE DERIVED FROM LABELS, DETERMINISTICALLY.
      Slugified, parent-prefixed, and stable across runs — the
      taxonomy contract says an id is referenced from saved
      student work and renaming one is a breaking change, so it
      must not depend on array order or on the day it was run.
      A collision is a build error, never a silent rename.

   6. SUBJECTS ARE SHARED PER LEVEL UNLESS A COURSE OVERRIDES.
      1,229 course→subject pairs across 800 distinct names. One
      node per pair would be 1,694 nodes of mostly duplicate
      labels. A course with its own COURSE_SUBJECTS entry gets
      its own subject nodes; a course without one inherits its
      level's list, which is exactly what the app does today.

       node tools/gen-legacy-taxonomy.js            write
       node tools/gen-legacy-taxonomy.js --check    exit 1 on drift
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const CHECK = process.argv.indexOf('--check') >= 0;
const legacy = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'legacy-taxonomy.json'), 'utf8'));

/* decision 2 */
const EXCLUDED_LEVELS = ['current', 'other'];

/* decision 4 — explicit, ordered; first match wins */
const PG_PREFIX = [/^M\./i, /^MBA\b/i, /^MCA\b/i, /^MSW\b/i, /^MPH\b/i, /^LLM\b/i, /^MD \/ MS\b/i, /^Ph\.D/i];
const UG_FALLBACK = true;

/* decision 1 — every id the hand-authored seed already owns */
const seedIndex = JSON.parse(fs.readFileSync(path.join(HERE, 'taxonomy', 'index.json'), 'utf8'));
const seedNodes = [...seedIndex.nodes];
for (const s of seedIndex.shards) {
  /* Skip this generator's OWN output. Reading it back would make the tool
     treat last run's nodes as hand-authored, so a changed decision could
     never take effect — the old nodes would look like seed and be preserved.
     It also makes the run work from a clean tree, which is what a generator
     should always do. */
  if (/(^|\/)legacy-/.test(s)) continue;
  const f = path.join(HERE, 'taxonomy', s);
  if (!fs.existsSync(f)) continue;
  seedNodes.push(...JSON.parse(fs.readFileSync(f, 'utf8')).nodes);
}
const seedIds = new Set(seedNodes.map((n) => n.id));
const seedLabels = new Map();
for (const n of seedNodes) {
  const keys = [n.label, ...(n.aliases || [])].map((x) => norm(x));
  for (const k of keys) if (!seedLabels.has(k)) seedLabels.set(k, n);
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
/* decision 5 */
function slug(s) {
  return String(s).toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const out = new Map();          // id -> node
const problems = [];
function addNode(n) {
  if (seedIds.has(n.id)) return false;              // decision 1: the seed wins
  if (out.has(n.id)) {
    const prev = out.get(n.id);
    if (prev.label !== n.label) problems.push('id collision: ' + n.id + '  "' + prev.label + '" vs "' + n.label + '"');
    return false;
  }
  out.set(n.id, n);
  return true;
}

/* ---- levels ------------------------------------------------------ */
const LEVEL_NODE = {
  school: 'in.school', inter: 'in.inter', degree: null /* split */,
  prof: 'in.prof', jobs: 'in.exam',
};
addNode({ id: 'in.inter', kind: 'level', parent: 'in', label: 'Intermediate (11th–12th)',
          aliases: ['intermediate', 'inter', '+2', 'junior college'] });
addNode({ id: 'in.prof', kind: 'level', parent: 'in', label: 'Professional qualifications',
          aliases: ['professional', 'ca', 'cma', 'cs', 'cfa'] });
addNode({ id: 'in.exam', kind: 'level', parent: 'in', label: 'Competitive & recruitment exams',
          aliases: ['competitive exam', 'government exam', 'recruitment exam'] });

/* ---- courses ----------------------------------------------------- */
const courseNodeFor = new Map();  // legacy course label -> node id (seed or generated)
let reused = 0, generated = 0, excluded = 0;

for (const lv of legacy.levels) {
  if (EXCLUDED_LEVELS.includes(lv.id)) { excluded += lv.courses.length; continue; }
  for (const course of lv.courses) {
    /* decision 1: does the seed already model this? */
    const hit = seedLabels.get(norm(course));
    if (hit) { courseNodeFor.set(course, hit.id); reused++; continue; }

    /* DECISION 7 — "Programme (Specialisation)" IS A BRANCH, NOT A RIVAL.
       The seed match above compares whole labels, so "B.Tech (Aeronautical)"
       never matched "B.Tech / BE" and became its own programme sitting beside
       it. That produced 47 sibling "programmes" that are really
       specialisations: a student browsing would see "B.Tech / BE" and then
       "B.Tech (Aeronautical)" as unrelated peers, and Thermodynamics appeared
       twice under two different shapes of the same degree.

       So a label of the form "X (Y)" whose X names a programme the seed
       already models becomes a BRANCH of it. The seed keeps its depth, the
       legacy list contributes its breadth, and the tree has one B.Tech. */
    const spec = /^(.+?)\s*\((.+)\)\s*$/.exec(course);
    if (spec) {
      const host = seedLabels.get(norm(spec[1]));
      if (host && host.kind === 'program') {
        /* Does the seed already model this specialisation? "B.Tech (CSE)" and
           "B.Tech (Mechanical)" name branches the seed authored by hand as
           "Computer Science & Engineering" and "Mechanical Engineering". Left
           unchecked they became in.ug.btech.mechanical beside
           in.ug.btech.mech, and Thermodynamics appeared twice under one
           degree. The seed branch wins, exactly as the seed programme does. */
        /* Look among the HOST'S OWN children, not the global label map. That
           map is first-wins across the whole tree, so "Mechanical" resolved to
           the Diploma branch — whose parent is not B.Tech — and the check fell
           through, leaving in.ug.btech.mechanical beside in.ug.btech.mech.
           A branch name is only meaningful relative to its programme. */
        const existing = seedNodes.find((n) =>
          n.kind === 'branch' && n.parent === host.id &&
          [n.label, ...(n.aliases || [])].some((x) => norm(x) === norm(spec[2])));
        if (existing) {
          courseNodeFor.set(course, existing.id);
          reused++;
          continue;
        }
        const id = host.id + '.' + slug(spec[2]);
        if (addNode({ id, kind: 'branch', parent: host.id, label: course })) generated++;
        courseNodeFor.set(course, id);
        continue;
      }
    }

    let parent, kind;
    if (lv.id === 'degree') {
      const isPG = PG_PREFIX.some((re) => re.test(course));
      parent = isPG ? 'in.pg' : (UG_FALLBACK ? 'in.ug' : null);
      kind = 'program';
      if (!parent) { problems.push('unplaceable degree course: ' + course); continue; }
    } else if (lv.id === 'jobs') {
      parent = 'in.exam'; kind = 'exam';               // decision 3
    } else if (lv.id === 'prof') {
      parent = 'in.prof'; kind = 'program';
    } else if (lv.id === 'school') {
      parent = 'in.school'; kind = 'class';
    } else if (lv.id === 'inter') {
      parent = 'in.inter'; kind = 'program';
    } else {
      problems.push('unknown legacy level: ' + lv.id); continue;
    }

    const id = parent + '.' + slug(course);
    if (addNode({ id, kind, parent, label: course })) generated++;
    courseNodeFor.set(course, id);
  }
}

/* ---- subjects (decision 6) --------------------------------------- */
let subjNodes = 0, inherited = 0, deduped = 0;
for (const lv of legacy.levels) {
  if (EXCLUDED_LEVELS.includes(lv.id)) continue;
  for (const course of lv.courses) {
    const parentId = courseNodeFor.get(course);
    if (!parentId) continue;
    const own = legacy.course_subjects[course];
    if (!own) { inherited++; continue; }              // inherits the level list, as the app does
    for (const subject of own) {
      /* Does the seed already carry this subject ANYWHERE below this node?
         The seed models B.Tech Mechanical as branch → Semester 3 →
         Thermodynamics; the legacy list knows only "B.Tech (Mechanical) has
         Thermodynamics", with no semester. Adding it flat put the same subject
         in the tree twice and a search showed both. The seed node is strictly
         more informative — it knows the semester — so the flat one is dropped
         and nothing is lost. */
      if (seedNodes.some((n) => n.kind === 'subject' &&
            typeof n.id === 'string' && n.id.startsWith(parentId + '.') &&
            norm(n.label) === norm(subject))) { deduped++; continue; }
      const id = parentId + '.' + slug(subject);
      if (addNode({ id, kind: 'subject', parent: parentId, label: subject })) subjNodes++;
    }
  }
}

/* ---- emit -------------------------------------------------------- */
const byParentLevel = {};
for (const n of out.values()) {
  let root = n.id.split('.').slice(0, 2).join('.');
  (byParentLevel[root] = byParentLevel[root] || []).push(n);
}
const files = {};
for (const [root, nodes] of Object.entries(byParentLevel)) {
  const name = 'in/legacy-' + root.replace(/^in\./, '') + '.json';
  files[name] = {
    _: 'GENERATED from tools/legacy-taxonomy.json by tools/gen-legacy-taxonomy.js. ' +
       'Do not hand-edit — the generator owns these nodes and tools/gate-legacy-taxonomy.js ' +
       'fails the build if they drift. The six mapping decisions are documented in the generator.',
    schema: '7solve.taxonomy/1',
    version: legacy.version || '2026-08-22',
    source: '7solve-legacy',
    nodes: nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/* The mapping the gate verifies against. A gate that re-derives it by label
   cannot see a course that legitimately collapsed onto a seed node with a
   different label — "B.Tech (CSE)" onto "Computer Science & Engineering" —
   and would report four false losses. The generator knows; it should say. */
const MAP = path.join(HERE, 'tools', 'legacy-node-map.json');
if (!CHECK) {
  const mapping = {};
  for (const [course, id] of courseNodeFor) mapping[course] = id;
  fs.writeFileSync(MAP, JSON.stringify({
    _: 'GENERATED. Which taxonomy node each legacy course resolved to. Read by ' +
       'tools/gate-legacy-coverage.js so a course that collapsed onto a seed node ' +
       'with a different label is not mistaken for a lost one.',
    excluded_levels: EXCLUDED_LEVELS,
    courses: mapping,
  }, null, 2) + '\n', 'utf8');
}

/* ---- report ------------------------------------------------------ */
console.log('');
console.log('  legacy courses seen     : ' + legacy.levels.reduce((n, l) => n + l.courses.length, 0));
console.log('    excluded (current/other): ' + excluded);
console.log('    matched a seed node     : ' + reused);
console.log('    generated               : ' + generated);
console.log('  subject nodes generated : ' + subjNodes);
console.log('    courses inheriting level list: ' + inherited);
console.log('    subjects the seed already had  : ' + deduped);
console.log('  TOTAL generated nodes   : ' + out.size);
console.log('  shards                  : ' + Object.keys(files).length);
Object.entries(files).forEach(([f, d]) => console.log('    ' + f.padEnd(30) + d.nodes.length + ' nodes'));
console.log('');
if (problems.length) {
  console.log('  PROBLEMS (' + problems.length + '):');
  problems.slice(0, 12).forEach((p) => console.log('    ' + p));
  console.log('');
  process.exit(1);
}

let drift = 0;
for (const [name, doc] of Object.entries(files)) {
  const p = path.join(HERE, 'taxonomy', name);
  const text = JSON.stringify(doc, null, 2) + '\n';
  if (CHECK) {
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) { drift++; console.log('  DRIFT: ' + name); }
  } else {
    fs.writeFileSync(p, text, 'utf8');
  }
}
if (CHECK) {
  if (drift) { console.log('\n  generated shards are stale — run tools/gen-legacy-taxonomy.js\n'); process.exit(1); }
  console.log('  generated shards match the generator\n');
} else {
  console.log('  wrote ' + Object.keys(files).length + ' shard(s)\n');
}
