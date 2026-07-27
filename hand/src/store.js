/* ============================================================
   7Hand — style storage.

   THE LOAD-BEARING DECISION IN THIS FILE:
   the binary glyph bitmap is CANONICAL. Contours are a derived
   cache and may be thrown away and rebuilt at any time.

   Why it matters: the v2 plotter needs a centerline (the path a
   pen follows down the middle of a stroke). You cannot recover a
   centerline from an outline — tracing the edges throws away the
   information the skeletonizer needs. Keeping the bitmap means
   adding the plotter later is a pure addition instead of asking
   every existing user to re-capture their handwriting.

   Storage shape:

     style
       ├── meta (id, name, format, em)
       └── glyphs
             'a' → [ variant, variant, ... ]   5 real samples
             'b' → [ ... ]
                     │
                     ├── w, h, rle   ← CANONICAL (1-bit bitmap)
                     ├── baseline, xheight, lsb, rsb, adv
                     └── contours?   ← derived cache, droppable

   All processing is local. Nothing here talks to a network.
   ============================================================ */
'use strict';

export const FORMAT = 'hand-style/1';

/* Glyph bitmaps are stored at their natural captured size and scaled at
   render time. EM is the nominal body height the metrics are expressed
   against, so two styles with different scan resolutions compose. */
export const EM = 256;

/* ---------- run-length encoding ----------------------------------------

   One row per ';', runs within a row separated by ','. Runs alternate
   background/foreground and ALWAYS start with a background run, which may
   be zero length. Lengths are base 36 to keep the file small while staying
   readable in a debugger.

   Row  ..###...   encodes as  2,3,3
   Row  ###.....   encodes as  0,3,5   (leading zero-length background run)
------------------------------------------------------------------------ */

/** Encode a w*h mask (any array-like; non-zero means ink) to an RLE string. */
export function encodeMask(mask, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error('encodeMask: bad dimensions ' + w + 'x' + h);
  }
  if (mask.length < w * h) {
    throw new Error('encodeMask: mask has ' + mask.length + ' cells, expected ' + w * h);
  }
  const rows = [];
  for (let y = 0; y < h; y++) {
    const runs = [];
    let run = 0;
    let want = 0;                    // the value the current run is made of
    for (let x = 0; x < w; x++) {
      const v = mask[y * w + x] ? 1 : 0;
      if (v === want) { run++; continue; }
      runs.push(run.toString(36));
      want = v;
      run = 1;
    }
    runs.push(run.toString(36));
    rows.push(runs.join(','));
  }
  return rows.join(';');
}

/** Decode an RLE string back to a Uint8Array of w*h zeros and ones. */
export function decodeMask(rle, w, h) {
  const out = new Uint8Array(w * h);
  const rows = rle.split(';');
  if (rows.length !== h) {
    throw new Error('decodeMask: got ' + rows.length + ' rows, expected ' + h);
  }
  for (let y = 0; y < h; y++) {
    const runs = rows[y].split(',');
    let x = 0;
    let v = 0;
    for (let i = 0; i < runs.length; i++) {
      const n = parseInt(runs[i], 36);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('decodeMask: bad run "' + runs[i] + '" on row ' + y);
      }
      if (v) out.fill(1, y * w + x, y * w + Math.min(x + n, w));
      x += n;
      v ^= 1;
    }
    if (x !== w) {
      throw new Error('decodeMask: row ' + y + ' covers ' + x + ' px, expected ' + w);
    }
  }
  return out;
}

/* ---------- metrics ---------------------------------------------------- */

/**
 * Ink bounding box and pixel count.
 * Returns null for a blank cell. Callers MUST handle null — a blank cell is
 * a user skipping a letter on the donor sheet, and it has to be reported by
 * name rather than sailing through as a zero-width glyph. Dividing by a zero
 * ink area is how every letter ends up stacked at x=0 with a NaN advance.
 */
export function measureInk(mask, w, h) {
  let top = -1, bottom = -1, left = w, right = -1, ink = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      ink++;
      if (top < 0) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (ink === 0) return null;
  return { ink, top, bottom, left, right, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Build a stored variant from a captured cell.
 * `baseline` and `xheight` are y positions in the source bitmap's own
 * coordinates, read off the donor sheet's printed rules.
 */
export function makeVariant({ mask, w, h, baseline, xheight, sidebearing = 2 }) {
  const box = measureInk(mask, w, h);
  if (!box) {
    throw new Error('makeVariant: cell is blank — report the missing letter to the user, do not store an empty glyph');
  }
  if (!Number.isFinite(baseline)) throw new Error('makeVariant: baseline must be a number');
  if (!Number.isFinite(xheight)) throw new Error('makeVariant: xheight must be a number');

  /* Crop to the ink plus one pixel of margin. Storing the donor sheet's
     whole cell would triple the file for no benefit, and the side bearings
     below carry the spacing information the crop discards. */
  const x0 = Math.max(0, box.left - 1);
  const y0 = Math.max(0, box.top - 1);
  const x1 = Math.min(w - 1, box.right + 1);
  const y1 = Math.min(h - 1, box.bottom + 1);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cropped = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      cropped[y * cw + x] = mask[(y + y0) * w + (x + x0)] ? 1 : 0;
    }
  }

  return {
    w: cw,
    h: ch,
    rle: encodeMask(cropped, cw, ch),
    baseline: baseline - y0,
    xheight: xheight - y0,
    lsb: sidebearing,
    rsb: sidebearing,
    adv: cw + sidebearing * 2,
    ink: box.ink
  };
}

