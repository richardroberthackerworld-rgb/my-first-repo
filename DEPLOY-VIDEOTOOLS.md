# Publishing VidLab / ClipCut on 7by.in

Everything you need is in **`videotools-live.zip`** (in this folder, ~226 KB).

It contains only new files. It will **not** overwrite your homepage or any
existing page.

---

## Steps (about 5 minutes)

1. Log in to **cPanel** → open **File Manager**.
2. Go into **`public_html`** (the folder where `index.html` and `assets` already are).
3. Click **Upload**, choose `videotools-live.zip`, wait for it to finish.
4. Back in File Manager, right-click the uploaded zip → **Extract** → extract into `public_html`.
5. Delete the zip file (optional, keeps things tidy).

Done. Check these links:

- https://7by.in/videotools/
- https://7by.in/videotools/editor/
- https://7by.in/pricing

---

## What gets added

| Path | Why |
|---|---|
| `videotools/` | The whole app: 6 tools, ClipCut editor, 4 blog posts |
| `assets/credits.js`, `layout.js`, `app.js` | Sign-in + credits. **These were missing from your live site** |
| `assets/style.css`, favicons | Shared site styling |
| `pricing.html` | The Get Pro page — was 404 before, so Get Pro buttons were broken |
| `ads.txt` | AdSense requires this to verify you own the ad account |
| `robots.txt`, `sitemap.xml` | So Google finds and indexes the new pages |

---

## After it's live

1. **Google Search Console** → submit `https://7by.in/sitemap.xml` so the new
   pages get indexed.
2. **AdSense** → apply (or request a re-review). It needs a live site with real
   content — the 4 blog posts and 6 working tools cover this.
   `ads.txt` can take a day or two for AdSense to pick up; that's normal.
3. **Test Get Pro** once, end to end, with a real ₹27 payment to confirm
   Razorpay credits the account. Refund yourself after.

---

## Rebuilding the zip later

If you change anything in `videotools/`, run this in PowerShell from this folder:

```powershell
.\make-videotools-zip.ps1
```

That rebuilds `videotools-live.zip` with your latest files.

---

## Running the site on your own PC

Double-click **`OPEN-SITE.bat`** — it starts a small local server and opens the
site in your browser. Keep the black window open while you use it; close it to
stop. (The tools need a real `http://` address; opening the HTML files directly
does not work, because browsers block the background worker the video engine
needs.)
