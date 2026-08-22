# Deploying 7 Audio

Two things ship, and they ship together:

| Package | Goes to | Contains |
|---|---|---|
| `7audio-site.zip` (10.45 MB, 124 files) | `7audio.7by.in` web root | the site, the PWA, the tools, 25 articles |
| `7audio-api.zip` (48 KB, 11 files) | the Node app behind `api.7by.in` | accounts, credits, Cashfree, all four emails |

Deploying only the site leaves sign-in, credits, checkout and every email broken,
because all of those live in the API.

Both packages also exist as `.tar.gz`. Use those if your host's ClamAV rejects
the zip — Sanesecurity's Foxhole rules flag *any* zip containing `.js`, which
this one unavoidably does. The tarball carries identical files.

---

## Part 1 — the API

### 1.1 Upload

cPanel → **Setup Node.js App**. If the app already exists, note its
*Application root* and skip to 1.2.

Creating it fresh:

- Node version: **18 or newer**
- Application mode: **Production**
- Application root: e.g. `api`
- Application URL: `api.7by.in`
- Application startup file: `server.js`

Then File Manager → the application root → upload `7audio-api.zip` → **Extract**.
Overwrite when asked. `.env` and `db.json` are deliberately **not** in the
package, so extracting cannot destroy your secrets or your customer data.

### 1.2 Environment variables

In the Node app panel, add these. **Never put any of them in the site build.**

Already set if the backend was running before — leave them alone:

```
JWT_SECRET              a long random string
GOOGLE_CLIENT_ID        795705423816-2ffl53j83vir4mvau9mo4883afqc8khp.apps.googleusercontent.com
CASHFREE_ENV            sandbox   (literally "production" to charge real money)
CASHFREE_APP_ID         ...
CASHFREE_SECRET_KEY     ...
CASHFREE_WEBHOOK_SECRET ...
```

**`CORS_ORIGIN` — check this one even if the API was already running.** It is
the commonest cause of a site that loads but cannot sign in, and it fails
silently: the browser blocks the response and the server logs an ordinary 200.

```
CORS_ORIGIN             https://7audio.7by.in,https://7by.in,https://account.7by.in,http://localhost:3190,http://localhost:3191
```

No trailing slashes — a browser sends `https://7audio.7by.in`, never with one.
The server strips them defensively, but do not rely on that.

**`CASHFREE_RETURN_URL`** is now optional. Left unset it is derived from
`AUDIO_SITE_URL` as `<site>/credits?order={order_id}`, so setting the site URL
correctly is enough. Set it explicitly only if you want customers returned
somewhere other than the credits page:

```
CASHFREE_RETURN_URL     https://7audio.7by.in/credits?order={order_id}
```

`GOOGLE_CLIENT_ID` must match the value compiled into the site build — the
server verifies the ID token's audience against it, so a mismatch rejects every
sign-in even when the browser side worked.

New, for the email system:

```
AUDIO_MAIL_DOMAIN      7audio.7by.in
AUDIO_SMTP_HOST        smtp.<your mail host>
AUDIO_SMTP_PORT        587
AUDIO_SMTP_USER        noreply@7audio.7by.in
AUDIO_SMTP_PASS        <mailbox password>
AUDIO_SITE_URL         https://7audio.7by.in
AUDIO_PRICING_URL      https://7audio.7by.in/pricing
AUDIO_DASHBOARD_URL    https://7audio.7by.in/dashboard
AUDIO_LOGO_URL         https://7audio.7by.in/brand/icon-192.png
```

### 1.3 Install and start

In the Node app panel: **Run NPM Install**, then **Restart**.

`node_modules` is not in the package — it is built on the server, which is both
smaller to upload and correct for the server's own architecture.

### 1.4 Confirm it came up

```bash
curl https://api.7by.in/api/health
```

Expect `{"ok":true}`.

Then check the startup log. You want:

```
✓ 7 Audio email ready: noreply@7audio.7by.in, welcome@7audio.7by.in, thankyou@7audio.7by.in, contact@7audio.7by.in
```

You should **not** see either of these:

```
⚠ CORS_ORIGIN does not include https://7audio.7by.in — the site will not be able to reach this API.
⚠ Neither CASHFREE_RETURN_URL nor AUDIO_SITE_URL is set — customers will not be returned to the site after paying.
```

Both describe failures that are otherwise invisible until a customer hits them.

If it says `⚠ 7 Audio email not configured`, `AUDIO_SMTP_HOST` or
`AUDIO_SMTP_USER` is missing and **no email will leave the server** — the app
keeps working, and every send is logged as `not-configured` rather than
silently pretending to have gone.

---

## Part 2 — the site

### 2.1 Point the build at the API

This is the step that is easy to miss, and everything depends on it.

`audiora/.env.production.local` — create it if it does not exist:

