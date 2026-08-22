'use strict';

/**
 * ==========================================================================
 * 7 AUDIO — TRANSACTIONAL EMAIL
 *
 * Four sender identities, fixed. Nothing in this file picks a sender at
 * random and nothing else in the application is allowed to invent one:
 *
 *   noreply@7audio.7by.in   verification codes, and only those
 *   welcome@7audio.7by.in   the one email sent when an account is created
 *   thankyou@7audio.7by.in  payment outcomes, after the SERVER has confirmed
 *   contact@7audio.7by.in   where a human reads replies
 *
 * The reply-to addresses matter as much as the from addresses. A customer who
 * hits reply on a receipt should reach a person, which is why every email
 * except the OTP replies to contact@ rather than to its own sender.
 *
 * IDEMPOTENCY. Cashfree retries webhooks. A retry must not send a second
 * receipt, so every send is recorded against a key and a repeat send for the
 * same key is refused before the transport is touched. For a purchase the key
 * is the verified order id — the one thing that is unique per payment.
 *
 * CREDENTIALS live in the server environment only. Nothing here is readable
 * from the browser.
 * ==========================================================================
 */

const APP_NAME = '7 Audio';
const APP_TAGLINE = 'AI Audio Toolkit';

/* --------------------------------------------------------------- senders -- */

const DOMAIN = process.env.AUDIO_MAIL_DOMAIN || '7audio.7by.in';

const SENDERS = {
  otp: { address: `noreply@${DOMAIN}`, name: APP_NAME },
  welcome: { address: `welcome@${DOMAIN}`, name: APP_NAME },
  purchase: { address: `thankyou@${DOMAIN}`, name: APP_NAME },
  contact: { address: `contact@${DOMAIN}`, name: APP_NAME },
};

/** The address a human actually reads. Never noreply. */
const CONTACT_ADDRESS = SENDERS.contact.address;

function fromHeader(kind) {
  const sender = SENDERS[kind];
  if (!sender) throw new Error(`audio-mail: unknown sender kind "${kind}"`);
  return `${sender.name} <${sender.address}>`;
}

/*
 * Reply-to, per the sender rules:
 *   OTP           → its own noreply address. Replies to a code are not useful
 *                   and pretending otherwise invites mail nobody reads.
 *   everything    → contact@, so a customer reaches a person.
 */
function replyToFor(kind) {
  return kind === 'otp' ? SENDERS.otp.address : CONTACT_ADDRESS;
}

/* ------------------------------------------------------------------ urls -- */

/*
 * Every link in every email comes from here. A hard-coded URL in a template
 * is how an email ends up pointing at localhost in production.
 */
function urls() {
  const site = (process.env.AUDIO_SITE_URL || 'https://7audio.7by.in').replace(/\/$/, '');
  return {
    site,
    pricing: process.env.AUDIO_PRICING_URL || `${site}/pricing`,
    dashboard: process.env.AUDIO_DASHBOARD_URL || `${site}/dashboard`,
    credits: `${site}/credits`,
    privacy: `${site}/privacy`,
    terms: `${site}/terms`,
    contact: `${site}/contact`,
    logo: process.env.AUDIO_LOGO_URL || `${site}/brand/icon-192.png`,
  };
}

/* ---------------------------------------------------------------- layout -- */

/*
 * One card layout, shared by every email.
 *
 * Written as tables with inline styles because that is what mail clients
 * actually support — Gmail strips <style> blocks in some contexts, Outlook
 * renders with Word's engine, and neither can be relied on for flexbox or
 * grid. The single media query is a progressive enhancement: the layout is
 * already readable at 320px without it.
 */

/*
 * Taken from audiora/src/index.css :root. Mail clients cannot use CSS
 * variables, so these are literals — but they are the site's literals, not
 * approximations of them. If the site's palette changes, change these too.
 *
 *   BRAND        --brand          the blue-violet in the middle of the logo gradient
 *   BRAND_DEEP   --brand-deep     for text on a tinted panel, where --brand is too light
 *   BRAND_BLUE   first gradient stop, used for the accent rule
 *   INK          --text
 *   MUTED        --text-muted
 *   DIM          --text-dim
 *   LINE         --border, flattened to a solid (rgba is unreliable in Outlook)
 *   PAGE         --bg-deep
 *   TINT         --brand-soft, flattened for the same reason
 */
