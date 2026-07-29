/* ============================================================
   7Hand — reading a page somebody already wrote.

   The donor sheet knows where every letter is. A page of real
   writing knows nothing: no fiducials, no grid, no cells. So it
   has to be taken apart from scratch.

     photo ─► deskew ─► lines ─► words ─► letters
              (shear    (row     (column  (connected
               scoring)  gaps)    gaps)    components)

   THE ALIGNMENT TRICK. Knowing which squiggle is which letter is
   the hard problem, and character-level handwriting recognition
   is not reliable enough to build on. So this does not try.

   Instead: for each word, count the ink blobs and count the
   letters in the transcript. If they match, the mapping is
   unambiguous — first blob is the first letter, and so on. If
   they do not match (joined letters, a broken stroke, a stray
   mark), THROW THE WORD AWAY.

   That sounds wasteful and is not. A page holds hundreds of
   words and a style needs about five samples per letter, so
   discarding two thirds of a page still leaves plenty. Being
   right about a little beats guessing about a lot: one
   mislabelled glyph means every future "a" is actually an "o".
   ============================================================ */
'use strict';

import { otsuThreshold, binarize } from './capture.js';

/* ---------- deskew ------------------------------------------------------ */

/**
 * Estimate the page's skew in degrees.
 *
 * Rows of text stack into a strongly peaked horizontal projection when the
 * page is straight, and smear into mush when it is tilted. So try a range of
 * angles and keep the one whose projection is peakiest, measured as the sum
 * of squared row totals.
 *
 * The rotation is approximated by shearing (offsetting each column by
 * x*tan(angle)) which is accurate to well under a pixel for the small angles
 * a photographed page actually has, and is far cheaper than rotating.
 */
export function estimateSkew(bin, w, h, { maxDeg = 8, step = 0.25 } = {}) {
  let best = 0, bestScore = -1;
  for (let deg = -maxDeg; deg <= maxDeg; deg += step) {
    const t = Math.tan(deg * Math.PI / 180);
    const rows = new Float64Array(h);
    for (let x = 0; x < w; x++) {
      const shift = Math.round(x * t);
      for (let y = 0; y < h; y++) {
        if (!bin[y * w + x]) continue;
        const ry = y - shift;
        if (ry >= 0 && ry < h) rows[ry]++;
      }
    }
    let score = 0;
    for (let i = 0; i < h; i++) score += rows[i] * rows[i];
    if (score > bestScore) { bestScore = score; best = deg; }
  }
  return best;
}

/** Rotate a greyscale image about its centre, bilinear, white outside. */
export function rotateGray(gray, w, h, deg) {
  if (Math.abs(deg) < 0.01) return gray;
  const rad = -deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = w / 2, cy = h / 2;
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const fx = sx - x0, fy = sy - y0;
      const a = gray[y0 * w + x0], b = gray[y0 * w + x0 + 1];
      const c = gray[(y0 + 1) * w + x0], d = gray[(y0 + 1) * w + x0 + 1];
      out[y * w + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return out;
}

/* ---------- lines ------------------------------------------------------- */

function smooth(arr, radius) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < arr.length) { s += arr[j]; n++; }
    }
    out[i] = s / n;
  }
  return out;
}

/**
 * Split the page into text lines by horizontal projection.
 * `minInkFrac` is relative to the busiest row, so it adapts to how dense the
 * writing is rather than assuming a fixed amount of ink.
 */
export function findLines(bin, w, h, { minInkFrac = 0.06, minHeight = 6 } = {}) {
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (bin[y * w + x]) c++;
    rows[y] = c;
  }
  const sm = smooth(rows, 2);
  let peak = 0;
  for (let i = 0; i < h; i++) if (sm[i] > peak) peak = sm[i];
  if (peak === 0) return [];
  const thresh = peak * minInkFrac;

  const bands = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    const on = sm[y] > thresh;
    if (on && start < 0) start = y;
    else if (!on && start >= 0) {
      if (y - start >= minHeight) bands.push({ top: start, bottom: y - 1 });
      start = -1;
    }
  }
  if (start >= 0 && h - start >= minHeight) bands.push({ top: start, bottom: h - 1 });

  /* Rejoin bands that are really one line.
   *
   * Dots, tittles and accents float above the body of a line, and where a
   * line is sparse enough there is clean white between them and the letters
   * underneath. That reads as two lines, and everything downstream then
   * segments the dots as though they were words. Merge a band into the one
   * above it when the gap between them is small next to the bands themselves;
   * a genuine line break is a much wider gap than a tittle's. */
  const merged = [];
  for (const b of bands) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gap = b.top - prev.bottom - 1;
      const reference = Math.max(prev.bottom - prev.top + 1, b.bottom - b.top + 1);
      if (gap <= reference * 0.9) { prev.bottom = b.bottom; continue; }
    }
    merged.push({ ...b });
  }
  return merged;
}

