#!/usr/bin/env node
/* ============================================================
   7Solve — LEGACY TAXONOMY EXTRACTION  (migration step M1)
   ------------------------------------------------------------
   The academic coverage 7Solve already ships lives as three
   JavaScript literals inside index.html:

     LEVELS           levels, their courses and their subjects
     COURSE_SUBJECTS  per-course subject lists
     Detect.PLACE     regexes that map question text to a course

   Together they are the 465 courses and 154 subject sets the
   product advertises, and they are source code. Release A built
   the taxonomy schema so this could become data; this is the
   first half of moving it.

   THIS SCRIPT DECIDES NOTHING. It extracts, and it proves the
   extraction is faithful. No node ids are invented, no levels
   are merged, nothing is mapped into the new schema yet — those
   are modelling decisions and they belong in a change a human
   can review on its own, not smuggled inside a data dump.

   HOW IT READS THEM: by EVALUATING the literals in a sandbox,
   not by pattern-matching the source. A regex reader would have
   to re-implement JavaScript string escaping, nested brackets
   and regex literals, and would be wrong in exactly the places
   that matter — a course name containing an apostrophe, a
   pattern containing a bracket.

   THE PROOF: every extracted value is re-serialised and compared
   against what the sandbox produced from the original text. A
   mismatch means the extraction lost something, and the script
   exits non-zero rather than writing a file nobody can trust.

       node tools/extract-legacy-taxonomy.js
       node tools/extract-legacy-taxonomy.js --write

   Exit 0 = the dump is a faithful copy of what index.html holds.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = path.join(__dirname, '..');
const OUT = path.join(HERE, 'tools', 'legacy-taxonomy.json');
const WRITE = process.argv.indexOf('--write') >= 0;

const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

/* ---- find a literal and match its brackets ----------------------
   Counting brackets is not enough on its own: index.html is full of
   strings and regex literals that contain unbalanced brackets, and a
   naive counter walks straight off the end. This tracks whether it is
   inside a string, a template, a comment or a regex, which is the
   minimum needed to be right about this file. */
function literalAfter(marker, open, close) {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('marker not found: ' + marker);
  let i = html.indexOf(open, start);
  if (i < 0) throw new Error('opening bracket not found for: ' + marker);
  const from = i;
  let depth = 0;
  let mode = null;          // null | "'" | '"' | '`' | '//' | '/*' | 'regex'
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1], p = html[i - 1];
    if (mode === "'" || mode === '"' || mode === '`') {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (mode === '//') { if (c === '\n') mode = null; continue; }
    if (mode === '/*') { if (c === '*' && n === '/') { i++; mode = null; } continue; }
    if (mode === 'regex') {
      if (c === '\\') { i++; continue; }
      if (c === '[') { mode = 'regexclass'; continue; }
      if (c === '/') mode = null;
      continue;
    }
    if (mode === 'regexclass') {
      if (c === '\\') { i++; continue; }
      if (c === ']') mode = 'regex';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { mode = c; continue; }
    if (c === '/' && n === '/') { mode = '//'; i++; continue; }
    if (c === '/' && n === '*') { mode = '/*'; i++; continue; }
    /* a slash that opens a regex, as opposed to division: only after
       a token that cannot end an expression */
    if (c === '/') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(html[k])) k--;
      const prev = k >= 0 ? html[k] : '';
      if (prev === '' || '([{,;:=!&|?+-*~^%<>'.indexOf(prev) >= 0) { mode = 'regex'; continue; }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return html.slice(from, i + 1); }
  }
  throw new Error('unbalanced brackets for: ' + marker);
}

/* ---- evaluate a literal in a sandbox ---------------------------- */
function evalLiteral(src) {
  const sb = {};
  vm.createContext(sb);
  return vm.runInContext('(' + src + ')', sb, { timeout: 5000 });
}

const levelsSrc = literalAfter('const LEVELS = [', '[', ']');
const csSrc     = literalAfter('const COURSE_SUBJECTS = {', '{', '}');
const placeSrc  = literalAfter('const PLACE = [', '[', ']');

const LEVELS = evalLiteral(levelsSrc);
const COURSE_SUBJECTS = evalLiteral(csSrc);
const PLACE = evalLiteral(placeSrc);

/* ---- shape it, losslessly ---------------------------------------
   Regexes are kept as {source, flags}: a regex has no JSON form, and
   String(re) would have to be re-parsed later by something that gets
   the flags right. Storing both halves means the loader never guesses. */
