#!/usr/bin/env node
/* ============================================================
   7Solve — LEGACY TAXONOMY SHADOW GATE  (migration step M2)
   ------------------------------------------------------------
   The dump produced by extract-legacy-taxonomy.js is only useful
   if it can REPLACE the literals without anyone noticing. This
   runs both against the same inputs and demands they agree.

   Nothing is switched over. The live tables in index.html are
   still the ones the app uses; this proves the data could take
   their place, which is the evidence the switch needs and does
   not itself perform.

   WHY THE SWITCH IS NOT IN THIS COMMIT. Detect feeds
   categorize() feeds planRoute() — it chooses the MODEL CHAIN a
   question is answered with. A regression there degrades answer
   quality silently, because no gate in this repo measures answer
   quality. So the data lands first, proven equivalent, and the
   consumer moves in a change that can be reviewed and reverted
   on its own.

   THREE THINGS ARE COMPARED:

     1. every PLACE rule, applied to text that triggers it —
        same course, same level, same winner when several match
     2. every course in every level — same list, same order
     3. every COURSE_SUBJECTS entry — same subjects, same order

   Order matters in all three. The picker renders these lists
   directly, so a reordering is a visible change even when the
   set is identical.

       node tools/gate-legacy-shadow.js

   Exit 0 = the dump can stand in for the literals.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const dump = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'legacy-taxonomy.json'), 'utf8'));

/* ---- the LIVE tables, read out of the shipping file ---- */
function literalAfter(marker, open, close) {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('marker not found: ' + marker);
  let i = html.indexOf(open, start), depth = 0, mode = null;
  const from = i;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
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
const ev = (src) => { const sb = {}; vm.createContext(sb); return vm.runInContext('(' + src + ')', sb, { timeout: 5000 }); };

const LIVE_LEVELS = ev(literalAfter('const LEVELS = [', '[', ']'));
const LIVE_CS     = ev(literalAfter('const COURSE_SUBJECTS = {', '{', '}'));
const LIVE_PLACE  = ev(literalAfter('const PLACE = [', '[', ']'));

/* ---- the SHADOW: the same behaviour, driven by the dump ---- */
const SHADOW_PLACE = dump.place.map((p) => ({
  re: new RegExp(p.pattern, p.flags), lv: p.level, c: p.course,
  w: p.weight === null ? undefined : p.weight,
}));

/* Detect's own resolution: first match wins for the course. Reproduced here
   rather than imported, because the point is to compare two independent
   readings of the same rules — importing the live one would compare it with
   itself. */
function resolve(place, text) {
  for (const p of place) if (p.re.test(text)) return { course: p.c, level: p.lv };
  return null;
}

/* Text that triggers each rule. A regex is not reversible in general, so the
   probe is built from the rule's own literal fragments — which is exactly the
   text a student would have typed to hit it. Rules whose probe cannot be built
   are reported, never skipped silently. */
function probeFor(re) {
  let s = re.source;
  s = s.replace(/\\b/g, ' ').replace(/\(\?:/g, '(');
  /* take the first branch of every alternation, then drop regex syntax */
  const firstBranch = (t) => {
    let out = '', depth = 0, taken = true;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '\\') { if (taken) out += t[i] + t[i + 1]; i++; continue; }
      if (c === '(') { depth++; if (taken) out += '('; continue; }
      if (c === ')') { depth--; if (taken) out += ')'; taken = true; continue; }
      if (c === '|' && depth === 0) { taken = false; continue; }
      if (c === '|' && depth > 0) { taken = false; continue; }
      if (taken) out += c;
    }
    return out;
  };
  s = firstBranch(s);
  /* A character class becomes a REPRESENTATIVE character, not nothing.
     Deleting it left "mht*cet" for \bmht[\s-]*cet\b and dropped the digit
     from appsc group ([1-4]), so three rules went unexercised — a small hole
     in the evidence, and the kind that is easy to shrug at. */
  s = s.replace(/\[([^\]]*)\]([*+?]?)/g, (whole, body, quant) => {
    if (quant === '*' || quant === '?') return '';          // optional → omit
    if (/\\s|\s/.test(body)) return ' ';
    const range = body.match(/([0-9a-zA-Z])-([0-9a-zA-Z])/);
    if (range) return range[1];                             // [1-4] → 1
    const first = body.replace(/^\^/, '').replace(/\\/g, '')[0];
    return first === undefined ? '' : first;
  });
  s = s.replace(/\\s\*/g, ' ').replace(/\\s\+/g, ' ').replace(/\\s/g, ' ')
       .replace(/\\d\+?/g, '1').replace(/\\w\+?/g, 'x')
       .replace(/[()?]/g, '')
       .replace(/\\\./g, '.').replace(/\\/g, '')
       .replace(/\s+/g, ' ').trim();
  return s;
}