/* ---------- words ------------------------------------------------------- */

/**
 * Decide how wide a gap has to be to mean "new word".
 *
 * Deriving this from the line height was wrong, and wrong in a way that only
 * showed up at small sizes: line height depends on whether the line happens
 * to contain an ascender or a descender, so the same words at 18px glued
 * together while at 46px they split correctly.
 *
 * The gaps on a line of writing are genuinely bimodal — a tight cluster
 * between letters and a wider cluster between words. So look at the gaps
 * themselves, sort them, and cut at the biggest jump. That adapts to any
 * writing size and any hand, with no constant to tune.
 *
 * When there is no clear jump the line is one word, which is the honest
 * answer and safer than inventing a split.
 */
function wordGapThreshold(cols, w, lineH, gapFrac) {
  const gaps = [];
  let run = 0, seenInk = false;
  for (let x = 0; x < w; x++) {
    if (cols[x]) {
      if (seenInk && run > 0) gaps.push(run);
      run = 0; seenInk = true;
    } else if (seenInk) run++;
  }
  const floor = Math.max(2, Math.round(lineH * 0.08));
  if (gaps.length < 2) return Math.max(floor, Math.round(lineH * gapFrac));

  const sorted = gaps.slice().sort((a, b) => a - b);
  let cut = -1, jump = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const d = sorted[i + 1] - sorted[i];
    if (d > jump) { jump = d; cut = i; }
  }
  /* A real word gap is markedly wider than a letter gap. Without that margin
     the "biggest jump" is just noise between two similar letter gaps. */
  if (cut < 0 || sorted[cut + 1] < sorted[cut] * 1.6) return w + 1;   // one word
  return Math.max(floor, Math.ceil((sorted[cut] + sorted[cut + 1]) / 2));
}

/**
 * Split a line into words by looking for column gaps.
 */
export function findWords(bin, w, h, line, { gapFrac = 0.28, minWidth = 3 } = {}) {
  const lineH = line.bottom - line.top + 1;

  const cols = new Uint32Array(w);
  for (let y = line.top; y <= line.bottom; y++) {
    for (let x = 0; x < w; x++) if (bin[y * w + x]) cols[x]++;
  }

  const minGap = wordGapThreshold(cols, w, lineH, gapFrac);
  const words = [];
  let start = -1, gap = 0;
  for (let x = 0; x < w; x++) {
    if (cols[x]) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= minGap) {
        const end = x - gap;
        if (end - start + 1 >= minWidth) words.push({ left: start, right: end, top: line.top, bottom: line.bottom });
        start = -1; gap = 0;
      }
    }
  }
  if (start >= 0 && w - start >= minWidth) {
    words.push({ left: start, right: w - 1, top: line.top, bottom: line.bottom });
  }
  return words;
}

/* ---------- letters ----------------------------------------------------- */

function componentsIn(bin, w, box) {
  const bw = box.right - box.left + 1, bh = box.bottom - box.top + 1;
  const seen = new Uint8Array(bw * bh);
  const out = [];
  const at = (x, y) => bin[(y + box.top) * w + (x + box.left)];

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const p = y * bw + x;
      if (seen[p] || !at(x, y)) continue;
      const stack = [p];
      let area = 0, minX = x, maxX = x, minY = y, maxY = y;
      const cells = [];
      while (stack.length) {
        const q = stack.pop();
        if (seen[q]) continue;
        const qx = q % bw, qy = (q - qx) / bw;
        if (!at(qx, qy)) { seen[q] = 1; continue; }
        seen[q] = 1;
        cells.push(q);
        area++;
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        if (qx > 0) stack.push(q - 1);
        if (qx < bw - 1) stack.push(q + 1);
        if (qy > 0) stack.push(q - bw);
        if (qy < bh - 1) stack.push(q + bw);
      }
      out.push({ area, minX, maxX, minY, maxY, cells });
    }
  }
  return { comps: out, bw, bh };
}

