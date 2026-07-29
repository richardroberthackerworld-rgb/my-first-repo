# Deploying 7Hand to `7hand.7by.in`

Build: `.\make-hand-zip.ps1` → `hand-site.zip` (78 KB)

Static files plus one PHP endpoint. No Node, no build step, no database.

---

## Before you start: this contradicts a decision you made

On 2026-07-27 the plan settled on **full infrastructure isolation** for this
product — separate domain, separate payment merchant, no AdSense — recorded as
decision D17 in the design doc.

The reason was blast radius. A handwriting-assignment product sits close to what
payment processors call an essay mill. Razorpay's restricted-business list
covers that territory, and one complaint against a product on `7by.in` can
freeze the merchant account that currently processes **7Solve, 7Marks, 7Compare
and 7Pay**. AdSense manual actions can likewise be domain-level.

Putting this on `7hand.7by.in` reverses that. Four earning products now share a
domain and a payment rail with this one.

**It is your call and this guide deploys what you asked for.** Three things
reduce the exposure a lot for very little effort:

1. **No AdSense on this subdomain.** The build ships without it; keep it that
   way. This is the single cheapest risk reduction available.
2. **Keep payments off this property** until it has its own merchant account.
   Nothing in this build takes money, so today this costs you nothing.
3. **Own the framing.** The product transcribes what a student is required to
   copy by hand. That is a defensible position and the copy on the landing page
   already takes it. Do not add "write my assignment for me" language.

---

## 1. Create the subdomain

cPanel → **Domains → Create A New Domain**

- Domain: `7hand.7by.in`
- **Uncheck** "share document root"
- Document root: `/home/USER/7hand.7by.in`

Then **SSL/TLS Status → Run AutoSSL** so `https://` works.

## 2. Upload

1. File Manager → open `/home/USER/7hand.7by.in`
2. Upload `hand-site.zip`
3. **Extract** it there
4. Delete the zip

The folder should now contain `index.html`, `app.html`, `sheet.html`, `src/`,
`tools/`, `api/`, `.htaccess`, `robots.txt`, `sitemap.xml`, `favicon.svg`.

> If `.htaccess` did not appear, turn on **Settings → Show Hidden Files** in
> File Manager and extract again. Without it, clean URLs and the caching rules
> are missing.

## 3. Check it before configuring anything

Visit `https://7hand.7by.in` — the landing page should load.

Then confirm these three, in this order:

| Visit | Expected |
|---|---|
| `/app` | the writing app (clean URL, no `.html`) |
| `/app.html` | redirects to `/app` |
| `/test.html` | **403 Forbidden** |

**Everything except AI transcription works at this point.** People can learn a
hand from a photo by typing the transcript, and export PDFs. You can stop here.

## 4. Optional: turn on AI transcription

This automates one step — typing out what the page says. Nothing else depends
on it.

```
cd /home/USER/7hand.7by.in/api
cp config.example.php config.php
```

Edit `config.php`, put a free Gemini key in `keys.gemini`:
<https://aistudio.google.com/apikey> — no card, about 1500 requests/day.

Then create the rate-limit folder and lock it down:

```
mkdir -p .state
chmod 700 .state
chmod 600 config.php
```

### Then verify the key is not exposed

Do these two checks. The first one matters more than anything else on this page.

1. Open `https://7hand.7by.in/api/config.php` in a browser.
   **It must show 403 or a blank page — never your key as text.**
   If your key appears, delete the file immediately, treat the key as
   compromised, revoke it in Google AI Studio, and do not retry until
   `api/.htaccess` is present.
2. Open `/tools/learn`, upload a photo, press **Read it for me**.
   In devtools → Network, the request should go to your own domain and the
   response should contain text but no key.

`config.js` in the site root must keep `proxy: './api/ocr.php'` and leave
`devKeys` empty. Those dev keys put the key in page source; they exist for
testing on your own machine only.

---

## What is NOT in this build

- **No paywall.** Everything runs client-side and the server only sees
  transcription requests. Nothing limits how much anyone exports. If you want
  to charge, that needs server-side export gating first, and a merchant account
  that is not the shared one.
- **No AdSense.** Deliberate, see above.
- **No account-hub integration.** Deliberate, same reason. Note the credits
  system would have needed no backend work — `account-hub/lib.php:542`
  `tool_key()` already accepts any string — so this is a decision, not a
  limitation.
- **No analytics.**

## Updating later

Rebuild, upload, extract over the top. `api/config.php` and `api/.state/` are
excluded from every build, so a redeploy never overwrites your key.

`.htaccess` caches JS and CSS for one hour with revalidation, so a deploy is
picked up within the hour without users having to hard-refresh. HTML is not
cached at all.

## Files the build refuses to ship

`make-hand-zip.ps1` strips `api/config.php` and `api/.state/` from every build,
and **aborts** if either reaches staging or if anything key-shaped appears in
the output. A leaked API key is the one mistake here that cannot be undone.
