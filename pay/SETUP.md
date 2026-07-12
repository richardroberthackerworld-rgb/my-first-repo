# 7Pay — 7By's own payment gateway

Hosted checkout + merchant API + JS SDK + dashboard, in plain PHP.
Deploy this folder to **pay.7by.in** via cPanel File Manager.

## What's in here

| File | What it is |
|---|---|
| `config.php` | DB, merchants (key_id / key_secret / mode / webhook), UPI VPA |
| `lib.php` | DB auto-migrate (SQLite or MySQL), signatures, webhooks |
| `api.php` | Merchant JSON API + checkout endpoints |
| `checkout.php` | Hosted checkout page (card / UPI / netbanking) |
| `checkout.js` | Drop-in SDK — same shape as Razorpay's |
| `dashboard.php` | Merchant dashboard: stats, approve pending UPI, refunds |
| `index.php` | Landing page + integration docs |
| `demo.php` | End-to-end demo store (test merchant) — optional, deletable |

## Deploy (cPanel)

1. Upload the `pay/` folder to the subdomain root for `pay.7by.in`.
2. Edit `config.php`:
   - Set `app_secret` to a long random string.
   - Change every merchant `key_secret` and `webhook_secret`.
   - Set `upi.vpa` to your real UPI ID (live mode payments go straight there).
   - DB: SQLite works as-is (`data/` is created automatically and must be
     writable). For MySQL, create a DB in cPanel and set `driver` to `mysql`.
3. Protect `data/` from web access (SQLite file). Add `pay/.htaccess` already
   included, or verify `https://pay.7by.in/data/sevenpay.sqlite` 404s/403s.
4. Visit `https://pay.7by.in/demo.php` and make a test payment
   (card `4111 1111 1111 1111`, any future expiry, any CVV).

## Payment methods

| Method | Test mode | Live mode |
|---|---|---|
| Card | Simulated (Luhn-valid succeeds, `…0002` declines) | Hidden (real card processing needs a PCI/bank setup) |
| UPI — QR scanner + Google Pay / PhonePe / Paytm / BHIM | Simulated (dummy VPA, app taps auto-succeed, `fail@upi` declines) | Real: QR + app deep links pay **your VPA** directly; buyer submits the UTR |
| NetBanking | Simulated bank picker | Hidden |
| PayPal (international) | Simulated instant success | Real: buyer pays your **PayPal.me** link; submits the Transaction ID |

Currencies: **INR, USD, EUR, GBP, AED** (`order.create`). Price by visitor
country with `gw_geo_currency()` (India → ₹, US → $, UAE → AED, UK → £,
eurozone → €, everywhere else → $; `?currency=XXX` overrides) — see
`demo.php` for the pattern. UPI shows only on INR orders; PayPal covers the
rest. Note: PayPal.me does not accept INR or AED — for live AED buyers either
create the order in USD or take cards when you add a card processor.

## Automatic UPI confirmation (no UTR, no manual approval)

Your bank sends an SMS the moment money lands in your account. Forward that
SMS to the gateway and payments confirm themselves — the buyer just pays and
the checkout completes on its own:

1. In `config.php` → `upi_auto`, set a long random `token`
   (e.g. `openssl rand -hex 24`).
2. On the phone that receives your bank SMS, install an SMS-forwarder app
   (e.g. **"SMS Forwarder — Auto forward"** by frzinapps on Play Store, or
   Macrodroid/Tasker). Create a rule:
   - **Filter:** sender contains your bank's SMS ID (e.g. `HDFCBK`, `SBIUPI`) —
     or simply messages containing the word `credited`
   - **Forward to webhook / URL (POST):**
     `https://7pay.7by.in/api.php?action=upi.credit&token=YOUR_TOKEN`
   - **Body:** JSON `{"text":"%m"}` (the app's placeholder for the SMS text) —
     a raw/form body with the SMS text also works
3. Done. Flow: the checkout **reserves the payment the moment it opens** and
   assigns a **unique amount** — base price + 0–99 paise (₹27.00, ₹27.01,
   ₹27.02 …) — which is pre-filled into the QR and app links. The buyer pays,
   your bank SMS arrives, the forwarder posts it, the gateway parses
   `Rs 27.01 credited … UPI Ref 5123…` and the exact amount identifies exactly
   one buyer. It captures, fires the webhook (hub grants credits), and the
   buyer's page — which polls from the moment it opened — flips to success by
   itself, even if they never tapped a button.

Because every concurrent payment has a distinct amount, **any number of
buyers can pay in the same minute and all auto-verify**. Up to 100 concurrent
pending payments per price point (paise 00–99); beyond that the dashboard
fallback catches the rest.

Safety nets: the same UPI reference can never capture two payments; credits
with no matching pending payment are ignored; reservations expire after
`window_minutes`; and the dashboard's manual Approve/Reject still works any
time (e.g. if your phone was off).

## Test vs live

- `mode => 'test'` — everything simulated, no real money.
- `mode => 'live'` — UPI (INR) and PayPal (international) are real collect
  flows: the payment goes **pending** with the buyer's reference (UTR /
  PayPal TXN ID), you approve it in `dashboard.php` after checking your
  bank/PayPal, and money lands in your account with **no gateway commission**.
  Approval fires the `payment.captured` webhook and the buyer's checkout
  (which polls) completes with a signature.
- For live PayPal, set `paypal.me_link` in `config.php`. Note PayPal.me does
  not accept INR — it's for the international (USD/EUR/GBP) side.

## Account-hub integration (already wired)

`account-hub/config.php` has a `gateway` switch (`'sevenpay'` or `'razorpay'`):

- Set `sevenpay.base_url` to `https://pay.7by.in` and copy the `7pay_7by`
  key/webhook secrets from `pay/config.php`.
- In `pay/config.php`, point the `7pay_7by` merchant's `webhook_url` at
  `https://account.7by.in/api.php?action=sevenpay_webhook` — this is what
  grants credits automatically when you approve a live UPI payment.

Signature scheme is Razorpay-compatible: `HMAC-SHA256(order_id|payment_id, key_secret)`.

## Local dev

```
php -S localhost:7521 -t pay
```
(SQLite driver — zero setup. The repo's `.claude/launch.json` has a
`sevenpay` entry using the portable PHP at `~/.claude/tools/php`.)