/**
 * Letters inside one word.
 *
 * Connected components, left to right, with two merges that matter:
 *  - blobs whose horizontal spans overlap heavily are one letter (the dot of
 *    an i or j sitting above its stem, a broken stroke in a shaky hand)
 *  - specks below `minArea` are dropped as pen taps and paper grain
 */
export function findLetters(bin, w, word, { minArea = 12, overlapFrac = 0.55 } = {}) {
  const { comps, bw, bh } = componentsIn(bin, w, word);
  const keep = comps.filter(c => c.area >= minArea);
  keep.sort((a, b) => a.minX - b.minX);

  /* Merge a dot onto its stem, and nothing else.
   *
   * Three conditions must all hold, and each one is load-bearing:
   *   - horizontal overlap: the dot sits over the stem
   *   - vertically disjoint: one is entirely above the other, which is what
   *     makes it a dot rather than two letters that happen to be close
   *   - much smaller: a tittle is a fraction of its stem
   *
   * Overlap is measured against the ORIGINAL component that started the
   * group, not the growing bounding box. Comparing against the box was the
   * bug that turned "ii" into one letter: merging a dot widened the box, the
   * next dot then overlapped the wider box, and the whole word zipped shut.
   */
  const merged = [];
  for (const c of keep) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const a = prev.seed;
      const lo = Math.max(a.minX, c.minX), hi = Math.min(a.maxX, c.maxX);
      const overlap = hi - lo + 1;
      const narrower = Math.min(a.maxX - a.minX + 1, c.maxX - c.minX + 1);
      const disjointY = c.minY > a.maxY || a.minY > c.maxY;
      const muchSmaller = Math.min(a.area, c.area) < 0.45 * Math.max(a.area, c.area);
      if (overlap > 0 && overlap / narrower >= overlapFrac && disjointY && muchSmaller) {
        prev.minX = Math.min(prev.minX, c.minX); prev.maxX = Math.max(prev.maxX, c.maxX);
        prev.minY = Math.min(prev.minY, c.minY); prev.maxY = Math.max(prev.maxY, c.maxY);
        prev.area += c.area;
        prev.cells = prev.cells.concat(c.cells);
        continue;
      }
    }
    merged.push({ ...c, seed: { minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY, area: c.area } });
  }

  return merged.map(c => {
    const cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
    const mask = new Uint8Array(cw * ch);
    for (const q of c.cells) {
      const qx = q % bw, qy = (q - qx) / bw;
      mask[(qy - c.minY) * cw + (qx - c.minX)] = 1;
    }
    return {
      mask, w: cw, h: ch, area: c.area,
      /* Page coordinates, so the caller can draw boxes over the photo. */
      left: word.left + c.minX, top: word.top + c.minY,
      right: word.left + c.maxX, bottom: word.top + c.maxY
    };
  });
}

/* ---------- whole page -------------------------------------------------- */

/**
 * Take a photographed page apart.
 * Returns the deskewed binary image plus its lines, words and letters.
 */
export function analysePage(gray, w, h, opts = {}) {
  const t0 = otsuThreshold(gray);
  const rough = binarize(gray, t0);
  const skew = opts.skew != null ? opts.skew : estimateSkew(rough, w, h, opts);
  const straight = rotateGray(gray, w, h, skew);
  const t = otsuThreshold(straight);
  const bin = binarize(straight, t);

  const lines = findLines(bin, w, h, opts).map(line => {
    const words = findWords(bin, w, h, line, opts).map(word => ({
      ...word,
      letters: findLetters(bin, w, word, opts)
    }));
    return { ...line, words };
  }).filter(l => l.words.length);

  return {
    bin, w, h, skew, threshold: t, lines,
    stats: {
      lines: lines.length,
      words: lines.reduce((a, l) => a + l.words.length, 0),
      letters: lines.reduce((a, l) => a + l.words.reduce((b, wd) => b + wd.letters.length, 0), 0)
    }
  };
}

/* ---------- line metrics ------------------------------------------------ */

/** Most common value in a list, within a tolerance, as a weighted mean. */
function mode(values, tol) {
  if (!values.length) return null;
  let best = values[0], bestCount = 0;
  for (const v of values) {
    let sum = 0, count = 0;
    for (const u of values) if (Math.abs(u - v) <= tol) { sum += u; count++; }
    if (count > bestCount) { bestCount = count; best = sum / count; }
  }
  return best;
}