const BRAND = '#3B2BF5';
const BRAND_DEEP = '#2A1CC9';
const BRAND_BLUE = '#2F6BFF';
const INK = '#0F1222';
const MUTED = '#4D5266';
const DIM = '#767C92';
const LINE = '#E7E7F0';
const PAGE = '#F4F4FB';
const TINT = '#F2F1FE';
const TINT_LINE = '#DAD6FD';

const esc = (value) =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function button(label, href) {
  // A bulletproof-ish button: a padded anchor inside a table cell, so clients
  // that ignore padding on <a> still produce a tappable target.
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
    <tr>
      <td align="center" bgcolor="${BRAND}" style="border-radius:12px;">
        <a href="${esc(href)}"
           style="display:inline-block;min-width:180px;padding:15px 30px;border-radius:12px;background:${BRAND};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:20px;text-align:center;text-decoration:none;">
          ${esc(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Label/value rows, used for receipts. */
function detailRows(rows) {
  return rows
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(
      ([label, value], index) => `
      <tr>
        <td style="padding:11px 0;${index === 0 ? '' : `border-top:1px solid ${LINE};`}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};white-space:nowrap;">${esc(label)}</td>
        <td align="right" style="padding:11px 0 11px 12px;${index === 0 ? '' : `border-top:1px solid ${LINE};`}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};font-weight:bold;word-break:break-word;overflow-wrap:anywhere;">${esc(value)}</td>
      </tr>`,
    )
    .join('');
}

/**
 * Wrap content in the 7 Audio card.
 *
 * `preheader` is the grey line Gmail shows next to the subject in the inbox
 * list. Left unset, clients grab the first words of the body, which is
 * usually the logo alt text.
 */
function layout({ preheader, heading, intro, content, footerNote }) {
  const u = urls();
  const year = new Date().getFullYear();

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(heading)}</title>
<style type="text/css">
  /* Progressive enhancement only — the layout is readable without it. */
  @media only screen and (max-width:600px) {
    .wrap { padding:16px 10px !important; }
    .card { border-radius:16px !important; }
    .pad { padding-left:18px !important; padding-right:18px !important; }
    .detail { padding-left:12px !important; padding-right:12px !important; }
    .h1 { font-size:23px !important; }
    .code { font-size:30px !important; letter-spacing:7px !important; }
  }
  a { color:${BRAND}; }
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-font-smoothing:antialiased;">
  <div style="display:none;font-size:1px;color:${PAGE};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
    <tr>
      <td class="wrap" align="center" style="padding:32px 16px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:20px;">

          <!-- brand -->
          <tr>
            <td class="pad" style="padding:28px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${esc(u.logo)}" width="40" height="40" alt="${APP_NAME}"
                         style="display:block;width:40px;height:40px;border-radius:11px;border:1px solid ${LINE};" />
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:17px;font-weight:bold;color:${INK};line-height:20px;">${APP_NAME}</div>
                    <div style="font-size:12px;color:${DIM};line-height:16px;">${APP_TAGLINE}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- brand rule: the logo gradient, as cells so Outlook keeps it -->
          <tr>
            <td class="pad" style="padding:18px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:3px;line-height:3px;font-size:0;">
                <tr>
                  <td width="40%" bgcolor="${BRAND_BLUE}" style="height:3px;line-height:3px;font-size:0;border-radius:2px 0 0 2px;">&nbsp;</td>
                  <td width="30%" bgcolor="${BRAND}" style="height:3px;line-height:3px;font-size:0;">&nbsp;</td>
                  <td width="30%" bgcolor="#8B34EA" style="height:3px;line-height:3px;font-size:0;border-radius:0 2px 2px 0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- heading -->
          <tr>
            <td class="pad" style="padding:22px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;">
              <h1 class="h1" style="margin:0;font-size:26px;line-height:1.25;color:${INK};font-weight:bold;letter-spacing:-0.3px;">${esc(heading)}</h1>
              ${intro ? `<p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:${MUTED};">${intro}</p>` : ''}
            </td>
          </tr>

          <!-- body -->
          <tr>
            <td class="pad" style="padding:24px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
              ${content}
            </td>
          </tr>

          ${
            footerNote
              ? `<tr><td class="pad" style="padding:8px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;">
                   <p style="margin:0;font-size:13px;line-height:1.6;color:${DIM};">${footerNote}</p>
                 </td></tr>`
              : ''
          }

          <!-- footer -->
          <tr>
            <td class="pad" style="padding:26px 32px 28px 32px;">
              <div style="border-top:1px solid ${LINE};padding-top:20px;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:14px;font-weight:bold;color:${INK};">${APP_NAME}</div>
                <div style="font-size:12px;color:${DIM};padding-top:2px;">${APP_TAGLINE}</div>

                <div style="padding-top:14px;font-size:13px;line-height:22px;color:${MUTED};">
                  <a href="${esc(u.site)}" style="color:${BRAND};text-decoration:none;">Website</a>
                  &nbsp;·&nbsp;
                  <a href="${esc(u.pricing)}" style="color:${BRAND};text-decoration:none;">Pricing</a>
                  &nbsp;·&nbsp;
                  <a href="${esc(u.contact)}" style="color:${BRAND};text-decoration:none;">Contact</a>
                  &nbsp;·&nbsp;
                  <a href="${esc(u.privacy)}" style="color:${BRAND};text-decoration:none;">Privacy</a>
                  &nbsp;·&nbsp;
                  <a href="${esc(u.terms)}" style="color:${BRAND};text-decoration:none;">Terms</a>
                </div>

                <div style="padding-top:12px;font-size:13px;color:${MUTED};">
                  Questions? Write to
                  <a href="mailto:${CONTACT_ADDRESS}" style="color:${BRAND};text-decoration:none;">${CONTACT_ADDRESS}</a>
                </div>
              </div>
            </td>
          </tr>
        </table>

        <div style="max-width:560px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:${DIM};text-align:center;">
          © ${year} ${APP_NAME}. All rights reserved.
        </div>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------- templates -- */

function otpEmail({ code, purpose }) {
  const heading = purpose === 'reset' ? 'Reset your password' : 'Your verification code';
  const intro =
    purpose === 'reset'
      ? `Use this code to reset your ${APP_NAME} password.`
      : `Use this code to finish signing in to ${APP_NAME}.`;

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:4px 0 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${TINT};border:1px solid ${TINT_LINE};border-radius:14px;">
            <tr>
              <td align="center" style="padding:20px 30px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};letter-spacing:1px;text-transform:uppercase;padding-bottom:8px;">Verification code</div>
                <div class="code" style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:bold;letter-spacing:9px;color:${BRAND_DEEP};line-height:1.1;">${esc(code)}</div>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${DIM};">This code expires shortly.</p>
        </td>
      </tr>
    </table>`;

  const text = [
    `${heading} — ${APP_NAME}`,
    '',
    `Your ${APP_NAME} verification code is ${code}.`,
    '',
    'This code expires shortly. If you did not request this code, you can safely ignore this email.',
    '',
    `Thank you for choosing ${APP_NAME}.`,
    `Questions: ${CONTACT_ADDRESS}`,
  ].join('\n');

  return {
    sender: 'otp',
    subject: `Your ${APP_NAME} verification code`,
    text,
    html: layout({
      preheader: `Your ${APP_NAME} verification code is ${code}.`,
      heading,
      intro,
      content,
      footerNote: `If you did not request this code, you can safely ignore this email — nothing will change on your account. Thank you for choosing ${APP_NAME}.`,
    }),
  };
}

function welcomeEmail({ name }) {
  const u = urls();
  const greeting = name ? `Welcome, ${String(name).split(' ')[0]}` : 'Welcome to 7 Audio';

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${MUTED};">
          <p style="margin:0 0 14px 0;">Thank you for signing up for ${APP_NAME}. We're happy to have you with us — you can start using the audio tools straight away and explore everything ${APP_NAME} has to offer.</p>
          <p style="margin:0 0 20px 0;">If you need more than the free daily credits, our premium plans start from <strong style="color:${INK};">₹49</strong> in India and from <strong style="color:${INK};">$1</strong> internationally.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0 4px 0;">${button('View Plans', u.pricing)}</td>
      </tr>
      <tr>
        <td align="center" style="padding:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${DIM};">
          Prices shown on the site follow your region. Choose the plan that suits you.
        </td>
      </tr>
    </table>`;

  const text = [
    `${greeting} 🎵`,
    '',
    `Thank you for signing up for ${APP_NAME}. We're happy to have you with us.`,
    '',
    'You can start using our audio tools and explore everything 7 Audio has to offer.',
    '',
    'Premium plans start from ₹49 in India, and from $1 internationally.',
    '',
    `View plans: ${u.pricing}`,
    '',
    `Questions: ${CONTACT_ADDRESS}`,
  ].join('\n');

  return {
    sender: 'welcome',
    subject: `Welcome to ${APP_NAME} 🎵`,
    text,
    html: layout({
      preheader: 'Thank you for signing up. Premium plans start from ₹49 in India and $1 internationally.',
      heading: `${greeting} 🎵`,
      intro: null,
      content,
      footerNote: `You are receiving this because an account was created with this email address on ${APP_NAME}.`,
    }),
  };
}

function purchaseEmail({ email, planName, amountLabel, currency, credits, files, cycle, orderId, paymentRef, purchasedAt }) {
  const u = urls();

  const validity =
    cycle === 'yearly' ? 'One year from today' : cycle === 'monthly' ? 'One month from today' : undefined;

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${MUTED};">
          <p style="margin:0 0 18px 0;">Your payment has been successfully received and your selected plan has been activated.</p>
        </td>
      </tr>

      <tr>
        <td style="padding:0 0 6px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFF;border:1px solid ${LINE};border-radius:14px;">
            <tr>
              <td style="padding:18px 20px 6px 20px;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:12px;color:${MUTED};letter-spacing:1px;text-transform:uppercase;">You have paid for</div>
                <div style="font-size:19px;font-weight:bold;color:${INK};padding-top:5px;">${esc(planName)}</div>
              </td>
            </tr>
            <tr>
              <td class="detail" style="padding:6px 20px 18px 20px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${detailRows([
                    ['Amount paid', amountLabel],
                    ['Currency', currency],
                    ['Credits included', credits ? `${Number(credits).toLocaleString('en-US')} credits` : ''],
                    ['Files included', files ? `Up to ${Number(files).toLocaleString('en-US')} files` : ''],
                    ['Plan validity', validity],
                    ['Purchase date', purchasedAt],
                    ['Order ID', orderId],
                    ['Payment reference', paymentRef],
                    ['Account', email],
                  ])}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${MUTED};padding:16px 0 18px 0;">
          <p style="margin:0;">Your plan is now available on your ${APP_NAME} account.</p>
        </td>
      </tr>

      <tr>
        <td style="padding:0 0 4px 0;">${button('Open 7 Audio', u.dashboard)}</td>
      </tr>

      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${MUTED};padding:22px 0 0 0;">
          <p style="margin:0 0 10px 0;">Thank you for choosing ${APP_NAME}. We appreciate your support and hope ${APP_NAME} helps you create, edit and transform your audio with ease.</p>
          <p style="margin:0;font-weight:bold;color:${INK};">Welcome to ${APP_NAME} Premium.</p>
        </td>
      </tr>
    </table>`;

  const text = [
    `Thank you for choosing ${APP_NAME}.`,
    '',
    'Your payment has been successfully received and your selected plan has been activated.',
    '',
    `You have paid for: ${planName}`,
    `Amount paid: ${amountLabel}`,
    credits ? `Credits included: ${Number(credits).toLocaleString('en-US')}` : '',
    validity ? `Plan validity: ${validity}` : '',
    orderId ? `Order ID: ${orderId}` : '',
    paymentRef ? `Payment reference: ${paymentRef}` : '',
    purchasedAt ? `Purchase date: ${purchasedAt}` : '',
    `Account: ${email}`,
    '',
    `Open 7 Audio: ${u.dashboard}`,
    '',
    `Thank you for choosing ${APP_NAME}. Welcome to ${APP_NAME} Premium.`,
    `Questions: ${CONTACT_ADDRESS}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    sender: 'purchase',
    subject: `Thank you for choosing ${APP_NAME}!`,
    text,
    html: layout({
      preheader: `Your payment was received and ${planName} is now active on your account.`,
      heading: `Thank you for choosing ${APP_NAME}!`,
      intro: null,
      content,
      footerNote: 'This is a record of your purchase. No card or bank details are stored in this email.',
    }),
  };
}

