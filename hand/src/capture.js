/* ============================================================
   7Hand — scan to rectified binary page.

     scan ─► redChannel ─► otsu ─► findFiducials ─┐
       │                                          │
       └──────────► warp (homography) ◄───────────┘
                          │
                          ▼
                 rectified binary page ─► cell crops

   RED CHANNEL, NOT LUMINANCE. The rules printed inside each cell
   are light blue. Read through the red channel a light blue line
   is nearly white and vanishes, while black and blue ink both
   stay dark. This is the old non-repro-blue trick and it works
   here because we control the printing and the scanning. It is
   NOT safe for v1 user photos of shop photocopies, where the
   copier decides what happens to blue — that path uses template
   difference instead.

   Donors must therefore write in black or blue. A red pen would
   disappear along with the rules.
   ============================================================ */
'use strict';

/* ---------- greyscale and thresholding --------------------------------- */

/** Red channel of an ImageData as a Uint8Array. */
export function redChannel(img) {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = data[i];
  return out;
}

/** Plain luminance, for cases where colour dropout is not wanted. */
export function luminance(img) {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return out;
}

/**
 * Otsu's method: the threshold that best separates the histogram into two
 * groups. Good enough for a flatbed scan, where lighting is even. A phone
 * photo would need a local/adaptive threshold instead.
 *
 * Deviation from the textbook version, on purpose: a scan of pen on paper has
 * a wide empty gap between the ink peak and the paper peak, and EVERY value in
 * that gap scores identically. The usual implementation keeps the first such
 * value, which sits right against the ink peak. That is the worst place for
 * us: the edge pixels of a pen stroke are antialiased mid-greys, and a
 * threshold hugging the ink peak shaves them off, thinning strokes until a
 * light one breaks into dashes. So we take the MIDDLE of the winning plateau,
 * which keeps antialiased edges as ink and leaves the strokes intact.
 */
export function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0, wB = 0, bestVar = -1, lo = 0, hi = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar * (1 + 1e-12)) { bestVar = between; lo = hi = t; }
    else if (between >= bestVar * (1 - 1e-12)) { hi = t; }
  }
  return Math.round((lo + hi) / 2);
}

/** Ink is DARK, so a pixel is set when it falls at or below the threshold. */
export function binarize(gray, threshold) {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= threshold ? 1 : 0;
  return out;
}

/* ---------- connected components ---------------------------------------- */

/**
 * Label the blob containing (sx,sy) and return its bounding box, area and
 * centroid. Iterative on an explicit stack — a recursive flood fill dies on
 * a large blob, and a fiducial at 600dpi is tens of thousands of pixels.
 */
function floodFill(bin, w, h, sx, sy, seen, label) {
  const stack = [sy * w + sx];
  let area = 0, minX = sx, maxX = sx, minY = sy, maxY = sy, sumX = 0, sumY = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    if (!bin[p]) { seen[p] = label; continue; }
    seen[p] = label;
    const x = p % w, y = (p - x) / w;
    area++; sumX += x; sumY += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x > 0 && !seen[p - 1]) stack.push(p - 1);
    if (x < w - 1 && !seen[p + 1]) stack.push(p + 1);
    if (y > 0 && !seen[p - w]) stack.push(p - w);
    if (y < h - 1 && !seen[p + w]) stack.push(p + w);
  }
  return { area, minX, maxX, minY, maxY, cx: sumX / area, cy: sumY / area };
}

/**
 * Find the four corner fiducials.
 *
 * Each is looked for inside its own corner quadrant, so a stray mark in the
 * middle of the page can never be mistaken for one. Candidates must be
 * roughly square and roughly solid, which rules out the donor's handwriting
 * and the cell borders.
 *
 * Returns four centres in fiducial order (TL, TR, BR, BL), or null when any
 * corner is missing — the caller then falls back to manual corner placement
 * rather than guessing, because a wrong guess produces a skewed grid that
 * corrupts every glyph without failing.
 */
export function findFiducials(bin, w, h, { expectFrac = 8 / 210 } = {}) {
  const expect = expectFrac * w;                 // expected side in px
  const minArea = (expect * 0.4) ** 2;
  const maxArea = (expect * 2.2) ** 2;
  const qw = Math.floor(w * 0.28), qh = Math.floor(h * 0.28);

  const quadrants = [
    { x0: 0, y0: 0, x1: qw, y1: qh },                     // TL
    { x0: w - qw, y0: 0, x1: w, y1: qh },                 // TR
    { x0: w - qw, y0: h - qh, x1: w, y1: h },             // BR
    { x0: 0, y0: h - qh, x1: qw, y1: h }                  // BL
  ];

  const seen = new Int32Array(w * h);
  let label = 0;
  const found = [];

  for (const q of quadrants) {
    let best = null;
    for (let y = q.y0; y < q.y1; y++) {
      for (let x = q.x0; x < q.x1; x++) {
        const p = y * w + x;
        if (!bin[p] || seen[p]) continue;
        const blob = floodFill(bin, w, h, x, y, seen, ++label);
        if (blob.area < minArea || blob.area > maxArea) continue;
        const bw = blob.maxX - blob.minX + 1, bh = blob.maxY - blob.minY + 1;
        const aspect = bw / bh;
        const fill = blob.area / (bw * bh);
        /* A fiducial is a solid square: sides within 25% of each other and
           at least 70% of its bounding box filled. Letters and rules fail
           both tests comfortably. */
        if (aspect < 0.75 || aspect > 1.33 || fill < 0.7) continue;
        if (!best || blob.area > best.area) best = blob;
      }
    }
    if (!best) return null;
    found.push({ x: best.cx, y: best.cy });
  }
  return found;
}

