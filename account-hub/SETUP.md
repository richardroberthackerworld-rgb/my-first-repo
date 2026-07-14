# 7By Account Hub — setup

This is the shared backend for logins, credits and payments across **all** your tools
(RemoveBG, VocalRemover, and any future tool). Each tool checks credits here.

**Model:** 1 export = 1 credit. Monthly ₹27 = 100 credits (30 days). Yearly ₹299 = 1400 credits (1 year).
Credits are one shared balance per account and work on every tool.

---

## 1. Create the subdomain
In cPanel → **Domains / Subdomains**, create `account.7by.in`. Note its document root
(e.g. `/home/USER/account.7by.in`).

## 2. Upload these files
Upload the entire `account-hub/` folder contents into that document root via **File Manager**:
```
config.php
lib.php
api.php
index.php
assets/account.css
assets/account.js
```

## 3. Create the database
cPanel → **MySQL Databases**: create a database and a user, and add the user to the database
with **All Privileges**. The tables are created automatically on first run.

## 4. Fill in config.php
Edit `config.php` and set:
- **db**: your database name, user, password.
- **app_secret**: any long random string.
- **allowed_origins**: every tool subdomain that will use the hub (already lists removebg + vocalremover).
- **razorpay**: your Key ID, Key Secret (from Razorpay dashboard → Settings → API Keys), and (optional) webhook secret.
- **google.client_id**: see step 5.

## 5. Google Sign-In
1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. Create an **OAuth client ID**, type **Web application**.
3. Under **Authorised JavaScript origins** add: `https://account.7by.in`.
4. Copy the **Client ID** into `config.php` → `google.client_id`.

## 6. Razorpay webhook (recommended)
Razorpay dashboard → **Settings → Webhooks** → add:
- URL: `https://account.7by.in/api.php?action=webhook`
- Secret: same string you put in `config.php` → `razorpay.webhook_secret`
- Event: `payment.captured`

This is a safety net so credits are granted even if the browser closes mid-redirect.

## 7. HTTPS is required
Cross-subdomain login uses a cookie with `SameSite=None; Secure`, which only works over HTTPS.
cPanel → **SSL/TLS Status** → run AutoSSL for `account.7by.in` (and each tool subdomain).

---

## How the tools connect
Each tool's `config.js` (or the WordPress theme's `functions.php`) has:
```js
accountHub: 'https://account.7by.in',
product: 'removebg',   // 'vocalremover' on that site, etc.
```
The tool's `pro.js`:
- calls `…/api.php?action=me` on load to read login + credits,
- shows a credits chip in the nav and an **Account** tab,
- on every export, calls `…/api.php?action=consume` to spend 1 credit,
- sends users to `account.7by.in` to log in / buy when they have no credits.

**To add VocalRemover (or any tool):** drop the same `pro.js` + `config.js` in, set `product`
to that tool's name, add its subdomain to `allowed_origins` in the hub's `config.php`, and add
the credits chip + Account tab markup. Done — same login, same credit balance.

## Testing
1. Use Razorpay **test keys** first. Open `https://account.7by.in`, sign up, and you'll see your
   free trial credits.
2. Buy a plan with a Razorpay **test card** — credits should jump to 100 / 1400.
3. Open the tool, edit an image, and export — the credit count should drop by 1.
4. Switch to **live keys** once you've confirmed the flow and completed Razorpay KYC.

## Security note
Payments are verified server-side (the Razorpay signature is checked in `api.php` before any
credits are granted), and the credit balance lives in the database, not the browser — so it
can't be forged. Keep your **Key Secret** only in `config.php`; never put it in any JavaScript file.