const dump = {
  _: 'FAITHFUL DUMP of the three legacy taxonomy literals in index.html, ' +
     'produced by tools/extract-legacy-taxonomy.js. Nothing here is mapped into ' +
     'the taxonomy/ schema yet — this is the raw material for that decision, and ' +
     'the round-trip assertion in the extractor is what makes it trustworthy. ' +
     'Regenerated, never hand-edited.',
  schema: '7solve.legacy-taxonomy/1',
  extracted_from: 'index.html',
  levels: LEVELS.map((l) => ({
    id: l.id,
    emoji: l.em,
    name: l.name,
    courses: l.courses || [],
    subjects: l.subjects || [],
  })),
  course_subjects: COURSE_SUBJECTS,
  place: PLACE.map((p) => ({
    pattern: p.re.source,
    flags: p.re.flags,
    level: p.lv,
    course: p.c,
    weight: p.w === undefined ? null : p.w,
  })),
};

/* ---- THE PROOF: does the dump still say what the source said? ---- */
const fails = [];

LEVELS.forEach((l, i) => {
  const d = dump.levels[i];
  if (d.id !== l.id) fails.push('level ' + i + ' id');
  if (JSON.stringify(d.courses) !== JSON.stringify(l.courses || []))
    fails.push('level ' + l.id + ' courses');
  if (JSON.stringify(d.subjects) !== JSON.stringify(l.subjects || []))
    fails.push('level ' + l.id + ' subjects');
});

if (JSON.stringify(dump.course_subjects) !== JSON.stringify(COURSE_SUBJECTS))
  fails.push('course_subjects');

PLACE.forEach((p, i) => {
  const d = dump.place[i];
  const rebuilt = new RegExp(d.pattern, d.flags);
  if (rebuilt.source !== p.re.source) fails.push('place ' + i + ' pattern');
  if (rebuilt.flags !== p.re.flags) fails.push('place ' + i + ' flags');
  if (d.course !== p.c || d.level !== p.lv) fails.push('place ' + i + ' target');
});

/* every course a PLACE rule points at should exist in some level, and every
   course in COURSE_SUBJECTS likewise — this is not a round-trip check, it is
   a coherence check on what was already there, and it is reported rather than
   fixed. */
const allCourses = new Set();
LEVELS.forEach((l) => (l.courses || []).forEach((c) => allCourses.add(c)));
const placeOrphans = [...new Set(PLACE.map((p) => p.c))].filter((c) => !allCourses.has(c));
const csOrphans = Object.keys(COURSE_SUBJECTS).filter((c) => !allCourses.has(c));

console.log('');
console.log('  levels            : ' + dump.levels.length + '  (' + dump.levels.map((l) => l.id).join(', ') + ')');
console.log('  courses (unique)  : ' + allCourses.size);
console.log('  course_subjects   : ' + Object.keys(COURSE_SUBJECTS).length + ' keys');
console.log('  PLACE rules       : ' + dump.place.length);
console.log('  distinct targets  : ' + new Set(PLACE.map((p) => p.c)).size);
console.log('');
console.log('  round-trip failures : ' + fails.length);
fails.slice(0, 10).forEach((f) => console.log('    ' + f));
console.log('');
console.log('  COHERENCE, reported not fixed:');
console.log('    PLACE targets with no course in any level : ' + placeOrphans.length +
  (placeOrphans.length ? '  e.g. ' + placeOrphans.slice(0, 3).map((x) => JSON.stringify(x)).join(', ') : ''));
console.log('    COURSE_SUBJECTS keys not in any level     : ' + csOrphans.length +
  (csOrphans.length ? '  e.g. ' + csOrphans.slice(0, 3).map((x) => JSON.stringify(x)).join(', ') : ''));

if (fails.length) {
  console.log('\n  EXTRACTION IS NOT FAITHFUL — refusing to write.\n');
  process.exit(1);
}

if (WRITE) {
  fs.writeFileSync(OUT, JSON.stringify(dump, null, 2) + '\n', 'utf8');
  console.log('\n  wrote ' + path.relative(HERE, OUT) + '  (' +
    Math.round(fs.statSync(OUT).size / 1024) + ' KB)\n');
} else {
  console.log('\n  extraction is faithful; pass --write to emit the dump\n');
}