const fails = [];
let probed = 0, unprobeable = 0;

/* ---- 1. rule-for-rule ---- */
dump.place.forEach((p, i) => {
  const live = LIVE_PLACE[i];
  if (!live) { fails.push('rule ' + i + ': missing from the live table'); return; }
  if (p.pattern !== live.re.source) fails.push('rule ' + i + ' (' + p.course + '): pattern differs');
  if (p.flags !== live.re.flags) fails.push('rule ' + i + ' (' + p.course + '): flags differ');
  if (p.course !== live.c) fails.push('rule ' + i + ': course ' + p.course + ' vs ' + live.c);
  if (p.level !== live.lv) fails.push('rule ' + i + ': level ' + p.level + ' vs ' + live.lv);

  const probe = probeFor(live.re);
  if (!probe || !live.re.test(probe)) { unprobeable++; return; }
  probed++;
  const a = resolve(LIVE_PLACE, probe);
  const b = resolve(SHADOW_PLACE, probe);
  if (JSON.stringify(a) !== JSON.stringify(b))
    fails.push('probe ' + JSON.stringify(probe.slice(0, 40)) + ': live=' + JSON.stringify(a) + ' shadow=' + JSON.stringify(b));
});
if (dump.place.length !== LIVE_PLACE.length)
  fails.push('rule count: dump ' + dump.place.length + ' vs live ' + LIVE_PLACE.length);

/* ---- 2. levels, courses, order ---- */
if (dump.levels.length !== LIVE_LEVELS.length)
  fails.push('level count: ' + dump.levels.length + ' vs ' + LIVE_LEVELS.length);
LIVE_LEVELS.forEach((l, i) => {
  const d = dump.levels[i];
  if (!d) { fails.push('level ' + l.id + ' missing'); return; }
  if (d.id !== l.id) fails.push('level ' + i + ': id ' + d.id + ' vs ' + l.id);
  if (JSON.stringify(d.courses) !== JSON.stringify(l.courses || []))
    fails.push('level ' + l.id + ': course list differs (order matters — the picker renders it)');
  if (JSON.stringify(d.subjects) !== JSON.stringify(l.subjects || []))
    fails.push('level ' + l.id + ': subject list differs');
});

/* ---- 3. per-course subjects ---- */
const liveKeys = Object.keys(LIVE_CS), dumpKeys = Object.keys(dump.course_subjects);
if (JSON.stringify(liveKeys) !== JSON.stringify(dumpKeys))
  fails.push('COURSE_SUBJECTS key set or order differs');
for (const k of liveKeys) {
  if (JSON.stringify(LIVE_CS[k]) !== JSON.stringify(dump.course_subjects[k]))
    fails.push('COURSE_SUBJECTS[' + JSON.stringify(k) + '] differs');
}

/* ---- report ---- */
console.log('');
console.log('  rules compared     : ' + dump.place.length);
console.log('  probes exercised   : ' + probed + '  (unprobeable: ' + unprobeable + ')');
console.log('  levels compared    : ' + dump.levels.length);
console.log('  courses compared   : ' + LIVE_LEVELS.reduce((n, l) => n + (l.courses || []).length, 0));
console.log('  subject sets       : ' + liveKeys.length);
console.log('');
if (fails.length) {
  console.log('  SHADOW GATE FAILED — ' + fails.length + ' difference(s)\n');
  fails.slice(0, 20).forEach((f) => console.log('    ' + f));
  if (fails.length > 20) console.log('    … and ' + (fails.length - 20) + ' more');
  console.log('');
  process.exit(1);
}
console.log('  shadow gate OK — the dump reproduces the live tables exactly');
console.log('  (nothing is switched over; this is the evidence, not the change)\n');