```
VITE_AUDIORA_API=https://api.7by.in
VITE_GOOGLE_CLIENT_ID=795705423816-2ffl53j83vir4mvau9mo4883afqc8khp.apps.googleusercontent.com
```

Both values are public by design — the client ID is meant to be in the page, and
the API base is just a URL. **The client *secret* never goes here.**

> Use `.env.production.local`, not `.env.local`. Vite loads `.env.local` in every
> mode including a production build, so a localhost URL left there gets compiled
> into the shipped bundle.

Then rebuild so the values are baked in:

```powershell
.\make-7audio-zip.ps1
```

Skipping this ships a site with no backend configured: the tools still work, but
sign-in, credits and checkout are hidden.

### 2.1b Authorise the domain with Google

**Google sign-in will fail until this is done**, with an origin-mismatch error
rather than anything that explains itself.

7 Audio uses the same OAuth client as the 7By account hub — correct, because the
backend is shared and one person signing in on either site is the same account.
That client currently lists only `https://account.7by.in` as an authorised
origin.

Google Cloud Console → APIs & Services → Credentials → the Web client
`795705423816-…apps.googleusercontent.com` → **Authorised JavaScript origins**
→ add all three:

```
https://7audio.7by.in
http://localhost:3190
http://localhost:3191
```

The two localhost entries let sign-in work while developing — 3190 is the dev
server, 3191 is the production preview. Google accepts `http` for localhost
specifically; every other origin must be `https`.

Note there is **no trailing slash and no path**. An origin is scheme, host and
port only; `https://7audio.7by.in/` is rejected as malformed.

Two things to check alongside it:

- The server's `GOOGLE_CLIENT_ID` must be this same value. The server verifies
  the ID token's audience against it, so a mismatch means every sign-in is
  rejected even though the browser side worked.
- The client **secret** stays on the server. It is not needed for this flow and
  must never appear in the site build.

Changes to authorised origins can take a few minutes to propagate.

### 2.2 Upload

File Manager → `public_html` (or the document root for `7audio.7by.in`).

Upload `7audio-site.zip` → **Extract**.

**Extract the contents into the web root, not a folder.** `index.html` and
`.htaccess` must sit directly in the root. If you end up with
`public_html/7audio-site/index.html`, move everything up one level.

Then confirm these survived the upload — each one breaks something specific if
it did not:

| Path | Breaks if missing |
|---|---|
| `.htaccess` | every deep link 404s on refresh |
| `workers/` | the AI tools and noise removal cannot start |
| `worklets/pitch-processor.js` | the live pitch preview |
| `ffmpeg/` | FLAC, M4A, OGG and AAC export |
| `.well-known/assetlinks.json` | the Android app shows a browser address bar |
| `sw.js` | installability |

File Manager hides dotfiles by default — turn on "Show Hidden Files" or you will
think `.htaccess` and `.well-known` are missing when they are not.

### 2.3 Confirm

```bash
curl -I https://7audio.7by.in/pricing
curl -s https://7audio.7by.in/tools/vocal-remover | grep -o "<title>[^<]*"
curl -I https://7audio.7by.in/sw.js
curl -s https://7audio.7by.in/.well-known/assetlinks.json
```

- `/pricing` → `200`, not `404`. A 404 means `.htaccess` is missing or
  `mod_rewrite` is off.
- The tool page title must be *"Free AI Vocal Remover — …"*, not the homepage
  title. If every page has the same title, the per-route files were not
  extracted, or the host is not serving directory indexes.
- `sw.js` must return `Cache-Control: no-cache`. If it is cached, a future bad
  worker cannot be replaced.

### 2.4 Confirm cross-origin isolation

This is the one part of the deploy that fails **silently**. Isolation is what
gives the browser `SharedArrayBuffer`, and that is what lets the AI separation
run on every CPU core instead of one — measured at 11 threads against 1 on a
12-core machine. If the headers do not arrive, nothing breaks and nothing is
logged. Separation just runs several times slower, forever, and you would have
no reason to look.

```bash
curl -sI https://7audio.7by.in/ | grep -i cross-origin
```

Both of these must come back:

```
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
```

If they are missing, `mod_headers` is not enabled. On cPanel, that is usually
Software → "Apache Modules", or a support ticket. Nothing else in the site
depends on `mod_headers`, so this is the only symptom you will get.

Then check the rule that keeps the ffmpeg vendor modules out of the HTTP cache:

```bash
curl -sI https://7audio.7by.in/ffmpeg/esm/worker.js | grep -i cache-control
```

Expect `no-store`. If it says anything else, `mod_setenvif` is off. The site
still works; the risk is narrower — see the note in `.htaccess` for why those
six small files cannot carry a version stamp of their own.

Finally, confirm it end to end in a browser. Open the site, then in DevTools:

```js
crossOriginIsolated   // must be true
```

