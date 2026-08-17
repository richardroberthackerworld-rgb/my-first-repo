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

/* ---------- finding the page --------------------------------------------- */

/**
 * Locate the sheet of paper inside a photograph.
 *
 * A photo is not a scan. It contains the desk, the shadow beside the spine,
 * the dark strip where the page curls away, sometimes a hand. All of that
 * survives thresholding, and a dark band running down the side of the image
 * puts ink in every row — which merges every line of writing into one and
 * makes the page yield nothing.
 *
 * Trying to erase that afterwards does not work. Its solid core gets removed,
 * but the antialiased boundary breaks into a dotted line of fragments, each
 * too small to look like a rule and too disconnected to look like a blob,
 * still smeared down the full height. The fix is to never look at it: find
 * the paper and crop to it.
 *
 * The paper is the largest bright region. Nothing else in a photograph of a
 * page is both bright and that large.
 */
export function findPageBounds(gray, w, h, { brightFrac = 0.55, insetFrac = 0.004 } = {}) {
  const t = otsuThreshold(gray);
  /* Paper is comfortably above the ink threshold. Sitting the cut between the
     two keeps shadowed paper on the paper side. */
  const bright = t + (255 - t) * brightFrac;

  /* Projections, not connected components.
     The obvious approach — largest connected bright region — fails on exactly
     the pages this exists for: the printed rules are darker than the bright
     cut, so they slice the paper into horizontal strips and no single strip is
     large enough to look like a page. Counting bright pixels per row and per
     column does not care whether the paper is cut up. */
  const rowBright = new Uint32Array(h);
  const colBright = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] >= bright) { rowBright[y]++; colBright[x]++; }
    }
  }

  const span = (counts, n, limit) => {
    const need = limit * 0.3;
    let from = 0, to = n - 1;
    while (from < n && counts[from] < need) from++;
    while (to > from && counts[to] < need) to--;
    return { from, to };
  };

  const rows = span(rowBright, h, w);
  const cols = span(colBright, w, h);

  /* Nothing convincing: a very dark photo, or a page already filling the
     frame. Use the whole image rather than cropping to something arbitrary. */
  if (rows.to - rows.from < h * 0.3 || cols.to - cols.from < w * 0.3) {
    return { x: 0, y: 0, w, h, cropped: false };
  }

  /* Pull in slightly so the paper's own edge shadow stays outside. */
  const inset = Math.round(Math.min(w, h) * insetFrac);
  const x = Math.max(0, cols.from + inset);
  const y = Math.max(0, rows.from + inset);
  const x1 = Math.min(w - 1, cols.to - inset);
  const y1 = Math.min(h - 1, rows.to - inset);
  return {
    x, y, w: Math.max(1, x1 - x + 1), h: Math.max(1, y1 - y + 1),
    cropped: !(x === 0 && y === 0 && x1 === w - 1 && y1 === h - 1)
  };
}

/** Copy a rectangle out of a greyscale image. */
export function cropGray(gray, w, h, box) {
  const out = new Uint8Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) out[y * box.w + x] = gray[(y + box.y) * w + (x + box.x)];
  }
  return out;
}

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

/* ---------- printed ruling ---------------------------------------------- */

/**
 * Find the printed rules on notebook paper.
 *
 * This has to run before anything else, and missing it is fatal rather than
 * merely degrading: a printed rule spans the full width, so it welds every
 * line of writing to the ones above and below (one giant text band instead of
 * thirty) AND removes every vertical gap (one giant "word" per line).
 * Segmentation cannot recover from either.
 *
 * The discriminator is length. A ruling crosses most of the page; the longest
 * horizontal stroke in handwriting is a few characters wide. So a row whose
 * longest unbroken run of ink covers `minFrac` of the page is part of a rule.
 */
