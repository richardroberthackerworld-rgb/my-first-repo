# 7Hand — try it with your own handwriting

Twenty minutes, no printing, no scanner. A phone photo of something you
already wrote is enough.

---

## 1. Start it

Double-click **`start.bat`**.

It runs a small web server and opens the app. Leave the black window open
while you work; close it when you're done.

If `start.bat` doesn't work, open a terminal in this folder and run:

```bash
npx serve -p 3130 .
```

Then open <http://localhost:3130/app.html>.

> **You cannot just double-click `app.html`.** Opening it as a file gives a
> blank page. The browser blocks the module loading this uses unless it comes
> from a server. That's what `start.bat` is for.

---

## 2. Photograph a page you already wrote

Any page of your own handwriting. A page of notes, an old assignment, anything.

What makes it work well:

- **Print-style writing beats joined-up cursive.** Letters that touch get
  discarded — the software only uses words where it can tell the letters
  apart. Joined writing still works, it just keeps fewer words per page.
- **Dark pen on light paper.** Blue or black. Not pencil, not red.
- **Flat and evenly lit.** Daylight near a window is ideal. Avoid a hard
  shadow across the page.
- **Fill the frame with the page.** Straight on, not at an angle. A slight
  tilt is corrected automatically.
- **Include capital letters, numbers and punctuation somewhere.** This one
  matters more than people expect — see step 5.

---

## 3. Learn your handwriting

Open <http://localhost:3130/tools/learn.html>

1. **Choose your photo.**
2. **Analyse page.** You'll see boxes drawn over the writing — green for
   lines, orange for words, red for individual letters, blue for the baseline
   it worked out. If those boxes look wrong, the rest will be wrong; adjust
   *Speck floor* or *Word gap* and analyse again.
3. **Type what the page says**, one line in the box per line on the page. This
   is the only manual step. (Or press *Read it for me* if you set up a key —
   see "What to change" below.)
4. **Build style.** It tells you how many words matched and how many were
   skipped. **Skipping is normal and fine** — expect a third to half to be
   skipped. It only uses words it's certain about, because one wrongly
   labelled letter would mean every future "a" is secretly an "o".
5. **Download style.** You get a `.json` file.

---

## 4. Write with it

Open <http://localhost:3130/app.html>

1. **Load style file** → pick the `.json` you just downloaded.
2. Type or paste anything into the text box.
3. Adjust *Writing size* and *Line spacing* to match your notebook.
   8.5 mm is standard Indian ruled paper.
4. **Download PDF**, print it at **100% scale** (not "fit to page").

*Slant wobble* and *Baseline wobble* control how much the writing drifts.
*Reroll* gives a different random variation of the same text; the seed is
saved, so the same seed always produces exactly the same page.

---

## 5. The thing that will probably go wrong

**Whatever your photo doesn't contain, your style won't have.**

Photograph a page of all lowercase and you get a lowercase-only handwriting.
Type a capital `T` and it's silently skipped — the app lists which characters
are missing above the preview.

**Fix:** write one extra line containing the bits you're missing, photograph
it, and run it through `learn.html` as a second page. Something like:

```
ABCDEFGHIJKLM NOPQRSTUVWXYZ
0123456789 . , ; : ! ? ' " ( ) -
```

Write it spaced out, letters not touching, so more of them survive.

---

## What to change

**To just test it: nothing.** It works out of the box. You type the
transcript yourself.

**To have it read the page for you**, pick one:

| | Edit | Works with | Safe to publish? |
|---|---|---|---|
| Local testing | `config.js` → `devKeys.gemini` | `start.bat` | **No** |
| Real hosting | `api/config.php` → `keys.gemini` | PHP hosting only | Yes |

For local testing, open **`config.js`** and change these two lines:

```js
proxy: './api/ocr.php',      →   proxy: null,
gemini: ''                   →   gemini: 'AIza...your key...'
```

Get a free key at <https://aistudio.google.com/apikey> — no card, about 1500
requests a day.

**Only do this on your own machine.** In local mode the key sits in the page
source where anyone can read it. For a public site use `api/config.php`
instead, which keeps the key on the server — but that needs PHP hosting, so
`start.bat` won't run it.

---

## Tell me what's wrong

The useful things to report back:

1. **Do the red boxes land on individual letters?** If they cut letters in
   half or swallow two at once, that's the segmentation and it's fixable.
2. **What percentage of words matched?** Under about 30% means the letter
   splitting is struggling with your hand.
3. **Does the output actually look like your writing?** This is the real
   question. Print a page, put it beside something you wrote, and see.
4. **What's the first thing that looks obviously fake?** Spacing? Letters too
   uniform? Sitting too high or low on the line? Each has a different fix.

Send the style `.json` if something looks wrong — it contains the extracted
letters and shows exactly what was captured.
