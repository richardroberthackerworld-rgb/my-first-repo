/**
 * Checks the DNS that decides whether 7 Audio's email reaches an inbox.
 *
 *   node check-email-dns.mjs [domain]
 *
 * Run it before going live, and again after changing anything. It queries
 * public resolvers directly rather than the system one, so a local DNS cache
 * cannot show you a stale answer.
 *
 * Exit code is 0 when nothing is broken, 1 when something needs attention.
 */

import dns from 'node:dns/promises';
import crypto from 'node:crypto';

const DOMAIN = process.argv[2] || '7audio.7by.in';
const ORG = DOMAIN.split('.').slice(-2).join('.');
const SENDERS = ['noreply', 'welcome', 'thankyou', 'contact'];

dns.setServers(['1.1.1.1', '8.8.8.8']);

let problems = 0;
let warnings = 0;

/*
 * Anything missing is collected here and printed at the end as a record you can
 * paste straight into the DNS panel. Describing a fix in prose and leaving the
 * reader to assemble the value is where mistakes get made.
 */
const fixes = [];
const SUB = DOMAIN.replace('.' + ORG, '');

const ok = (m) => console.log('  \x1b[32mok\x1b[0m    ' + m);
const warn = (m) => { console.log('  \x1b[33mwarn\x1b[0m  ' + m); warnings++; };
const bad = (m) => { console.log('  \x1b[31mFAIL\x1b[0m  ' + m); problems++; };

const txt = async (name) => {
  try {
    return (await dns.resolveTxt(name)).map((a) => a.join(''));
  } catch {
    return null;
  }
};

console.log(`\nChecking email DNS for ${DOMAIN}\n`);

/* ------------------------------------------------------------------- A --- */
console.log('Host');
try {
  const a = await dns.resolve4(DOMAIN);
  ok(`${DOMAIN} resolves to ${a.join(', ')}`);
} catch {
  bad(`${DOMAIN} does not resolve — nothing else can work until it does`);
}

/* ----------------------------------------------------------------- SPF --- */
console.log('\nSPF');
{
  const records = (await txt(DOMAIN)) || [];
  const spf = records.filter((r) => r.toLowerCase().startsWith('v=spf1'));

  if (spf.length === 0) {
    bad('no SPF record — receiving servers cannot verify this domain sends mail');
  } else if (spf.length > 1) {
    bad(`${spf.length} SPF records — a domain may have only one, and having two invalidates both`);
  } else {
    ok('one SPF record: ' + spf[0]);

    // The 10-lookup limit is a hard rule; exceeding it makes SPF fail entirely.
    let lookups = 0;
    for (const _ of spf[0].matchAll(/\b(include|a|mx|ptr|exists)[:\s]/g)) lookups++;
    if (lookups > 10) bad(`${lookups} DNS-lookup mechanisms — over the limit of 10, SPF will fail`);
    else ok(`${lookups} DNS-lookup mechanisms (limit 10)`);

    for (const m of spf[0].matchAll(/include:(\S+)/g)) {
      const target = m[1];
      const inc = await txt(target);
      if (inc && inc.some((r) => r.toLowerCase().startsWith('v=spf1'))) ok(`include:${target} resolves`);
      else bad(`include:${target} does not resolve — this breaks SPF`);
    }

    if (/[~-]all\s*$/.test(spf[0])) ok('ends with ~all or -all');
    else warn('does not end with ~all or -all — an open ending offers little protection');
  }
}

/* ---------------------------------------------------------------- DKIM --- */
console.log('\nDKIM');
{
  const selectors = ['default', 'mail', 'dkim', 's1', 's2', 'x'];
  let found = 0;
  for (const sel of selectors) {
    const rec = await txt(`${sel}._domainkey.${DOMAIN}`);
    if (!rec) continue;
    found++;
    const value = rec.join('');
    const p = (value.match(/p=([A-Za-z0-9+/=]+)/) || [])[1];
    if (!p) {
      bad(`selector "${sel}" has no public key (p=) — the record is malformed`);
      continue;
    }
    try {
      const key = crypto.createPublicKey({
        key: Buffer.from('-----BEGIN PUBLIC KEY-----\n' + p.replace(/(.{64})/g, '$1\n') + '\n-----END PUBLIC KEY-----'),
        format: 'pem',
      });
      const bits = key.asymmetricKeyDetails.modulusLength;
      if (bits < 1024) bad(`selector "${sel}": ${bits}-bit key is too weak`);
      else ok(`selector "${sel}": valid ${bits}-bit key`);
    } catch (e) {
      bad(`selector "${sel}": public key does not parse — ${e.message}`);
    }
  }
  if (!found) bad('no DKIM record found on any common selector — mail will be unsigned');
}

