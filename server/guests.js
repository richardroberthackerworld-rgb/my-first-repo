'use strict';

/**
 * Guest allowance — 10 credits before a Gmail sign-in is required.
 *
 * Two layers, because either alone is trivially defeated:
 *
 *   1. A signed guest token identifies a browser. Deleting it just gets you a
 *      new empty guest, so on its own it is worthless as a limit.
 *   2. A per-IP ledger caps total guest spend from one address per rolling day.
 *      This is what actually stops the refresh/clear-storage loop.
 *
 * Honest limitation: IP is not identity. Shared offices, campuses, mobile
 * carrier NAT and VPN hopping all blur it — several genuine users behind one
 * address share the cap, and a determined person with fresh IPs can still get
 * more. It raises the cost of casual abuse; it is not a hard wall. The real
 * wall is that anything beyond the allowance requires a Gmail account.
 */

const crypto = require('crypto');

const GUEST_CREDITS = 10;
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Total guest credits a single IP may consume per rolling day. */
const IP_DAILY_CAP = 30;

function ensureStore(db) {
  if (!db.guests) db.guests = {};
  if (!db.guestIPs) db.guestIPs = {};
  return db;
}

/** Hash the address — the ledger needs to compare, not to know who someone is. */
function hashIP(ip) {
  const salt = process.env.JWT_SECRET || 'guest-salt';
  return crypto.createHmac('sha256', salt).update(String(ip || 'unknown')).digest('hex').slice(0, 24);
}

function clientIP(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function newGuest(db) {
  ensureStore(db);
  const id = crypto.randomUUID();
  db.guests[id] = { id, used: 0, createdAt: Date.now() };
  return db.guests[id];
}

function getGuest(db, id) {
  ensureStore(db);
  return id ? db.guests[id] || null : null;
}

function remaining(guest) {
  if (!guest) return GUEST_CREDITS;
  return Math.max(0, GUEST_CREDITS - (guest.used || 0));
}

/** Current rolling-window usage for an address, pruning expired entries. */
function ipUsage(db, ip) {
  ensureStore(db);
  const key = hashIP(ip);
  const entry = db.guestIPs[key];
  if (!entry || Date.now() - entry.since > IP_WINDOW_MS) {
    db.guestIPs[key] = { since: Date.now(), used: 0 };
    return db.guestIPs[key];
  }
  return entry;
}

/**
 * Try to spend `amount` guest credits.
 * Returns { ok, remaining, reason } — never lets a balance go negative and
 * never partially spends.
 */
function spend(db, guest, ip, amount) {
  ensureStore(db);
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  if (!guest) return { ok: false, remaining: 0, reason: 'no-guest' };
  if (want === 0) return { ok: true, remaining: remaining(guest) };

  if (remaining(guest) < want) {
    return { ok: false, remaining: remaining(guest), reason: 'guest-exhausted' };
  }

  const ledger = ipUsage(db, ip);
  if (ledger.used + want > IP_DAILY_CAP) {
    return { ok: false, remaining: remaining(guest), reason: 'ip-capped' };
  }

  guest.used = (guest.used || 0) + want;
  ledger.used += want;
  return { ok: true, remaining: remaining(guest) };
}

/** Drop guest records older than a week so the store cannot grow forever. */
function prune(db) {
  ensureStore(db);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, guest] of Object.entries(db.guests)) {
    if ((guest.createdAt || 0) < cutoff) delete db.guests[id];
  }
  for (const [key, entry] of Object.entries(db.guestIPs)) {
    if ((entry.since || 0) < Date.now() - IP_WINDOW_MS) delete db.guestIPs[key];
  }
}

module.exports = { GUEST_CREDITS, IP_DAILY_CAP, newGuest, getGuest, remaining, spend, prune, clientIP, ensureStore };