function paymentFailedEmail({ planName, orderId, reason }) {
  const u = urls();

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${MUTED};">
          <p style="margin:0 0 14px 0;">Your payment could not be confirmed.</p>
          <p style="margin:0 0 18px 0;"><strong style="color:${INK};">No premium plan has been activated for this transaction</strong>, and nothing has been charged to you by ${APP_NAME}. If your bank shows a pending amount, it is normally released automatically.</p>
        </td>
      </tr>
      ${
        planName || orderId
          ? `<tr><td style="padding:0 0 8px 0;">
               <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFF;border:1px solid ${LINE};border-radius:14px;">
                 <tr><td class="detail" style="padding:14px 20px;">
                   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                     ${detailRows([
                       ['Plan attempted', planName],
                       ['Order ID', orderId],
                       ['Status', reason],
                     ])}
                   </table>
                 </td></tr>
               </table>
             </td></tr>`
          : ''
      }
      <tr>
        <td style="padding:16px 0 4px 0;">${button('Try Again', u.pricing)}</td>
      </tr>
    </table>`;

  const text = [
    `Your ${APP_NAME} payment was not completed.`,
    '',
    'Your payment could not be confirmed.',
    'No premium plan has been activated for this transaction.',
    '',
    planName ? `Plan attempted: ${planName}` : '',
    orderId ? `Order ID: ${orderId}` : '',
    '',
    `You can return to ${APP_NAME} and try again: ${u.pricing}`,
    '',
    `Questions: ${CONTACT_ADDRESS}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    sender: 'purchase',
    subject: `Your ${APP_NAME} payment was not completed`,
    text,
    html: layout({
      preheader: 'Your payment could not be confirmed. No plan has been activated.',
      heading: 'Your payment was not completed',
      intro: null,
      content,
      footerNote: `If you believe this is a mistake, reply to this email or write to ${CONTACT_ADDRESS} and we will look into it.`,
    }),
  };
}

