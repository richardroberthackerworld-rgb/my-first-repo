/* ============================================================
   7Hand — donor sheet geometry.

   THE SINGLE SOURCE OF TRUTH for where everything sits on the
   page. sheet.html renders from these numbers and the ingest
   tool reads cells back using the same ones. If the two ever
   disagree, every glyph is cropped from the wrong place and the
   failure is silent — letters come out sheared or clipped and
   nothing throws. So there is exactly one copy, here.

   All positions are millimetres on A4, origin top-left.

     ┌─────────────────────────────────────┐
     │ ■                                 ■ │  fiducials (8mm, in
     │   Donor ______  Sheet 3 of 5        │  the margin, outside
     │  ┌────┬────┬────┬────┬────┬────┐    │  the grid)
     │ a│    │    │    │    │    │    │b   │  label OUTSIDE the
     │  ├────┼────┼────┼────┼────┼────┤    │  cell, never inside
     │  │    │    │    │    │    │    │    │
     │  └────┴────┴────┴────┴────┴────┘    │
     │ ■                                 ■ │
     └─────────────────────────────────────┘

   Why the label sits outside the cell: anything printed inside
   the cell shares space with the pen stroke, so removing it later
   means registering a subtracted image to within a pixel or two.
   Printing the letter outside means there is nothing co-located
   to remove. It also stops the donor tracing over an exemplar,
   which makes them write less like themselves.

   The two rules inside the cell (baseline and x-height) DO have
   to be inside — that is their whole job. They print in light
   blue and vanish when the scan is read through its red channel,
   the old non-repro-blue trick. That works reliably here because
   we control both the printing and the flatbed scanning. It is
   NOT reliable for user-captured photos of photocopies, which is
   why v1 capture uses template difference instead.
   ============================================================ */
'use strict';

/** Characters a donor writes, in grid order. 73 of them. */
export const CHARS = (
  'abcdefghijklmnopqrstuvwxyz' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  '0123456789' +
  '.,;:!?\'"()-'
).split('');

export const SHEET = {
  /* A4 */
  pageW: 210,
  pageH: 297,

  margin: 12,
  headerH: 18,          // donor name + sheet number
  footerH: 8,           // instructions

  /* Corner fiducials. Solid black squares whose CENTRES are the four
     points the homography is solved against. They live in the margin so
     they can never be confused with a pen stroke. */
  fidSize: 8,
  fidInset: 16,         // centre distance from each page edge

  cols: 8,
  rows: 10,             // 80 cells for 73 characters; the tail is blank

  /* The top slice of each cell carries the printed letter label. The WRITING
     BOX is everything below it, and that is the only part the ingest tool
     ever crops. Keeping the label out of the writing box is what makes the
     "nothing co-located to subtract" property true. */
  labelFrac: 0.20,

  /* Rule positions as a fraction of the WRITING BOX height, from its top.
     Ascender space above the x-height line, descender space below the
     baseline. */
  xheightFrac: 0.42,
  baselineFrac: 0.72,

  /* How many times a donor writes the full set. Five sheets, identical
     geometry, rather than one dense sheet: same total cells, but the donor
     can stop after three and still leave a usable style, and the ingest
     tool only ever has one layout to understand. */
  repeats: 5
};

/** Grid origin and size in mm. */
export function gridBox() {
  const x = SHEET.margin;
  const y = SHEET.margin + SHEET.headerH;
  const w = SHEET.pageW - SHEET.margin * 2;
  const h = SHEET.pageH - SHEET.margin * 2 - SHEET.headerH - SHEET.footerH;
  return { x, y, w, h };
}

export function cellSize() {
  const g = gridBox();
  return { w: g.w / SHEET.cols, h: g.h / SHEET.rows };
}

/** Rect of cell `i` in reading order, in mm. */
export function cellRect(i) {
  if (!Number.isInteger(i) || i < 0 || i >= SHEET.cols * SHEET.rows) {
    throw new Error('cellRect: index ' + i + ' outside 0..' + (SHEET.cols * SHEET.rows - 1));
  }
  const g = gridBox();
  const c = cellSize();
  return {
    x: g.x + (i % SHEET.cols) * c.w,
    y: g.y + Math.floor(i / SHEET.cols) * c.h,
    w: c.w,
    h: c.h
  };
}

/** The writing box of cell `i` in mm: the cell minus its label strip. */
export function cellWriteRect(i) {
  const r = cellRect(i);
  const skip = r.h * SHEET.labelFrac;
  return { x: r.x, y: r.y + skip, w: r.w, h: r.h - skip };
}

/** Baseline and x-height y positions for cell `i`, in mm on the page. */
export function cellRules(i) {
  const b = cellWriteRect(i);
  return {
    xheight: b.y + b.h * SHEET.xheightFrac,
    baseline: b.y + b.h * SHEET.baselineFrac
  };
}

/**
 * Fiducial centres in mm, always in this order:
 * top-left, top-right, bottom-right, bottom-left.
 * The ingest tool relies on that order to build the homography, so do not
 * reorder them.
 */
export function fiducials() {
  const i = SHEET.fidInset;
  return [
    { x: i, y: i },
    { x: SHEET.pageW - i, y: i },
    { x: SHEET.pageW - i, y: SHEET.pageH - i },
    { x: i, y: SHEET.pageH - i }
  ];
}

/** Millimetres to pixels at a given DPI. */
export const mmToPx = (mm, dpi) => mm * dpi / 25.4;

/** Rectified page size in pixels at a given DPI. */
export function pageSizePx(dpi) {
  return {
    w: Math.round(mmToPx(SHEET.pageW, dpi)),
    h: Math.round(mmToPx(SHEET.pageH, dpi))
  };
}

/** Cell `i` as an integer pixel rect on the rectified page. */
export function cellRectPx(i, dpi) {
  const r = cellRect(i);
  const x = Math.round(mmToPx(r.x, dpi));
  const y = Math.round(mmToPx(r.y, dpi));
  return {
    x, y,
    w: Math.round(mmToPx(r.x + r.w, dpi)) - x,
    h: Math.round(mmToPx(r.y + r.h, dpi)) - y
  };
}

/** Writing box of cell `i` as an integer pixel rect on the rectified page. */
export function cellWriteRectPx(i, dpi) {
  const b = cellWriteRect(i);
  const x = Math.round(mmToPx(b.x, dpi));
  const y = Math.round(mmToPx(b.y, dpi));
  return {
    x, y,
    w: Math.round(mmToPx(b.x + b.w, dpi)) - x,
    h: Math.round(mmToPx(b.y + b.h, dpi)) - y
  };
}

/**
 * Baseline and x-height for cell `i`, in pixels relative to the top of the
 * WRITING BOX (not the cell). These are what makeVariant() is handed, so
 * every glyph in a style shares one coordinate reference and letters sit on
 * a common line instead of bobbing about.
 */
export function cellRulesPx(i, dpi) {
  const b = cellWriteRectPx(i, dpi);
  return {
    xheight: Math.round(b.h * SHEET.xheightFrac),
    baseline: Math.round(b.h * SHEET.baselineFrac)
  };
}

/** The character a cell holds, or null for the blank tail. */
export function charAt(i) {
  return i < CHARS.length ? CHARS[i] : null;
}