export function detectRuling(bin, w, h, { minRunFrac = 0.045, minRunPx = 22, vertFrac = 0.25 } = {}) {
  /**
   * Rules are found by LOCAL run length, not by whole rows.
   *
   * The first version asked "does this image row contain a long run of ink"
   * and marked the whole row. That works on a flat scan and fails completely
   * on a photograph, which is what people actually take: a bound notebook
   * photographed at an angle has rules that bow and drift, from page curl and
   * perspective. A curved rule never sits inside one image row, so no row
   * qualifies and almost nothing is found. On a real page it detected 3 rules
   * out of about 30, and rotating the image cannot fix it — the rules are
   * curved, not tilted.
   *
   * Marking individual pixels that belong to a long horizontal run has no
   * such assumption. A rule is long everywhere along its length whatever
   * shape it takes, while handwriting has no horizontal stroke anywhere near
   * that long. Underlines are removed too, which is correct: they are ruling
   * as far as the letters are concerned.
   *
   * Returns a mask: 1 = horizontal rule, 2 = vertical rule.
   */
  const kH = Math.max(minRunPx, Math.round(w * minRunFrac));

  /* The vertical threshold is a much larger fraction than the horizontal one,
     and the asymmetry is deliberate. Handwriting has no long HORIZONTAL runs,
     but it is full of long VERTICAL ones — the stem of every l, k, h, b and d.
     Using the same fraction both ways erased those stems as though they were
     margin rule, which quietly mutilated letters and dropped the yield.
     A margin rule runs most of the height of the page; a letter stem never
     comes close. */
  const kV = Math.max(minRunPx, Math.round(h * vertFrac));
  const mask = new Uint8Array(w * h);
  let hCount = 0, vCount = 0;

  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!bin[y * w + x]) { x++; continue; }
      const start = x;
      while (x < w && bin[y * w + x]) x++;
      if (x - start >= kH) {
        for (let i = start; i < x; i++) mask[y * w + i] = 1;
        hCount++;
      }
    }
  }

  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!bin[y * w + x]) { y++; continue; }
      const start = y;
      while (y < h && bin[y * w + x]) y++;
      if (y - start >= kV) {
        for (let i = start; i < y; i++) mask[i * w + x] = mask[i * w + x] || 2;
        vCount++;
      }
    }
  }

  return { mask, horizontalRuns: hCount, verticalRuns: vCount, kH, kV };
}

/**
 * Erase the printed ruling, keeping the handwriting that crosses it.
 *
 * Blanking the rule rows outright would slice through every descender and
 * every letter sitting on the line, which on ruled paper is most of them. So
 * a pixel inside a rule is cleared only when there is no ink continuing on
 * both sides of it at that column — that is, when nothing is passing through.
 * Where a stroke does cross, its pixels stay and the letter survives.
 */
export function removeRuling(bin, w, h, ruling, { probe = 4, slack = 1 } = {}) {
  const { mask } = ruling;
  const out = new Uint8Array(bin);

  /* Ink that is NOT itself part of a rule. A rule crossing another rule must
     not count as "a stroke passes through here", or the intersections of the
     margin rule with every horizontal rule would all be preserved. */
  const realInk = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    const p = y * w + x;
    return bin[p] === 1 && mask[p] === 0;
  };
  const nearRow = (x, y) => {
    for (let dx = -slack; dx <= slack; dx++) if (realInk(x + dx, y)) return true;
    return false;
  };
  const nearCol = (x, y) => {
    for (let dy = -slack; dy <= slack; dy++) if (realInk(x, y + dy)) return true;
    return false;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;

      /* Keep the pixel when handwriting continues on both sides of the rule:
         a descender passing through, or a letter straddling the line. Erasing
         those would cut letters in half, and on ruled paper most letters sit
         on a rule. */
      let a = false, b = false;
      if (mask[p] === 1) {
        for (let d = 1; d <= probe && !(a && b); d++) {
          if (nearRow(x, y - d)) a = true;
          if (nearRow(x, y + d)) b = true;
        }
      } else {
        for (let d = 1; d <= probe && !(a && b); d++) {
          if (nearCol(x - d, y)) a = true;
          if (nearCol(x + d, y)) b = true;
        }
      }
      if (!(a && b)) out[p] = 0;
    }
  }

  return out;
}