/* --------------------------------------------------------------- DMARC --- */
console.log('\nDMARC');
{
  const own = await txt(`_dmarc.${DOMAIN}`);
  const org = await txt(`_dmarc.${ORG}`);

  if (own) {
    const v = own.join('');
    ok(`own record: ${v}`);
    if (!/rua=/.test(v)) warn('no rua= — no aggregate reports will be sent, so you learn nothing');
    const policy = (v.match(/p=(\w+)/) || [])[1];
    if (policy === 'none') ok('policy p=none (monitoring — correct while starting out)');
    else ok(`policy p=${policy}`);
  } else if (org) {
    const v = org.join('');
    const sp = (v.match(/sp=(\w+)/) || [])[1];
    const p = (v.match(/p=(\w+)/) || [])[1];
    warn(`no record at _dmarc.${DOMAIN}; inheriting from ${ORG}: "${v}"`);
    fixes.push({
      type: 'TXT',
      name: `_dmarc.${SUB}`,
      value: `v=DMARC1; p=none; rua=mailto:contact@${DOMAIN}; fo=1; adkim=r; aspf=r`,
      why: 'so DMARC aggregate reports are actually delivered somewhere',
    });
    console.log(`        subdomains therefore get p=${sp || p || 'none'}`);
    if (!/rua=/.test(v)) warn(`${ORG} has no rua= either — nobody is receiving DMARC reports for any domain`);
  } else {
    bad(`no DMARC at _dmarc.${DOMAIN} and none at _dmarc.${ORG}`);
    fixes.push({
      type: 'TXT',
      name: `_dmarc.${SUB}`,
      value: `v=DMARC1; p=none; rua=mailto:contact@${DOMAIN}; fo=1; adkim=r; aspf=r`,
      why: 'no DMARC policy exists at all',
    });
  }
}

/* ------------------------------------------------------------------ MX --- */
console.log('\nMX (for replies to contact@)');
{
  try {
    const mx = await dns.resolveMx(DOMAIN);
    ok('MX: ' + mx.map((m) => `${m.exchange} (${m.priority})`).join(', '));
  } catch {
    try {
      const a = await dns.resolve4(DOMAIN);
      warn(`no MX record — mail falls back to the A record (${a[0]}) by the implicit-MX rule`);
      console.log('        that usually works, but an explicit MX is clearer and safer');

      // Match whatever the organisational domain already uses, rather than
      // guessing a hostname.
      let exchange = ORG;
      try {
        const orgMx = await dns.resolveMx(ORG);
        if (orgMx.length) {
          exchange = orgMx.sort((x, y) => x.priority - y.priority)[0].exchange;
          console.log(`        ${ORG} uses "${exchange}" — matching it below`);
        }
      } catch { /* fall back to the org domain itself */ }

      fixes.push({
        type: 'MX',
        name: SUB,
        value: exchange,
        priority: 0,
        why: 'so replies to contact@ are delivered explicitly rather than by fallback',
      });
    } catch {
      bad('no MX and no A record — mail to this domain cannot be delivered');
    }
  }
}

/* --------------------------------------------------------------- notes --- */
console.log('\nMailboxes (cannot be checked from here)');
console.log('  These four must exist on the mail host, and contact@ must be read by a person:');
for (const s of SENDERS) console.log(`    ${s}@${DOMAIN}`);
console.log('\n  To verify acceptance, run this ON the server (port 25 is blocked from most ISPs):');
console.log(`    printf 'EHLO t\\r\\nMAIL FROM:<>\\r\\nRCPT TO:<contact@${DOMAIN}>\\r\\nQUIT\\r\\n' | nc localhost 25`);
console.log('  A 250 on the RCPT line means the server accepts mail for the domain.');

/* ---------------------------------------------------------------- fix --- */
if (fixes.length) {
  console.log('\n' + '─'.repeat(64));
  console.log('RECORDS TO ADD');
  console.log('─'.repeat(64));
  console.log('cPanel → Zone Editor → Manage (for ' + ORG + ') → Add Record\n');
  for (const f of fixes) {
    console.log('  Type      ' + f.type);
    console.log('  Name      ' + f.name);
    if (f.priority !== undefined) console.log('  Priority  ' + f.priority);
    console.log('  TTL       14400  (or leave the default)');
    console.log('  Value     ' + f.value);
    console.log('  Why       ' + f.why);
    console.log('');
  }
  console.log('Some panels want the name fully qualified. If "' + fixes[0].name + '" is');
  console.log('rejected, try "' + fixes[0].name + '.' + ORG + '." — with the trailing dot.');
  console.log('\nRe-run this script after saving. Propagation is usually minutes.');
}

/* ------------------------------------------------------------- summary --- */
console.log('');
if (problems) console.log(`\x1b[31m${problems} problem(s)\x1b[0m` + (warnings ? `, ${warnings} warning(s)` : ''));
else if (warnings) console.log(`\x1b[33mno problems, ${warnings} warning(s)\x1b[0m`);
else console.log('\x1b[32meverything checks out\x1b[0m');

process.exit(problems ? 1 : 0);