/* ---------- homography -------------------------------------------------- */

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(A, b, n) {
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-10) return null;        // singular
    if (piv !== col) { [A[piv], A[col]] = [A[col], A[piv]]; [b[piv], b[col]] = [b[col], b[piv]]; }
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/** Reject a quad that is not convex or encloses almost nothing. */
export function quadIsSane(q) {
  if (!q || q.length !== 4) return false;
  if (q.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  let area = 0, sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    area += a.x * b.y - b.x * a.y;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const s = Math.sign(cross);
    if (s === 0) return false;                              // three points collinear
    if (sign === 0) sign = s; else if (s !== sign) return false;  // not convex
  }
  return Math.abs(area / 2) > 1;
}

/**
 * 3x3 homography mapping `from` onto `to` (four points each, same order).
 *
 * Throws on a degenerate quad rather than returning a matrix full of NaN.
 * That matters: a NaN matrix warps to a blank canvas, and a blank canvas
 * looks exactly like "the scan was empty". The user would be told nothing.
 */
export function solveHomography(from, to) {
  if (!quadIsSane(from)) throw new Error('solveHomography: source quad is degenerate (collinear, self-crossing or zero area)');
  if (!quadIsSane(to)) throw new Error('solveHomography: destination quad is degenerate');

  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solveLinear(A, b, 8);
  if (!h) throw new Error('solveHomography: singular system — the four points do not define a projection');
  const m = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  if (m.some(v => !Number.isFinite(v))) throw new Error('solveHomography: produced a non-finite matrix');
  return m;
}

export function applyHomography(m, x, y) {
  const d = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d };
}

/* ---------- warp -------------------------------------------------------- */

/**
 * Rectify a scan onto a page of `outW` x `outH`.
 *
 * `srcQuad` is the four detected (or hand-placed) fiducial centres on the
 * scan; `dstQuad` is where they belong on the rectified page. The homography
 * is solved output-to-input so every destination pixel is sampled exactly
 * once, with bilinear interpolation — nearest-neighbour here would alias the
 * pen strokes into a staircase before the tracer ever sees them.
 */
export function warpGray(gray, w, h, srcQuad, dstQuad, outW, outH) {
  const inv = solveHomography(dstQuad, srcQuad);
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(inv, x + 0.5, y + 0.5);
      const sx = p.x - 0.5, sy = p.y - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) { out[y * outW + x] = 255; continue; }
      const fx = sx - x0, fy = sy - y0;
      const a = gray[y0 * w + x0], b = gray[y0 * w + x0 + 1];
      const c = gray[(y0 + 1) * w + x0], d = gray[(y0 + 1) * w + x0 + 1];
      out[y * outW + x] =
        a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return out;
}

/* ---------- cell extraction --------------------------------------------- */

/**
 * Crop one cell out of the rectified binary page.
 *
 * `inset` pulls the crop in from the printed cell border so the border line
 * itself is never mistaken for ink. It is a fraction of the cell size.
 *
 * NOTE ON DESKEW: the original plan listed a deskew step here. That was
 * inherited from the phone-photo design, where the sheet itself might be
 * tilted. After fiducial rectification the sheet is already square, and any
 * slant left in a glyph is the donor's own italic hand. Removing it would
 * destroy the exact thing being captured. So there is deliberately no
 * deskew here.
 */
export function cropCell(page, pw, ph, rect, { inset = 0.08 } = {}) {
  const dx = Math.round(rect.w * inset), dy = Math.round(rect.h * inset);
  const x0 = Math.max(0, rect.x + dx), y0 = Math.max(0, rect.y + dy);
  const x1 = Math.min(pw, rect.x + rect.w - dx), y1 = Math.min(ph, rect.y + rect.h - dy);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = page[(y + y0) * pw + (x + x0)];
  }
  return { mask: out, w, h, offsetX: x0 - rect.x, offsetY: y0 - rect.y };
}

/**
 * Drop specks from a cell: any blob smaller than `minArea` pixels goes.
 * Scanner dust and the odd stray dot from a pen tap are common; a real
 * glyph part (even the dot of an i) is orders of magnitude larger.
 */
export function despeckle(mask, w, h, minArea = 12) {
  const seen = new Int32Array(w * h);
  const out = new Uint8Array(mask);
  let label = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p] || seen[p]) continue;
      const blob = floodFill(mask, w, h, x, y, seen, ++label);
      if (blob.area >= minArea) continue;
      const lab = seen[p];
      for (let i = 0; i < out.length; i++) if (seen[i] === lab) out[i] = 0;
    }
  }
  return out;
}