/**
 * The baseline, from the bottom edge of every letter on the line.
 *
 * A plain mode is not enough. Letters sit on the baseline and descenders hang
 * below it, so the bottoms form two clusters — but on a line like "gypsy
 * pygmy" the descenders are the MAJORITY, and the mode picks their cluster.
 * The style then sits several pixels too low and every letter is misplaced.
 *
 * Descenders only ever go below the baseline, never above. So among the
 * clusters that have enough members to be real, the baseline is the TOPMOST
 * one. That holds whether descenders are rare or dominant.
 */
function baselineFromBottoms(bottoms, tol) {
  const sorted = bottoms.slice().sort((a, b) => a - b);
  const clusters = [];
  for (const v of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && v - c.max <= tol) { c.vals.push(v); c.max = v; }
    else clusters.push({ vals: [v], max: v });
  }
  const floor = Math.max(2, bottoms.length * 0.2);
  const real = clusters.filter(c => c.vals.length >= floor);
  const chosen = real.length
    ? real[0]                                        // topmost, i.e. smallest y
    : clusters.slice().sort((a, b) => b.vals.length - a.vals.length)[0];
  return chosen.vals.reduce((a, b) => a + b, 0) / chosen.vals.length;
}

/**
 * Where the baseline and x-height line sit on one line of real writing.
 *
 * The donor sheet prints these; a page somebody already wrote does not, so
 * they have to be read off the letters.
 *
 * Baseline: the MODE of letter bottoms, not the mean. Most letters sit on the
 * line, and descenders (g, y, p, q) hang below. A mean would be dragged down
 * by every descender and the whole style would sit too low; the mode ignores
 * them, because they are always the minority.
 *
 * X-height: the mode of the tops of letters that both sit on the baseline and
 * are not tall. That excludes ascenders (b, d, k, l) and capitals, leaving the
 * short round letters that define x-height.
 */
export function lineMetrics(line, { tol = 3 } = {}) {
  const letters = line.words.flatMap(w => w.letters);
  if (!letters.length) return null;

  const bottoms = letters.map(l => l.bottom);
  const baseline = baselineFromBottoms(bottoms, tol);

  const heights = letters.map(l => l.h).sort((a, b) => a - b);
  const medianH = heights[heights.length >> 1];

  const shortOnLine = letters.filter(l =>
    Math.abs(l.bottom - baseline) <= tol * 1.5 && l.h <= medianH * 1.25);
  const xheight = shortOnLine.length >= 2
    ? mode(shortOnLine.map(l => l.top), tol)
    : baseline - medianH * 0.6;      // fallback: assume a plausible proportion

  return {
    baseline,
    xheight,
    xHeightPx: baseline - xheight,
    sampleSize: shortOnLine.length,
    /* Low confidence means the caller should treat this line's glyphs as
       suspect rather than silently building a style on a guess. */
    confident: shortOnLine.length >= 3 && (baseline - xheight) > 2
  };
}

/* ---------- aligning ink to a transcript -------------------------------- */

/** Strip anything the style cannot hold a sample for. */
function transcriptWords(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(l => l.split(/\s+/).filter(Boolean));
}

/**
 * Match segmented words against a transcript, keeping only the unambiguous
 * ones. Returns per-word results so the UI can show what was used and what
 * was skipped, and why.
 */
export function alignTranscript(page, text) {
  const tLines = transcriptWords(text);
  const results = [];
  let matched = 0, skipped = 0;

  for (let li = 0; li < page.lines.length; li++) {
    const inkWords = page.lines[li].words;
    const words = tLines[li] || [];
    for (let wi = 0; wi < inkWords.length; wi++) {
      const ink = inkWords[wi];
      const word = words[wi];
      if (word == null) {
        results.push({ line: li, word: wi, ink, reason: 'no transcript for this word' });
        skipped++; continue;
      }
      const chars = [...word];
      if (chars.length !== ink.letters.length) {
        results.push({
          line: li, word: wi, ink, text: word,
          reason: `${ink.letters.length} ink blob(s) but ${chars.length} letter(s)`
        });
        skipped++; continue;
      }
      results.push({ line: li, word: wi, ink, text: word, pairs: chars.map((ch, i) => ({ ch, letter: ink.letters[i] })) });
      matched++;
    }
  }
  return { results, matched, skipped };
}