const TEMPLATES = {
  otp: otpEmail,
  welcome: welcomeEmail,
  purchase: purchaseEmail,
  paymentFailed: paymentFailedEmail,
};

/* --------------------------------------------------------------- sending -- */

let transporter = null;
let transportTried = false;

/**
 * Built once, lazily, from the server environment.
 *
 * AUDIO_SMTP_* takes precedence so 7 Audio can use its own mailbox; the older
 * SMTP_* variables are the fallback so an existing deployment keeps working
 * without being reconfigured.
 */
function getTransport() {
  if (transportTried) return transporter;
  transportTried = true;

  const host = process.env.AUDIO_SMTP_HOST || process.env.SMTP_HOST;
  const user = process.env.AUDIO_SMTP_USER || process.env.SMTP_USER;
  const pass = process.env.AUDIO_SMTP_PASS || process.env.SMTP_PASS;
  const port = +(process.env.AUDIO_SMTP_PORT || process.env.SMTP_PORT || 587);

  if (!host || !user) return null;

  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  } catch (e) {
    console.error('[audio-mail] nodemailer unavailable:', e.message);
  }
  return transporter;
}

function configured() {
  return Boolean((process.env.AUDIO_SMTP_HOST || process.env.SMTP_HOST) && (process.env.AUDIO_SMTP_USER || process.env.SMTP_USER));
}

