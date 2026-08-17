/* ============================================================
   7Hand — PDF export.

   Every glyph variant becomes a Form XObject, defined once, and
   each of its occurrences on the page is a two-line reference:

     q  a b c d e f cm  /G17 Do  Q

   That is the whole reason this file exists rather than a
   library. A 120-page record is around a quarter of a million
   glyph placements. Writing the bezier path out for each one is
   tens of millions of path segments — an export that takes
   minutes, weighs tens of megabytes, and locks up a phone PDF
   viewer. With 73 characters at 5 variants there are only 365
   distinct shapes in the entire job, so they are emitted once
   and referenced. This mirrors the <defs>/<use> split the SVG
   preview uses, from the same cached curves, so the print cannot
   disagree with the preview.

   Pages are emitted ONE AT A TIME and their content released
   before the next begins, so peak memory is one page rather than
   the whole document.

   COORDINATES. PDF puts the origin at the bottom-left with y
   going up; everything else here works top-left with y going
   down, like the screen. Rather than flipping every number, the
   page content opens with one transform that flips the whole
   space and converts millimetres to points:

       q  2.8346 0 0 -2.8346 0 <pageHeightPt> cm

   After that, layout coordinates are written out unchanged.
   ============================================================ */
'use strict';

import { variantCurves } from './render.js';

const MM_TO_PT = 72 / 25.4;                 // 2.8346…
const n = v => {
  /* PDF has no notion of NaN or Infinity. A non-finite number here produces a
     file that opens as a blank page in some readers and an error in others,
     which is a miserable thing to debug from a user's bug report. */
  if (!Number.isFinite(v)) throw new Error('pdf: non-finite number reached the writer');
  return (Math.round(v * 1000) / 1000).toString();
};

/* ---------- glyph shapes as PDF path operators ------------------------- */

/** One variant's contours as a PDF content fragment, in glyph pixel space. */
export function variantPdfOps(v) {
  const parts = [];
  for (const contour of variantCurves(v)) {
    const cs = contour.curves;
    if (!cs.length) continue;
    parts.push(`${n(cs[0][0].x)} ${n(cs[0][0].y)} m`);
    for (const c of cs) {
      parts.push(`${n(c[1].x)} ${n(c[1].y)} ${n(c[2].x)} ${n(c[2].y)} ${n(c[3].x)} ${n(c[3].y)} c`);
    }
    parts.push('h');
  }
  /* "f" is the nonzero winding fill. Outer contours and holes were traced
     with opposite winding, so counters stay open without a second path. */
  parts.push('f');
  return parts.join('\n');
}

/**
 * Compose the placement transform into a single PDF matrix.
 *
 * The same composition the SVG renderer expresses as
 *   translate(ax,ay) rotate(rot) translate(0,-baseline*s) scale(s)
 * flattened to [a b c d e f], because PDF has no nested transforms.
 */
export function glyphMatrix(g, baseline) {
  const th = g.rot * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const s = g.s, b = baseline * g.s;
  return [
    cos * s, sin * s,
    -sin * s, cos * s,
    g.ax + sin * b,
    g.ay - cos * b
  ];
}

/* ---------- byte assembly ---------------------------------------------- */

function bytes(str) {
  const out = new Uint8Array(str.length);
  /* PDF syntax is Latin-1. Everything written here is ASCII, so a plain
     charCode copy is correct and avoids pulling in a text encoder. */
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

async function deflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate')));
    return new Uint8Array(await cs.arrayBuffer());
  } catch (_) {
    return null;                      // compression is a bonus, never a gate
  }
}

/**
 * Build the PDF.
 *
 * Returns a Blob. `compress` uses the browser's own deflate for /FlateDecode
 * streams; the RLE-ish path text compresses roughly threefold. If the browser
 * lacks CompressionStream the file is still written, just larger.
 */
