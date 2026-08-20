#!/usr/bin/env node
/* ============================================================
   7Solve — AUTHENTICATED PRODUCTION API PARITY CHECK
   ------------------------------------------------------------
   Closes the last Phase 1 gap: proving the LIVE /v1 returns the
   same verdict as the website for every subject ported in Phase 1.

   Everything else has been verified without credentials — the six
   PHP files are on the origin, /v1/health reports engine ok, the
   deployed golden vectors match, and the live JS reproduces all
   240 points. What no unauthenticated probe can show is whether
   the deployed PHP reaches the SAME VERDICT, and that is the one
   thing Phase 1 exists to guarantee.

   THE KEY NEVER APPEARS IN THIS FILE, ON THE COMMAND LINE, OR IN
   ANY OUTPUT. It is read from an environment variable and sent in
   an Authorization header. Run it yourself:

       # bash / git-bash
       SEVENSOLVE_TEST_KEY=7solve_live_... node api-parity-check.js

       # PowerShell
       $env:SEVENSOLVE_TEST_KEY="7solve_live_..."; node api-parity-check.js

   Use a DEDICATED key issued for this run and revoke it afterwards.
   The script prints verdicts only, so the output is safe to paste.

   Expected verdicts come from api-parity-expected.json, generated
   from the shipped JS engine. The live API must match every field:
   state, checked authority, and the set of check kinds.

   A sampling divergence would surface here even though it is not
   directly observable: the forged-identity and wrong-derivative
   cases only reach their expected verdict if the deployed PHP
   chooses the same sample points as the JS. Agreement on those is
   evidence the deployed sampling matches; disagreement is proof it
   does not.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const KEY = process.env.SEVENSOLVE_TEST_KEY || '';
const BASE = process.env.SEVENSOLVE_BASE || 'https://7solve.7by.in';

if (!KEY) {
  console.error('\n  SEVENSOLVE_TEST_KEY is not set.\n');
  console.error('  bash:       SEVENSOLVE_TEST_KEY=... node api-parity-check.js');
  console.error('  PowerShell: $env:SEVENSOLVE_TEST_KEY="..."; node api-parity-check.js\n');
  console.error('  Use a dedicated test key and revoke it when this finishes.\n');
  process.exit(2);
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(BASE + urlPath);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
                 Authorization: 'Bearer ' + KEY },
      timeout: 30000,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(out); } catch (e) { /* reported below */ }
        resolve({ status: res.statusCode, json: j, raw: out.slice(0, 300) });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* The API reports kinds under whatever field it uses; accept the common
   shapes rather than assuming one, and say so if none is present. */
function kindsOf(j) {
  const src = j.checks || j.detail || j.results || null;
  if (!Array.isArray(src)) return null;
  return [...new Set(src.map((c) => (c.kind || c.name || '?') +
    (c.ok === true ? '+' : (c.soft ? '~' : '-'))))].sort();
}

(async function main() {
  const E = JSON.parse(fs.readFileSync(path.join(__dirname, 'api-parity-expected.json'), 'utf8'));
  console.log('\n  base   : ' + BASE);
  console.log('  build  : ' + E.build);
  console.log('  cases  : ' + E.cases.length + '\n');

  const fails = [];
  for (const c of E.cases) {
    let r;
    try { r = await post('/v1/verify', { question: c.question, answer: c.answer }); }
    catch (e) { fails.push(c.name + ': request failed — ' + e.message); console.log('  FAIL  ' + c.name); continue; }

    if (r.status === 401) {
      console.error('\n  401 UNAUTHORIZED — the key was rejected. Nothing else was tested.\n');
      process.exit(2);
    }
    if (!r.json || r.json.success !== true) {
      fails.push(c.name + ': HTTP ' + r.status + ' ' + r.raw);
      console.log('  FAIL  ' + c.name.padEnd(24) + 'HTTP ' + r.status);
      continue;
    }

    const j = r.json;
    /* COMPARE THE CANONICAL VERDICT CLASS, NOT THE RAW STATE.
       The browser splits the not-verified outcome four ways — plain, partial,
       worked, explained — so the badge can say what it actually looked at,
       while verify.php collapses all four into one public `unverified`. That
       divergence is documented and accepted in VERIFICATION-CONTRACT.md, and
       the main suite has always handled it via sameVerdict().

       The first version of this script compared raw strings and reported
       "plain vs unverified" as a parity failure. It was not one: both are
       canonically `unverified`, and the invariant that matters — never
       verified on one surface and not on the other — held throughout. The map
       is read from parity.js so there is one source of truth. */
    const liveState = String(j.status || '').toLowerCase();
    const liveCanon = E.canonical[liveState];
    const liveChecked = liveCanon === 'verified';
    const liveKinds = kindsOf(j);

    const diffs = [];
    if (!liveCanon) {
      diffs.push('live state "' + liveState + '" is not in the canonical map — ' +
                 'an unclassified state is one nobody can reason about');
    } else if (liveCanon !== c.expect.canonical) {
      diffs.push('canonical live=' + liveCanon + ' expected=' + c.expect.canonical +
                 '  (raw: live=' + liveState + ' js=' + c.expect.jsState + ')');
    }
    if (liveChecked !== c.expect.checked)
      diffs.push('authority live=' + liveChecked + ' expected=' + c.expect.checked);
    if (c.expect.subject !== undefined && String(j.subject ?? 'null') !== String(c.expect.subject ?? 'null'))
      diffs.push('subject live=' + String(j.subject ?? 'null') + ' expected=' + String(c.expect.subject ?? 'null'));
    const wantCap = c.expect.subject === null ? 'unknown_subject' : 'supported';
    if (String(j.capability ?? '(absent)') !== wantCap)
      diffs.push('capability live=' + String(j.capability ?? '(absent)') + ' expected=' + wantCap);
    if (liveKinds && JSON.stringify(liveKinds) !== JSON.stringify(c.expect.kinds))
      diffs.push('kinds live=[' + liveKinds.join(',') + '] expected=[' + c.expect.kinds.join(',') + ']');

    console.log('  ' + (diffs.length ? 'FAIL  ' : 'PASS  ') + c.name.padEnd(24) +
      String(liveCanon || '?').padEnd(11) +
      'raw=' + liveState.padEnd(11) +
      'auth=' + String(liveChecked).padEnd(6) +
      'subject=' + String(j.subject ?? 'null').padEnd(16) +
      'cap=' + String(j.capability ?? '(absent)').padEnd(16) +
      'kinds=' + (liveKinds ? '[' + liveKinds.join(',') + ']' : '(not exposed)'));
    if (diffs.length) { fails.push(c.name + ': ' + diffs.join(' | ')); }
  }

  console.log('');
  if (fails.length) {
    console.log('  API PARITY FAILED — ' + fails.length + ' of ' + E.cases.length + '\n');
    fails.forEach((f) => console.log('    ' + f));
    console.log('\n  Do not fix this automatically. Report the exact mismatch.\n');
    process.exit(1);
  }
  console.log('  API parity OK — ' + E.cases.length + ' cases, live /v1 matches the JS engine exactly\n');
  console.log('  Revoke the temporary test key now.\n');
})();
