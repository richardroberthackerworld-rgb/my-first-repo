# 7Hand (working name)

Renders typed text as convincing handwriting on printable pages.

> **The folder name is provisional.** It must not become `write/` — that collides
> with the existing `writer/` product (`writer.7by.in`, `make-writer-zip.ps1`), and a
> one-character difference in folder, subdomain and build script is a deploy footgun.

Design doc, with the full 14-task plan and the reasoning behind every decision:
`~/.gstack/projects/richardroberthackerworld-rgb-my-first-repo/chint-videotools-fixes-design-20260727-181013.md`

## Built so far

| Task | File | State |
|---|---|---|
| T1 storage | `src/store.js` | done |
| T2 donor sheet | `sheet.html`, `src/sheet.js` | done |
| T3 ingest | `tools/ingest.html`, `src/capture.js` | done |
| T4 tracer | `src/trace.js` | done |
| T5 layout | `src/layout.js` | done |
| T6 realism | `src/realism.js` | done |
| T7 preview | `app.html`, `src/render.js` | done |
| T8 PDF export | `src/pdf.js` | done |
| — learn from a page | `src/page.js`, `tools/learn.html` | done |
| T13 transcription | `src/ocr.js` | done, untested against a live API |
| T14 key proxy | `api/ocr.php` | done, untested against a live API |
| T12 build | `../make-hand-zip.ps1` | done |
| T11 harness | `test.html` | covers everything above |

**131 tests green.** Not started: **T10 payments — there is no paywall.**
Everything runs client-side and the server only sees transcription requests, so
nothing currently stops anyone exporting as much as they like.

Photograph a page you already wrote, have it read, and get new text back in
that same hand as a print-ready PDF.

## Transcription

**Optional.** Everything works without it — you type what the page says. This
automates that one step and nothing else.

The model never sees a glyph and never decides which blob is which letter. It
only produces text, which the alignment step then checks against the ink and
discards where the two disagree. So the model can misread a word without doing
damage: that word is skipped, exactly like one with joined letters.

Two ways to run it:

| | Key lives | Use |
|---|---|---|
| **Proxy** (default) | on your server | anything public |
| **Direct** | in page source | your own machine only |

Direct mode logs a warning every time it runs. A key on a public OCR button is
lifted and burned within days.

To enable:

```bash
cp hand/api/config.example.php hand/api/config.php
# add one free key: https://aistudio.google.com/apikey
```

`api/config.php` is gitignored, denied by `api/.htaccess`, and the build script
refuses to run if it finds it staged or spots anything key-shaped in the output.

The proxy owns the prompt — the client only sends an image. Otherwise the
endpoint is a free general-purpose vision model for anyone who finds the URL,
paid for out of your quota. It is rate limited per caller, 12 requests per 10
minutes by default.

## PDF export

Written by hand rather than vendored, for a reason that is not stubbornness: the
whole task is glyph reuse, and no general-purpose JS PDF library exposes Form
XObjects. PDF is a plain text format; the writer is about 230 lines.

Every glyph variant becomes a Form XObject defined once, and each occurrence is a
two-line reference:

```
q  a b c d e f cm  /G17 Do  Q
```

A 120-page record is roughly a quarter of a million placements. Writing the bezier
path out for each one is tens of millions of path segments — minutes to build, tens
of megabytes, and a phone PDF viewer that gives up. With 73 characters at 5 variants
there are only 365 distinct shapes in the entire job. Measured on the two-page sample:
1,254 letters, 159 shapes, 141 KB.

Pages are emitted one at a time and released before the next begins, so peak memory
is one page rather than the whole document.

Both emitters read the same cached curves from `render.js`, so a glyph is traced once
and the print cannot disagree with the preview it was approved from. A test asserts
the flattened PDF matrix lands the baseline in the same place the nested SVG
transforms do.

## Running it

```bash
npx serve -p 3130 .
```

ES modules need a real origin, so `file://` will not work. There is no build step and
no dependencies.

- App: <http://localhost:3130/hand/app.html> — click **Demo style** to try it instantly
- Tests: <http://localhost:3130/hand/test.html>
- Donor sheet: <http://localhost:3130/hand/sheet.html>
- Ingest: <http://localhost:3130/hand/tools/ingest.html>

The demo style renders a serif typeface through the real pipeline. It exercises
layout but is **not handwriting and will not fool anyone** — it exists so the app is
usable before a donor has been scanned.

## Capturing a donor

1. Open `sheet.html`, type the donor's name, print 5 sheets at **100% scale**. Not
   "fit to page" — the geometry has to survive the printer.
2. Donor writes one character per box, in **black or blue pen only**, sitting each
   letter on the darker blue line.
