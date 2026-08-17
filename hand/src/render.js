/* ============================================================
   7Hand — laid-out pages to SVG.

   EACH GLYPH VARIANT IS DEFINED ONCE AND REFERENCED. A 120-page
   record is roughly a quarter of a million glyph placements, and
   emitting a fresh path for every one of them produces a document
   the browser cannot hold and a PDF that chokes a phone viewer.
   With 73 characters x 5 variants there are only 365 distinct
   shapes on the whole job, so they go in <defs> once and every
   occurrence is a <use> with its own transform.

   This is deliberately the same shape as the PDF export in T8,
   where the definitions become Form XObjects. Same idea, same
   saving, and the preview stays honest about what the export
   will do.

   The transform per glyph:

     translate(anchor) rotate(slant) translate(0,-baseline) scale(s)
                │           │                  │              │
                │           │                  │              └ glyph px → mm
                │           │                  └ put the baseline on the line
                │           └ the hand's slant at that moment
                └ where the letter sits on the ruling

   Rotation happens about the baseline-left point, which is where
   a real hand pivots. Rotating about the bitmap centre instead
   makes letters bob above and below the line as they slant.
   ============================================================ */
'use strict';

import { variantMask } from './store.js';
import { maskToCurves, beziersToPath } from './trace.js';

/**
 * Trace a variant on first use and cache the CURVES on it.
 * Both the SVG preview and the PDF export read from this one cache, so a
 * glyph is traced once and the two outputs cannot drift apart. A printed page
 * differing from the preview it was approved from is the kind of bug nobody
 * finds until a customer does.
 */
export function variantCurves(v) {
  if (v.curves == null) v.curves = maskToCurves(variantMask(v), v.w, v.h);
  return v.curves;
}

/** Cached SVG path string for a variant. */
export function variantPath(v) {
  if (v.pathD == null) v.pathD = variantCurves(v).map(c => beziersToPath(c.curves)).join('');
  return v.pathD;
}

/**
 * Build the shared glyph dictionary for a laid-out document.
 * Returns { defs, idFor } where `defs` is the <defs> body and `idFor(ch,vi)`
 * gives the reference id.
 */
export function buildGlyphDefs(doc, style, prefix = 'g') {
  /* Nested map rather than a joined string key. A "ch + separator + index"
     key needs a separator that can never appear in a character, and there is
     no such character once a style can hold arbitrary text. Two levels sidestep
     the question entirely and are faster besides. */
  const seen = new Map();          // ch -> (variant index -> id)
  const parts = [];
  let n = 0;
  for (const page of doc.pages) {
    for (const line of page.lines) {
      for (const g of line.glyphs) {
        let byVariant = seen.get(g.ch);
        if (!byVariant) { byVariant = new Map(); seen.set(g.ch, byVariant); }
        if (byVariant.has(g.vi)) continue;
        const id = prefix + (n++);
        byVariant.set(g.vi, id);
        parts.push(`<path id="${id}" d="${variantPath(style.glyphs[g.ch][g.vi])}"/>`);
      }
    }
  }
  return {
    defs: parts.join(''),
    count: n,
    idFor: (ch, vi) => {
      const byVariant = seen.get(ch);
      return byVariant ? byVariant.get(vi) : undefined;
    }
  };
}

const r2 = v => Math.round(v * 100) / 100;

/** The ruled-paper background for one page. */
function backgroundSVG(doc) {
  const P = doc.settings;
  if (!P.ruled && !P.marginRule) return '';
  const bits = [];
  if (P.ruled) {
    const n = doc.stats.linesPerPage;
    for (let i = 1; i <= n; i++) {
      const y = r2(P.marginTop + i * P.linePitch);
      bits.push(`<line x1="${r2(P.marginLeft - 8)}" y1="${y}" x2="${r2(P.pageW - P.marginRight + 4)}" y2="${y}"/>`);
    }
    bits.unshift(`<g stroke="#BBD3E8" stroke-width="0.18">`);
    bits.push('</g>');
  }
  if (P.marginRule) {
    const x = r2(P.marginLeft - 6);
    bits.push(
      `<line x1="${x}" y1="${r2(P.marginTop - 6)}" x2="${x}" y2="${r2(P.pageH - P.marginBottom + 4)}" ` +
      `stroke="#E8A9A9" stroke-width="0.25"/>`
    );
  }
  return bits.join('');
}

/**
 * One page as a standalone SVG string.
 * `defs` is passed in rather than rebuilt so every page in a document shares
 * one dictionary — that is the whole point of the <use> approach.
 */
export function pageSVG(doc, style, pageIndex, glyphDefs, { inkColor = '#1a2340', includeDefs = true } = {}) {
  const P = doc.settings;
  const page = doc.pages[pageIndex];
  if (!page) throw new Error('pageSVG: no page at index ' + pageIndex);

  const uses = [];
  for (const line of page.lines) {
    for (const g of line.glyphs) {
      const v = style.glyphs[g.ch][g.vi];
      const id = glyphDefs.idFor(g.ch, g.vi);
      const t =
        `translate(${r2(g.ax)},${r2(g.ay)})` +
        (Math.abs(g.rot) > 0.005 ? ` rotate(${r2(g.rot)})` : '') +
        ` translate(0,${r2(-v.baseline * g.s)}) scale(${g.s.toFixed(5)})`;
      uses.push(`<use href="#${id}" transform="${t}"/>`);
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${P.pageW}mm" height="${P.pageH}mm" ` +
    `viewBox="0 0 ${P.pageW} ${P.pageH}">` +
    (includeDefs ? `<defs>${glyphDefs.defs}</defs>` : '') +
    `<rect width="${P.pageW}" height="${P.pageH}" fill="#fff"/>` +
    backgroundSVG(doc) +
    `<g fill="${inkColor}">${uses.join('')}</g>` +
    `</svg>`
  );
}

/** Glyph placements on one page, for tests and for the PDF exporter. */
export function pageGlyphs(doc, pageIndex) {
  const page = doc.pages[pageIndex];
  return page ? page.lines.flatMap(l => l.glyphs) : [];
}
