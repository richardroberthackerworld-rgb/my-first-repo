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
| T1 storage | `src/store.js` | done, 48 tests green |
| T4 tracer | `src/trace.js` | done, 48 tests green |
| T11 harness | `test.html` | partial — covers T1 and T4 only |

Everything else (donor kit, ingest, layout, realism, render, export, app, payments,
OCR, key proxy, infra) is not started.

## Running the tests

```bash
npx serve -p 3130 .
```

Then open <http://localhost:3130/hand/test.html>.

ES modules need a real origin, so `file://` will not work. There is no build step and
no dependencies — the tests are plain assertions in a single page.

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
