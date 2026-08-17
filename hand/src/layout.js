/* ============================================================
   7Hand — text to positioned glyphs.

   text ─► tokenize ─► pick variants ─► break lines ─► paginate
                                                         │
                                             pages[].lines[].glyphs[]

   ONE SCALE FOR THE WHOLE STYLE. It is tempting to normalise
   every glyph to the same x-height, and it is wrong: the donor's
   letters are not all the same size, and flattening that removes
   one of the strongest signals that a human wrote it. So the
   scale is computed once from the median x-height across the
   style and applied uniformly. A naturally small "e" stays small.

   Baselines sit ON the ruling. A page of ruled paper is a stack
   of baselines `linePitch` apart, which is why the pitch is in
   millimetres and matched to real Indian notebook ruling (8.5mm)
   rather than being derived from the glyph size.
   ============================================================ */
'use strict';

import { missingChars } from './store.js';
import { makeHand } from './realism.js';

export const DEFAULT_PAGE = {
  pageW: 210,
  pageH: 297,
  marginTop: 20,
  marginBottom: 16,
  marginLeft: 25,        // wide, for the red margin rule Indian notebooks have
  marginRight: 14,
  linePitch: 8.5,        // matches common Indian ruled paper
  xHeightMm: 2.6,        // height of an "o", which sets the writing size
  spaceEm: 1.05,         // word space as a multiple of x-height
  tracking: 0,           // extra space between letters, mm
  ruled: true,
  marginRule: true,
  paragraphIndent: 0
};

/**
 * Millimetres per glyph pixel for this style.
 *
 * Uses the MEDIAN x-height across every stored variant. A mean would be
 * dragged around by one badly cropped sample; the median shrugs it off.
 */
export function styleScale(style, xHeightMm) {
  const heights = [];
  for (const ch of Object.keys(style.glyphs)) {
    for (const v of style.glyphs[ch]) {
      const xh = v.baseline - v.xheight;
      if (xh > 0) heights.push(xh);
    }
  }
  if (!heights.length) {
    throw new Error('styleScale: this style has no usable x-height metrics — re-ingest the donor sheets');
  }
  heights.sort((a, b) => a - b);
  const median = heights[heights.length >> 1];
  if (!(median > 0)) throw new Error('styleScale: median x-height is not positive');
  return xHeightMm / median;
}

/** Split into paragraphs, then words. Runs of spaces collapse to one. */
function tokenize(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(p => p.split(/[ \t]+/).filter(w => w.length));
}

/**
 * Lay text out into pages.
 *
 * Characters the style cannot render are SKIPPED and reported, never looked
 * up blind. An undefined glyph reaching the renderer throws halfway down a
 * page and leaves the user staring at a blank preview with no explanation.
 */
export function layout(text, style, opts = {}) {
  const P = { ...DEFAULT_PAGE, ...opts };
  const seed = opts.seed >>> 0 || 1;
  const hand = makeHand(seed, opts.jitter);
  const J = hand.jitter;

  const scale = styleScale(style, P.xHeightMm);
  const missing = missingChars(style, text);
  const skip = new Set(missing);

  const contentLeft = P.marginLeft;
  const contentW = P.pageW - P.marginLeft - P.marginRight;
  const usableH = P.pageH - P.marginTop - P.marginBottom;
  const linesPerPage = Math.max(1, Math.floor(usableH / P.linePitch));
  const spaceW = P.xHeightMm * P.spaceEm;

  /* ---- build the glyph stream, choosing variants once ---- */
  const paragraphs = tokenize(text).map(words =>
    words.map(word => {
      const glyphs = [];
      let width = 0;
      for (const ch of word) {
        if (skip.has(ch)) continue;
        const variants = style.glyphs[ch];
        if (!variants || !variants.length) continue;
        const vi = hand.pickVariant(ch, variants.length);
        const adv = variants[vi].adv * scale + P.tracking;
        glyphs.push({ ch, vi, adv });
        width += adv;
      }
      return { glyphs, width };
    }).filter(w => w.glyphs.length)
  );

  /* ---- break into lines ---- */
  const lines = [];
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const words = paragraphs[pi];
    if (!words.length) { lines.push({ words: [], indent: 0, blank: true }); continue; }

    let cur = [], curW = 0;
    const indent = P.paragraphIndent;
    for (const word of words) {
      const gap = cur.length ? spaceW : 0;
      const projected = curW + gap + word.width + (cur.length ? 0 : indent);
      if (cur.length && projected > contentW) {
        /* Line-end compression. A real writer squeezes the last word in
           rather than leaving a ragged gap, but only up to a point. Past 8%
           over, they wrap like everyone else. */
        const over = projected - contentW;
        if (over <= contentW * 0.08) {
          cur.push(word); curW = projected;
          lines.push({ words: cur, indent: lines.length === 0 ? indent : 0, compress: true });
          cur = []; curW = 0;
          continue;
        }
        lines.push({ words: cur, indent: 0 });
        cur = [word]; curW = word.width;
      } else {
        cur.push(word); curW = projected;
      }
    }
    if (cur.length) lines.push({ words: cur, indent: 0, last: true });
  }

  /* ---- place glyphs ---- */
  const pages = [];
  let page = null, lineOnPage = 0;
  let glyphCount = 0;

  for (const line of lines) {
    if (!page || lineOnPage >= linesPerPage) {
      page = { index: pages.length, lines: [] };
      pages.push(page);
      lineOnPage = 0;
    }
    const baselineY = P.marginTop + (lineOnPage + 1) * P.linePitch;
    lineOnPage++;

    if (line.blank) { page.lines.push({ baselineY, glyphs: [], blank: true }); continue; }

    hand.drift.newLine();

    /* Space width for this line, compressed if the line took an extra word. */
    const nGaps = Math.max(0, line.words.length - 1);
    const wordsW = line.words.reduce((a, w) => a + w.width, 0);
    let lineSpace = spaceW;
    if (line.compress && nGaps > 0) {
      lineSpace = Math.max(spaceW * 0.55, (contentW - wordsW - line.indent) / nGaps);
    }

    let x = contentLeft + (line.indent || 0);
    const placed = [];

    for (let wi = 0; wi < line.words.length; wi++) {
      if (wi > 0) {
        const wobble = 1 + (hand.rand() * 2 - 1) * J.spacePct;
        x += lineSpace * wobble;
      }
      for (const g of line.words[wi].glyphs) {
        const d = hand.drift.step();
        const s = scale * (1 + d.size * J.sizePct);
        const rot = d.slant * J.slantDeg;
        const dy = d.base * J.baselineMm;
        const v = style.glyphs[g.ch][g.vi];
        placed.push({
          ch: g.ch,
          vi: g.vi,
          /* Anchor is the glyph's baseline-left point. The renderer rotates
             about it, which is how a slanted hand actually pivots. */
          ax: x + v.lsb * s,
          ay: baselineY + dy,
          s,
          rot
        });
        glyphCount++;
        x += v.adv * s + P.tracking;
      }
    }
    page.lines.push({ baselineY, glyphs: placed });
  }

  return {
    pages,
    missing,
    settings: P,
    seed,
    scale,
    stats: { pages: pages.length, lines: lines.length, glyphs: glyphCount, linesPerPage }
  };
}