/**
 * Discard anything far too big to be handwriting.
 *
 * A photograph of a notebook contains more than the page: the dark background
 * either side, the shadow along the spine, a binder ring, the edge of the
 * desk. Those survive thresholding as enormous blobs, and a blob that spans
 * the height of the image puts ink in every row — so the horizontal
 * projection never drops, every line of writing merges into one band, and the
 * page yields nothing. That is what a real photo did: one line, two words,
 * from a page holding thirty lines.
 *
 * Bounding box is the giveaway. A letter occupies a few percent of the page.
 * The limits are loose on width, because joined-up writing can run a whole
 * word together, and tight on height, where nothing legitimate comes close.
 */
export function dropOversized(bin, w, h, { maxHeightFrac = 0.22, maxWidthFrac = 0.6 } = {}) {
  const maxH = h * maxHeightFrac, maxW = w * maxWidthFrac;
  const out = new Uint8Array(bin);
  const seen = new Uint8Array(w * h);
  let dropped = 0;

  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const p0 = y0 * w + x0;
      if (seen[p0] || !bin[p0]) continue;

      const stack = [p0];
      const cells = [];
      let minX = x0, maxX = x0, minY = y0, maxY = y0;
      while (stack.length) {
        const p = stack.pop();
        if (seen[p]) continue;
        seen[p] = 1;
        if (!bin[p]) continue;
        const x = p % w, y = (p - x) / w;
        cells.push(p);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0) stack.push(p - 1);
        if (x < w - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - w);
        if (y < h - 1) stack.push(p + w);
      }

      if (maxY - minY + 1 > maxH || maxX - minX + 1 > maxW) {
        for (const p of cells) out[p] = 0;
        dropped++;
      }
    }
  }
  return { bin: out, dropped };
}

/* ---------- de-curl ------------------------------------------------------ */

/**
 * Straighten text lines that bow across the page.
 *
 * Rotation is not enough. A photograph of a bound notebook has lines that
 * CURVE — from page curl near the spine and from perspective — and a curve
 * cannot be rotated flat. Line finding works by horizontal projection, which
 * assumes a line of writing occupies one horizontal band, so a bowed line
 * smears across many rows and splits into several. Measured on a synthetic
 * page, a bow of just 2px against a 76px line pitch took line detection from
 * 4 lines to 6 and dropped word matches from 7 to 1. Real photos always have
 * at least that much.
 *
 * The page is cut into vertical strips and each strip's row profile is
 * correlated against its LEFT NEIGHBOUR, not against the whole page — the
 * whole-page profile is itself smeared by the curl, so correlating against it
 * would be measuring the problem with a ruler made of the problem.
 * Accumulating neighbour-to-neighbour offsets traces the curve.
 */
export function estimateCurl(bin, w, h, { strips = 14, maxShift = 0 } = {}) {
  const S = Math.max(2, Math.min(strips, Math.floor(w / 40)));
  const D = maxShift || Math.max(4, Math.round(h * 0.04));

  const profile = (x0, x1) => {
    const p = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      let c = 0;
      for (let x = x0; x < x1; x++) if (bin[y * w + x]) c++;
      p[y] = c;
    }
    return smooth(p, 2);
  };

  const profiles = [];
  for (let s = 0; s < S; s++) {
    profiles.push(profile(Math.floor(s * w / S), Math.floor((s + 1) * w / S)));
  }

  const rel = [0];
  for (let s = 1; s < S; s++) {
    const a = profiles[s - 1], b = profiles[s];
    let best = 0, bestScore = -Infinity;
    for (let d = -D; d <= D; d++) {
      let score = 0;
      for (let y = 0; y < h; y++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) score += b[y] * a[yy];
      }
      /* Prefer the smallest shift among equals: without this a blank strip
         drifts arbitrarily and drags the rest of the page with it. */
      if (score > bestScore * 1.0001) { bestScore = score; best = d; }
    }
    rel.push(best);
  }

  const cum = [];
  let acc = 0;
  for (const d of rel) { acc += d; cum.push(acc); }
  const mean = cum.reduce((a, b) => a + b, 0) / cum.length;
  return cum.map(v => v - mean);
}

