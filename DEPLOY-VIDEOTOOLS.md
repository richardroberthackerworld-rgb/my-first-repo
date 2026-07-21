# Publishing VidLab / ClipCut on a subdomain

Two zips are in this folder. **Both are needed.**

| Zip | Goes where |
|---|---|
| `video-subdomain.zip` (521 KB) | the **subdomain** document root |
| `main-site-addons.zip` (18 KB) | `public_html` of **7by.in** |

Neither one overwrites an existing page on your main site.

The subdomain is set to **`video.7by.in`**. To use a different name, run
`.\make-videotools-zip.ps1 -Subdomain clip.7by.in` and re-upload.

---

## Step 1 — Create the subdomain

1. cPanel → **Domains → Create A New Domain** (or **Subdomains**).
2. Domain: **`video.7by.in`**
3. **Uncheck** "share document root". Let it create
   `/home/USER/video.7by.in` as the document root.
4. cPanel → **SSL/TLS Status → Run AutoSSL** so `https://` works.

## Step 2 — Upload the site

1. **File Manager** → open the new `video.7by.in` folder.
2. **Upload** `video-subdomain.zip`.
3. Right-click it → **Extract** → into that same folder.
4. Delete the zip.

## Step 3 — Upload the main-site files

1. **File Manager** → open `public_html`.
2. **Upload** `main-site-addons.zip` → **Extract** there.
3. Delete the zip.

This adds `ads.txt` (AdSense reads it from the **root** domain, even for
subdomain traffic — this is required), fixes `https://7by.in/pricing`
which was returning 404, and adds three `assets/*.js` files that were
missing from your live server.

---

## Check it worked

- https://video.7by.in/ — tool hub
- https://video.7by.in/editor/ — ClipCut editor
- https://video.7by.in/pricing — Get Pro
- https://video.7by.in/blog/ — 4 articles
- https://7by.in/ads.txt — should show one line of text

---

## After it's live

1. **Google Search Console** → add `video.7by.in` as a property (a subdomain
   counts as a separate site) → submit `https://video.7by.in/sitemap.xml`.
2. **AdSense** → apply / request review. The site has 4 original articles and
   6 working tools, which is what they look for. `ads.txt` can take a day or
   two to be picked up — that is normal.
3. Do one real ₹27 payment end to end to confirm Razorpay credits the
   account, then refund yourself.

### A note on sign-in

Browsers keep logins separate per domain, so a visitor signed in on
`7by.in` will need to sign in again on `video.7by.in`. Their **credits are
the same** either way, because the balance lives on your server
(`api.7by.in`), not in the browser. Pricing is included on the subdomain so
people can sign in, pay and use their credits without ever leaving it.

---

## Changing the site later

Edit the files in `videotools/`, then run in PowerShell from this folder:

```powershell
.\make-videotools-zip.ps1
```

Re-upload whichever zip changed.

## Previewing on your own PC

Double-click **`OPEN-SITE.bat`** — it serves `videotools/` exactly the way
the subdomain will, at http://localhost:8080/. Keep the black window open
while using it; close it to stop.

(Opening the HTML files directly by double-clicking does **not** work —
browsers block the background worker the video engine needs on `file://`
pages.)