If `curl` shows both headers but this is `false`, something in front of Apache
is stripping or overriding them — a CDN or proxy is the usual cause.

---

## Part 3 — DNS for email

**This has not been done, and I could not do it — I have no access to your DNS.**
Until it is, Gmail will progressively start filing your verification codes as
spam, which looks to a customer exactly like the site being broken.

Full instructions with the exact record values: **`server/EMAIL-SETUP.md`**.

In short, on `7audio.7by.in`:

| Type | Name | Purpose |
|---|---|---|
| TXT | `7audio` | SPF — one record only; merge if one exists |
| TXT | `<selector>._domainkey.7audio` | DKIM — the key comes from your mail host |
| TXT | `_dmarc.7audio` | DMARC — start at `p=none` |
| MX | `7audio` | so replies to `contact@` are actually delivered |

Create four mailboxes first: `noreply@`, `welcome@`, `thankyou@`, and
`contact@`. The first three are send-only; **`contact@` needs a real inbox a
person reads** — it is the reply-to on every email and it is printed on the
contact page.

Verify by signing up with a Gmail address, opening the message, and using
Gmail's **Show original**. You want `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

---

## Part 4 — Cashfree webhook

Cashfree Dashboard → Developers → Webhooks:

- URL: `https://api.7by.in/api/pay/cashfree/webhook`
- Events: `PAYMENT_SUCCESS_WEBHOOK`, plus the failure events if you want the
  "payment not completed" email to go out
- Copy the signing secret into `CASHFREE_WEBHOOK_SECRET` and restart the app

The webhook is what grants credits and sends the receipt. A customer landing on
a success page grants nothing — that is deliberate, and it is why the webhook
has to be reachable from the public internet.

Retries are safe: credits are granted once and the receipt is sent once, keyed
on the verified order id.

---

## Part 5 — smoke test on the live site

Ten minutes, in this order. Each step depends on the one before.

1. **Load the site.** Open `https://7audio.7by.in`, hard-refresh.
2. **Free tool.** Open the Audio Cutter, load a file, trim it, download. Works
   signed out and with no backend involvement — if this fails, the problem is
   the upload, not the API.
3. **Guest credits.** Open the Vocal Remover. The header should show **10**.
   If the credit chip is absent, `VITE_AUDIORA_API` was not set at build time.
4. **Sign in.** Gmail account. If the Google button does nothing, or the popup
   closes immediately, the domain is not in the client's authorised origins —
   see 2.1b. You should land back on the dashboard with 20
   credits, and a **welcome email from `welcome@7audio.7by.in`** should arrive.
   Check it is not in spam — if it is, DNS is not done.
5. **Non-Gmail.** Try any non-Gmail address and confirm the plain refusal
   sentence appears.
6. **A paid run.** Run the Vocal Remover on a short track. Credits drop by 10,
   two files come out. While it runs, open DevTools → Console: the separation
   worker reports its thread count once the model has loaded, e.g.
   `{"type":"loaded","ep":"cpu","threads":11}`. **`threads: 1` means isolation
   is not active** — go back to 2.4. The run still succeeds either way, which is
   exactly why this is worth looking at once.
7. **Checkout, in sandbox.** With `CASHFREE_ENV=sandbox`, buy Starter with a
   Cashfree test card. Then confirm all four:
   - credits increased by the plan amount;
   - a **receipt from `thankyou@7audio.7by.in`** arrived, naming the plan,
     amount and order ID;
   - the receipt's **Open 7 Audio** button lands on your dashboard;
   - Cashfree's dashboard shows the webhook delivered `200`.
8. **Install.** On a phone, use the browser's Install / Add to Home Screen and
   confirm it opens without a browser bar.

Only after step 7 passes end to end should you set `CASHFREE_ENV=production`.

---

## Rollback

Keep the previous `7audio-site.zip` and `7audio-api.zip`. Rolling back is
re-extracting the older one and restarting the Node app.

`db.json` is never in either package, so a rollback cannot lose accounts,
credits, orders or the email log.

---

## What is not deployed by any of this

- **The Android app.** The bundle IS built —
  `7audio-release-unsigned.aab`, 1.5 MB, at the repo root — but it is unsigned,
  and Play will not accept it that way. Signing needs a keystore password, so
  it is a step for you: see `android/7audio/BUILD-AAB.md`.

  (An earlier version of this file said no JDK, Gradle or Android SDK existed
  here. That was wrong — JDK 21 and the full SDK are installed.)
- **`assetlinks.json` still has a placeholder fingerprint.** It ships, but the
  Android app will show an address bar until you replace it with your Play App
  Signing SHA-256.
- **The Play Store link.** `audiora/src/config/site.ts` has
  `playStoreUrl: null`, so the promo card refuses to link anywhere rather than
  inventing a URL. Fill it in and rebuild once the listing is live.