/** Decode a stored variant's canonical bitmap. */
export function variantMask(v) {
  return decodeMask(v.rle, v.w, v.h);
}

/* ---------- style ------------------------------------------------------ */

export function createStyle(name, opts = {}) {
  return {
    format: FORMAT,
    id: opts.id || 'style-' + Math.random().toString(36).slice(2, 10),
    name: name || 'Untitled',
    em: opts.em || EM,
    donor: opts.donor || null,        // free-text credit; consent is tracked out of band
    glyphs: Object.create(null)
  };
}

export function addVariant(style, ch, variant) {
  if (typeof ch !== 'string' || ch.length !== 1) {
    throw new Error('addVariant: expected a single character, got ' + JSON.stringify(ch));
  }
  (style.glyphs[ch] || (style.glyphs[ch] = [])).push(variant);
  return style;
}

export function variantsFor(style, ch) {
  return style.glyphs[ch] || null;
}

/**
 * Characters the style cannot render. The renderer must call this BEFORE
 * laying anything out: an unknown character looked up as undefined throws
 * mid-render and leaves the user staring at a blank preview with no
 * explanation. Fail early, name the characters.
 */
export function missingChars(style, text) {
  const missing = new Set();
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') continue;
    if (!style.glyphs[ch]) missing.add(ch);
  }
  return [...missing];
}

/** Letters with fewer than `want` samples — the donor skipped or smudged them. */
export function incompleteGlyphs(style, want = 5) {
  const out = [];
  for (const ch of Object.keys(style.glyphs)) {
    const n = style.glyphs[ch].length;
    if (n < want) out.push({ ch, have: n, want });
  }
  return out;
}

/* ---------- serialisation --------------------------------------------- */

/**
 * Contours are a CACHE. They are excluded by default so a style file can
 * never drift out of sync with the bitmaps it was derived from, and so an
 * improved tracer can be re-run over old styles.
 */
export function styleToJSON(style, { includeContours = false } = {}) {
  const glyphs = Object.create(null);
  for (const ch of Object.keys(style.glyphs)) {
    glyphs[ch] = style.glyphs[ch].map(v => {
      const copy = { w: v.w, h: v.h, rle: v.rle, baseline: v.baseline, xheight: v.xheight, lsb: v.lsb, rsb: v.rsb, adv: v.adv, ink: v.ink };
      if (includeContours && v.contours) copy.contours = v.contours;
      return copy;
    });
  }
  return JSON.stringify({ format: style.format, id: style.id, name: style.name, em: style.em, donor: style.donor, glyphs });
}

export function styleFromJSON(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  if (o.format !== FORMAT) {
    throw new Error('styleFromJSON: unsupported format ' + JSON.stringify(o.format) + ', expected ' + FORMAT);
  }
  const style = createStyle(o.name, { id: o.id, em: o.em, donor: o.donor });
  for (const ch of Object.keys(o.glyphs || {})) {
    for (const v of o.glyphs[ch]) {
      /* Validate on load rather than at first render. A corrupt run length
         should surface as "this style file is damaged", not as a letter that
         silently renders as a smear halfway down page 40. */
      decodeMask(v.rle, v.w, v.h);
      addVariant(style, ch, v);
    }
  }
  return style;
}

/* ---------- derived contour cache -------------------------------------- */

/**
 * Fill in the contour cache using the supplied tracer.
 * Pass `{ force: true }` after changing the tracer to rebuild every glyph.
 */
export function ensureContours(style, traceFn, { force = false } = {}) {
  let built = 0;
  for (const ch of Object.keys(style.glyphs)) {
    for (const v of style.glyphs[ch]) {
      if (v.contours && !force) continue;
      v.contours = traceFn(variantMask(v), v.w, v.h);
      built++;
    }
  }
  return built;
}

export function dropContours(style) {
  for (const ch of Object.keys(style.glyphs)) {
    for (const v of style.glyphs[ch]) delete v.contours;
  }
  return style;
}

/** Rough byte size of a serialised style, for keeping an eye on file growth. */
export function styleBytes(style, opts) {
  return new TextEncoder().encode(styleToJSON(style, opts)).length;
}
