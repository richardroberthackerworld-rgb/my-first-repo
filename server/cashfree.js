'use strict';

/**
 * Cashfree Payment Gateway helpers.
 *
 * Deliberately dependency-free — Node's built-in fetch and crypto are enough,
 * so this adds nothing to the install and cannot drift with an SDK version.
 *
 * Security notes that matter:
 *   - The amount ALWAYS comes from the server-side plan table, never from the
 *     client. A client that posts {plan:'pro'} cannot choose what it pays.
 *   - Webhook signatures are computed over the RAW request body. Parsing the
 *     JSON first and re-serialising it produces a different byte sequence and
 *     the signature will never match.
 */

const crypto = require('crypto');

const API_VERSION = '2023-08-01';

function baseUrl() {
  // Anything other than an explicit "production" stays on sandbox, so a missing
  // env var can never accidentally take real money.
  return String(process.env.CASHFREE_ENV || '').toLowerCase() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function configured() {
  return !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

/**
 * Create a Cashfree order.
 * Returns { orderId, paymentSessionId } — the session id is what the browser
 * checkout SDK needs. No secret ever reaches the client.
 */
async function createOrder({ orderId, amount, currency, customer, returnUrl, notes }) {
  if (!configured()) throw new Error('Cashfree is not configured');

  const response = await fetch(`${baseUrl()}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    },
    body: JSON.stringify({
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: currency,
      customer_details: {
        customer_id: customer.id,
        customer_email: customer.email,
        // Cashfree requires a phone; a placeholder is accepted for digital goods.
        customer_phone: customer.phone || '9999999999',
        customer_name: customer.name || undefined,
      },
      order_meta: returnUrl ? { return_url: returnUrl } : undefined,
      order_note: notes || undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data && (data.message || data.error_description);
    const error = new Error(reason || `Cashfree order failed (${response.status})`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return { orderId: data.order_id, paymentSessionId: data.payment_session_id, raw: data };
}

/** Ask Cashfree directly what happened to an order. Never trust the browser. */
async function fetchOrder(orderId) {
  if (!configured()) throw new Error('Cashfree is not configured');
  const response = await fetch(`${baseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      'x-api-version': API_VERSION,
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((data && data.message) || `Cashfree order lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * Verify a webhook.
 *
 * Cashfree signs `timestamp + rawBody` with the Client Secret Key using
 * HMAC-SHA256, base64 encoded. `rawBody` must be the exact bytes received.
 * Compared in constant time so the check cannot be probed by timing.
 */
function verifyWebhook({ rawBody, signature, timestamp }) {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;
  if (!secret || !signature || !timestamp) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = crypto.createHmac('sha256', secret).update(String(timestamp) + body).digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Reject webhooks whose timestamp is far from now, so a captured-and-replayed
 * request cannot be used indefinitely.
 */
function timestampFresh(timestamp, toleranceSeconds = 15 * 60) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  // Cashfree sends seconds; accept milliseconds defensively.
  const seconds = value > 1e12 ? Math.floor(value / 1000) : value;
  return Math.abs(Math.floor(Date.now() / 1000) - seconds) <= toleranceSeconds;
}

module.exports = { configured, createOrder, fetchOrder, verifyWebhook, timestampFresh, baseUrl, API_VERSION };