/** Apply a per-strip vertical shift, interpolating between strip centres. */
export function applyCurl(gray, w, h, shifts) {
  const S = shifts.length;
  if (S < 2) return gray;
  const out = new Uint8Array(w * h).fill(255);
  const centre = s => (s + 0.5) * w / S;

  for (let x = 0; x < w; x++) {
    /* linear interpolation of the shift between neighbouring strip centres */
    let shift;
    if (x <= centre(0)) shift = shifts[0];
    else if (x >= centre(S - 1)) shift = shifts[S - 1];
    else {
      let s = 0;
      while (s < S - 2 && centre(s + 1) < x) s++;
      const t = (x - centre(s)) / (centre(s + 1) - centre(s));
      shift = shifts[s] * (1 - t) + shifts[s + 1] * t;
    }

    for (let y = 0; y < h; y++) {
      /* Sample from where the content currently is: a strip measured as
         displaced by +d is pulled back by reading from y - d. Getting this
         sign backwards does not fail loudly — it doubles the curve instead of
         removing it, and the page just segments slightly worse.
         Rounding to whole pixels instead of interpolating was tried and is
         worse: it leaves a step at every strip boundary, and the steps
         fragment lines more than the interpolation blurs letters. */
      const sy = y - shift;
      const y0 = Math.floor(sy);
      if (y0 < 0 || y0 + 1 >= h) continue;
      const f = sy - y0;
      out[y * w + x] = gray[y0 * w + x] * (1 - f) + gray[(y0 + 1) * w + x] * f;
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
   * line is sparse there is clean white between them and the letters below.
   * That reads as two lines, and the dots then get segmented as words.
   *
   * But this merge must be narrow. On ruled paper the lines of writing sit
   * close together, and a loose rule swallows the whole page into one band —
   * which is exactly what a too-generous 0.9 threshold did. A dot band is
   * both CLOSE to its line and much THINNER than it, so require both. Two
   * adjacent lines of writing are similar heights and fail the second test
   * no matter how tightly they are spaced. */
  const merged = [];
  for (const b of bands) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gap = b.top - prev.bottom - 1;
      const hPrev = prev.bottom - prev.top + 1;
      const hCur = b.bottom - b.top + 1;
      const close = gap <= Math.max(hPrev, hCur) * 0.35;
      const oneIsThin = Math.min(hPrev, hCur) <= Math.max(hPrev, hCur) * 0.5;
      if (close && oneIsThin) { prev.bottom = b.bottom; continue; }
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

  const max = Math.max(...gaps);
  if (max < 3) return w + 1;                 // nothing here is a word gap

  /* Otsu over the gap lengths.
   *
   * Cutting at the biggest jump in the sorted gaps was wrong, and wrong in a
   * way that looked fine on one test line. On [1,1,1,1,2,2,2,2,2,7,8,15] the
   * biggest jump is 8 to 15 — an outlier in the tail — so the threshold lands
   * above every real word gap and the whole line becomes one word. The
   * boundary that matters is 2 to 7, and it is not the biggest step.
   *
   * Otsu finds the split that best separates the two clusters rather than the
   * largest single step, which is exactly the question being asked. It also
   * errs the safe way: an over-split word simply fails the letter-count check
   * and is skipped, whereas an under-split line yields nothing at all and
   * gives no clue why. */
  const hist = new Uint32Array(max + 1);
  for (const g of gaps) hist[g]++;

  let sum = 0;
  for (let i = 0; i <= max; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 1, bestVar = -1;
  for (let t = 0; t < max; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = gaps.length - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > bestVar) { bestVar = between; best = t; }
  }

  /* `best` is the last letter-gap length, so a word gap is anything above it. */
  return Math.max(floor, best + 1);
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
export function analysePage(gray0, w0, h0, opts = {}) {
  /* Crop to the paper first. Everything downstream measures projections over
     the whole image, so any desk or shadow left in frame corrupts all of it. */
  const page = opts.cropToPage === false
    ? { x: 0, y: 0, w: w0, h: h0, cropped: false }
    : findPageBounds(gray0, w0, h0, opts);
  const gray = page.cropped ? cropGray(gray0, w0, h0, page) : gray0;
  const w = page.w, h = page.h;

  const t0 = otsuThreshold(gray);
  const rough = binarize(gray, t0);
  const skew = opts.skew != null ? opts.skew : estimateSkew(rough, w, h, opts);
  let straight = rotateGray(gray, w, h, skew);

  /* Then flatten the curve. Rotation handles a tilted page; only this handles
     a curved one, and every photo of a bound notebook is curved. */
  let curl = null, curlApplied = false;
  if (opts.deCurl !== false) {
    curl = estimateCurl(binarize(straight, otsuThreshold(straight)), w, h, opts);
    /* Only straighten when there is enough curve to be worth it.
       Resampling costs sharpness, and a softened stroke edge can bridge the
       gap to its neighbour when the image is thresholded again — which merges
       letters and costs matches. Below a few pixels the curve does not break
       line finding, so paying that cost would be a net loss. Above it, the
       page is unusable uncorrected and the trade is clearly worth making. */
    const amplitude = Math.max(...curl.map(Math.abs));
    if (amplitude >= (opts.minCurlPx ?? 3)) {
      straight = applyCurl(straight, w, h, curl);
      curlApplied = true;
    }
  }

  const t = otsuThreshold(straight);
  let bin = binarize(straight, t);

  /* Ruled paper first. Almost every page a student writes on is ruled, and
     the printed rules destroy both line and word segmentation if they reach
     the next stage. Skew is corrected before this so the rules are horizontal
     and their full length is visible in a single row. */
  let ruling = { mask: null, horizontalRuns: 0, verticalRuns: 0 };
  let oversized = 0;
  if (opts.removeRuling !== false) {
    ruling = detectRuling(bin, w, h, opts);
    if (ruling.horizontalRuns || ruling.verticalRuns) {
      bin = removeRuling(bin, w, h, ruling, opts);
    }
    /* After the ruling, before anything measures a projection: the page edges
       and shadows in a photograph are bigger than any letter and put ink in
       every row, which merges the whole page into one line. */
    const cleaned = dropOversized(bin, w, h, opts);
    bin = cleaned.bin;
    oversized = cleaned.dropped;
  }

  const lines = findLines(bin, w, h, opts).map(line => {
    const words = findWords(bin, w, h, line, opts)
      .map(word => ({ ...word, letters: findLetters(bin, w, word, opts) }))
      /* A word with no extractable letters must never survive. It is a smudge,
         a speck, or a scrap of margin rule — and because alignment pairs the
         Nth ink word with the Nth transcript word, one phantom word at the
         start of a line shifts every real word after it by one. The page then
         yields almost nothing and the reason is invisible. */
      .filter(word => word.letters.length > 0);
    return { ...line, words };
  }).filter(l => l.words.length);

  return {
    bin, w, h, skew, threshold: t, lines, ruling, page, curl,
    stats: {
      cropped: page.cropped,
      curlPx: curl ? Math.round(Math.max(...curl.map(Math.abs))) : 0,
      curlCorrected: curlApplied,
      lines: lines.length,
      words: lines.reduce((a, l) => a + l.words.length, 0),
      letters: lines.reduce((a, l) => a + l.words.reduce((b, wd) => b + wd.letters.length, 0), 0),
      rulesRemoved: ruling.horizontalRuns + ruling.verticalRuns,
      oversizedDropped: oversized
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