/*
 * Every send is recorded, keyed. A second send for the same key is refused
 * before the transport is reached, which is what makes a retried webhook
 * harmless. The store is injected by the caller so it lives in the same
 * database as everything else and survives a restart.
 */
function ensureLog(db) {
  db.emails = db.emails || {};
  return db.emails;
}

function alreadySent(db, key) {
  const log = ensureLog(db);
  const record = log[key];
  return Boolean(record && record.status === 'sent');
}

function record(db, key, entry, persist) {
  const log = ensureLog(db);
  log[key] = { ...(log[key] || {}), ...entry, key };
  if (typeof persist === 'function') persist();
  return log[key];
}

/**
 * Render and send one email.
 *
 *   type    which template — otp | welcome | purchase | paymentFailed
 *   to      recipient
 *   data    template data
 *   key     idempotency key. A repeat send for the same key is refused.
 *   db      the database object, for the email log
 *   persist the caller's save function
 *   userId  recorded alongside, for support lookups
 *
 * Returns { ok, skipped?, reason?, delivered }. A failure to deliver never
 * throws to the caller by default — an email that does not arrive must not
 * roll back a payment that did.
 */
async function send({ type, to, data = {}, key, db, persist, userId, throwOnError = false }) {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`audio-mail: unknown email type "${type}"`);
  if (!to) throw new Error('audio-mail: no recipient');

  const idempotencyKey = key || `${type}:${to}:${Date.now()}`;

  if (db && alreadySent(db, idempotencyKey)) {
    return { ok: true, skipped: true, reason: 'already sent', delivered: false };
  }

  const message = template(data);
  const from = fromHeader(message.sender);
  const replyTo = replyToFor(message.sender);

  const base = {
    type,
    to,
    userId: userId || null,
    sender: SENDERS[message.sender].address,
    subject: message.subject,
    requestedAt: Date.now(),
  };

  const tx = getTransport();

  if (!tx) {
    // No mailbox configured. Say so plainly in the log rather than pretending
    // the email went out — and in development print enough to work with.
    if (type === 'otp') console.log(`[DEV OTP] ${to} -> ${data.code}`);
    else console.log(`[DEV MAIL] ${type} -> ${to} (${message.subject})`);
    if (db) record(db, idempotencyKey, { ...base, status: 'not-configured' }, persist);
    return { ok: false, delivered: false, reason: 'email is not configured on this server' };
  }

  try {
    const info = await tx.sendMail({
      from,
      to,
      replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (db) record(db, idempotencyKey, { ...base, status: 'sent', sentAt: Date.now(), messageId: info && info.messageId }, persist);
    return { ok: true, delivered: true, messageId: info && info.messageId };
  } catch (e) {
    console.error('[audio-mail]', type, 'to', to, 'failed:', e && e.message);
    if (db) record(db, idempotencyKey, { ...base, status: 'failed', failedAt: Date.now(), error: String(e && e.message) }, persist);
    if (throwOnError) throw e;
    return { ok: false, delivered: false, reason: 'delivery failed' };
  }
}

/** Keys, in one place, so two call sites cannot disagree about them. */
const keyFor = {
  // Purchases are keyed on the verified order id — unique per payment, which
  // is exactly what makes a retried webhook harmless.
  purchase: (orderId) => `purchase:${orderId}`,
  failed: (orderId) => `payment-failed:${orderId}`,
  // One welcome per account, ever.
  welcome: (userId) => `welcome:${userId}`,
  // OTPs are deliberately NOT deduplicated — each request is a new code. The
  // per-IP rate limit is what prevents abuse.
  otp: (email, code) => `otp:${String(email).toLowerCase()}:${code}`,
};

module.exports = {
  SENDERS,
  CONTACT_ADDRESS,
  APP_NAME,
  configured,
  send,
  keyFor,
  urls,
  // Exported for tests: render without sending.
  render: (type, data) => TEMPLATES[type](data),
  fromHeader,
  replyToFor,
};
