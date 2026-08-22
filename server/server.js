/**
 * 7By.in backend
 * - Email OTP sign-up / password reset (nodemailer, from noreply@7by.in)
 * - Password login (bcrypt) + Google Sign-In (google-auth-library)
 * - JWT sessions
 * - Server-authoritative credits
 * - Razorpay: create order + verify payment signature, then credit the account
 *
 * Storage: a simple JSON file (server/db.json). Swap for Postgres/Mongo in production.
 */
'use strict';
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Log startup crashes clearly instead of a silent 503.
process.on('uncaughtException', e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

const cashfree = require('./cashfree');
const audioPlans = require('./audio-plans');
const guests = require('./guests');
const audioMail = require('./audio-mail');

const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const DAILY_FREE = 20;                 // free credits granted each day
const OTP_TTL_MS = 10 * 60 * 1000;     // 10 minutes

const PLANS = {
  monthly: { amount: +(process.env.PLAN_MONTHLY_AMOUNT || 4700), credits: +(process.env.PLAN_MONTHLY_CREDITS || 1000), name: '7By Monthly — 1,000 credits' },
  annual:  { amount: +(process.env.PLAN_ANNUAL_AMOUNT  || 49900), credits: +(process.env.PLAN_ANNUAL_CREDITS  || 20000), name: '7By Annual — 20,000 credits' }
};

/* ----------------------------- tiny JSON store ----------------------------- */
const DB_PATH = path.join(__dirname, 'db.json');
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [], otps: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
let db = loadDB();
function persist() { saveDB(db); }
function findUser(email) { return db.users.find(u => u.email === String(email || '').toLowerCase()); }
// Only real @gmail.com addresses are accepted for signup/reset — blocks disposable/tempmail domains.
function isGmail(email) { return /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(String(email || '').trim()); }

/* ------------------------------- email (OTP) ------------------------------- */
// Lazily create the mail transporter so a missing/partial nodemailer install can't crash boot.
let transporter = null, _mailTried = false;
function getTransporter() {
  if (_mailTried) return transporter;
  _mailTried = true;
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    try {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: +(process.env.SMTP_PORT || 587),
        secure: +(process.env.SMTP_PORT || 587) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    } catch (e) { console.error('[mail] nodemailer unavailable:', e.message); }
  }
  return transporter;
}
function otpEmailHTML(otp, purpose) {
  const support = process.env.SUPPORT_EMAIL || 'contact@7by.in';
  // Public URL of your logo PNG (must be hosted — email clients can't load local files).
  const logo = process.env.LOGO_URL || 'https://7by.in/assets/favicon.png';
  const heading = purpose === 'reset' ? 'Reset your password' : 'Verify your email';
  const intro = purpose === 'reset'
    ? 'Use this code to reset your 7By.in password.'
    : 'Welcome to 7By.in! Use this code to finish creating your account.';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#06080f;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06080f;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0f0f1a;border:1px solid rgba(255,255,255,.08);border-radius:20px;overflow:hidden;">
        <!-- header -->
        <tr><td style="padding:28px 32px 8px 32px;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td><img src="${logo}" width="40" height="40" alt="7By.in" style="display:block;width:40px;height:40px;border-radius:10px;"></td>
            <td style="padding-left:12px;color:#F0F0F8;font-size:20px;font-weight:bold;">7By.in</td>
          </tr></table>
        </td></tr>
        <!-- body -->
        <tr><td style="padding:20px 32px 8px 32px;" align="center">
          <h1 style="margin:0 0 8px 0;color:#F0F0F8;font-size:22px;">${heading}</h1>
          <p style="margin:0 0 22px 0;color:#9aa0b4;font-size:14px;line-height:1.6;">${intro}</p>
        </td></tr>
        <!-- code -->
        <tr><td style="padding:0 32px;" align="center">
          <div style="display:inline-block;background:#141428;border:1px solid rgba(0,212,255,.35);border-radius:14px;padding:18px 28px;">
            <span style="font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:#00D4FF;">${otp}</span>
          </div>
          <p style="margin:16px 0 0 0;color:#6a7086;font-size:12px;">This code expires in <strong style="color:#F0F0F8;">10 minutes</strong>.</p>
        </td></tr>
        <!-- footer -->
        <tr><td style="padding:26px 32px 30px 32px;" align="center">
          <p style="margin:0 0 6px 0;color:#6a7086;font-size:12px;line-height:1.6;">If you didn't request this, you can safely ignore this email — no changes will be made.</p>
          <p style="margin:0;color:#4d5266;font-size:12px;">Need help? <a href="mailto:${support}" style="color:#00D4FF;text-decoration:none;">${support}</a></p>
        </td></tr>
      </table>
      <p style="max-width:480px;color:#3d4260;font-size:11px;margin:16px auto 0;">&copy; ${new Date().getFullYear()} 7By.in — AI audio tools that run in your browser.</p>
    </td></tr>
  </table>
</body></html>`;
}
/*
 * Sends a verification code.
 *
 * A request from 7 Audio gets the 7 Audio template, from noreply@7audio.7by.in.
 * Anything else keeps the original 7By.in email untouched, because this backend
 * serves more than one product.
 */
async function sendOTP(email, otp, purpose, req) {
  if (req && isAudioRequest(req)) {
    const result = await audioMail.send({
      type: 'otp',
      to: email,
      key: audioMail.keyFor.otp(email, otp),
      data: { code: otp, purpose },
      db,
      persist,
      // A code that cannot be delivered must fail loudly: the user is sitting
      // on a form waiting for it, and silently succeeding strands them.
      throwOnError: true,
    });
    if (!result.ok && !result.skipped && audioMail.configured()) {
      throw new Error(result.reason || 'delivery failed');
    }
    return;
  }
  return sendLegacyOTP(email, otp, purpose);
}

async function sendLegacyOTP(email, otp, purpose) {
  const from = process.env.MAIL_FROM || '7By.in <noreply@7by.in>';
  const subject = purpose === 'reset' ? 'Your 7By.in password reset code' : 'Your 7By.in verification code';
  // plain-text fallback (shown by clients that block HTML)
  const text = `Your 7By.in code is ${otp}. It expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\nSupport: ${process.env.SUPPORT_EMAIL || 'contact@7by.in'}`;
  const html = otpEmailHTML(otp, purpose);
  const tx = getTransporter();
  if (!tx) { console.log(`[DEV OTP] ${email} -> ${otp} (${purpose})`); return; }
  try {
    await tx.sendMail({ from, to: email, subject, text, html });
  } catch (e) {
    console.error('[mail] sendMail failed:', e && e.message, e && e.code, e && e.response);
    throw e;
  }
}

/* ---------------------------- 7 Audio email -------------------------------
 * This backend is shared between 7By products, so a request has to say which
 * one it belongs to before an email can be branded. A caller declares itself
 * with { app: '7audio' }; failing that the Origin header is checked, so the
 * 7 Audio site gets 7 Audio emails even if a call is made without the field.
 * Anything else keeps the original 7By.in behaviour.
 * ------------------------------------------------------------------------ */
function isAudioRequest(req) {
  const declared = String(req.headers['x-7-app'] || (req.body && req.body.app) || req.query.app || '').toLowerCase();
  if (declared === '7audio' || declared === 'audiora') return true;
  const origin = String(req.headers.origin || req.headers.referer || '').toLowerCase();
  return origin.includes('audiora.') || origin.includes('7audio.');
}

/* Sends the one-time welcome email for a newly created account. Never throws:
   a mail failure must not turn a successful signup into an error. */
async function sendAudioWelcome(user) {
  try {
    await audioMail.send({
      type: 'welcome',
      to: user.email,
      userId: user.id,
      key: audioMail.keyFor.welcome(user.id),
      data: { name: user.name },
      db,
      persist,
    });
  } catch (e) {
    console.error('[audio-mail] welcome failed for', user.email, e && e.message);
  }
}

/*
 * Where Cashfree sends the customer back after checkout. Derived from the site
 * URL so that setting AUDIO_SITE_URL correctly is enough, and CASHFREE_RETURN_URL
 * only has to be set when you want somewhere other than the credits page.
 */
function defaultReturnUrl() {
  const site = (process.env.AUDIO_SITE_URL || '').replace(/\/+$/, '');
  return site ? site + '/credits?order={order_id}' : undefined;
}

/* Formats money the way the customer saw it at checkout. */
function amountLabel(amount, currency) {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '';
  return symbol + Number(amount).toLocaleString('en-US') + (symbol ? '' : ' ' + currency);
}

/* The purchase receipt. Called ONLY after the server has confirmed payment —
   from the webhook, or from the confirm endpoint that asks Cashfree directly.
   Keyed on the order id, so a retried webhook cannot send a second copy. */
async function sendAudioReceipt(user, record) {
  try {
    const plan = audioPlans.resolvePlan(record.planId, record.cycle, record.region);
    await audioMail.send({
      type: 'purchase',
      to: user.email,
      userId: user.id,
      key: audioMail.keyFor.purchase(record.orderId),
      data: {
        email: user.email,
        planName: (plan && plan.label) || record.planId,
        amountLabel: amountLabel(record.amount, record.currency),
        currency: record.currency,
        credits: record.credits,
        files: plan && plan.files,
        cycle: record.cycle,
        orderId: record.orderId,
        paymentRef: record.paymentId || undefined,
        purchasedAt: new Date(record.creditedAt || Date.now()).toISOString().slice(0, 10),
      },
      db,
      persist,
    });
  } catch (e) {
    console.error('[audio-mail] receipt failed for order', record.orderId, e && e.message);
  }
}

/* Sent when a payment attempt ends without a confirmed success. Says plainly
   that nothing was activated — it must never read like a receipt. */
async function sendAudioPaymentFailed(user, record, reason) {
  try {
    const plan = audioPlans.resolvePlan(record.planId, record.cycle, record.region);
    await audioMail.send({
      type: 'paymentFailed',
      to: user.email,
      userId: user.id,
      key: audioMail.keyFor.failed(record.orderId),
      data: {
        planName: (plan && plan.label) || record.planId,
        orderId: record.orderId,
        reason: reason || 'Not completed',
      },
      db,
      persist,
    });
  } catch (e) {
    console.error('[audio-mail] failure notice failed for order', record.orderId, e && e.message);
  }
}

function makeOTP() { return String(Math.floor(100000 + Math.random() * 900000)); }
function setOTP(email, otp, payload) {
  db.otps[email.toLowerCase()] = { otp, exp: Date.now() + OTP_TTL_MS, ...payload };
  persist();
}
function checkOTP(email, otp) {
  const rec = db.otps[String(email || '').toLowerCase()];
  if (!rec) return { ok: false, err: 'No code requested' };
  if (Date.now() > rec.exp) return { ok: false, err: 'Code expired' };
  if (String(otp) !== String(rec.otp)) return { ok: false, err: 'Incorrect code' };
  return { ok: true, rec };
}

/* --------------------------------- credits --------------------------------- */
function today() { return new Date().toISOString().slice(0, 10); }
function refreshDaily(u) {
  if (u.freeDate !== today()) { u.freeDate = today(); u.freeCredits = DAILY_FREE; }
  if (typeof u.paidCredits !== 'number') u.paidCredits = 0;
  if (typeof u.freeCredits !== 'number') u.freeCredits = DAILY_FREE;
}
function balance(u) { refreshDaily(u); return u.freeCredits + u.paidCredits; }
function spendCredits(u, n) {
  refreshDaily(u);
  if (u.freeCredits + u.paidCredits < n) return false;
  const useFree = Math.min(u.freeCredits, n); u.freeCredits -= useFree;
  u.paidCredits -= (n - useFree);
  return true;
}

/* --------------------------------- auth util ------------------------------- */
function sign(u) { return jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: '30d' }); }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, credits: balance(u) }; }
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Not signed in' });
  try { const p = jwt.verify(t, JWT_SECRET); req.user = db.users.find(u => u.id === p.uid); if (!req.user) throw 0; next(); }
  catch { return res.status(401).json({ error: 'Invalid session' }); }
}

/* ------------------------- simple in-memory rate limiter ------------------- */
const _rl = new Map();
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'ip';
}
function rateLimit(max, windowMs, msg) {
  return (req, res, next) => {
    const key = clientIp(req) + '|' + req.path;
    const now = Date.now();
    let e = _rl.get(key);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; _rl.set(key, e); }
    e.count++;
    if (e.count > max) return res.status(429).json({ error: msg || 'Too many requests — please wait a few minutes.' });
    next();
  };
}
// prune expired buckets every 10 min so the map can't grow unbounded
setInterval(() => { const now = Date.now(); for (const [k, e] of _rl) if (now > e.reset) _rl.delete(k); }, 10 * 60 * 1000).unref();

/* ---------------------------------- app ------------------------------------ */
const app = express();

/* ---- Razorpay webhook — registered BEFORE express.json() because it needs the RAW body
   for signature verification. This is a backstop that credits the account even if the
   browser closes before /api/pay/verify runs. ---- */
app.post('/api/pay/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(501).end();
  const sig = req.headers['x-razorpay-signature'] || '';
  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  if (sig !== expected) return res.status(400).end();
  let evt; try { evt = JSON.parse(req.body.toString('utf8')); } catch (e) { return res.status(400).end(); }
  if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
    const pay = evt.payload && evt.payload.payment && evt.payload.payment.entity;
    const ord = evt.payload && evt.payload.order && evt.payload.order.entity;
    const notes = (pay && pay.notes) || (ord && ord.notes) || {};
    const plan = PLANS[notes.plan];
    const u = notes.uid ? db.users.find(x => x.id === notes.uid) : null;
    const paymentId = pay && pay.id;
    if (u && plan) {
      u.creditedPayments = u.creditedPayments || [];
      if (!paymentId || !u.creditedPayments.includes(paymentId)) {
        u.paidCredits = (u.paidCredits || 0) + plan.credits;
        if (paymentId) u.creditedPayments.push(paymentId);
        persist();
      }
    }
  }
  res.json({ ok: true });
});

/* ---- Cashfree webhook — RAW body, registered before express.json().
   Signature is HMAC-SHA256 of (timestamp + raw body), base64, keyed with the
   Cashfree secret. Parsing first and re-serialising changes the bytes, so the
   signature would never match. Idempotent: an order is credited exactly once. ---- */
app.post('/api/pay/cashfree/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  if (!cashfree.verifyWebhook({ rawBody: req.body, signature, timestamp })) {
    console.warn('[cashfree] webhook rejected: bad signature');
    return res.status(401).end();
  }
  if (!cashfree.timestampFresh(timestamp)) {
    console.warn('[cashfree] webhook rejected: stale timestamp');
    return res.status(401).end();
  }

  let evt;
  try { evt = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).end(); }

  const data = (evt && evt.data) || {};
  const order = data.order || {};
  const payment = data.payment || {};
  const orderId = order.order_id;
  const status = String(payment.payment_status || '').toUpperCase();

  // Acknowledge anything recognised but not acted on, so Cashfree stops retrying.
  if (!orderId) return res.status(200).json({ ok: true, ignored: 'no order id' });
  if (status && status !== 'SUCCESS') {
    console.log('[cashfree] order', orderId, 'status', status, '- no credit granted');
    db.orders = db.orders || {};
    const failedRecord = db.orders[orderId];
    if (failedRecord && !failedRecord.credited) {
      failedRecord.status = status;
      persist();
      const failedUser = db.users.find(u => u.id === failedRecord.uid);
      if (failedUser) void sendAudioPaymentFailed(failedUser, failedRecord, status);
    }
    return res.status(200).json({ ok: true, ignored: status });
  }

  db.orders = db.orders || {};
  const record = db.orders[orderId];
  if (!record) {
    console.warn('[cashfree] webhook for unknown order', orderId);
    return res.status(200).json({ ok: true, ignored: 'unknown order' });
  }
  if (record.credited) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const user = db.users.find(u => u.id === record.uid);
  if (!user) {
    console.warn('[cashfree] order', orderId, 'has no matching user');
    return res.status(200).json({ ok: true, ignored: 'unknown user' });
  }

  user.paidCredits = (user.paidCredits || 0) + record.credits;
  record.credited = true;
  record.creditedAt = Date.now();
  record.paymentId = payment.cf_payment_id || null;
  record.status = 'PAID';
  persist();
  console.log('[cashfree] credited', record.credits, 'to', user.email, 'order', orderId);

  // The receipt goes out only here and in the confirm endpoint — both of which
  // run after the SERVER has established that the payment succeeded. It is
  // keyed on the order id, so a retried webhook cannot send a second copy.
  void sendAudioReceipt(user, record);

  res.status(200).json({ ok: true });
});

app.use(express.json());
/* ----------------------------------- CORS --------------------------------
 * A browser sends the Origin header with no trailing slash, ever. People write
 * CORS_ORIGIN with one because that is what they copy out of the address bar,
 * and the request is then refused with no useful error anywhere: the browser
 * blocks it, and the server logs a perfectly ordinary 200 on the preflight.
 * Normalising here removes an entire category of "the site cannot reach the
 * API" reports.
 * ------------------------------------------------------------------------- */
const origins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: origins.includes('*') ? true : origins,
  // The frontend sends X-7-App so the backend knows which product is calling.
  // A custom header triggers a preflight, which must allow it explicitly.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-7-App'],
}));

// Abuse protection: throttle OTP emails and password attempts per IP.
app.use(['/api/auth/signup', '/api/auth/forgot'], rateLimit(6, 15 * 60 * 1000, 'Too many code requests — wait 15 minutes.'));
app.use(['/api/auth/login', '/api/auth/verify', '/api/auth/reset', '/api/auth/google'], rateLimit(20, 15 * 60 * 1000));

// Root route — returns 200 so cPanel/Passenger's post-install availability check passes.
app.get('/', (req, res) => res.status(200).json({ service: '7By.in API', ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---- Payment self-check ----------------------------------------------------
 * Visit https://api.7by.in/api/pay/health to find out exactly why checkout is
 * failing, without digging through server logs. It creates a tiny real order
 * and reports Razorpay's own error verbatim. Never returns the key secret.
 * -------------------------------------------------------------------------- */
app.get('/api/pay/health', async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const out = {
    keyIdPresent: !!keyId,
    keySecretPresent: !!process.env.RAZORPAY_KEY_SECRET,
    keyIdPrefix: keyId ? keyId.slice(0, 8) + '…' : null,
    mode: keyId.startsWith('rzp_live') ? 'live' : keyId.startsWith('rzp_test') ? 'test' : 'unknown',
    sdkLoaded: !!razor,
    webhookSecretSet: !!process.env.RAZORPAY_WEBHOOK_SECRET
  };
  if (!razor) {
    out.ok = false;
    out.problem = !keyId || !process.env.RAZORPAY_KEY_SECRET
      ? 'RAZORPAY_KEY_ID and/or RAZORPAY_KEY_SECRET are not set on the Node app. Add them in cPanel → Setup Node.js App → Environment Variables, then Restart.'
      : 'The razorpay package failed to load. Run NPM Install, then Restart.';
    return res.status(200).json(out);
  }
  try {
    const o = await razor.orders.create({ amount: 100, currency: 'INR', notes: { purpose: 'health-check' } });
    out.ok = true;
    out.testOrderId = o.id;
    out.problem = null;
    out.note = 'Razorpay accepted a test order. Checkout should work.';
  } catch (e) {
    const d = (e && e.error) || {};
    out.ok = false;
    out.status = e && e.statusCode;
    out.code = d.code;
    out.description = d.description || (e && e.message);
    out.field = d.field;
    // Translate the usual causes into something actionable.
    const desc = String(out.description || '').toLowerCase();
    if (out.status === 401 || desc.includes('authentication')) {
      out.problem = 'Razorpay rejected the credentials. The Key ID and Key Secret are wrong, mismatched, or from different modes (a test key paired with a live secret). Regenerate both together in the Razorpay dashboard and paste them fresh.';
    } else if (desc.includes('not activated') || desc.includes('activate')) {
      out.problem = 'The Razorpay account is not activated yet. Live keys stay rejected until KYC is approved — use test keys (rzp_test_…) until then.';
    } else {
      out.problem = 'Razorpay refused the order. See description/code above for the exact reason.';
    }
    console.error('[pay] health check failed:', out.status, out.code, out.description);
  }
  res.status(200).json(out);
});

/* ---- Sign up: request OTP ---- */
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!isGmail(email)) return res.status(400).json({ error: 'Only real @gmail.com addresses are allowed' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password too short' });
  if (findUser(email)) return res.status(409).json({ error: 'Account already exists — sign in' });
  const otp = makeOTP();
  const hash = await bcrypt.hash(String(password), 10);
  setOTP(email, otp, { purpose: 'signup', name, hash });
  try { await sendOTP(email, otp, 'signup', req); } catch (e) { return res.status(500).json({ error: 'Could not send email — check server mail logs' }); }
  res.json({ ok: true });
});

/* ---- Sign up: verify OTP -> create account ---- */
app.post('/api/auth/verify', (req, res) => {
  const { email, otp } = req.body || {};
  const c = checkOTP(email, otp);
  if (!c.ok) return res.status(400).json({ error: c.err });
  if (c.rec.purpose !== 'signup') return res.status(400).json({ error: 'Wrong code type' });
  const u = { id: crypto.randomUUID(), name: c.rec.name, email: email.toLowerCase(), passHash: c.rec.hash, paidCredits: 0, freeCredits: DAILY_FREE, freeDate: today(), createdAt: Date.now() };
  db.users.push(u); delete db.otps[email.toLowerCase()]; persist();

  // Welcome the new account. Not awaited: the signup response should not wait
  // on an SMTP round trip, and a mail failure must not fail the signup.
  if (isAudioRequest(req)) void sendAudioWelcome(u);

  res.json({ token: sign(u), user: publicUser(u) });
});

/* ---- Login ---- */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = findUser(email);
  if (!u || !u.passHash) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(String(password || ''), u.passHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  persist();
  res.json({ token: sign(u), user: publicUser(u) });
});

/* ---- Forgot password: request OTP ---- */
app.post('/api/auth/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (!isGmail(email)) return res.status(400).json({ error: 'Only real @gmail.com addresses are allowed' });
  const u = findUser(email);
  // Always respond ok (don't leak which emails exist), but only send if the user exists.
  if (u) { const otp = makeOTP(); setOTP(email, otp, { purpose: 'reset' }); try { await sendOTP(email, otp, 'reset', req); } catch {} }
  res.json({ ok: true });
});

/* ---- Reset password ---- */
app.post('/api/auth/reset', async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (String(newPassword || '').length < 6) return res.status(400).json({ error: 'Password too short' });
  const c = checkOTP(email, otp);
  if (!c.ok) return res.status(400).json({ error: c.err });
  if (c.rec.purpose !== 'reset') return res.status(400).json({ error: 'Wrong code type' });
  const u = findUser(email);
  if (!u) return res.status(404).json({ error: 'No such account' });
  u.passHash = await bcrypt.hash(String(newPassword), 10);
  delete db.otps[email.toLowerCase()]; persist();
  res.json({ ok: true });
});

/* ---- Google Sign-In ---- */
let googleClient = null;
if (process.env.GOOGLE_CLIENT_ID) {
  const { OAuth2Client } = require('google-auth-library');
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
}
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!googleClient) return res.status(501).json({ error: 'Google sign-in not configured' });
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    // Normal accounts are Gmail-only. Reject anything else gracefully —
    // the client shows a plain sentence, never an auth error dump.
    if (!isGmail(p.email)) {
      return res.status(403).json({ error: 'Please sign in with a Gmail account to continue.' });
    }
    if (p.email_verified === false) {
      return res.status(403).json({ error: 'Please verify your Google account first.' });
    }
    let u = findUser(p.email);
    const isNewAccount = !u;
    if (!u) { u = { id: crypto.randomUUID(), name: p.name || p.email.split('@')[0], email: p.email.toLowerCase(), google: true, paidCredits: 0, freeCredits: DAILY_FREE, freeDate: today(), createdAt: Date.now() }; db.users.push(u); }
    persist();

    // Only on the FIRST sign-in, and only for 7 Audio. Signing in again is not
    // a signup, and the welcome key makes a second send impossible regardless.
    if (isNewAccount && isAudioRequest(req)) void sendAudioWelcome(u);

    res.json({ token: sign(u), user: publicUser(u) });
  } catch (e) { res.status(401).json({ error: 'Google verification failed' }); }
});

/* ---- Current user / credits ---- */
app.get('/api/me', auth, (req, res) => { persist(); res.json({ user: publicUser(req.user) }); });

/* ---- Spend credits (server-authoritative) ---- */
app.post('/api/credits/spend', auth, (req, res) => {
  const n = Math.max(0, Math.floor(+(req.body && req.body.amount) || 0));
  if (!spendCredits(req.user, n)) return res.status(402).json({ error: 'Not enough credits', credits: balance(req.user) });
  persist();
  res.json({ ok: true, credits: balance(req.user) });
});

/* ------------------------------- Razorpay ---------------------------------- */
let razor = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  const Razorpay = require('razorpay');
  razor = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}
app.post('/api/pay/order', auth, async (req, res) => {
  const plan = PLANS[(req.body && req.body.plan)];
  if (!plan) return res.status(400).json({ error: 'Unknown plan' });
  if (!razor) return res.status(501).json({ error: 'Payments not configured' });
  try {
    const order = await razor.orders.create({ amount: plan.amount, currency: 'INR', notes: { uid: req.user.id, plan: req.body.plan } });
    res.json({ orderId: order.id, amount: plan.amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, name: plan.name });
  } catch (e) {
    // Razorpay puts the real reason in e.error.description — without logging it the
    // failure is invisible and undiagnosable, so surface it to the server log.
    const d = (e && e.error) || {};
    console.error('[pay] order create failed:',
      'status=', e && e.statusCode,
      'code=', d.code,
      'desc=', d.description,
      'field=', d.field,
      'raw=', (e && e.message) || e);
    res.status(500).json({ error: d.description || 'Could not create order' });
  }
});
app.post('/api/pay/verify', auth, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body || {};
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: 'Unknown plan' });
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
  if (expected !== razorpay_signature) return res.status(400).json({ error: 'Payment verification failed' });
  // dedupe with the webhook so a payment is only ever credited once
  req.user.creditedPayments = req.user.creditedPayments || [];
  if (razorpay_payment_id && req.user.creditedPayments.includes(razorpay_payment_id)) {
    return res.json({ ok: true, added: 0, credits: balance(req.user) });
  }
  req.user.paidCredits = (req.user.paidCredits || 0) + p.credits;
  if (razorpay_payment_id) req.user.creditedPayments.push(razorpay_payment_id);
  persist();
  res.json({ ok: true, added: p.credits, credits: balance(req.user) });
});

/* ------------------------------ guest credits ------------------------------ */
/* A visitor gets a small allowance before a Gmail sign-in is required. The token
   identifies the browser; the per-IP ledger in guests.js is what actually
   resists clearing storage and refreshing. */
app.post('/api/guest/start', (req, res) => {
  guests.ensureStore(db);
  let guest = null;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.typ === 'guest') guest = guests.getGuest(db, payload.gid);
    } catch { guest = null; }
  }
  if (!guest) guest = guests.newGuest(db);
  guests.prune(db);
  persist();
  const guestToken = jwt.sign({ typ: 'guest', gid: guest.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token: guestToken, credits: guests.remaining(guest), allowance: guests.GUEST_CREDITS });
});

/* Spend guest credits. Kept separate from /api/credits/spend so a guest token
   can never be mistaken for a signed-in session. */
app.post('/api/guest/spend', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let guest = null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.typ === 'guest') guest = guests.getGuest(db, payload.gid);
    } catch { guest = null; }
  }
  if (!guest) return res.status(401).json({ error: 'Guest session expired', credits: 0 });

  const amount = Math.max(0, Math.floor(Number(req.body && req.body.amount) || 0));
  const result = guests.spend(db, guest, guests.clientIP(req), amount);
  persist();
  if (!result.ok) {
    return res.status(402).json({
      error: 'Your free credits are used. Sign in with Gmail to continue.',
      credits: result.remaining,
      reason: result.reason,
    });
  }
  res.json({ ok: true, credits: result.remaining });
});

/* ------------------------------- Cashfree ---------------------------------- */
app.get('/api/pay/cashfree/health', (req, res) => {
  res.json({
    configured: cashfree.configured(),
    env: cashfree.baseUrl().includes('sandbox') ? 'sandbox' : 'production',
  });
});

/* Create an order. The AMOUNT comes from the server plan table, so a client
   cannot choose its own price. */
app.post('/api/pay/cashfree/order', auth, async (req, res) => {
  if (!cashfree.configured()) return res.status(501).json({ error: 'Payments are not available right now.' });
  const body = req.body || {};
  const plan = audioPlans.resolvePlan(body.plan, body.cycle, body.region);
  if (!plan) return res.status(400).json({ error: 'Unknown plan' });

  const orderId = '7audio_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  try {
    const created = await cashfree.createOrder({
      orderId,
      amount: plan.amount,
      currency: plan.currency,
      customer: { id: req.user.id, email: req.user.email, name: req.user.name },
      // Falls back to the site URL rather than being silently absent: without
      // a return URL Cashfree leaves the customer on its own page after paying,
      // which looks like the purchase failed even though it succeeded.
      returnUrl: process.env.CASHFREE_RETURN_URL || defaultReturnUrl(),
      notes: plan.label,
    });

    db.orders = db.orders || {};
    db.orders[orderId] = {
      orderId, uid: req.user.id, planId: plan.planId, cycle: plan.cycle, region: plan.region,
      amount: plan.amount, currency: plan.currency, credits: plan.credits,
      credited: false, status: 'CREATED', createdAt: Date.now(),
    };
    persist();

    res.json({
      orderId,
      paymentSessionId: created.paymentSessionId,
      amount: plan.amount,
      currency: plan.currency,
      credits: plan.credits,
    });
  } catch (e) {
    console.error('[cashfree] order create failed:', e.message, e.detail || '');
    res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
});

/* Confirm an order by asking Cashfree directly. The browser's word is never
   enough; this lets the UI settle without waiting for the webhook, and credits
   through the same idempotent record so it can never double-credit. */
app.post('/api/pay/cashfree/confirm', auth, async (req, res) => {
  const orderId = String((req.body && req.body.orderId) || '');
  db.orders = db.orders || {};
  const record = db.orders[orderId];
  if (!record || record.uid !== req.user.id) return res.status(404).json({ error: 'Unknown order' });
  if (record.credited) return res.json({ ok: true, status: 'PAID', added: 0, credits: balance(req.user) });

  try {
    const order = await cashfree.fetchOrder(orderId);
    const status = String(order.order_status || '').toUpperCase();
    if (status !== 'PAID') {
      record.status = status || 'PENDING';
      persist();
      return res.json({ ok: false, status: record.status, credits: balance(req.user) });
    }
    req.user.paidCredits = (req.user.paidCredits || 0) + record.credits;
    record.credited = true;
    record.creditedAt = Date.now();
    record.status = 'PAID';
    record.paymentId = record.paymentId || (order.cf_order_id ? String(order.cf_order_id) : null);
    persist();

    // Same key as the webhook uses. Whichever path confirms the payment first
    // sends the receipt; the other finds the key already recorded and stops.
    void sendAudioReceipt(req.user, record);

    res.json({ ok: true, status: 'PAID', added: record.credits, credits: balance(req.user) });
  } catch (e) {
    console.error('[cashfree] confirm failed:', e.message);
    res.status(502).json({ error: 'Could not confirm the payment yet. It will update shortly.' });
  }
});

app.listen(PORT, () => {
  console.log(`7By backend on http://localhost:${PORT}`);
  if (!process.env.SMTP_HOST) console.log('  ⚠ SMTP_HOST not set — 7By.in OTPs will print to this console (dev mode).');
  /* The two settings that fail silently. A CORS mismatch is invisible from the
     server side — the browser blocks the response and nothing is logged as an
     error — so it is worth stating plainly at boot. */
  const siteUrl = (process.env.AUDIO_SITE_URL || '').replace(/\/+$/, '');
  if (siteUrl && !origins.includes('*') && !origins.includes(siteUrl)) {
    console.log('  ⚠ CORS_ORIGIN does not include ' + siteUrl + ' — the site will not be able to reach this API.');
    console.log('    current: ' + origins.join(', '));
  }
  if (!process.env.CASHFREE_RETURN_URL && !defaultReturnUrl()) {
    console.log('  ⚠ Neither CASHFREE_RETURN_URL nor AUDIO_SITE_URL is set — customers will not be returned to the site after paying.');
  }

  if (!audioMail.configured()) console.log('  ⚠ 7 Audio email not configured — its emails will be logged, not sent.');
  else console.log('  ✓ 7 Audio email ready:', Object.values(audioMail.SENDERS).map(x => x.address).join(', '));
  if (!googleClient) console.log('  ⚠ GOOGLE_CLIENT_ID not set — Google sign-in disabled.');
  if (!razor) console.log('  ⚠ Razorpay keys not set — payments disabled.');
});