export async function buildPdf(doc, style, { compress = true, title = '7Hand' } = {}) {
  const P = doc.settings;
  const pageWpt = P.pageW * MM_TO_PT;
  const pageHpt = P.pageH * MM_TO_PT;

  const chunks = [];
  let length = 0;
  const push = u8 => { chunks.push(u8); length += u8.length; };
  const write = str => push(bytes(str));

  /* Object 0 is the free-list head and is never written. */
  const offsets = [0];
  let nextId = 1;
  const objStart = [];

  const beginObj = () => {
    const id = nextId++;
    offsets[id] = length;
    objStart.push(id);
    return id;
  };

  const writeStream = async (dict, payload) => {
    let data = typeof payload === 'string' ? bytes(payload) : payload;
    let extra = '';
    if (compress) {
      const z = await deflate(data);
      if (z && z.length < data.length) { data = z; extra = ' /Filter /FlateDecode'; }
    }
    write(`<< ${dict}${extra} /Length ${data.length} >>\nstream\n`);
    push(data);
    write('\nendstream\nendobj\n');
  };

  write('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');   // binary marker: tells tools this is not text

  /* ---- one Form XObject per distinct glyph shape ---- */
  const shapeIds = new Map();               // ch -> (variant index -> {objId, name})
  let shapeCount = 0;
  for (const page of doc.pages) {
    for (const line of page.lines) {
      for (const g of line.glyphs) {
        let byVariant = shapeIds.get(g.ch);
        if (!byVariant) { byVariant = new Map(); shapeIds.set(g.ch, byVariant); }
        if (byVariant.has(g.vi)) continue;
        const v = style.glyphs[g.ch][g.vi];
        const id = beginObj();
        write(`${id} 0 obj\n`);
        await writeStream(
          `/Type /XObject /Subtype /Form /BBox [0 0 ${n(v.w)} ${n(v.h)}] /Resources << >>`,
          variantPdfOps(v)
        );
        byVariant.set(g.vi, { objId: id, name: 'G' + shapeCount });
        shapeCount++;
      }
    }
  }

  /* Resources dictionary, shared by every page — that sharing is the saving. */
  const xobjEntries = [];
  for (const [, byVariant] of shapeIds) {
    for (const [, s] of byVariant) xobjEntries.push(`/${s.name} ${s.objId} 0 R`);
  }
  const resourcesId = beginObj();
  write(`${resourcesId} 0 obj\n<< /XObject << ${xobjEntries.join(' ')} >> >>\nendobj\n`);

  /* ---- pages, one at a time ---- */
  const pageIds = [];
  const pagesId = nextId++;                 // reserved; written after the pages

  for (let pi = 0; pi < doc.pages.length; pi++) {
    const page = doc.pages[pi];

    const ops = [];
    ops.push('q');
    ops.push(`${n(MM_TO_PT)} 0 0 ${n(-MM_TO_PT)} 0 ${n(pageHpt)} cm`);
    if (P.ruled || P.marginRule) ops.push(backgroundOps(doc));
    ops.push('0.102 0.137 0.251 rg');        // ink colour, matching the preview
    for (const line of page.lines) {
      for (const g of line.glyphs) {
        const v = style.glyphs[g.ch][g.vi];
        const m = glyphMatrix(g, v.baseline);
        const name = shapeIds.get(g.ch).get(g.vi).name;
        ops.push(`q ${m.map(n).join(' ')} cm /${name} Do Q`);
      }
    }
    ops.push('Q');

    const contentId = beginObj();
    write(`${contentId} 0 obj\n`);
    await writeStream('', ops.join('\n'));
    ops.length = 0;                          // release this page before the next

    const pageId = beginObj();
    write(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${n(pageWpt)} ${n(pageHpt)}] ` +
      `/Resources ${resourcesId} 0 R /Contents ${contentId} 0 R >>\nendobj\n`
    );
    pageIds.push(pageId);
  }

  /* ---- page tree, catalog, metadata ---- */
  offsets[pagesId] = length;
  write(
    `${pagesId} 0 obj\n<< /Type /Pages /Count ${pageIds.length} ` +
    `/Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] >>\nendobj\n`
  );
  if (pagesId >= nextId) nextId = pagesId + 1;

  const infoId = beginObj();
  write(`${infoId} 0 obj\n<< /Producer (7Hand) /Title (${pdfString(title)}) >>\nendobj\n`);

  const catalogId = beginObj();
  write(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);

  /* ---- cross-reference table ---- */
  const xrefAt = length;
  const count = nextId;
  write(`xref\n0 ${count}\n`);
  write('0000000000 65535 f \n');
  for (let i = 1; i < count; i++) {
    const off = offsets[i] || 0;
    write(String(off).padStart(10, '0') + ' 00000 n \n');
  }
  write(`trailer\n<< /Size ${count} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return {
    blob: new Blob(chunks, { type: 'application/pdf' }),
    bytes: length,
    shapes: shapeCount,
    placements: doc.stats.glyphs,
    pages: doc.pages.length
  };
}

/** Escape a PDF literal string. */
function pdfString(s) {
  return String(s).replace(/[\\()]/g, c => '\\' + c).replace(/[^\x20-\x7e]/g, '');
}

/** Ruling and margin rule, in the same flipped millimetre space. */
function backgroundOps(doc) {
  const P = doc.settings;
  const ops = [];
  if (P.ruled) {
    ops.push('0.733 0.827 0.910 RG', '0.18 w');
    for (let i = 1; i <= doc.stats.linesPerPage; i++) {
      const y = P.marginTop + i * P.linePitch;
      ops.push(`${n(P.marginLeft - 8)} ${n(y)} m ${n(P.pageW - P.marginRight + 4)} ${n(y)} l S`);
    }
  }
  if (P.marginRule) {
    const x = P.marginLeft - 6;
    ops.push('0.910 0.663 0.663 RG', '0.25 w',
      `${n(x)} ${n(P.marginTop - 6)} m ${n(x)} ${n(P.pageH - P.marginBottom + 4)} l S`);
  }
  return ops.join('\n');
}