3. Scan at **300 dpi or higher, in colour**. Colour is not optional: the guide rules
   are removed by reading the scan through its red channel, and a greyscale scan mixes
   the blue down into a mid grey that gets traced as ink.
4. Open `tools/ingest.html`, load each scan, check the four corner handles, extract.
5. Download the style JSON.

Blank cells are reported by character, so a donor who skipped six letters can be asked
for exactly those six.

## Why the sheet looks the way it does

**The letter label sits above the writing box, never inside it.** Anything printed
inside the box shares space with the pen stroke, so removing it later means registering
a subtracted image to within a pixel or two. Nothing co-located means nothing to
subtract. It also stops the donor tracing over a printed exemplar, which makes them
write less like themselves.

**The box border and both rules are blue, not grey.** They sit right against the
writing area and the red-channel read only removes colours with a high red component.
A grey border survives thresholding and gets traced as part of the letter.

**Five identical sheets, not one dense sheet.** Same total cells either way, but the
ingest tool only has one layout to understand, and a donor who gives up after three
sheets still leaves a usable style.

**There is deliberately no deskew.** The original plan listed one, inherited from the
phone-photo design where the sheet itself might be tilted. After fiducial rectification
the sheet is already square, and any slant left in a glyph is the donor's own italic
hand. Removing it would destroy the exact thing being captured.

## Why the wobble looks the way it does

Uniformity gets machine-written pages caught, but the obvious fix is also wrong.
Rolling an independent random number per letter produces a *jitter texture* that reads
as machine-made in a different way. Real handwriting **drifts**: slant, size and
baseline wander together and slowly, because they all come from one hand getting
tired, speeding up, or shifting grip.

So `realism.js` runs one smoothed random walk per hand and everything reads from it.
There is a test asserting the lag-1 autocorrelation stays above 0.75, and a companion
test proving independent noise *fails* that same check — so the test measures something
real rather than passing by construction.

Two smaller rules that matter more than they look:

- **The same sample is never used twice in a row for one character.** A doubled letter
  (`ll`, `oo`, `ee`) rendered with two identical shapes is the single most obvious tell
  on a page, and English is full of them.
- **Everything derives from a seed stored with the document.** Without it the preview
  disagrees with the export and reopening a file changes the handwriting.

## The two decisions this code exists to enforce

**The bitmap is canonical; contours are a cache.** `store.js` will happily throw the
contour cache away and rebuild it (`dropContours` / `ensureContours`). This is not
tidiness. The v2 plotter needs a centerline, which is the path a pen follows down the
middle of a stroke, and you cannot recover a centerline from an outline. Keeping the
1-bit bitmap means adding the plotter later is a pure addition instead of asking every
existing user to re-capture their handwriting.

**No external libraries.** `trace.js` implements boundary extraction, RDP
simplification and cubic bezier fitting in about 400 lines. A general-purpose tracing
library is built for colour photographs and would be a CDN dependency, and this repo
has already been bitten once by a CDN library hanging on Indian ISPs (see the comments
in `videotools/app.js`). The boundary walk is also what the v2 skeletonizer will build
on, so it is not throwaway work.

## How the tracer works

```
mask ──► traceContours ──► rdp ──► fitBeziers ──► SVG path
1-bit    pixel-edge        thin     smooth
         staircase loops   out      curves
```

Boundaries are walked along **pixel edges**, not pixel centres. Every filled pixel
emits a directed edge for each side facing background, and those edges are stitched
into closed loops. Holes and disjoint parts fall out correctly with no special casing,
and every loop is closed by construction. Outer boundaries come out with positive
signed area and holes negative, so the default nonzero fill rule leaves the counter of
an "a" open with no extra work.

At a saddle — two pixels touching corner to corner — the walk prefers the left turn,
which keeps them in one contour. That matters: a thin diagonal pen stroke touching only
at corners is one stroke, not a dotted line of separate blobs.

## Test coverage notes

The fidelity tests are the ones worth keeping honest. They rasterise the fitted vector
path back through the browser's own fill rule and compare it against the bitmap it came
from, so a curve-fitting regression shows up as a number rather than as letters that
look slightly off to nobody in particular. Current agreement: 100% on closed letters
with counters, 97-98% on sharp corners and thin diagonals.

`test.html` is a debugging harness, not a regression net. It has no CI and only runs
when someone opens it. Do not count it as coverage in any plan.

## Measured sizes

One realistic glyph bitmap is about 1.3 KB of RLE. A full style of 73 characters at 5
variants each is about 400 KB raw and 135 KB gzipped. **Load styles lazily, one at a
time**, and make sure gzip is enabled at the server.
